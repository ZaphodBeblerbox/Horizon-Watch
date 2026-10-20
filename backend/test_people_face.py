"""Chat and desk responses carry faces, not whole profiles (2026-10-19:
/api/chat/conversations was 2.4 MB and /api/desk/posts 2.0 MB in production,
a ~370 KB cover picture once per member and per post)."""
import base64
import datetime as dt
import json
from contextlib import contextmanager

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import database
import people_face
from routers import chat, desk

PIC = "data:image/png;base64," + base64.b64encode(b"\x89PNG fake picture").decode()
COVER = "data:image/jpeg;base64," + "A" * 300_000


@pytest.fixture
def client(tmp_path, monkeypatch):
    eng = create_engine(f"sqlite:///{tmp_path / 't.db'}", connect_args={"check_same_thread": False})
    database.Base.metadata.create_all(eng, tables=[database.Base.metadata.tables[t] for t in (
        "users", "conversations", "conversation_members", "chat_messages", "posts", "post_acks", "desk_members", "desk_reads")])
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
        for i, uid in enumerate(("ana", "ben", "cem")):
            db.add(database.User(id=uid, email=f"{uid}@t.local", name=uid.title() + " X", password_hash="-", approved=True,
                                 company="Trifecta", avatar=PIC, cover=COVER, bio="b" * 900, created_at=t0 + dt.timedelta(minutes=i)))
        db.commit()

    def me_of(request):
        people_face.set_base_from(request)
        uid = request.headers.get("x-test-user")
        if not uid:
            raise HTTPException(401, "no")
        with get_db() as db:
            u = db.get(database.User, uid)
            return {"id": u.id, "name": u.name, "email": u.email, "company": u.company, "role": u.role}
    monkeypatch.setattr(chat, "_me", me_of)
    monkeypatch.setattr(desk, "_me", lambda r: desk.desk_identity(me_of(r)))
    monkeypatch.setattr("inbox_notify.SEND", None)

    app = FastAPI()
    app.include_router(chat.router)
    app.include_router(desk.router)
    return TestClient(app)


H = lambda u: {"x-test-user": u}  # noqa: E731


def test_lists_carry_a_face_with_the_picture_as_a_url(client):
    c = client.post("/api/chat/conversations", json={"kind": "group", "user_ids": ["ben", "cem"], "title": "Ops"}, headers=H("ana")).json()
    for i in range(5):
        client.post(f"/api/chat/conversations/{c['id']}/messages", json={"body": f"m{i}"}, headers=H("ben"))
        client.post("/api/desk/posts", json={"body": f"p{i}"}, headers=H("ben"))
    for path in ("/api/chat/conversations", f"/api/chat/conversations/{c['id']}/messages", "/api/desk/posts", "/api/chat/people"):
        r = client.get(path, headers=H("ana"))
        assert r.status_code == 200, path
        body = r.text
        assert "cover" not in body and "bbbbbbbb" not in body and "base64" not in body, path
        assert len(body) < 20_000, (path, len(body))
    m = client.get("/api/chat/conversations", headers=H("ana")).json()[0]["members"][0]
    assert set(people_face.FACE_FIELDS) <= set(m)
    assert m["avatar"].startswith("http://testserver/api/chat/avatar/")
    # the URL serves the picture, cacheable; a wrong key does not
    img = client.get(m["avatar"].replace("http://testserver", ""))
    assert img.status_code == 200 and img.content == b"\x89PNG fake picture" and img.headers["content-type"] == "image/png"
    assert "immutable" in img.headers["cache-control"]
    assert client.get(f"/api/chat/avatar/{m['id']}/nottherightkey").status_code == 404


def test_the_card_gets_the_whole_page_when_opened(client):
    d = client.get("/api/chat/profile/ben", headers=H("ana")).json()
    assert d["cover"] == COVER and d["bio"].startswith("bbb") and d["name"] == "Ben X"
    assert client.get("/api/chat/profile/nobody", headers=H("ana")).status_code == 404


def test_unread_is_counted_in_one_query_per_request_and_from_when_you_joined(client):
    c = client.post("/api/chat/conversations", json={"kind": "group", "user_ids": ["ben"], "title": "G"}, headers=H("ana")).json()
    client.post(f"/api/chat/conversations/{c['id']}/messages", json={"body": "before cem"}, headers=H("ana"))
    client.post(f"/api/chat/conversations/{c['id']}/members", json={"user_ids": ["cem"]}, headers=H("ana"))
    client.post(f"/api/chat/conversations/{c['id']}/messages", json={"body": "after cem"}, headers=H("ana"))
    assert client.get("/api/chat/unread", headers=H("ben")).json()["unread"] == 2
    assert client.get("/api/chat/unread", headers=H("cem")).json()["unread"] == 1     # not the history before joining
    assert client.get("/api/chat/unread", headers=H("ana")).json()["unread"] == 0
    with database.get_db() as db:
        assert chat.unread_counts(db, "ben") == {c["id"]: 2}
