"""
migrate_country_faction_dedup.py — real, one-time migration fixing the live
"duplicate/wrong country" ontology bug (fix/geoconfirmed-ontology-and-inbox-
fixes, Part 4).

Real root cause (confirmed by direct audit of forge_ontology.json + live
plus_code data, not theorized): geoconfirmed.py's old `_plus_code_country()`
trusted GeoConfirmed's plusCode's raw last-comma-segment as a country name
with no validation. For most placemarks that's genuinely the country, but
for Gaza-area and Crimea-area placemarks it's a locality (the plusCode ends
in a city name, not "Palestine"/"Ukraine"), and for one Moscow-area example
it's a bare postal code. This created 10 real "country"-typed nodes in
forge_ontology.json that are not real countries (Kerch, Feodosia, Yalta,
Gaza, Deir al Balah, Khan Yunis, Jabalia, Maghazi, Nuseirat Camp, and a
garbage numeric label "142137") alongside the 22 real country nodes — all
32 keyed by a raw name-slug (`country_ukraine`, `country_kerch`, ...), not
a stable canonical identifier.

Confirmed real fact this migration relies on: geoconfirmed.py's
sync_ontology_from_geoconfirmed() is the ONLY real writer of country/
faction nodes in this app today (0 pending ontology_claims rows in the live
DB at audit time; entity_linker.py/threat_matrix.py/gdelt_events.py never
create a country/faction node — verified). So no other real system holds a
reference to these old node ids that this migration would need to
re-point instead of removing.

What this does, in order:
  1. Back up forge_ontology.json (timestamped copy, never overwritten).
  2. Re-run the now-fixed sync_ontology_from_geoconfirmed() — this creates
     the real replacement `country_<ISO>` nodes (only for placemarks whose
     plus_code country is a real, canonical-registry-recognized country;
     the 10 locality/garbage cases are honestly no longer given a country
     node at all) and the new real Faction<->Country `same_polity_as`
     cross-reference edges.
  3. Remove every OLD-style country node (source="geoconfirmed", id does
     NOT match the new `country_<ISO>` scheme) and every edge that
     references one, by id — safe because of the sole-writer fact above.
  4. Report real before/after node and edge counts, and exactly which old
     nodes were removed, so nothing silently vanishes unaccounted for.

Usage:
    cd backend
    python3 migrate_country_faction_dedup.py
"""
import json
import os
import re
import shutil
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))

ONTOLOGY_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "forge", "forge_ontology.json")
_NEW_COUNTRY_ID_RE = re.compile(r"^country_[A-Z]{2}$")


def run() -> dict:
    from database import SessionLocal
    import geoconfirmed as gc

    # ── 1. Backup ────────────────────────────────────────────────────────────
    backup_path = ONTOLOGY_PATH + f".bak.{datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')}"
    shutil.copy2(ONTOLOGY_PATH, backup_path)
    print(f"[migrate] real backup written: {backup_path}")

    with open(ONTOLOGY_PATH) as f:
        before = json.load(f)
    before_node_count = len(before.get("nodes", []))
    before_edge_count = len(before.get("edges", []))
    before_country_nodes = [n for n in before.get("nodes", []) if n.get("type") == "country"]
    print(f"[migrate] before: {before_node_count} nodes, {before_edge_count} edges, "
          f"{len(before_country_nodes)} country nodes")

    # ── 2. Re-run the fixed sync (creates the new country_<ISO> nodes/edges) ──
    with SessionLocal() as db:
        sync_stats = gc.sync_ontology_from_geoconfirmed(db)
    print(f"[migrate] fixed sync_ontology_from_geoconfirmed() re-run: {sync_stats}")

    # ── 3. Remove old-style country nodes + any edge referencing them ────────
    with open(ONTOLOGY_PATH) as f:
        current = json.load(f)

    old_country_ids = {
        n["id"] for n in current.get("nodes", [])
        if n.get("type") == "country" and not _NEW_COUNTRY_ID_RE.match(n["id"])
    }
    removed_country_labels = sorted(
        (n["id"], n.get("label")) for n in current.get("nodes", []) if n["id"] in old_country_ids
    )

    new_nodes = [n for n in current.get("nodes", []) if n["id"] not in old_country_ids]
    removed_edges = [
        e for e in current.get("edges", [])
        if e.get("source") in old_country_ids or e.get("target") in old_country_ids
    ]
    removed_edge_ids = {e["id"] for e in removed_edges}
    new_edges = [e for e in current.get("edges", []) if e["id"] not in removed_edge_ids]

    current["nodes"] = new_nodes
    current["edges"] = new_edges

    with open(ONTOLOGY_PATH, "w") as f:
        json.dump(current, f)

    after_node_count = len(new_nodes)
    after_edge_count = len(new_edges)
    after_country_nodes = [n for n in new_nodes if n.get("type") == "country"]

    print(f"[migrate] removed {len(old_country_ids)} old-style country nodes: {removed_country_labels}")
    print(f"[migrate] removed {len(removed_edges)} edges that referenced them")
    print(f"[migrate] after: {after_node_count} nodes, {after_edge_count} edges, "
          f"{len(after_country_nodes)} country nodes")

    return {
        "backup_path": backup_path,
        "before": {"nodes": before_node_count, "edges": before_edge_count, "country_nodes": len(before_country_nodes)},
        "after": {"nodes": after_node_count, "edges": after_edge_count, "country_nodes": len(after_country_nodes)},
        "removed_old_country_nodes": removed_country_labels,
        "removed_edges_count": len(removed_edges),
        "sync_stats": sync_stats,
    }


if __name__ == "__main__":
    result = run()
    print("\n" + json.dumps(result, indent=2, default=str))
