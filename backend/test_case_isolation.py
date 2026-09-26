"""One analyst's cases are not another's to read.

These tests exist because /api/cases used to return every case in the
database to anyone who asked. The boundary is ownership plus an explicit
CaseShare row — no team-wide flag, no role that implies read-everything —
and it is the kind of rule that quietly rots unless something fails when it
does.
"""
import importlib
import uuid

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def app_mod():
    return importlib.import_module("main")


@pytest.fixture
def users(app_mod):
    """Two real users, created directly so the test does not depend on the
    signup/approval flow it is not testing."""
    from database import User, get_db
    made = []
    with get_db() as db:
        for tag in ("alice", "bob"):
            u = User(id=str(uuid.uuid4()), email=f"{tag}-{uuid.uuid4().hex[:8]}@test.local",
                     password_hash="x", name=tag.title(), role="analyst", approved=True)
            db.add(u); made.append(u.id)
        db.commit()
    yield made
    with get_db() as db:
        from database import Case, CaseShare, CaseNode
        for uid in made:
            for cid in [c.case_id for c in db.query(Case).filter(Case.owner_user_id == uid).all()]:
                db.query(CaseNode).filter(CaseNode.case_id == cid).delete()
                db.query(CaseShare).filter(CaseShare.case_id == cid).delete()
                db.query(Case).filter(Case.case_id == cid).delete()
            db.query(CaseShare).filter(CaseShare.user_id == uid).delete()
            db.query(User).filter(User.id == uid).delete()
        db.commit()


def _client_as(app_mod, user_id):
    """A client carrying a real signed session cookie for that user."""
    from jose import jwt
    token = jwt.encode({"sub": user_id}, app_mod.JWT_SECRET, algorithm=app_mod.JWT_ALGORITHM)
    c = TestClient(app_mod.app)
    c.cookies.set("hw_session", token)
    return c


def _make_case(client, title):
    r = client.post("/api/cases", json={"title": title})
    assert r.status_code == 200, r.text
    return r.json()["case_id"]


def test_a_case_is_invisible_to_another_user(app_mod, users):
    alice, bob = users
    ca = _client_as(app_mod, alice)
    cb = _client_as(app_mod, bob)

    case_id = _make_case(ca, "Alice's case")

    assert case_id in [c["case_id"] for c in ca.get("/api/cases").json()]
    assert case_id not in [c["case_id"] for c in cb.get("/api/cases").json()]

    # 404, not 403: confirming it exists is itself a disclosure.
    assert cb.get(f"/api/cases/{case_id}").status_code == 404


def test_sharing_is_what_grants_access(app_mod, users):
    alice, bob = users
    ca, cb = _client_as(app_mod, alice), _client_as(app_mod, bob)
    case_id = _make_case(ca, "Shared case")

    assert cb.get(f"/api/cases/{case_id}").status_code == 404

    assert ca.post(f"/api/cases/{case_id}/shares",
                   json={"user_id": bob, "can_edit": False}).status_code == 200

    assert cb.get(f"/api/cases/{case_id}").status_code == 200
    assert case_id in [c["case_id"] for c in cb.get("/api/cases").json()]


def test_a_read_only_sharee_cannot_write(app_mod, users):
    alice, bob = users
    ca, cb = _client_as(app_mod, alice), _client_as(app_mod, bob)
    case_id = _make_case(ca, "Read-only case")
    ca.post(f"/api/cases/{case_id}/shares", json={"user_id": bob, "can_edit": False})

    r = cb.post(f"/api/cases/{case_id}/nodes", json={"kind": "folder", "name": "nope"})
    assert r.status_code == 403

    assert ca.post(f"/api/cases/{case_id}/nodes",
                   json={"kind": "folder", "name": "fine"}).status_code == 200


def test_only_the_owner_can_share(app_mod, users):
    alice, bob = users
    ca, cb = _client_as(app_mod, alice), _client_as(app_mod, bob)
    case_id = _make_case(ca, "Owner-only sharing")
    ca.post(f"/api/cases/{case_id}/shares", json={"user_id": bob, "can_edit": True})

    # Even with edit rights, a sharee re-sharing would make the owner's
    # list of who can see their work incomplete and wrong.
    r = cb.post(f"/api/cases/{case_id}/shares", json={"user_id": alice})
    assert r.status_code == 403


def test_revoking_a_share_removes_access(app_mod, users):
    alice, bob = users
    ca, cb = _client_as(app_mod, alice), _client_as(app_mod, bob)
    case_id = _make_case(ca, "Revocable")
    ca.post(f"/api/cases/{case_id}/shares", json={"user_id": bob})
    assert cb.get(f"/api/cases/{case_id}").status_code == 200

    ca.delete(f"/api/cases/{case_id}/shares/{bob}")
    assert cb.get(f"/api/cases/{case_id}").status_code == 404


def test_an_anonymous_caller_gets_nothing(app_mod, users):
    alice, _ = users
    ca = _client_as(app_mod, alice)
    _make_case(ca, "Not for the public")
    assert TestClient(app_mod.app).get("/api/cases").status_code == 401


def test_owner_comes_from_the_session_not_the_body(app_mod, users):
    """A client-supplied owner is a client-supplied answer to whose data
    this is."""
    alice, bob = users
    ca = _client_as(app_mod, alice)
    r = ca.post("/api/cases", json={"title": "Spoof attempt", "owner_user_id": bob})
    assert r.status_code == 200
    cb = _client_as(app_mod, bob)
    assert r.json()["case_id"] not in [c["case_id"] for c in cb.get("/api/cases").json()]


def test_a_folder_cannot_be_moved_into_its_own_subtree(app_mod, users):
    """Otherwise the subtree detaches from the root: invisible, undeletable,
    still counted."""
    alice, _ = users
    ca = _client_as(app_mod, alice)
    case_id = _make_case(ca, "Tree integrity")
    top = ca.post(f"/api/cases/{case_id}/nodes", json={"kind": "folder", "name": "top"}).json()
    kid = ca.post(f"/api/cases/{case_id}/nodes",
                  json={"kind": "folder", "name": "kid", "parent_id": top["id"]}).json()

    r = ca.patch(f"/api/cases/{case_id}/nodes/{top['id']}", json={"parent_id": kid["id"]})
    assert r.status_code == 400
    assert ca.patch(f"/api/cases/{case_id}/nodes/{top['id']}",
                    json={"parent_id": top["id"]}).status_code == 400
