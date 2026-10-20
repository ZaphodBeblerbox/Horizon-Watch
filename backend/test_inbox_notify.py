"""Messages and the desk: who gets notified, what is unread, and who may
change who is in a group or on a company desk (owner, 2026-10-19).

  - a message notifies the other people in the chat, never the sender, and
    stops being a notification once read;
  - a desk post notifies the people who can read it, never its author; a
    reply only the people in that thread;
  - the push goes to those people only, once, with who/what/where;
  - a group's admins add and remove, anybody leaves; a company desk's owner
    and admins add and remove, and a removed member loses access at once.
"""
import datetime as dt
import sqlite3
from contextlib import contextmanager

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import database
import event_watch as ew
import inbox_notify as inb
from routers import chat, desk

TABLES = ("users", "conversations", "conversation_members", "chat_messages", "posts", "post_acks",
          "desk_members", "desk_reads", "push_subscriptions")

PEOPLE = [  # id, name, company, role — ana's account is the oldest: she owns the Trifecta desk
    ("ana", "Ana Ruiz", "Trifecta Technologies", "analyst"),
    ("ben", "Ben Okafor", "trifecta  technologies", "observer"),
    ("dev", "Dev Shah", None, "observer"),
    ("cem", "Cem Yilmaz", "Acme Logistics", "observer"),
    ("eve", "Eve Admin", "Trifecta Technologies", "admin"),
]


@pytest.fixture
def env(tmp_path, monkeypatch):
    eng = create_engine(f"sqlite:///{tmp_path / 't.db'}", connect_args={"check_same_thread": False})
    database.Base.metadata.create_all(eng, tables=[database.Base.metadata.tables[t] for t in TABLES])
    Session = sessionmaker(bind=eng)

    @contextmanager
    def get_db():
        s = Session()
        try:
            yield s
        finally:
            s.close()
    monkeypatch.setattr(database, "get_db", get_db)

    t0 = dt.datetime.utcnow() - dt.timedelta(days=1)
    with get_db() as db:
        for i, (uid, name, co, role) in enumerate(PEOPLE):
            db.add(database.User(id=uid, email=f"{uid}@test.local", name=name, password_hash="-",
                                 company=co, role=role, approved=True, created_at=t0 + dt.timedelta(minutes=i)))
        db.commit()

    def me_of(request):
        uid = request.headers.get("x-test-user")
        if not uid:
            raise HTTPException(401, "authentication required")
        with get_db() as db:
            u = db.query(database.User).filter(database.User.id == uid).first()
            return {"id": u.id, "name": u.name, "email": u.email, "company": u.company,
                    "role": u.role, "is_super_admin": bool(u.is_super_admin)}
    monkeypatch.setattr(chat, "_me", me_of)
    monkeypatch.setattr(desk, "_me", lambda r: desk.desk_identity(me_of(r)))
    people = lambda db, ids: {i: {"id": i, "name": i.title(), "company": None} for i in set(ids) if i}  # noqa: E731
    monkeypatch.setattr(chat, "_people", people)
    monkeypatch.setattr(desk, "_people", people)

    # the push ledger and the sender, in the test's own files
    ledger = tmp_path / "pushes.db"
    monkeypatch.setattr(ew, "_push_con", lambda: _ledger(ledger))
    sent = []
    monkeypatch.setattr(inb, "SEND", lambda uid, title, body, data: sent.append((uid, title, body, data)))
    monkeypatch.setattr(inb, "SYNC", True)

    app = FastAPI()
    app.include_router(chat.router)
    app.include_router(desk.router)
    return {"client": TestClient(app), "db": get_db, "sent": sent}


def _ledger(path):
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE IF NOT EXISTS event_pushes (user_id TEXT NOT NULL, item_id TEXT NOT NULL,"
                " sent_at TEXT, PRIMARY KEY (user_id, item_id))")
    return con


def _as(u):
    return {"x-test-user": u}


def _subscribe(env, *uids):
    with env["db"]() as db:
        for u in uids:
            db.add(database.PushSubscription(user_id=u, endpoint=f"https://push.example/{u}", subscription="{}"))
        db.commit()


def _cards(env, uid, kind=None):
    with env["db"]() as db:
        out = inb.chat_cards(db, uid) + inb.desk_cards(db, uid)
    return [c for c in out if not kind or c["kind"] == kind]


def _direct(env, a="ana", b="ben"):
    r = env["client"].post("/api/chat/conversations", json={"kind": "direct", "user_ids": [b]}, headers=_as(a))
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _group(env, by="ana", members=("ben", "dev")):
    r = env["client"].post("/api/chat/conversations", json={"kind": "group", "user_ids": list(members), "title": "Ops"},
                           headers=_as(by))
    assert r.status_code == 200, r.text
    return r.json()["id"]


# ── chat notifications ───────────────────────────────────────────────────

def test_a_message_notifies_the_recipient_with_context_never_the_sender(env):
    cid = _direct(env)
    env["client"].post(f"/api/chat/conversations/{cid}/messages", json={"body": "Are you near the port?"}, headers=_as("ana"))
    [card] = _cards(env, "ben", "message")
    assert card["title"] == "Ana Ruiz: Are you near the port?"
    assert card["conversation_id"] == cid and card["push_title"] == "Ana Ruiz"
    assert card["created_at"].endswith("Z")
    assert ew.notifies(card, None)                            # the one rule says it interrupts
    assert _cards(env, "ana", "message") == []                 # never your own message


def test_reading_the_chat_ends_the_notification_and_the_unread_count(env):
    cid = _direct(env)
    c = env["client"]
    c.post(f"/api/chat/conversations/{cid}/messages", json={"body": "one"}, headers=_as("ana"))
    c.post(f"/api/chat/conversations/{cid}/messages", json={"body": "two"}, headers=_as("ana"))
    [card] = _cards(env, "ben", "message")
    assert card["unread"] == 2 and card["title"].endswith("two")
    assert c.get("/api/chat/unread", headers=_as("ben")).json()["unread"] == 2
    c.post(f"/api/chat/conversations/{cid}/read", headers=_as("ben"))
    assert _cards(env, "ben", "message") == []
    assert c.get("/api/chat/unread", headers=_as("ben")).json()["unread"] == 0


def test_a_group_message_says_which_group_and_skips_muted_seats(env):
    gid = _group(env)
    with env["db"]() as db:
        db.query(database.ConversationMember).filter_by(conversation_id=gid, user_id="dev").update({"muted": True})
        db.commit()
    env["client"].post(f"/api/chat/conversations/{gid}/messages", json={"body": "brief at 6"}, headers=_as("ben"))
    [card] = _cards(env, "ana", "message")
    assert card["title"] == "Ben Okafor in Ops: brief at 6" and card["push_title"] == "Ben Okafor · Ops"
    assert _cards(env, "dev", "message") == []                 # muted
    assert _cards(env, "cem", "message") == []                 # not in it


def test_the_push_goes_to_the_recipient_once_with_where_to_open(env):
    _subscribe(env, "ana", "ben", "cem")
    cid = _direct(env)
    env["client"].post(f"/api/chat/conversations/{cid}/messages", json={"body": "Call me"}, headers=_as("ana"))
    assert [(u, t, b) for u, t, b, _ in env["sent"]] == [("ben", "Ana Ruiz", "Call me")]
    data = env["sent"][0][3]
    assert data["kind"] == "message" and data["conversation_id"] == cid
    # the sweep finds the same card in ben's feed and does not push it again
    with env["db"]() as db:
        cards = inb.chat_cards(db, "ben")
    assert inb._push("ben", cards) == 0 and len(env["sent"]) == 1


# ── group membership ─────────────────────────────────────────────────────

def test_only_a_group_admin_adds_or_removes_and_anybody_leaves(env):
    gid = _group(env)                                           # ana created it: admin
    c = env["client"]
    assert c.post(f"/api/chat/conversations/{gid}/members", json={"user_ids": ["eve"]}, headers=_as("ben")).status_code == 403
    assert c.delete(f"/api/chat/conversations/{gid}/members/dev", headers=_as("ben")).status_code == 403
    r = c.post(f"/api/chat/conversations/{gid}/members", json={"user_ids": ["eve"]}, headers=_as("ana"))
    assert r.status_code == 200 and {m["id"] for m in r.json()["members"]} == {"ana", "ben", "dev", "eve"}
    assert c.delete(f"/api/chat/conversations/{gid}/members/dev", headers=_as("ana")).status_code == 200
    assert c.delete(f"/api/chat/conversations/{gid}/members/ben", headers=_as("ben")).status_code == 200   # leaving
    # gone at once: no thread, no notifications
    assert c.get(f"/api/chat/conversations/{gid}/messages", headers=_as("dev")).status_code == 404
    c.post(f"/api/chat/conversations/{gid}/messages", json={"body": "after"}, headers=_as("ana"))
    assert _cards(env, "dev", "message") == [] and _cards(env, "ben", "message") == []
    assert len(_cards(env, "eve", "message")) == 1


def test_admins_can_be_made_and_the_last_one_stays(env):
    gid = _group(env)
    c = env["client"]
    assert c.put(f"/api/chat/conversations/{gid}/members/ana", json={"role": "member"}, headers=_as("ana")).status_code == 400
    r = c.put(f"/api/chat/conversations/{gid}/members/ben", json={"role": "admin"}, headers=_as("ana"))
    assert r.status_code == 200
    assert {m["id"]: m["role"] for m in r.json()["members"]}["ben"] == "admin"
    assert c.post(f"/api/chat/conversations/{gid}/members", json={"user_ids": ["eve"]}, headers=_as("ben")).status_code == 200
    assert c.put(f"/api/chat/conversations/{gid}/members/ana", json={"role": "member"}, headers=_as("dev")).status_code == 403


def test_a_direct_chat_has_no_members_to_edit(env):
    cid = _direct(env)
    assert env["client"].post(f"/api/chat/conversations/{cid}/members", json={"user_ids": ["dev"]},
                              headers=_as("ana")).status_code == 400


# ── desk notifications and unread ────────────────────────────────────────

def _post(env, who, body, **kw):
    r = env["client"].post("/api/desk/posts", json={"body": body, **kw}, headers=_as(who))
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_a_company_post_notifies_its_company_never_its_author(env):
    pid = _post(env, "ana", "Tanker dark off Fujairah", theater="Hormuz")
    [card] = _cards(env, "ben", "desk")
    assert card["title"] == "Ana Ruiz: Tanker dark off Fujairah" and card["post_id"] == pid
    assert "Hormuz" in card["reason"] and card["push_title"] == "Ana Ruiz on the Desk"
    assert _cards(env, "ana", "desk") == []
    assert _cards(env, "cem", "desk") == []                    # another company
    c = env["client"]
    assert c.get("/api/desk/unread", headers=_as("ben")).json()["unread"] == 1
    assert c.get("/api/desk/unread", headers=_as("cem")).json()["unread"] == 0
    c.post("/api/desk/read", headers=_as("ben"))
    assert c.get("/api/desk/unread", headers=_as("ben")).json()["unread"] == 0
    assert _cards(env, "ben", "desk") == []


def test_a_reply_notifies_the_thread_not_the_whole_desk(env):
    pid = _post(env, "ana", "Convoy forming")
    for u in ("ana", "ben", "eve"):
        env["client"].post("/api/desk/read", headers=_as(u))
    _post(env, "ben", "I have the ADS-B", parent_id=pid)
    [card] = _cards(env, "ana", "desk")
    assert card["title"].startswith("Ben Okafor replied to your post") and card["post_id"] == pid
    assert _cards(env, "eve", "desk") == []                    # not in that thread


def test_an_urgent_post_is_urgent_and_pushes_only_to_readers(env):
    _subscribe(env, "ben", "cem", "ana")
    _post(env, "ana", "Shots fired at the gate", urgency="critical")
    assert [u for u, *_ in env["sent"]] == ["ben"]
    assert env["sent"][0][3]["severity"] == "critical" and env["sent"][0][3]["post_id"]


def test_everyone_posts_reach_other_companies(env):
    _post(env, "ana", "Port closed", audience="everyone")
    assert len(_cards(env, "cem", "desk")) == 1


# ── company desk membership ─────────────────────────────────────────────

def test_the_owner_and_admins_manage_the_desk_and_nobody_else(env):
    c = env["client"]
    d = c.get("/api/desk/members", headers=_as("ana")).json()
    assert d["can_manage"] and [m["id"] for m in d["members"]] == ["ana", "ben", "eve"]
    assert d["members"][0]["owner"]
    assert not c.get("/api/desk/members", headers=_as("ben")).json()["can_manage"]
    assert c.get("/api/desk/members", headers=_as("eve")).json()["can_manage"]          # role admin
    assert c.post("/api/desk/members", json={"user_ids": ["dev"]}, headers=_as("ben")).status_code == 403
    assert c.delete("/api/desk/members/eve", headers=_as("ben")).status_code == 403
    assert c.delete("/api/desk/members/ana", headers=_as("eve")).status_code == 403      # the owner stays
    assert c.delete("/api/desk/members/ana", headers=_as("ana")).status_code == 400      # not yourself


def test_a_removed_member_loses_the_desk_at_once_and_cannot_type_their_way_back(env):
    c = env["client"]
    pid = _post(env, "ana", "Company only")
    r = c.delete("/api/desk/members/ben", headers=_as("ana"))
    assert r.status_code == 200 and "ben" not in [m["id"] for m in r.json()["members"]]
    assert c.get("/api/desk/posts", headers=_as("ben")).json()["posts"] == []
    assert c.get(f"/api/desk/posts/{pid}/replies", headers=_as("ben")).status_code == 404
    assert _cards(env, "ben", "desk") == []
    # their profile no longer claims it; typing it back in changes nothing
    with env["db"]() as db:
        u = db.get(database.User, "ben")
        assert u.company is None
        u.company = "Trifecta Technologies"
        db.commit()
    assert c.get("/api/desk/posts", headers=_as("ben")).json()["posts"] == []
    assert c.post("/api/desk/posts", json={"body": "x", "audience": "company"}, headers=_as("ben")).status_code == 403
    # added back by a manager: in again
    assert c.post("/api/desk/members", json={"user_ids": ["ben"]}, headers=_as("eve")).status_code == 200
    assert [p["id"] for p in c.get("/api/desk/posts", headers=_as("ben")).json()["posts"]] == [pid]


def test_adding_someone_puts_them_on_the_desk_but_never_pulls_from_another(env):
    c = env["client"]
    pid = _post(env, "ana", "Company only")
    r = c.post("/api/desk/members", json={"user_ids": ["dev"]}, headers=_as("ana"))
    assert r.status_code == 200 and "dev" in [m["id"] for m in r.json()["members"]]
    with env["db"]() as db:
        assert db.get(database.User, "dev").company == "Trifecta Technologies"
    assert [p["id"] for p in c.get("/api/desk/posts", headers=_as("dev")).json()["posts"]] == [pid]
    r = c.post("/api/desk/members", json={"user_ids": ["cem"]}, headers=_as("ana"))
    assert r.status_code == 409 and "Acme Logistics" in r.json()["detail"]


# ── what a closed app shows ─────────────────────────────────────────────

def test_the_push_title_and_body_are_the_cards_own():
    card = {"id": "msg:1", "kind": "message", "title": "Ana: hi", "reason": "Message · Direct message",
            "push_title": "Ana", "push_body": "hi", "conversation_id": "c1", "created_at": "2026-10-19T10:00:00Z"}
    [(title, body, data)] = ew.bundle([card])
    assert (title, body) == ("Ana", "hi") and data["conversation_id"] == "c1"
    assert ew.label_for({"kind": "desk"}) == "On the Desk"
