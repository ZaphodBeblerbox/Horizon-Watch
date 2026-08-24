"""
Verification script for roadmap Phase 3: the Report entity, status machine,
council review pipeline, and PDF export.

Runs against the REAL backend/data directory (gitignored).

Usage:
    cd backend
    python3 test_reports.py
"""
import os, sys, json
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
print("  Report entity, status machine, council, PDF — verification")
print("="*70)

import main  # noqa: E402
from database import Report, ReportSnapshot, StrategicZone, get_db

HEADERS = {"X-Forge-Passcode": main._FORGE_PASSCODE}
PREFIX  = "TESTRPT"
created_report_ids = []
created_snapshot_ids = []
created_zone_ids = []

with TestClient(main.app) as client:
    # ── 0. Seed a snapshot with a known, findable signal ────────────────────────
    fake_content = {
        "generated_at": "2026-08-24T00:00:00", "classification": "TEST",
        "statistics": {"total_active_signals": 1},
        "ais_anomalies": [{"signal_id": f"{PREFIX}-SIG-1", "domain": "AIS", "lat": 12.1, "lon": 44.1, "summary": "test signal"}],
        "fusion_events": [], "surge_events": [], "adsb_anomalies": [],
        "sentinel_detections": [], "news_assessments": [], "strategic_zones": [], "top_articles": [],
    }
    with get_db() as db:
        snap = ReportSnapshot(
            snapshot_id=f"{PREFIX}-SNAP-1", label="test snapshot", source="intelligence_picture",
            stats_json=json.dumps(fake_content["statistics"]), content_json=json.dumps(fake_content),
        )
        db.add(snap)
        db.commit()
        created_snapshot_ids.append(snap.snapshot_id)

        # check_geo_sanity checks StrategicZone (via relevance_scorer), not WatchZone
        sz_polygon = {"type": "Polygon", "coordinates": [[[44.0, 12.0], [44.2, 12.0], [44.2, 12.2], [44.0, 12.2], [44.0, 12.0]]]}
        sz = StrategicZone(
            zone_id=f"{PREFIX}-SZONE-1", name=f"{PREFIX} Test Zone", zone_type="CHOKEPOINT_EXTENDED",
            polygon_geojson=json.dumps(sz_polygon),
            bbox_min_lon=44.0, bbox_min_lat=12.0, bbox_max_lon=44.2, bbox_max_lat=12.2, enabled=True,
        )
        db.add(sz)
        db.commit()
        created_zone_ids.append(sz.zone_id)

    # ── 1. Reject: missing title / missing snapshot_id / unknown snapshot ──────
    r = client.post("/api/reports", json={"snapshot_id": f"{PREFIX}-SNAP-1"}, headers=HEADERS)
    check("missing title is rejected (400)", r.status_code == 400, r.text)
    r = client.post("/api/reports", json={"title": "x"}, headers=HEADERS)
    check("missing snapshot_id is rejected (400)", r.status_code == 400, r.text)
    r = client.post("/api/reports", json={"title": "x", "snapshot_id": "SNAP-DOESNOTEXIST"}, headers=HEADERS)
    check("unknown snapshot_id is rejected (404)", r.status_code == 404, r.text)

    # ── 2. Forge-gated ───────────────────────────────────────────────────────────
    r = client.get("/api/reports")
    check("list reports without forge auth is rejected (401)", r.status_code == 401, r.text)

    # ── 3. Create a real draft with a valid citation, an external citation, ────
    #      an UNFINDABLE snapshot_ref (should be caught later by the council),
    #      and a geo-sanity claim (asserted zone genuinely contains the point).
    claims = [
        {"text": "A vessel signal was observed near the strait.",
         "citation": {"type": "snapshot_ref", "section": "ais_anomalies", "item_id": f"{PREFIX}-SIG-1"}},
        {"text": "An external report corroborates this.",
         "citation": {"type": "external", "url": "https://example.org/testrpt"}},
        {"text": "A second, uncorroborated vessel signal was also observed.",
         "citation": {"type": "snapshot_ref", "section": "ais_anomalies", "item_id": f"{PREFIX}-SIG-DOES-NOT-EXIST"}},
        {"text": "The signal falls within the test zone.",
         "citation": {"type": "external", "url": "https://example.org/testrpt-zone"},
         "asserted_zone": f"{PREFIX} Test Zone", "lat": 12.1, "lon": 44.1},
    ]
    r = client.post("/api/reports", json={
        "title": f"{PREFIX} Draft Report", "snapshot_id": f"{PREFIX}-SNAP-1", "claims": claims,
    }, headers=HEADERS)
    check("create report returns 200", r.status_code == 200, r.text)
    report = r.json()
    check("status starts as draft", report.get("status") == "draft", report)
    check("4 claims persisted with generated claim_ids", len(report.get("claims", [])) == 4 and all(c.get("claim_id") for c in report["claims"]), report)
    report_id = report.get("report_id")
    if report_id:
        created_report_ids.append(report_id)

    # ── 4. Claim validation rejects a malformed claim ───────────────────────────
    r = client.post("/api/reports", json={
        "title": "bad", "snapshot_id": f"{PREFIX}-SNAP-1", "claims": [{"text": "no citation here"}],
    }, headers=HEADERS)
    check("claim without citation is rejected (400)", r.status_code == 400, r.text)

    # ── 5. Approve/publish out of order are rejected ────────────────────────────
    r = client.post(f"/api/reports/{report_id}/approve", json={}, headers=HEADERS)
    check("approving a draft report is rejected (409)", r.status_code == 409, r.text)
    r = client.post(f"/api/reports/{report_id}/publish", headers=HEADERS)
    check("publishing a draft report is rejected (409)", r.status_code == 409, r.text)

    # ── 6. Patch while draft works ──────────────────────────────────────────────
    r = client.patch(f"/api/reports/{report_id}", json={"key_judgments": "Test key judgment text."}, headers=HEADERS)
    check("patch draft report returns 200", r.status_code == 200, r.text)
    check("key_judgments persisted", r.json().get("key_judgments") == "Test key judgment text.", r.json())

    # ── 7. Submit for review — stub the Claude client for the model lenses ─────
    class _FakeUsage:
        input_tokens = 10
        output_tokens = 10

    class _FakeMsg:
        def __init__(self, obj):
            self.content = [type("C", (), {"text": json.dumps(obj)})]
            self.usage = _FakeUsage()

    class _FakeMessages:
        def create(self, **kwargs):
            user_text = kwargs["messages"][0]["content"]
            if "verdict" in kwargs["system"] or "overstate" in kwargs["system"]:
                return _FakeMsg([
                    {"claim_id": c["claim_id"], "verdict": "supported", "comment": "fine"} for c in claims_from_report
                ])
            return _FakeMsg({"overall_comment": "Looks reasonable overall.", "per_claim": []})

    class _FakeClient:
        messages = _FakeMessages()

    claims_from_report = report["claims"]
    real_client = main.client
    main.client = _FakeClient()
    try:
        r = client.post(f"/api/reports/{report_id}/submit-for-review", headers=HEADERS)
        check("submit-for-review returns 200", r.status_code == 200, r.text)
        submitted = r.json()
        check("status transitions to in_review", submitted.get("status") == "in_review", submitted)
        findings = submitted.get("council_findings") or {}
        check("council findings has deterministic/citation_fidelity/completeness", set(findings.keys()) == {"deterministic", "citation_fidelity", "completeness"}, findings)

        det = findings["deterministic"]
        valid_claim_id = claims_from_report[0]["claim_id"]
        bad_claim_id = claims_from_report[2]["claim_id"]
        zone_claim_id = claims_from_report[3]["claim_id"]
        valid_check = next((f for f in det if f["claim_id"] == valid_claim_id and f["check"] == "citation_exists"), None)
        bad_check   = next((f for f in det if f["claim_id"] == bad_claim_id and f["check"] == "citation_exists"), None)
        zone_check  = next((f for f in det if f["claim_id"] == zone_claim_id and f["check"] == "geo_sanity"), None)
        check("deterministic pass verifies the real citation as passed", valid_check and valid_check["passed"] is True, valid_check)
        check("deterministic pass catches the unfindable citation as failed", bad_check and bad_check["passed"] is False, bad_check)
        check("deterministic pass confirms real geo-sanity (point genuinely inside asserted zone)", zone_check and zone_check["passed"] is True, zone_check)

        check("citation_fidelity lens ran (stubbed client) with ok status", findings["citation_fidelity"].get("status") == "ok", findings["citation_fidelity"])
        check("completeness lens ran (stubbed client) with ok status", findings["completeness"].get("status") == "ok", findings["completeness"])
    finally:
        main.client = real_client

    # ── 8. Editing after submission is rejected ─────────────────────────────────
    r = client.patch(f"/api/reports/{report_id}", json={"title": "changed"}, headers=HEADERS)
    check("editing an in_review report is rejected (409)", r.status_code == 409, r.text)

    # ── 9. Approve then publish ──────────────────────────────────────────────────
    r = client.post(f"/api/reports/{report_id}/approve", json={"reviewer": "test-reviewer"}, headers=HEADERS)
    check("approve returns 200", r.status_code == 200, r.text)
    check("status is approved", r.json().get("status") == "approved", r.json())

    r = client.post(f"/api/reports/{report_id}/publish", headers=HEADERS)
    check("publish returns 200", r.status_code == 200, r.text)
    check("status is published", r.json().get("status") == "published", r.json())
    check("published_at is set", bool(r.json().get("published_at")), r.json())

    # ── 10. Re-approving a published report is rejected ─────────────────────────
    r = client.post(f"/api/reports/{report_id}/approve", json={}, headers=HEADERS)
    check("re-approving a published report is rejected (409)", r.status_code == 409, r.text)

    # ── 11. PDF export is a real PDF ─────────────────────────────────────────────
    r = client.get(f"/api/reports/{report_id}/pdf", headers=HEADERS)
    check("pdf endpoint returns 200", r.status_code == 200, r.text[:200] if r.status_code != 200 else "")
    check("response is actually a PDF (magic bytes)", r.content[:4] == b"%PDF", r.content[:20])
    check("pdf content-type is application/pdf", r.headers.get("content-type", "").startswith("application/pdf"), r.headers)

    # ── 12. Reject path on a second report ──────────────────────────────────────
    r = client.post("/api/reports", json={
        "title": f"{PREFIX} Reject Me", "snapshot_id": f"{PREFIX}-SNAP-1",
        "claims": [{"text": "placeholder claim", "citation": {"type": "external", "url": "https://example.org/x"}}],
    }, headers=HEADERS)
    reject_report_id = r.json()["report_id"]
    created_report_ids.append(reject_report_id)
    main.client = None  # verify graceful skip path (no client at all) too
    r = client.post(f"/api/reports/{reject_report_id}/submit-for-review", headers=HEADERS)
    check("submit-for-review works even with no Claude client configured", r.status_code == 200, r.text)
    findings2 = r.json().get("council_findings", {})
    check("citation_fidelity lens reports 'skipped' with no client (not faked)", findings2["citation_fidelity"].get("status") == "skipped", findings2["citation_fidelity"])
    check("completeness lens reports 'skipped' with no client (not faked)", findings2["completeness"].get("status") == "skipped", findings2["completeness"])
    main.client = real_client

    r = client.post(f"/api/reports/{reject_report_id}/reject", json={"reviewer": "test-reviewer", "note": "not good enough"}, headers=HEADERS)
    check("reject returns 200", r.status_code == 200, r.text)
    check("status is rejected", r.json().get("status") == "rejected", r.json())
    r = client.post(f"/api/reports/{reject_report_id}/approve", json={}, headers=HEADERS)
    check("approving a rejected report is rejected (409)", r.status_code == 409, r.text)

    # ── 13. List + get ───────────────────────────────────────────────────────────
    r = client.get("/api/reports", params={"status": "published"}, headers=HEADERS)
    check("list filtered by status=published includes our report", any(rp["report_id"] == report_id for rp in r.json()), r.json()[:2])
    r = client.get(f"/api/reports/{report_id}", headers=HEADERS)
    check("get report returns 200", r.status_code == 200, r.text)

    # ── Cleanup ──────────────────────────────────────────────────────────────────
    with get_db() as db:
        db.query(Report).filter(Report.report_id.in_(created_report_ids)).delete(synchronize_session=False)
        db.query(ReportSnapshot).filter(ReportSnapshot.snapshot_id.in_(created_snapshot_ids)).delete(synchronize_session=False)
        db.query(StrategicZone).filter(StrategicZone.zone_id.in_(created_zone_ids)).delete(synchronize_session=False)
        db.commit()

    with get_db() as db:
        check("cleanup removed test reports", db.query(Report).filter(Report.report_id.in_(created_report_ids)).count() == 0)
        check("cleanup removed test snapshot", db.query(ReportSnapshot).filter(ReportSnapshot.snapshot_id.in_(created_snapshot_ids)).count() == 0)
        check("cleanup removed test zone", db.query(StrategicZone).filter(StrategicZone.zone_id.in_(created_zone_ids)).count() == 0)

print("="*70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    sys.exit(1)
else:
    print("  RESULT: ALL CHECKS PASSED")
print("="*70)
