"""
graph_build.py - fill the canonical graph from every source we hold.

Each producer below reads one store we already have and emits nodes and
edges in the one shape graph_store defines. That is the whole point: a
second hop can now cross from a vessel to its flag state to that
state's relations, because all three are rows in the same two tables.

RELATION NAMES FOLLOW THE SPEC'S OWN VOCABULARY (§6.6 LINK_KINDS):
operates, owns, flagged in, transits, located in, affiliated with,
supplies, sanctioned by, observed at, controls, contracted to. Inventing
a parallel vocabulary is how the ontology ended up with
"correlates_with" for 88% of its edges.

CONFIDENCE IS NOT DECORATION. The spec derives `inferred` from
conf < 0.8, so these numbers decide whether an edge draws solid or
dashed. A flag state read straight off an AIS message is 0.95; a
country pair aggregated from four news-coded events is not.
"""
from __future__ import annotations

import logging
import sqlite3

import graph_store as gs

try:
    from vessel_identity import flag_of as _flag_of
except Exception:                                            # noqa: BLE001
    def _flag_of(_mmsi):                                     # pragma: no cover
        return None

logger = logging.getLogger(__name__)


# ── one key per country, or the graph silently splits ────────────────
#
# Producers hand us whatever their source held: vessel flags arrive as
# ISO2, cable landfalls and airport rows as full country names, CAMEO as
# ISO3. Keyed as received, that produced 431 country nodes — 242 by ISO2
# and 189 by name — with Malta existing as BOTH country:MT and
# country:Malta. Nothing errors; the graph just quietly stops joining,
# so a Malta-flagged vessel can never meet a Malta cable landing, which
# is exactly the second-order connection this store exists to make.
#
# THE AUTHORITY IS DATA WE ALREADY HAVE. country_codes.py's tables are
# partial by design — 127 names, 114 ISO2 mappings, assembled for GDELT
# coverage — and canonicalising through them DROPPED Malta entirely,
# which is worse than fragmenting. The airports table carries both
# country_code and country_name across 49,260 rows: 239 distinct pairs,
# effectively complete ISO 3166, and it resolves 119 of the 123 country
# names the cable data uses. No new dependency and nothing hand-typed.
try:
    import country_codes as _cc
except Exception:                                            # noqa: BLE001
    _cc = None


def country_map(conn: sqlite3.Connection) -> dict:
    """{name_lower -> ISO2, iso2 -> display name} from the airport registry."""
    by_name: dict = {}
    by_iso2: dict = {}
    for iso2, name in conn.execute(
            "SELECT DISTINCT country_code, country_name FROM airports"
            " WHERE country_code IS NOT NULL AND country_code <> ''"
            " AND country_name IS NOT NULL AND country_name <> ''"):
        code = str(iso2).strip().upper()
        nm = str(name).strip()
        if len(code) == 2 and nm:
            by_name.setdefault(nm.lower(), code)
            by_iso2.setdefault(code, nm)
    return {"by_name": by_name, "by_iso2": by_iso2}


def canonical_country(raw, cmap: dict | None = None) -> tuple:
    """(ISO2, display name) for any of ISO2, ISO3 or a country name.

    ISO2 is the canonical key because it is the one scheme with a
    complete table available in this system. An ISO3 input — which is
    what CAMEO gives us — is routed via its name.

    Returns (None, None) when it cannot be resolved, and the caller then
    drops the edge rather than inventing a node nothing will ever match.
    """
    v = str(raw or "").strip()
    if not v:
        return (None, None)
    cmap = cmap or {"by_name": {}, "by_iso2": {}}
    by_name, by_iso2 = cmap["by_name"], cmap["by_iso2"]
    up = v.upper()

    if len(up) == 2:
        return (up, by_iso2.get(up, up)) if up in by_iso2 or not by_iso2 else (up, up)
    if len(up) == 3 and _cc:
        # ISO3 -> its name -> ISO2, since the complete table is by name.
        name = _cc.ISO3_NAME.get(up)
        if name:
            code = by_name.get(name.lower())
            if code:
                return (code, by_iso2.get(code, name))
        for iso2, iso3 in getattr(_cc, "ISO2_TO_ISO3", {}).items():
            if iso3 == up:
                return (iso2, by_iso2.get(iso2, iso2))
    code = by_name.get(v.lower())
    if code:
        return (code, by_iso2.get(code, v))
    return (None, None)


def _country_node(raw, cmap: dict | None = None) -> dict | None:
    iso2, name = canonical_country(raw, cmap)
    if not iso2:
        return None
    return {"id": gs.node_id("country", iso2), "type": "country",
            "label": name or iso2, "country": iso2}


# ── producers ─────────────────────────────────────────────────────────

def vessels_and_flags(conn: sqlite3.Connection, *, limit: int = 40000,
                      cmap: dict | None = None) -> tuple:
    """Every vessel we have tracked, and the state it flies."""
    nodes, edges = [], []
    rows = conn.execute(
        "SELECT mmsi, MAX(name), MAX(flag), MAX(ship_type_text) FROM vessel_history"
        " GROUP BY mmsi LIMIT ?", (limit,)).fetchall()
    for mmsi, name, flag, stype in rows:
        if not mmsi:
            continue
        vid = gs.node_id("vessel", mmsi)
        nodes.append({"id": vid, "type": "vessel",
                      "label": (name or "").strip() or f"MMSI {mmsi}",
                      "country": (flag or None),
                      "props": {"mmsi": str(mmsi), "ship_type": stype or None}})
        # THE FLAG IS DERIVED, NOT STORED. vessel_history has a flag
        # column and it is empty: the flag is worked out at API time
        # from the MMSI's maritime identification digits and never
        # persisted. Reading the column gave 30,077 vessels and zero
        # edges — every ship in the graph floating unconnected to any
        # state. So derive it here the same way the live API does.
        iso2 = None
        if flag and str(flag).strip() and str(flag).strip().lower() != "unknown":
            iso2 = str(flag).strip()
        else:
            got = _flag_of(mmsi)
            iso2 = (got or {}).get("flag_iso2")
        cnode = _country_node(iso2, cmap) if iso2 else None
        if cnode:
            nodes.append(cnode)
            edges.append({
                "src": vid, "dst": cnode["id"],
                "relation": "flagged in",
                # The MMSI's first three digits ARE the flag state by
                # allocation, so this is a read rather than a guess —
                # but a spoofed or reused MMSI is a known practice in
                # exactly the fleet we care about, hence not 1.0.
                "conf": 0.9, "method": "mmsi_mid",
                "basis": f"MMSI {mmsi} is allocated to {iso2}",
            })
    return nodes, edges


def cables_and_landfalls(conn: sqlite3.Connection, *, cmap: dict | None = None) -> tuple:
    """Submarine cables, the countries they land in, and who owns them.

    A cable is a corridor in the spec's ontology, and its owners are
    organisations — which is how a piece of infrastructure becomes
    connected to a corporate network rather than floating alone.
    """
    nodes, edges = [], []
    for cid, cname, owners, a, b, allc in conn.execute(
            "SELECT cable_id, cable_name, owners, country_a, country_b, all_countries"
            " FROM cable_segments").fetchall():
        if not cid:
            continue
        kid = gs.node_id("corridor", cid)
        nodes.append({"id": kid, "type": "corridor",
                      "label": (cname or cid), "props": {"cable_id": str(cid)}})
        seen = set()
        for raw in (allc or f"{a or ''},{b or ''}").split(","):
            iso = raw.strip()
            if not iso or iso in seen:
                continue
            seen.add(iso)
            cnode = _country_node(iso, cmap)
            if not cnode:
                continue
            nodes.append(cnode)
            edges.append({
                "src": kid, "dst": cnode["id"],
                "relation": "located in", "conf": 0.9, "method": "cable_landing",
                "basis": f"{cname or cid} lands in {cnode['label']}",
            })
        for raw in (owners or "").split(","):
            name = raw.strip()
            if len(name) < 3:
                continue
            oid = gs.node_id("org", name.lower())
            nodes.append({"id": oid, "type": "org", "label": name})
            edges.append({
                "src": oid, "dst": kid, "relation": "owns",
                "conf": 0.85, "method": "cable_owner",
                "basis": f"{name} listed as an owner of {cname or cid}",
            })
    return nodes, edges


def airports_located(conn: sqlite3.Connection, *, limit: int = 60000,
                     cmap: dict | None = None) -> tuple:
    """Airports as facilities, in the country they sit in."""
    nodes, edges = [], []
    for name, icao, cc in conn.execute(
            "SELECT airport_name, icao_code, country_code FROM airports"
            " WHERE country_code IS NOT NULL AND country_code <> '' LIMIT ?",
            (limit,)).fetchall():
        key = (icao or name or "").strip()
        if not key:
            continue
        fid = gs.node_id("facility", key)
        nodes.append({"id": fid, "type": "facility", "label": name or key,
                      "country": cc, "props": {"icao": icao or None,
                                               "kind": "airport"}})
        cnode = _country_node(cc, cmap)
        if not cnode:
            continue
        nodes.append(cnode)
        edges.append({"src": fid, "dst": cnode["id"],
                      "relation": "located in", "conf": 0.98,
                      "method": "airport_registry",
                      "basis": f"OurAirports records {name or key} in {cnode['label']}"})
    return nodes, edges


def sanctions_bridge(conn: sqlite3.Connection) -> tuple:
    """Tracked vessels and the listed entities they resolve to.

    The edge every other part of this depends on: it is what turns "a
    ship" into "a ship somebody has sanctioned", and it is the hop that
    lets a vessel reach a corporate network.
    """
    nodes, edges = [], []
    rows = conn.execute(
        "SELECT r.local_id, r.ftm_id, r.method, r.score, r.evidence,"
        " t.caption, t.schema, t.country"
        " FROM ftm_resolution r JOIN ftm_things t ON t.id = r.ftm_id"
        " WHERE r.local_kind = 'vessel'").fetchall()
    for mmsi, ftm_id, method, score, evidence, caption, schema, country in rows:
        vid = gs.node_id("vessel", mmsi)
        # An FtM Vessel is the same real object as our vessel; a Company
        # or Person behind it is a different object entirely.
        ntype = {"Vessel": "vessel", "Airplane": "aircraft",
                 "Person": "person"}.get(schema, "org")
        eid = gs.node_id(ntype, ftm_id)
        nodes.append({"id": eid, "type": ntype,
                      "label": caption or ftm_id, "country": country,
                      "props": {"ftm_id": ftm_id, "schema": schema}})
        edges.append({
            "src": vid, "dst": eid, "relation": "sanctioned by",
            # An identifier match is near-certain; a fuzzy name match is
            # explicitly not, and the spec's 0.8 line then draws it dashed.
            "conf": 0.98 if method in ("imo", "mmsi") else float(score or 0.5),
            "method": f"resolution_{method}",
            "basis": f"matched on {evidence}" if evidence else f"matched by {method}",
        })
    return nodes, edges


def cameo_relations(events: list, *, cmap: dict | None = None) -> tuple:
    """Typed, directed relations between states, from CAMEO."""
    import relations as _rel
    nodes, edges = [], []
    for e in _rel.build(events or [], level="country")["edges"]:
        a, b = _country_node(e["source"], cmap), _country_node(e["target"], cmap)
        if not a or not b:
            continue
        nodes.extend([a, b])
        n = e["events"]
        edges.append({
            "src": a["id"], "dst": b["id"],
            "relation": e["relation"].replace("_", " "),
            # Evidence volume, so a well-reported relation draws solid
            # and a thinly-reported one draws dashed.
            "conf": round(min(1.0, n / 20.0), 2),
            "method": "cameo",
            "basis": f"{n} coded event(s) {e['first_seen']} → {e['last_seen']}",
            "events": n, "first_seen": e["first_seen"], "last_seen": e["last_seen"],
            "source_url": (e["examples"][0]["url"] if e["examples"] else None),
        })
    return nodes, edges


def rebuild(db_path: str, *, events: list | None = None) -> dict:
    """Run every producer and upsert. Idempotent: same facts, same rows."""
    conn = sqlite3.connect(db_path)
    try:
        gs.ensure_schema(conn)
        total_n = total_e = 0
        report = {}
        cmap = country_map(conn)
        producers = [
            ("vessels_and_flags", lambda: vessels_and_flags(conn, cmap=cmap)),
            ("cables_and_landfalls", lambda: cables_and_landfalls(conn, cmap=cmap)),
            ("airports_located", lambda: airports_located(conn, cmap=cmap)),
            ("sanctions_bridge", lambda: sanctions_bridge(conn)),
        ]
        if events is not None:
            producers.append(("cameo_relations", lambda: cameo_relations(events, cmap=cmap)))

        for name, fn in producers:
            try:
                nodes, edges = fn()
                n = gs.upsert_nodes(conn, nodes)
                e = gs.upsert_edges(conn, edges)
                report[name] = {"nodes": n, "edges": e}
                total_n += n
                total_e += e
            except Exception as ex:                          # noqa: BLE001
                # One failing producer must not cost the whole graph.
                logger.exception("graph producer %s failed", name)
                report[name] = {"error": f"{type(ex).__name__}: {ex}"}

        return {"available": True, "written_nodes": total_n,
                "written_edges": total_e, "by_producer": report,
                "stats": gs.stats(conn)}
    finally:
        conn.close()
