"""attention.py: model and web calls only where someone watches, ranked by attention and importance (DATAMINR_PLAN B0)."""
import datetime as dt
import time

import pytest

import attention as at
import live_incident as li
import telegram_signals as ts
from test_live_incident import NOW, PUB, db, good  # noqa: F401  (db is a fixture)
from test_watch_gate import PARIS_USER, union


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    monkeypatch.setattr(at, "STATS", {})


def test_the_union_excludes_users_without_a_profile():
    w = union(PARIS_USER, {"assets": [], "theaters": [], "countries": set(), "topics": set()})
    assert w["users_with_profile"] == 1
    kinds = {p["kind"] for p in w["points"]}
    assert kinds == {"asset", "theater"}


def test_watch_is_strongest_at_an_asset_then_theater_then_country():
    w = union(PARIS_USER)
    asset = at.watch_score(48.8687, 2.3712, None, None, w)[0]
    theater = at.watch_score(48.0, 4.5, None, None, w)[0]                  # ~200 km out: inside the 350 km theater only
    country = at.watch_score(None, None, "fr", None, w)[0]
    named = at.watch_score(None, None, None, "Tension monte en France ce soir", w)[0]
    nothing = at.watch_score(50.45, 30.52, "ua", "Kyiv", w)[0]
    assert asset == 1.0 and theater == 0.7 and country == 0.4 and named == 0.25 and nothing == 0.0


def test_score_order_attention_and_importance():
    w = union(PARIS_USER)
    rows = [{"user_id": "u1", "bbox": [2.2, 48.8, 2.5, 48.9], "theater": None, "event_id": "ev_open"}]
    base = at.score({"lat": 48.8687, "lon": 2.3712, "priority": "urgent"}, w, [])
    seen = at.score({"lat": 48.8687, "lon": 2.3712, "priority": "urgent"}, w, rows)
    opened = at.score({"lat": 48.8687, "lon": 2.3712, "priority": "urgent", "event_id": "ev_open"}, w, rows)
    flash_dev = at.score({"lat": 48.8687, "lon": 2.3712, "priority": "flash", "developing": True, "fresh": True}, w, [])
    unwatched = at.score({"lat": 50.45, "lon": 30.52, "priority": "flash", "developing": True, "fresh": True}, w, rows)
    assert opened["score"] > seen["score"] > base["score"] > 0
    assert flash_dev["score"] == pytest.approx(1.0 * 1 * 1.3 + 0.2)
    assert unwatched["score"] == 0.0                                          # fresh adds nothing to what nobody watches


def test_worth_never_spends_on_what_nobody_watches(monkeypatch):
    called = []
    monkeypatch.setattr("openai_gate.refusal", lambda p: called.append(p) or None)
    ok, why = at.worth("brief", {"score": 0.0, "watch": 0.0})
    assert not ok and "not watched" in why and not called
    assert at.STATS["brief"]["skipped_not_watched"] == 1
    ok, why = at.worth("brief", {"score": 0.3, "watch": 0.25})
    assert not ok and "under" in why
    ok, _ = at.worth("brief", {"score": 0.9, "watch": 1.0})
    assert ok and called == ["brief"]


def test_worth_says_no_when_the_purpose_has_no_budget(monkeypatch):
    monkeypatch.setattr("openai_gate.refusal", lambda p: "'brief' reached today's pace")
    ok, why = at.worth("brief", {"score": 1.0, "watch": 1.0})
    assert not ok and "pace" in why and at.STATS["brief"]["skipped_budget"] == 1


def test_live_attention_is_kept_five_minutes(db):                            # noqa: F811
    t = time.time()
    at.note("u1", {"viewport": {"west": 2.2, "south": 48.8, "east": 2.5, "north": 48.9}, "open_event_id": "ev_1",
                   "platform": "phone", "tz": "Europe/Paris"}, now=t)
    assert at.live(now=t + 10)[0]["bbox"] == [2.2, 48.8, 2.5, 48.9]
    assert at.live(now=t + at.ATTENTION_TTL_S + 1) == []
    assert at.tz_of("u1") == "Europe/Paris"
    assert at._bbox({"west": 1, "south": 95, "east": 2, "north": 96}) is None


def test_a_kharkiv_post_makes_no_model_call_for_a_paris_watcher(db, monkeypatch):  # noqa: F811
    """THE ACCEPTANCE (B0): one user watches Paris; a Kyiv channel's post naming Kharkiv is decided by rules only,
    and counted as skipped."""
    import telegram_ingest as tg
    monkeypatch.setattr(ts, "chat_context", lambda chan: {"country": "ua", "region": "Kyiv"})
    con = tg._con()
    con.execute("INSERT INTO telegram_posts (channel, msg_id, channel_title, posted_at, text, media, chat_kind, role) VALUES"
                " (?,?,?,?,?,?,?,?)", ("kyivlive", 7, "Kyiv live", PUB, "Explosions in Kharkiv right now, air defence active",
                                     "none", "channel", "aggregator"))
    con.commit()
    con.close()
    calls = []
    w = union(PARIS_USER)
    out = li.run_once(now=NOW, extract_fn=lambda *a: calls.append(a) or (good(), 0.0007), watch=w)
    assert calls == [] and out["not_watched"] == 1
    assert at.STATS["live_incident"]["skipped_not_watched"] == 1
    con = tg._con()
    v = con.execute("SELECT live_verdict FROM telegram_posts WHERE msg_id=7").fetchone()[0]
    con.close()
    assert v.startswith("skipped: not watched")


def test_the_daily_cap_cannot_exceed_the_share(monkeypatch):
    monkeypatch.delenv("OPENAI_PURPOSE_SHARES", raising=False)
    monkeypatch.setenv("OPENAI_BUDGET_USD", "40")
    cap = li.share_day_cap(dt.datetime(2026, 10, 23, tzinfo=dt.timezone.utc))
    assert cap * li.EST_CALL_USD * 31 <= 16.0 + 1e-9
    assert li.per_day() <= cap and li.per_day() < 2000
