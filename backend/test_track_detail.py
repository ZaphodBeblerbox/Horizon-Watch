"""track_detail: dropped feed fields kept, and AIS sentinels never become values."""
import datetime as dt

from track_detail import adsb_detail, ais_position, ais_static, eta_iso, eta_stale

NOW = dt.datetime(2026, 10, 5, 12, 0, tzinfo=dt.timezone.utc)


def test_static_keeps_imo_size_draught_and_eta():
    sd = {"ImoNumber": 9275103, "Dimension": {"A": 150, "B": 30, "C": 14, "D": 14},
          "MaximumStaticDraught": 11.2, "Eta": {"Month": 10, "Day": 9, "Hour": 6, "Minute": 30}}
    assert ais_static(sd, NOW) == {"imo": "9275103", "length": 180, "beam": 28,
                                   "draught": 11.2, "eta": "2026-10-09T06:30:00Z", "eta_stale": False}


def test_static_sentinels_are_absent():
    sd = {"ImoNumber": 0, "Dimension": {"A": 0, "B": 0, "C": 0, "D": 0},
          "MaximumStaticDraught": 0, "Eta": {"Month": 0, "Day": 0, "Hour": 24, "Minute": 60}}
    assert ais_static(sd, NOW) == {}


def test_eta_is_the_nearest_occurrence_and_an_old_one_is_stale():
    assert eta_iso({"Month": 1, "Day": 3, "Hour": 0, "Minute": 0}, NOW) == "2027-01-03T00:00:00Z"
    assert eta_iso({"Month": 10, "Day": 2, "Hour": 0, "Minute": 0}, NOW) == "2026-10-02T00:00:00Z"
    # A moored ship still sending May's ETA: last May, and stale — not next May.
    may = eta_iso({"Month": 5, "Day": 10, "Hour": 10, "Minute": 0}, NOW)
    assert may == "2026-05-10T10:00:00Z" and eta_stale(may, NOW)
    assert not eta_stale("2026-10-02T00:00:00Z", NOW)


def test_position_status_and_sentinels():
    pr = {"NavigationalStatus": 1, "Cog": 210.4, "TrueHeading": 511, "RateOfTurn": -128, "PositionAccuracy": True}
    assert ais_position(pr) == {"nav_status": "at anchor", "cog": 210.4, "pos_accuracy": "high"}


def test_adsb_detail_names_fields_and_reads_flags():
    ac = {"r": "EI-DCK", "t": "B738", "squawk": "7700", "baro_rate": -1472, "nav_altitude_mcp": 22016,
          "ias": 301, "mach": 0.776, "nic": 8, "lat": 50.1, "mlat": [], "dbFlags": 8}
    d = adsb_detail(ac)
    assert d["registration"] == "EI-DCK" and d["vertical_rate"] == -1472
    assert d["selected_altitude"] == 22016 and d["squawk_meaning"] == "emergency"
    assert d["position_source"] == "ADS-B" and d["privacy"].startswith("LADD")
    assert adsb_detail({"lat": 1, "mlat": ["lat", "lon"]})["position_source"] == "multilateration"
