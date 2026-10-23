"""The assistant's conversations (assistant_history.py, routers/assistant.py).

A temp database, two users (by header), the router mounted on its own app.
No model: /turn takes the free map path ("show me Paris")."""
import os
import sys

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import assistant as A  # noqa: E402
import assistant_history as H  # noqa: E402
from routers import assistant as R  # noqa: E402


@pytest.fixture()
def client(tmp_path, monkeypatch):
    A.DB_PATH = str(tmp_path / "h.db")
    A._db_ready.clear()
    H._ready.clear()
    A._KEY = b"test-key"

    def me(request: Request):
        u = request.headers.get("x-user")
        if not u:
            raise HTTPException(401, "authentication required")
        return {"id": u, "email": f"{u}@t"}
    monkeypatch.setattr(R, "_me", me)
    monkeypatch.setattr(A, "geocode", lambda q: [{"lat": 48.8566, "lon": 2.3522, "display_name": "Paris, France",
                                                  "type": "city", "place_rank": 16, "importance": 0.9,
                                                  "country_code": "fr", "country": "France"}]
                        if "paris" in q.lower() else [])
    monkeypatch.setattr(A, "profile", lambda uid: {"assets": [], "theaters": [], "interests": {}})
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(R.router)
    yield TestClient(app)
    A.DB_PATH = None


ALICE = {"x-user": "alice"}
BOB = {"x-user": "bob"}


def _turn(c, cid, text, turn_id, who=ALICE):
    return c.post("/api/assistant/turn", headers=who, json={
        "messages": [{"role": "user", "content": text}], "mode": "chat", "client": {"platform": "desktop"},
        "conversation_id": cid, "turn_id": turn_id})


def test_turn_is_kept_and_restored(client):
    cid = client.post("/api/assistant/conversations", headers=ALICE, json={}).json()["id"]
    r = _turn(client, cid, "show me Paris", "t1")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["actions"] and d["actions"][0]["intent"] == "navigate"
    assert d["message_id"] and d["user_message_id"]
    conv = client.get(f"/api/assistant/conversations/{cid}", headers=ALICE).json()
    assert [m["role"] for m in conv["messages"]] == ["user", "assistant"]
    assert conv["messages"][1]["actions"][0]["slots"]["lat"] == pytest.approx(48.8566)
    assert conv["title"] == "show me Paris"
    lst = client.get("/api/assistant/conversations", headers=ALICE).json()["conversations"]
    assert [c["id"] for c in lst] == [cid] and lst[0]["count"] == 2


def test_retry_does_not_repeat_the_question(client):
    cid = client.post("/api/assistant/conversations", headers=ALICE, json={}).json()["id"]
    H.begin_turn("alice", cid, "t1", "show me Paris")       # the first try died before answering
    _turn(client, cid, "show me Paris", "t1")
    conv = client.get(f"/api/assistant/conversations/{cid}", headers=ALICE).json()
    assert [m["role"] for m in conv["messages"]] == ["user", "assistant"]


def test_stop_keeps_stopped_not_the_late_answer(client):
    cid = client.post("/api/assistant/conversations", headers=ALICE, json={}).json()["id"]
    H.begin_turn("alice", cid, "t9", "show me Paris")
    assert client.post(f"/api/assistant/conversations/{cid}/stop", headers=ALICE, json={"turn_id": "t9"}).json()["message_id"]
    d = _turn(client, cid, "show me Paris", "t9").json()
    assert d["stopped"] is True and d["message_id"] is None
    msgs = client.get(f"/api/assistant/conversations/{cid}", headers=ALICE).json()["messages"]
    assert [(m["role"], m["content"]) for m in msgs] == [("user", "show me Paris"), ("assistant", "Stopped.")]
    assert msgs[1]["stopped"] is True


def test_users_only_see_their_own(client):
    cid = client.post("/api/assistant/conversations", headers=ALICE, json={}).json()["id"]
    _turn(client, cid, "show me Paris", "t1")
    assert client.get("/api/assistant/conversations", headers=BOB).json()["conversations"] == []
    assert client.get(f"/api/assistant/conversations/{cid}", headers=BOB).status_code == 404
    assert client.patch(f"/api/assistant/conversations/{cid}", headers=BOB, json={"title": "x"}).status_code == 404
    assert client.delete(f"/api/assistant/conversations/{cid}", headers=BOB).status_code == 404
    assert client.post(f"/api/assistant/conversations/{cid}/messages", headers=BOB,
                       json={"messages": [{"role": "user", "content": "x"}]}).status_code == 404
    assert client.post(f"/api/assistant/conversations/{cid}/stop", headers=BOB, json={"turn_id": "z"}).status_code == 404
    assert _turn(client, cid, "show me Paris", "t2", who=BOB).status_code == 404
    assert client.get(f"/api/assistant/conversations/{cid}", headers=ALICE).json()["title"] == "show me Paris"
    assert client.get("/api/assistant/conversations").status_code == 401


def test_rename_and_delete(client):
    cid = client.post("/api/assistant/conversations", headers=ALICE, json={}).json()["id"]
    _turn(client, cid, "show me Paris", "t1")
    assert client.patch(f"/api/assistant/conversations/{cid}", headers=ALICE, json={"title": "  Paris  trip "}).json()["title"] == "Paris trip"
    assert client.patch(f"/api/assistant/conversations/{cid}", headers=ALICE, json={"title": "  "}).status_code == 400
    assert client.delete(f"/api/assistant/conversations/{cid}", headers=ALICE).json() == {"ok": True}
    assert client.get(f"/api/assistant/conversations/{cid}", headers=ALICE).status_code == 404
    assert client.get("/api/assistant/conversations", headers=ALICE).json()["conversations"] == []


def test_empty_conversations_are_not_listed(client):
    client.post("/api/assistant/conversations", headers=ALICE, json={})
    assert client.get("/api/assistant/conversations", headers=ALICE).json()["conversations"] == []


def test_proposal_state_persists_and_expires_on_read(client):
    cid = client.post("/api/assistant/conversations", headers=ALICE, json={}).json()["id"]
    p = {"kind": "asset", "token": "tok1", "summary": "Add HQ"}
    p2 = {"kind": "asset", "token": "tok2", "summary": "Add depot"}
    ids = client.post(f"/api/assistant/conversations/{cid}/messages", headers=ALICE, json={"messages": [
        {"role": "assistant", "content": "Add HQ", "meta": {"proposals": [p, p2], "fromForm": True}}]}).json()["ids"]
    r = client.patch(f"/api/assistant/conversations/{cid}/messages/{ids[0]}", headers=ALICE,
                     json={"token": "tok1", "state": "done"})
    assert r.json() == {"ok": True}
    assert client.patch(f"/api/assistant/conversations/{cid}/messages/{ids[0]}", headers=BOB,
                        json={"token": "tok1", "state": "skipped"}).status_code == 404
    assert client.patch(f"/api/assistant/conversations/{cid}/messages/{ids[0]}", headers=ALICE,
                        json={"token": "tok1", "state": "bogus"}).status_code == 400
    m = client.get(f"/api/assistant/conversations/{cid}", headers=ALICE).json()["messages"][0]
    assert [x["state"] for x in m["proposals"]] == ["done", "pending"]
    later = H.get("alice", cid, now=m["created_at"] + A.PROPOSAL_TTL_S + 1)["messages"][0]
    assert [x["state"] for x in later["proposals"]] == ["done", "expired"]


def test_caps(client, monkeypatch):
    monkeypatch.setattr(H, "MAX_CONVERSATIONS", 2)
    monkeypatch.setattr(H, "MAX_MESSAGES", 3)
    ids = [H.create("alice", now=1000 + i)["id"] for i in range(3)]
    assert H.get("alice", ids[2])
    with pytest.raises(H.NotFound):
        H.get("alice", ids[0])
    for i in range(5):
        H.append("alice", ids[2], [{"role": "user", "content": f"m{i}"}])
    assert [m["content"] for m in H.get("alice", ids[2])["messages"]] == ["m2", "m3", "m4"]
