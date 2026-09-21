"""
Verification script for AISSpoofingDetector (backend/detectors/correlation_engine.py):
flags a physically-impossible position jump and an inconsistent vessel identity
(name) for the same MMSI between consecutive detection cycles.

This is a plain unit test of a Python class with synthetic vessel dicts across
simulated cycles — no FastAPI TestClient / DB fixtures needed.

Usage:
    cd backend
    python3 test_ais_spoofing.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))

from datetime import datetime, timezone, timedelta

from detectors.correlation_engine import AISSpoofingDetector

FAILURES = []


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


def vessel(lat, lng, name="MV TESTSHIP", ship_type="Cargo", speed=12.0):
    return {
        "mmsi": "123456789",
        "name": name,
        "lat": lat,
        "lng": lng,
        "speed": speed,
        "heading": 90.0,
        "ship_type": ship_type,
        "destination": "ROTTERDAM",
        "flag": "PA",
    }


print("=" * 70)
print("  AISSpoofingDetector — verification")
print("=" * 70)

T0 = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

# ── 1. First-ever sighting produces no alert ────────────────────────────────
det = AISSpoofingDetector()
mmsi = "123456789"
v1 = vessel(lat=51.9, lng=4.5)  # off Rotterdam
alerts = det.check(mmsi, v1, T0)
check("first sighting produces no alert", alerts == [], alerts)
check("first sighting recorded internal state", mmsi in det._last)

# ── 2. Normal, physically-plausible movement produces no alert ─────────────
# ~10 km in 5 minutes => 60 km/h => ~32 knots, well under threshold.
T1 = T0 + timedelta(minutes=5)
v2 = vessel(lat=51.99, lng=4.5)  # ~10km north
alerts = det.check(mmsi, v2, T1)
check("normal movement produces no alert", alerts == [], alerts)

# ── 3. Physically-impossible jump (1000km in 5 minutes) ────────────────────
T2 = T1 + timedelta(minutes=5)
v3 = vessel(lat=60.99, lng=4.5)  # ~1000km north of v2 in 5 minutes
alerts = det.check(mmsi, v3, T2)
jump_alerts = [a for a in alerts if a.get("rule_trigger") == "AIS_POSITION_JUMP"]
check("impossible jump produces exactly one position-jump alert", len(jump_alerts) == 1, alerts)
if jump_alerts:
    a = jump_alerts[0]
    check("position-jump alert has correct mmsi", a.get("mmsi") == mmsi, a)
    check("position-jump alert lat/lng is CURRENT position", a.get("lat") == 60.99 and a.get("lng") == 4.5, a)
    check("position-jump alert has sensible message", "km" in a.get("message", "") and "kn" in a.get("message", ""), a)
    check("position-jump alert has AIS source/high severity", a.get("source") == "AIS" and a.get("severity") == "high", a)
    check("position-jump alert has icon_type POSITION_JUMP", a.get("icon_type") == "POSITION_JUMP", a)
    check("position-jump alert has provenance block", "provenance" in a and a["provenance"].get("source_type") == "AIS", a)

# ── 4. Genuine identity mismatch: name changes, real value -> different real value
det2 = AISSpoofingDetector()
va = vessel(lat=1.0, lng=103.8, name="MV ALPHA")
det2.check(mmsi, va, T0)
vb = vessel(lat=1.01, lng=103.81, name="MV BRAVO")  # small, plausible movement
alerts = det2.check(mmsi, vb, T0 + timedelta(minutes=5))
id_alerts = [a for a in alerts if a.get("rule_trigger") == "AIS_IDENTITY_MISMATCH"]
check("genuine identity mismatch produces exactly one identity alert", len(id_alerts) == 1, alerts)
if id_alerts:
    a = id_alerts[0]
    check("identity alert has correct mmsi", a.get("mmsi") == mmsi, a)
    check("identity alert mentions both names", "ALPHA" in a.get("message", "") and "BRAVO" in a.get("message", ""), a)
    check("identity alert has icon_type IDENTITY_CHANGE", a.get("icon_type") == "IDENTITY_CHANGE", a)

# ── 5. ship_type empty/unknown -> real value does NOT falsely flag ─────────
det3 = AISSpoofingDetector()
vc = vessel(lat=35.0, lng=139.0, name="MV CONSTANT", ship_type="")
det3.check(mmsi, vc, T0)
vd = vessel(lat=35.01, lng=139.0, name="MV CONSTANT", ship_type="Tanker")
alerts = det3.check(mmsi, vd, T0 + timedelta(minutes=5))
check("ship_type unknown->real with unchanged name produces no alert", alerts == [], alerts)

# Also verify ship_type real->real (with name constant) does not trigger — the
# design deliberately never uses ship_type as a trigger field (see docstring).
ve = vessel(lat=35.02, lng=139.0, name="MV CONSTANT", ship_type="Cargo")
alerts = det3.check(mmsi, ve, T0 + timedelta(minutes=10))
check("ship_type real->real with unchanged name produces no alert (ship_type never triggers)", alerts == [], alerts)

# ── 6. Missing/zero lat or lng does not crash and produces no alert, and does
#      not corrupt state for the next legitimate cycle ─────────────────────
det4 = AISSpoofingDetector()
vf = vessel(lat=22.3, lng=114.2, name="MV HONGKONG")  # Hong Kong approach
det4.check(mmsi, vf, T0)
v_missing = vessel(lat=0, lng=114.2, name="MV HONGKONG")  # lat falsy
try:
    alerts = det4.check(mmsi, v_missing, T0 + timedelta(minutes=5))
    crashed = False
except Exception as e:
    alerts = None
    crashed = True
check("missing lat does not crash the detector", not crashed)
check("missing lat produces no alert for that cycle", alerts == [], alerts)
# Next legitimate cycle should compare against the ORIGINAL (uncorrupted) state,
# i.e. a small move from the original position should still look normal.
v_next = vessel(lat=22.31, lng=114.2, name="MV HONGKONG")
alerts = det4.check(mmsi, v_next, T0 + timedelta(minutes=10))
check("state not corrupted by missing-lat cycle (small move still looks normal)", alerts == [], alerts)

# ── 7. purge_stale actually removes old entries after the age cutoff ───────
det5 = AISSpoofingDetector()
old_mmsi = "111111111"
fresh_mmsi = "222222222"
det5.check(old_mmsi, vessel(lat=10.0, lng=10.0), T0)
det5.check(fresh_mmsi, vessel(lat=20.0, lng=20.0), T0 + timedelta(hours=47))
check("both entries present before purge", old_mmsi in det5._last and fresh_mmsi in det5._last)
det5.purge_stale(T0 + timedelta(hours=49), max_age_hours=48.0)
check("purge_stale removes entry older than cutoff", old_mmsi not in det5._last)
check("purge_stale keeps entry within cutoff", fresh_mmsi in det5._last)

print("=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    sys.exit(1)
else:
    print("  RESULT: ALL CHECKS PASSED")
print("=" * 70)
