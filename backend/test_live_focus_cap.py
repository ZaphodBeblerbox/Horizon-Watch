"""Focus-area posts are read past the day's cap (owner, Paris, 2026-10-24), up to FOCUS_EXTRA_PER_DAY."""
import datetime as dt

import live_incident as li


def test_focus_extra_allowance_resets_daily_and_is_bounded(monkeypatch):
    monkeypatch.setattr(li, "FOCUS_EXTRA_PER_DAY", 3)
    li._FOCUS_EXTRA.update(day=None, used=0)
    d1 = dt.datetime(2026, 10, 24, 12, tzinfo=dt.timezone.utc)
    assert li._focus_extra_left(d1) == 3
    li._focus_extra_take(d1, 2)
    assert li._focus_extra_left(d1) == 1
    li._focus_extra_take(d1, 5)
    assert li._focus_extra_left(d1) == 0
    assert li._focus_extra_left(d1 + dt.timedelta(days=1)) == 3
