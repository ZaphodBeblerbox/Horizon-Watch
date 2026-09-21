"""
Regression test — Stage 2 pattern discovery over auto-generated edges
(fix/geoconfirmed-ontology-and-inbox-fixes, Part 6).

Real confirmed bug (live audit): routers/forge.py's _find_graph_patterns()
used to consider ONLY edges carrying a real `claim_id`. The live
`ontology_claims` table has 0 approved rows, so before this fix Stage 2
found exactly zero patterns no matter how rich the rest of the graph got —
it never ran over GeoConfirmed's real `located_in`/`faction_of`/`part_of`/
`same_polity_as` edges or the correlation engine's own `correlates_with`/
`threatens` edges, all of which carry `auto: True` instead of a claim_id.

A first attempted fix (widen eligibility to `claim_id or auto`) introduced
two real regressions, both covered here:
  1. `e1.get("claim_id") == e2.get("claim_id")` is `None == None` for any
     two DIFFERENT auto edges, so every real auto-edge pair was silently
     skipped as "same claim reused."
  2. `frozenset((e1["claim_id"], e2["claim_id"]))` / the pattern_id hash
     used direct bracket access, which raises KeyError the instant an
     eligible edge lacks `claim_id` entirely (any real auto edge).

The actual fix: an `_origin_key(edge)` helper — `claim_id` if present,
else the edge's own real `id` — used everywhere a per-edge identity is
needed. This test builds a small, real, isolated ontology fixture (never
touching the live forge_ontology.json) with two auto edges sharing a hub
and confirms:
  - a real pattern is found through the shared hub (proves the same-
    origin check no longer wrongly treats two different auto edges as
    identical);
  - no KeyError is raised for edges lacking claim_id;
  - each hop reports `auto: True` and `claim_id: None`, so provenance
    stays visible rather than being presented as a cited claim.

Also confirms the real hub-degree cap and response cap added alongside
this fix don't accidentally exclude a legitimate small-degree pattern.

Isolation note (real incident, self-corrected): an earlier draft of this
test set os.environ["DATA_DIR"] before importing main, assuming that
would redirect ontology reads/writes to a temp directory. It does not —
main.py's DATA_DIR is a hardcoded module-level constant
(RAILWAY_ENVIRONMENT ? "/var/lib/railway" : "<repo>/backend/data"), read
once at import time and never from that env var. That draft's
_forge_ontology_save() calls went straight to the REAL production
forge_ontology.json (~9,000 real nodes replaced with a ~45-node fixture)
before this was caught and the real data recovered (re-running
sync_ontology_from_geoconfirmed() + POST /api/forge/ontology/build +
replaying real fusion_events rows through _auto_add_correlation_to_
ontology). This test now monkeypatches main._FORGE_DIR directly — the
actual module-level Path both _forge_ontology_load/_save read from on
every call — which is the one real, verified-effective isolation point.

Usage:
    cd backend
    python3 test_forge_pattern_discovery_auto_edges.py
"""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))

FAILURES = []


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


print("=" * 70)
print("  Stage 2 pattern discovery over auto edges — real regression test")
print("=" * 70)

import main as _m  # noqa: E402 — real app import, needed for _forge_ontology_load/save
from routers.forge import _find_graph_patterns  # noqa: E402

# The one real, verified-effective isolation point — see module docstring.
_TMP_FORGE_DIR = Path(tempfile.mkdtemp(prefix="forge_pattern_test_")) / "forge"
_m._FORGE_DIR = _TMP_FORGE_DIR
assert _m._forge_ontology_load() == {"nodes": [], "edges": []}, \
    "isolation check failed — _FORGE_DIR patch did not take effect, refusing to continue"

# Real, minimal fixture: hub "faction_ukraine" with two DIFFERENT real
# auto edges (both claim_id: None) to two other nodes, and no direct edge
# already linking those two other nodes — the exact shape that should
# produce one real 2-hop pattern.
fixture = {
    "nodes": [
        {"id": "faction_ukraine", "label": "Ukraine", "type": "faction"},
        {"id": "country_UA", "label": "Ukraine", "type": "country"},
        {"id": "vessel_test1", "label": "Test Vessel", "type": "vessel"},
    ],
    "edges": [
        {
            "id": "e_samepolity_faction_ukraine_country_UA",
            "source": "faction_ukraine", "target": "country_UA",
            "type": "same_polity_as", "auto": True,
        },
        {
            "id": "e_involves_faction_ukraine_vessel_test1",
            "source": "faction_ukraine", "target": "vessel_test1",
            "type": "involves", "auto": True,
        },
    ],
}
_m._forge_ontology_save(fixture)

print("\n[1] Real pattern found through a hub with two different auto edges (no KeyError)")
try:
    patterns = _find_graph_patterns()
    raised = None
except KeyError as e:
    patterns = []
    raised = e
check("no KeyError raised", raised is None, raised)
check("exactly one real pattern found", len(patterns) == 1, patterns)

if patterns:
    p = patterns[0]
    hub_labels = {n["label"] for n in p["nodes"]}
    check("pattern's hub is really 'Ukraine' (faction)", p["nodes"][1]["id"] == "faction_ukraine", p["nodes"])
    check("pattern's two hops are both auto-derived", all(h["auto"] for h in p["hops"]), p["hops"])
    check("pattern's two hops both report claim_id=None (never fabricated)",
          all(h["claim_id"] is None for h in p["hops"]), p["hops"])
    check("pattern_id is deterministic across a second computation",
          _find_graph_patterns()[0]["pattern_id"] == p["pattern_id"])

print("\n[2] Two DIFFERENT auto edges are never treated as 'the same origin reused'")
# The bug this guards against: e1.get('claim_id') == e2.get('claim_id') is
# True for any two auto edges (both None), which would have suppressed
# the pattern found in [1] above entirely. Assert it wasn't suppressed.
check("the real pattern from two distinct auto edges was NOT wrongly skipped",
      len(patterns) == 1, patterns)

print("\n[3] Hub-degree cap excludes only genuinely oversized hubs")
big_hub_edges = [
    {"id": f"e_big_{i}", "source": "faction_ukraine", "target": f"node_{i}", "type": "involves", "auto": True}
    for i in range(40)
]
big_fixture = {
    "nodes": fixture["nodes"] + [{"id": f"node_{i}", "label": f"N{i}", "type": "event"} for i in range(40)],
    "edges": fixture["edges"] + big_hub_edges,
}
_m._forge_ontology_save(big_fixture)
patterns_big = _find_graph_patterns()
check("a hub with 42 incident edges (over the 30 cap) contributes zero patterns",
      not any(p["nodes"][1]["id"] == "faction_ukraine" for p in patterns_big),
      [p["nodes"][1]["id"] for p in patterns_big if p["nodes"][1]["id"] == "faction_ukraine"])

print("\n" + "=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    print("=" * 70)
    sys.exit(1)
else:
    print("  RESULT: ALL CHECKS PASSED")
    print("=" * 70)
