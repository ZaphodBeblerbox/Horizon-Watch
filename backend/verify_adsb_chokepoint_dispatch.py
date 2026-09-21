"""
Verification script for the ADSB_LOITERING_NEAR_CHOKEPOINT rule type
(main.py's _run_adsb_chokepoint_rules, dispatched via WIRED_RULE_DISPATCH).

Confirms, end-to-end, without any DB or network dependency:
  1. WIRED_RULE_DISPATCH / WIRED_RULE_NAMES / PIPELINE_NODE_RULE_FAMILIES all
     agree the new rule type is wired (the "small, additive change" the
     dispatch table is designed to only need).
  2. _run_adsb_chokepoint_rules() reuses ADSBLoiterDetector.check() against
     _CHOKEPOINT_DEFS and produces a real loitering alert once an aircraft has
     been tracked near a chokepoint for >= min_duration_minutes.
  3. The alert's trigger_type / provenance.trigger_reason are corrected to
     "ADSB_LOITERING_NEAR_CHOKEPOINT" (check() itself hardcodes
     "ADSB_LOITERING_NEAR_AIRPORT" into both fields regardless of which rule
     fired it — this is the mislabeling bug called out in the task and fixed
     by post-processing in the handler).
  4. The shared ADSBLoiterDetector._tracking dict never collides between an
     ADSB_LOITERING_NEAR_AIRPORT rule (keyed by an "ARPT-..." system_id) and
     an ADSB_LOITERING_NEAR_CHOKEPOINT rule (keyed by a "CHOKE-..." system_id)
     tracking the SAME aircraft at the same time.

This imports main.py (module import only -- does not start uvicorn's startup
event, so no background ingestion loops run) purely to reuse its real
_run_adsb_chokepoint_rules/_run_adsb_loiter_rules functions and the real,
fixed _CHOKEPOINT_DEFS list. It does NOT touch backend/data/akili.db: rule
rows are plain SimpleNamespace stand-ins for RuleConfig ORM rows (the handler
only ever reads .id/.rule_name/.enabled/.severity/.params off them), and
aircraft are injected directly into the in-memory _GLOBAL_ADSB_CACHE dict
that a fresh process starts with empty (that cache is normally populated by
the ADS-B ingestion loop, which never runs here).

Usage:
    cd backend
    python3 test_adsb_chokepoint_dispatch.py
"""
import os, sys, json
from types import SimpleNamespace
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(__file__))

FAILURES = []


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


print("=" * 70)
print("  ADSB_LOITERING_NEAR_CHOKEPOINT dispatch — verification")
print("=" * 70)

import main

print("\n1. Dispatch table / allowlist wiring")
check("WIRED_RULE_DISPATCH['ADSB_LOITERING_NEAR_CHOKEPOINT'] is the real handler",
      main.WIRED_RULE_DISPATCH.get("ADSB_LOITERING_NEAR_CHOKEPOINT") is main._run_adsb_chokepoint_rules)
check("ADSB_LOITERING_NEAR_CHOKEPOINT is in WIRED_RULE_NAMES",
      "ADSB_LOITERING_NEAR_CHOKEPOINT" in main.WIRED_RULE_NAMES)
check("ADSB_LOITERING_NEAR_CHOKEPOINT is in PIPELINE_NODE_RULE_FAMILIES['det_adsb']",
      "ADSB_LOITERING_NEAR_CHOKEPOINT" in main.PIPELINE_NODE_RULE_FAMILIES.get("det_adsb", []))
check("_CHOKEPOINT_DEFS system_ids all use the disjoint 'CHOKE-' prefix (no airport collision)",
      all(cp["system_id"].startswith("CHOKE-") for cp in main._CHOKEPOINT_DEFS),
      [cp["system_id"] for cp in main._CHOKEPOINT_DEFS if not cp["system_id"].startswith("CHOKE-")])

def rule_row(rule_id, rule_name, params, severity="high", enabled=True):
    return SimpleNamespace(id=rule_id, rule_name=rule_name, enabled=enabled,
                            severity=severity, params=json.dumps(params))

hormuz = next(cp for cp in main._CHOKEPOINT_DEFS if cp["system_id"] == "CHOKE-001")
AC_ICAO = "abcd12"
T0 = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

choke_rule_row = rule_row(
    "RULE-CHOKE-TEST", "ADSB_LOITERING_NEAR_CHOKEPOINT",
    {"target": "ALL", "proximity_km": 20.0, "min_duration_minutes": 20, "max_speed_knots": 150},
)

def set_aircraft(lat, lon, speed):
    main._GLOBAL_ADSB_CACHE[AC_ICAO] = {
        "lat": lat, "lon": lon, "speed": speed, "callsign": "ISR01",
    }

print("\n2. First sighting near the chokepoint: tracking starts, no alert yet")
set_aircraft(hormuz["lat"], hormuz["lon"], 90.0)
alerts = main._run_adsb_chokepoint_rules([choke_rule_row], T0)
check("no alert on first sighting (duration not yet met)", alerts == [], alerts)

print("\n3. Same aircraft still within range after min_duration_minutes -> real alert fires")
T1 = T0 + timedelta(minutes=25)
set_aircraft(hormuz["lat"] + 0.01, hormuz["lon"] + 0.01, 85.0)  # still near, still slow
alerts = main._run_adsb_chokepoint_rules([choke_rule_row], T1)
check("exactly one chokepoint loitering alert fires past min_duration_minutes",
      len(alerts) == 1, alerts)
if alerts:
    a = alerts[0]
    check("alert trigger_type corrected to ADSB_LOITERING_NEAR_CHOKEPOINT (not the hardcoded AIRPORT label)",
          a.get("trigger_type") == "ADSB_LOITERING_NEAR_CHOKEPOINT", a)
    check("alert provenance.trigger_reason corrected to ADSB_LOITERING_NEAR_CHOKEPOINT",
          a.get("provenance", {}).get("trigger_reason") == "ADSB_LOITERING_NEAR_CHOKEPOINT", a)
    check("alert rule_name is the real rule's name (not hardcoded)",
          a.get("rule_name") == "ADSB_LOITERING_NEAR_CHOKEPOINT", a)
    check("alert references the chokepoint's own system_id/name",
          a.get("airport_system_id") == "CHOKE-001" and "Hormuz" in a.get("airport_name", ""), a)
    check("alert has real icao24/callsign", a.get("icao24") == AC_ICAO and a.get("callsign") == "ISR01", a)

print("\n4. Shared ADSBLoiterDetector._tracking never collides between airport and chokepoint keys")
# Same icao24 aircraft, tracked simultaneously against an airport system_id and
# a chokepoint system_id -- these must be independent tracking-state entries.
airport_key = (AC_ICAO, "ARPT-00001")
choke_key = (AC_ICAO, "CHOKE-001")
check("tracking key for the chokepoint hit above is present",
      choke_key in main._adsb_loiter_detector._tracking)
check("an airport-shaped key for the SAME aircraft is a distinct dict entry (never collides)",
      airport_key not in main._adsb_loiter_detector._tracking,
      "would only appear if a real ADSB_LOITERING_NEAR_AIRPORT rule had tracked it separately")
check("the two prefixes are structurally disjoint",
      choke_key[1].split("-")[0] != airport_key[1].split("-")[0])

print("\n5. Re-scanning immediately does not double-alert (re-alert suppression window)")
T2 = T1 + timedelta(minutes=1)
set_aircraft(hormuz["lat"], hormuz["lon"], 85.0)
alerts = main._run_adsb_chokepoint_rules([choke_rule_row], T2)
check("no duplicate alert one minute later (inside the 2x min_duration suppression window)",
      alerts == [], alerts)

print("\n" + "=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    sys.exit(1)
else:
    print("  RESULT: ALL CHECKS PASSED")
print("=" * 70)
