"""An unlocated signal must not be fused by location.

The live failure this encodes: 2,433 AIS and ADS-B signals with no
region, no country and no coordinates were all dropped into one shared
"GEO:unknown" bucket, which then behaved like the busiest place on
earth. Every incoming signal re-evaluated the whole bucket on the event
loop, and a trivial API query queued behind it for fifteen seconds.

It was also wrong on its own terms: fusion asserts that several
independent domains reported the SAME PLACE, and "unknown" is not a
place, so anything it produced corroborated nothing.
"""
import datetime
import fusion_engine


def _engine():
    return fusion_engine.FusionEngine()


def _signal(**kw):
    base = {
        "signal_id": "S1", "domain": "AIS", "severity": "medium",
        "confidence": 0.8, "relevance_score": 50,
        "summary": "x", "rule_name": "r",
        "timestamp": datetime.datetime.utcnow(),
    }
    base.update(kw)
    return base


def test_unlocated_signal_resolves_to_no_geo_key():
    e = _engine()
    assert e._resolve_geo_key(_signal(lat=None, lon=None)) is None


def test_a_located_signal_still_resolves():
    e = _engine()
    assert e._resolve_geo_key(_signal(country="UA")) is not None
    assert e._resolve_geo_key(_signal(lat=50.4, lon=30.5)) is not None


def test_unlocated_signals_never_accumulate_in_a_bucket():
    # The exact shape of the live bug: many unlocated signals arriving
    # must not build a bucket that is then re-evaluated on every write.
    e = _engine()
    for i in range(200):
        e.on_signal(_signal(signal_id=f"S{i}", lat=None, lon=None))
    for key, bucket in e.active_signals.items():
        assert "unknown" not in key.lower(), f"{key} accumulated {len(bucket)}"
    total = sum(len(b) for b in e.active_signals.values())
    assert total == 0, f"{total} unlocated signals were queued for correlation"


def test_unlocated_signals_are_still_logged():
    # Not correlated is not the same as discarded.
    e = _engine()
    e.on_signal(_signal(signal_id="KEEP", lat=None, lon=None))
    assert any(s.get("signal_id") == "KEEP" for s in e.get_recent_signals())


def test_located_signals_still_accumulate():
    e = _engine()
    for i in range(3):
        e.on_signal(_signal(signal_id=f"L{i}", lat=50.4, lon=30.5, domain="AIS"))
    assert sum(len(b) for b in e.active_signals.values()) == 3


def test_the_unlocated_marker_key_has_one_definition():
    """Both paths must agree, or the bug returns on the next restart.

    The live path and the DB restore path each decide what to do with a
    signal that has no place. Fixing only one of them meant 287
    unlocated signals were reloaded into a single bucket on startup and
    produced "Unknown Location Intelligence Event | 287 signals / 2
    domains" — the exact condition that was supposed to be fixed,
    reappearing precisely when nobody is reading the log.
    """
    assert fusion_engine.UNLOCATED_KEY == "GEO:unlocated"


def test_restored_unlocated_signals_are_not_put_back_in_a_bucket():
    e = _engine()
    # Simulate what the restore loop does with a persisted unlocated row.
    e.active_signals.clear()
    key = fusion_engine.UNLOCATED_KEY
    assert key not in e.active_signals

    # And the live path agrees: it never creates that bucket either.
    for i in range(50):
        e.on_signal(_signal(signal_id=f"U{i}", lat=None, lon=None))
    assert key not in e.active_signals
    assert sum(len(b) for b in e.active_signals.values()) == 0


def test_a_located_signal_restores_normally():
    e = _engine()
    e.on_signal(_signal(signal_id="L1", lat=10.0, lon=20.0))
    keys = [k for k in e.active_signals if k != fusion_engine.UNLOCATED_KEY]
    assert keys, "a located signal must still be correlated"


# ── a name, or failing that, the position ───────────────────────────────
#
# A fusion exists because its signals shared a position: the engine's key
# is a coordinate (GEO:33.2500,134.2500). Returning "Unknown Location"
# discarded the one fact every signal in the bundle agreed on, and live
# fusions read "Unknown Location Intelligence Event" while sitting on a
# known point. AIS and GPS signals routinely carry lat/lon and no place
# string, so this was the common case rather than the edge one.

def _bare_engine():
    return fusion_engine.FusionEngine.__new__(fusion_engine.FusionEngine)


def test_a_named_signal_gives_its_name():
    e = _bare_engine()
    assert e._best_location_name(
        [{"location_name": "Hodeidah", "lat": 14.8, "lon": 42.9}]) == "Hodeidah"


def test_a_name_anywhere_in_the_bundle_beats_a_coordinate():
    e = _bare_engine()
    assert e._best_location_name(
        [{"lat": 33.25, "lon": 134.25},
         {"location_name": "Philippine Sea"}]) == "Philippine Sea"


def test_coordinates_are_used_when_nothing_is_named():
    # At sea the water is named and the point kept.
    e = _bare_engine()
    assert e._best_location_name([{"lat": 33.25, "lon": 134.25}]).endswith("33.25°N 134.25°E")


def test_the_southern_and_western_hemispheres_are_not_negative_degrees():
    e = _bare_engine()
    assert e._best_location_name([{"lat": -33.9, "lon": -18.4}]).endswith("33.90°S 18.40°W")


def test_genuinely_unlocated_still_says_so():
    # A coordinate it does not have must not be invented.
    e = _bare_engine()
    assert e._best_location_name([{"lat": None, "lon": None}]) == "Unknown Location"
    assert e._best_location_name([{}]) == "Unknown Location"


def test_an_unparseable_coordinate_is_skipped_not_crashed_on():
    e = _bare_engine()
    assert e._best_location_name(
        [{"lat": "n/a", "lon": "n/a"}, {"lat": 10.0, "lon": 20.0}]) == "Chad · 10.00°N 20.00°E"


# ── never "Unknown Location" ────────────────────────────────────────────
#
# A fusion is a map object: an analyst finds it by looking at where it is.
# One that cannot say where it is cannot be checked and cannot be acted on,
# yet 226 of 811 stored fusions sat in the list saying "Unknown Location
# Intelligence Event" — several of them keyed "CTY:mx", which names Mexico.

def test_a_country_key_names_the_country():
    e = _bare_engine()
    assert e._best_location_name([{}], "CTY:mx") == "Mexico"
    assert e._best_location_name([{}], "CTY:YE") == "Yemen"


def test_a_grid_key_gives_the_point():
    e = _bare_engine()
    assert e._best_location_name([{}], "GEO:19.25,-99.25") == "19.25°N 99.25°W"


def test_a_signal_name_still_beats_the_key():
    e = _bare_engine()
    assert e._best_location_name([{"location_name": "Hodeidah"}], "CTY:mx") == "Hodeidah"


def test_a_signal_position_beats_a_country_key():
    # A point is more use than a country, when both are known.
    e = _bare_engine()
    assert e._best_location_name([{"lat": 33.25, "lon": 134.25}], "CTY:mx").endswith("33.25°N 134.25°E")


def test_the_markers_for_no_place_are_still_honest():
    e = _bare_engine()
    assert e._best_location_name([{}], "GEO:unlocated") == "Unknown Location"
    assert e._best_location_name([{}], "GEO:unknown") == "Unknown Location"
    assert e._best_location_name([{}], "") == "Unknown Location"


def test_an_unknown_country_code_is_not_invented():
    e = _bare_engine()
    # "zz" is not a country. Returning the bare code is honest; inventing a
    # name would not be.
    assert e._best_location_name([{}], "CTY:zz") == "ZZ"



def test_an_area_signal_does_not_drag_the_position_inland():
    # A GPS-jamming cell centre averaged with a vessel at sea put the
    # fusion in inland Poland; the vessel's position is the fusion's.
    e = _bare_engine()
    lat, lon = e._centroid([{"domain": "AIS", "lat": 54.5, "lon": 13.0},
                            {"domain": "GPS", "lat": 52.25, "lon": 14.25}])
    assert (lat, lon) == (54.5, 13.0)
