"""
Verification for report_sections.py's real mapping of Report claims +
council findings onto the Restructure 08.26 fixed 10-section layout (+
Annex A), and that GET /api/reports/{id}/sections and GET /api/reports/{id}/pdf
both build from it.

Runs against the REAL backend/data directory (gitignored).

Usage:
    cd backend
    python3 test_report_sections.py
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
print("  Report sections (Restructure 08.26 fixed layout) — verification")
print("="*70)

import main  # noqa: E402
from database import Report, ReportSnapshot, get_db
import report_sections

HEADERS = {}
PREFIX = "TESTRPTSEC"
created_report_ids = []
created_snapshot_ids = []

with TestClient(main.app) as client:
    # ── Seed a snapshot covering every real citable category ───────────────
    fake_content = {
        "generated_at": "2026-08-24T00:00:00", "classification": "TEST",
        "statistics": {"total_active_signals": 2, "alerts_excluded_low_quality": 3},
        "threat_overview": {"elevated_regions": ["Test Region"]},
        "ais_anomalies": [{"signal_id": f"{PREFIX}-AIS-1", "domain": "AIS", "summary": "test AIS"}],
        "adsb_anomalies": [{"signal_id": f"{PREFIX}-ADSB-1", "domain": "ADSB", "summary": "test ADSB"}],
        "fusion_events": [{"fusion_id": f"{PREFIX}-FUS-1", "title": "test fusion"}],
        "surge_events": [{"surge_id": f"{PREFIX}-SURGE-1", "headline": "test surge"}],
        "sentinel_detections": [{"detection_id": f"{PREFIX}-DET-1", "object_type": "vessel"}],
        "news_assessments": [{"assessment_id": f"{PREFIX}-ASSESS-1", "headline": "test assessment"}],
        "strategic_zones": [{"zone_id": f"{PREFIX}-ZONE-1", "name": "test zone"}],
        "top_articles": [{"url": f"https://example.org/{PREFIX}-article", "title": "test article"}],
        "foresight_risks": [{"zone": f"{PREFIX} Foresight Zone", "escalation_probability": 0.6, "situation": "test situation"}],
    }
    with get_db() as db:
        snap = ReportSnapshot(
            snapshot_id=f"{PREFIX}-SNAP-1", label="test snapshot", source="intelligence_picture",
            stats_json=json.dumps(fake_content["statistics"]), content_json=json.dumps(fake_content),
        )
        db.add(snap)
        db.commit()
        created_snapshot_ids.append(snap.snapshot_id)

    # One real, citable claim per section, plus one external (unmapped) claim.
    claims = [
        {"text": "Maritime claim.",  "citation": {"type": "snapshot_ref", "section": "ais_anomalies", "item_id": f"{PREFIX}-AIS-1"}},
        {"text": "Aerial claim.",    "citation": {"type": "snapshot_ref", "section": "adsb_anomalies", "item_id": f"{PREFIX}-ADSB-1"}},
        {"text": "Imagery claim.",  "citation": {"type": "snapshot_ref", "section": "sentinel_detections", "item_id": f"{PREFIX}-DET-1"}},
        {"text": "Fusion alert claim.", "citation": {"type": "snapshot_ref", "section": "fusion_events", "item_id": f"{PREFIX}-FUS-1"}},
        {"text": "Surge alert claim.",  "citation": {"type": "snapshot_ref", "section": "surge_events", "item_id": f"{PREFIX}-SURGE-1"}},
        {"text": "News claim.",     "citation": {"type": "snapshot_ref", "section": "news_assessments", "item_id": f"{PREFIX}-ASSESS-1"}},
        {"text": "Article claim.",  "citation": {"type": "snapshot_ref", "section": "top_articles", "item_id": f"https://example.org/{PREFIX}-article"}},
        {"text": "Zone claim.",     "citation": {"type": "snapshot_ref", "section": "strategic_zones", "item_id": f"{PREFIX}-ZONE-1"}},
        {"text": "Outlook claim.",  "citation": {"type": "snapshot_ref", "section": "foresight_risks", "item_id": f"{PREFIX} Foresight Zone"}},
        {"text": "Unfindable claim (should surface a failing citation_exists finding).",
         "citation": {"type": "snapshot_ref", "section": "ais_anomalies", "item_id": f"{PREFIX}-AIS-DOES-NOT-EXIST"}},
        {"text": "External, unmapped claim — should land in the Annex.",
         "citation": {"type": "external", "url": "https://example.org/unmapped"}},
    ]
    r = client.post("/api/reports", json={
        "title": f"{PREFIX} Report", "snapshot_id": f"{PREFIX}-SNAP-1",
        "key_judgments": "First judgment.\n\nSecond judgment.", "claims": claims,
    }, headers=HEADERS)
    check("create report returns 200", r.status_code == 200, r.text)
    report = r.json()
    report_id = report["report_id"]
    created_report_ids.append(report_id)
    claim_ids = {c["text"]: c["claim_id"] for c in report["claims"]}

    # ── Run the council (real deterministic checks; stubbed model lenses,
    #    same pattern as test_reports.py, so citation_fidelity/completeness
    #    still populate real structured output without a live API call) ─────
    class _FakeUsage:
        input_tokens = 10
        output_tokens = 10

    class _FakeMsg:
        def __init__(self, obj):
            self.content = [type("C", (), {"text": json.dumps(obj)})]
            self.usage = _FakeUsage()

    class _FakeMessages:
        def create(self, **kwargs):
            if "verdict" in kwargs["system"] or "overstate" in kwargs["system"]:
                return _FakeMsg([{"claim_id": cid, "verdict": "supported", "comment": "fine"} for cid in claim_ids.values()])
            return _FakeMsg({"overall_comment": "Overall this report looks reasonable.", "per_claim": []})

    class _FakeClient:
        messages = _FakeMessages()

    real_client = main.client
    main.client = _FakeClient()
    try:
        r = client.post(f"/api/reports/{report_id}/submit-for-review", headers=HEADERS)
        check("submit-for-review returns 200", r.status_code == 200, r.text)
    finally:
        main.client = real_client

    # ── Sections endpoint ────────────────────────────────────────────────────
    r = client.get(f"/api/reports/{report_id}/sections", headers=HEADERS)
    check("sections endpoint returns 200", r.status_code == 200, r.text)
    sections = r.json()
    check("returns exactly 11 sections (10 fixed + Annex)", len(sections) == 11, len(sections))
    check("sections are in fixed order 1..10, A",
          [s["number"] for s in sections] == ["1","2","3","4","5","6","7","8","9","10","A"],
          [s["number"] for s in sections])

    by_id = {s["section_id"]: s for s in sections}

    check("key_judgments section carries the real key_judgments text",
          by_id["key_judgments"].get("key_judgments") == "First judgment.\n\nSecond judgment.",
          by_id["key_judgments"])

    check("maritime_activity has both AIS-cited claims (the real one and the unfindable one — grouping is by citation.section, independent of whether the item_id resolves)",
          set(c["claim_id"] for c in by_id["maritime_activity"]["claims"]) ==
          {claim_ids["Maritime claim."], claim_ids["Unfindable claim (should surface a failing citation_exists finding)."]},
          by_id["maritime_activity"])
    check("aerial_activity has exactly the ADS-B claim",
          [c["claim_id"] for c in by_id["aerial_activity"]["claims"]] == [claim_ids["Aerial claim."]])
    check("imagery_detection has exactly the sentinel claim",
          [c["claim_id"] for c in by_id["imagery_detection"]["claims"]] == [claim_ids["Imagery claim."]])
    check("alerts_events has both the fusion and surge claims (real alert-like categories)",
          set(c["claim_id"] for c in by_id["alerts_events"]["claims"]) == {claim_ids["Fusion alert claim."], claim_ids["Surge alert claim."]})
    check("open_source_context has both the news and article claims",
          set(c["claim_id"] for c in by_id["open_source_context"]["claims"]) == {claim_ids["News claim."], claim_ids["Article claim."]})
    check("area_overview has the strategic-zone claim",
          [c["claim_id"] for c in by_id["area_overview"]["claims"]] == [claim_ids["Zone claim."]])
    check("outlook_watch has the foresight claim (newly-citable section)",
          [c["claim_id"] for c in by_id["outlook_watch"]["claims"]] == [claim_ids["Outlook claim."]])

    check("poi_changes has no claims (no real backing data exists)",
          by_id["poi_changes"]["claims"] == [], by_id["poi_changes"])
    check("poi_changes carries an honest note rather than fabricated content",
          bool(by_id["poi_changes"].get("note")) and "mock" in report_sections._NO_REAL_DATA_NOTES["poi_changes"].lower(),
          by_id["poi_changes"])

    check("collection_gaps surfaces the real completeness overall_comment",
          by_id["collection_gaps"].get("overall_comment") == "Overall this report looks reasonable.",
          by_id["collection_gaps"])
    check("collection_gaps surfaces the real alerts_excluded_low_quality stat",
          by_id["collection_gaps"].get("alerts_excluded_low_quality") == 3,
          by_id["collection_gaps"])

    annex_claim_ids = [c["claim_id"] for c in by_id["annex"]["claims"]]
    check("annex catches the external, unmapped claim (nothing real silently dropped)",
          claim_ids["External, unmapped claim — should land in the Annex."] in annex_claim_ids,
          annex_claim_ids)
    check("annex has real raw counts from the snapshot",
          by_id["annex"].get("raw_counts", {}).get("ais_anomalies") == 1,
          by_id["annex"])

    # The failing citation_exists finding must be attached to the RIGHT claim
    # (still inside maritime_activity, since its citation.section is
    # ais_anomalies even though the item_id doesn't resolve).
    unfindable_id = claim_ids["Unfindable claim (should surface a failing citation_exists finding)."]
    maritime_by_id = {c["claim_id"]: c for c in by_id["maritime_activity"]["claims"]}
    check("the unfindable claim is still grouped into maritime_activity by its citation.section",
          unfindable_id in maritime_by_id, maritime_by_id.keys())
    unfindable_findings = maritime_by_id.get(unfindable_id, {}).get("findings", [])
    check("its failing citation_exists finding is attached, anchored to the right claim",
          any(f.get("kind") == "citation_exists" and f.get("passed") is False for f in unfindable_findings),
          unfindable_findings)

    # ── PDF still renders end to end from the same section mapping ─────────
    r = client.get(f"/api/reports/{report_id}/pdf", headers=HEADERS)
    check("pdf endpoint returns 200 with the new section-based renderer", r.status_code == 200, r.text[:200] if r.status_code != 200 else "")
    check("response is actually a PDF (magic bytes)", r.content[:4] == b"%PDF", r.content[:20])
    check("pdf is substantially larger than a single-section stub (real 10-section content)", len(r.content) > 4000, len(r.content))

    # ── Edge case: a report whose snapshot has since vanished still renders,
    #    honestly, rather than crashing ──────────────────────────────────────
    r = client.post("/api/reports", json={
        "title": f"{PREFIX} Orphan Report", "snapshot_id": f"{PREFIX}-SNAP-1",
        "claims": [{"text": "placeholder", "citation": {"type": "external", "url": "https://example.org/x"}}],
    }, headers=HEADERS)
    orphan_id = r.json()["report_id"]
    created_report_ids.append(orphan_id)
    with get_db() as db:
        db.query(ReportSnapshot).filter(ReportSnapshot.snapshot_id == f"{PREFIX}-SNAP-1").delete()
        db.commit()
    r = client.get(f"/api/reports/{orphan_id}/sections", headers=HEADERS)
    check("sections endpoint doesn't crash when the snapshot has been deleted", r.status_code == 200, r.text)
    r = client.get(f"/api/reports/{orphan_id}/pdf", headers=HEADERS)
    check("pdf endpoint doesn't crash when the snapshot has been deleted", r.status_code == 200, r.text[:200] if r.status_code != 200 else "")

    # ── Cleanup ──────────────────────────────────────────────────────────────
    with get_db() as db:
        db.query(Report).filter(Report.report_id.in_(created_report_ids)).delete(synchronize_session=False)
        db.query(ReportSnapshot).filter(ReportSnapshot.snapshot_id.in_(created_snapshot_ids)).delete(synchronize_session=False)
        db.commit()

    with get_db() as db:
        check("cleanup removed test reports", db.query(Report).filter(Report.report_id.in_(created_report_ids)).count() == 0)
        check("cleanup removed test snapshot", db.query(ReportSnapshot).filter(ReportSnapshot.snapshot_id.in_(created_snapshot_ids)).count() == 0)

print("="*70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    sys.exit(1)
else:
    print("  RESULT: ALL CHECKS PASSED")
print("="*70)
