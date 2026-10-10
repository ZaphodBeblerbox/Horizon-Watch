"""The mood index: half tension, half the share calling to act; the recent
days against the days before."""
import datetime as dt

import telegram_sentiment as ts


def test_index_halves():
    assert ts.index_of([3, 3], [3, 3]) == 100
    assert ts.index_of([0, 0], [0, 0]) == 0
    assert ts.index_of([3, 0], [0, 0]) == 25          # mean tension 1.5 of 3 → 25
    assert ts.index_of([0, 0, 0, 0], [2, 1, 0, 0]) == 12   # a quarter call to act → 12.5
    assert ts.index_of([], []) is None


def test_series_compares_recent_with_before():
    now = dt.datetime(2026, 10, 10, 12, tzinfo=dt.timezone.utc)
    def r(day, t, m):
        return {"channel": "c", "msg_id": day, "channel_title": "C", "posted_at": f"2026-10-{day:02d}T10:00:00+00:00",
                "text": "x", "summary_en": None, "role": "local", "mood_country": "fr",
                "mood_tension": t, "mood_mobilise": m, "mood_target": "police", "mood_topic": "protests"}
    rows = [r(1, 0, 0), r(2, 1, 0), r(9, 2, 2), r(10, 3, 3)]
    s = ts.series("fr", 14, now, rows)
    assert len(s["days"]) == 14 and s["days"][-1]["date"] == "2026-10-10"
    assert s["index_before"] == 8 and s["index_recent"] == 92 and s["change"] == 84
    assert s["index_window"] == 50 and s["n_recent"] == 2
    assert s["days"][-1]["violent_calls"] == 1 and [c["mobilise"] for c in s["calls"]] == [3, 2]
    assert s["targets"] == ["police"] and s["sources"] == {"local": 4}
