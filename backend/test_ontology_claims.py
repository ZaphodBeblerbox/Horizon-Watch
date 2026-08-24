"""
Verification script for the entity-relationship claims review pipeline
(OntologyClaim model + /api/forge/ontology/claims* endpoints + the
_process_document_upload relationship-extraction path).

Runs against the REAL backend/data directory (gitignored — akili.db and
forge/ are both excluded from git) so this exercises exactly what the app
will do in normal operation, including the FastAPI startup migration that
creates the new ontology_claims table.

Usage:
    cd backend
    python3 test_ontology_claims.py
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
print("  Ontology claims pipeline — verification")
print("="*70)

import main  # noqa: E402

HEADERS = {"X-Forge-Passcode": main._FORGE_PASSCODE}

with TestClient(main.app) as client:
    # ── 1. Bulk-create claims: one well-formed + cited, one missing evidence ──
    bulk_payload = {
        "claims": [
            {
                "entity_a": "TEST — IRGC-Quds Force", "entity_a_type": "organization",
                "relationship_type": "commands",
                "entity_b": "TEST — Hezbollah", "entity_b_type": "group",
                "as_of": "Aug 2026", "confidence": "direct",
                "source_title": "Treasury press release sb0611",
                "source_publisher": "U.S. Department of the Treasury",
                "source_date": "2026-08-20",
                "source_url": "https://home.treasury.gov/news/press-releases/sb0611",
                "evidence": "Hezbollah is 'owned, controlled, or directed by' the IRGC-Qods Force.",
            },
            {
                # Missing "evidence" entirely — must be refused, not stored half-formed.
                "entity_a": "TEST — Uncited Actor", "entity_a_type": "organization",
                "relationship_type": "allied_with",
                "entity_b": "TEST — Uncited Partner", "entity_b_type": "organization",
                "confidence": "direct",
            },
        ]
    }
    r = client.post("/api/forge/ontology/claims/bulk", json=bulk_payload, headers=HEADERS)
    check("bulk endpoint returns 200", r.status_code == 200, r.text)
    body = r.json()
    check("exactly 1 claim created (cited one)", body.get("created") == 1, body)
    check("exactly 1 claim skipped (uncited one)", body.get("skipped_uncited") == 1, body)

    # ── 2. List pending claims, find ours ──────────────────────────────────────
    r = client.get("/api/forge/ontology/claims", params={"status": "pending"}, headers=HEADERS)
    check("list pending returns 200", r.status_code == 200, r.text)
    pending = r.json()
    mine = [c for c in pending if c["entity_a"]["label"] == "TEST — IRGC-Quds Force"]
    check("our claim appears in pending list", len(mine) == 1, pending[:2])
    claim = mine[0] if mine else None
    if claim:
        check("citation title carried through", claim["source"]["title"] == "Treasury press release sb0611", claim)
        check("evidence excerpt carried through", "owned, controlled, or directed" in (claim["source"]["excerpt"] or ""), claim)
        check("confidence is the string 'direct', not a fabricated number",
              claim["confidence"] == "direct", claim)

    # ── 3. Approve it — should create nodes + a cited edge, never before this ──
    if claim:
        r = client.post(f"/api/forge/ontology/claims/{claim['claim_id']}/approve",
                         json={"reviewer": "verification-script"}, headers=HEADERS)
        check("approve returns 200", r.status_code == 200, r.text)
        edge = r.json().get("edge", {})
        check("edge type matches relationship_type", edge.get("type") == "commands", edge)
        check("edge carries the citation", edge.get("citation", {}).get("url", "").startswith("https://home.treasury.gov"), edge)
        check("edge carries confidence as a string, not a number", edge.get("confidence") == "direct", edge)

        # Ontology file should now actually contain the nodes + edge
        ontology = main._forge_ontology_load()
        node_labels = {n["label"] for n in ontology["nodes"]}
        check("entity_a node present in forge_ontology.json", "TEST — IRGC-Quds Force" in node_labels)
        check("entity_b node present in forge_ontology.json", "TEST — Hezbollah" in node_labels)
        edge_ids = {e.get("id") for e in ontology["edges"]}
        check("approved edge persisted to forge_ontology.json", edge.get("id") in edge_ids)

        # Re-approving should now fail (already approved)
        r2 = client.post(f"/api/forge/ontology/claims/{claim['claim_id']}/approve", json={}, headers=HEADERS)
        check("double-approve is rejected (409)", r2.status_code == 409, r2.text)

    # ── 4. Reject path ──────────────────────────────────────────────────────────
    bulk2 = {"claims": [{
        "entity_a": "TEST — Reject Me A", "entity_a_type": "organization",
        "relationship_type": "adversarial_to",
        "entity_b": "TEST — Reject Me B", "entity_b_type": "organization",
        "confidence": "inferred", "evidence": "placeholder evidence text for the reject-path test.",
    }]}
    r = client.post("/api/forge/ontology/claims/bulk", json=bulk2, headers=HEADERS)
    check("second bulk create OK", r.json().get("created") == 1, r.text)
    r = client.get("/api/forge/ontology/claims", params={"status": "pending"}, headers=HEADERS)
    reject_candidates = [c for c in r.json() if c["entity_a"]["label"] == "TEST — Reject Me A"]
    check("reject-test claim is pending", len(reject_candidates) == 1)
    if reject_candidates:
        cid = reject_candidates[0]["claim_id"]
        r = client.post(f"/api/forge/ontology/claims/{cid}/reject",
                         json={"reviewer": "verification-script", "note": "test rejection"}, headers=HEADERS)
        check("reject returns 200", r.status_code == 200, r.text)
        check("status is 'rejected'", r.json().get("status") == "rejected", r.json())
        ontology = main._forge_ontology_load()
        labels = {n["label"] for n in ontology["nodes"]}
        check("rejected claim's entities were NOT added to the ontology",
              "TEST — Reject Me A" not in labels and "TEST — Reject Me B" not in labels)

    # ── 5. Document-upload extraction path, with a stubbed Anthropic client ─────
    class _FakeMsg:
        def __init__(self, text): self.content = [type("C", (), {"text": text})]

    class _FakeMessages:
        def create(self, **kwargs):
            return _FakeMsg('''{
                "entities": [{"name": "TEST — Stub Port", "type": "port", "description": "A test port."}],
                "relationships": [{
                    "entity_a": "TEST — Stub State", "entity_a_type": "country",
                    "relationship_type": "operates",
                    "entity_b": "TEST — Stub Port", "entity_b_type": "port",
                    "as_of": "2026", "confidence": "direct",
                    "evidence": "The stub document states State operates the Port directly."
                }]
            }''')

    class _FakeClient:
        messages = _FakeMessages()

    real_client = main.client
    main.client = _FakeClient()
    try:
        import tempfile
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as tf:
            tf.write("Stub document text for extraction test.")
            tmp_path = tf.name
        import asyncio as _aio
        result = _aio.run(main._process_document_upload(
            tmp_path, "Stub description",
            source_title="Stub Source Title", source_publisher="Stub Publisher",
            source_date="2026-08-24", source_url="https://example.org/stub",
            upload_id="upload_test_stub",
        ))
        check("document-upload processed status", result.get("status") == "processed", result)
        check("1 entity extracted", result.get("entities_extracted") == 1, result)
        check("1 relationship claim created", result.get("relationships_extracted") == 1, result)

        r = client.get("/api/forge/ontology/claims", params={"status": "pending"}, headers=HEADERS)
        doc_claims = [c for c in r.json() if c["entity_a"]["label"] == "TEST — Stub State"]
        check("document-upload claim landed in pending queue (not auto-merged)", len(doc_claims) == 1, r.json()[:2])
        if doc_claims:
            check("document-upload claim carries the upload's citation",
                  doc_claims[0]["source"]["title"] == "Stub Source Title", doc_claims[0])
            check("document-upload claim tagged with its upload_id",
                  doc_claims[0]["upload_id"] == "upload_test_stub", doc_claims[0])
    finally:
        main.client = real_client
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

# ── Cleanup: this script runs against the real backend/data DB (see module
# docstring), and every claim it creates carries the "TEST — " prefix. Without
# removing them, a rerun's bulk-create calls hit the pipeline's own duplicate
# check against these leftover rows and report false "skipped_duplicate"
# failures — exactly what happened the first time this suite was run twice
# against the same DB. Delete them so the suite is repeatable.
from database import get_db as _cleanup_get_db, OntologyClaim as _CleanupClaim  # noqa: E402

with _cleanup_get_db() as _cdb:
    _leftover = _cdb.query(_CleanupClaim).filter(
        (_CleanupClaim.entity_a_label.like("TEST —%")) |
        (_CleanupClaim.entity_b_label.like("TEST —%"))
    ).all()
    for _c in _leftover:
        _cdb.delete(_c)
    _cdb.commit()
    _remaining = _cdb.query(_CleanupClaim).filter(
        (_CleanupClaim.entity_a_label.like("TEST —%")) |
        (_CleanupClaim.entity_b_label.like("TEST —%"))
    ).count()
    check("cleanup removed all TEST-prefixed ontology claims", _remaining == 0,
          f"{_remaining} left over")

print("="*70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    sys.exit(1)
else:
    print("  RESULT: ALL CHECKS PASSED")
print("="*70)
