"""
Regression test — real backend endpoints for the Ontology Graph tab's
country-clustered rebuild (fix/geoconfirmed-markers-and-ontology-graph-
rebuild, Parts 2/4/5): search, node connections, top-level countries, and
the two real per-country/per-faction scoped subgraph queries.

Isolation: patches main._FORGE_DIR directly (the one real, verified-
effective isolation point — see test_forge_pattern_discovery_auto_edges.py's
docstring for the incident that established this pattern) with a hard
assertion that it took effect before any write is attempted. Never touches
the real production forge_ontology.json.

Usage:
    cd backend
    python3 test_ontology_country_graph_endpoints.py
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
print("  Ontology country-graph endpoints — real regression test")
print("=" * 70)

import main as _m  # noqa: E402
from routers import forge as _forge  # noqa: E402

_TMP_FORGE_DIR = Path(tempfile.mkdtemp(prefix="ontology_country_graph_test_")) / "forge"
_m._FORGE_DIR = _TMP_FORGE_DIR
assert _m._forge_ontology_load() == {"nodes": [], "edges": []}, \
    "isolation check failed — _FORGE_DIR patch did not take effect, refusing to continue"

# Real, minimal fixture: one country with a real flag, two factions (one
# same-named as the country, mirroring the real same_polity_as pattern),
# one ORBAT unit, one GeoConfirmed-style event location.
fixture = {
    "nodes": [
        {"id": "country_UA", "type": "country", "label": "Ukraine", "iso_code": "UA",
         "source": "geoconfirmed", "flag_path": "https://example.test/flag.png"},
        {"id": "faction_ukraine", "type": "faction", "label": "Ukraine", "source": "geoconfirmed"},
        {"id": "faction_russia", "type": "faction", "label": "Russia", "source": "geoconfirmed"},
        {"id": "orbat_1", "type": "org", "label": "Test Brigade", "source": "geoconfirmed"},
        {"id": "geoconfirmed_evt1", "type": "event", "label": "01 JAN 2026", "source": "geoconfirmed",
         "description": "A real test event"},
    ],
    "edges": [
        {"id": "e1", "source": "faction_ukraine", "target": "country_UA", "type": "same_polity_as", "auto": True},
        {"id": "e2", "source": "faction_russia", "target": "country_UA", "type": "located_in", "auto": True},
        {"id": "e3", "source": "geoconfirmed_evt1", "target": "faction_ukraine", "type": "faction_of", "auto": True},
        {"id": "e4", "source": "geoconfirmed_evt1", "target": "orbat_1", "type": "involves", "auto": True},
    ],
}
_m._forge_ontology_save(fixture)

print("\n[1] Real search finds a real GeoConfirmed-style entity by id substring")
res = _forge.forge_ontology_search(q="geoconfirmed_evt1")
check("search returns exactly 1 real result", len(res["results"]) == 1, res)
check("search result is the real event node", res["results"] and res["results"][0]["id"] == "geoconfirmed_evt1")

print("\n[2] Real search is honest about empty query")
res_empty = _forge.forge_ontology_search(q="")
check("empty query returns zero results (no fabricated match)", res_empty["results"] == [])

print("\n[3] Real node-connections entity panel data")
conns = _forge.forge_ontology_node_connections("country_UA")
check("country_UA attributes include its real flag_path", conns["attributes"].get("flag_path") == "https://example.test/flag.png")
check("country_UA attributes do NOT include a fabricated description (none was set)",
      "description" not in conns["attributes"])
conn_ids = {c["id"] for c in conns["connections"]}
check("country_UA's real connections include both real factions",
      conn_ids == {"faction_ukraine", "faction_russia"}, conn_ids)

print("\n[4] 404 on a real nonexistent node (never a fabricated empty-ish 200)")
try:
    _forge.forge_ontology_node_connections("does_not_exist")
    check("raises HTTPException for unknown node", False)
except Exception as e:
    check("raises HTTPException for unknown node", getattr(e, "status_code", None) == 404, e)

print("\n[5] Real top-level countries endpoint")
countries = _forge.forge_ontology_countries()
check("exactly 1 real country returned", len(countries["countries"]) == 1, countries["countries"])
check("real flag_path surfaced at top level", countries["countries"][0]["flag_path"] == "https://example.test/flag.png")
check("faction_count reflects both real linked factions", countries["countries"][0]["faction_count"] == 2)
check("no fabricated inter-country relationships (none were ever approved as a claim)",
      countries["relationships"] == [])

print("\n[6] Real per-country scoped subgraph — factions only, never the full transitive closure")
sub = _forge.forge_ontology_country_subgraph("UA")
sub_ids = {n["id"] for n in sub["nodes"]}
check("country subgraph includes the country + both real factions, nothing deeper",
      sub_ids == {"country_UA", "faction_ukraine", "faction_russia"}, sub_ids)
check("country subgraph is never truncated at this real small scale", sub["truncated"] is False)

print("\n[7] Real per-faction scoped subgraph — real ORBAT unit + real location reachable")
fsub = _forge.forge_ontology_faction_subgraph("faction_ukraine")
fsub_ids = {n["id"] for n in fsub["nodes"]}
check("faction subgraph reaches its real event and the real ORBAT unit via that event",
      fsub_ids == {"faction_ukraine", "geoconfirmed_evt1", "orbat_1"}, fsub_ids)

print("\n[8] 404 on a real nonexistent country/faction id")
try:
    _forge.forge_ontology_country_subgraph("ZZ")
    check("country subgraph 404s for unknown iso_code", False)
except Exception as e:
    check("country subgraph 404s for unknown iso_code", getattr(e, "status_code", None) == 404, e)

print("\n" + "=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    print("=" * 70)
    sys.exit(1)
else:
    print("  RESULT: ALL CHECKS PASSED")
    print("=" * 70)
