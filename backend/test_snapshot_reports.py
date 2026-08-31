"""
Verification for "Generate Snapshot Report" (POST /api/reports/tasks/snapshot):
a real ReportTask that, instead of collecting over a scheduled window,
assembles the intelligence picture for its scope RIGHT NOW via the same
prepare_intelligence_picture()/_freeze_task_snapshot() path
finish_report_task_collection() already uses, landing directly on
ready_to_draft.

Covers:
  1. No watch_zone_id -> global/unscoped scope (same picture the existing
     unscoped POST /api/reports/snapshots endpoint produces).
  2. A real, enabled WatchZone's own bbox (not a named REGION_BBOXES entry)
     actually scopes what's captured — an in-bbox FusionEvent is included,
     a far-outside one is not.
  3. An unknown/disabled watch_zone_id is rejected (404), not silently
     treated as unscoped.
  4. The full status machine still proceeds unchanged from ready_to_draft
     onward: draft -> submit-for-review -> approve -> publish -> pdf.

Runs against the REAL backend/data directory (gitignored) so it exercises
exactly what the app does in normal operation.

Usage:
    cd backend
    python3 test_snapshot_reports.py
"""
import os, sys, json
os.environ.setdefault("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
sys.path.insert(0, os.path.dirname(__file__))

from fastapi.testclient import TestClient
from datetime import datetime, timedelta

FAILURES = []


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


print("=" * 70)
print("  Generate Snapshot Report (POST /api/reports/tasks/snapshot) — verification")
print("=" * 70)

import main  # noqa: E402
from database import FusionEvent, Report, ReportSnapshot, ReportTask, WatchZone, get_db  # noqa: E402

PREFIX = "TESTSNAP"
HEADERS = {}

created_fusion_ids   = []
created_task_ids     = []
created_report_ids   = []
created_snapshot_ids = []
created_zone_ids     = []

with TestClient(main.app) as client:
    now = datetime.utcnow()

    # A zone in a part of the world with no seeded fixtures nearby (avoids
    # coincidentally overlapping real background data from other tests /
    # live feeds running in-process).
    IN_ZONE_LAT,  IN_ZONE_LON  = 5.0, 5.0
    OUT_ZONE_LAT, OUT_ZONE_LON = -40.0, -60.0

    with get_db() as db:
        in_zone_fusion = FusionEvent(
            fusion_id=f"{PREFIX}-FE-IN", title=f"{PREFIX} in-zone fusion",
            status="active", expires_at=now + timedelta(hours=6),
            lat=IN_ZONE_LAT, lon=IN_ZONE_LON, created_at=now, confidence=0.8,
        )
        out_zone_fusion = FusionEvent(
            fusion_id=f"{PREFIX}-FE-OUT", title=f"{PREFIX} out-of-zone fusion",
            status="active", expires_at=now + timedelta(hours=6),
            lat=OUT_ZONE_LAT, lon=OUT_ZONE_LON, created_at=now, confidence=0.8,
        )
        db.add_all([in_zone_fusion, out_zone_fusion])
        db.commit()
        created_fusion_ids += [in_zone_fusion.fusion_id, out_zone_fusion.fusion_id]

        zone = WatchZone(
            system_id=f"{PREFIX}-ZONE", name=f"{PREFIX} zone",
            polygon_geojson="{}",
            bbox_min_lon=4.0, bbox_min_lat=4.0, bbox_max_lon=6.0, bbox_max_lat=6.0,
            enabled=True,
        )
        db.add(zone)
        db.commit()
        created_zone_ids.append(zone.system_id)

    # ── 1. No watch_zone_id -> global scope, straight to ready_to_draft ────────
    r = client.post("/api/reports/tasks/snapshot", json={"focus": f"{PREFIX} global"}, headers=HEADERS)
    check("create global snapshot task returns 200", r.status_code == 200, r.text)
    global_task = r.json()
    created_task_ids.append(global_task["task_id"])
    check("global snapshot task lands directly on ready_to_draft (no collecting wait)",
          global_task["status"] == "ready_to_draft", global_task)
    check("global snapshot task has a real snapshot_id", bool(global_task["snapshot_id"]), global_task)
    check("global snapshot task has no watch_zone_id", global_task["watch_zone_id"] is None, global_task)
    created_snapshot_ids.append(global_task["snapshot_id"])

    r = client.get(f"/api/reports/snapshots/{global_task['snapshot_id']}", headers=HEADERS)
    global_content = r.json()["content"]
    global_titles = [f["title"] for f in global_content["fusion_events"]]
    check("global snapshot includes the in-zone fusion (unscoped)", f"{PREFIX} in-zone fusion" in global_titles, global_titles)
    check("global snapshot includes the out-of-zone fusion too (unscoped)", f"{PREFIX} out-of-zone fusion" in global_titles, global_titles)

    # ── 2. A real WatchZone's own bbox actually scopes the capture ──────────────
    r = client.post("/api/reports/tasks/snapshot", json={
        "focus": f"{PREFIX} zone-scoped", "watch_zone_id": f"{PREFIX}-ZONE",
    }, headers=HEADERS)
    check("create zone-scoped snapshot task returns 200", r.status_code == 200, r.text)
    zone_task = r.json()
    created_task_ids.append(zone_task["task_id"])
    check("zone-scoped snapshot task lands directly on ready_to_draft", zone_task["status"] == "ready_to_draft", zone_task)
    check("zone-scoped snapshot task records the real watch_zone_id", zone_task["watch_zone_id"] == f"{PREFIX}-ZONE", zone_task)
    check("zone-scoped snapshot task's region shows the zone's real name (for display)",
          zone_task["region"] == [f"{PREFIX} zone"], zone_task)
    created_snapshot_ids.append(zone_task["snapshot_id"])

    r = client.get(f"/api/reports/snapshots/{zone_task['snapshot_id']}", headers=HEADERS)
    zone_content = r.json()["content"]
    zone_titles = [f["title"] for f in zone_content["fusion_events"]]
    check("zone-scoped snapshot includes the in-zone fusion", f"{PREFIX} in-zone fusion" in zone_titles, zone_titles)
    check("zone-scoped snapshot does NOT include the far-outside fusion", f"{PREFIX} out-of-zone fusion" not in zone_titles, zone_titles)

    # ── 3. Unknown/disabled watch_zone_id is rejected, not silently unscoped ────
    r = client.post("/api/reports/tasks/snapshot", json={"watch_zone_id": f"{PREFIX}-NOPE"}, headers=HEADERS)
    check("unknown watch_zone_id is rejected (404)", r.status_code == 404, r.text)

    with get_db() as db:
        db.query(WatchZone).filter(WatchZone.system_id == f"{PREFIX}-ZONE").update({"enabled": False})
        db.commit()
    r = client.post("/api/reports/tasks/snapshot", json={"watch_zone_id": f"{PREFIX}-ZONE"}, headers=HEADERS)
    check("disabled watch_zone_id is also rejected (404), not silently unscoped", r.status_code == 404, r.text)

    # ── 4. Full status machine proceeds unchanged from ready_to_draft on ───────
    task_id = global_task["task_id"]
    r = client.post(f"/api/reports/tasks/{task_id}/draft", json={}, headers=HEADERS)
    check("draft succeeds from a snapshot-created task", r.status_code == 200, r.text)
    report_id = r.json()["report_id"]
    created_report_ids.append(report_id)

    real_fusion_id = global_content["fusion_events"][0]["fusion_id"] if global_content["fusion_events"] else None
    check("a real fusion_id exists in the snapshot to cite", real_fusion_id is not None, global_content.get("fusion_events"))

    r = client.patch(f"/api/reports/{report_id}", json={
        "claims": [{
            "text": "A real fusion event is active in this snapshot.",
            "citation": {"type": "snapshot_ref", "section": "fusion_events", "item_id": real_fusion_id},
        }],
    }, headers=HEADERS)
    check("adding a real, grounded claim succeeds", r.status_code == 200, r.text)

    r = client.post(f"/api/reports/{report_id}/submit-for-review", json={}, headers=HEADERS)
    check("submit-for-review succeeds", r.status_code == 200, r.text)
    submitted = r.json()
    check("status moves to in_review", submitted["status"] == "in_review", submitted)
    deterministic = (submitted.get("council_findings") or {}).get("deterministic") or []
    check(
        "deterministic citation_exists check passes for the real, grounded claim",
        any(d.get("check") == "citation_exists" and d.get("passed") for d in deterministic),
        deterministic,
    )

    r = client.post(f"/api/reports/{report_id}/approve", json={}, headers=HEADERS)
    check("approve succeeds", r.status_code == 200, r.text)

    r = client.post(f"/api/reports/{report_id}/publish", headers=HEADERS)
    check("publish succeeds", r.status_code == 200, r.text)
    check("published status is real", r.json()["status"] == "published", r.json())

    r = client.get(f"/api/reports/{report_id}/pdf", headers=HEADERS)
    check("pdf endpoint returns 200", r.status_code == 200, r.status_code)
    check("pdf content-type is application/pdf", r.headers.get("content-type", "").startswith("application/pdf"), r.headers)
    check("pdf is a real PDF (magic bytes)", r.content[:5] == b"%PDF-", r.content[:20])
    check("pdf has substantive real content, not a near-empty stub", len(r.content) > 2000, len(r.content))

    r = client.get(f"/api/reports/tasks/{task_id}", headers=HEADERS)
    check("task status synced to published end-to-end", r.json()["status"] == "published", r.json())

    # ── Cleanup ──────────────────────────────────────────────────────────────────
    with get_db() as db:
        db.query(FusionEvent).filter(FusionEvent.fusion_id.in_(created_fusion_ids)).delete(synchronize_session=False)
        db.query(Report).filter(Report.report_id.in_(created_report_ids)).delete(synchronize_session=False)
        db.query(ReportSnapshot).filter(ReportSnapshot.snapshot_id.in_(created_snapshot_ids)).delete(synchronize_session=False)
        db.query(ReportTask).filter(ReportTask.task_id.in_(created_task_ids)).delete(synchronize_session=False)
        db.query(WatchZone).filter(WatchZone.system_id.in_(created_zone_ids)).delete(synchronize_session=False)
        db.commit()
        check("cleanup removed test fusions", db.query(FusionEvent).filter(FusionEvent.fusion_id.in_(created_fusion_ids)).count() == 0)
        check("cleanup removed test reports", db.query(Report).filter(Report.report_id.in_(created_report_ids)).count() == 0)
        check("cleanup removed test snapshots", db.query(ReportSnapshot).filter(ReportSnapshot.snapshot_id.in_(created_snapshot_ids)).count() == 0)
        check("cleanup removed test tasks", db.query(ReportTask).filter(ReportTask.task_id.in_(created_task_ids)).count() == 0)
        check("cleanup removed test zone", db.query(WatchZone).filter(WatchZone.system_id.in_(created_zone_ids)).count() == 0)

print("=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    sys.exit(1)
else:
    print("  RESULT: ALL CHECKS PASSED")
print("=" * 70)
