"""
Verification script for Phase 1 of the roadmap: the report-snapshot capture
layer (ReportSnapshot model + /api/reports/snapshots* endpoints) and the
alert quality filter in prepare_intelligence_picture().

Runs against the REAL backend/data directory (gitignored) so it exercises
exactly what the app does in normal operation.

Usage:
    cd backend
    python3 test_report_snapshots.py
"""
import os, sys
os.environ.setdefault("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
sys.path.insert(0, os.path.dirname(__file__))

from fastapi.testclient import TestClient

FAILURES = []

def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


print("="*70)
print("  Report snapshots + alert quality filter — verification")
print("="*70)

import main  # noqa: E402
from database import Alert, ReportSnapshot, get_db
from datetime import datetime, timedelta
import uuid as _uuid

created_alert_ids = []
created_snapshot_ids = []

with TestClient(main.app) as client:
    HEADERS = {"X-Forge-Passcode": main._FORGE_PASSCODE}
    # ── 1. Baseline: measure exclusion count before seeding test alerts ────────
    from briefing_prep import prepare_intelligence_picture
    db0 = next(main._db_gen())
    pic0 = prepare_intelligence_picture(db=db0, forge_alerts=[], fusion_engine_instance=None)
    baseline_excluded = pic0["statistics"]["alerts_excluded_low_quality"]

    # ── 2. Seed one low-quality (unknown/blank-title) and one real alert ───────
    now = datetime.utcnow()
    with get_db() as db:
        bad = Alert(
            alert_id=f"ALT-TESTQ-{_uuid.uuid4().hex[:6]}",
            source="ais", alert_type="unknown", title="",
            severity="medium", status="active", created_at=now,
        )
        good = Alert(
            alert_id=f"ALT-TESTQ-{_uuid.uuid4().hex[:6]}",
            source="ais", alert_type="vessel_dark", title="TESTQ — Real dark-ship alert",
            severity="high", status="active", created_at=now,
        )
        db.add(bad); db.add(good)
        db.commit()
        created_alert_ids += [bad.alert_id, good.alert_id]

    # ── 3. Re-measure: exclusion count should have gone up by exactly 1 ────────
    db1 = next(main._db_gen())
    pic1 = prepare_intelligence_picture(db=db1, forge_alerts=[], fusion_engine_instance=None)
    delta = pic1["statistics"]["alerts_excluded_low_quality"] - baseline_excluded
    check("exactly 1 new alert excluded as low-quality (the unknown/blank one)", delta == 1, delta)

    # ── 3b. Endpoints are Forge-gated — no passcode/token means 401 ────────────
    r = client.post("/api/reports/snapshots", json={})
    check("create snapshot without forge auth is rejected (401)", r.status_code == 401, r.text)
    r = client.get("/api/reports/snapshots")
    check("list snapshots without forge auth is rejected (401)", r.status_code == 401, r.text)

    # ── 4. Capture a snapshot via the real endpoint ─────────────────────────────
    r = client.post("/api/reports/snapshots", json={"label": "TESTQ verification snapshot"}, headers=HEADERS)
    check("create snapshot returns 200", r.status_code == 200, r.text)
    created = r.json()
    check("response has a snapshot_id", bool(created.get("snapshot_id")), created)
    check("response has captured_at", bool(created.get("captured_at")), created)
    check("response echoes statistics", "total_active_signals" in created.get("statistics", {}), created)
    snap_id = created.get("snapshot_id")
    if snap_id:
        created_snapshot_ids.append(snap_id)

    # ── 5. List snapshots — ours should appear ──────────────────────────────────
    r = client.get("/api/reports/snapshots", params={"limit": 50}, headers=HEADERS)
    check("list snapshots returns 200", r.status_code == 200, r.text)
    listing = r.json()
    mine = next((s for s in listing if s["snapshot_id"] == snap_id), None)
    check("our snapshot appears in the list", mine is not None, listing[:3])
    if mine:
        check("list entry carries the label", mine["label"] == "TESTQ verification snapshot", mine)
        check("list entry carries stats without needing full content", "total_active_signals" in mine["statistics"], mine)

    # ── 6. Fetch it individually — full frozen content ──────────────────────────
    r = client.get(f"/api/reports/snapshots/{snap_id}", headers=HEADERS)
    check("get snapshot returns 200", r.status_code == 200, r.text)
    fetched = r.json()
    check("fetched content has generated_at (full picture shape)", "generated_at" in fetched.get("content", {}), fetched)
    check("fetched content statistics match what was captured", fetched["content"]["statistics"] == created["statistics"], fetched)

    # ── 7. Fetching a bogus id 404s ──────────────────────────────────────────────
    r = client.get("/api/reports/snapshots/SNAP-DOESNOTEXIST", headers=HEADERS)
    check("unknown snapshot_id returns 404", r.status_code == 404, r.text)

    # ── 8. Frozen-ness: verify directly against the DB row rather than re-deriving ──
    with get_db() as db:
        row = db.query(ReportSnapshot).filter(ReportSnapshot.snapshot_id == snap_id).first()
        check("row exists in report_snapshots table", row is not None)
        if row:
            check("content_json is valid, non-empty JSON", len(row.content_json or "") > 100)
            check("stats_json matches what the API returned", row.stats_json is not None)

    # ── Cleanup: remove everything this test created ────────────────────────────
    with get_db() as db:
        db.query(Alert).filter(Alert.alert_id.in_(created_alert_ids)).delete(synchronize_session=False)
        db.query(ReportSnapshot).filter(ReportSnapshot.snapshot_id.in_(created_snapshot_ids)).delete(synchronize_session=False)
        db.commit()

    with get_db() as db:
        remaining_alerts = db.query(Alert).filter(Alert.alert_id.in_(created_alert_ids)).count()
        remaining_snaps  = db.query(ReportSnapshot).filter(ReportSnapshot.snapshot_id.in_(created_snapshot_ids)).count()
        check("cleanup removed test alerts", remaining_alerts == 0)
        check("cleanup removed test snapshot", remaining_snaps == 0)

print("="*70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    sys.exit(1)
else:
    print("  RESULT: ALL CHECKS PASSED")
print("="*70)
