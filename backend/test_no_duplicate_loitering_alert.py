"""
Verification for the Stage 1 rules.json / RuleConfig duplicate-loitering-alert
consolidation (see backend/main.py's _forge_detection_cycle Stage 1 comment,
and PIPELINE_NODE_RULE_FAMILIES / _sync_ruleconfig_family right after
WIRED_RULE_DISPATCH).

Confirmed bug (before this fix): rules.json's rule_001 "Cable Loiterer"
(trigger_type=stationary_near_infrastructure, no duration requirement,
evaluated via AISAnomalyDetector.check_vessel()) and the DB RuleConfig-backed
"Cable Loitering — Global" rule (AIS_LOITERING_NEAR_INFRA, target=ALL,
min_duration_minutes=120, evaluated via AISAnomalyDetector.check_loitering()
through _run_ais_loitering_rules/WIRED_RULE_DISPATCH) BOTH ran in the same
5-minute _forge_detection_cycle(). A vessel sitting still near a cable for
2+ hours would eventually satisfy both — one instantly (rule_001, no
duration gate), one after 120 real minutes (the DB rule) — producing two
separate alerts, with different rule_ids/severities/thresholds, for the same
physically-loitering vessel.

This script proves the fix with direct unit-level calls into
AISAnomalyDetector plus a source-level regression guard — no FastAPI
TestClient / live server / DB fixtures needed:

1. AISAnomalyDetector.check_vessel() — kept intact in ais_detector.py,
   simply no longer invoked from the live cycle — DOES still fire instantly
   (single snapshot, no duration) given rules.json's rule_001 shape. This
   demonstrates why running it alongside check_loitering() was dangerous.

2. AISAnomalyDetector.check_loitering() — the DB-rule-backed implementation,
   the ONE real implementation post-consolidation — does NOT fire on a
   single snapshot, and fires exactly ONCE after min_duration_minutes has
   genuinely elapsed across repeated (simulated 5-minute-cycle) calls, not
   again on every subsequent call (the per-(mmsi,cable,rule) `alerted` flag
   latches).

3. Source-level regression guard: _forge_detection_cycle's Stage 1 no
   longer calls check_vessel() at all — this is the actual fix; parts 1+2
   demonstrate why it matters and confirm the remaining path behaves
   correctly.

4. Combined proof: replaying the exact same vessel/cable loitering episode
   through both paths (as the old, buggy cycle would have) yields 2 alerts;
   the current live cycle only runs the check_loitering() path, so the real
   total for one loitering vessel is 1 — the bug this consolidation fixes.

Usage:
    cd backend
    python3 test_no_duplicate_loitering_alert.py
"""
import os
import sys
import inspect
sys.path.insert(0, os.path.dirname(__file__))

from datetime import datetime, timedelta, timezone

FAILURES = []


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


print("=" * 70)
print("Stage 1 duplicate-loitering-alert consolidation — verification")
print("=" * 70)

from detectors.ais_detector import AISAnomalyDetector

# ── Synthetic cable geometry (a short straight line, so the math is easy to
#    reason about) — coordinates are [lon, lat] pairs, matching both the
#    legacy check_vessel()/rule_001 "coordinates" shape and the DB
#    check_loitering()/GeoJSON "geometry.coordinates" shape. ────────────────
CABLE_COORDS = [[10.00, 54.00], [10.02, 54.00], [10.04, 54.00]]

LEGACY_RULE_001 = {
    "id": "rule_001", "name": "Cable Loiterer", "source": "AIS", "status": "active",
    "trigger_type": "stationary_near_infrastructure",
    "params": {"infra_type": "cable", "max_speed_knots": 0.5, "proximity_km": 10},
    "severity": "high",
}

DB_LOITER_RULE = {
    "id": 1, "rule_name": "AIS_LOITERING_NEAR_INFRA", "enabled": True,
    "params": {
        "infra_type": "Submarine Cable", "target": "ALL",
        "distance_metres": 500, "max_speed_knots": 0.5,
        "min_duration_minutes": 120,
    },
}

DB_CABLE = {
    "system_id": "CABLE-TEST", "cable_id": "CABLE-TEST", "name": "Test Cable",
    "region_id": "REG-TEST",
    "geometry": {"type": "LineString", "coordinates": CABLE_COORDS},
}

VESSEL = {
    "mmsi": "999000123", "name": "MV LOITERER", "lat": 54.00, "lng": 10.02,
    "speed": 0.0, "heading": 0.0, "flag": "XX", "destination": "",
}

# ── Part 1: check_vessel() (legacy, rules.json-driven) fires INSTANTLY on a
#    single snapshot — no duration gate at all. ────────────────────────────
det_legacy = AISAnomalyDetector()
det_legacy.load_rules([LEGACY_RULE_001])
legacy_hits = det_legacy.check_vessel(
    VESSEL,
    cables=[{"name": "Test Cable", "coordinates": CABLE_COORDS}],
    chokepoints=[], all_vessels={VESSEL["mmsi"]: VESSEL},
)
check(
    "check_vessel() (legacy rules.json rule_001) fires on a SINGLE snapshot, no duration wait",
    len(legacy_hits) == 1, legacy_hits,
)

# ── Part 2: check_loitering() (the DB-rule path) does NOT fire immediately,
#    and fires exactly once after the real duration elapses. ───────────────
det_db = AISAnomalyDetector()
T0 = datetime(2026, 8, 1, 12, 0, 0, tzinfo=timezone.utc)

total_alerts = 0
first_alert_at_minutes = None
t = T0
# Simulate 5-minute detection cycles from t=0 out to t=130min — past the DB
# rule's min_duration_minutes=120.
while t <= T0 + timedelta(minutes=130):
    hits = det_db.check_loitering(VESSEL, [DB_CABLE], [DB_LOITER_RULE], t)
    total_alerts += len(hits)
    if hits and first_alert_at_minutes is None:
        first_alert_at_minutes = (t - T0).total_seconds() / 60.0
    t += timedelta(minutes=5)

check(
    "check_loitering() produces NO alert before min_duration_minutes elapses",
    first_alert_at_minutes is not None and first_alert_at_minutes >= 120,
    first_alert_at_minutes,
)
check(
    "check_loitering() produces EXACTLY ONE alert for the whole loitering episode "
    "(latches via the 'alerted' flag, does not re-fire every subsequent cycle)",
    total_alerts == 1, total_alerts,
)

# ── Part 3: the actual fix — the live cycle no longer calls check_vessel()
#    for this trigger type at all, so parts 1+2 can no longer both
#    contribute alerts for the same vessel/cable in the same run. ──────────
import main as _main
cycle_source = inspect.getsource(_main._forge_detection_cycle)
check(
    "_forge_detection_cycle's Stage 1 no longer calls _ais_detector.check_vessel(",
    "_ais_detector.check_vessel(" not in cycle_source,
    "found an _ais_detector.check_vessel( call in the live cycle source — regression",
)
check(
    "_forge_detection_cycle's Stage 1b still calls _run_ais_loitering_rules "
    "(the one real, DB-backed implementation of this concept)",
    "_run_ais_loitering_rules(" in cycle_source,
    "missing Stage 1b call — loitering detection would be gone entirely",
)

# ── Part 4: combined proof. If the OLD cycle had run both paths for this
#    exact vessel/cable episode, it would have produced 2 alerts (1 from
#    check_vessel at t=0, 1 from check_loitering at t=120min) for one
#    physically-loitering vessel — the confirmed bug. The current live
#    cycle only runs the check_loitering path, so the real total is 1. ─────
old_combined_total = len(legacy_hits) + total_alerts
check(
    "sanity: replaying the retired combination (check_vessel + check_loitering) confirms "
    "it WOULD have produced TWO alerts for one loitering vessel — the bug this fix removes",
    old_combined_total == 2, old_combined_total,
)
check(
    "the actual, current live-cycle total for this vessel is ONE alert, not two",
    total_alerts == 1, total_alerts,
)

print("=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    sys.exit(1)
else:
    print("  RESULT: ALL CHECKS PASSED — Stage 1 duplicate-alert bug fixed; "
          "check_loitering() via Stage 1b is the sole live implementation.")
print("=" * 70)
