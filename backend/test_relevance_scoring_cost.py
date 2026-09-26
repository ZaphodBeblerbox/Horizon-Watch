"""Scoring a signal must not touch the database.

_surge_bonus and _fusion_bonus each opened a session and ran a query per
signal, so scoring one signal cost two or three sessions. GDELT does not
arrive one signal at a time: a burst of hundreds into one area meant
hundreds of synchronous SQLite sessions competing with the writer, and the
process kept logging while answering no HTTP at all.

Measured before/after: 11.195 ms/signal -> 0.036 ms/signal.
"""
import importlib
import time

import pytest


@pytest.fixture
def scorer():
    rs = importlib.import_module("relevance_scorer")
    importlib.reload(rs)
    return rs.relevance_scorer


SIG = {"lat": 25.0, "lon": 55.0, "domain": "GDELT"}


def test_a_burst_opens_no_session_per_signal(scorer, monkeypatch):
    import database
    opened = {"n": 0}
    real = database.get_db

    def counting_get_db(*a, **k):
        opened["n"] += 1
        return real(*a, **k)

    scorer.score_signal(dict(SIG))          # warm the caches
    monkeypatch.setattr(database, "get_db", counting_get_db)
    before = opened["n"]
    for i in range(200):
        scorer.score_signal({"lat": 25.0 + i * 0.01, "lon": 55.0, "domain": "GDELT"})
    # A handful for cache refreshes would be tolerable; one per signal is
    # the bug. 200 signals must not cost 200 sessions.
    assert opened["n"] - before < 10, f"{opened['n'] - before} sessions for 200 signals"


def test_scoring_stays_fast_enough_for_a_burst(scorer):
    scorer.score_signal(dict(SIG))
    t = time.perf_counter()
    for i in range(300):
        scorer.score_signal({"lat": 25.0 + (i % 10) * 0.1, "lon": 55.0, "domain": "GDELT"})
    per = (time.perf_counter() - t) / 300 * 1000
    # It was 11.2ms. A 500-signal burst at that rate is 5.6 seconds of
    # blocking work on the ingest path.
    assert per < 1.0, f"{per:.3f} ms/signal"


def test_the_score_is_still_a_real_score(scorer):
    """A cache that returns nothing would be fast and useless."""
    s = scorer.score_signal(dict(SIG))
    assert isinstance(s, int) and 0 <= s <= 100
    # A point in the middle of the ocean should not score like a hotspot.
    far = scorer.score_signal({"lat": -50.0, "lon": -140.0, "domain": "GDELT"})
    assert far <= s


def test_an_unlocated_signal_scores_zero(scorer):
    assert scorer.score_signal({"domain": "GDELT"}) == 0
