"""chat.py — messages between people, and in groups.

MEMBERSHIP IS THE ONLY ACCESS RULE. Every read and every write resolves
the caller from the session and then checks for a ConversationMember row.
There is no team-wide conversation, no admin override, and no "list all
chats" path — a superadmin can approve accounts and cannot read anybody's
messages, which is the whole reason the two are different things.

A DIRECT CHAT IS GOT, NOT CREATED. Asking to message somebody you have
already messaged returns the existing conversation. Without that, "message
Hannes" from two different screens makes two threads, each holding half the
history, and neither is wrong.

JOINS AND LEAVES ARE MESSAGES. "Marc added Hannes" is a row in the message
table with kind="system", not an entry in a separate audit feed, so the
history of a group that grew over a month reads in one order.
"""

import datetime
import json
import os
import re
import uuid

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

router = APIRouter(prefix="/api/chat", tags=["chat"])

MAX_BODY = 8000
MAX_FILE_BYTES = 64 * 1024 * 1024
# The same set the case workspace accepts. One list, imported rather than
# restated, so a type that can be filed can also be sent and the two
# cannot drift apart.
from routers.case_workspace import ALLOWED_MIME as _ALLOWED_MIME
MAX_TITLE = 120
MAX_MEMBERS = 128
_AVATAR_MAX_CHARS = 400_000


def _files_root():
    """Where chat attachments live.

    Their OWN directory, not the case store. A file sent in a chat is
    readable by the people in that chat, and a file in a case is readable
    by the people on that case; putting them in one place would make the
    next person to write a download route pick the wrong check.
    """
    from main import DATA_DIR
    root = os.path.join(DATA_DIR, "chat_files")
    os.makedirs(root, exist_ok=True)
    return root


def _safe_seg(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", s or "")[:64] or "_"


def _me(request: Request) -> dict:
    from main import _require_current_user
    return _require_current_user(request)


def _now():
    return datetime.datetime.utcnow()


def _membership(db, conversation_id: str, user_id: str, need_admin: bool = False):
    """The caller's seat in this conversation, or 404.

    404 and not 403 when there is no seat: telling somebody that a
    conversation exists is itself a disclosure about who is talking to whom.
    """
    from database import ConversationMember
    m = db.query(ConversationMember).filter(
        ConversationMember.conversation_id == conversation_id,
        ConversationMember.user_id == user_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="no such conversation")
    if need_admin and m.role != "admin":
        raise HTTPException(status_code=403, detail="only a group admin can do that")
    return m


def _people(db, user_ids):
    """The display fields for a set of users, in one query.

    Each message carries its sender's name and picture because a chat that
    renders ids and fetches forty profiles to draw one screen is a chat
    that flickers.
    """
    from database import User
    from main import _user_to_dict
    ids = [i for i in set(user_ids) if i]
    if not ids:
        return {}
    rows = db.query(User).filter(User.id.in_(ids)).all()
    out = {}
    for u in rows:
        d = _user_to_dict(u)
        out[u.id] = {
            "id": u.id, "name": d["name"] or d["email"], "email": d["email"],
            "initials": d["initials"], "avatar": d["avatar"], "avatar_pos": d["avatar_pos"],
            "color": d["color"], "title": d["title"], "company": d["company"],
            # THE WHOLE PAGE, not just the row. Tapping a name in a chat
            # opens that person's profile, and this was sending only what a
            # list row needs — so the card drew an empty hero and said
            # everybody had written nothing about themselves.
            "cover": d["cover"], "cover_pos": d["cover_pos"],
            "bio": d["bio"], "location": d["location"],
        }
    return out


def _msg_dict(m, people):
    return {
        "id": m.id, "conversation_id": m.conversation_id,
        "sender_id": m.sender_id,
        "sender": people.get(m.sender_id),
        "kind": m.kind,
        "body": "" if m.deleted_at else m.body,
        "attachment": json.loads(m.attachment_json) if (m.attachment_json and not m.deleted_at) else None,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "edited_at": m.edited_at.isoformat() if m.edited_at else None,
        "deleted": bool(m.deleted_at),
    }


def _conversation_dict(db, c, me_id, people=None, last=None, unread=None):
    from database import ConversationMember
    members = db.query(ConversationMember).filter(
        ConversationMember.conversation_id == c.id).all()
    ids = [m.user_id for m in members]
    people = people or _people(db, ids + ([last.sender_id] if last else []))
    others = [people[i] for i in ids if i != me_id and i in people]
    mine = next((m for m in members if m.user_id == me_id), None)
    return {
        "id": c.id, "kind": c.kind,
        # A direct chat is named after whoever you are NOT. Resolving that
        # server-side keeps the two people from seeing a title that is
        # right for one of them.
        "title": c.title if c.kind == "group" else (others[0]["name"] if others else "Just you"),
        "avatar": c.avatar,
        "members": [{**people[m.user_id], "role": m.role}
                    for m in members if m.user_id in people],
        "member_count": len(members),
        "my_role": mine.role if mine else None,
        "muted": bool(mine.muted) if mine else False,
        "last_message": _msg_dict(last, people) if last else None,
        "unread": unread if unread is not None else 0,
        "last_message_at": c.last_message_at.isoformat() if c.last_message_at else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


def _system(db, conversation_id, text):
    from database import ChatMessage
    db.add(ChatMessage(conversation_id=conversation_id, sender_id=None,
                       kind="system", body=text[:MAX_BODY]))


# ── conversations ────────────────────────────────────────────────────────

@router.get("/conversations")
def list_conversations(request: Request):
    """Mine, most recently spoken in first, with the unread count."""
    from database import Conversation, ConversationMember, ChatMessage, get_db
    me = _me(request)
    with get_db() as db:
        seats = db.query(ConversationMember).filter(
            ConversationMember.user_id == me["id"]).all()
        if not seats:
            return []
        ids = [s.conversation_id for s in seats]
        convs = db.query(Conversation).filter(Conversation.id.in_(ids)).all()
        convs.sort(key=lambda c: c.last_message_at or c.created_at, reverse=True)

        seat_by = {s.conversation_id: s for s in seats}
        out = []
        for c in convs:
            last = db.query(ChatMessage).filter(
                ChatMessage.conversation_id == c.id).order_by(
                ChatMessage.created_at.desc()).first()
            seat = seat_by[c.id]
            q = db.query(ChatMessage).filter(
                ChatMessage.conversation_id == c.id,
                ChatMessage.sender_id != me["id"],
                ChatMessage.kind != "system")
            if seat.last_read_at:
                q = q.filter(ChatMessage.created_at > seat.last_read_at)
            out.append(_conversation_dict(db, c, me["id"], last=last, unread=q.count()))
        return out


@router.post("/conversations")
async def create_conversation(request: Request):
    """Start a chat.

    Body: {kind: "direct"|"group", user_ids: [...], title?}

    A direct chat with somebody you have already messaged RETURNS THAT ONE.
    See the module note: two threads holding half a history each is worse
    than either.
    """
    from database import Conversation, ConversationMember, User, get_db
    me = _me(request)
    body = await request.json()
    kind = (body.get("kind") or "direct").strip().lower()
    if kind not in ("direct", "group"):
        raise HTTPException(status_code=400, detail="kind must be direct or group")

    ids = [str(i) for i in (body.get("user_ids") or []) if i and str(i) != me["id"]]
    ids = list(dict.fromkeys(ids))
    if not ids:
        raise HTTPException(status_code=400, detail="choose somebody to talk to")
    if len(ids) + 1 > MAX_MEMBERS:
        raise HTTPException(status_code=400, detail=f"a group holds at most {MAX_MEMBERS} people")
    if kind == "direct" and len(ids) != 1:
        raise HTTPException(status_code=400, detail="a direct chat is between two people")

    with get_db() as db:
        # Everyone named has to be a real, approved account — an invitation
        # to a revoked account is a message nobody will ever read.
        found = db.query(User).filter(User.id.in_(ids), User.approved == True).all()  # noqa: E712
        if len(found) != len(ids):
            raise HTTPException(status_code=400, detail="one of those people is not an active account")

        if kind == "direct":
            other = ids[0]
            mine = {r.conversation_id for r in db.query(ConversationMember).filter(
                ConversationMember.user_id == me["id"]).all()}
            theirs = {r.conversation_id for r in db.query(ConversationMember).filter(
                ConversationMember.user_id == other).all()}
            for cid in mine & theirs:
                c = db.query(Conversation).filter(Conversation.id == cid).first()
                if c and c.kind == "direct":
                    return _conversation_dict(db, c, me["id"])

        title = (body.get("title") or "").strip()[:MAX_TITLE] or None
        if kind == "group" and not title:
            names = _people(db, ids)
            title = ", ".join(p["name"].split()[0] for p in list(names.values())[:3]) or "New group"

        c = Conversation(kind=kind, title=title if kind == "group" else None,
                         created_by=me["id"], last_message_at=_now())
        db.add(c)
        db.flush()
        db.add(ConversationMember(conversation_id=c.id, user_id=me["id"],
                                  role="admin" if kind == "group" else "member",
                                  last_read_at=_now()))
        for uid in ids:
            db.add(ConversationMember(conversation_id=c.id, user_id=uid, role="member"))
        if kind == "group":
            names = _people(db, ids)
            _system(db, c.id, f"{me.get('name') or me['email']} started this group with "
                              f"{', '.join(p['name'] for p in names.values())}")
        db.commit()
        return _conversation_dict(db, c, me["id"])


@router.put("/conversations/{conversation_id}")
async def update_conversation(conversation_id: str, request: Request):
    """Rename a group or change its picture. Group admins only."""
    from database import Conversation, get_db
    me = _me(request)
    body = await request.json()
    with get_db() as db:
        _membership(db, conversation_id, me["id"], need_admin=True)
        c = db.query(Conversation).filter(Conversation.id == conversation_id).first()
        if not c or c.kind != "group":
            raise HTTPException(status_code=400, detail="only a group has a name")
        if "title" in body:
            t = (body["title"] or "").strip()[:MAX_TITLE]
            if not t:
                raise HTTPException(status_code=400, detail="a group needs a name")
            if t != c.title:
                _system(db, c.id, f"{me.get('name') or me['email']} renamed the group to “{t}”")
                c.title = t
        if "avatar" in body:
            av = body["avatar"]
            if av in (None, ""):
                c.avatar = None
            elif not isinstance(av, str) or not av.startswith("data:image/"):
                raise HTTPException(status_code=400, detail="the picture must be an image data URL")
            elif len(av) > _AVATAR_MAX_CHARS:
                raise HTTPException(status_code=413, detail="that picture is too large")
            else:
                c.avatar = av
        db.commit()
        return _conversation_dict(db, c, me["id"])


# ── members ──────────────────────────────────────────────────────────────

@router.post("/conversations/{conversation_id}/members")
async def add_members(conversation_id: str, request: Request):
    from database import Conversation, ConversationMember, User, get_db
    me = _me(request)
    body = await request.json()
    ids = list(dict.fromkeys(str(i) for i in (body.get("user_ids") or []) if i))
    with get_db() as db:
        _membership(db, conversation_id, me["id"])
        c = db.query(Conversation).filter(Conversation.id == conversation_id).first()
        if not c or c.kind != "group":
            # Adding a third person to a direct chat would silently change
            # what the first two thought they were in.
            raise HTTPException(status_code=400,
                                detail="a direct chat is between two people — start a group instead")
        already = {r.user_id for r in db.query(ConversationMember).filter(
            ConversationMember.conversation_id == conversation_id).all()}
        fresh = [i for i in ids if i not in already]
        if not fresh:
            raise HTTPException(status_code=400, detail="they are already in this group")
        if len(already) + len(fresh) > MAX_MEMBERS:
            raise HTTPException(status_code=400, detail=f"a group holds at most {MAX_MEMBERS} people")
        found = db.query(User).filter(User.id.in_(fresh), User.approved == True).all()  # noqa: E712
        if len(found) != len(fresh):
            raise HTTPException(status_code=400, detail="one of those people is not an active account")
        for uid in fresh:
            db.add(ConversationMember(conversation_id=conversation_id, user_id=uid))
        names = ", ".join(u.name or u.email for u in found)
        _system(db, conversation_id, f"{me.get('name') or me['email']} added {names}")
        c.last_message_at = _now()
        db.commit()
        return _conversation_dict(db, c, me["id"])


@router.delete("/conversations/{conversation_id}/members/{user_id}")
def remove_member(conversation_id: str, user_id: str, request: Request):
    """Leave, or remove somebody. A group admin can remove; anybody can leave."""
    from database import Conversation, ConversationMember, get_db
    me = _me(request)
    with get_db() as db:
        mine = _membership(db, conversation_id, me["id"])
        c = db.query(Conversation).filter(Conversation.id == conversation_id).first()
        if not c or c.kind != "group":
            raise HTTPException(status_code=400, detail="you cannot leave a direct chat")
        if user_id != me["id"] and mine.role != "admin":
            raise HTTPException(status_code=403, detail="only a group admin can remove somebody")
        target = db.query(ConversationMember).filter(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == user_id).first()
        if not target:
            raise HTTPException(status_code=404, detail="they are not in this group")
        people = _people(db, [user_id])
        who = people.get(user_id, {}).get("name", "somebody")
        db.delete(target)
        _system(db, conversation_id,
                f"{who} left" if user_id == me["id"]
                else f"{me.get('name') or me['email']} removed {who}")
        # The LAST ADMIN LEAVING hands the group to somebody rather than
        # leaving it with nobody who can rename it or add anyone.
        rest = db.query(ConversationMember).filter(
            ConversationMember.conversation_id == conversation_id).all()
        if rest and not any(r.role == "admin" for r in rest):
            rest[0].role = "admin"
        c.last_message_at = _now()
        db.commit()
    return {"ok": True}


# ── messages ─────────────────────────────────────────────────────────────

@router.get("/conversations/{conversation_id}/messages")
def list_messages(conversation_id: str, request: Request,
                  limit: int = 60, before: str | None = None):
    from database import ChatMessage, get_db
    me = _me(request)
    limit = max(1, min(200, limit))
    with get_db() as db:
        _membership(db, conversation_id, me["id"])
        q = db.query(ChatMessage).filter(ChatMessage.conversation_id == conversation_id)
        if before:
            try:
                q = q.filter(ChatMessage.created_at < datetime.datetime.fromisoformat(before.replace("Z", "")))
            except ValueError:
                raise HTTPException(status_code=400, detail="before must be an ISO timestamp")
        rows = q.order_by(ChatMessage.created_at.desc()).limit(limit).all()
        rows.reverse()                      # oldest first, the way it reads
        people = _people(db, [r.sender_id for r in rows])
        return {"messages": [_msg_dict(r, people) for r in rows],
                "has_more": len(rows) == limit}


@router.post("/conversations/{conversation_id}/messages")
async def post_message(conversation_id: str, request: Request):
    """Say something. Body: {body, kind?, attachment?}"""
    from database import ChatMessage, Conversation, get_db
    me = _me(request)
    body = await request.json()
    kind = (body.get("kind") or "text").strip().lower()
    if kind not in ("text", "signal", "case"):
        raise HTTPException(status_code=400, detail="kind must be text, signal or case")
    text = (body.get("body") or "").strip()[:MAX_BODY]
    att = body.get("attachment")
    if not text and not att:
        raise HTTPException(status_code=400, detail="an empty message is not a message")

    with get_db() as db:
        seat = _membership(db, conversation_id, me["id"])
        m = ChatMessage(conversation_id=conversation_id, sender_id=me["id"],
                        kind=kind, body=text,
                        attachment_json=json.dumps(att) if att else None)
        db.add(m)
        c = db.query(Conversation).filter(Conversation.id == conversation_id).first()
        if c:
            c.last_message_at = _now()
        # Sending IS reading: a message you just wrote must never come back
        # to you as unread.
        seat.last_read_at = _now()
        db.commit()
        return _msg_dict(m, _people(db, [me["id"]]))


@router.delete("/conversations/{conversation_id}/messages/{message_id}")
def delete_message(conversation_id: str, message_id: str, request: Request):
    from database import ChatMessage, get_db
    me = _me(request)
    with get_db() as db:
        _membership(db, conversation_id, me["id"])
        m = db.query(ChatMessage).filter(
            ChatMessage.id == message_id,
            ChatMessage.conversation_id == conversation_id).first()
        if not m:
            raise HTTPException(status_code=404, detail="no such message")
        if m.sender_id != me["id"]:
            raise HTTPException(status_code=403, detail="you can only delete your own messages")
        m.deleted_at = _now()
        db.commit()
        return _msg_dict(m, {})


@router.post("/conversations/{conversation_id}/read")
def mark_read(conversation_id: str, request: Request):
    from database import get_db
    me = _me(request)
    with get_db() as db:
        seat = _membership(db, conversation_id, me["id"])
        seat.last_read_at = _now()
        db.commit()
    return {"ok": True}


@router.get("/unread")
def unread_total(request: Request):
    """One number, for the badge on the rail."""
    from database import ChatMessage, ConversationMember, get_db
    me = _me(request)
    with get_db() as db:
        seats = db.query(ConversationMember).filter(
            ConversationMember.user_id == me["id"]).all()
        total = 0
        for s in seats:
            q = db.query(ChatMessage).filter(
                ChatMessage.conversation_id == s.conversation_id,
                ChatMessage.sender_id != me["id"],
                ChatMessage.kind != "system")
            if s.last_read_at:
                q = q.filter(ChatMessage.created_at > s.last_read_at)
            total += q.count()
        return {"unread": total}


@router.get("/people")
def chat_people(request: Request):
    """Who you can message: every active account but yourself.

    Its own route rather than reusing /api/users because this one answers a
    question about a chat — it excludes you, and it excludes accounts that
    cannot sign in, both of which the roster deliberately includes.
    """
    from database import User, get_db
    me = _me(request)
    with get_db() as db:
        rows = db.query(User).filter(
            User.approved == True, User.id != me["id"]).all()  # noqa: E712
        people = _people(db, [u.id for u in rows])
        return sorted(people.values(), key=lambda p: (p["name"] or "").lower())


# ── attachments ──────────────────────────────────────────────────────────
#
# TWO WAYS TO SEND A FILE, ONE KIND OF MESSAGE. A file off your machine and
# a file out of a case arrive as the same thing — kind="file", with the
# bytes in the chat's own store. The case one is COPIED rather than linked:
# a link would either be dead for anybody not on that case, or would have
# to quietly add them to it. Sending somebody a file should not widen their
# access to everything filed beside it.


def _attachment_message(db, conversation_id, sender_id, data, filename, mime, origin=None):
    from database import ChatMessage, Conversation
    message_id = str(uuid.uuid4())
    ext = _ALLOWED_MIME.get(mime, "")
    rel = os.path.join(_safe_seg(conversation_id), message_id + ext)
    dest = os.path.join(_files_root(), rel)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "wb") as fh:
        fh.write(data)

    att = {
        "name": (filename or "file").strip()[:255],
        "mime": mime, "size": len(data), "path": rel,
    }
    if origin:
        # Where it came from, so "Ana sent you the Hodeidah scan" can say
        # which case it was filed in without the reader needing access to it.
        att["from"] = origin
    m = ChatMessage(id=message_id, conversation_id=conversation_id, sender_id=sender_id,
                    kind="file", body="", attachment_json=json.dumps(att))
    db.add(m)
    c = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if c:
        c.last_message_at = _now()
    return m


@router.post("/conversations/{conversation_id}/files")
async def upload_to_chat(conversation_id: str, request: Request,
                         file: UploadFile = File(...), body: str = Form(None)):
    """A file off somebody's machine."""
    from database import get_db
    me = _me(request)
    mime = (file.content_type or "").split(";")[0].strip().lower()
    if mime not in _ALLOWED_MIME:
        raise HTTPException(status_code=415, detail=f"unsupported file type: {mime or 'unknown'}")
    data = await file.read()
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="that file is larger than 64MB")

    with get_db() as db:
        seat = _membership(db, conversation_id, me["id"])
        m = _attachment_message(db, conversation_id, me["id"], data,
                                file.filename, mime)
        if body and body.strip():
            m.body = body.strip()[:MAX_BODY]
        seat.last_read_at = _now()
        db.commit()
        return _msg_dict(m, _people(db, [me["id"]]))


@router.post("/conversations/{conversation_id}/attach-node")
async def attach_case_node(conversation_id: str, request: Request):
    """A file out of a case. Body: {case_id, node_id, body?}

    The SENDER's access is what is checked, and the bytes are copied. See
    the section note.
    """
    from database import CaseNode, get_db
    from routers.case_workspace import _case_access, _data_root
    me = _me(request)
    payload = await request.json()
    case_id = (payload.get("case_id") or "").strip()
    node_id = (payload.get("node_id") or "").strip()
    if not case_id or not node_id:
        raise HTTPException(status_code=400, detail="case_id and node_id are required")

    with get_db() as db:
        seat = _membership(db, conversation_id, me["id"])
        c = _case_access(db, case_id, me["id"])
        n = db.query(CaseNode).filter(CaseNode.id == node_id,
                                      CaseNode.case_id == case_id).first()
        if not n:
            raise HTTPException(status_code=404, detail="that file is not in this case")
        if n.kind == "folder":
            raise HTTPException(status_code=400, detail="send a file, not a folder")

        origin = {"case_id": case_id, "case_title": c.title, "node_id": node_id}

        if n.kind == "doc":
            # A document is its HTML. Sent as a file so the reader can open
            # it without a seat on the case it was written in.
            data = (n.body_html or "").encode("utf-8")
            name = f"{n.name}.html" if not n.name.lower().endswith(".html") else n.name
            mime = "text/plain"
        else:
            if not n.storage_path:
                raise HTTPException(status_code=409, detail="that file has no content stored")
            src = os.path.join(_data_root(), n.storage_path)
            if not os.path.exists(src):
                raise HTTPException(status_code=410, detail="that file is no longer on disk")
            if os.path.getsize(src) > MAX_FILE_BYTES:
                raise HTTPException(status_code=413, detail="that file is larger than 64MB")
            with open(src, "rb") as fh:
                data = fh.read()
            name = n.name
            mime = (n.mime or "application/octet-stream").lower()
            if mime not in _ALLOWED_MIME:
                mime = "text/plain"

        m = _attachment_message(db, conversation_id, me["id"], data, name, mime, origin)
        text = (payload.get("body") or "").strip()
        if text:
            m.body = text[:MAX_BODY]
        seat.last_read_at = _now()
        db.commit()
        return _msg_dict(m, _people(db, [me["id"]]))


@router.get("/conversations/{conversation_id}/messages/{message_id}/file")
def download_attachment(conversation_id: str, message_id: str, request: Request):
    from database import ChatMessage, get_db
    me = _me(request)
    with get_db() as db:
        _membership(db, conversation_id, me["id"])
        m = db.query(ChatMessage).filter(
            ChatMessage.id == message_id,
            ChatMessage.conversation_id == conversation_id).first()
        if not m or m.deleted_at or not m.attachment_json:
            raise HTTPException(status_code=404, detail="no such file")
        att = json.loads(m.attachment_json)
        rel = att.get("path") or ""
        # The stored path is one this server wrote, but it is read back out
        # of a JSON column, so it is re-checked against the root rather
        # than trusted to still be inside it.
        full = os.path.realpath(os.path.join(_files_root(), rel))
        if not full.startswith(os.path.realpath(_files_root()) + os.sep) or not os.path.exists(full):
            raise HTTPException(status_code=410, detail="that file is no longer on disk")
        return FileResponse(full, media_type=att.get("mime") or "application/octet-stream",
                            filename=att.get("name") or "file")


@router.get("/attachable")
def attachable_files(request: Request, q: str | None = None, limit: int = 60):
    """The Parallax files this person could send: every file and document
    in a case they own or were shared.

    Flat and searchable rather than a tree: picking a file to send is a
    search ("the Hodeidah scan"), not an expedition through folders.
    """
    from database import Case, CaseNode, CaseShare, get_db
    me = _me(request)
    limit = max(1, min(200, limit))
    with get_db() as db:
        mine = {c.case_id: c for c in db.query(Case).filter(Case.owner_user_id == me["id"]).all()}
        shared_ids = [s.case_id for s in db.query(CaseShare).filter(CaseShare.user_id == me["id"]).all()]
        for c in db.query(Case).filter(Case.case_id.in_(shared_ids)).all() if shared_ids else []:
            mine.setdefault(c.case_id, c)
        if not mine:
            return []
        rows = db.query(CaseNode).filter(
            CaseNode.case_id.in_(list(mine.keys())),
            CaseNode.kind != "folder").order_by(CaseNode.updated_at.desc()).limit(600).all()
        text = (q or "").strip().lower()
        out = []
        for n in rows:
            if text and text not in (n.name or "").lower():
                continue
            out.append({
                "case_id": n.case_id, "case_title": mine[n.case_id].title,
                "node_id": n.id, "name": n.name, "kind": n.kind,
                "mime": n.mime, "size_bytes": n.size_bytes,
                "updated_at": n.updated_at.isoformat() if n.updated_at else None,
            })
            if len(out) >= limit:
                break
        return out


@router.post("/conversations/{conversation_id}/attach-case")
async def attach_case(conversation_id: str, request: Request):
    """Send a whole case. Body: {case_id, can_edit?, body?}

    A CASE IS SHARED, NOT COPIED. A file can be copied into the chat
    because it is finished; a case is a live workspace that will gain
    signals, documents and detections after this message is sent, and a
    snapshot of it would be wrong by the afternoon. So sending one grants
    the people in this conversation access to it — a real CaseShare row
    each, the same rows the case's own sharing panel writes, and visible
    there afterwards.

    THAT IS A GRANT, SO IT SAYS SO. The message names everybody who was
    given access and whether they can edit. Sharing a case quietly, in a
    chat, with no record of what was handed over, is how somebody ends up
    not knowing who can read their work.

    Only the owner can send one, for the same reason only the owner can
    share one: a sharee who could re-share makes the owner's list of who
    can see their work incomplete and wrong.
    """
    from database import CaseNode, CaseShare, ChatMessage, Conversation, ConversationMember, get_db
    from routers.case_workspace import _case_access
    me = _me(request)
    payload = await request.json()
    case_id = (payload.get("case_id") or "").strip()
    if not case_id:
        raise HTTPException(status_code=400, detail="case_id is required")
    can_edit = bool(payload.get("can_edit", False))

    with get_db() as db:
        seat = _membership(db, conversation_id, me["id"])
        c = _case_access(db, case_id, me["id"])
        if c.owner_user_id != me["id"]:
            raise HTTPException(status_code=403, detail="only the owner can send this case")

        members = db.query(ConversationMember).filter(
            ConversationMember.conversation_id == conversation_id).all()
        granted = []
        for m in members:
            if m.user_id == c.owner_user_id:
                continue
            row = db.query(CaseShare).filter(
                CaseShare.case_id == case_id, CaseShare.user_id == m.user_id).first()
            if row:
                # Already shared: an existing grant is only ever widened
                # here, never narrowed. Taking edit away is a decision for
                # the sharing panel, not a side effect of sending a link.
                if can_edit and not row.can_edit:
                    row.can_edit = True
                    granted.append(m.user_id)
            else:
                db.add(CaseShare(case_id=case_id, user_id=m.user_id,
                                 shared_by=me["id"], can_edit=can_edit))
                granted.append(m.user_id)

        files = db.query(CaseNode).filter(CaseNode.case_id == case_id,
                                          CaseNode.kind != "folder").count()
        att = {
            "case_id": case_id, "case_title": c.title,
            "files": files, "can_edit": can_edit,
            "granted_to": [p["name"] for p in _people(db, granted).values()],
        }
        m = ChatMessage(conversation_id=conversation_id, sender_id=me["id"],
                        kind="case", body=(payload.get("body") or "").strip()[:MAX_BODY],
                        attachment_json=json.dumps(att))
        db.add(m)
        conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
        if conv:
            conv.last_message_at = _now()
        seat.last_read_at = _now()
        db.commit()
        return _msg_dict(m, _people(db, [me["id"]]))


@router.get("/sendable-cases")
def sendable_cases(request: Request):
    """The cases this person can send: the ones they own.

    Not the ones shared WITH them — sending those would be re-sharing, and
    only an owner may widen access to their own work.
    """
    from database import Case, CaseNode, get_db
    me = _me(request)
    with get_db() as db:
        rows = db.query(Case).filter(Case.owner_user_id == me["id"]).all()
        out = []
        for c in rows:
            out.append({
                "case_id": c.case_id, "title": c.title,
                "files": db.query(CaseNode).filter(CaseNode.case_id == c.case_id,
                                                   CaseNode.kind != "folder").count(),
                "stage": getattr(c, "approval_stage", None),
            })
        out.sort(key=lambda d: (d["title"] or "").lower())
        return out
