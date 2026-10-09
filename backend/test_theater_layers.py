"""Theater layer sets keep their sub-layers and context, and a theater that
does not name them does not switch them off."""
from routers.theaters import _clean_layers


def test_subs_and_context_are_kept():
    out = _clean_layers({"groups": ["news"], "subs": ["telegram", "gfw:gaps"], "context": ["risk"]})
    assert out["subs"] == ["telegram", "gfw:gaps"]
    assert out["context"] == ["risk"]


def test_absent_subs_stay_absent():
    out = _clean_layers({"groups": ["news"], "infra": [], "tracks": []})
    assert "subs" not in out and "context" not in out
    assert out["groups"] == ["news"]


def test_empty_subs_means_all_off():
    assert _clean_layers({"subs": []})["subs"] == []


def test_everything_the_panel_switches_is_kept():
    out = _clean_layers({
        "groups": ["air"], "gdeltTypes": ["Fight"], "theatres": ["ukraine"],
        "severityFloor": "high", "timeWindow": "72h",
        "vessel": {"types": ["tanker"], "flags": None},
        "aircraft": {"kinds": None, "airlines": ["Emirates"], "countries": None},
    })
    assert out["gdeltTypes"] == ["Fight"] and out["theatres"] == ["ukraine"]
    assert out["severityFloor"] == "high" and out["timeWindow"] == "72h"
    assert out["vessel"] == {"types": ["tanker"], "flags": None}
    assert out["aircraft"]["airlines"] == ["Emirates"] and out["aircraft"]["kinds"] is None
