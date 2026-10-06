"""escalation: a country's share of violent events against its own normal."""
from escalation import assess


def _days(n):
    return [f"2026-09-{d:02d}" for d in range(1, n + 1)]


def test_a_real_rise_is_escalating_and_a_media_surge_is_not():
    days = _days(31)
    world = {d: 1000 for d in days}
    calm = {d: 20 + (i % 3) for i, d in enumerate(days)}
    rising = dict(calm, **{d: 70 for d in days[-3:]})
    a = assess(rising, world)
    assert a["escalating"] and a["change_pct"] > 200
    # the whole world doubles (a news cycle): the share is flat, so no
    world2 = dict(world, **{d: 2000 for d in days[-3:]})
    flat = dict(calm, **{d: 42 for d in days[-3:]})
    assert not assess(flat, world2)["escalating"]


def test_a_tiny_baseline_is_never_escalating():
    days = _days(31)
    world = {d: 1000 for d in days}
    tiny = {d: 1 for d in days}
    tiny.update({d: 6 for d in days[-3:]})
    assert not assess(tiny, world)["escalating"]


def test_too_little_history_says_nothing():
    assert assess({}, {d: 10 for d in _days(10)}) is None
