"""people_face.py — a person as a chat or desk response carries them: a face.

WHY (server stability, 2026-10-19). /api/chat/conversations measured 2.4 MB
and /api/desk/posts 2.0 MB in production: every member and every post
carried its person's WHOLE profile — the ~370 KB cover picture, the bio,
the avatar as inline base64 — once per member and once per post, polled
by every open phone. A list row needs a face: a name, initials, a colour
and a small picture. That is all these responses carry now; the full page
(cover, bio, location) is fetched when somebody actually opens a person's
card (GET /api/chat/profile/{id}).

THE AVATAR IS A URL, NOT THE BYTES. /api/chat/avatar/{user_id}/{key} serves
the picture, where `key` is a hash of the picture itself: a changed picture
is a new URL (so it is cached forever, immutable), and the URL can only be
known from a signed-in response — an <img> on the web app cannot carry the
bearer token, so the capability is in the URL rather than in a cookie.

The URL is absolute (the API's own origin, as the request reached it), so
the web page on another host and the desktop app load it from the API and
not from themselves.
"""
from __future__ import annotations

import base64
import contextvars
import hashlib

_BASE: contextvars.ContextVar[str] = contextvars.ContextVar("face_base", default="")

FACE_FIELDS = ("id", "name", "email", "initials", "color", "avatar", "avatar_pos", "title", "company")


def set_base_from(request) -> None:
    """Remember this request's API origin for the avatar URLs built in it."""
    try:
        h = request.headers
        proto = (h.get("x-forwarded-proto") or request.url.scheme or "http").split(",")[0].strip()
        host = (h.get("x-forwarded-host") or h.get("host") or request.url.netloc or "").split(",")[0].strip()
        _BASE.set(f"{proto}://{host}" if host else "")
    except Exception:                                        # noqa: BLE001
        _BASE.set("")


def avatar_key(data: str | None) -> str | None:
    return hashlib.sha256(data.encode("utf-8")).hexdigest()[:20] if data else None


def avatar_url(user_id: str, avatar: str | None) -> str | None:
    if not avatar:
        return None
    if not avatar.startswith("data:"):
        return avatar                       # already a URL
    return f"{_BASE.get()}/api/chat/avatar/{user_id}/{avatar_key(avatar)}"


def decode_data_url(data: str) -> tuple[bytes, str] | None:
    """(bytes, media type) of a base64 data URL, or None."""
    if not data or not data.startswith("data:") or "," not in data:
        return None
    head, payload = data.split(",", 1)
    mime = head[5:].split(";")[0] or "application/octet-stream"
    if ";base64" not in head:
        return None
    try:
        return base64.b64decode(payload), mime
    except Exception:                                        # noqa: BLE001
        return None


def _initials_colour(u) -> tuple:
    """main's deterministic initials and colour where main is the running
    app; a plain fallback in a test or a script (main is not imported for
    it)."""
    import sys
    m = sys.modules.get("main")
    if m is not None and hasattr(m, "_user_initials"):
        return m._user_initials(u.name, u.email), m._user_color(u.id)
    w = (u.name or u.email or "?").split()
    return ("".join(x[0] for x in w[:2]) or "?").upper(), None


def face(u) -> dict:
    ini, col = (None, None) if (u.initials and u.color) else _initials_colour(u)
    return {
        "id": u.id, "name": (u.name or u.email), "email": u.email,
        "initials": u.initials or ini,
        "color": u.color or col,
        "avatar": avatar_url(u.id, u.avatar), "avatar_pos": u.avatar_pos,
        "title": u.title, "company": u.company,
    }


def faces(db, user_ids) -> dict:
    """{id: face} for a set of users, in one query that reads no pictures
    but the avatar."""
    from database import User
    from sqlalchemy.orm import load_only
    ids = [i for i in set(user_ids or []) if i]
    if not ids:
        return {}
    rows = db.query(User).options(load_only(
        User.id, User.name, User.email, User.initials, User.color, User.avatar,
        User.avatar_pos, User.title, User.company)).filter(User.id.in_(ids)).all()
    return {u.id: face(u) for u in rows}
