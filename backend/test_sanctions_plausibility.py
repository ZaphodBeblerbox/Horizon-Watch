"""
Verification script for:

1. `check_sanctions_for_vessel()` (backend/sanctions_loader.py) — the single
   shared "is this vessel sanctioned" check now used by all 3 call sites
   that can each independently produce a "Sanctioned Vessel"-type alert:
     - main.py's `_check_sanctions_on_update()`        (per AIS position update)
     - main.py's ship-to-ship-transfer detection block  (per STS candidate pair)
     - detectors/correlation_engine.py's `_check_sanctions_hit()`
       (DarkShipDetector.scan — currently dead code, but kept correct)
   Confirms the fuzzy-name gate, the flag-plausibility corroboration
   (`_sanctions_hit_is_plausible`, also now living in sanctions_loader.py),
   and the shared cooldown, plus that each of the 3 real call sites actually
   routes through it (no more copy-pasted per-site gates).

2. The fabricated lat/lon default found during the audit
   (`float(vessel.get("lat") or 0)` in `_check_sanctions_hit`, with no
   follow-up guard) — a vessel with no reported position must come back as
   lat=None/lon=None, not a fake (0, 0) "Null Island" position.

3. The missing-speed/heading "fabricated default" fix — a vessel dict with
   speed=None / heading=None must not crash, and must not be silently
   treated as "stopped" / "heading 0", in
   backend/detectors/ais_detector.py's check_loitering() /
   check_port_loitering(). (Unrelated to sanctions consolidation — kept from
   the prior round of this test, unchanged, to confirm no regression.)

This is a plain unit test of Python functions/classes with synthetic dicts
and monkeypatched module attributes — no FastAPI TestClient / DB fixtures
needed for the spy-based parts (site 1 and site 3's DB write is monkeypatched
out too, so this writes nothing to the real DB).

Usage:
    cd backend
    python3 test_sanctions_plausibility.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))

import asyncio
import inspect
from datetime import datetime, timedelta, timezone

FAILURES = []


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


print("=" * 70)
print("  Sanctions consolidation + plausibility + speed/heading — verification")
print("=" * 70)

# ─────────────────────────────────────────────────────────────────────────
# Part 1a: check_sanctions_for_vessel() — direct unit checks
# ─────────────────────────────────────────────────────────────────────────
import sanctions_loader as _sl_module
from sanctions_loader import (
    check_sanctions_for_vessel,
    _sanctions_hit_is_plausible,
    _sanctions_alert_cooldown,
)

_ORIGINAL_CHECK_VESSEL = _sl_module.sanctions_loader.check_vessel


def _fake_check_vessel(hit_to_return):
    """Stand-in for sanctions_loader.check_vessel() that always reports the
    given hit (or None) regardless of the mmsi/imo/name args."""
    def _fn(mmsi=None, imo=None, name=None):
        return dict(hit_to_return) if hit_to_return is not None else None
    return _fn


def _reset_cooldown(mmsi):
    _sanctions_alert_cooldown.pop(mmsi, None)


print("\n-- _sanctions_hit_is_plausible: direct unit checks --")
check(
    "matching flags (exact) -> plausible",
    _sanctions_hit_is_plausible({"flag": "IR"}, {"flag": "IR"}) is True,
)
check(
    "matching flags (case/whitespace differences) -> plausible",
    _sanctions_hit_is_plausible({"flag": " ir "}, {"flag": "IR"}) is True,
)
check(
    "clearly different flags -> NOT plausible",
    _sanctions_hit_is_plausible({"flag": "IR"}, {"flag": "PA"}) is False,
)
check(
    "hit flag known, live flag missing -> plausible (can't contradict)",
    _sanctions_hit_is_plausible({"flag": "IR"}, {}) is True,
)
check(
    "hit flag missing, live flag known -> plausible (can't contradict)",
    _sanctions_hit_is_plausible({}, {"flag": "IR"}) is True,
)
check(
    "both flags missing -> plausible (can't contradict)",
    _sanctions_hit_is_plausible({}, {}) is True,
)
check(
    "live flag falls back to vessel['country'] when 'flag' absent",
    _sanctions_hit_is_plausible({"flag": "KP"}, {"country": "kp"}) is True,
)

print("\n-- check_sanctions_for_vessel: end-to-end scenarios --")

# (a) Hard match (mmsi), live flag agrees with the sanctions record ->
#     "confirmed".
mmsi_a = "111000001"
_reset_cooldown(mmsi_a)
_sl_module.sanctions_loader.check_vessel = _fake_check_vessel({
    "_match_type": "mmsi", "name": "MV DPRK GHOST", "flag": "KP", "imo": "1234567",
})
result_a = check_sanctions_for_vessel(mmsi=mmsi_a, name="MV DPRK GHOST", vessel={"flag": "KP"})
check("(a) hard match + flag agrees -> produces a result", result_a is not None, result_a)
if result_a:
    check("(a) hard match + flag agrees -> status is 'confirmed'", result_a["status"] == "confirmed", result_a)
    check("(a) result carries the raw hit dict", result_a["hit"].get("_match_type") == "mmsi", result_a)
    check("(a) result carries a display vessel_name", result_a["vessel_name"] == "MV DPRK GHOST", result_a)

# (b) Hard match (imo), live flag CLEARLY disagrees with the sanctions
#     record's flag -> "possible" (downgraded).
mmsi_b = "111000002"
_reset_cooldown(mmsi_b)
_sl_module.sanctions_loader.check_vessel = _fake_check_vessel({
    "_match_type": "imo", "name": "MV REFLAGGED", "flag": "KP", "imo": "7654321",
})
result_b = check_sanctions_for_vessel(mmsi=mmsi_b, name="MV REFLAGGED", vessel={"flag": "PA"})
check("(b) hard match + flag disagrees -> still produces a result (not silently dropped)", result_b is not None, result_b)
if result_b:
    check("(b) hard match + flag disagrees -> status is 'possible'", result_b["status"] == "possible", result_b)

# (c) Hard match, flag unknown on the live side (or both sides) -> can't
#     corroborate OR contradict, so the missing-data policy fires
#     "confirmed" rather than inventing a rule for data we don't have.
mmsi_c = "111000003"
_reset_cooldown(mmsi_c)
_sl_module.sanctions_loader.check_vessel = _fake_check_vessel({
    "_match_type": "mmsi", "name": "MV NOFLAG", "flag": "RU",
})
result_c = check_sanctions_for_vessel(mmsi=mmsi_c, name="MV NOFLAG", vessel={})  # no flag/country
check("(c) hard match + unknown live flag -> still produces a result", result_c is not None, result_c)
if result_c:
    check("(c) hard match + unknown live flag -> status is 'confirmed' (missing-data policy)", result_c["status"] == "confirmed", result_c)

mmsi_c2 = "111000103"
_reset_cooldown(mmsi_c2)
_sl_module.sanctions_loader.check_vessel = _fake_check_vessel({
    "_match_type": "mmsi", "name": "MV NEITHER-FLAG-KNOWN",
})
result_c2 = check_sanctions_for_vessel(mmsi=mmsi_c2, name="MV NEITHER-FLAG-KNOWN", vessel=None)
check("(c2) hard match + no vessel dict at all -> still produces a result", result_c2 is not None, result_c2)
if result_c2:
    check("(c2) hard match + no vessel dict at all -> status is 'confirmed'", result_c2["status"] == "confirmed", result_c2)

# (d) fuzzy_name-only hit -> no hit at all (matches pre-existing behavior at
#     all 3 sites).
mmsi_d = "111000004"
_reset_cooldown(mmsi_d)
_sl_module.sanctions_loader.check_vessel = _fake_check_vessel({
    "_match_type": "fuzzy_name", "name": "MV SIMILAR", "flag": "IR",
})
result_d = check_sanctions_for_vessel(mmsi=mmsi_d, name="MV SOMEWHAT SIMILAR", vessel={"flag": "IR"})
check("(d) fuzzy_name match -> no result at all", result_d is None, result_d)

# (e) No hit at all.
mmsi_e = "111000005"
_reset_cooldown(mmsi_e)
_sl_module.sanctions_loader.check_vessel = _fake_check_vessel(None)
result_e = check_sanctions_for_vessel(mmsi=mmsi_e, name="MV CLEAN", vessel={"flag": "US"})
check("(e) no sanctions hit -> no result at all", result_e is None, result_e)

# (f) Shared cooldown: a second check for the same mmsi within the cooldown
#     window returns None even though the underlying hit is still there.
mmsi_f = "111000006"
_reset_cooldown(mmsi_f)
_sl_module.sanctions_loader.check_vessel = _fake_check_vessel({
    "_match_type": "mmsi", "name": "MV COOLDOWN TEST", "flag": "KP",
})
first_hit  = check_sanctions_for_vessel(mmsi=mmsi_f, name="MV COOLDOWN TEST", vessel={"flag": "KP"})
second_hit = check_sanctions_for_vessel(mmsi=mmsi_f, name="MV COOLDOWN TEST", vessel={"flag": "KP"})
check("(f) first check within cooldown window produces a result", first_hit is not None, first_hit)
check("(f) immediate second check for same mmsi is suppressed by shared cooldown", second_hit is None, second_hit)
_reset_cooldown(mmsi_f)
third_hit = check_sanctions_for_vessel(mmsi=mmsi_f, name="MV COOLDOWN TEST", vessel={"flag": "KP"})
check("(f) resetting cooldown lets the same mmsi produce a result again", third_hit is not None, third_hit)

# Restore the real check_vessel so nothing else in the process is affected.
_sl_module.sanctions_loader.check_vessel = _ORIGINAL_CHECK_VESSEL


# ─────────────────────────────────────────────────────────────────────────
# Part 1b: site 3 — detectors/correlation_engine.py's _check_sanctions_hit
# delegates to the shared function, and no longer fabricates a (0, 0)
# position for a vessel with no reported lat/lon.
# ─────────────────────────────────────────────────────────────────────────
print("\n-- site 3 (_check_sanctions_hit / DarkShipDetector) routes through the shared function --")
from detectors.correlation_engine import _check_sanctions_hit

_spy_calls = []


def _spy_check_shared_confirmed(mmsi=None, name=None, vessel=None):
    _spy_calls.append({"mmsi": mmsi, "name": name, "vessel": vessel})
    return {"status": "confirmed", "hit": {"_match_type": "mmsi", "flag": "KP"}, "mmsi": mmsi, "vessel_name": name or mmsi}


_sl_module.check_sanctions_for_vessel = _spy_check_shared_confirmed
_spy_calls.clear()
alert3 = _check_sanctions_hit("222000001", {"name": "MV DARKSHIP", "lat": 39.0, "lon": 125.7})
check("site 3 calls the shared check_sanctions_for_vessel exactly once", len(_spy_calls) == 1, _spy_calls)
if _spy_calls:
    check("site 3 forwards mmsi correctly", _spy_calls[0]["mmsi"] == "222000001", _spy_calls[0])
check("site 3 produces a confirmed/critical alert when the shared function says 'confirmed'",
      alert3 is not None and alert3.get("severity") == "critical" and alert3.get("sanctions_hit_confirmed") is True,
      alert3)

# Position-less vessel -> lat/lon must be None, not a fabricated 0,0.
_spy_calls.clear()
alert3b = _check_sanctions_hit("222000002", {"name": "MV NO POSITION"})
check("site 3: vessel with no lat/lon -> alert lat is None (not fabricated 0)", alert3b.get("lat") is None, alert3b)
check("site 3: vessel with no lat/lon -> alert lon is None (not fabricated 0)", alert3b.get("lon") is None, alert3b)
check("site 3: vessel with no lat/lon -> description does not claim a bogus '0.000, 0.000' position",
      "0.000, 0.000" not in alert3b.get("description", ""), alert3b)


def _spy_check_shared_possible(mmsi=None, name=None, vessel=None):
    _spy_calls.append({"mmsi": mmsi, "name": name, "vessel": vessel})
    return {"status": "possible", "hit": {"_match_type": "imo", "flag": "KP"}, "mmsi": mmsi, "vessel_name": name or mmsi}


_sl_module.check_sanctions_for_vessel = _spy_check_shared_possible
alert3c = _check_sanctions_hit("222000003", {"name": "MV MAYBE", "lat": 1.0, "lon": 2.0, "flag": "PA"})
check("site 3 produces a downgraded/medium alert when the shared function says 'possible'",
      alert3c is not None and alert3c.get("severity") == "medium" and alert3c.get("sanctions_hit_confirmed") is False,
      alert3c)


def _spy_check_shared_none(mmsi=None, name=None, vessel=None):
    _spy_calls.append({"mmsi": mmsi, "name": name, "vessel": vessel})
    return None


_sl_module.check_sanctions_for_vessel = _spy_check_shared_none
alert3d = _check_sanctions_hit("222000004", {"name": "MV CLEAN"})
check("site 3 produces no alert when the shared function returns None", alert3d is None, alert3d)

# Restore.
_sl_module.check_sanctions_for_vessel = check_sanctions_for_vessel


# ─────────────────────────────────────────────────────────────────────────
# Part 1c: site 1 — main.py's _check_sanctions_on_update() delegates to the
# shared function (spy), and branches confirmed/possible into the right
# alert_type/severity without writing to the real DB (write_alert stubbed).
# ─────────────────────────────────────────────────────────────────────────
print("\n-- site 1 (_check_sanctions_on_update) routes through the shared function --")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import main  # noqa: E402  (heavy import, but the established pattern for this test suite)

_written_alerts = []


def _fake_write_alert(alert_dict):
    _written_alerts.append(alert_dict)
    return "FAKE-ALERT-ID"


_ORIGINAL_MAIN_CHECK = main.check_sanctions_for_vessel
_ORIGINAL_MAIN_WRITE_ALERT = main.write_alert
_ORIGINAL_MAIN_IS_RELEVANT = main._sanctions_hit_is_relevant
main.write_alert = _fake_write_alert
# These 3 scenarios are about the confirmed/possible corroboration branching,
# not the relevance gate — pin relevance to True so they keep testing exactly
# what they tested before the gate existed. The gate itself is covered in its
# own section below.
main._sanctions_hit_is_relevant = lambda lat, lon: True

_spy_site1_calls = []


def _spy_site1_confirmed(mmsi=None, name=None, vessel=None):
    _spy_site1_calls.append({"mmsi": mmsi, "name": name, "vessel": vessel})
    return {"status": "confirmed", "hit": {"_match_type": "mmsi", "flag": "KP", "imo": "999"}, "mmsi": mmsi, "vessel_name": name or mmsi}


main.check_sanctions_for_vessel = _spy_site1_confirmed
_written_alerts.clear()
_spy_site1_calls.clear()
asyncio.run(main._check_sanctions_on_update({"mmsi": "333000001", "name": "MV SITE1 CONFIRMED", "lat": 10.0, "lon": 20.0}))
check("site 1 calls the shared check_sanctions_for_vessel exactly once", len(_spy_site1_calls) == 1, _spy_site1_calls)
check("site 1 writes exactly one alert on a confirmed hit", len(_written_alerts) == 1, _written_alerts)
if _written_alerts:
    check("site 1 confirmed hit -> alert_type 'Sanctioned Vessel'", _written_alerts[0]["alert_type"] == "Sanctioned Vessel", _written_alerts[0])
    check("site 1 confirmed hit -> severity 'critical'", _written_alerts[0]["severity"] == "critical", _written_alerts[0])
    check("site 1 confirmed hit -> relevance_score 100", _written_alerts[0]["relevance_score"] == 100, _written_alerts[0])


def _spy_site1_possible(mmsi=None, name=None, vessel=None):
    _spy_site1_calls.append({"mmsi": mmsi, "name": name, "vessel": vessel})
    return {"status": "possible", "hit": {"_match_type": "imo", "flag": "KP", "imo": "999"}, "mmsi": mmsi, "vessel_name": name or mmsi}


main.check_sanctions_for_vessel = _spy_site1_possible
_written_alerts.clear()
asyncio.run(main._check_sanctions_on_update({"mmsi": "333000002", "name": "MV SITE1 POSSIBLE", "lat": 10.0, "lon": 20.0}))
check("site 1 writes exactly one alert on a possible (downgraded) hit", len(_written_alerts) == 1, _written_alerts)
if _written_alerts:
    check("site 1 possible hit -> alert_type 'Sanctioned Vessel (Possible)'", _written_alerts[0]["alert_type"] == "Sanctioned Vessel (Possible)", _written_alerts[0])
    check("site 1 possible hit -> severity 'medium' (not critical)", _written_alerts[0]["severity"] == "medium", _written_alerts[0])
    check("site 1 possible hit -> title honestly says 'Possible', not 'SANCTIONED'",
          "Possible" in _written_alerts[0]["title"] and "SANCTIONED:" not in _written_alerts[0]["title"], _written_alerts[0])


def _spy_site1_none(mmsi=None, name=None, vessel=None):
    _spy_site1_calls.append({"mmsi": mmsi, "name": name, "vessel": vessel})
    return None


main.check_sanctions_for_vessel = _spy_site1_none
_written_alerts.clear()
asyncio.run(main._check_sanctions_on_update({"mmsi": "333000003", "name": "MV SITE1 CLEAN", "lat": 10.0, "lon": 20.0}))
check("site 1 writes no alert when the shared function returns None", len(_written_alerts) == 0, _written_alerts)

# Restore.
main.check_sanctions_for_vessel = _ORIGINAL_MAIN_CHECK
main.write_alert = _ORIGINAL_MAIN_WRITE_ALERT
main._sanctions_hit_is_relevant = _ORIGINAL_MAIN_IS_RELEVANT


# ─────────────────────────────────────────────────────────────────────────
# Part 1e: sanctions relevance gate — _sanctions_hit_is_relevant() itself,
# plus its effect on _check_sanctions_on_update()'s severity/relevance_score
# and on whether the hit gets a map marker (_forge_alerts.append).
#
# A hit inside/near an active Watch Area or mission-profile focus region
# still fires prominently (critical/medium + a map marker), exactly as
# before the gate existed. A hit outside every watched area is still
# written for real via write_alert() (findable in Watchlists history,
# nothing silently dropped) but is downgraded to "low" severity and does
# NOT get appended to _forge_alerts, so it never paints a map marker or
# competes for attention as an urgent item.
#
# Chosen relevance threshold (stated explicitly, not left implicit): inside
# an enabled Watch Area's bbox, or within _SANCTIONS_RELEVANCE_BUFFER_DEG
# (0.5 degrees) of it — bbox-plus-buffer rather than exact polygon
# containment, matching the pre-existing news-relevance-boost precedent
# that also uses rectangular REGION_BBOXES, not polygons.
# ─────────────────────────────────────────────────────────────────────────
print("\n-- sanctions relevance gate: _sanctions_hit_is_relevant() direct unit checks --")
import database as _db_module


class _FakeZone:
    def __init__(self, s, n, w, e):
        self.bbox_min_lat, self.bbox_max_lat = s, n
        self.bbox_min_lon, self.bbox_max_lon = w, e
        self.enabled = True


class _FakeQuery:
    def __init__(self, zones):
        self._zones = zones

    def filter(self, *a, **k):
        return self

    def all(self):
        return self._zones


class _FakeSession:
    def __init__(self, zones):
        self._zones = zones

    def query(self, model):
        return _FakeQuery(self._zones)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _fake_get_db_factory(zones):
    return lambda: _FakeSession(zones)


_ORIGINAL_GET_DB = _db_module.get_db
_ORIGINAL_ACTIVE_PROFILE = main._ACTIVE_PROFILE

# No enabled zones anywhere, no active mission profile -> not relevant.
_db_module.get_db = _fake_get_db_factory([])
main._ACTIVE_PROFILE = None
check(
    "no watch zones, no active profile -> not relevant",
    main._sanctions_hit_is_relevant(10.0, 20.0) is False,
)

# Point falls exactly inside an enabled Watch Area's bbox -> relevant.
_db_module.get_db = _fake_get_db_factory([_FakeZone(9.0, 11.0, 19.0, 21.0)])
check(
    "point inside an enabled Watch Area bbox -> relevant",
    main._sanctions_hit_is_relevant(10.0, 20.0) is True,
)

# Point well outside any zone bbox and its buffer -> not relevant.
_db_module.get_db = _fake_get_db_factory([_FakeZone(50.0, 52.0, 4.0, 5.0)])
check(
    "point far from the nearest Watch Area bbox -> not relevant",
    main._sanctions_hit_is_relevant(10.0, 20.0) is False,
)

# Point just outside the literal bbox but inside the 0.5-degree buffer ->
# still relevant (the buffer is a deliberate, documented design choice).
_db_module.get_db = _fake_get_db_factory([_FakeZone(9.0, 9.6, 19.0, 19.6)])
check(
    "point just outside a Watch Area bbox but within the 0.5-degree buffer -> relevant",
    main._sanctions_hit_is_relevant(10.0, 20.0) is True,
)

# No zones, but the active mission profile's focusRegions include a named
# region (real REGION_BBOXES entry) whose bbox contains the point.
_db_module.get_db = _fake_get_db_factory([])
main._ACTIVE_PROFILE = {"focusRegions": ["Gulf States"]}  # (22.0, 30.0, 46.0, 60.0)
check(
    "no zones, but point inside active profile's focus-region bbox -> relevant",
    main._sanctions_hit_is_relevant(25.0, 50.0) is True,
)
check(
    "no zones, point outside active profile's focus-region bbox -> not relevant",
    main._sanctions_hit_is_relevant(10.0, 20.0) is False,
)

# "Global" focus region (bbox=None in REGION_BBOXES) -> always relevant,
# matching the existing news-relevance-boost precedent for the same value.
main._ACTIVE_PROFILE = {"focusRegions": ["Global"]}
check(
    "active profile's focus region is 'Global' -> always relevant",
    main._sanctions_hit_is_relevant(0.0, 0.0) is True,
)

# Missing/invalid lat/lon -> never raises, always False.
check("lat=None -> not relevant, no exception", main._sanctions_hit_is_relevant(None, 20.0) is False)
check("lon=None -> not relevant, no exception", main._sanctions_hit_is_relevant(10.0, None) is False)
check("non-numeric lat -> not relevant, no exception", main._sanctions_hit_is_relevant("nope", 20.0) is False)

_db_module.get_db = _ORIGINAL_GET_DB
main._ACTIVE_PROFILE = _ORIGINAL_ACTIVE_PROFILE


print("\n-- sanctions relevance gate: real DB smoke test (actual WatchZone row) --")
# Not a fake DB this time — seeds one real WatchZone row into the actual
# local dev database, confirms _sanctions_hit_is_relevant() finds it via the
# real get_db()/query path, then removes the row again so this test leaves
# no trace behind.
from database import WatchZone as _RealWatchZone

_TEST_ZONE_SYSTEM_ID = "TEST-RELEVANCE-GATE-ZONE"
with _db_module.get_db() as _cleanup_db:
    _cleanup_db.query(_RealWatchZone).filter(_RealWatchZone.system_id == _TEST_ZONE_SYSTEM_ID).delete()
    _cleanup_db.commit()

try:
    with _db_module.get_db() as _seed_db:
        _seed_db.add(_RealWatchZone(
            system_id=_TEST_ZONE_SYSTEM_ID,
            name="Test Relevance Gate Zone",
            polygon_geojson="{}",
            bbox_min_lon=19.0, bbox_min_lat=9.0,
            bbox_max_lon=21.0, bbox_max_lat=11.0,
            enabled=True,
        ))
        _seed_db.commit()

    check(
        "real WatchZone row in the actual DB -> point inside its bbox is relevant",
        main._sanctions_hit_is_relevant(10.0, 20.0) is True,
    )
    check(
        "real WatchZone row in the actual DB -> point far outside it is not relevant",
        main._sanctions_hit_is_relevant(-70.0, 170.0) is False,
    )

    with _db_module.get_db() as _disable_db:
        _disable_db.query(_RealWatchZone).filter(_RealWatchZone.system_id == _TEST_ZONE_SYSTEM_ID).update({"enabled": False})
        _disable_db.commit()
    check(
        "disabling the real WatchZone row -> the same point is no longer relevant",
        main._sanctions_hit_is_relevant(10.0, 20.0) is False,
    )
finally:
    with _db_module.get_db() as _cleanup_db2:
        _cleanup_db2.query(_RealWatchZone).filter(_RealWatchZone.system_id == _TEST_ZONE_SYSTEM_ID).delete()
        _cleanup_db2.commit()


print("\n-- sanctions relevance gate: effect on _check_sanctions_on_update() --")
main.write_alert = _fake_write_alert
main.check_sanctions_for_vessel = _spy_site1_confirmed

# Scenario: hit INSIDE a real active Watch Area -> prominent (critical +
# a map marker via _forge_alerts).
main._sanctions_hit_is_relevant = lambda lat, lon: True
_written_alerts.clear()
main._forge_alerts.clear()
asyncio.run(main._check_sanctions_on_update({"mmsi": "333000010", "name": "MV INSIDE AOI", "lat": 10.0, "lon": 20.0}))
check("relevant hit -> alert is written", len(_written_alerts) == 1, _written_alerts)
if _written_alerts:
    check("relevant hit -> severity stays 'critical'", _written_alerts[0]["severity"] == "critical", _written_alerts[0])
    check("relevant hit -> relevance_score stays 100", _written_alerts[0]["relevance_score"] == 100, _written_alerts[0])
    check("relevant hit -> confidence unaffected by the gate (0.95)", _written_alerts[0]["confidence"] == 0.95, _written_alerts[0])
check(
    "relevant hit -> DOES get a map marker (_forge_alerts.append called)",
    len(main._forge_alerts) == 1, main._forge_alerts,
)

# Scenario: hit far OUTSIDE every watched area -> still logged for real,
# but downgraded and no map marker.
main._sanctions_hit_is_relevant = lambda lat, lon: False
_written_alerts.clear()
main._forge_alerts.clear()
asyncio.run(main._check_sanctions_on_update({"mmsi": "333000011", "name": "MV FAR AWAY", "lat": -70.0, "lon": 170.0}))
check(
    "non-relevant hit -> STILL written for real (nothing silently dropped)",
    len(_written_alerts) == 1, _written_alerts,
)
if _written_alerts:
    check("non-relevant hit -> severity downgraded to 'low'", _written_alerts[0]["severity"] == "low", _written_alerts[0])
    check("non-relevant hit -> relevance_score downgraded", _written_alerts[0]["relevance_score"] < 100, _written_alerts[0])
    check("non-relevant hit -> confidence still unaffected by the gate (0.95)", _written_alerts[0]["confidence"] == 0.95, _written_alerts[0])
    check(
        "non-relevant hit -> message honestly says it's outside watched areas",
        "outside all currently active Watch Areas" in _written_alerts[0]["message"],
        _written_alerts[0],
    )
    check(
        "non-relevant hit -> payload carries relevant=False for downstream honesty",
        _written_alerts[0]["payload"]["relevant"] is False,
        _written_alerts[0],
    )
check(
    "non-relevant hit -> does NOT get a map marker (no _forge_alerts.append)",
    len(main._forge_alerts) == 0, main._forge_alerts,
)

# The "possible" (flag-mismatch) branch is downgraded the same way when
# also outside every watched area.
main.check_sanctions_for_vessel = _spy_site1_possible
_written_alerts.clear()
main._forge_alerts.clear()
asyncio.run(main._check_sanctions_on_update({"mmsi": "333000012", "name": "MV FAR AWAY POSSIBLE", "lat": -70.0, "lon": 170.0}))
if _written_alerts:
    check(
        "non-relevant + possible hit -> also downgraded to 'low' (not left at 'medium')",
        _written_alerts[0]["severity"] == "low", _written_alerts[0],
    )
check(
    "non-relevant + possible hit -> also gets no map marker",
    len(main._forge_alerts) == 0, main._forge_alerts,
)

# Restore.
main.check_sanctions_for_vessel = _ORIGINAL_MAIN_CHECK
main.write_alert = _ORIGINAL_MAIN_WRITE_ALERT
main._sanctions_hit_is_relevant = _ORIGINAL_MAIN_IS_RELEVANT


# ─────────────────────────────────────────────────────────────────────────
# Part 1d: site 2 — main.py's ship-to-ship-transfer block. The full
# candidate-tracking/DB-cooldown/port-distance machinery around this block
# makes a full behavioral run disproportionate for what this is checking, so
# this is a structural check instead (an explicitly acceptable option for
# this kind of "did the call site get rewired" proof): confirm the STS
# function's source calls the shared function (not the raw
# sanctions_loader.check_vessel it used to call directly), and that the old
# copy-pasted per-site fuzzy-name gate is gone.
# ─────────────────────────────────────────────────────────────────────────
print("\n-- site 2 (ship-to-ship-transfer block) routes through the shared function (structural) --")
_sts_source = inspect.getsource(main._run_sts_detection)
check(
    "STS block calls the shared check_sanctions_for_vessel() for vessel A",
    "check_sanctions_for_vessel(mmsi=mmsi_a" in _sts_source,
)
check(
    "STS block calls the shared check_sanctions_for_vessel() for vessel B",
    "check_sanctions_for_vessel(mmsi=mmsi_b" in _sts_source,
)
check(
    "STS block no longer calls sanctions_loader.check_vessel() directly",
    "sanctions_loader.check_vessel(" not in _sts_source,
    _sts_source,
)
check(
    "STS block no longer has its own copy-pasted fuzzy-name gate",
    '_match_type") == "fuzzy_name"' not in _sts_source,
    _sts_source,
)
check(
    "STS block severity now keys off the shared function's confirmed/possible distinction",
    "is_sanctions_confirmed" in _sts_source,
)

_check_update_source = inspect.getsource(main._check_sanctions_on_update)
check(
    "_check_sanctions_on_update calls the shared check_sanctions_for_vessel()",
    "check_sanctions_for_vessel(" in _check_update_source,
)
check(
    "_check_sanctions_on_update no longer has its own copy-pasted fuzzy-name gate",
    '_match_type") == "fuzzy_name"' not in _check_update_source,
    _check_update_source,
)
check(
    "_check_sanctions_on_update no longer maintains its own separate cooldown dict",
    "_sanctions_alerted" not in _check_update_source,
    _check_update_source,
)


# ─────────────────────────────────────────────────────────────────────────
# Part 2: speed=None / heading=None doesn't crash, and isn't treated as 0
# ─────────────────────────────────────────────────────────────────────────
print("\n-- speed=None / heading=None: check_loitering / check_port_loitering --")
from detectors.ais_detector import AISAnomalyDetector

T0 = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

# A cable running right under the vessel's position, so if speed=None were
# silently treated as speed=0 ("stopped"), it would count as being "in
# range and slow enough" and start accumulating loiter state.
CABLE = {
    "system_id": "TEST-CABLE-1",
    "region_id": "REG-TEST",
    "name": "Test Cable",
    "geometry": {"type": "LineString", "coordinates": [[4.0, 51.9], [4.2, 51.9]]},
}
LOITER_RULE = {
    "id": 1, "enabled": True,
    "params": {"target": "ALL", "distance_metres": 5000, "duration_minutes": 5, "max_speed_knots": 2.0},
}

det = AISAnomalyDetector()
vessel_unknown_speed = {
    "mmsi": "222000001", "name": "MV UNKNOWN SPEED",
    "lat": 51.9, "lng": 4.1, "speed": None, "heading": None, "flag": "PA",
}

try:
    alerts1 = det.check_loitering(vessel_unknown_speed, [CABLE], [LOITER_RULE], T0)
    crashed1 = False
except Exception as e:
    alerts1 = None
    crashed1 = True
check("check_loitering does not crash on speed=None", not crashed1, alerts1)
check("check_loitering produces no alert on the first speed=None cycle", alerts1 == [], alerts1)
check(
    "check_loitering does NOT start accumulating loiter state from an unknown-speed reading",
    len(det._loiter) == 0,
    det._loiter,
)

# Run it again 10 minutes later (still speed=None, still "in range") — if
# unknown speed were being treated as 0/stopped, two cycles 10 minutes apart
# inside `duration_minutes: 5` would fire a loitering alert by now.
T1 = T0 + timedelta(minutes=10)
alerts2 = det.check_loitering(vessel_unknown_speed, [CABLE], [LOITER_RULE], T1)
check(
    "check_loitering still produces no alert on a second speed=None cycle "
    "(unknown speed never accrues loitering evidence)",
    alerts2 == [], alerts2,
)

PORT = {
    "system_id": "TEST-PORT-1", "port_name": "Test Port",
    "latitude": 51.9, "longitude": 4.1, "boundary_radius_metres": 5000,
}
PORT_RULE = {
    "id": 2, "enabled": True,
    "params": {"target": "ALL", "proximity_metres": 5000, "duration_minutes": 5, "max_speed_knots": 2.0},
}

det2 = AISAnomalyDetector()
try:
    alerts3 = det2.check_port_loitering(vessel_unknown_speed, [PORT], [PORT_RULE], T0)
    crashed2 = False
except Exception:
    alerts3 = None
    crashed2 = True
check("check_port_loitering does not crash on speed=None", not crashed2, alerts3)
check("check_port_loitering produces no alert on speed=None", alerts3 == [], alerts3)
check(
    "check_port_loitering does NOT start accumulating loiter state from an unknown-speed reading",
    len(det2._loiter) == 0,
    det2._loiter,
)

# Sanity check: a genuinely slow vessel (speed=0.0, a real "stopped"
# reading, not None) still loiters normally — confirms the fix distinguishes
# "unknown" from "genuinely stopped" rather than breaking real detection.
det3 = AISAnomalyDetector()
vessel_really_stopped = dict(vessel_unknown_speed, mmsi="222000002", speed=0.0, heading=0.0)
det3.check_loitering(vessel_really_stopped, [CABLE], [LOITER_RULE], T0)
alerts4 = det3.check_loitering(vessel_really_stopped, [CABLE], [LOITER_RULE], T0 + timedelta(minutes=10))
check(
    "a genuinely-stopped vessel (speed=0.0, not None) still loiters normally",
    len(alerts4) == 1, alerts4,
)

print("=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    sys.exit(1)
else:
    print("  RESULT: ALL CHECKS PASSED")
print("=" * 70)
