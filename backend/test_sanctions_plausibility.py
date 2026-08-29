"""
Verification script for:

1. `_sanctions_hit_is_plausible()` / `_check_sanctions_hit()`
   (backend/detectors/correlation_engine.py) — flag-corroboration downgrade
   for a hard MMSI/IMO sanctions match whose live flag contradicts the
   sanctions record's flag (MMSI/IMO can be reassigned after a vessel is
   scrapped, reflagged, or sold, so a hard identifier match isn't
   automatically trustworthy forever).

2. The missing-speed/heading "fabricated default" fix — a vessel dict with
   speed=None / heading=None must not crash, and must not be silently
   treated as "stopped" / "heading 0", in
   backend/detectors/ais_detector.py's check_loitering() /
   check_port_loitering().

This is a plain unit test of Python functions/classes with synthetic dicts
and a monkeypatched sanctions_loader singleton — no FastAPI TestClient / DB
fixtures needed.

Usage:
    cd backend
    python3 test_sanctions_plausibility.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))

from datetime import datetime, timedelta, timezone

FAILURES = []


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


print("=" * 70)
print("  Sanctions plausibility + speed/heading fabricated-default — verification")
print("=" * 70)

# ─────────────────────────────────────────────────────────────────────────
# Part 1: _sanctions_hit_is_plausible / _check_sanctions_hit
# ─────────────────────────────────────────────────────────────────────────
import sanctions_loader as _sl_module
from detectors.correlation_engine import (
    _check_sanctions_hit,
    _sanctions_hit_is_plausible,
    _sanctions_alert_cooldown,
)

_ORIGINAL_CHECK_VESSEL = _sl_module.sanctions_loader.check_vessel


def _fake_check_vessel(hit_to_return):
    """Return a stand-in for sanctions_loader.check_vessel() that always
    reports the given hit (or None) regardless of the mmsi/imo/name args."""
    def _fn(mmsi=None, imo=None, name=None):
        return dict(hit_to_return) if hit_to_return is not None else None
    return _fn


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


def _reset_cooldown(mmsi):
    _sanctions_alert_cooldown.pop(mmsi, None)


print("\n-- _check_sanctions_hit: end-to-end scenarios --")

# (a) MMSI/IMO match, live flag agrees with the sanctions record -> fires
#     normally as a critical "Sanctioned Vessel" alert.
mmsi_a = "111000001"
_reset_cooldown(mmsi_a)
_sl_module.sanctions_loader.check_vessel = _fake_check_vessel({
    "_match_type": "mmsi", "name": "MV DPRK GHOST", "flag": "KP",
    "imo": "1234567",
})
alert_a = _check_sanctions_hit(mmsi_a, {"name": "MV DPRK GHOST", "lat": 39.0, "lon": 125.7, "flag": "KP"})
check("(a) flag match produces an alert", alert_a is not None, alert_a)
if alert_a:
    check("(a) flag match fires CRITICAL severity", alert_a.get("severity") == "critical", alert_a)
    check("(a) flag match uses the confirmed rule_id", alert_a.get("rule_id") == "SANCTIONS_VESSEL_DETECTED", alert_a)
    check("(a) flag match title claims a confirmed match", alert_a.get("title", "").startswith("Sanctioned Vessel:"), alert_a)
    check("(a) flag match marked sanctions_hit_confirmed=True", alert_a.get("sanctions_hit_confirmed") is True, alert_a)

# (b) MMSI/IMO match, live flag is CLEARLY different from the sanctions
#     record's flag -> downgraded to a "needs review" item, not critical.
mmsi_b = "111000002"
_reset_cooldown(mmsi_b)
_sl_module.sanctions_loader.check_vessel = _fake_check_vessel({
    "_match_type": "imo", "name": "MV REFLAGGED", "flag": "KP",
    "imo": "7654321",
})
alert_b = _check_sanctions_hit(mmsi_b, {"name": "MV REFLAGGED", "lat": 1.3, "lon": 103.8, "flag": "PA"})
check("(b) flag mismatch still produces an alert (not silently dropped)", alert_b is not None, alert_b)
if alert_b:
    check("(b) flag mismatch is downgraded away from critical", alert_b.get("severity") != "critical", alert_b)
    check("(b) flag mismatch uses medium severity", alert_b.get("severity") == "medium", alert_b)
    check("(b) flag mismatch uses the 'possible match' rule_id", alert_b.get("rule_id") == "SANCTIONS_VESSEL_POSSIBLE", alert_b)
    check(
        "(b) flag mismatch title honestly says 'possible'/'needs review', not 'Sanctioned Vessel:'",
        alert_b.get("title", "").startswith("Possible Sanctions Match")
        and not alert_b.get("title", "").startswith("Sanctioned Vessel:"),
        alert_b,
    )
    check("(b) flag mismatch marked sanctions_hit_confirmed=False", alert_b.get("sanctions_hit_confirmed") is False, alert_b)

# (c) MMSI/IMO match, flag unknown on the live side -> can't corroborate OR
#     contradict, so existing behavior (fire normally, critical) is kept.
mmsi_c = "111000003"
_reset_cooldown(mmsi_c)
_sl_module.sanctions_loader.check_vessel = _fake_check_vessel({
    "_match_type": "mmsi", "name": "MV NOFLAG", "flag": "RU",
})
alert_c = _check_sanctions_hit(mmsi_c, {"name": "MV NOFLAG", "lat": 43.0, "lon": 40.0})  # no flag/country field
check("(c) unknown live flag still produces an alert", alert_c is not None, alert_c)
if alert_c:
    check("(c) unknown live flag keeps existing (critical) behavior", alert_c.get("severity") == "critical", alert_c)
    check("(c) unknown live flag uses the confirmed rule_id", alert_c.get("rule_id") == "SANCTIONS_VESSEL_DETECTED", alert_c)

# Bonus: fuzzy_name hits are still gated out entirely (task 1 — consistency
# with the other two already-patched call sites), even though this call
# site is only ever invoked with mmsi= in production today.
mmsi_d = "111000004"
_reset_cooldown(mmsi_d)
_sl_module.sanctions_loader.check_vessel = _fake_check_vessel({
    "_match_type": "fuzzy_name", "name": "MV SIMILAR", "flag": "IR",
})
alert_d = _check_sanctions_hit(mmsi_d, {"name": "MV SOMEWHAT SIMILAR", "lat": 0, "lon": 0, "flag": "IR"})
check("fuzzy_name match produces no alert at all (consistency w/ main.py sites)", alert_d is None, alert_d)

# Restore the real check_vessel so nothing else in the process is affected.
_sl_module.sanctions_loader.check_vessel = _ORIGINAL_CHECK_VESSEL


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
