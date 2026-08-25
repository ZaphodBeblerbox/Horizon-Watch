"""
Verification script for Mission Tasking (ReportTask): region/period-scoped
collection sitting in front of the ReportSnapshot/Report pair, and the
task status machine's transitions.

Runs against the REAL backend/data directory (gitignored) so it exercises
exactly what the app does in normal operation.

Usage:
    cd backend
    python3 test_report_tasks.py
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


print("="*70)
print("  Mission Tasking (ReportTask) — verification")
print("="*70)

import main  # noqa: E402
from database import FusionEvent, Report, ReportSnapshot, ReportTask, User, get_db  # noqa: E402
from app_shared import make_jwt  # noqa: E402

# Forge is admin-gated (require_admin_user), not passcode-gated — create a
# real admin test user and mint a real JWT for it, same as any other admin.
_ADMIN_ID = "TESTTASK-ADMIN"
with get_db() as _db:
    _db.merge(User(id=_ADMIN_ID, email="testtask-admin@test.local", password_hash="test",
                    role="admin", approved=True))
    _db.commit()
HEADERS = {"Authorization": f"Bearer {make_jwt(_ADMIN_ID)}"}
PREFIX  = "TESTTASK"

created_fusion_ids   = []
created_snapshot_ids = []
created_report_ids   = []
created_task_ids     = []

# "Red Sea / Arabian Peninsula" bbox per scoring.REGION_BBOXES: (12.0, 30.0, 32.0, 60.0) = (south, north, west, east)
IN_REGION_LAT,  IN_REGION_LON  = 18.0, 42.0     # well inside the bbox
OUT_REGION_LAT, OUT_REGION_LON = -30.0, -60.0   # South America — well outside, and >400km buffer

with TestClient(main.app) as client:
    now = datetime.utcnow()
    period_start = now - timedelta(hours=1)

    # ── 0. Seed three FusionEvents: in-scope, wrong-region, wrong-period ────────
    with get_db() as db:
        in_scope = FusionEvent(
            fusion_id=f"{PREFIX}-FE-IN", title=f"{PREFIX} in-scope fusion",
            status="active", expires_at=now + timedelta(hours=6),
            lat=IN_REGION_LAT, lon=IN_REGION_LON, created_at=now, confidence=0.8,
        )
        out_region = FusionEvent(
            fusion_id=f"{PREFIX}-FE-OUTREGION", title=f"{PREFIX} wrong-region fusion",
            status="active", expires_at=now + timedelta(hours=6),
            lat=OUT_REGION_LAT, lon=OUT_REGION_LON, created_at=now, confidence=0.8,
        )
        out_period = FusionEvent(
            fusion_id=f"{PREFIX}-FE-OUTPERIOD", title=f"{PREFIX} wrong-period fusion",
            status="active", expires_at=now + timedelta(hours=6),
            lat=IN_REGION_LAT, lon=IN_REGION_LON, created_at=now - timedelta(hours=5), confidence=0.8,
        )
        db.add_all([in_scope, out_region, out_period])
        db.commit()
        created_fusion_ids += [in_scope.fusion_id, out_region.fusion_id, out_period.fusion_id]

    # ── 1. Create-time validation ────────────────────────────────────────────────
    r = client.post("/api/reports/tasks", json={"region": "not-a-list-or-auto"}, headers=HEADERS)
    check("invalid region type is rejected (400)", r.status_code == 400, r.text)

    r = client.post("/api/reports/tasks", json={
        "period_start": now.isoformat(), "period_end": (now - timedelta(hours=1)).isoformat(),
    }, headers=HEADERS)
    check("period_end before period_start is rejected (400)", r.status_code == 400, r.text)

    r = client.get("/api/reports/tasks", headers={})
    check("list tasks without auth is rejected (401)", r.status_code == 401, r.text)

    # ── 2. Create a real task scoped to region + period, no period_end (open-ended) ─
    r = client.post("/api/reports/tasks", json={
        "focus": f"{PREFIX} focus — Red Sea watch",
        "region": ["Red Sea / Arabian Peninsula"],
        "period_start": period_start.isoformat(),
    }, headers=HEADERS)
    check("create task returns 200", r.status_code == 200, r.text)
    task = r.json()
    task_id = task["task_id"]
    created_task_ids.append(task_id)
    check("new task starts collecting (period_start already passed)", task["status"] == "collecting", task)
    check("region echoed back as the requested list", task["region"] == ["Red Sea / Arabian Peninsula"], task)

    # ── 3. GET while collecting: region+period actually scope what's collected ──
    r = client.get(f"/api/reports/tasks/{task_id}", headers=HEADERS)
    check("get task returns 200", r.status_code == 200, r.text)
    collecting_view = r.json()
    check("status still collecting", collecting_view["status"] == "collecting", collecting_view)
    fusion_titles_collecting = [f["title"] for f in collecting_view["collected"]["fusion_events"]]
    check("in-scope fusion appears while collecting", f"{PREFIX} in-scope fusion" in fusion_titles_collecting, fusion_titles_collecting)
    check("wrong-region fusion does NOT appear", f"{PREFIX} wrong-region fusion" not in fusion_titles_collecting, fusion_titles_collecting)
    check("wrong-period fusion does NOT appear", f"{PREFIX} wrong-period fusion" not in fusion_titles_collecting, fusion_titles_collecting)
    check("exactly one fusion event in scope", collecting_view["collected"]["statistics"]["active_fusions"] == 1, collecting_view["collected"]["statistics"])

    # ── 4. Illegal transitions are rejected the same way Report's already are ──
    r = client.post(f"/api/reports/tasks/{task_id}/draft", json={}, headers=HEADERS)
    check("drafting a task that isn't ready_to_draft is rejected (409)", r.status_code == 409, r.text)
    r = client.post(f"/api/reports/tasks/{task_id}/archive", headers=HEADERS)
    check("archiving a collecting task is rejected (409)", r.status_code == 409, r.text)
    r = client.get("/api/reports/tasks/TASK-DOESNOTEXIST", headers=HEADERS)
    check("unknown task_id returns 404", r.status_code == 404, r.text)

    # ── 5. Finish collection: freezes a real, immutable ReportSnapshot ──────────
    r = client.post(f"/api/reports/tasks/{task_id}/finish-collection", headers=HEADERS)
    check("finish-collection returns 200", r.status_code == 200, r.text)
    finished = r.json()
    check("status is ready_to_draft", finished["status"] == "ready_to_draft", finished)
    check("snapshot_id was assigned", bool(finished["snapshot_id"]), finished)
    created_snapshot_ids.append(finished["snapshot_id"])

    with get_db() as db:
        snap_row = db.query(ReportSnapshot).filter(ReportSnapshot.snapshot_id == finished["snapshot_id"]).first()
        check("snapshot row exists with source=report_task", snap_row is not None and snap_row.source == "report_task",
              snap_row.source if snap_row else None)
        frozen_content = json.loads(snap_row.content_json)
        check("frozen snapshot has exactly the one in-scope fusion", frozen_content["statistics"]["active_fusions"] == 1,
              frozen_content["statistics"])

    r = client.post(f"/api/reports/tasks/{task_id}/finish-collection", headers=HEADERS)
    check("finishing collection twice is rejected (409)", r.status_code == 409, r.text)

    # ── 6. Partial (collecting) view differs from the final (frozen) view ──────
    # Seed a NEW in-scope fusion AFTER the snapshot was frozen — it must NOT
    # silently appear in the now-ready_to_draft task's "collected" view.
    with get_db() as db:
        late_fusion = FusionEvent(
            fusion_id=f"{PREFIX}-FE-AFTER-FREEZE", title=f"{PREFIX} after-freeze fusion",
            status="active", expires_at=now + timedelta(hours=6),
            lat=IN_REGION_LAT, lon=IN_REGION_LON, created_at=datetime.utcnow(), confidence=0.8,
        )
        db.add(late_fusion)
        db.commit()
        created_fusion_ids.append(late_fusion.fusion_id)

    r = client.get(f"/api/reports/tasks/{task_id}", headers=HEADERS)
    frozen_view = r.json()
    frozen_titles = [f["title"] for f in frozen_view["collected"]["fusion_events"]]
    check("ready_to_draft view is the frozen snapshot, not live data",
          f"{PREFIX} after-freeze fusion" not in frozen_titles, frozen_titles)
    check("frozen view still shows exactly the original one fusion",
          frozen_view["collected"]["statistics"]["active_fusions"] == 1, frozen_view["collected"]["statistics"])

    # ── 7. Draft: reuses the real /api/reports creation path ───────────────────
    r = client.post(f"/api/reports/tasks/{task_id}/draft", json={"title": f"{PREFIX} report"}, headers=HEADERS)
    check("draft returns 200", r.status_code == 200, r.text)
    drafted = r.json()
    check("status is drafting", drafted["status"] == "drafting", drafted)
    report_id = drafted["report_id"]
    check("report_id was assigned", bool(report_id), drafted)
    created_report_ids.append(report_id)

    with get_db() as db:
        rpt_row = db.query(Report).filter(Report.report_id == report_id).first()
        check("underlying report row exists", rpt_row is not None)
        check("underlying report points at the task's frozen snapshot",
              rpt_row is not None and rpt_row.snapshot_id == finished["snapshot_id"])

    r = client.post(f"/api/reports/tasks/{task_id}/draft", json={}, headers=HEADERS)
    check("drafting a task twice is rejected (409)", r.status_code == 409, r.text)

    # ── 8. Task status syncs live with the underlying Report's real status ─────
    r = client.patch(f"/api/reports/{report_id}", json={"claims": [{
        "text": "Test claim for mission tasking verification.",
        "citation": {"type": "external", "url": "https://example.org/test"},
    }]}, headers=HEADERS)
    check("adding a claim to the drafted report succeeds", r.status_code == 200, r.text)

    real_client = main.client
    main.client = None  # exercise the honest no-Claude-client "skipped" path, not a fake result
    r = client.post(f"/api/reports/{report_id}/submit-for-review", headers=HEADERS)
    main.client = real_client
    check("submit-for-review succeeds", r.status_code == 200, r.text)

    r = client.get(f"/api/reports/tasks/{task_id}", headers=HEADERS)
    synced = r.json()
    # See _task_effective_status's docstring: submit-for-review runs the council
    # synchronously in the same call, so council_review is never an observable
    # intermediate state today — human_review is the real, reachable result.
    check("task status synced to human_review after submit-for-review", synced["status"] == "human_review", synced)

    r = client.post(f"/api/reports/{report_id}/approve", json={}, headers=HEADERS)
    check("approve succeeds", r.status_code == 200, r.text)
    r = client.get(f"/api/reports/tasks/{task_id}", headers=HEADERS)
    check("task status synced to approved", r.json()["status"] == "approved", r.json())

    r = client.post(f"/api/reports/tasks/{task_id}/archive", headers=HEADERS)
    check("archiving before publish is rejected (409)", r.status_code == 409, r.text)

    r = client.post(f"/api/reports/{report_id}/publish", headers=HEADERS)
    check("publish succeeds", r.status_code == 200, r.text)
    r = client.get(f"/api/reports/tasks/{task_id}", headers=HEADERS)
    check("task status synced to published", r.json()["status"] == "published", r.json())

    r = client.post(f"/api/reports/tasks/{task_id}/archive", headers=HEADERS)
    check("archive succeeds once published", r.status_code == 200, r.text)
    check("archived task's stored status is archived", r.json()["status"] == "archived", r.json())

    # ── 9. region="auto" resolves from Mission Profile's focusRegions ───────────
    real_profile = main._ACTIVE_PROFILE
    main._ACTIVE_PROFILE = {"focusRegions": ["Red Sea / Arabian Peninsula"]}
    try:
        r = client.post("/api/reports/tasks", json={
            "focus": f"{PREFIX} auto-region task", "region": "auto",
            "period_start": period_start.isoformat(),
        }, headers=HEADERS)
        check("create auto-region task returns 200", r.status_code == 200, r.text)
        auto_task = r.json()
        created_task_ids.append(auto_task["task_id"])
        check("region stored as the literal 'auto'", auto_task["region"] == "auto", auto_task)

        r = client.get(f"/api/reports/tasks/{auto_task['task_id']}", headers=HEADERS)
        auto_view = r.json()
        auto_titles = [f["title"] for f in auto_view["collected"]["fusion_events"]]
        check("auto-region resolves to Mission Profile's focusRegions and scopes correctly",
              f"{PREFIX} in-scope fusion" in auto_titles and f"{PREFIX} wrong-region fusion" not in auto_titles,
              auto_titles)
    finally:
        main._ACTIVE_PROFILE = real_profile

    # ── Cleanup ──────────────────────────────────────────────────────────────────
    with get_db() as db:
        db.query(FusionEvent).filter(FusionEvent.fusion_id.in_(created_fusion_ids)).delete(synchronize_session=False)
        db.query(Report).filter(Report.report_id.in_(created_report_ids)).delete(synchronize_session=False)
        db.query(ReportSnapshot).filter(ReportSnapshot.snapshot_id.in_(created_snapshot_ids)).delete(synchronize_session=False)
        db.query(ReportTask).filter(ReportTask.task_id.in_(created_task_ids)).delete(synchronize_session=False)
        db.commit()
        check("cleanup removed test fusions", db.query(FusionEvent).filter(FusionEvent.fusion_id.in_(created_fusion_ids)).count() == 0)
        check("cleanup removed test reports", db.query(Report).filter(Report.report_id.in_(created_report_ids)).count() == 0)
        check("cleanup removed test snapshots", db.query(ReportSnapshot).filter(ReportSnapshot.snapshot_id.in_(created_snapshot_ids)).count() == 0)
        check("cleanup removed test tasks", db.query(ReportTask).filter(ReportTask.task_id.in_(created_task_ids)).count() == 0)

with get_db() as db:
    db.query(User).filter(User.id == _ADMIN_ID).delete(synchronize_session=False)
    db.commit()
    check("cleanup removed test admin user", db.query(User).filter(User.id == _ADMIN_ID).count() == 0)

print("="*70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    sys.exit(1)
else:
    print("  RESULT: ALL CHECKS PASSED")
print("="*70)
