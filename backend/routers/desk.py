"""desk.py — observations published to the desk.

WHAT THIS IS NOT. It is not a follower feed. In a team where everybody
works the same handful of theaters, a follow graph means everybody follows
everybody: it filters nothing and puts a step between seeing something and
saying it. What narrows a desk feed usefully is the theater and the
urgency, and those are fields.

VISIBLE TO THE ORGANISATION. Every approved account can read the desk and
post to it. That is the deliberate difference from chat and from cases,
which are private until shared — publishing is the act of making something
everybody's, and a feed with per-post visibility rules is a feed nobody
trusts to be complete.

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

from routers.case_workspace import ALLOWED_MIME as _ALLOWED_MIME


def _me(request: Request) -> dict:
    from main import _require_current_user
    return _require_current_user(request)


def _now():
    return datetime.datetime.utcnow()


def _files_root():
    from main import DATA_DIR
    root = os.path.join(DATA_DIR, "desk_files")
    os.makedirs(root, exist_ok=True)
    return root


def _safe_seg(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", s or "")[:64] or "_"


def _people(db, user_ids):
    from database import User
    from main import _user_to_dict
    ids = [i for i in set(user_ids) if i]
    if not ids:
        return {}
    out = {}
    for u in db.query(User).filter(User.id.in_(ids)).all():
        d = _user_to_dict(u)
        out[u.id] = {
            "id": u.id, "name": d["name"] or d["email"], "email": d["email"],
            "initials": d["initials"], "avatar": d["avatar"], "avatar_pos": d["avatar_pos"],
            "cover": d["cover"], "cover_pos": d["cover_pos"], "color": d["color"],
            "title": d["title"], "company": d["company"],
            "location": d["location"], "bio": d["bio"],
        }
    return out


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
    }


def _decorate(db, rows, me_id):
    """Counts and people for a page of posts, in two queries rather than
    two per row — a feed that fetches a profile per post flickers."""
    from database import Post, PostAck
    ids = [p.id for p in rows]
    people = _people(db, [p.author_user_id for p in rows])
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
        q = db.query(Post).filter(Post.parent_id.is_(None))
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
        rows = db.query(Post).filter(Post.parent_id == post_id).order_by(Post.created_at.asc()).all()
        people, acks, mine, _ = _decorate(db, rows, me["id"])
        return {"replies": [_post_dict(p, people, acks, mine) for p in rows]}


@router.post("/posts")
async def create_post(request: Request):
    """Publish. Body: {body, theater?, urgency?, attachment?, parent_id?}"""
    from database import Post, get_db
    me = _me(request)
    body = await request.json()
    text = (body.get("body") or "").strip()[:MAX_BODY]
    att = body.get("attachment")
    if not text and not att:
        raise HTTPException(status_code=400, detail="an empty post is not an observation")

    urgency = (body.get("urgency") or "").strip().lower() or None
    if urgency and urgency not in URGENCIES:
        raise HTTPException(status_code=400, detail=f"urgency must be one of {', '.join(URGENCIES)}")
    parent_id = (body.get("parent_id") or "").strip() or None

    with get_db() as db:
        if parent_id:
            parent = db.query(Post).filter(Post.id == parent_id).first()
            if not parent:
                raise HTTPException(status_code=404, detail="that post is gone")
            if parent.parent_id:
                # One level. A reply to a reply to a reply is a chat, and
                # there is a chat.
                parent_id = parent.parent_id
        p = Post(author_user_id=me["id"], parent_id=parent_id, body=text,
                 theater=(body.get("theater") or "").strip()[:80] or None,
                 urgency=urgency,
                 attachment_json=json.dumps(att) if att else None)
        db.add(p); db.commit(); db.refresh(p)
        people, acks, mine, replies = _decorate(db, [p], me["id"])
        return _post_dict(p, people, acks, mine, replies)


@router.delete("/posts/{post_id}")
def delete_post(post_id: str, request: Request):
    """Your own, or anybody's if you administer the place.

    A superadmin can take down a post because the desk is the one surface
    everybody sees — and that is deliberately NOT true of chat, where
    administering accounts is not a licence to touch what people said to
    each other.
    """
    from database import Post, get_db
    me = _me(request)
    with get_db() as db:
        p = db.query(Post).filter(Post.id == post_id).first()
        if not p:
            raise HTTPException(status_code=404, detail="no such post")
        if p.author_user_id != me["id"] and not me.get("is_super_admin"):
            raise HTTPException(status_code=403, detail="you can only delete your own posts")
        p.deleted_at = _now()
        db.commit()
        people, acks, mine, replies = _decorate(db, [p], me["id"])
        return _post_dict(p, people, acks, mine, replies)


@router.post("/posts/{post_id}/ack")
def toggle_ack(post_id: str, request: Request):
    from database import Post, PostAck, get_db
    me = _me(request)
    with get_db() as db:
        p = db.query(Post).filter(Post.id == post_id).first()
        if not p or p.deleted_at:
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
    _me(request)
    with get_db() as db:
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
    from database import Post, get_db
    _me(request)
    with get_db() as db:
        p = db.query(Post).filter(Post.id == post_id).first()
        if not p or p.deleted_at or not p.attachment_json:
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
    _me(request)
    with get_db() as db:
        rows = db.query(Post.theater).filter(
            Post.parent_id.is_(None), Post.deleted_at.is_(None),
            Post.theater.isnot(None)).all()
    counts = {}
    for (t,) in rows:
        counts[t] = counts.get(t, 0) + 1
    return [{"name": k, "count": v} for k, v in
            sorted(counts.items(), key=lambda kv: (-kv[1], kv[0].lower()))]
