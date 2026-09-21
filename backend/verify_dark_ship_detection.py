"""
Verification script for DarkShipDetector (backend/detectors/correlation_engine.py):
real AIS-gap ("dark ship") detection — a vessel that stops reporting AIS
positions while it was underway, for at least a rule's min_gap_minutes.

This is a plain unit test of a Python class with synthetic vessel snapshots
across simulated cycles — no FastAPI TestClient / DB fixtures needed, and no
writes to backend/data/akili.db (that file is in active use by a real,
running backend process for an unrelated observation window).

Covers:
  1. A vessel reporting normally, then genuinely absent from the snapshot for
     longer than min_gap_minutes while its last known speed was above
     min_speed_before_gap -> produces exactly one dark-ship alert.
  2. A vessel that goes quiet but was already slow/stationary before
     disappearing -> no alert (the anchored-vessel exclusion).
  3. A vessel that reappears -> alerted_at clears, and if it goes dark again
     later, a second alert fires.
  4. purge_stale() still works correctly.

Usage:
    cd backend
    python3 test_dark_ship_detection.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))

from datetime import datetime, timezone, timedelta

from detectors.correlation_engine import DarkShipDetector

FAILURES = []


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


def vessel(lat, lng, name="MV TESTSHIP", speed=12.0):
    return {
        "mmsi": "123456789",
        "name": name,
        "lat": lat,
        "lng": lng,
        "speed": speed,
    }


def dark_rule(rule_id="R1", min_gap_minutes=60, min_speed_before_gap=3.0,
              target="ALL", last_known_region="ALL", severity="medium"):
    return {
        "id": rule_id,
        "rule_name": "AIS_DARK_SHIP",
        "enabled": True,
        "severity": severity,
        "params": {
            "target":               target,
            "min_gap_minutes":      min_gap_minutes,
            "last_known_region":    last_known_region,
            "min_speed_before_gap": min_speed_before_gap,
        },
    }


print("=" * 70)
print("  DarkShipDetector — verification")
print("=" * 70)

T0 = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
MMSI = "123456789"

# ── 1. Vessel underway, then genuinely absent > min_gap_minutes -> 1 alert ──
print("\n1. Underway vessel goes dark past min_gap_minutes -> exactly one alert")
det = DarkShipDetector()
rules = [dark_rule(min_gap_minutes=60, min_speed_before_gap=3.0)]

# Cycle 0: vessel reporting normally, underway at 12 kn.
det.update({MMSI: vessel(10.0, 50.0, speed=12.0)}, T0)
check("vessel recorded after first update", MMSI in det._last_seen)
alerts = det.scan(rules, T0, active_mmsis={MMSI})
check("no alert while vessel is still active", alerts == [], alerts)

# Several cycles pass with the vessel genuinely missing from the snapshot
# (NOT passed to update() at all, and NOT in active_mmsis).
T_gap_29 = T0 + timedelta(minutes=29)
alerts = det.scan(rules, T_gap_29, active_mmsis=set())
check("no alert before min_gap_minutes elapses (29 min < 60)", alerts == [], alerts)

T_gap_65 = T0 + timedelta(minutes=65)
alerts = det.scan(rules, T_gap_65, active_mmsis=set())
check("exactly one dark-ship alert fires past min_gap_minutes (65 min >= 60)",
      len(alerts) == 1, alerts)
if alerts:
    a = alerts[0]
    check("alert has correct mmsi", a.get("mmsi") == MMSI, a)
    check("alert has rule_trigger AIS_DARK_SHIP", a.get("rule_trigger") == "AIS_DARK_SHIP", a)
    check("alert has rule_name AIS_DARK_SHIP", a.get("rule_name") == "AIS_DARK_SHIP", a)
    check("alert has source AIS", a.get("source") == "AIS", a)
    check("alert carries last-known lat/lng", a.get("lat") == 10.0 and a.get("lng") == 50.0, a)
    check("alert carries last-known speed", a.get("speed") == 12.0, a)
    check("alert has icon_type DARK_SHIP", a.get("icon_type") == "DARK_SHIP", a)
    check("alert message mentions elapsed minutes", "65" in a.get("message", ""), a)
    check("alert has provenance block", "provenance" in a and a["provenance"].get("source_type") == "AIS", a)
    check("alert has id/rule_id/timestamp", bool(a.get("id")) and a.get("rule_id") == "R1" and bool(a.get("timestamp")), a)

# Re-scanning the same still-dark vessel must NOT re-alert (alerted_at set).
T_gap_70 = T0 + timedelta(minutes=70)
alerts = det.scan(rules, T_gap_70, active_mmsis=set())
check("no re-alert for the same gap once already alerted", alerts == [], alerts)


# ── 2. Vessel already slow/anchored before going dark -> no alert ──────────
print("\n2. Already-slow/anchored vessel going dark -> no alert (anchored exclusion)")
det2 = DarkShipDetector()
rules2 = [dark_rule(min_gap_minutes=60, min_speed_before_gap=3.0)]
det2.update({MMSI: vessel(1.0, 103.0, speed=0.4)}, T0)  # anchored, 0.4 kn
alerts = det2.scan(rules2, T0 + timedelta(minutes=90), active_mmsis=set())
check("anchored vessel going dark produces no alert", alerts == [], alerts)


# ── 3. Reappearance clears alerted_at; a second real dark gap fires again ──
print("\n3. Reappearance clears alerted_at; a subsequent new gap fires a second alert")
det3 = DarkShipDetector()
rules3 = [dark_rule(min_gap_minutes=60, min_speed_before_gap=3.0)]

det3.update({MMSI: vessel(20.0, 60.0, speed=15.0)}, T0)
first_gap_alerts = det3.scan(rules3, T0 + timedelta(minutes=65), active_mmsis=set())
check("first gap produces exactly one alert", len(first_gap_alerts) == 1, first_gap_alerts)
check("alerted_at is set after first alert", det3._last_seen[MMSI]["alerted_at"] is not None)

# Vessel reappears in a live snapshot.
T_reappear = T0 + timedelta(minutes=70)
det3.update({MMSI: vessel(20.5, 60.2, speed=14.0)}, T_reappear)
check("alerted_at is cleared on reappearance", det3._last_seen[MMSI]["alerted_at"] is None)
no_alert_yet = det3.scan(rules3, T_reappear, active_mmsis={MMSI})
check("no alert immediately after reappearance (vessel is active)", no_alert_yet == [], no_alert_yet)

# Vessel goes dark again for a genuinely new gap.
T_second_gap = T_reappear + timedelta(minutes=65)
second_gap_alerts = det3.scan(rules3, T_second_gap, active_mmsis=set())
check("a second, later dark gap produces a second alert", len(second_gap_alerts) == 1, second_gap_alerts)
if len(first_gap_alerts) == 1 and len(second_gap_alerts) == 1:
    check("the two alerts have distinct ids", first_gap_alerts[0]["id"] != second_gap_alerts[0]["id"])


# ── 3b. target=MMSI:<other> scoping and last_known_region scoping ──────────
print("\n3b. target/last_known_region scoping")
det3b = DarkShipDetector()
other_mmsi_rule = dark_rule(min_gap_minutes=60, min_speed_before_gap=3.0, target="MMSI:999999999")
det3b.update({MMSI: vessel(5.0, 5.0, speed=10.0)}, T0)
alerts = det3b.scan([other_mmsi_rule], T0 + timedelta(minutes=90), active_mmsis=set())
check("target=MMSI:<other> does not match this vessel", alerts == [], alerts)

matching_mmsi_rule = dark_rule(min_gap_minutes=60, min_speed_before_gap=3.0, target=f"MMSI:{MMSI}")
alerts = det3b.scan([matching_mmsi_rule], T0 + timedelta(minutes=90), active_mmsis=set())
check("target=MMSI:<this vessel> does match", len(alerts) == 1, alerts)

det3c = DarkShipDetector()
region_rule = dark_rule(min_gap_minutes=60, min_speed_before_gap=3.0, last_known_region="REG-ASIA")
det3c.update({MMSI: vessel(5.0, 5.0, speed=10.0)}, T0)  # region_fn not used -> region_id None
alerts = det3c.scan([region_rule], T0 + timedelta(minutes=90), active_mmsis=set())
check("non-ALL last_known_region fails closed when region is unresolved (no region_fn)", alerts == [], alerts)

det3d = DarkShipDetector()
det3d.update({MMSI: vessel(5.0, 5.0, speed=10.0)}, T0, region_fn=lambda lat, lon: "REG-ASIA")
alerts = det3d.scan([region_rule], T0 + timedelta(minutes=90), active_mmsis=set())
check("non-ALL last_known_region matches when region_fn resolves the same region", len(alerts) == 1, alerts)


# ── 4. purge_stale() removes old entries after the age cutoff ──────────────
print("\n4. purge_stale() removes entries older than the cutoff")
det4 = DarkShipDetector()
old_mmsi = "111111111"
fresh_mmsi = "222222222"
det4.update({old_mmsi: vessel(10.0, 10.0)}, T0)
det4.update({fresh_mmsi: vessel(20.0, 20.0)}, T0 + timedelta(hours=47))
check("both entries present before purge", old_mmsi in det4._last_seen and fresh_mmsi in det4._last_seen)
det4.purge_stale(T0 + timedelta(hours=49), max_age_hours=48.0)
check("purge_stale removes entry older than cutoff", old_mmsi not in det4._last_seen)
check("purge_stale keeps entry within cutoff", fresh_mmsi in det4._last_seen)


# ── 5. No rules / empty rules never crashes and never alerts ───────────────
print("\n5. Robustness: no rules, missing position, disabled rule")
det5 = DarkShipDetector()
det5.update({MMSI: vessel(1.0, 1.0, speed=10.0)}, T0)
alerts = det5.scan([], T0 + timedelta(minutes=90), active_mmsis=set())
check("empty rules list produces no alerts and does not crash", alerts == [], alerts)

disabled_rule = dark_rule(min_gap_minutes=60, min_speed_before_gap=3.0)
disabled_rule["enabled"] = False
alerts = det5.scan([disabled_rule], T0 + timedelta(minutes=90), active_mmsis=set())
check("disabled rule does not fire", alerts == [], alerts)

det6 = DarkShipDetector()
det6.update({MMSI: {"mmsi": MMSI, "name": "MV NOPOS", "speed": 10.0}}, T0)  # no lat/lng
check("vessel with no lat/lng is not tracked", MMSI not in det6._last_seen)


print("\n" + "=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    sys.exit(1)
else:
    print("  RESULT: ALL CHECKS PASSED")
print("=" * 70)
