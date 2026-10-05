"""fusion_title: a headline from the member signals, never a coordinate and a category."""
from fusion_title import headline, is_template, place_from


def test_sanctioned_vessel_amid_jamming_named_by_the_sea_it_is_in():
    sigs = ["gps_interference: Satellite navigation degraded over the North Sea — 5 of 38 aircraft without a fix",
            "Sanctioned Vessel: Sanctioned vessel MIDEA in the North Sea — Marshall Islands-flagged, listed by U"]
    assert headline(sigs, "53.75°N 3.75°E") == "Sanctioned vessel MIDEA amid GPS jamming — North Sea"


def test_several_sanctioned_vessels_are_counted():
    sigs = ["Sanctioned Vessel: Sanctioned vessel GREENDALE in the Black Sea — Belize-flagged",
            "Sanctioned Vessel: Sanctioned vessel BLUE in the Black Sea — Cameroon-flagged",
            "gps_interference: Satellite navigation degraded over the Black Sea — 15 of 96"]
    assert headline(sigs, "41.75°N 28.25°E") == "2 sanctioned vessels amid GPS jamming — Black Sea"


def test_jamming_alone_and_dict_signals():
    sigs = [{"rule_name": "gps_interference", "summary": "Satellite navigation degraded over the North Sea — 8 of 12"}]
    assert headline(sigs) == "GPS jamming — North Sea"


def test_a_coordinate_is_never_the_place():
    assert place_from(["x: something happened"], "53.75°N 3.75°E") is None
    assert place_from(["x: something happened"], "Moldova") == "Moldova"
    assert is_template("53.75°N 3.75°E Intelligence Event")
    assert not is_template("Sanctioned vessel MIDEA — North Sea")
