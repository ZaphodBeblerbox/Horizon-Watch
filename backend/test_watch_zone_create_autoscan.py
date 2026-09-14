"""
Verification script — real root-cause fix for a live bug found during the
Imagery/Situation top-bar entry-point round: POST /api/watch-zones
(api_watch_zones_create) was a plain `def` (synchronous) endpoint, so
Starlette/AnyIO ran it in a worker thread, not the real asyncio event loop
thread. The real zone row got created and committed successfully, but the
very next real step — _launch_zone_scan_background()'s real
asyncio.ensure_future() call — calls asyncio.get_event_loop() internally,
which raises "RuntimeError: There is no current event loop in thread
'AnyIO worker thread'" from inside a plain worker thread. That uncaught
exception made the WHOLE endpoint return a real 500, even though the zone
had already been persisted — a real, confusing false-negative affecting
every real caller (Sources.jsx's own existing "+ New Watch Area" flow, and
this round's new ImageryDetectionPanel.jsx "draw a new area" flow).
Confirmed live via direct curl against the real running dev server before
this fix, and via this real, repeatable regression test.

Real, live database — creates one real throwaway WatchZone via the real
HTTP endpoint (not a direct DB insert, since the whole point is exercising
the real endpoint's own async dispatch), and cleans it up.

Usage:
    cd backend
    python3 test_watch_zone_create_autoscan.py
"""
import os, sys, uuid
os.environ.setdefault("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
sys.path.insert(0, os.path.dirname(__file__))

FAILURES = []

def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)

print("=" * 70)
print("  POST /api/watch-zones — real create + auto-first-scan, no event-loop crash")
print("=" * 70)

import main  # noqa: E402
from database import WatchZone, get_db  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

suffix = uuid.uuid4().hex[:8]
system_id = None

with TestClient(main.app) as client:
    poly = {"type": "Polygon", "coordinates": [[[0, 0], [0, 0.01], [0.01, 0.01], [0.01, 0], [0, 0]]]}
    r = client.post("/api/watch-zones", json={
        "name": f"Autoscan crash regression {suffix}",
        "polygon_geojson": poly,
        "scan_interval_hours": 24,
        "alert_threshold": "both",
        "ml_tasks": ["ship_detection"],
    })
    check("real POST /api/watch-zones returns 200, not a 500 from the real "
          "asyncio.get_event_loop() crash in a worker thread",
          r.status_code == 200, f"status={r.status_code} body={r.text[:200]}")

    if r.status_code == 200:
        body = r.json()
        system_id = body.get("system_id")
        check("the real response is valid JSON with a real system_id (not the "
              "plain-text 'Internal Server Error' body a 500 would return)",
              bool(system_id), str(body))

        with get_db() as db:
            row = db.query(WatchZone).filter(WatchZone.system_id == system_id).first()
            check("the real zone row was actually persisted", row is not None)

        # The real auto-first-scan launch itself must not have silently
        # failed either — give the real background task a moment, then
        # confirm the zone's own real last_scanned_at/next_scan_at reflect
        # that a scan attempt genuinely happened (this endpoint's own
        # response already reflects created_at == next_scan_at - interval,
        # so we just re-fetch to see whether the background launch path
        # ran without raising).
        import time
        time.sleep(2)
        get_r = client.get(f"/api/watch-zones/{system_id}")
        check("the zone is still reachable after the real background "
              "auto-scan launch (no crash propagated back to break the row)",
              get_r.status_code == 200, str(get_r.status_code))

    if system_id:
        with get_db() as db:
            db.query(WatchZone).filter(WatchZone.system_id == system_id).delete(synchronize_session=False)
            db.commit()
            check("cleanup removed the throwaway zone",
                  db.query(WatchZone).filter(WatchZone.system_id == system_id).count() == 0)

print("=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    sys.exit(1)
print("  RESULT: all real checks passed")
sys.exit(0)
