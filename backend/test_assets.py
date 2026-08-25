"""
Verification script for roadmap Phase 2: the Asset registry
(civilian/military/dual-use categorization + ownership) and the
OntologyClaim validity-window fields (valid_from/valid_until).

Runs against the REAL backend/data directory (gitignored).

Usage:
    cd backend
    python3 test_assets.py
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
print("  Asset registry + claim validity windows — verification")
print("="*70)

import main  # noqa: E402
from database import Asset, OntologyClaim, get_db

# Auth has been removed — every endpoint is open, no token needed.
HEADERS = {}
PREFIX  = "TESTAST"
created_asset_ids = []
created_claim_ids = []

with TestClient(main.app) as client:
    # ── 1. Reject: missing category ─────────────────────────────────────────────
    r = client.post("/api/forge/assets", json={
        "name": f"{PREFIX} Port", "asset_type": "port",
        "source_title": "Test source", "source_excerpt": "quote",
    }, headers=HEADERS)
    check("missing/invalid category is rejected (400)", r.status_code == 400, r.text)

    # ── 2. Reject: missing citation ──────────────────────────────────────────────
    r = client.post("/api/forge/assets", json={
        "name": f"{PREFIX} Port", "asset_type": "port", "category": "dual_use",
    }, headers=HEADERS)
    check("missing citation is rejected (400)", r.status_code == 400, r.text)

    # ── 4. Create a real, well-cited asset ──────────────────────────────────────
    r = client.post("/api/forge/assets", json={
        "name": f"{PREFIX} Doraleh Container Terminal", "asset_type": "port", "category": "dual_use",
        "owner": "Government of Djibouti", "operator": "Djibouti Ports and Free Zones Authority",
        "country": "Djibouti", "lat": 11.63, "lng": 43.08,
        "region_tag": "red_sea_bab_el_mandeb", "confidence": "direct",
        "source_title": "Test citation for Doraleh", "source_publisher": "Test Publisher",
        "source_date": "2026-01-01", "source_url": "https://example.org/testast-doraleh",
        "source_excerpt": "Djibouti nationalized the terminal in 2018.",
    }, headers=HEADERS)
    check("create asset returns 200", r.status_code == 200, r.text)
    created = r.json()
    check("response has an asset_id", bool(created.get("asset_id")), created)
    check("category persisted correctly", created.get("category") == "dual_use", created)
    check("source citation persisted", created.get("source", {}).get("url", "").startswith("https://example.org"), created)
    asset_id = created.get("asset_id")
    if asset_id:
        created_asset_ids.append(asset_id)

    # ── 5. Reject invalid category on the same request pattern, then list/filter ──
    r = client.get("/api/forge/assets", params={"region_tag": "red_sea_bab_el_mandeb"}, headers=HEADERS)
    check("list by region_tag returns 200", r.status_code == 200, r.text)
    mine = [a for a in r.json() if a["asset_id"] == asset_id]
    check("our asset appears in the region-filtered list", len(mine) == 1, r.json()[:2])

    r = client.get("/api/forge/assets", params={"category": "military"}, headers=HEADERS)
    check("category filter excludes our dual_use asset", all(a["asset_id"] != asset_id for a in r.json()), r.json())

    # ── 6. Get by id ──────────────────────────────────────────────────────────────
    r = client.get(f"/api/forge/assets/{asset_id}", headers=HEADERS)
    check("get asset returns 200", r.status_code == 200, r.text)
    check("get asset returns correct owner", r.json().get("owner") == "Government of Djibouti", r.json())

    # ── 7. Patch: correct the category, verify citation can't be patched away ──────
    r = client.patch(f"/api/forge/assets/{asset_id}", json={"category": "military"}, headers=HEADERS)
    check("patch category returns 200", r.status_code == 200, r.text)
    check("patched category persisted", r.json().get("category") == "military", r.json())

    r = client.patch(f"/api/forge/assets/{asset_id}", json={"source_title": "", "source_url": ""}, headers=HEADERS)
    check("patching away the only citation is rejected (400)", r.status_code == 400, r.text)

    r = client.patch(f"/api/forge/assets/{asset_id}", json={"category": "not_a_real_category"}, headers=HEADERS)
    check("patch with invalid category is rejected (400)", r.status_code == 400, r.text)

    # ── 8. Delete ─────────────────────────────────────────────────────────────────
    r = client.delete(f"/api/forge/assets/{asset_id}", headers=HEADERS)
    check("delete asset returns 200", r.status_code == 200, r.text)
    r = client.get(f"/api/forge/assets/{asset_id}", headers=HEADERS)
    check("deleted asset now 404s", r.status_code == 404, r.text)
    created_asset_ids.remove(asset_id)  # already gone, don't double-delete in cleanup

    # ── 9. Claim validity window fields (valid_from / valid_until) ─────────────────
    bulk_payload = {"claims": [{
        "entity_a": f"{PREFIX} — Actor A", "entity_a_type": "organization",
        "relationship_type": "allied_with",
        "entity_b": f"{PREFIX} — Actor B", "entity_b_type": "organization",
        "as_of": "2020-2024", "confidence": "direct",
        "valid_from": "2020-01-01T00:00:00", "valid_until": "2024-06-30T00:00:00",
        "source_title": "Test alliance source", "source_url": "https://example.org/testast-alliance",
        "evidence": "The alliance was announced in 2020 and formally ended mid-2024.",
    }]}
    r = client.post("/api/forge/ontology/claims/bulk", json=bulk_payload, headers=HEADERS)
    check("bulk claim with validity window created", r.json().get("created") == 1, r.text)

    r = client.get("/api/forge/ontology/claims", params={"status": "pending"}, headers=HEADERS)
    mine = [c for c in r.json() if c["entity_a"]["label"] == f"{PREFIX} — Actor A"]
    check("claim appears in pending list", len(mine) == 1, r.json()[:2])
    claim = mine[0] if mine else None
    if claim:
        created_claim_ids.append(claim["claim_id"])
        check("valid_from carried through to the API response", claim.get("valid_from", "").startswith("2020-01-01"), claim)
        check("valid_until carried through to the API response", claim.get("valid_until", "").startswith("2024-06-30"), claim)

        r = client.post(f"/api/forge/ontology/claims/{claim['claim_id']}/approve", json={}, headers=HEADERS)
        check("approve returns 200", r.status_code == 200, r.text)
        edge = r.json().get("edge", {})
        check("approved edge carries valid_from", edge.get("valid_from", "").startswith("2020-01-01"), edge)
        check("approved edge carries valid_until", edge.get("valid_until", "").startswith("2024-06-30"), edge)

    # ── Cleanup ──────────────────────────────────────────────────────────────────
    with get_db() as db:
        db.query(Asset).filter(Asset.asset_id.in_(created_asset_ids)).delete(synchronize_session=False)
        db.query(OntologyClaim).filter(OntologyClaim.claim_id.in_(created_claim_ids)).delete(synchronize_session=False)
        db.commit()

    ontology = main._forge_ontology_load()
    before_n = len(ontology["nodes"])
    ontology["nodes"] = [n for n in ontology["nodes"] if not n["label"].startswith(PREFIX)]
    kept_ids = {n["id"] for n in ontology["nodes"]}
    ontology["edges"] = [e for e in ontology["edges"] if e.get("source") in kept_ids and e.get("target") in kept_ids]
    main._forge_ontology_save(ontology)
    check("cleanup removed TESTAST ontology nodes", len(ontology["nodes"]) < before_n or before_n == 0)

    with get_db() as db:
        remaining = db.query(Asset).filter(Asset.asset_id.in_(created_asset_ids)).count()
        remaining_claims = db.query(OntologyClaim).filter(OntologyClaim.claim_id.in_(created_claim_ids)).count()
        check("cleanup removed test asset rows", remaining == 0)
        check("cleanup removed test claim rows", remaining_claims == 0)

print("="*70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    sys.exit(1)
else:
    print("  RESULT: ALL CHECKS PASSED")
print("="*70)
