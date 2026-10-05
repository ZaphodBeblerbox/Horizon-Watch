"""vessel_history: a ship's 90 days, summarised from GFW entries."""
import datetime as dt

from vessel_history import identities, summarise, vessel_ids

NOW = dt.datetime(2026, 10, 5, 12, tzinfo=dt.timezone.utc)
M = "219515000"


def _port(start, name, flag):
    return {"start": start, "end": start, "port_visit": {"durationHrs": 20.3,
            "startAnchorage": {"name": None, "topDestination": name, "flag": flag, "lat": 53.6, "lon": 8.5}}}


def test_port_calls_newest_first_with_a_plain_summary():
    r = summarise({"port-visits": [_port("2026-09-26T03:56:00Z", "ROTTERDAM MAASVLAKTE", "NLD"),
                                   _port("2026-09-30T09:28:00Z", "BREMERHAVEN", "DEU")]}, [], NOW)
    assert r["port_calls"][0]["port"] == "Bremerhaven"
    assert r["summary"] == "2 port calls, last Bremerhaven · 0 meetings at sea · 0 dark periods"
    assert r["port_countries"] == ["DEU", "NLD"]
    assert r["lag_days"] == 5.1
    assert r["warnings"] == []


def test_only_gaps_gfw_calls_intentional_become_a_warning():
    gaps = [{"start": "2026-09-01T00:00:00Z", "gap": {"durationHours": 12.2, "distanceKm": "96.5", "intentionalDisabling": True}},
            {"start": "2026-09-02T00:00:00Z", "gap": {"durationHours": 30, "intentionalDisabling": False}}]
    r = summarise({"gaps": gaps}, [], NOW)
    assert r["warnings"] == ["Went dark 1 time that GFW judges intentional — longest 12 h"]
    assert len(r["dark_periods"]) == 2


def test_meetings_name_the_other_ship_and_carry_gfw_risk():
    enc = [{"start": "2026-09-10T00:00:00Z", "end": "2026-09-10T04:00:00Z", "position": {"lat": 1, "lon": 2},
            "encounter": {"vessel": {"name": "LUCHENGYU66007", "flag": "CHN", "type": "fishing", "ssvid": "412349157"},
                          "potentialRisk": True}}]
    r = summarise({"encounters": enc}, [], NOW)
    assert r["encounters"][0]["with"]["name"] == "LUCHENGYU66007"
    assert r["warnings"] == ["Met 1 vessel at sea, 1 flagged by GFW as potential risk"]


def test_identity_history_and_ids_belong_to_this_mmsi_only():
    raw = {"entries": [{"selfReportedInfo": [
        {"id": "a", "ssvid": M, "shipname": "MAERSK LAGUNA", "flag": "DNK", "transmissionDateFrom": "2016-01-01", "transmissionDateTo": "2026-10-01"},
        {"id": "b", "ssvid": M, "shipname": "SEALAND X", "flag": "LBR", "transmissionDateFrom": "2012-01-01", "transmissionDateTo": "2015-12-31"},
        {"id": "c", "ssvid": "111111111", "shipname": "OTHER", "flag": "PAN"}]}]}
    assert vessel_ids(raw, M) == ["a", "b"]
    ids = identities(raw, M)
    assert [i["name"] for i in ids] == ["SEALAND X", "MAERSK LAGUNA"]
    r = summarise({}, ids, NOW)
    assert "Has broadcast 2 names and 2 flags" in r["warnings"]
