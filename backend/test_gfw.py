"""GFW event normalisation.

The network calls are not exercised here; the shaping is, because that
is where a field quietly goes missing and nobody notices until the map
is drawing events with no vessel on them.
"""
import datetime as dt
import gfw


ENCOUNTER = {
    "start": "2026-09-17T21:40:00.000Z",
    "end": "2026-09-17T23:50:00.000Z",
    "id": "bbc80eab.1",
    "type": "encounter",
    "position": {"lat": 10.3801, "lon": 109.1243},
    "regions": {"eez": ["8484"], "highSeas": []},
    "distances": {"startDistanceFromShoreKm": 21, "startDistanceFromPortKm": 167.9},
    "vessel": {"name": "XNOI 93 P8 C794%", "ssvid": "574200823",
               "flag": "VNM", "type": "fishing"},
    "encounter": {
        "vessel": {"name": "LXU NOI 93", "ssvid": "574093314",
                   "flag": "VNM", "type": "fishing"},
        "medianDistanceKilometers": 0.022,
        "type": "fishing-fishing",
        "potentialRisk": False,
    },
}


class TestNormalise:
    def test_keeps_both_vessels_in_an_encounter(self):
        e = gfw.normalise(ENCOUNTER, "encounters")
        assert len(e["vessels"]) == 2
        assert {v["mmsi"] for v in e["vessels"]} == {"574200823", "574093314"}
        assert {v["flag"] for v in e["vessels"]} == {"VNM"}

    def test_passes_a_mangled_name_through_unchanged(self):
        # AIS names are self-reported and often garbage. Tidying one
        # into something readable makes it look more trustworthy than
        # it is.
        e = gfw.normalise(ENCOUNTER, "encounters")
        names = [v["name"] for v in e["vessels"]]
        assert "XNOI 93 P8 C794%" in names

    def test_carries_position_and_context(self):
        e = gfw.normalise(ENCOUNTER, "encounters")
        assert (round(e["lat"], 3), round(e["lon"], 3)) == (10.380, 109.124)
        assert e["km_from_shore"] == 21
        assert e["eez"] == ["8484"]
        assert e["high_seas"] is False

    def test_keeps_gfws_risk_flag_under_gfws_name(self):
        # It is their assessment, not ours, and the key says so.
        e = gfw.normalise(ENCOUNTER, "encounters")
        assert e["gfw_potential_risk"] is False
        assert "risk" not in e

    def test_drops_an_event_with_no_position(self):
        # Nothing on a map can be done with it, and (0,0) is a real
        # place in the Gulf of Guinea.
        for bad in ({}, {"position": {}}, {"position": {"lat": None, "lon": 5}},
                    {"position": {"lat": "x", "lon": "y"}}):
            assert gfw.normalise(bad, "encounters") is None

    def test_survives_an_event_with_one_vessel(self):
        one = {"id": "a", "type": "loitering", "position": {"lat": 1, "lon": 2},
               "vessel": {"name": "SOLO", "ssvid": "1", "flag": "PAN"}}
        e = gfw.normalise(one, "loitering")
        assert len(e["vessels"]) == 1
        assert e["vessels"][0]["name"] == "SOLO"

    def test_ignores_junk(self):
        assert gfw.normalise(None, "encounters") is None
        assert gfw.normalise("nope", "encounters") is None


class TestLagDays:
    def test_reports_how_far_behind_the_newest_event_is(self):
        # GFW publishes days behind real time. "No encounters this
        # week" is otherwise read as a fact about the sea.
        old = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=4)).isoformat()
        assert gfw._lag_days([{"start": old}]) == 4.0

    def test_is_none_when_there_is_nothing_to_measure(self):
        assert gfw._lag_days([]) is None
        assert gfw._lag_days([{"start": "not-a-date"}]) is None

    def test_never_negative(self):
        future = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=2)).isoformat()
        assert gfw._lag_days([{"start": future}]) == 0.0


class TestEvents:
    def test_rejects_an_unknown_kind_without_calling_out(self):
        d = gfw.events(kind="submarines")
        assert d["available"] is False
        assert "submarines" in d["error"]
        assert d["events"] == []

    def test_names_the_kinds_it_does_know(self):
        d = gfw.events(kind="submarines")
        assert set(d["kinds"]) == {"encounters", "loitering", "gaps", "port-visits"}
