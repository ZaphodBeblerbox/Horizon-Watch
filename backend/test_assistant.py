"""The assistant (assistant.py, DATAMINR_PLAN B5/B6) with stubbed model replies.

No network, no app database: the geocoder, the profile and the live data are
stand-ins, and the model is a fake client that replays scripted replies
(tool calls, then text)."""
import json
import os
import sys
import time
from types import SimpleNamespace as NS

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import assistant as A  # noqa: E402

PLACES = {
    "paris": [{"lat": 48.8566, "lon": 2.3522, "display_name": "Paris, Ile-de-France, France", "type": "city",
               "place_rank": 16, "importance": 0.88, "country_code": "fr", "country": "France"},
              {"lat": 33.66, "lon": -95.55, "display_name": "Paris, Lamar County, Texas, United States", "type": "city",
               "place_rank": 16, "importance": 0.45, "country_code": "us", "country": "United States"}],
    "springfield": [{"lat": 39.80, "lon": -89.64, "display_name": "Springfield, Illinois, United States", "type": "city",
                     "place_rank": 16, "importance": 0.55, "country_code": "us"},
                    {"lat": 37.21, "lon": -93.29, "display_name": "Springfield, Missouri, United States", "type": "city",
                     "place_rank": 16, "importance": 0.52, "country_code": "us"}],
    "lyon": [{"lat": 45.764, "lon": 4.8357, "display_name": "Lyon, Auvergne-Rhone-Alpes, France", "type": "city",
              "place_rank": 16, "importance": 0.75, "country_code": "fr", "country": "France"}],
    "yemen": [{"lat": 15.5, "lon": 47.5, "display_name": "Yemen", "type": "country", "place_rank": 4,
               "importance": 0.8, "country_code": "ye", "country": "Yemen"}],
}

SIGNALS = [
    {"id": "ls-chan-1", "title": "Clashes with police at Place Bellecour, Lyon", "place": "Place Bellecour",
     "lat": 45.7578, "lon": 4.832, "country_code": "fr", "event_time": "2026-10-23T10:00:00Z", "act": "clash",
     "corroboration": {"line": "Corroborated by 2 sources"}, "sources": [{"url": "https://t.me/chan/1"}]},
    {"id": "ls-chan-2", "title": "Crowd marching on Unter den Linden, Berlin", "place": "Berlin",
     "lat": 52.517, "lon": 13.389, "country_code": "de", "event_time": "2026-10-23T10:05:00Z", "act": "crowd_movement",
     "corroboration": {"line": "Eyewitness, unverified"}, "sources": [{"url": "https://t.me/chan/2"}]},
]


@pytest.fixture(autouse=True)
def stubs(tmp_path, monkeypatch):
    A.DB_PATH = str(tmp_path / "a.db")
    A._db_ready.clear()
    A._KEY = b"test-key"
    A._USED.clear()
    monkeypatch.setattr(A, "geocode", lambda q: [dict(h) for h in PLACES.get(q.strip().lower(), [])])
    prof = {"assets": [{"id": "as1", "name": "Lyon office", "kind": "office", "kind_label": "Office", "owner_id": "u1",
                        "lat": 45.76, "lon": 4.84, "radius_km": 15}],
            "theaters": [], "interests": {}}
    monkeypatch.setattr(A, "profile", lambda uid: json.loads(json.dumps(prof)))
    monkeypatch.setattr(A, "_live_signals", lambda: SIGNALS)
    monkeypatch.setattr(A, "_pool", lambda: [])
    monkeypatch.setenv("HW_OPENAI_PURPOSES", "assistant")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    import openai_gate
    monkeypatch.setattr(openai_gate, "over_budget", lambda: False)
    monkeypatch.setattr(openai_gate, "quota_paused", lambda now=None: False)
    import usage_tracker
    monkeypatch.setattr(usage_tracker, "record_call", lambda **k: None)
    yield prof
    A.DB_PATH = None


def call(name, args, i=0):
    return NS(id=f"c{i}", function=NS(name=name, arguments=json.dumps(args)))


class Fake:
    """A scripted OpenAI client: each entry is a list of tool calls or a reply text."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = []
        self.chat = NS(completions=NS(create=self.create))

    def create(self, **kw):
        self.calls.append(kw)
        step = self.script.pop(0) if self.script else "done"
        msg = NS(content=None, tool_calls=step) if isinstance(step, list) else NS(content=step, tool_calls=None)
        return NS(choices=[NS(message=msg)], usage=NS(prompt_tokens=1000, completion_tokens=100))


def ask(text, client=None, **body):
    return A.run_turn("u1", {"id": "u1"}, {"messages": [{"role": "user", "content": text}], **body}, client=client)


# ── citations ────────────────────────────────────────────────────────────────

def test_tool_call_answer_keeps_real_citations_and_flies():
    f = Fake([[call("search_signals", {"near": "Lyon office"}),
               call("map_action", {"steps": [{"intent": "navigate", "slots": {"place": "Lyon"}}]}, 1)],
              "Police clashed with a crowd at Place Bellecour [S1]."])
    out = ask("What's happening near my Lyon office?", f)
    assert out["path"] == "model"
    assert [c["ref"] for c in out["citations"]] == ["S1"]
    assert out["citations"][0]["url"] == "https://t.me/chan/1"
    nav = [a for a in out["actions"] if a["intent"] == "navigate"]
    assert nav and abs(nav[0]["slots"]["lat"] - 45.764) < 0.01
    # the tools were offered, the temperature low, the output capped
    assert f.calls[0]["temperature"] <= 0.2 and f.calls[0]["max_tokens"] == A.MAX_OUTPUT_TOKENS
    assert "tools" in f.calls[0]


def test_citation_not_in_tool_results_is_stripped():
    f = Fake([[call("search_signals", {"near": "Lyon office"})],
              "Clashes at Bellecour [S1] and a bombing downtown [S7]."])
    out = ask("What's happening near my Lyon office?", f)
    assert "[S7]" not in out["reply"] and "[S1]" in out["reply"]
    assert [c["ref"] for c in out["citations"]] == ["S1"]


def test_uncited_factual_reply_is_replaced_by_what_we_hold():
    f = Fake([[call("search_signals", {"near": "Lyon office"})], "There were riots and fires across Lyon today."])
    out = ask("What's happening near my Lyon office?", f)
    assert "riots and fires" not in out["reply"]
    assert out["citations"] and out["citations"][0]["ref"] == "S1"


def test_uncited_claim_with_nothing_held_is_the_honest_note():
    f = Fake(["A big protest is happening in Paris right now."])
    out = ask("Tell me about Paris", f)
    assert out["reply"] == A.EMPTY_NOTE and out["citations"] == []


def test_tool_text_is_wrapped_as_data():
    f = Fake([[call("search_signals", {"near": "Lyon office"})], "Clashes [S1]."])
    ask("What's happening near my Lyon office?", f)
    tool_msgs = [m for m in f.calls[1]["messages"] if m["role"] == "tool"]
    assert tool_msgs and tool_msgs[0]["content"].startswith("<data>")


def test_tool_call_budget_per_turn(monkeypatch):
    monkeypatch.setenv("ASSISTANT_TOOL_CALLS", "2")
    f = Fake([[call("get_profile", {}, 0), call("my_assets", {}, 1), call("notifications", {}, 2)],
              [call("get_profile", {}, 3)], "Done."])
    ask("Summarise my day", f)
    tool_msgs = [m for m in f.calls[-1]["messages"] if m["role"] == "tool"]
    assert sum("Too many lookups" in m["content"] for m in tool_msgs) == 1
    assert "tools" not in f.calls[-1]          # the last hop must answer


# ── map actions ──────────────────────────────────────────────────────────────

def test_map_actions_are_allowlisted():
    f = Fake([[call("map_action", {"steps": [{"intent": "delete_everything", "slots": {}},
                                             {"intent": "layer", "slots": {"layer": "nukes", "on": True}},
                                             {"intent": "layer", "slots": {"layer": "heat", "on": True}},
                                             {"intent": "focus", "slots": {"ref": "S99"}}]})], "Showing fires."])
    out = ask("turn on what matters", f)
    assert out["actions"] == [{"intent": "layer", "slots": {"layer": "heat", "on": True}}]


def test_show_me_paris_is_free_and_flies():
    f = Fake(["should not be called"])
    out = ask("show me Paris", f)
    assert f.calls == [] and out["path"] == "rule"
    assert out["actions"][0]["intent"] == "navigate"
    assert abs(out["actions"][0]["slots"]["lat"] - 48.8566) < 0.01


def test_ambiguous_place_asks():
    out = ask("show me Springfield")
    assert out["ask"] and len(out["ask"]["options"]) == 2 and not out["actions"]


def test_show_fires_in_yemen_with_model_off(monkeypatch):
    monkeypatch.setenv("HW_OPENAI_PURPOSES", "voice")
    out = ask("show fires in Yemen")
    kinds = [a["intent"] for a in out["actions"]]
    assert kinds == ["layer", "navigate"] and out["actions"][0]["slots"]["layer"] == "heat"


# ── guardrails ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("text", [
    "track the protester in the red jacket", "where does she live", "find the home address of the organiser",
    "follow this person around Paris", "Where is Jean Dupont", "identify the people who filmed this"])
def test_person_tracking_is_refused_without_a_model_call(text):
    f = Fake(["nope"])
    out = ask(text, f)
    assert out["reply"] == A.REFUSAL and f.calls == []


@pytest.mark.parametrize("text", ["where is the tanker Front Altair", "track flight BAW123", "what's happening in Lyon"])
def test_vessels_aircraft_places_are_not_refused(text):
    assert not A.is_person_tracking(text)


def test_daily_cap_uses_the_rule_path(monkeypatch):
    monkeypatch.setenv("ASSISTANT_TURNS_PER_DAY", "1")
    f = Fake([[call("search_signals", {"near": "Lyon office"})], "Clashes [S1]."])
    assert ask("What's happening near my Lyon office?", f)["path"] == "model"
    f2 = Fake(["should not be called"])
    out = ask("What's happening in Lyon?", f2)
    assert f2.calls == [] and out["path"] == "rule"
    assert out["model"]["on"] is False and "today's 1" in out["model"]["why"]
    assert out["citations"] and out["citations"][0]["ref"] == "S1"     # canned answer, cited
    st = A.usage_of("u1")
    assert st["model_turns"] == 1 and st["rule_turns"] == 1 and st["capped"] == 1 and st["tokens_in"] == 2000


def test_model_off_gives_a_clear_message_and_forms(monkeypatch):
    monkeypatch.setenv("HW_OPENAI_PURPOSES", "voice")
    out = ask("write me a poem about the sea")
    assert out["model"]["on"] is False and "switched off" in out["reply"] and out["forms"] is True


# ── proposals and confirm ───────────────────────────────────────────────────

def test_propose_theater_clamps_and_signs_and_confirm_returns_the_request():
    out = A.propose_theater("u1", "Paris watch", "Paris", 9000, {"theaters": []})
    p = out["proposal"]
    assert p["data"]["view"]["height"] == round(500 / 0.9 * 1000)
    req = A.confirm("u1", p["token"])
    assert req["method"] == "POST" and req["path"] == "/api/theaters" and req["body"]["name"] == "Paris watch"


def test_theater_name_capped_and_radius_floor():
    p = A.propose_theater("u1", "x" * 200, "Lyon", 0.1, {"theaters": []})["proposal"]
    assert len(p["data"]["name"]) == 60 and p["data"]["view"]["height"] == round(1 / 0.9 * 1000)


def test_theater_count_limit():
    from routers.theaters import MAX_THEATERS
    out = A.propose_theater("u1", "One more", "Lyon", 50, {"theaters": [{}] * MAX_THEATERS})
    assert "error" in out


def test_forged_expired_reused_and_foreign_tokens_are_rejected():
    tok = A.propose_alerts("u1", "theaters")["proposal"]["token"]
    raw, mac = tok.split(".")
    with pytest.raises(ValueError):
        A.confirm("u1", raw + "." + mac[:-2] + ("AA" if mac[-2:] != "AA" else "BB"))
    with pytest.raises(ValueError):
        A.confirm("u2", tok)
    A.confirm("u1", tok)
    with pytest.raises(ValueError):
        A.confirm("u1", tok)                                   # single use
    old = A.sign("u1", "alerts", {"level": "theaters", "thresholds": {}}, now=time.time() - 3600)
    with pytest.raises(ValueError):
        A.confirm("u1", old)


def test_model_proposal_never_writes(monkeypatch):
    writes = []
    monkeypatch.setattr(A, "confirm", lambda *a, **k: writes.append(a))
    f = Fake([[call("propose_theater", {"name": "Lyon", "place": "Lyon", "radius_km": 80})], "I propose a theater over Lyon."])
    out = ask("set up a theater over Lyon", f)
    assert writes == [] and len(out["proposals"]) == 1 and out["proposals"][0]["kind"] == "theater"
    assert out["proposals"][0]["token"]


def test_interests_merge_at_confirm(stubs, monkeypatch):
    stubs["interests"] = {"countries": ["Ukraine"], "topics": ["maritime"]}
    p = A.propose_interests("u1", ["France", "Atlantis"], ["Levant"], ["cyber"])["proposal"]
    assert "Atlantis" in p["summary"]
    body = A.confirm("u1", p["token"])["body"]["interests"]
    assert body["countries"] == ["Ukraine", "France"] and body["topics"] == ["maritime", "cyber"]
    assert body["regions"] == ["Levant"]


def test_asset_kind_validated_and_person_excluded():
    assert "error" in A.propose_asset("u1", "Jean", "person", "Paris")
    p = A.propose_asset("u1", "Lyon office", "office", "Lyon", 2000)["proposal"]
    assert p["data"]["radius_km"] == 500 and p["data"]["kind"] == "office"
    assert A.confirm("u1", p["token"])["path"] == "/api/my-assets"


# ── onboarding ───────────────────────────────────────────────────────────────

def test_onboarding_first_question_is_free(stubs):
    stubs["assets"] = []
    f = Fake(["x"])
    out = A.run_turn("u1", {"id": "u1"}, {"messages": [], "mode": "onboarding"}, client=f)
    assert f.calls == [] and out["onboarding"]["step"] == "here" and out["reply"] == A.QUESTIONS["here"]


def test_rule_fallback_walks_the_steps(stubs, monkeypatch):
    monkeypatch.setenv("HW_OPENAI_PURPOSES", "voice")
    stubs["assets"] = []
    out = ask("I'm in Lyon", mode="onboarding")
    assert out["proposals"][0]["kind"] == "interests" and out["proposals"][0]["data"]["here"]["label"].startswith("Lyon")
    stubs["interests"] = {"here": {"lat": 45.7, "lon": 4.8}}
    out = ask("my office is in Paris", mode="onboarding")
    assert out["onboarding"]["step"] == "protect" and out["proposals"][0]["data"]["kind"] == "office"
    out = ask("that's all", mode="onboarding")
    assert out["onboarding"]["step"] == "care" and out["skipped"] == ["protect"]
    out = ask("Ukraine and maritime", mode="onboarding", onboarding={"skipped": ["protect"]})
    d = out["proposals"][0]["data"]
    assert d["add_countries"] == ["Ukraine"] and d["add_topics"] == ["maritime"]
    stubs["interests"]["countries"] = ["Ukraine"]
    out = ask("only the most urgent near my places", mode="onboarding", onboarding={"skipped": ["protect"]})
    assert out["onboarding"]["step"] == "alert" and out["proposals"][0]["data"]["level"] == "near_mine"


def test_onboarding_ambiguous_place_asks(stubs, monkeypatch):
    monkeypatch.setenv("HW_OPENAI_PURPOSES", "voice")
    out = ask("Springfield", mode="theater")
    assert out["ask"] and not out["proposals"]


def test_new_theater_mode_with_model_extracts_through_the_tool():
    f = Fake([[call("propose_theater", {"name": "Paris", "place": "Paris", "radius_km": 60})], "Here is the theater."])
    out = A.run_turn("u1", {"id": "u1"}, {"messages": [{"role": "user", "content": "Paris, about 60 km"}],
                                         "mode": "theater"}, client=f)
    assert out["onboarding"]["step"] == "theater"
    assert out["proposals"][0]["place"]["radius_km"] == 60
    assert "SET-UP MODE" in f.calls[0]["messages"][1]["content"]


def test_status_counts(monkeypatch):
    ask("show me Paris")
    st = A.status("u1")
    assert st["today"]["turns"] == 1 and st["today"]["rule_turns"] == 1
    assert st["caps"]["turns_per_day"] == 60 and st["purpose"] == "assistant"
    assert st["all_users_today"]["users"] == 1
