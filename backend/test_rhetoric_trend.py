"""
test_rhetoric_trend.py — the system has to notice when the talking changes.

The miss this guards against is real and dated: through September 2026
Western leaders shifted how they spoke about Russia and nothing here
registered it, because the GDELT ingest discarded every verbal CAMEO code
and nothing looked for a change in tone.

    cd backend && python3 -m pytest test_rhetoric_trend.py -q
"""
from datetime import datetime, timedelta, timezone

import rhetoric_trend as rt

NOW = datetime(2026, 9, 20, tzinfo=timezone.utc)


def ev(days_ago, a="DEU", b="RUS", code="11", tone=-3.0, g=-2.0):
    d = NOW - timedelta(days=days_ago)
    return {"date": d.strftime("%Y%m%d"), "actor1_country": a, "actor2_country": b,
            "event_root_code": code, "avg_tone": tone, "goldstein": g}


def quiet_baseline(a="DEU", b="RUS", per_day=1, start=8, end=28):
    return [ev(d, a, b) for d in range(start, end) for _ in range(per_day)]


def test_a_quiet_pair_that_gets_loud_is_reported():
    """The case that was missed."""
    events = quiet_baseline() + [ev(d) for d in range(0, 7) for _ in range(9)]
    out = rt.detect_shifts(events, now=NOW)
    assert out, "a 9x jump in hostile statements produced no finding"
    top = out[0]
    assert (top["actor_a"], top["actor_b"]) == ("DEU", "RUS")
    assert top["recent_per_day"] > top["baseline_per_day"] * 3


def test_a_pair_that_is_always_loud_is_not_reported_every_day():
    """A global threshold would surface the loudest relationships on earth
    daily and never the quiet pair that just got loud — which is the only
    interesting case."""
    events = [ev(d, "ISR", "PSE") for d in range(0, 28) for _ in range(20)]
    out = rt.detect_shifts(events, now=NOW)
    assert not any(r["actor_a"] == "ISR" for r in out)


def test_nothing_is_claimed_without_enough_history():
    """A shift measured against two data points is a coin flip with a
    decimal place."""
    events = [ev(0), ev(1), ev(2)]
    assert rt.detect_shifts(events, now=NOW) == []


def test_a_flat_baseline_does_not_produce_an_infinite_jump():
    """Zero deviation would divide by zero and call any change enormous."""
    events = [ev(d) for d in range(8, 28)] + [ev(d) for d in range(0, 7) for _ in range(4)]
    out = rt.detect_shifts(events, now=NOW)
    for r in out:
        assert r["z_volume"] == r["z_volume"]        # not NaN
        assert r["z_volume"] < 1e6


def test_only_speech_counts_toward_a_rhetoric_shift():
    """A battle is not a statement. Mixing them would let kinetic events
    masquerade as an escalation in language."""
    kinetic = [ev(d, code="19", g=-10.0) for d in range(0, 7) for _ in range(50)]
    assert rt.detect_shifts(quiet_baseline() + kinetic, now=NOW) == []


def test_each_pair_is_compared_only_against_itself():
    loud = [ev(d, "ISR", "PSE") for d in range(0, 28) for _ in range(30)]
    shifted = quiet_baseline("DEU", "RUS") + [ev(d, "DEU", "RUS") for d in range(0, 7) for _ in range(9)]
    out = rt.detect_shifts(loud + shifted, now=NOW)
    assert out and out[0]["actor_a"] == "DEU"


def test_the_headline_names_the_relationship_and_the_size():
    """A z-score is not something a reader can act on."""
    events = quiet_baseline() + [ev(d) for d in range(0, 7) for _ in range(9)]
    line = rt.detect_shifts(events, now=NOW)[0]["headline"]
    assert "DEU" in line and "RUS" in line
    assert "×" in line or "up from" in line
    assert "z" not in line.lower().split()


def test_a_tone_shift_is_reported_alongside_volume():
    events = (quiet_baseline() +
              [ev(d, tone=-9.0) for d in range(0, 7) for _ in range(9)])
    top = rt.detect_shifts(events, now=NOW)[0]
    assert top["tone_delta"] is not None and top["tone_delta"] < -3
    assert "more negative" in top["headline"]


def test_an_actor_talking_about_itself_is_not_a_relationship():
    events = [ev(d, "RUS", "RUS") for d in range(0, 28) for _ in range(20)]
    assert rt.detect_shifts(events, now=NOW) == []


def test_empty_input_is_quiet():
    assert rt.detect_shifts([], now=NOW) == []
