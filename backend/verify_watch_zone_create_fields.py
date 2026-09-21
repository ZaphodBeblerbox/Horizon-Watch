"""
test_watch_zone_create_fields.py — a region must be created with the sensor
it was asked for.

The defect, found live on 2026-09-19: POST /api/watch-zones accepted
`sensor_preference` and `aoi_class` and discarded both, then ECHOED THE
DEFAULT back in the response. The caller was told "sentinel2_optical" and
had no way to distinguish that from a confirmation, so every region created
through any UI was silently optical whatever the analyst chose.

Sensor decides what a region can ever detect — optical sees what a thing is
and fails under cloud and at night, SAR sees through both and cannot say
what it found — so dropping it makes a region unable to answer the question
it was drawn for.

Runs against a live backend on :8000 and cleans up after itself.

    cd backend && python3 test_watch_zone_create_fields.py
"""
import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8000"
FAILURES = []


def check(label, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


def post(path, payload):
    req = urllib.request.Request(BASE + path, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def box(lon, lat, d=0.02):
    return {"type": "Polygon", "coordinates": [[[lon, lat], [lon + d, lat],
                                                [lon + d, lat + d], [lon, lat + d], [lon, lat]]]}


print("=" * 70)
print("  watch-zone creation — the chosen sensor must survive")
print("=" * 70)

created = []
try:
    st, sar = post("/api/watch-zones", {
        "name": "verify SAR", "polygon_geojson": box(57.10, 26.10),
        "sensor_preference": "sentinel1_sar", "aoi_class": "port",
        "scan_interval_hours": 12,
    })
    if st == 200:
        created.append(sar["system_id"])
    check("a SAR region is created as SAR", st == 200 and sar.get("sensor_preference") == "sentinel1_sar",
          f"status={st} got sensor={sar.get('sensor_preference')!r}")
    check("aoi_class survives too", sar.get("aoi_class") == "port", f"got {sar.get('aoi_class')!r}")
    check("cadence survives", sar.get("scan_interval_hours") == 12, f"got {sar.get('scan_interval_hours')!r}")

    st2, opt = post("/api/watch-zones", {
        "name": "verify optical", "polygon_geojson": box(57.20, 26.20),
        "sensor_preference": "sentinel2_optical",
    })
    if st2 == 200:
        created.append(opt["system_id"])
    check("optical still works", st2 == 200 and opt.get("sensor_preference") == "sentinel2_optical",
          f"status={st2} got {opt.get('sensor_preference')!r}")

    st3, dflt = post("/api/watch-zones", {
        "name": "verify default", "polygon_geojson": box(57.30, 26.30),
    })
    if st3 == 200:
        created.append(dflt["system_id"])
    check("omitting the sensor still defaults to optical",
          st3 == 200 and dflt.get("sensor_preference") == "sentinel2_optical", f"status={st3}")

    # A sensor this backend cannot fetch would fail on every scheduled scan.
    # Refusing at creation is the honest moment.
    st4, bad = post("/api/watch-zones", {
        "name": "verify refusal", "polygon_geojson": box(57.40, 26.40),
        "sensor_preference": "commercial_eo",
    })
    check("an undeployed sensor is refused, not silently downgraded", st4 == 422,
          f"status={st4} body={str(bad)[:120]}")
    check("the refusal names what is acceptable", "sentinel1_sar" in str(bad.get("detail", "")),
          f"detail={bad.get('detail')!r}")
    if st4 == 200:
        created.append(bad.get("system_id"))

finally:
    for sid in created:
        if not sid:
            continue
        req = urllib.request.Request(f"{BASE}/api/watch-zones/{sid}", method="DELETE")
        try:
            urllib.request.urlopen(req, timeout=30)
            print(f"  [PASS] cleaned up {sid}")
        except Exception as e:
            print(f"  [WARN] could not clean up {sid}: {e}")

print("=" * 70)
print("  RESULT:", "all checks passed" if not FAILURES else f"{len(FAILURES)} FAILED: {FAILURES}")
sys.exit(1 if FAILURES else 0)
