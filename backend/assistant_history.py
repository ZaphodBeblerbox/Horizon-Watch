"""assistant_history.py — the assistant's conversations, kept per user.

Two tables in the app database, created on first use (additive, like
assistant_usage):

    assistant_conversations  id, uid, title, mode, skipped, created_at, updated_at
    assistant_messages       id, conv_id, uid, role, content, meta (JSON), turn_id, created_at

A message's meta holds what the screen needs to show it again after a
reload: citations, the map actions (shown as labels, never replayed), the
proposals with their state (pending / done / skipped / failed), the
choices offered, and flags (forms, refused, stopped). A proposal's
"expired" is derived on read from its message's age (PROPOSAL_TTL_S), never
stored.

Every read and write is scoped to the user: another user's conversation is
"not found", the same as one that does not exist. No model is called here;
a title is the first question, cut.
"""
from __future__ import annotations

import json
import secrets
import sqlite3
import time

import assistant as A

MAX_CONVERSATIONS = 200          # per user; the oldest go first
MAX_MESSAGES = 400               # per conversation; the oldest go first
MAX_CONTENT = 8000
MAX_META = 64_000
TITLE_CHARS = 60
PROPOSAL_STATES = ("pending", "done", "skipped", "failed", "saving")

_ready: set[str] = set()


def _con() -> sqlite3.Connection:
    con = A._con()
    path = A._db_path()
    if path not in _ready:
        con.execute("CREATE TABLE IF NOT EXISTS assistant_conversations (id TEXT PRIMARY KEY, uid TEXT NOT NULL, "
                    "title TEXT DEFAULT '', mode TEXT DEFAULT 'chat', skipped TEXT DEFAULT '[]', "
                    "created_at REAL NOT NULL, updated_at REAL NOT NULL)")
        con.execute("CREATE INDEX IF NOT EXISTS ix_assistant_conv_uid ON assistant_conversations (uid, updated_at)")
        con.execute("CREATE TABLE IF NOT EXISTS assistant_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, "
                    "conv_id TEXT NOT NULL, uid TEXT NOT NULL, role TEXT NOT NULL, content TEXT DEFAULT '', "
                    "meta TEXT DEFAULT '{}', turn_id TEXT, created_at REAL NOT NULL)")
        con.execute("CREATE INDEX IF NOT EXISTS ix_assistant_msg_conv ON assistant_messages (conv_id, id)")
        con.commit()
        _ready.add(path)
    return con


class NotFound(Exception):
    pass


def _title_of(text: str) -> str:
    t = " ".join(str(text or "").split())
    return t if len(t) <= TITLE_CHARS else t[:TITLE_CHARS - 1].rstrip() + "…"


def _clean_meta(meta) -> dict:
    if not isinstance(meta, dict):
        return {}
    out = {}
    for k in ("citations", "actions", "proposals", "ask", "forms", "refused", "stopped", "step", "chips",
              "path", "fromForm", "voice", "error", "draft"):
        if k in meta and meta[k] is not None:
            out[k] = meta[k]
    props = []
    for p in out.get("proposals") or []:
        if isinstance(p, dict) and p.get("token"):
            q = dict(p)
            if q.get("state") not in PROPOSAL_STATES:
                q["state"] = "pending"
            props.append(q)
    if "proposals" in out:
        out["proposals"] = props
    s = json.dumps(out, ensure_ascii=False)
    if len(s) > MAX_META:          # citations are the bulk: keep the first ones
        out["citations"] = (out.get("citations") or [])[:12]
        out["chips"] = None
        s = json.dumps(out, ensure_ascii=False)
        if len(s) > MAX_META:
            out = {k: v for k, v in out.items() if k in ("proposals", "forms", "refused", "stopped", "step")}
    return out


def _own(con, uid: str, cid: str) -> sqlite3.Row:
    r = con.execute("SELECT id, uid, title, mode, skipped, created_at, updated_at FROM assistant_conversations "
                    "WHERE id=? AND uid=?", (str(cid or ""), str(uid))).fetchone()
    if not r:
        raise NotFound("conversation not found")
    return r


def _conv_row(r) -> dict:
    try:
        skipped = json.loads(r[4] or "[]")
    except ValueError:
        skipped = []
    return {"id": r[0], "title": r[2] or "", "mode": r[3] or "chat", "skipped": skipped,
            "created_at": r[5], "updated_at": r[6]}


def _msg_row(r, now: float) -> dict:
    try:
        meta = json.loads(r[4] or "{}")
    except ValueError:
        meta = {}
    m = {"id": r[0], "role": r[1], "content": r[2] or "", "turn_id": r[3], "created_at": r[5], **meta}
    for p in m.get("proposals") or []:
        p["expires_at"] = r[5] + A.PROPOSAL_TTL_S
        if p.get("state") in ("pending", "failed", "saving") and now > p["expires_at"]:
            p["state"] = "expired"          # derived on read: a token lives 10 minutes
    return m


# ── conversations ────────────────────────────────────────────────────────────

def create(uid: str, mode: str = "chat", title: str = "", now: float | None = None) -> dict:
    now = now or time.time()
    cid = "c_" + secrets.token_urlsafe(12)
    mode = mode if mode in ("chat", "onboarding", "theater") else "chat"
    with A._db_lock:
        con = _con()
        try:
            con.execute("INSERT INTO assistant_conversations (id, uid, title, mode, skipped, created_at, updated_at) "
                        "VALUES (?, ?, ?, ?, '[]', ?, ?)", (cid, str(uid), _title_of(title), mode, now, now))
            # the oldest conversations beyond the cap go, with their messages
            old = [r[0] for r in con.execute("SELECT id FROM assistant_conversations WHERE uid=? "
                                             "ORDER BY updated_at DESC LIMIT -1 OFFSET ?", (str(uid), MAX_CONVERSATIONS))]
            for o in old:
                con.execute("DELETE FROM assistant_messages WHERE conv_id=?", (o,))
                con.execute("DELETE FROM assistant_conversations WHERE id=?", (o,))
            con.commit()
        finally:
            con.close()
    return {"id": cid, "title": _title_of(title), "mode": mode, "skipped": [], "created_at": now, "updated_at": now}


def list_for(uid: str, limit: int = 50) -> list[dict]:
    limit = max(1, min(200, int(limit or 50)))
    with A._db_lock:
        con = _con()
        try:
            rows = con.execute(
                "SELECT c.id, c.uid, c.title, c.mode, c.skipped, c.created_at, c.updated_at, "
                "(SELECT COUNT(*) FROM assistant_messages m WHERE m.conv_id=c.id), "
                "(SELECT content FROM assistant_messages m WHERE m.conv_id=c.id ORDER BY m.id DESC LIMIT 1) "
                "FROM assistant_conversations c WHERE c.uid=? ORDER BY c.updated_at DESC LIMIT ?",
                (str(uid), limit)).fetchall()
        finally:
            con.close()
    out = []
    for r in rows:
        if not r[7]:
            continue                    # created, never used
        c = _conv_row(r)
        c["count"] = r[7]
        c["last"] = _title_of(r[8] or "")
        out.append(c)
    return out


def get(uid: str, cid: str, now: float | None = None) -> dict:
    now = now or time.time()
    with A._db_lock:
        con = _con()
        try:
            c = _conv_row(_own(con, uid, cid))
            rows = con.execute("SELECT id, role, content, turn_id, meta, created_at FROM assistant_messages "
                               "WHERE conv_id=? ORDER BY id", (c["id"],)).fetchall()
        finally:
            con.close()
    c["messages"] = [_msg_row(r, now) for r in rows]
    return c


def update(uid: str, cid: str, title=None, mode=None, skipped=None) -> dict:
    sets, vals = [], []
    if title is not None:
        t = " ".join(str(title).split())[:80]
        if not t:
            raise ValueError("a title cannot be empty")
        sets.append("title=?"); vals.append(t)
    if mode in ("chat", "onboarding", "theater"):
        sets.append("mode=?"); vals.append(mode)
    if isinstance(skipped, list):
        sets.append("skipped=?"); vals.append(json.dumps([str(s)[:20] for s in skipped][:10]))
    with A._db_lock:
        con = _con()
        try:
            _own(con, uid, cid)
            if sets:
                con.execute(f"UPDATE assistant_conversations SET {', '.join(sets)} WHERE id=? AND uid=?",
                            (*vals, cid, str(uid)))
                con.commit()
            r = _own(con, uid, cid)
        finally:
            con.close()
    return _conv_row(r)


def delete(uid: str, cid: str) -> None:
    with A._db_lock:
        con = _con()
        try:
            _own(con, uid, cid)
            con.execute("DELETE FROM assistant_messages WHERE conv_id=? AND uid=?", (cid, str(uid)))
            con.execute("DELETE FROM assistant_conversations WHERE id=? AND uid=?", (cid, str(uid)))
            con.commit()
        finally:
            con.close()


# ── messages ────────────────────────────────────────────────────────────────

def _insert(con, uid: str, cid: str, role: str, content: str, meta: dict, turn_id: str | None, now: float) -> int:
    cur = con.execute("INSERT INTO assistant_messages (conv_id, uid, role, content, meta, turn_id, created_at) "
                      "VALUES (?, ?, ?, ?, ?, ?, ?)",
                      (cid, str(uid), role, str(content or "")[:MAX_CONTENT],
                       json.dumps(_clean_meta(meta), ensure_ascii=False), turn_id, now))
    con.execute("UPDATE assistant_conversations SET updated_at=? WHERE id=?", (now, cid))
    if role == "user":
        con.execute("UPDATE assistant_conversations SET title=? WHERE id=? AND (title IS NULL OR title='')",
                    (_title_of(content), cid))
    extra = con.execute("SELECT id FROM assistant_messages WHERE conv_id=? ORDER BY id DESC LIMIT -1 OFFSET ?",
                        (cid, MAX_MESSAGES)).fetchall()
    if extra:
        con.execute(f"DELETE FROM assistant_messages WHERE id IN ({','.join('?' * len(extra))})",
                    [e[0] for e in extra])
    return cur.lastrowid


def append(uid: str, cid: str, messages: list, now: float | None = None) -> list[int]:
    """Messages the client made itself (a form's proposal, a spoken exchange)."""
    now = now or time.time()
    ids = []
    with A._db_lock:
        con = _con()
        try:
            _own(con, uid, cid)
            for m in (messages or [])[:4]:
                if not isinstance(m, dict) or m.get("role") not in ("user", "assistant"):
                    continue
                ids.append(_insert(con, uid, cid, m["role"], m.get("content") or "", m.get("meta") or m,
                                   None, now))
            con.commit()
        finally:
            con.close()
    return ids


def begin_turn(uid: str, cid: str, turn_id: str, text: str, now: float | None = None) -> int | None:
    """Store the user's message once per turn (a retry sends the same turn_id)."""
    now = now or time.time()
    with A._db_lock:
        con = _con()
        try:
            _own(con, uid, cid)
            r = con.execute("SELECT id FROM assistant_messages WHERE conv_id=? AND turn_id=? AND role='user'",
                            (cid, turn_id)).fetchone()
            if r:
                return r[0]
            if not text:
                return None
            mid = _insert(con, uid, cid, "user", text, {}, turn_id, now)
            con.commit()
            return mid
        finally:
            con.close()


def finish_turn(uid: str, cid: str, turn_id: str, out: dict, mode: str | None = None, skipped=None,
                now: float | None = None) -> int | None:
    """Store the answer, unless the user stopped this turn first (its "Stopped." is the answer)."""
    now = now or time.time()
    meta = {"citations": out.get("citations") or [], "actions": out.get("actions") or [],
            "proposals": [{**p, "state": "pending"} for p in out.get("proposals") or []],
            "ask": out.get("ask"), "forms": bool(out.get("forms")), "refused": bool(out.get("refused")),
            "step": (out.get("onboarding") or {}).get("step"), "chips": (out.get("onboarding") or {}).get("chips"),
            "path": out.get("path"), "stopped": bool(out.get("stopped"))}
    with A._db_lock:
        con = _con()
        try:
            _own(con, uid, cid)
            if turn_id and con.execute("SELECT 1 FROM assistant_messages WHERE conv_id=? AND turn_id=? AND role='assistant'",
                                       (cid, turn_id)).fetchone():
                return None
            mid = _insert(con, uid, cid, "assistant", out.get("reply") or "", meta, turn_id, now)
            if mode in ("chat", "onboarding", "theater"):
                con.execute("UPDATE assistant_conversations SET mode=? WHERE id=?", (mode, cid))
            if isinstance(skipped, list):
                con.execute("UPDATE assistant_conversations SET skipped=? WHERE id=?", (json.dumps(skipped[:10]), cid))
            con.commit()
            return mid
        finally:
            con.close()


def mark_stopped(uid: str, cid: str, turn_id: str, now: float | None = None) -> int | None:
    """The user pressed Stop: "Stopped." becomes the turn's answer; a late answer is not kept."""
    return finish_turn(uid, cid, turn_id, {"reply": "Stopped.", "stopped": True}, now=now) if turn_id else None


DRAFT_KEYS = ("short", "long", "state", "post_id")


def set_draft(uid: str, cid: str, mid: int, patch: dict) -> dict:
    """A post draft's edited text and whether it went to the Desk."""
    with A._db_lock:
        con = _con()
        try:
            _own(con, uid, cid)
            r = con.execute("SELECT meta FROM assistant_messages WHERE id=? AND conv_id=? AND uid=?",
                            (int(mid), cid, str(uid))).fetchone()
            if not r:
                raise NotFound("message not found")
            meta = json.loads(r[0] or "{}")
            if not isinstance(meta.get("draft"), dict):
                raise NotFound("no draft on that message")
            for k in DRAFT_KEYS:
                if k in (patch or {}):
                    meta["draft"][k] = str(patch[k])[:MAX_CONTENT] if patch[k] is not None else None
            con.execute("UPDATE assistant_messages SET meta=? WHERE id=?", (json.dumps(meta, ensure_ascii=False), int(mid)))
            con.commit()
        finally:
            con.close()
    return {"ok": True}


def set_proposal_state(uid: str, cid: str, mid: int, token: str, state: str, why: str | None = None) -> dict:
    if state not in PROPOSAL_STATES:
        raise ValueError("state must be one of " + ", ".join(PROPOSAL_STATES))
    with A._db_lock:
        con = _con()
        try:
            _own(con, uid, cid)
            r = con.execute("SELECT meta FROM assistant_messages WHERE id=? AND conv_id=? AND uid=?",
                            (int(mid), cid, str(uid))).fetchone()
            if not r:
                raise NotFound("message not found")
            meta = json.loads(r[0] or "{}")
            hit = False
            for p in meta.get("proposals") or []:
                if p.get("token") == token:
                    p["state"] = state
                    if why:
                        p["why"] = str(why)[:200]
                    hit = True
            if not hit:
                raise NotFound("proposal not found")
            con.execute("UPDATE assistant_messages SET meta=? WHERE id=?", (json.dumps(meta, ensure_ascii=False), int(mid)))
            con.commit()
        finally:
            con.close()
    return {"ok": True}
