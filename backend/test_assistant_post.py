"""'Write a post' (assistant_post.py): the citation drop, the template when the
model is off, one counted model call, and nothing posted by the endpoint."""
import json
import os
import sys
from types import SimpleNamespace as NS

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import assistant as A  # noqa: E402
import assistant_post as P  # noqa: E402
from routers import assistant as R  # noqa: E402

ITEM = {"id": "ls-1", "kind": "live_signal", "title": "Police charge protesters at Place Bellecour",
        "place": "Place Bellecour, Lyon", "event_time": "2026-10-23T17:41:00Z",
        "corroboration": {"line": "Corroborated by 2 sources"},
        "summary": "Officers moved on the crowd near the statue.",
        "sources": [{"channel_title": "Lyon Insurgé", "url": "https://t.me/lyoninsurge/10", "text": "Charge at Bellecour"},
                    {"channel_title": "Le Progrès", "url": "https://leprogres.fr/a", "text": "Police intervention"}]}


@pytest.fixture(autouse=True)
def db(tmp_path, monkeypatch):
    A.DB_PATH = str(tmp_path / "p.db")
    A._db_ready.clear()
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    yield
    A.DB_PATH = None


class FakeClient:
    def __init__(self, content):
        self.calls = 0
        self.content = content
        self.chat = NS(completions=NS(create=self._create))

    def _create(self, **kw):
        self.calls += 1
        return NS(choices=[NS(message=NS(content=json.dumps(self.content)))],
                  usage=NS(prompt_tokens=300, completion_tokens=80))


def _model_on(monkeypatch):
    monkeypatch.setattr(A, "model_state", lambda uid=None: {"on": True, "why": None})
    import openai_gate
    monkeypatch.setattr(openai_gate, "price_for", lambda m: (0.0000004, 0.0000016))


def test_keep_cited_drops_uncited_and_unknown():
    text, used = P.keep_cited("Police charged at Bellecour [I1]. Ten people were hurt. Shots fired [X9]. "
                              "Two channels report it [S1, S2].", {"I1": 1, "S1": 1, "S2": 1})
    assert text == "Police charged at Bellecour. Two channels report it."
    assert used == ["I1", "S1", "S2"]


def test_model_draft_keeps_only_cited_facts(monkeypatch):
    _model_on(monkeypatch)
    fc = FakeClient({"short": "Police charged protesters at Place Bellecour, Lyon, 17:41 UTC [I1]. "
                              "Several were arrested. Corroborated by 2 sources [I1, S1].",
                     "long": "Officers moved on the crowd near the statue [I1]. The mayor resigned."})
    out = P.draft_post("u1", ITEM, client=fc)
    assert fc.calls == 1
    assert out["path"] == "model"
    assert "arrested" not in out["short"] and "mayor" not in out["long"]
    assert "[" not in out["short"]
    assert out["short"].endswith("Source: Lyon Insurgé.")
    assert len(out["short"]) <= P.SHORT_CHARS
    assert {c["ref"] for c in out["citations"]} == {"I1", "S1"}
    assert A.usage_of("u1")["model_turns"] == 1


def test_all_uncited_falls_back_to_the_template(monkeypatch):
    _model_on(monkeypatch)
    out = P.draft_post("u1", ITEM, client=FakeClient({"short": "Something happened.", "long": "Nothing cited."}))
    assert out["path"] == "template"
    assert out["short"].startswith("Police charge protesters at Place Bellecour")


def test_template_when_the_model_is_off():
    out = P.draft_post("u1", ITEM)
    assert out["path"] == "template" and out["model"]["on"] is False
    s = out["short"]
    assert "17:41 UTC, 23 Oct" in s and "Corroborated by 2 sources." in s and s.endswith("Source: Lyon Insurgé, Le Progrès.")
    assert len(s) <= P.SHORT_CHARS
    assert "Officers moved on the crowd" in out["long"]
    assert A.usage_of("u1")["model_turns"] == 0
    bare = P.draft_post("u1", {"title": "Fire at the port", "lat": 1, "lon": 2})
    assert bare["short"] == "Fire at the port. Unverified."


def test_template_fits_280_with_a_long_title():
    out = P.draft_post("u1", {**ITEM, "title": "word " * 120})
    assert len(out["short"]) <= P.SHORT_CHARS and out["short"].endswith("Source: Lyon Insurgé, Le Progrès.")


def test_endpoint_drafts_and_posts_nothing(monkeypatch):
    def me(request: Request):
        u = request.headers.get("x-user")
        if not u:
            raise HTTPException(401, "authentication required")
        return {"id": u}
    monkeypatch.setattr(R, "_me", me)
    app = FastAPI()
    app.include_router(R.router)
    c = TestClient(app)
    r = c.post("/api/assistant/draft_post", headers={"x-user": "u1"}, json={"item": ITEM})
    assert r.status_code == 200 and r.json()["path"] == "template"
    assert c.post("/api/assistant/draft_post", headers={"x-user": "u1"}, json={"item": {}}).status_code == 400
    assert c.post("/api/assistant/draft_post", json={"item": ITEM}).status_code == 401
    assert not [rt for rt in app.routes if "/desk" in getattr(rt, "path", "")]
