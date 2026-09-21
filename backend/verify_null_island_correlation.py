"""
Regression test for a real bug in the cross-domain correlation / convergence
code: a vessel or aircraft with NO reported position was silently treated as
being at (0, 0) — "Null Island", in the Gulf of Guinea — and then correlated
against real news events as if that fabricated position were a real
observation.

Concrete mechanism:

  * `_AIS_VESSELS[mmsi]` can be created from an AIS "ShipStaticData" message
    alone (name/type/callsign), with no "lat"/"lon" key at all — the matching
    "PositionReport" message that would set real coordinates may not have
    arrived yet. See main.py's AIS websocket handler: ShipStaticData sets
    ship_type/name/callsign but never touches lat/lon.
  * `_GLOBAL_ADSB_CACHE[hex_id]["lat"/"lon"]` is set directly from the
    adsb.lol feed's `ac.get("lat")` / `ac.get("lon")`, which is `None` for
    aircraft the feed has not yet resolved a position for.
  * `_cross_domain_correlation()` (main.py) used to compute
    `vessel.get('lat', 0) or 0` / `ac.get('lat', 0) or 0` — collapsing a
    missing position to literal (0, 0) — and then measured the haversine
    distance from that fabricated point to a real news event's coordinates,
    flagging "nearby military vessel/aircraft" if the distance was small.
  * `ADSBLoiterDetector.check()` (detectors/correlation_engine.py) had the
    same `ac.get("lat") or ac.get("latitude") or 0` fallback feeding straight
    into a distance-to-airport calculation with no guard, so a position-less
    aircraft could be reported "loitering" near any airport that happens to
    sit close to real (0, 0).

This test constructs a vessel and an aircraft with no position at all, plus
a real news event and a real airport located close to true (0, 0), and
asserts neither produces a false "correlated"/"loitering" hit.
"""
import os
import sys
from datetime import datetime, timezone

# Note: main.py's DATA_DIR is hardcoded to backend/data (or /var/lib/railway)
# and does not actually read a DATA_DIR env var, so — like the other test_*
# scripts in this directory — this runs against the real backend/data dir.
# Everything below is pure in-memory manipulation of module dicts
# (_AIS_VESSELS / _GLOBAL_ADSB_CACHE / _NEWS_CONFLICT_MARKERS) and read-only
# calls; it writes nothing to the DB.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import main  # noqa: E402

FAILURES = []


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


print("=" * 70)
print("  Null-Island fabricated-position correlation — regression test")
print("=" * 70)

# ── Part 1: _cross_domain_correlation must not correlate position-less
#            vessels/aircraft against a real news event ───────────────────
now_iso = datetime.now(timezone.utc).isoformat()

main._NEWS_CONFLICT_MARKERS.clear()
main._NEWS_CONFLICT_MARKERS.append({
    "timestamp": now_iso,
    "severity": "critical",
    # A real news event sitting close to true Null Island (Gulf of Guinea) —
    # exactly the scenario where the old (0, 0) fallback would falsely
    # "correlate" against it.
    "lat": 1.0, "lon": 1.0,
    "title": "Test security incident near the Gulf of Guinea",
    "url": "https://example.test/incident",
    "source": "test",
})

with main._AIS_LOCK:
    main._AIS_VESSELS.clear()
    # A military-type vessel (ship_type 35) known only from ShipStaticData —
    # no PositionReport has ever arrived, so it has no "lat"/"lon" key.
    main._AIS_VESSELS["999000001"] = {
        "mmsi": "999000001",
        "name": "TEST NO-POSITION WARSHIP",
        "ship_type": 35,
    }

main._GLOBAL_ADSB_CACHE.clear()
main._GLOBAL_ADSB_CACHE["TESTHEX1"] = {
    "hex": "TESTHEX1",
    "icao": "TESTHEX1",
    "flight": "TESTMIL1",
    "military": True,
    "lat": None,
    "lon": None,
}

results = main._cross_domain_correlation(now_iso)
check(
    "position-less vessel/aircraft produce NO cross-domain correlation",
    len(results) == 0,
    f"got {len(results)} correlation(s): {results}",
)

# Sanity check: a vessel/aircraft WITH a real position near the news event
# still correlates (proves this isn't just a broken/no-op function).
with main._AIS_LOCK:
    main._AIS_VESSELS["999000002"] = {
        "mmsi": "999000002",
        "name": "TEST REAL-POSITION WARSHIP",
        "ship_type": 35,
        "lat": 1.05, "lon": 1.05,
    }
results2 = main._cross_domain_correlation(now_iso)
check(
    "vessel WITH a real nearby position still correlates (sanity check)",
    len(results2) == 1 and results2[0]["correlated_data"]["vessels"],
    f"got {results2}",
)

with main._AIS_LOCK:
    main._AIS_VESSELS.clear()
main._GLOBAL_ADSB_CACHE.clear()
main._NEWS_CONFLICT_MARKERS.clear()


# ── Part 2: ADSBLoiterDetector must not report a position-less aircraft as
#            "loitering" near an airport close to true (0, 0) ─────────────
from detectors.correlation_engine import ADSBLoiterDetector  # noqa: E402

detector = ADSBLoiterDetector()
aircraft = {
    "TESTHEX2": {
        "lat": None, "lon": None,   # no fix at all
        "speed": 0.0,               # would look "loitering-slow" if treated as real
        "callsign": "TESTNOPOS",
    }
}
rules = [{
    "id": 1, "enabled": True,
    "params": {
        "target": "ALL",
        "proximity_km": 500,   # generous, to make the bug easy to trigger if present
        "min_duration_minutes": 0,
        "max_speed_knots": 200,
    },
}]


def _airports_fn(region_id=None, types=None):
    # A real airport close to true Null Island (Gulf of Guinea coast).
    return [{
        "system_id": "TEST_APT_NULLISLAND", "ident": "TNUL",
        "icao_code": "TNUL", "airport_name": "Test Airport Near Null Island",
        "lat": 0.5, "lon": 0.5, "airport_type": "large_airport",
    }]


alerts = detector.check(aircraft, rules, datetime.now(timezone.utc), airports_fn=_airports_fn)
check(
    "position-less aircraft is NOT tracked/alerted as loitering near an airport",
    len(alerts) == 0 and len(detector._tracking) == 0,
    f"got alerts={alerts} tracking={detector._tracking}",
)

# Sanity check: an aircraft WITH a real position near that same airport does
# get tracked (proves the detector still works at all).
aircraft_real = {
    "TESTHEX3": {"lat": 0.51, "lon": 0.51, "speed": 0.0, "callsign": "TESTREALPOS"}
}
alerts2 = detector.check(aircraft_real, rules, datetime.now(timezone.utc), airports_fn=_airports_fn)
check(
    "aircraft WITH a real nearby position IS tracked (sanity check)",
    len(detector._tracking) == 1,
    f"tracking={detector._tracking}",
)

print("=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
else:
    print("  RESULT: ALL CHECKS PASSED")
print("=" * 70)

if __name__ == "__main__":
    sys.exit(1 if FAILURES else 0)
