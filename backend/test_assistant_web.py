"""The assistant's web_search and explain_item tools (assistant.py), with the
web agent stubbed (backend/web_agent.py is built separately) or missing."""
import os
import sys
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import assistant as A  # noqa: E402

SIGNALS = [
    {"id": "ls-1", "title": "Explosion at the port of Khor Fakkan", "place": "Khor Fakkan", "lat": 25.34, "lon": 56.35,
     "country_code": "ae", "event_time": "2026-10-23T10:00:00Z", "sources": [{"url": "https://t.me/c/1"}],
     "corroboration": {"line": "Corroborated by 2 sources"}},
    {"id": "ls-2", "title": "Smoke seen over the container terminal", "place": "Khor Fakkan", "lat": 25.35, "lon": 56.36,
     "country_code": "ae", "event_time": "2026-10-23T11:00:00Z", "sources": [{"url": "https://t.me/c/2"}]},
    {"id": "ls-3", "title": "Crowd in Berlin", "place": "Berlin", "lat": 52.5, "lon": 13.4, "country_code": "de",
     "event_time": "2026-10-23T10:00:00Z", "sources": []},
]


@pytest.fixture(autouse=True)
def stubs(tmp_path, monkeypatch):
    A.DB_PATH = str(tmp_path / "w.db")
    A._db_ready.clear()
    monkeypatch.setattr(A, "geocode", lambda q: [{"lat": 25.34, "lon": 56.35, "display_name": "Khor Fakkan, UAE",
                                                  "type": "city", "place_rank": 16, "importance": 0.6,
                                                  "country_code": "ae", "country": "United Arab Emirates"}]
                        if "khor" in q.lower() else [])
    monkeypatch.setattr(A, "profile", lambda uid: {"assets": [], "theaters": [], "interests": {}})
    monkeypatch.setattr(A, "_live_signals", lambda: SIGNALS)
    monkeypatch.setattr(A, "_pool", lambda: [])
    yield
    sys.modules.pop("web_agent", None)
    A.DB_PATH = None


def _fake_agent(monkeypatch, calls):
    m = types.ModuleType("web_agent")

    def research(query, *, lat=None, lon=None, place=None, since_hours=None, user=None):
        calls.append({"query": query, "lat": lat, "lon": lon, "place": place, "since_hours": since_hours})
        return {"findings": [{"title": "Fire at Khor Fakkan port", "url": "https://news.example/a", "source": "Example News",
                              "published_at": "2026-10-23T12:00:00Z", "summary": "A fire broke out at the port.",
                              "lat": 25.34, "lon": 56.35, "place": "Khor Fakkan"}], "spent_usd": 0.01, "note": None}
    m.research = research
    monkeypatch.setitem(sys.modules, "web_agent", m)


def test_web_search_without_the_agent_says_so(monkeypatch):
    monkeypatch.setitem(sys.modules, "web_agent", None)       # import fails
    out = A.run_tool(A.Turn("u1"), "web_search", {"query": "Khor Fakkan port"})
    assert out == {"note": A.WEB_UNAVAILABLE}


def test_web_findings_are_cited_as_web_refs(monkeypatch):
    calls = []
    _fake_agent(monkeypatch, calls)
    t = A.Turn("u1")
    out = A.run_tool(t, "web_search", {"query": "port fire", "place": "Khor Fakkan", "since_hours": 48})
    assert out["count"] == 1 and out["items"][0]["ref"] == "W1"
    c = t.refs["W1"]
    assert c["kind"] == "web" and c["url"] == "https://news.example/a" and c["source"] == "Example News"
    assert c["summary"].startswith("A fire")
    assert calls[0]["lat"] == pytest.approx(25.34) and calls[0]["since_hours"] == 48
    reply, used = A.finish_reply(t, "A fire at the port [W1].")
    assert used == ["W1"]


def test_explain_item_pulls_the_item_neighbours_and_the_web(monkeypatch):
    calls = []
    _fake_agent(monkeypatch, calls)
    t = A.Turn("u1")
    out = A.run_tool(t, "explain_item", {"about": "explosion at the port", "place": "Khor Fakkan"})
    assert out["item"]["what"].startswith("Explosion")
    assert [n["what"] for n in out["nearby"]] == ["Smoke seen over the container terminal"]   # Berlin is far
    assert out["web"]["items"][0]["ref"].startswith("W")
    assert t.extra_calls == 1                                  # the web search counts as a lookup
    assert "Khor Fakkan" in calls[0]["query"]


def test_explain_item_skips_the_web_when_the_lookups_are_used_up(monkeypatch):
    calls = []
    _fake_agent(monkeypatch, calls)
    t = A.Turn("u1")
    t.calls = A.tool_calls_per_turn()
    out = A.run_tool(t, "explain_item", {"about": "explosion at the port", "place": "Khor Fakkan"})
    assert "web" not in out and calls == []
