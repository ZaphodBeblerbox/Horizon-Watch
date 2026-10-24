"""desk.py — observations published to the desk.

WHAT THIS IS NOT. It is not a follower feed. In a team where everybody
works the same handful of theaters, a follow graph means everybody follows
everybody: it filters nothing and puts a step between seeing something and
saying it. What narrows a desk feed usefully is the theater and the
urgency, and those are fields.

YOUR COMPANY BY DEFAULT (the owner, 2026-10-10). This was "visible to the
organisation", which was everybody while everybody was one firm; with
accounts keeping their own companies it meant a post went to strangers.
A post now names its audience when it is published:
  company   — the people of the author's company (the default);
  everyone  — every account on Parallax, said so on the post;
  people    — the author and the people named.
A reply follows its post. A post from before audiences was published to
everyone and stays so. The same rule applies to superadmins: "your
company" has to mean it.

A reply is a post with a parent. An ack is one row saying somebody picked
it up. Nothing else: a palette of reactions turns a watch log into a mood
board.
"""

import datetime
import json
import os
import re
import uuid

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

router = APIRouter(prefix="/api/desk", tags=["desk"])

MAX_BODY = 4000
MAX_FILE_BYTES = 32 * 1024 * 1024
URGENCIES = ("critical", "significant", "high", "elevated", "routine")
ATTACHMENT_KINDS = ("signal", "file", "briefing", "telegram", "place", "asset")

from routers.case_workspace import ALLOWED_MIME as _ALLOWED_MIME


def _me(request: Request) -> dict:
    from main import _require_current_user
    import people_face
    people_face.set_base_from(request)        # the avatar URLs built in this request
    return desk_identity(_require_current_user(request))


def _now():
    return datetime.datetime.utcnow()


def _files_root():
    from main import DATA_DIR
    root = os.path.join(DATA_DIR, "desk_files")
    os.makedirs(root, exist_ok=True)
    return root


def _safe_seg(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", s or "")[:64] or "_"


AUDIENCES = ("company", "everyone", "people")
MAX_SHARED = 50


def company_key(s: str | None) -> str | None:
    """Companies are free text on the account; one firm typed two ways is
    still one firm."""
    k = re.sub(r"\s+", " ", (s or "").strip().lower())
    return k or None


def _shared(p) -> list:
    try:
        v = json.loads(p.shared_with or "[]")
        return [str(x) for x in v] if isinstance(v, list) else []
    except ValueError:
        return []


def can_read(p, me: dict) -> bool:
    if p.author_user_id == me["id"]:
        return True
    a = p.audience
    if a in (None, "everyone"):
        return True
    if a == "company":
        return bool(p.audience_company) and p.audience_company == company_key(me.get("company"))
    if a == "people":
        return me["id"] in _shared(p)
    return False


def _readable(q, me: dict):
    """The same rule as can_read, as a query filter."""
    from sqlalchemy import and_, or_
    from database import Post
    conds = [Post.author_user_id == me["id"], Post.audience.is_(None), Post.audience == "everyone",
             and_(Post.audience == "people", Post.shared_with.like(f'%"{me["id"]}"%'))]
    mine = company_key(me.get("company"))
    if mine:
        conds.append(and_(Post.audience == "company", Post.audience_company == mine))
    return q.filter(or_(*conds))


def _visible_post(db, post_id: str, me: dict):
    """The post, or 404 — the same answer whether it does not exist or is
    not yours to read, so the desk does not confirm what it hides."""
    from database import Post
    p = db.query(Post).filter(Post.id == post_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="no such post")
    # a comment on a feed item ("item:<id>") is read by its own audience
    top = db.query(Post).filter(Post.id == p.parent_id).first() if (p.parent_id and not p.parent_id.startswith("item:")) else p
    if not top or not can_read(top, me):
        raise HTTPException(status_code=404, detail="no such post")
    return p


def _people(db, user_ids):
    """Faces only (people_face.py): the cover picture and the bio went out
    once per post and made the feed 2.0 MB (2026-10-19). A person's card
    fetches the whole page when it opens (GET /api/chat/profile/{id})."""
    import people_face
    return people_face.faces(db, user_ids)


def _post_dict(p, people, acks, my_acks, reply_counts=None):
    return {
        "id": p.id, "parent_id": p.parent_id,
        "author": people.get(p.author_user_id),
        "author_user_id": p.author_user_id,
        "body": "" if p.deleted_at else p.body,
        "theater": p.theater, "urgency": p.urgency,
        "attachment": json.loads(p.attachment_json) if (p.attachment_json and not p.deleted_at) else None,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "edited_at": p.edited_at.isoformat() if p.edited_at else None,
        "deleted": bool(p.deleted_at),
        "acks": acks.get(p.id, 0),
        "acked": p.id in my_acks,
        "replies": (reply_counts or {}).get(p.id, 0),
        "audience": _audience_dict(p, people),
    }


def _audience_dict(p, people) -> dict:
    a = p.audience or "everyone"
    author = people.get(p.author_user_id) or {}
    out = {"kind": a, "legacy": p.audience is None}
    if a == "company":
        out["company"] = author.get("company") or p.audience_company
    if a == "people":
        out["people"] = [people[i]["name"] for i in _shared(p) if i in people]
    return out


def _decorate(db, rows, me_id):
    """Counts and people for a page of posts, in two queries rather than
    two per row — a feed that fetches a profile per post flickers."""
    from database import Post, PostAck
    ids = [p.id for p in rows]
    people = _people(db, [p.author_user_id for p in rows] + [i for p in rows for i in _shared(p)])
    acks, mine, replies = {}, set(), {}
    if ids:
        for pid, in db.query(PostAck.post_id).filter(PostAck.post_id.in_(ids)).all():
            acks[pid] = acks.get(pid, 0) + 1
        mine = {pid for pid, in db.query(PostAck.post_id).filter(
            PostAck.post_id.in_(ids), PostAck.user_id == me_id).all()}
        for pid, in db.query(Post.parent_id).filter(
                Post.parent_id.in_(ids), Post.deleted_at.is_(None)).all():
            replies[pid] = replies.get(pid, 0) + 1
    return people, acks, mine, replies


@router.get("/posts")
def list_posts(request: Request, theater: str | None = None, urgency: str | None = None,
               author: str | None = None, before: str | None = None, limit: int = 40):
    """The feed: top-level posts, newest first."""
    from database import Post, get_db
    me = _me(request)
    limit = max(1, min(100, limit))
    with get_db() as db:
        q = _readable(db.query(Post).filter(Post.parent_id.is_(None)), me)
        if theater:
            q = q.filter(Post.theater == theater)
        if urgency:
            bands = [u.strip() for u in urgency.split(",") if u.strip()]
            if bands:
                q = q.filter(Post.urgency.in_(bands))
        if author:
            q = q.filter(Post.author_user_id == author)
        if before:
            try:
                q = q.filter(Post.created_at < datetime.datetime.fromisoformat(before.replace("Z", "")))
            except ValueError:
                raise HTTPException(status_code=400, detail="before must be an ISO timestamp")
        rows = q.order_by(Post.created_at.desc()).limit(limit).all()
        people, acks, mine, replies = _decorate(db, rows, me["id"])
        return {
            "posts": [_post_dict(p, people, acks, mine, replies) for p in rows],
            "has_more": len(rows) == limit,
        }


@router.get("/posts/{post_id}/replies")
def list_replies(post_id: str, request: Request):
    from database import Post, get_db
    me = _me(request)
    with get_db() as db:
        _visible_post(db, post_id, me)
        rows = db.query(Post).filter(Post.parent_id == post_id).order_by(Post.created_at.asc()).all()
        people, acks, mine, _ = _decorate(db, rows, me["id"])
        return {"replies": [_post_dict(p, people, acks, mine) for p in rows]}


# ── comments on a feed item (owner, 2026-10-24: "the desk like X") ──────
# A General item (a Telegram post, a GeoConfirmed event, one of our alerts)
# is not a Post, but its full view has comments like a team post does. They
# are Post rows whose parent_id is "item:<the item's id>", so reading,
# audience and deletion are the desk's own rules: a comment goes to the
# author's company (everyone when the account has none), like a new post.

ITEM_KEY = re.compile(r"^[A-Za-z0-9:/_.~-]{1,160}$")


def item_parent(key: str) -> str:
    key = (key or "").strip()
    if not ITEM_KEY.match(key):
        raise HTTPException(status_code=400, detail="not an item id")
    return f"item:{key}"


@router.get("/item-comments")
def list_item_comments(key: str, request: Request):
    from database import Post, get_db
    me = _me(request)
    parent = item_parent(key)
    with get_db() as db:
        rows = _readable(db.query(Post).filter(Post.parent_id == parent), me).order_by(Post.created_at.asc()).limit(200).all()
        people, acks, mine, _ = _decorate(db, rows, me["id"])
        return {"comments": [_post_dict(p, people, acks, mine) for p in rows]}


@router.post("/item-comments")
async def add_item_comment(request: Request):
    """Body: {key, body}. The item is not checked against a table: a comment
    names what it is about, and is read only by the author's audience."""
    from database import Post, get_db
    me = _me(request)
    body = await request.json()
    parent = item_parent(str(body.get("key") or ""))
    text = (body.get("body") or "").strip()[:MAX_BODY]
    if not text:
        raise HTTPException(status_code=400, detail="an empty comment says nothing")
    with get_db() as db:
        audience, company, shared = _audience_of(db, {"audience": None}, me)
        p = Post(author_user_id=me["id"], parent_id=parent, body=text,
                 audience=audience, audience_company=company, shared_with=shared)
        db.add(p); db.commit(); db.refresh(p)
        people, acks, mine, _ = _decorate(db, [p], me["id"])
        return _post_dict(p, people, acks, mine)


@router.post("/posts")
async def create_post(request: Request):
    """Publish. Body: {body, theater?, urgency?, attachment?, parent_id?,
    audience?: company|everyone|people, shared_with?: [user ids]}"""
    from database import Post, get_db
    me = _me(request)
    body = await request.json()
    text = (body.get("body") or "").strip()[:MAX_BODY]
    att = body.get("attachment")
    if not text and not att:
        raise HTTPException(status_code=400, detail="an empty post is not an observation")
    if att is not None:
        # One thing a post carries — what it is, not a copy of it: the card
        # reads the rest from where the thing lives.
        if not isinstance(att, dict) or att.get("kind") not in ATTACHMENT_KINDS:
            raise HTTPException(status_code=400, detail=f"an attachment is one of {', '.join(ATTACHMENT_KINDS)}")
        if len(json.dumps(att)) > 8000:
            raise HTTPException(status_code=400, detail="that attachment is too large to post")

    urgency = (body.get("urgency") or "").strip().lower() or None
    if urgency and urgency not in URGENCIES:
        raise HTTPException(status_code=400, detail=f"urgency must be one of {', '.join(URGENCIES)}")
    parent_id = (body.get("parent_id") or "").strip() or None

    with get_db() as db:
        if parent_id:
            parent = _visible_post(db, parent_id, me)
            if (parent.parent_id or "").startswith("item:"):
                raise HTTPException(status_code=400, detail="answer a comment on an item under the item")
            if parent.parent_id:
                # One level. A reply to a reply to a reply is a chat, and
                # there is a chat.
                parent_id = parent.parent_id
                parent = db.query(Post).filter(Post.id == parent_id).first()
            # A reply goes to whoever can read the post.
            audience, company, shared = parent.audience, parent.audience_company, parent.shared_with
        else:
            audience, company, shared = _audience_of(db, body, me)
        p = Post(author_user_id=me["id"], parent_id=parent_id, body=text,
                 theater=(body.get("theater") or "").strip()[:80] or None,
                 urgency=urgency,
                 attachment_json=json.dumps(att) if att else None,
                 audience=audience, audience_company=company, shared_with=shared)
        db.add(p); db.commit(); db.refresh(p)
        people, acks, mine, replies = _decorate(db, [p], me["id"])
        out = _post_dict(p, people, acks, mine, replies)
    # Tell the people it is for, now rather than at the next sweep
    # (inbox_notify: the same card the notification feed carries).
    try:
        import inbox_notify
        inbox_notify.after_post(out["id"])
    except Exception as ex:                                 # noqa: BLE001
        print(f"[desk] notify: {type(ex).__name__}: {ex}", flush=True)
    return out


def _audience_of(db, body: dict, me: dict) -> tuple:
    """(audience, audience_company, shared_with) for a new post. Company by
    default; an account with no company set publishes to everyone, and
    the composer says so before they post."""
    from database import User
    a = (body.get("audience") or "").strip().lower() or None
    mine = company_key(me.get("company"))
    if a is None:
        a = "company" if mine else "everyone"
    if a not in AUDIENCES:
        raise HTTPException(status_code=400, detail=f"audience must be one of {', '.join(AUDIENCES)}")
    if a == "company":
        if not mine:
            if me.get("desk_removed"):
                raise HTTPException(status_code=403, detail=f"you are no longer on the {me['desk_removed']} desk — post to everyone or to named people")
            raise HTTPException(status_code=400, detail="your account has no company — set it in Profile, or post to everyone or to named people")
        return a, mine, None
    if a == "people":
        ids = [str(x) for x in (body.get("shared_with") or []) if x][:MAX_SHARED]
        known = {u.id for u in db.query(User.id).filter(User.id.in_(ids)).all()} if ids else set()
        ids = [i for i in dict.fromkeys(ids) if i in known and i != me["id"]]
        if not ids:
            raise HTTPException(status_code=400, detail="name at least one person to share it with")
        return a, None, json.dumps(ids)
    return a, None, None


@router.delete("/posts/{post_id}")
def delete_post(post_id: str, request: Request):
    """Your own, or anybody's if you administer the place.

    A superadmin can take down a post because the desk is the one surface
    everybody sees — and that is deliberately NOT true of chat, where
    administering accounts is not a licence to touch what people said to
    each other.
    """
    from database import get_db
    me = _me(request)
    with get_db() as db:
        p = _visible_post(db, post_id, me)
        if p.author_user_id != me["id"] and not me.get("is_super_admin"):
            raise HTTPException(status_code=403, detail="you can only delete your own posts")
        p.deleted_at = _now()
        db.commit()
        people, acks, mine, replies = _decorate(db, [p], me["id"])
        return _post_dict(p, people, acks, mine, replies)


@router.post("/posts/{post_id}/ack")
def toggle_ack(post_id: str, request: Request):
    from database import PostAck, get_db
    me = _me(request)
    with get_db() as db:
        p = _visible_post(db, post_id, me)
        if p.deleted_at:
            raise HTTPException(status_code=404, detail="no such post")
        row = db.query(PostAck).filter(PostAck.post_id == post_id,
                                       PostAck.user_id == me["id"]).first()
        if row:
            db.delete(row)
        else:
            db.add(PostAck(post_id=post_id, user_id=me["id"]))
        db.commit()
        people, acks, mine, replies = _decorate(db, [p], me["id"])
        return _post_dict(p, people, acks, mine, replies)


@router.get("/posts/{post_id}/acks")
def who_acked(post_id: str, request: Request):
    """WHO picked it up, not just how many. On a desk "three people have
    seen this" is half an answer."""
    from database import PostAck, get_db
    me = _me(request)
    with get_db() as db:
        _visible_post(db, post_id, me)
        ids = [r.user_id for r in db.query(PostAck).filter(PostAck.post_id == post_id).all()]
        return list(_people(db, ids).values())


@router.post("/files")
async def upload_desk_file(request: Request, file: UploadFile = File(...)):
    """An image or document to publish with a post.

    Uploaded first, attached second: the post is not created until the
    picture is actually on disk, so a failed upload cannot leave an
    observation referring to a file that is not there.
    """
    me = _me(request)
    mime = (file.content_type or "").split(";")[0].strip().lower()
    if mime not in _ALLOWED_MIME:
        raise HTTPException(status_code=415, detail=f"unsupported file type: {mime or 'unknown'}")
    data = await file.read()
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="that file is larger than 32MB")

    file_id = str(uuid.uuid4())
    rel = os.path.join(_safe_seg(me["id"]), file_id + _ALLOWED_MIME[mime])
    dest = os.path.join(_files_root(), rel)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "wb") as fh:
        fh.write(data)
    return {"kind": "file", "id": file_id, "path": rel,
            "name": (file.filename or "file").strip()[:255],
            "mime": mime, "size": len(data)}


@router.get("/files/{post_id}")
def download_desk_file(post_id: str, request: Request):
    from database import get_db
    me = _me(request)
    with get_db() as db:
        p = _visible_post(db, post_id, me)
        if p.deleted_at or not p.attachment_json:
            raise HTTPException(status_code=404, detail="no such file")
        att = json.loads(p.attachment_json)
        rel = att.get("path") or ""
        root = os.path.realpath(_files_root())
        full = os.path.realpath(os.path.join(root, rel))
        if not full.startswith(root + os.sep) or not os.path.exists(full):
            raise HTTPException(status_code=410, detail="that file is no longer on disk")
        return FileResponse(full, media_type=att.get("mime") or "application/octet-stream",
                            filename=att.get("name") or "file")


@router.get("/theaters")
def posted_theaters(request: Request):
    """The theaters that actually have posts, with counts.

    Derived from the posts rather than from anybody's theater list: the
    filter should offer what is there to read, not what somebody once
    configured.
    """
    from database import Post, get_db
    me = _me(request)
    with get_db() as db:
        rows = _readable(db.query(Post.theater).filter(
            Post.parent_id.is_(None), Post.deleted_at.is_(None),
            Post.theater.isnot(None)), me).all()
    counts = {}
    for (t,) in rows:
        counts[t] = counts.get(t, 0) + 1
    return [{"name": k, "count": v} for k, v in
            sorted(counts.items(), key=lambda kv: (-kv[1], kv[0].lower()))]


# ── who is on a company desk (owner, 2026-10-19) ─────────────────────────
#
# "I want to be able to add people to my company desk or remove them."
#
# THE COMPANY FIELD STILL DECIDES WHO IS ON A DESK; a DeskMember row
# overrides it. Removing somebody writes state="removed" and clears their
# company, and the row keeps them off even if they type the company back
# into their profile. Adding somebody writes state="member" and sets their
# company, so their own posts go to that desk too.
#
# WHO MAY CHANGE IT: the desk's managers — its owner (the earliest account
# on it) and anybody on it who administers accounts (role "admin" or a
# superadmin). Somebody on another company's desk is not pulled across:
# they change their company themselves. Nobody removes themselves (that
# would be a way to lock a desk out of its last manager), and the owner
# cannot be removed.
#
# Removal takes effect on the next request: every desk route resolves the
# caller through desk_identity, which reads the row.

def _removed_from(db, key: str, user_id: str) -> bool:
    from database import DeskMember
    return db.query(DeskMember).filter(
        DeskMember.company == key, DeskMember.user_id == user_id,
        DeskMember.state == "removed").first() is not None


def desk_identity(me: dict, db=None) -> dict:
    """The caller as the desk sees them: with no company if they were
    removed from the one their profile names."""
    key = company_key((me or {}).get("company"))
    if not key:
        return me
    if db is None:
        from database import get_db
        with get_db() as s:
            gone = _removed_from(s, key, me["id"])
    else:
        gone = _removed_from(db, key, me["id"])
    return {**me, "company": None, "desk_removed": me.get("company")} if gone else me


def desk_members(db, key: str) -> list:
    """The approved accounts on this company's desk, oldest account first."""
    from database import DeskMember, User
    if not key:
        return []
    gone = {r.user_id for r in db.query(DeskMember.user_id).filter(
        DeskMember.company == key, DeskMember.state == "removed").all()}
    rows = [u for u in db.query(User).filter(User.approved == True, User.company.isnot(None)).all()  # noqa: E712
            if company_key(u.company) == key and u.id not in gone]
    rows.sort(key=lambda u: (u.created_at or datetime.datetime.max, u.id))
    return rows


def desk_managers(members: list) -> set:
    """The owner (the earliest account on the desk) and its admins."""
    if not members:
        return set()
    out = {members[0].id}
    out |= {u.id for u in members if u.is_super_admin or (u.role or "") == "admin"}
    return out


def _members_payload(db, me: dict) -> dict:
    key = company_key(me.get("company"))
    if not key:
        return {"company": None, "removed_from": me.get("desk_removed"),
                "members": [], "can_manage": False}
    members = desk_members(db, key)
    managers = desk_managers(members)
    people = _people(db, [u.id for u in members])
    owner = members[0].id if members else None
    return {
        "company": me.get("company"),
        "members": [{**people[u.id], "manager": u.id in managers, "owner": u.id == owner,
                     "you": u.id == me["id"]} for u in members if u.id in people],
        "can_manage": me["id"] in managers,
    }


def _require_manager(db, me: dict):
    key = company_key(me.get("company"))
    if not key:
        raise HTTPException(status_code=400, detail="your account is not on a company desk")
    members = desk_members(db, key)
    if me["id"] not in desk_managers(members):
        raise HTTPException(status_code=403,
                            detail="only the desk's owner or an admin can change who is on it")
    return key, members


@router.get("/members")
def list_desk_members(request: Request):
    from database import get_db
    me = _me(request)
    with get_db() as db:
        return _members_payload(db, me)


@router.post("/members")
async def add_desk_members(request: Request):
    """Body: {user_ids: [...]}. Managers only."""
    from database import DeskMember, User, get_db
    me = _me(request)
    body = await request.json()
    ids = list(dict.fromkeys(str(i) for i in (body.get("user_ids") or []) if i))[:MAX_SHARED]
    if not ids:
        raise HTTPException(status_code=400, detail="choose somebody to add")
    with get_db() as db:
        key, members = _require_manager(db, me)
        on = {u.id for u in members}
        rows = db.query(User).filter(User.id.in_(ids)).all()
        if len(rows) != len(ids) or any(not u.approved for u in rows):
            raise HTTPException(status_code=400, detail="one of those people is not an active account")
        for u in rows:
            if u.id in on:
                continue
            theirs = company_key(u.company)
            if theirs and theirs != key and not _removed_from(db, theirs, u.id):
                raise HTTPException(status_code=409,
                                    detail=f"{u.name or u.email} is on the {u.company} desk — "
                                           "they can change their company in their profile")
        now = _now()
        for u in rows:
            if u.id in on:
                continue
            u.company = me.get("company")
            r = db.query(DeskMember).filter(DeskMember.company == key, DeskMember.user_id == u.id).first()
            if r:
                r.state, r.changed_by, r.changed_at = "member", me["id"], now
            else:
                db.add(DeskMember(company=key, user_id=u.id, state="member", changed_by=me["id"], changed_at=now))
        db.commit()
        return _members_payload(db, me)


@router.delete("/members/{user_id}")
def remove_desk_member(user_id: str, request: Request):
    """Managers only. They stop seeing the company's posts at once."""
    from database import DeskMember, get_db
    me = _me(request)
    with get_db() as db:
        key, members = _require_manager(db, me)
        if user_id == me["id"]:
            raise HTTPException(status_code=400, detail="you cannot remove yourself from the desk")
        target = next((u for u in members if u.id == user_id), None)
        if not target:
            raise HTTPException(status_code=404, detail="they are not on this desk")
        if target.id == members[0].id:
            raise HTTPException(status_code=403, detail="the desk's owner cannot be removed")
        if company_key(target.company) == key:
            target.company = None
        now = _now()
        r = db.query(DeskMember).filter(DeskMember.company == key, DeskMember.user_id == user_id).first()
        if r:
            r.state, r.changed_by, r.changed_at = "removed", me["id"], now
        else:
            db.add(DeskMember(company=key, user_id=user_id, state="removed", changed_by=me["id"], changed_at=now))
        db.commit()
        return _members_payload(db, me)


# ── unread, and what is new for me (owner, 2026-10-19) ───────────────────
#
# "I want an indicator if I have any unread messages … on the desk" and "a
# notification when someone sends a new message on the desk". ONE RULE for
# both (unseen_posts): a post by somebody else that I can read and that
# arrived after I last looked — every top-level post, and a reply only when
# it is in a thread I started or answered (every reply to every post would
# make the desk a group chat with the whole company). How far I have read
# is one timestamp on the server, so the phone and the desktop agree.

FIRST_LOOK_DAYS = 7     # somebody who has never opened the desk: the last week counts


def read_since(db, user_id: str) -> datetime.datetime:
    from database import DeskRead, User
    r = db.query(DeskRead).filter(DeskRead.user_id == user_id).first()
    if r and r.last_read_at:
        return r.last_read_at
    floor = _now() - datetime.timedelta(days=FIRST_LOOK_DAYS)
    u = db.query(User).filter(User.id == user_id).first()
    return max(floor, u.created_at) if (u and u.created_at) else floor


def unseen_posts(db, me: dict, since: datetime.datetime, limit: int = 200) -> list:
    """Posts by others, readable by me, after `since`, newest first."""
    from sqlalchemy import or_
    from database import Post
    rows = _readable(db.query(Post), me).filter(
        Post.author_user_id != me["id"], Post.deleted_at.is_(None),
        # comments on feed items are read in the item's full view, not announced
        or_(Post.parent_id.is_(None), ~Post.parent_id.like("item:%")),
        Post.created_at > since).order_by(Post.created_at.desc()).limit(limit).all()
    parents = {p.parent_id for p in rows if p.parent_id}
    if parents:
        mine = {i for (i,) in db.query(Post.id).filter(
            Post.id.in_(parents), Post.author_user_id == me["id"]).all()}
        mine |= {i for (i,) in db.query(Post.parent_id).filter(
            Post.parent_id.in_(parents), Post.author_user_id == me["id"]).all()}
        rows = [p for p in rows if not p.parent_id or p.parent_id in mine]
    return rows


@router.get("/unread")
def desk_unread(request: Request):
    from database import get_db
    me = _me(request)
    with get_db() as db:
        since = read_since(db, me["id"])
        n = len(unseen_posts(db, me, since))
    return {"unread": n, "since": since.isoformat()}


@router.post("/read")
def desk_mark_read(request: Request):
    """I have looked at the desk now."""
    from database import DeskRead, get_db
    me = _me(request)
    with get_db() as db:
        r = db.query(DeskRead).filter(DeskRead.user_id == me["id"]).first()
        if r:
            r.last_read_at = _now()
        else:
            db.add(DeskRead(user_id=me["id"], last_read_at=_now()))
        db.commit()
    return {"ok": True}
