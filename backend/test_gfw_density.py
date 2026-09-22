"""Gridding GFW events for the heatmap."""
import gfw


def _ev(lat, lon, risk=None, vessel=None):
    e = {"lat": lat, "lon": lon, "gfw_potential_risk": risk}
    if vessel:
        e["vessels"] = [{"name": vessel}]
    return e


def _patched(monkeypatch, events, available=True, error=None):
    monkeypatch.setattr(gfw, "events", lambda *a, **k: {
        "available": available, "error": error, "events": events,
        "lag_days": 3.0, "stale": False, "source": "Global Fishing Watch",
        "source_url": "https://globalfishingwatch.org",
    })


def test_unavailable_is_reported_not_faked(monkeypatch):
    _patched(monkeypatch, [], available=False, error="GFW_TOKEN not configured")
    out = gfw.density()
    assert out["available"] is False
    assert out["cells"] == []
    assert "GFW_TOKEN" in out["error"]


def test_events_in_one_cell_become_one_cell(monkeypatch):
    _patched(monkeypatch, [_ev(10.1, 20.1), _ev(10.2, 20.2), _ev(10.4, 20.4)])
    out = gfw.density(cell_deg=0.5)
    assert out["count"] == 1
    assert out["cells"][0]["count"] == 3
    assert out["events_gridded"] == 3


def test_cells_are_centred_not_cornered(monkeypatch):
    # The globe layer draws a symbol at the coordinate it is handed, so
    # a corner puts every cell half a cell south-west of its events.
    _patched(monkeypatch, [_ev(10.0, 20.0)])
    c = gfw.density(cell_deg=0.5)["cells"][0]
    assert c["lat"] == 10.25 and c["lon"] == 20.25


def test_negative_coordinates_grid_correctly(monkeypatch):
    _patched(monkeypatch, [_ev(-10.1, -20.1), _ev(-10.3, -20.3)])
    out = gfw.density(cell_deg=0.5)
    assert out["count"] == 1
    assert out["cells"][0]["lat"] < 0 and out["cells"][0]["lon"] < 0


def test_events_without_a_position_are_dropped(monkeypatch):
    _patched(monkeypatch, [_ev(None, 20.0), _ev(10.0, None), _ev(10.0, 20.0)])
    assert gfw.density()["events_gridded"] == 1


def test_gfw_risk_is_counted_under_its_own_name(monkeypatch):
    _patched(monkeypatch, [_ev(1.1, 1.1, risk="high"), _ev(1.2, 1.2)])
    c = gfw.density(cell_deg=0.5)["cells"][0]
    assert c["gfw_potential_risk_count"] == 1
    assert c["count"] == 2


def test_distinct_vessels_are_deduplicated(monkeypatch):
    _patched(monkeypatch, [_ev(1.1, 1.1, vessel="A"), _ev(1.2, 1.2, vessel="A"),
                           _ev(1.3, 1.3, vessel="B")])
    assert gfw.density(cell_deg=0.5)["cells"][0]["distinct_vessels"] == 2


def test_cells_are_ordered_densest_first(monkeypatch):
    _patched(monkeypatch, [_ev(1.1, 1.1), _ev(1.2, 1.2), _ev(50.1, 50.1)])
    cells = gfw.density(cell_deg=0.5)["cells"]
    assert cells[0]["count"] >= cells[-1]["count"]


def test_staleness_is_carried_through(monkeypatch):
    # An empty or thin map is a statement about GFW's publishing
    # schedule, not about the sea.
    _patched(monkeypatch, [_ev(1.0, 1.0)])
    out = gfw.density()
    assert out["lag_days"] == 3.0
    assert out["source"] == "Global Fishing Watch"


def test_a_bad_cell_size_falls_back_rather_than_dividing_by_zero(monkeypatch):
    _patched(monkeypatch, [_ev(1.0, 1.0)])
    assert gfw.density(cell_deg=0)["count"] == 1
