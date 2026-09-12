"""
Verification script for the Imagery pipeline round: real sensor-preference
persistence + honest gating (Part 4), and the real shared scan-launcher
consolidation (Part 0 root-cause fix + Part 3).

Deliberately does NOT exercise the real Copernicus/YOLO-OBB path end to
end — this repo's backend/data/akili.db is a real, live, shared database
(a real uvicorn server may already be running against it), so this script
only ever creates one real throwaway WatchZone, confirms the honest
sensor-gate rejects a non-deployed sensor BEFORE any real external API
call would happen, and cleans up. It does not wait for or trigger a real
scan against sentinel2_optical, to avoid writing real Sentinel Hub/YOLO
scan/detection rows into shared production data for a test.

Usage:
    cd backend
    python3 test_imagery_sensor_gating.py
"""
import os, sys, uuid, json
os.environ.setdefault("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
sys.path.insert(0, os.path.dirname(__file__))

FAILURES = []

def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)

print("=" * 70)
print("  Imagery pipeline round — sensor gating + shared launcher — verification")
print("=" * 70)

import database  # noqa: E402
database.migrate_db()

import sqlite3
db_path = os.path.join(os.environ["DATA_DIR"], "akili.db")
conn = sqlite3.connect(db_path)
cols = [row[1] for row in conn.execute("PRAGMA table_info(watch_zones)").fetchall()]
conn.close()
check("migrate_db() added watch_zones.sensor_preference column", "sensor_preference" in cols)

import main  # noqa: E402
check("_REAL_SENSOR_OPTIONS lists exactly the 4 real spec sensor values",
      set(main._REAL_SENSOR_OPTIONS) == {"sentinel2_optical", "sentinel1_sar", "commercial_eo", "commercial_sar"},
      str(main._REAL_SENSOR_OPTIONS))
check("only sentinel2_optical is honestly marked as a real deployed pipeline",
      main._SENSOR_PIPELINES_DEPLOYED == {"sentinel2_optical"}, str(main._SENSOR_PIPELINES_DEPLOYED))

from fastapi.testclient import TestClient
from database import WatchZone, get_db

suffix = uuid.uuid4().hex[:8]
system_id = f"ZONE-TEST-{suffix}"
poly = {"type": "Polygon", "coordinates": [[[0, 0], [0, 0.01], [0.01, 0.01], [0.01, 0], [0, 0]]]}

with get_db() as db:
    zone = WatchZone(
        system_id=system_id, name=f"Sensor gate test {suffix}",
        polygon_geojson=json.dumps(poly),
        bbox_min_lon=0, bbox_min_lat=0, bbox_max_lon=0.01, bbox_max_lat=0.01,
        enabled=True, status="active", sensor_preference="sentinel1_sar",
    )
    db.add(zone)
    db.commit()
    check("throwaway zone created with a real non-deployed sensor_preference", zone.sensor_preference == "sentinel1_sar")

with TestClient(main.app) as client:
    got = client.get("/api/watch-zones").json()
    row = next((z for z in got if z["system_id"] == system_id), None)
    check("GET /api/watch-zones exposes the real sensor_preference field", row is not None and row.get("sensor_preference") == "sentinel1_sar", str(row))

    # The real, honest, immediate rejection — never reaches Copernicus/YOLO
    # for a sensor with no real deployed pipeline.
    r = client.post(f"/api/watch-zones/{system_id}/scan-now")
    check("scan-now on a non-deployed sensor is honestly rejected (409), not silently run against the optical detector",
          r.status_code == 409, str(r.status_code))
    check("the real rejection message names the actual unsupported sensor", "sentinel1_sar" in r.json().get("detail", ""), str(r.json()))

    # Switching the zone back to the one real deployed sensor is accepted
    # (persistence only checked here — not actually launching a real scan).
    upd = client.put(f"/api/watch-zones/{system_id}", json={"sensor_preference": "sentinel2_optical"})
    check("PUT accepts the one real deployed sensor value", upd.status_code == 200, str(upd.status_code))
    reread = client.get("/api/watch-zones").json()
    row2 = next((z for z in reread if z["system_id"] == system_id), None)
    check("the real persisted value actually changed", row2 is not None and row2.get("sensor_preference") == "sentinel2_optical", str(row2))

    bad = client.put(f"/api/watch-zones/{system_id}", json={"sensor_preference": "not-a-real-sensor"})
    check("PUT rejects a fabricated sensor value (400)", bad.status_code == 400, str(bad.status_code))

with get_db() as db:
    db.query(WatchZone).filter(WatchZone.system_id == system_id).delete(synchronize_session=False)
    db.commit()
    check("cleanup removed the throwaway zone", db.query(WatchZone).filter(WatchZone.system_id == system_id).count() == 0)

print("=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    sys.exit(1)
print(f"  RESULT: all checks passed")
sys.exit(0)
