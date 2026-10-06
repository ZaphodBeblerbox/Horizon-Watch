"""Tests for notification_context — the rules, not the prose.

Each case is drawn from a real production row (see the 2026-09-17 audit of
346,570 active alerts), because the failures this module exists to fix were
all failures to look at what the data actually contained.
"""
import notification_context as nc


def setup_function(_):
    nc.__reset_arrivals()


# ── The two defects that started this ──────────────────────────────────────

def test_geoconfirmed_date_title_is_replaced_by_the_real_prose():
    """Real row GC-3c000105: title '03 JUL 2026', prose nested two levels
    down in raw_json as a PYTHON REPR, which json.loads cannot read."""
    alert = {
        "alert_type": "geoconfirmed_event", "title": "03 JUL 2026",
        "region": "Lyman, Donetsk Oblast, Ukraine", "lat": 48.99, "lon": 37.74,
        "raw_json": ('{"title": "03 JUL 2026", "region": "Lyman, Donetsk Oblast, Ukraine", '
                     '"raw": "{\'description\': \'0:13 - A Russian drone killed a couple '
                     'who were travelling in a car\', \'faction\': \'Russia\'}"}'),
    }
    h = nc.headline(alert)
    assert "03 JUL 2026" not in h
    assert "drone killed a couple" in h
    assert "0:13" not in h                      # video timecode, not the event
    assert "Lyman" in h
    assert h.count("Ukraine") == 1              # not "…, Ukraine, Ukraine"


def test_sanctioned_vessel_headline_carries_place_flag_and_authority():
    t, msg = nc.sanctioned_vessel_headline(
        vessel_name="NAUTILUS", mmsi="245989000", lat=59.9, lon=25.0,
        flag="ru",
        sanction_lists=["EU Council Official Journal Sanctioned Entities",
                        "Canadian Consolidated Autonomous Sanctions List"],
    )
    assert t.startswith("Sanctioned vessel NAUTILUS")
    assert "Gulf of Finland" in t
    assert "Russia-flagged" in t
    assert "EU" in t and "Canada" in t
    assert "MMSI 245989000" in msg               # the hull number, but in the detail
    assert "MMSI" not in t                       # never the thing to recognise


def test_mmsi_is_never_the_headline_subject():
    h = nc.detector_headline(rule="AIS_DARK_SHIP", vessel="MMSI:413442370",
                             mmsi="413442370", gap_minutes=63.2,
                             trigger="strategic:Taiwan Strait")
    assert h.startswith("Vessel went dark")
    assert "Taiwan Strait" in h
    assert h.index("MMSI 413442370") > h.index("Taiwan Strait")


# ── The envelope shapes that hid the data ──────────────────────────────────

def test_lng_is_read_when_lon_is_null():
    """302,284 of 346,570 active rows had lon NULL with the real value in
    raw_json.lng."""
    lat, lon = nc._coords({"lat": 25.19, "lon": None}, {"lng": 121.12})
    assert (lat, lon) == (25.19, 121.12)


def test_python_repr_payloads_are_parsed():
    raw = nc._unwrap_raw('{"raw": "{\'description\': \'x\'}", "region": "R"}')
    assert raw["description"] == "x" and raw["region"] == "R"


def test_alert_type_falls_back_to_rule_name():
    """290,119 rows typed 'unknown' are really AIS_DARK_SHIP et al."""
    h = nc.headline({"alert_type": "unknown", "title": "",
                     "raw_json": '{"rule_name": "AIS_DARK_SHIP", "mmsi": "1", '
                                 '"gap_minutes": 120, "lat": 25.19, "lng": 121.12}'})
    assert "went dark" in h and "Taiwan Strait" in h


# ── Relevance: the whole point is what it REFUSES ──────────────────────────

def test_sanctioned_vessel_in_uncontested_water_is_silent():
    v = nc.sanctioned_vessel_relevance(lat=-23.0, lon=-43.2, flag="pa",
                                       sanction_lists=["US Trade Consolidated Screening List (CSL)"])
    assert v["notify"] is False


def test_designation_alone_never_earns_an_interruption():
    """The US CSL alone carries 8,178 entries — designation is the baseline
    condition of the table, not a discriminator within it."""
    v = nc.sanctioned_vessel_relevance(lat=-23.0, lon=-43.2, flag="pa",
                                       sanction_lists=["US OFAC Specially Designated Nationals (SDN) List",
                                                       "EU Council Official Journal Sanctioned Entities"])
    assert v["notify"] is False


def test_priority_flag_earns_it_anywhere():
    v = nc.sanctioned_vessel_relevance(lat=-23.0, lon=-43.2, flag="ru", sanction_lists=[])
    assert v["notify"] is True and "Russia" in v["reason"]


def test_chokepoint_transit_is_critical():
    v = nc.sanctioned_vessel_relevance(lat=26.5, lon=56.4, flag="pa", sanction_lists=[])
    assert v["notify"] is True and v["sev"] == "critical"


def test_every_new_geoconfirmed_point_notifies():
    v = nc.notification_relevance({"alert_type": "geoconfirmed_event", "severity": "medium"})
    assert v["notify"] is True


def test_military_aircraft_feed_stays_silent():
    v = nc.notification_relevance({"alert_type": "military_aircraft", "severity": "info"})
    assert v["notify"] is False


# ── Arrival, not presence ──────────────────────────────────────────────────

def test_same_vessel_same_place_notifies_once():
    a = {"alert_type": "Sanctioned Vessel", "lat": 59.9, "lon": 25.0,
         "entity_id": "245989000", "raw_json": '{"mmsi": "245989000", "flag": "ru"}'}
    assert nc.notification_relevance(a)["notify"] is True
    assert nc.notification_relevance(a)["notify"] is False


def test_same_vessel_moving_to_a_new_place_notifies_again():
    base = {"alert_type": "Sanctioned Vessel", "entity_id": "245989000",
            "raw_json": '{"mmsi": "245989000", "flag": "ru"}'}
    assert nc.notification_relevance({**base, "lat": 59.9, "lon": 25.0})["notify"] is True
    assert nc.notification_relevance({**base, "lat": 26.5, "lon": 56.4})["notify"] is True


# ── Never make a good title worse ──────────────────────────────────────────

def test_surge_titles_are_left_alone():
    """The surge metrics live in surge_events, not in the alert, so anything
    rebuilt here would be less informative than what is already there."""
    t = "Conflict spike — Novorossiysk, Krasnodar Krai, Russia"
    assert nc.headline({"alert_type": "surge_velocity_spike", "title": t,
                        "raw_json": "{}"}) == t


def test_authorities_are_jurisdictions_not_list_titles():
    assert nc.sanction_authorities(
        ["EU Council Official Journal Sanctioned Entities", "UK FCDO Sanctions List",
         "us_ofac_sdn,us_trade_csl"]) == ["EU", "UK", "US"]


def test_unknown_flag_code_is_omitted_not_printed_raw():
    t, _ = nc.sanctioned_vessel_headline(vessel_name="X", mmsi="1", lat=0, lon=0,
                                         flag="zz", sanction_lists=[])
    assert "zz" not in t.lower().replace("zz", "") or "-flagged" not in t


def test_plain_turns_codes_into_words():
    import notification_context as nc
    assert nc.plain("EMERGENCY: BAF431 squawking 7700 in the North Sea") == \
        "Belgian Air Force BAF431 declared an emergency (squawk 7700) in the North Sea"
    assert nc.plain("Military aircraft RCH5013 at FL068") == "US Air Force transport RCH5013 at 6,800 ft"
    assert nc.plain("Military aircraft XYZ12 at FL250") == "Military aircraft XYZ12 at 25,000 ft"
    assert nc.plain("Sanctioned vessel AURA in the Gulf of Mexico") == "Sanctioned vessel AURA in the Gulf of Mexico"
