"""inbox_notify.py — a message for you, and something new on your desk.

The owner, 2026-10-19: "I want a notification when someone sends me a
message" and "when someone sends a new message on the desk".

ONE FEED, ONE RULE. These are cards in the notification feed
(main._notification_feed → /api/notifications), judged by the one rule
(event_watch.notifies) and pushed once per card through the same
event_pushes ledger as every other push (event_watch.sweep). So the phone,
the desktop window and the desktop app's closed-window notification all
get the same thing, and nothing is pushed twice.

PERSONAL, UNLIKE THE REST OF THE FEED. A card exists only for the person it
is for: a chat message for the other people in the conversation (never the
sender, never a muted seat), a desk post for the people who can read it
(routers/desk.unseen_posts — never the author). And only while it is
UNREAD: opening the conversation or the desk is what makes the card go,
because the server's own last-read timestamp is what builds it.

NOW, NOT AT THE NEXT SWEEP. The sweep runs once a minute; a message that
arrives a minute late arrives after the reply it was waiting for. So the
send itself pushes (after_message / after_post) on a thread of its own,
writing the same ledger row the sweep would, so the sweep then skips it.
"""

from __future__ import annotations

import datetime as _dt
import sys
import threading

SNIPPET = 140
MAX_CHAT_CARDS = 20
MAX_DESK_CARDS = 15


def _now() -> _dt.datetime:
    return _dt.datetime.utcnow()


def _iso(d: _dt.datetime | None) -> str | None:
    # naive UTC in the database; said so, or a browser reads it as local time
    return d.strftime("%Y-%m-%dT%H:%M:%SZ") if d else None


def snippet(text: str | None, n: int = SNIPPET) -> str:
    t = " ".join(str(text or "").split())
    return t if len(t) <= n else t[: n - 1].rstrip() + "…"


def _name(u) -> str:
    return (getattr(u, "name", None) or getattr(u, "email", None) or "Someone").strip()


def _first(name: str) -> str:
    return (name or "Someone").split()[0]


# ── chat ─────────────────────────────────────────────────────────────────

def _message_text(m) -> str:
    import json
    if m.body:
        return snippet(m.body)
    att = {}
    try:
        att = json.loads(m.attachment_json or "{}") or {}
    except ValueError:
        pass
    if m.kind == "file":
        return f"sent a file: {att.get('name') or 'file'}"
    if m.kind == "case":
        return f"shared a case: {att.get('case_title') or 'a case'}"
    if m.kind == "signal":
        return "sent a signal"
    return "sent a message"


def chat_cards(db, uid: str, hours: int = 48) -> list[dict]:
    """One card per conversation with something unread from somebody else:
    the newest such message, with how many there are."""
    from database import ChatMessage, Conversation, ConversationMember, User
    seats = db.query(ConversationMember).filter(ConversationMember.user_id == uid).all()
    seats = [s for s in seats if not s.muted]
    if not seats:
        return []
    floor = _now() - _dt.timedelta(hours=max(1, hours))
    by_conv = {s.conversation_id: s for s in seats}
    rows = db.query(ChatMessage).filter(
        ChatMessage.conversation_id.in_(list(by_conv)),
        ChatMessage.sender_id != uid, ChatMessage.sender_id.isnot(None),
        ChatMessage.kind != "system", ChatMessage.deleted_at.is_(None),
        ChatMessage.created_at > floor).order_by(ChatMessage.created_at.desc()).limit(500).all()
    unread: dict = {}
    for m in rows:
        seat = by_conv[m.conversation_id]
        if seat.last_read_at and m.created_at <= seat.last_read_at:
            continue
        unread.setdefault(m.conversation_id, []).append(m)
    if not unread:
        return []
    convs = {c.id: c for c in db.query(Conversation).filter(Conversation.id.in_(list(unread))).all()}
    senders = {u.id: u for u in db.query(User).filter(
        User.id.in_({ms[0].sender_id for ms in unread.values()})).all()}
    cards = []
    for cid, ms in unread.items():
        m, c = ms[0], convs.get(cid)
        if not c:
            continue
        who = _name(senders.get(m.sender_id))
        text = _message_text(m)
        group = c.kind == "group"
        where = f"in {c.title or 'a group'}" if group else "direct message"
        more = f"{len(ms)} unread" if len(ms) > 1 else None
        cards.append({
            "id": f"msg:{m.id}", "kind": "message", "sev": "moderate",
            "title": f"{who}: {text}" if not group else f"{who} in {c.title or 'a group'}: {text}",
            "reason": " · ".join(x for x in ("Message", where if group else "Direct message", more) if x),
            "created_at": _iso(m.created_at),
            "conversation_id": cid, "message_id": m.id, "sender_id": m.sender_id,
            "sender_name": who, "unread": len(ms),
            # what a closed app shows: who and where as the title, the words under it
            "push_title": f"{who} · {c.title}" if group else who,
            "push_body": text if not more else f"{text}  ({more})",
        })
    cards.sort(key=lambda x: x["created_at"] or "", reverse=True)
    return cards[:MAX_CHAT_CARDS]


# ── desk ─────────────────────────────────────────────────────────────────

_URG = {"critical": "critical", "significant": "high", "high": "high"}


def _desk_me(db, user) -> dict:
    from routers import desk
    return desk.desk_identity({"id": user.id, "company": user.company}, db=db)


def desk_cards(db, uid: str, hours: int = 48) -> list[dict]:
    """A card per new desk post for me (routers/desk.unseen_posts)."""
    from database import Post, User
    from routers import desk
    u = db.query(User).filter(User.id == uid).first()
    if not u:
        return []
    me = _desk_me(db, u)
    since = max(desk.read_since(db, uid), _now() - _dt.timedelta(hours=max(1, hours)))
    rows = desk.unseen_posts(db, me, since, limit=MAX_DESK_CARDS)
    if not rows:
        return []
    authors = {a.id: a for a in db.query(User).filter(User.id.in_({p.author_user_id for p in rows})).all()}
    parents = {p.id: p for p in db.query(Post).filter(
        Post.id.in_({p.parent_id for p in rows if p.parent_id})).all()} if any(p.parent_id for p in rows) else {}
    cards = []
    for p in rows:
        who = _name(authors.get(p.author_user_id))
        text = snippet(p.body) or _attachment_text(p)
        if p.parent_id:
            par = parents.get(p.parent_id)
            yours = par is not None and par.author_user_id == uid
            ctx = "replied to your post" if yours else "replied in a thread you are in"
            title = f"{who} {ctx}: {text}"
            reason = " · ".join(x for x in ("Desk", snippet(par.body, 60) if par and par.body else None) if x)
        else:
            title = f"{who}: {text}"
            # who it went to: the company's desk (the reader's own, or they
            # could not read it), people named, or everyone
            to = {"company": u.company, "people": "shared with you"}.get(p.audience or "everyone", "everyone")
            reason = " · ".join(x for x in ("Desk", p.theater, to) if x)
        cards.append({
            "id": f"desk:{p.id}", "kind": "desk", "sev": _URG.get(p.urgency or "", "moderate"),
            "title": title, "reason": reason, "created_at": _iso(p.created_at),
            "post_id": p.parent_id or p.id, "reply_id": p.id if p.parent_id else None,
            "sender_id": p.author_user_id, "sender_name": who,
            "push_title": f"{who} on the Desk" if not p.parent_id else f"{who} replied on the Desk",
            "push_body": text,
        })
    return cards


def _attachment_text(p) -> str:
    import json
    try:
        att = json.loads(p.attachment_json or "{}") or {}
    except ValueError:
        att = {}
    k = att.get("kind")
    label = att.get("headline") or att.get("title") or att.get("name")
    if k == "file":
        return f"posted {('a picture' if str(att.get('mime') or '').startswith('image/') else 'a file')}"
    if k == "place":
        return f"posted a place: {att.get('name') or 'on the map'}"
    return f"posted {label}" if label else "posted something"


def cards_for(uid: str | None, hours: int = 48) -> list[dict]:
    """Every message and desk card for this person (the feed's source)."""
    if not uid:
        return []
    from database import get_db
    out = []
    with get_db() as db:
        for fn in (chat_cards, desk_cards):
            try:
                out += fn(db, str(uid), hours)
            except Exception as ex:                          # noqa: BLE001
                print(f"[inbox-notify] {fn.__name__} for {uid}: {type(ex).__name__}: {ex}", flush=True)
    return out


# ── pushed at once ───────────────────────────────────────────────────────

def _sender():
    """main._send_push, but only where main is the running app: in a test
    (or a script) nothing is sent."""
    m = sys.modules.get("main")
    return getattr(m, "_send_push", None) if m else None


SEND = None          # a test seam: fn(uid, title, body, data)
SYNC = False         # a test seam: push on the calling thread


def _push(uid: str, cards: list[dict], send=None) -> int:
    """Push these cards to this person once each, through the sweep's
    ledger (event_watch.event_pushes), so neither path repeats the other."""
    import event_watch as ew
    send = send or SEND or _sender()
    if not cards or not send:
        return 0
    c = None
    due = [x for x in cards if ew.notifies(x, c)]
    if not due:
        return 0
    con = ew._push_con()
    fresh = []
    try:
        now = _dt.datetime.now(_dt.timezone.utc)
        for x in due:
            cur = con.execute("INSERT OR IGNORE INTO event_pushes (user_id, item_id, sent_at) VALUES (?,?,?)",
                              (str(uid), x["id"], ew._iso(now)))
            if cur.rowcount:
                fresh.append(x)
        con.commit()
    finally:
        con.close()
    n = 0
    for title, body, data in ew.bundle(fresh):
        send(str(uid), title, body, data)
        n += 1
    return n


def _subscribed(db, uids) -> list[str]:
    from database import PushSubscription
    uids = [u for u in set(uids) if u]
    if not uids:
        return []
    return [r[0] for r in db.query(PushSubscription.user_id).filter(
        PushSubscription.user_id.in_(uids)).distinct().all()]


def message_recipients(db, conversation_id: str, sender_id: str) -> list[str]:
    from database import ConversationMember
    return [s.user_id for s in db.query(ConversationMember).filter(
        ConversationMember.conversation_id == conversation_id).all()
        if s.user_id != sender_id and not s.muted]


def push_message(conversation_id: str, message_id: str, send=None) -> int:
    from database import ChatMessage, get_db
    sent = 0
    with get_db() as db:
        m = db.query(ChatMessage).filter(ChatMessage.id == message_id).first()
        if not m:
            return 0
        for uid in _subscribed(db, message_recipients(db, conversation_id, m.sender_id)):
            cards = [c for c in chat_cards(db, uid, hours=1) if c["conversation_id"] == conversation_id]
            sent += _push(uid, cards, send)
    return sent


def post_recipients(db, post_id: str) -> list[str]:
    """Everybody who would get a card for this post (desk_cards' rule),
    among those with a device to push to."""
    from database import Post, PushSubscription, User
    from routers import desk
    p = db.query(Post).filter(Post.id == post_id).first()
    if not p:
        return []
    uids = [r[0] for r in db.query(PushSubscription.user_id).distinct().all() if r[0] != p.author_user_id]
    out = []
    for u in db.query(User).filter(User.id.in_(uids)).all() if uids else []:
        me = _desk_me(db, u)
        if p in desk.unseen_posts(db, me, p.created_at - _dt.timedelta(seconds=1), limit=50):
            out.append(u.id)
    return out


def push_post(post_id: str, send=None) -> int:
    from database import get_db
    sent = 0
    with get_db() as db:
        for uid in post_recipients(db, post_id):
            cards = [c for c in desk_cards(db, uid, hours=1) if c["id"] == f"desk:{post_id}"]
            sent += _push(uid, cards, send)
    return sent


def _spawn(fn, *args):
    if SYNC:
        return fn(*args)
    if not (SEND or _sender()):
        return 0

    def run():
        try:
            n = fn(*args)
            if n:
                print(f"[inbox-notify] pushed {n} ({fn.__name__})", flush=True)
        except Exception as ex:                              # noqa: BLE001
            print(f"[inbox-notify] {fn.__name__}: {type(ex).__name__}: {ex}", flush=True)
    threading.Thread(target=run, name="inbox-push", daemon=True).start()
    return None


def after_message(conversation_id: str, message_id: str):
    return _spawn(push_message, conversation_id, message_id)


def after_post(post_id: str):
    return _spawn(push_post, post_id)
