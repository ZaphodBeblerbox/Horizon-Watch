"""The phone gets what the desktop gets (owner, 2026-10-10): event_watch.notifies
is the desktop's pop-up rule, with no relevance narrowing."""
import event_watch as ew


def test_what_pops_up_on_the_desktop_notifies_everywhere():
    far = {"lat": 15.3, "lon": 44.2}
    assert ew.notifies({"kind": "telegram", "sev": "moderate", **far}, None)
    assert ew.notifies({"kind": "signal", "sev": "high", **far}, None)
    assert ew.notifies({"kind": "signal", "sev": "critical", **far}, None)
    assert ew.notifies({"kind": "livestream", "sev": "moderate"}, None)


def test_what_only_lands_in_the_tray_does_not():
    assert not ew.notifies({"kind": "signal", "sev": "moderate", "lat": 1, "lon": 1}, None)
    assert not ew.notifies({"kind": "discovery", "sev": "low"}, None)
