"""Who is typing in a chat, and how far the others have read.

The owner, 2026-10-17: "On X, if people type in the DMs, it should show a
typing indicator." The claim lives in memory with a TTL (routers/chat.py,
note_typing); these pin that it expires on its own, never shows you your
own dots, is cleared by sending, and is refused to anybody without a seat.
"""
import datetime as dt
from contextlib import contextmanager

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import database
from routers import chat


@pytest.fixture(autouse=True)
def clean_typing():
    chat._typing.clear()
    yield
    chat._typing.clear()


# ── the store, pure ───────────────────────────────────────────────────────

def test_typing_expires_on_its_own():
    chat.note_typing("c1", "ana", "Ana", now=100.0)
    assert chat.typing_in("c1", now=100.0 + chat.TYPING_TTL_S - 0.1) == [{"id": "ana", "name": "Ana"}]
    assert chat.typing_in("c1", now=100.0 + chat.TYPING_TTL_S + 0.1) == []


def test_you_never_see_your_own_dots():
    chat.note_typing("c1", "ana", "Ana", now=0)
    chat.note_typing("c1", "ben", "Ben", now=0)
    assert [p["id"] for p in chat.typing_in("c1", exclude="ana", now=1)] == ["ben"]


def test_stopping_clears_and_empty_conversations_are_dropped():
    chat.note_typing("c1", "ana", "Ana", now=0)
    chat.note_typing("c1", "ana", "", on=False, now=1)
    assert chat.typing_in("c1", now=1) == []
    assert "c1" not in chat._typing          # nothing left behind per conversation


def test_a_ping_extends_the_claim():
    chat.note_typing("c1", "ana", "Ana", now=0)
    chat.note_typing("c1", "ana", "Ana", now=4)
    assert chat.typing_in("c1", now=chat.TYPING_TTL_S + 1)    # still within 4 + TTL


# ── the endpoints, on a throwaway database ────────────────────────────────

@pytest.fixture
def client(tmp_path, monkeypatch):
    eng = create_engine(f"sqlite:///{tmp_path / 't.db'}", connect_args={"check_same_thread": False})
    tables = [database.Base.metadata.tables[t] for t in
              ("users", "conversations", "conversation_members", "chat_messages")]
    database.Base.metadata.create_all(eng, tables=tables)
    Session = sessionmaker(bind=eng)

    @contextmanager
    def get_db():
        s = Session()
        try:
            yield s
        finally:
            s.close()
    monkeypatch.setattr(database, "get_db", get_db)

    def me(request):
        uid = request.headers.get("x-test-user")
        if not uid:
            raise HTTPException(401, "authentication required")
        return {"id": uid, "name": uid.title(), "email": f"{uid}@test.local"}
    monkeypatch.setattr(chat, "_me", me)
    # The sender's display fields come from main._user_to_dict; the router
    # alone does not need them for what is tested here.
    monkeypatch.setattr(chat, "_people", lambda db, ids: {i: {"id": i, "name": i.title()} for i in set(ids) if i})

    with get_db() as db:
        c = database.Conversation(id="conv", kind="direct", created_by="ana")
        db.add(c)
        db.add(database.ConversationMember(conversation_id="conv", user_id="ana"))
        db.add(database.ConversationMember(conversation_id="conv", user_id="ben"))
        db.commit()

    app = FastAPI()
    app.include_router(chat.router)
    return TestClient(app)


def _as(user):
    return {"x-test-user": user}


def test_typing_reaches_the_other_person_not_the_typist(client):
    assert client.post("/api/chat/conversations/conv/typing", headers=_as("ana")).status_code == 200
    assert client.get("/api/chat/conversations/conv/typing", headers=_as("ben")).json()["typing"] == [{"id": "ana", "name": "Ana"}]
    assert client.get("/api/chat/conversations/conv/typing", headers=_as("ana")).json()["typing"] == []
    # and it rides on the message poll too
    assert client.get("/api/chat/conversations/conv/messages", headers=_as("ben")).json()["typing"][0]["id"] == "ana"


def test_typing_false_stops_it(client):
    client.post("/api/chat/conversations/conv/typing", headers=_as("ana"))
    client.post("/api/chat/conversations/conv/typing", json={"typing": False}, headers=_as("ana"))
    assert client.get("/api/chat/conversations/conv/typing", headers=_as("ben")).json()["typing"] == []


def test_sending_clears_the_dots(client):
    client.post("/api/chat/conversations/conv/typing", headers=_as("ana"))
    r = client.post("/api/chat/conversations/conv/messages", json={"body": "hello"}, headers=_as("ana"))
    assert r.status_code == 200, r.text
    assert client.get("/api/chat/conversations/conv/typing", headers=_as("ben")).json()["typing"] == []


def test_a_stranger_can_neither_type_nor_watch(client):
    assert client.post("/api/chat/conversations/conv/typing", headers=_as("eve")).status_code == 404
    assert client.get("/api/chat/conversations/conv/typing", headers=_as("eve")).status_code == 404
    assert chat.typing_in("conv") == []
    assert client.post("/api/chat/conversations/conv/typing").status_code == 401


def test_read_at_is_the_others_last_read(client):
    # ben has never opened it: nothing is read yet
    assert client.get("/api/chat/conversations/conv/typing", headers=_as("ana")).json()["read_at"] is None
    client.post("/api/chat/conversations/conv/read", headers=_as("ben"))
    got = client.get("/api/chat/conversations/conv/typing", headers=_as("ana")).json()["read_at"]
    assert got and abs(dt.datetime.fromisoformat(got) - dt.datetime.utcnow()) < dt.timedelta(minutes=1)
