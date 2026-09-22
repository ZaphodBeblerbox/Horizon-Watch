"""The whole-world risk index must not be recomputed per request.

compute_all_countries() scores 121 countries, each with three full
passes over the GDELT event list — 4,840,000 comparisons, measured at
19.4 seconds. /api/notifications called it on every request, and the
front end polls that every 20 seconds, so the notification tray could
never be faster than 19s however much else was fixed.
"""
import time
from routers import risk_index as ri


def _fake(monkeypatch, calls):
    monkeypatch.setattr(ri, "get_all_events", lambda: [])
    monkeypatch.setattr(ri, "_real_geoconfirmed_counts_by_iso", lambda _w: {})
    monkeypatch.setattr(ri, "real_history_days", lambda _e: 1.0)

    def compute(*_a, **_k):
        calls.append(1)
        return [{"iso_code": "AA", "risk": {"score": 1.0}}]
    monkeypatch.setattr(ri._gri, "compute_all_countries", compute)


def test_a_second_call_does_not_recompute(monkeypatch):
    ri._RISK_CACHE.clear()
    calls = []
    _fake(monkeypatch, calls)
    ri.get_all_country_risk()
    ri.get_all_country_risk()
    ri.get_all_country_risk()
    assert len(calls) == 1, f"recomputed {len(calls)} times"


def test_force_recomputes(monkeypatch):
    # The background warmer needs a way to refresh deliberately.
    ri._RISK_CACHE.clear()
    calls = []
    _fake(monkeypatch, calls)
    ri.get_all_country_risk()
    ri.get_all_country_risk(force=True)
    assert len(calls) == 2


def test_an_expired_entry_is_recomputed(monkeypatch):
    ri._RISK_CACHE.clear()
    calls = []
    _fake(monkeypatch, calls)
    ri.get_all_country_risk()
    stamp, payload = ri._RISK_CACHE[30]
    ri._RISK_CACHE[30] = (stamp - (ri._RISK_TTL_S * 2), payload)
    ri.get_all_country_risk()
    assert len(calls) == 2


def test_different_windows_are_cached_separately(monkeypatch):
    # A 7-day window is a different answer from a 30-day one; sharing
    # one slot would serve the wrong number.
    ri._RISK_CACHE.clear()
    calls = []
    _fake(monkeypatch, calls)
    ri.get_all_country_risk(window_days=30)
    ri.get_all_country_risk(window_days=7)
    assert len(calls) == 2
    ri.get_all_country_risk(window_days=30)
    assert len(calls) == 2


def test_the_ttl_is_under_the_gdelt_refresh_interval():
    # The inputs only change when GDELT refreshes, every 15 minutes, so
    # a shorter TTL is exact rather than a guess at staleness.
    assert 0 < ri._RISK_TTL_S <= 900


def test_the_cached_payload_is_the_same_object_shape(monkeypatch):
    ri._RISK_CACHE.clear()
    _fake(monkeypatch, [])
    a = ri.get_all_country_risk()
    b = ri.get_all_country_risk()
    assert a["countries"] == b["countries"]
    assert set(a) == set(b)
