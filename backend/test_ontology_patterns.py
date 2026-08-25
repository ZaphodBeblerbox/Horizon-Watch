"""
Verification script for Stage 2 of the convergence engine: graph pattern
discovery over approved, cited relationship claims
(_find_graph_patterns / GET+POST /api/forge/ontology/patterns*).

Runs against the REAL backend/data directory (gitignored) so it exercises
exactly what the app does in normal operation. Seeds a small synthetic
approved-claim graph (there are zero real approved claims yet — the 42
pilot claims are still pending review), verifies pattern discovery finds
the expected 2-hop chain and correctly excludes pairs that are already
directly linked, verifies star/dismiss persistence, then cleans up every
TEST-prefixed node/edge/claim/pattern-review it created.

Usage:
    cd backend
    python3 test_ontology_patterns.py
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
print("  Ontology pattern discovery — verification")
print("="*70)

import main  # noqa: E402
from database import get_db, User  # noqa: E402
from app_shared import make_jwt  # noqa: E402

# Forge is admin-gated (require_admin_user), not passcode-gated — create a
# real admin test user and mint a real JWT for it, same as any other admin.
_ADMIN_ID = "TESTPAT-ADMIN"
with get_db() as _db:
    _db.merge(User(id=_ADMIN_ID, email="testpat-admin@test.local", password_hash="test",
                    role="admin", approved=True))
    _db.commit()
HEADERS = {"Authorization": f"Bearer {make_jwt(_ADMIN_ID)}"}
PREFIX  = "TESTPAT — "

created_claim_ids  = []
created_pattern_ids = []

with TestClient(main.app) as client:
    def submit_and_approve(a, a_type, rel, b, b_type, evidence, as_of="2026"):
        payload = {"claims": [{
            "entity_a": PREFIX + a, "entity_a_type": a_type,
            "relationship_type": rel,
            "entity_b": PREFIX + b, "entity_b_type": b_type,
            "as_of": as_of, "confidence": "direct",
            "source_title": f"Test source for {rel}", "source_publisher": "Test Publisher",
            "source_date": "2026-08-24", "source_url": "https://example.org/testpat",
            "evidence": evidence,
        }]}
        r = client.post("/api/forge/ontology/claims/bulk", json=payload, headers=HEADERS)
        assert r.json().get("created") == 1, r.text
        pending = client.get("/api/forge/ontology/claims", params={"status": "pending"}, headers=HEADERS).json()
        row = next(c for c in pending if c["entity_a"]["label"] == PREFIX + a and c["entity_b"]["label"] == PREFIX + b)
        created_claim_ids.append(row["claim_id"])
        ar = client.post(f"/api/forge/ontology/claims/{row['claim_id']}/approve",
                          json={"reviewer": "pattern-test"}, headers=HEADERS)
        assert ar.status_code == 200, ar.text
        return ar.json()["edge"]

    # ── Seed: A —commands→ Hub —funds→ C.  No direct A–C edge → should surface. ──
    edge1 = submit_and_approve("Alpha Org", "organization", "commands", "Hub Group", "group",
                                "Alpha Org commands Hub Group per the test source.")
    edge2 = submit_and_approve("Hub Group", "group", "funds", "Charlie Militia", "group",
                                "Hub Group funds Charlie Militia per the test source.")

    # ── Seed a second hub-pair that DOES already have a direct edge → must be excluded. ──
    edge3 = submit_and_approve("Delta State", "country", "arms", "Hub Group", "group",
                                "Delta State arms Hub Group per the test source.")
    edge4 = submit_and_approve("Delta State", "country", "allied_with", "Alpha Org", "organization",
                                "Delta State is allied with Alpha Org per the test source.")
    # Delta State is now linked to both Hub Group (edge3) and Alpha Org (edge4) directly,
    # so Delta<->Alpha and Delta<->Hub should NOT show up as a "hidden" pattern via Hub.

    r = client.get("/api/forge/ontology/patterns", params={"include_dismissed": "true"}, headers=HEADERS)
    check("patterns endpoint returns 200", r.status_code == 200, r.text)
    patterns = r.json().get("patterns", [])

    def find_pattern(label_a, label_c):
        for p in patterns:
            labels = {p["nodes"][0]["label"], p["nodes"][2]["label"]}
            if labels == {PREFIX + label_a, PREFIX + label_c} and p["nodes"][1]["label"] == PREFIX + "Hub Group":
                return p
        return None

    target = find_pattern("Alpha Org", "Charlie Militia")
    check("discovers the Alpha–Hub–Charlie 2-hop pattern", target is not None, [p["nodes"] for p in patterns])
    if target:
        created_pattern_ids.append(target["pattern_id"])
        check("pattern has exactly 2 hops", len(target["hops"]) == 2, target)
        rel_types = {h["relationship_type"] for h in target["hops"]}
        check("hop relationship types are commands+funds", rel_types == {"commands", "funds"}, target)
        check("each hop carries its own citation", all(h.get("citation", {}).get("url") for h in target["hops"]), target)
        check("pattern starts unstarred/undismissed", target["starred"] is False and target["dismissed"] is False, target)

    excluded = find_pattern("Delta State", "Alpha Org")
    check("does NOT surface Delta–Hub–Alpha (already directly linked)", excluded is None, excluded)

    # ── Star it, verify persistence across reload ───────────────────────────────
    if target:
        pid = target["pattern_id"]
        rr = client.post(f"/api/forge/ontology/patterns/{pid}/review", json={"starred": True}, headers=HEADERS)
        check("star review returns 200", rr.status_code == 200, rr.text)
        check("response reflects starred=True", rr.json().get("starred") is True, rr.json())

        r2 = client.get("/api/forge/ontology/patterns", params={"include_dismissed": "true"}, headers=HEADERS)
        p2 = next(p for p in r2.json()["patterns"] if p["pattern_id"] == pid)
        check("starred state persists across reload", p2["starred"] is True, p2)
        check("starred pattern sorts first", r2.json()["patterns"][0]["pattern_id"] == pid, r2.json()["patterns"][:2])

        # ── Dismiss it, verify default listing hides it, include_dismissed shows it ──
        rr2 = client.post(f"/api/forge/ontology/patterns/{pid}/review", json={"dismissed": True}, headers=HEADERS)
        check("dismiss review returns 200", rr2.status_code == 200, rr2.text)

        r3 = client.get("/api/forge/ontology/patterns", headers=HEADERS)  # default include_dismissed=False
        check("dismissed pattern excluded by default", all(p["pattern_id"] != pid for p in r3.json()["patterns"]))

        r4 = client.get("/api/forge/ontology/patterns", params={"include_dismissed": "true"}, headers=HEADERS)
        p4 = next((p for p in r4.json()["patterns"] if p["pattern_id"] == pid), None)
        check("dismissed pattern still present with include_dismissed=true", p4 is not None)
        check("still shows starred=True alongside dismissed=True", p4 and p4["starred"] is True, p4)

    # ── Cleanup: remove everything TESTPAT-prefixed from the real data files ────
    ontology = main._forge_ontology_load()
    ontology["nodes"] = [n for n in ontology["nodes"] if not n["label"].startswith(PREFIX)]
    ontology["edges"] = [e for e in ontology["edges"] if e.get("claim_id") not in created_claim_ids]
    main._forge_ontology_save(ontology)

    reviews = main._forge_load("pattern_reviews.json")
    reviews = [r for r in reviews if r.get("pattern_id") not in created_pattern_ids]
    main._forge_save("pattern_reviews.json", reviews)

    from database import OntologyClaim, get_db as _gdb_cleanup
    with _gdb_cleanup() as db:
        db.query(OntologyClaim).filter(OntologyClaim.claim_id.in_(created_claim_ids)).delete(synchronize_session=False)
        db.commit()

    ontology_after = main._forge_ontology_load()
    check("cleanup removed all TESTPAT nodes", not any(n["label"].startswith(PREFIX) for n in ontology_after["nodes"]))
    check("cleanup removed all TESTPAT edges", not any(e.get("claim_id") in created_claim_ids for e in ontology_after["edges"]))

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
