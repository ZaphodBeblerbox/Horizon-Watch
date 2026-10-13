"""strike_events: act/actor rules, centroid handling, merge, windows, campaigns."""
import time
from datetime import datetime, timedelta, timezone

import pytest

import strike_events as se


@pytest.mark.parametrize("text,act", [
    ("Saudi-led coalition airstrikes hit Sanaa", "airstrike"),
    ("Saudi planes target Houthi positions in Saada", "airstrike"),
    ("Houthis claim missile attack on Riyadh airport", "missile"),
    ("Houthis claim missile attack on a tanker in the Red Sea", "naval"),
    ("Coalition forces take control of Hodeidah port city", "control"),
    ("Russian forces capture Pokrovsk", "control"),
    ("Ukrainian FPV drone of the 423rd Battalion hit a group of Russian infantry", "drone"),
    ("Saudi artillery shelling injures citizen in Razih", "shelling"),
    ("Saudi air defences intercept Houthi ballistic missile over Jizan", "interception"),
    ("Russian troops launch assault on Kupiansk", "assault"),
    ("A Russian strike hit the Municipal Polyclinic No. 20 in Kharkiv", "airstrike"),
    ("a Russian airstrike hit a claimed Ukrainian position utilizing an FAB-250", "airstrike"),
])
def test_classify_act(text, act):
    assert se.classify_act(text)[0] == act


def test_generic_strike_is_marked_weapon_unstated():
    act, stated = se.classify_act("A Russian strike hit the polyclinic in Kharkiv")
    assert act == "airstrike" and stated is False
    assert se.classify_act("Saudi-led coalition airstrikes hit Sanaa") == ("airstrike", True)


@pytest.mark.parametrize("text", [
    "Russia warns it will strike Kyiv", "Iran threatens to attack shipping",
    "Indian envoy attends funeral of Riyadh airport attack victim", "Parliament debates the budget",
])
def test_statements_are_not_acts(text):
    assert se.classify_act(text)[0] is None


def test_source_hints_only_when_text_is_silent():
    assert se.classify_act("Something happened near Marib", "195")[0] == "airstrike"
    assert se.classify_act("Forces shelled Marib", "195")[0] == "shelling"


@pytest.mark.parametrize("text,actor", [
    ("Saudi-led coalition airstrikes hit Sanaa", "Saudi-led coalition"),
    ("Houthis claim missile attack on Saudi airports", "Houthis"),
    ("Coalition forces take control of Hodeidah in Yemen", "Saudi-led coalition"),
    ("Bangladeshi national killed in Houthi missile attack", "Houthis"),
    ("Ansar Allah forces targeted by drone-dropped explosives from Yemeni government forces", "Yemeni government forces"),
    ("Houthi forces claim Saudi airstrikes killed six in Haradh", "Saudi-led coalition"),
    ("Houthi forces say they struck King Khalid Airport in Riyadh", "Houthis"),
    ("IDF strikes Hezbollah targets in southern Lebanon", "Israel"),
    ("Russian missile strike kills four children in Pryluky", "Russia"),
    ("Three foreign nationals killed in attacks on Saudi airports", None),
])
def test_find_actor(text, actor):
    assert se.find_actor(text) == actor


@pytest.mark.parametrize("name,canon", [
    ("KSA", "Saudi-led coalition"), ("Saudi Arabia", "Saudi-led coalition"), ("Ansar Allah", "Houthis"),
    ("the Saudi-led coalition", "Saudi-led coalition"), ("Neutral", None), ("Russia", "Russia"),
    ("UAE", "UAE"), ("Regular army", "Yemeni government forces"),
])
def test_normalise_actor(name, canon):
    assert se.normalise_actor(name) == canon


def test_coalition_grouping():
    assert se.ACTOR_SIDE["UAE"] == se.ACTOR_SIDE["Yemeni government forces"] == "Saudi-led coalition"
    assert se.ACTOR_HOME["Houthis"] == "Yemen"


def test_unit_origin_casualties():
    assert se.unit_type("the 65th Mechanized Brigade") == "armoured"
    assert se.unit_type("Russian VDV paratroopers") == "airborne"
    assert se.unit_type("Russian airstrike hit Kharkiv") is None
    assert se.origin_hint("Shahed drones launched from Kursk Oblast hit Sumy", "drone") == "Kursk Oblast"
    assert se.origin_hint("Ballistic missile fired from Yemen toward Eilat", "missile") == "Yemen"
    assert se.origin_hint("Airstrike from Yemen", "airstrike") is None
    assert se.casualties("Russian missile strike kills four children") == {"killed": 4, "injured": 0}
    assert se.casualties("12 people killed and 30 injured") == {"killed": 12, "injured": 30}


def _raw(rid, title, lat, lon, hours_ago=1, precision="city", source="Telegram", place="Sanaa, Yemen"):
    t = datetime.now(timezone.utc) - timedelta(hours=hours_ago)
    return {"rid": rid, "source": source, "title": title, "lat": lat, "lon": lon, "time": t.isoformat(),
            "place": place, "precision": precision, "country": "Yemen"}


def test_country_only_points_are_dropped():
    assert se.to_report(_raw("a", "Saudi airstrikes hit Yemen", 15.5, 48.0, precision=None)) is None
    assert se.precision_from("country") is None and se.precision_from("none") is None
    assert se.precision_from("oblast") == "region" and se.precision_from("village") == "precise"
    # a city-precision point sitting on a country centroid is a geocoder that knew only the country
    se._CENTROIDS = [(15.9, 47.6)]
    try:
        assert se.to_report(_raw("b", "Saudi airstrikes hit Yemen", 15.9, 47.6)) is None
        assert se.to_report(_raw("c", "Saudi airstrikes hit Sanaa", 15.35, 44.2)) is not None
    finally:
        se._CENTROIDS = None


def test_merge_same_act_same_place_within_24h():
    se._CENTROIDS = []
    try:
        raws = [_raw("1", "Saudi-led coalition airstrikes hit Sanaa", 15.35, 44.20, 2),
                _raw("2", "Saudi jets bomb Sanaa airport", 15.40, 44.22, 5, source="GDELT (judged)"),
                _raw("3", "Saudi airstrikes on Sanaa", 15.36, 44.21, 40),                # > 24 h later: separate
                _raw("4", "Saudi artillery shelling in Sanaa", 15.35, 44.20, 3),         # another act
                _raw("5", "Saudi airstrikes hit Marib", 15.46, 45.32, 3, place="Marib, Yemen")]  # another place
        ev = se.build(raws)
    finally:
        se._CENTROIDS = None
    air = sorted([e for e in ev if e["act"] == "airstrike"], key=lambda e: -e["source_count"])
    assert len(air) == 3
    assert air[0]["source_count"] == 2 and {s["source"] for s in air[0]["sources"]} == {"Telegram", "GDELT (judged)"}
    assert air[0]["actor"] == "Saudi-led coalition" and air[0]["actor_side"] == "Saudi-led coalition"
    assert len([e for e in ev if e["act"] == "shelling"]) == 1


def test_persistence_windows():
    assert se.WINDOW_DAYS["airstrike"] == 14 and se.WINDOW_DAYS["control"] == 30
    se._CENTROIDS = []
    try:
        ev = se.build([_raw("old-strike", "Saudi airstrikes hit Sanaa", 15.35, 44.2, 20 * 24),
                       _raw("old-control", "Coalition forces take control of Sanaa", 15.35, 44.2, 20 * 24),
                       _raw("new", "Saudi airstrikes hit Marib", 15.46, 45.32, 24, place="Marib")])
    finally:
        se._CENTROIDS = None
    acts = sorted(e["act"] for e in ev)
    assert acts == ["airstrike", "control"]          # the 20-day strike aged out, the control change did not
    ctl = next(e for e in ev if e["act"] == "control")
    assert 19 < ctl["age_days"] < 21 and ctl["window_days"] == 30


def test_campaigns_and_filters():
    now = time.time()
    evts = []
    for i, d in enumerate([0, 1, 2, 3, 9]):
        t = datetime.fromtimestamp(now - d * 86400, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        evts.append({"id": f"e{i}", "act": "airstrike", "actor": "Saudi-led coalition", "actor_side": "Saudi-led coalition",
                     "country": "Yemen", "lat": 15 + i * 0.1, "lon": 44, "time": t, "casualties": None, "campaign_id": None})
    cs = se.build_campaigns(evts)
    assert len(cs) == 1 and cs[0]["count"] == 4    # the 9-days-ago strike is past the 3-day gap
    assert all(e["campaign_id"] == cs[0]["id"] for e in evts[:4]) and evts[4]["campaign_id"] is None
    assert len(se.filter_events(evts, since="60h")) == 3
    assert len(se.filter_events(evts, acts=["missile"])) == 0
    assert len(se.filter_events(evts, actors=["KSA"])) == 5
    assert len(se.filter_events(evts, bbox=(43, 14.9, 45, 15.15))) == 2
