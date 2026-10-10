"""Desk audiences: your company by default, everyone or named people on
purpose, replies following their post, old posts still everyone's."""
import json

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Post, User
from routers import desk

ANA = {"id": "ana", "company": "Trifecta Technologies"}
BEN = {"id": "ben", "company": "  trifecta   technologies "}       # same firm, typed differently
CEM = {"id": "cem", "company": "Acme Logistics"}
DEV = {"id": "dev", "company": None}


@pytest.fixture
def db():
    eng = create_engine("sqlite://")
    Post.__table__.create(eng)
    User.__table__.create(eng)
    s = sessionmaker(bind=eng)()
    for u in (ANA, BEN, CEM, DEV):
        s.add(User(id=u["id"], email=f"{u['id']}@x", password_hash="-", company=u["company"]))
    s.commit()
    yield s
    s.close()


def _post(db, author, body, **audience):
    a, co, shared = desk._audience_of(db, {"body": body, **audience}, author)
    p = Post(id=body, author_user_id=author["id"], body=body, audience=a, audience_company=co, shared_with=shared)
    db.add(p); db.commit()
    return p


def _feed(db, me):
    return sorted(p.id for p in desk._readable(db.query(Post), me).all())


def test_company_by_default_and_the_firm_typed_two_ways_is_one(db):
    p = _post(db, ANA, "c1")
    assert p.audience == "company" and p.audience_company == "trifecta technologies"
    assert desk.can_read(p, BEN) and not desk.can_read(p, CEM)
    assert _feed(db, BEN) == ["c1"] and _feed(db, CEM) == []


def test_everyone_and_named_people(db):
    _post(db, ANA, "e1", audience="everyone")
    _post(db, ANA, "p1", audience="people", shared_with=["cem", "nobody"])
    assert _feed(db, CEM) == ["e1", "p1"]
    assert _feed(db, BEN) == ["e1"]                                   # same firm, not named
    assert json.loads(db.get(Post, "p1").shared_with) == ["cem"]      # unknown ids dropped


def test_posts_from_before_audiences_stay_everyones(db):
    db.add(Post(id="old", author_user_id="ana", body="old")); db.commit()
    assert _feed(db, CEM) == ["old"]


def test_no_company_means_choose(db):
    assert desk._audience_of(db, {"body": "x"}, DEV)[0] == "everyone"
    with pytest.raises(HTTPException):
        desk._audience_of(db, {"body": "x", "audience": "company"}, DEV)
    with pytest.raises(HTTPException):
        desk._audience_of(db, {"body": "x", "audience": "people", "shared_with": []}, ANA)


def test_a_hidden_post_is_simply_not_there(db):
    _post(db, ANA, "c2")
    with pytest.raises(HTTPException) as e:
        desk._visible_post(db, "c2", CEM)
    assert e.value.status_code == 404
    db.add(Post(id="r1", author_user_id="ben", body="reply", parent_id="c2")); db.commit()
    with pytest.raises(HTTPException):
        desk._visible_post(db, "r1", CEM)                              # nor its replies
    assert desk._visible_post(db, "r1", BEN).id == "r1"
