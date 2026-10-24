"""Comments on a General item's full view (routers/desk.py): Post rows under "item:<id>", read by the author's
audience, never in the feed, never announced as desk posts."""
import asyncio
import contextlib
import datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import database
from database import Post, User
from routers import desk

ANA = {"id": "ana", "company": "Trifecta"}
BEN = {"id": "ben", "company": "trifecta"}
CEM = {"id": "cem", "company": "Acme"}


@pytest.fixture
def db(monkeypatch):
    eng = create_engine("sqlite://")
    Post.__table__.create(eng)
    User.__table__.create(eng)
    for t in ("post_acks",):
        if t in database.Base.metadata.tables:
            database.Base.metadata.tables[t].create(eng)
    s = sessionmaker(bind=eng)()
    for u in (ANA, BEN, CEM):
        s.add(User(id=u["id"], email=f"{u['id']}@x", password_hash="-", company=u["company"]))
    s.commit()

    @contextlib.contextmanager
    def get_db():
        yield s
    monkeypatch.setattr(database, "get_db", get_db)
    monkeypatch.setattr(desk, "_people", lambda db, ids: {i: {"id": i, "name": i} for i in ids})
    yield s
    s.close()


class Req:
    def __init__(self, body=None):
        self._body = body or {}

    async def json(self):
        return self._body


def as_user(monkeypatch, u):
    monkeypatch.setattr(desk, "_me", lambda request: u)


def test_comment_is_read_by_the_company_only(db, monkeypatch):
    as_user(monkeypatch, ANA)
    c = asyncio.run(desk.add_item_comment(Req({"key": "rybar/1234", "body": "Seen the same video elsewhere"})))
    assert c["body"] == "Seen the same video elsewhere" and c["parent_id"] == "item:rybar/1234"
    as_user(monkeypatch, BEN)
    assert [x["id"] for x in desk.list_item_comments("rybar/1234", None)["comments"]] == [c["id"]]
    as_user(monkeypatch, CEM)
    assert desk.list_item_comments("rybar/1234", None)["comments"] == []


def test_comments_stay_out_of_the_feed_and_the_unread_count(db, monkeypatch):
    as_user(monkeypatch, ANA)
    asyncio.run(desk.add_item_comment(Req({"key": "gc:77", "body": "Confirmed by a second angle"})))
    as_user(monkeypatch, BEN)
    assert desk.list_posts(None, limit=40)["posts"] == []
    since = datetime.datetime.utcnow() - datetime.timedelta(hours=1)
    assert desk.unseen_posts(db, BEN, since) == []


def test_bad_keys_and_empty_bodies_are_refused(db, monkeypatch):
    as_user(monkeypatch, ANA)
    with pytest.raises(HTTPException):
        asyncio.run(desk.add_item_comment(Req({"key": "x y", "body": "hi"})))
    with pytest.raises(HTTPException):
        asyncio.run(desk.add_item_comment(Req({"key": "gc:1", "body": "   "})))
    with pytest.raises(HTTPException):
        desk.list_item_comments("<script>", None)


def test_a_reply_to_an_item_comment_is_refused_not_a_crash(db, monkeypatch):
    as_user(monkeypatch, ANA)
    c = asyncio.run(desk.add_item_comment(Req({"key": "gc:5", "body": "first"})))
    with pytest.raises(HTTPException) as e:
        asyncio.run(desk.create_post(Req({"body": "second", "parent_id": c["id"]})))
    assert e.value.status_code == 400
