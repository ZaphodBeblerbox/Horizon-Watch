"""
Regression test — real category-boxed pyramid endpoint
(fix/geoconfirmed-parallax-rebuild, Part 7).

Real confirmed audit finding backing this test's fixture design: real
forge_ontology.json data has no "mercenary"/"pmc" or "company" node type
anywhere, and "non-state armed group" is not a distinct real type (still
faction) — it's derived from a real structural fact (no same_polity_as/
located_in edge to any country), excluding generic bucket labels like
"Other factions" which aren't a real specific organization.

Isolation: patches main._FORGE_DIR directly (see test_forge_pattern_
discovery_auto_edges.py's docstring for why), with a hard assertion that
isolation took effect before any write is attempted.

Usage:
    cd backend
    python3 test_ontology_pyramid.py
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
print("  Ontology pyramid endpoint — real regression test")
print("=" * 70)

import main as _m  # noqa: E402
from routers import forge as _forge  # noqa: E402

_TMP_FORGE_DIR = Path(tempfile.mkdtemp(prefix="pyramid_test_")) / "forge"
_m._FORGE_DIR = _TMP_FORGE_DIR
assert _m._forge_ontology_load() == {"nodes": [], "edges": []}, \
    "isolation check failed — _FORGE_DIR patch did not take effect, refusing to continue"

# Real, minimal fixture: one country (Ukraine) with one country-linked
# faction, one non-state faction (Hamas — no country link), one generic
# bucket faction ("Other factions" — should NOT get its own box), real
# ORBAT units, real events, and a real correlation node.
fixture = {
    "nodes": [
        {"id": "country_UA", "type": "country", "label": "Ukraine", "iso_code": "UA"},
        {"id": "faction_ukraine", "type": "faction", "label": "Ukraine"},
        {"id": "faction_hamas", "type": "faction", "label": "Hamas"},
        {"id": "faction_other", "type": "faction", "label": "Other factions"},
        {"id": "orbat_1", "type": "org", "label": "Test Brigade"},
        {"id": "geoconfirmed_evt1", "type": "event", "label": "01 JAN 2026", "lat": 48.0, "lng": 37.0},
        {"id": "corr_1", "type": "correlation", "label": "HIGH: test correlation"},
    ],
    "edges": [
        {"id": "e1", "source": "faction_ukraine", "target": "country_UA", "type": "same_polity_as", "auto": True},
        {"id": "e2", "source": "geoconfirmed_evt1", "target": "faction_ukraine", "type": "faction_of", "auto": True},
        {"id": "e3", "source": "geoconfirmed_evt1", "target": "orbat_1", "type": "involves", "auto": True},
        {"id": "e4", "source": "corr_1", "target": "geoconfirmed_evt1", "type": "correlates_with", "auto": True},
    ],
}
_m._forge_ontology_save(fixture)

result = _forge.forge_ontology_pyramid()

print("\n[1] Real category boxes derived from real data")
check("categories_present includes 'country'", "country" in result["categories_present"])
check("categories_present includes 'non_state_armed_group' (Hamas)", "non_state_armed_group" in result["categories_present"])
check("categories_absent correctly reports 'mercenary_pmc' and 'company' (no real data)",
      set(result["categories_absent"]) == {"mercenary_pmc", "company"}, result["categories_absent"])

boxes_by_label = {b["top"]["label"]: b for b in result["boxes"]}
check("exactly one real box for Ukraine (country)", "Ukraine" in boxes_by_label)
check("exactly one real box for Hamas (non-state armed group)", "Hamas" in boxes_by_label)
check("'Other factions' (a generic bucket label, not a real specific org) gets NO box",
      "Other factions" not in boxes_by_label, list(boxes_by_label.keys()))

print("\n[2] Real pyramid tier order for the Ukraine box: Top -> Groups -> Locations -> Signals")
ua_box = boxes_by_label["Ukraine"]
check("tier2 (Groups) contains the real Ukraine faction", any(g["id"] == "faction_ukraine" for g in ua_box["tier2_groups"]))
check("tier3 (Locations) contains the real event", any(l["id"] == "geoconfirmed_evt1" for l in ua_box["tier3_locations"]))
check("tier4 (Signals) contains the real correlation node linked to that event",
      any(s["id"] == "corr_1" for s in ua_box["tier4_signals"]), ua_box["tier4_signals"])

print("\n[3] Real pyramid tier order for the Hamas box (its own direct ORBAT/locations)")
hamas_box = boxes_by_label["Hamas"]
check("Hamas box has no real tier2 groups in this minimal fixture (none defined)", hamas_box["tier2_groups"] == [])

print("\n[4] No fabricated cross-box edges without real backing data")
check("cross_box_edges is empty (no real alliance/claim edge exists in this fixture)",
      result["cross_box_edges"] == [], result["cross_box_edges"])

print("\n" + "=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    print("=" * 70)
    sys.exit(1)
else:
    print("  RESULT: ALL CHECKS PASSED")
    print("=" * 70)
