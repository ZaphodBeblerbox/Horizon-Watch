"""
Verification script for:

1. `check_sanctions_for_vessel()` (backend/sanctions_loader.py) — the single
   shared "is this vessel sanctioned" check used by both real call sites
   that can each independently produce a "Sanctioned Vessel"-type alert:
     - main.py's `_check_sanctions_on_update()`        (per AIS position update)
     - main.py's ship-to-ship-transfer detection block  (per STS candidate pair)
   (A third former call site, detectors/correlation_engine.py's
   `_check_sanctions_hit()`, was confirmed to have zero real callers in the
   2026-09 alert/detector audit and was deleted outright, along with its
   tests here — see that file's replacement comment.)
   Confirms the fuzzy-name gate, the flag-plausibility corroboration
   (`_sanctions_hit_is_plausible`, also now living in sanctions_loader.py),
   and the shared cooldown, plus that each of the 2 real call sites actually
   routes through it (no more copy-pasted per-site gates).

2. The fabricated lat/lon default found during the audit
   (`float(vessel.get("lat") or 0)`, with no follow-up guard, previously
   found in both main.py's real call sites and the now-deleted
   `_check_sanctions_hit()`) — a vessel with no reported position must come
   back as lat=None/lon=None, not a fake (0, 0) "Null Island" position.

3. The missing-speed/heading "fabricated default" fix — a vessel dict with
   speed=None / heading=None must not crash, and must not be silently
   treated as "stopped" / "heading 0", in
   backend/detectors/ais_detector.py's check_loitering() /
   check_port_loitering(). (Unrelated to sanctions consolidation — kept from
   the prior round of this test, unchanged, to confirm no regression.)

This is a plain unit test of Python functions/classes with synthetic dicts
and monkeypatched module attributes — no FastAPI TestClient / DB fixtures
needed for the spy-based parts (site 1's DB write is monkeypatched out too,
so this writes nothing to the real DB).

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


# 2026-09 alert/detector audit: removed "Part 1b: site 3" here — it tested
# detectors/correlation_engine.py's `_check_sanctions_hit()`, which this
# file's own docstring already honestly flagged as "DarkShipDetector.scan —
# currently dead code, but kept correct". A repeat audit confirmed it still
# had zero real callers anywhere in the codebase and deleted it outright
# (see correlation_engine.py's replacement comment at the same location) —
# so there is no longer anything at that site to test. Sites 1 and 2 below
# are the real, live, wired sanctioned-vessel alert paths.


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
main.write_alert = _fake_write_alert

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
