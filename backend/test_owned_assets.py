import datetime as dt

import pytest

import owned_assets as oa

NOW = dt.datetime(2026, 10, 6, 12, tzinfo=dt.timezone.utc)
AT = {"lat": 25.0, "lon": 55.0}


def _it(i, km_north, hours_ago, sev, title=None):
    return {"id": i, "title": title or i, "lat": 25.0 + km_north / 111.0, "lon": 55.0, "severity": sev,
            "when": (NOW - dt.timedelta(hours=hours_ago)).isoformat()}


def test_rank_by_severity_distance_and_age_inside_the_radius_only():
    items = [_it("far", 60, 1, "critical"), _it("near-high", 5, 2, "high"), _it("near-crit", 10, 2, "critical"),
             _it("old", 3, 100, "critical"), _it("edge-low", 29, 1, "low"), _it("dup", 6, 3, "high", title="near-high")]
    r = oa.rank(AT, 30, items, now=NOW)
    assert [x["id"] for x in r] == ["near-crit", "near-high", "edge-low"]   # far and old dropped, the repeat folded
    assert oa.exposure(r) == "high"
    assert oa.exposure([]) == "quiet"


def test_clean_checks_what_a_client_sends():
    with pytest.raises(ValueError):
        oa.clean({"name": "X", "kind": "spaceship", "lat": 1, "lon": 1})
    with pytest.raises(ValueError):
        oa.clean({"name": "Office", "kind": "office"})                      # a fixed asset needs a place
    v = oa.clean({"name": "MT Aurora", "kind": "vessel_tanker", "identifiers": {"mmsi": "636092345", "foo": "x"}})
    assert v["identifiers"] == {"mmsi": "636092345"}
    with pytest.raises(ValueError):
        oa.clean({"name": "MT B", "kind": "vessel_tanker", "identifiers": {"mmsi": "ABC"}})


def test_position_prefers_live_then_recorded():
    a = {"kind": "vessel_tanker", "identifiers": {"mmsi": "1"}, "lat": 1.0, "lon": 2.0, "updated_at": "t"}
    live = oa.position(a, live_vessel=lambda m: {"lat": 25.1, "lon": 55.2, "speed": 11})
    assert live["source"] == "AIS, live" and live["lat"] == 25.1
    rec = oa.position(a, live_vessel=lambda m: None)
    assert rec["source"] == "last recorded position" and rec["lat"] == 1.0


def test_the_model_may_only_cite_what_it_was_given():
    raw = {"impact": "Port access restricted [a1].", "one_line": "x",
           "could_affect": [{"what": "Houthi drone strike on Ras Isa", "why": "[a2] claims", "watch_for": "x", "by": "2026-10-10"},
                            {"what": "Generic risk", "why": "general tension"}],
           "measures": [{"action": "Delay the call", "why": "[a1]"}, {"action": "Pray", "why": "[z9]"}]}
    out = oa.cited_only(raw, {"a1", "a2"})
    assert [c["what"] for c in out["could_affect"]] == ["Houthi drone strike on Ras Isa"]
    assert [m["action"] for m in out["measures"]] == ["Delay the call"]


def test_register_round_trip(tmp_path, monkeypatch):
    monkeypatch.setattr(oa, "_db_path", lambda: str(tmp_path / "a.db"))
    a = oa.create("u1", {"name": "Jebel Ali office", "kind": "office", "lat": 25.0, "lon": 55.06, "importance": "high"})
    assert a["radius_km"] == 15 and a["group"] == "Sites"
    assert oa.get(a["id"], "u2") is None                                  # not shared
    oa.update(a["id"], "u1", {"shared": True})
    assert oa.get(a["id"], "u2")["name"] == "Jebel Ali office"
    assert oa.update(a["id"], "u2", {"name": "x"}) is None                # only the owner edits
    assert oa.delete(a["id"], "u1") and oa.list_for("u1") == []


def test_generic_advice_is_dropped():
    raw = {"impact": "x [a1]", "could_affect": [{"what": "Escalation of violence", "why": "[a1]"},
                                              {"what": "Coalition air strikes on northern Sanaa", "why": "[a1]"}],
           "measures": [{"action": "Monitor local news", "why": "[a1]"},
                        {"action": "Keep the 12 staff home until 48 hours pass without strikes", "why": "[a1]"}]}
    out = oa.cited_only(raw, {"a1"})
    assert [c["what"] for c in out["could_affect"]] == ["Coalition air strikes on northern Sanaa"]
    assert [m["action"] for m in out["measures"]] == ["Keep the 12 staff home until 48 hours pass without strikes"]


def test_a_story_restated_with_new_numbers_is_one_item():
    items = [_it("a", 5, 2, "high", "GPS degraded over the Gulf — 6 of 23 aircraft (26%)"),
             _it("b", 6, 3, "high", "GPS degraded over the Gulf — 4 of 16 aircraft (25%)")]
    assert len(oa.rank(AT, 30, items, now=NOW)) == 1
