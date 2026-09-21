"""
graph_store.py - one canonical place for every entity and every edge.

WHY THIS EXISTS. Every producer in this system invented its own edge
shape. country_graph emitted {s, t, kind, conf}. ftm_resolution wrote
(local_kind, local_id, ftm_id, method). geoconfirmed wrote its own
rows. correlation_scoring wrote "correlates_with" pseudo-nodes. The
consequences were not stylistic:

  - The ontology could only draw countries, because that was the only
    producer whose output the diagram's feed understood.
  - Nothing could traverse two hops, because a second hop would have
    had to cross between incompatible representations.
  - Mining across sources was impossible: there was no "all edges" to
    mine over.

So this is deliberately boring. Two tables, one shape, every producer
writes the same thing, and traversal is a join rather than an
integration project.

WHAT AN EDGE HAS TO CARRY. An edge with no stated basis is an
accusation with no argument, and in this domain that ends up in a
client deliverable. So `method`, `conf` and `basis` are NOT NULL by
convention everywhere below: how we know, how sure we are, and the
sentence a reader would need to disagree with us.

Node types follow the spec's own ontology (§6.6): person, org, faction,
vessel, aircraft, facility, country, corridor, event.
"""
from __future__ import annotations

import hashlib
import json as _json
import sqlite3
import time

NODE_TYPES = frozenset({
    "person", "org", "faction", "vessel", "aircraft",
    "facility", "country", "corridor", "event",
})

SCHEMA = """
CREATE TABLE IF NOT EXISTS graph_nodes (
    id          TEXT PRIMARY KEY,        -- "country:UKR", "vessel:256843000"
    type        TEXT NOT NULL,
    label       TEXT NOT NULL,
    country     TEXT,
    lat         REAL,
    lon         REAL,
    risk        REAL,
    props_json  TEXT,
    first_seen  REAL,
    updated_at  REAL
);
CREATE INDEX IF NOT EXISTS ix_gnodes_type    ON graph_nodes(type);
CREATE INDEX IF NOT EXISTS ix_gnodes_country ON graph_nodes(country);
CREATE INDEX IF NOT EXISTS ix_gnodes_label   ON graph_nodes(label);

CREATE TABLE IF NOT EXISTS graph_edges (
    id          TEXT PRIMARY KEY,        -- deterministic: same fact, same row
    src         TEXT NOT NULL,
    dst         TEXT NOT NULL,
    relation    TEXT NOT NULL,
    conf        REAL NOT NULL,
    method      TEXT NOT NULL,           -- how we know
    basis       TEXT,                    -- why a reader should believe it
    events      INTEGER DEFAULT 1,
    first_seen  TEXT,
    last_seen   TEXT,
    source_url  TEXT,
    updated_at  REAL
);
-- Both directions are indexed because traversal goes both ways: "who
-- does this vessel connect to" and "who connects to this company".
CREATE INDEX IF NOT EXISTS ix_gedges_src ON graph_edges(src);
CREATE INDEX IF NOT EXISTS ix_gedges_dst ON graph_edges(dst);
CREATE INDEX IF NOT EXISTS ix_gedges_rel ON graph_edges(relation);
CREATE INDEX IF NOT EXISTS ix_gedges_conf ON graph_edges(conf);
"""


def node_id(ntype: str, key) -> str:
    return f"{ntype}:{key}"


def edge_id(src: str, dst: str, relation: str, method: str) -> str:
    """Deterministic, so re-running a producer updates rather than duplicates.

    Includes the method: the same pair may be linked by two different
    routes (an exact MMSI match and a fuzzy name match), and collapsing
    those would throw away the fact that one is far better evidenced.
    """
    return hashlib.sha1(f"{src}|{dst}|{relation}|{method}".encode()).hexdigest()[:20]


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


def upsert_nodes(conn: sqlite3.Connection, nodes: list[dict]) -> int:
    now = time.time()
    rows = []
    for n in nodes or []:
        t = n.get("type")
        if t not in NODE_TYPES or not n.get("id"):
            continue
        rows.append((n["id"], t, n.get("label") or n["id"], n.get("country"),
                     n.get("lat"), n.get("lon"), n.get("risk"),
                     _json.dumps(n.get("props") or {}), now, now))
    conn.executemany(
        "INSERT INTO graph_nodes (id, type, label, country, lat, lon, risk,"
        " props_json, first_seen, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)"
        " ON CONFLICT(id) DO UPDATE SET label=excluded.label,"
        " country=COALESCE(excluded.country, graph_nodes.country),"
        " lat=COALESCE(excluded.lat, graph_nodes.lat),"
        " lon=COALESCE(excluded.lon, graph_nodes.lon),"
        " risk=COALESCE(excluded.risk, graph_nodes.risk),"
        " props_json=excluded.props_json, updated_at=excluded.updated_at", rows)
    conn.commit()
    return len(rows)


def upsert_edges(conn: sqlite3.Connection, edges: list[dict]) -> int:
    """Write edges. Anything without a method and a confidence is refused.

    Not defensive politeness: an edge whose provenance is unknown cannot
    be shown differently from one that is certain, and the whole product
    depends on being able to tell those apart.
    """
    now = time.time()
    rows = []
    for e in edges or []:
        src, dst, rel = e.get("src"), e.get("dst"), e.get("relation")
        method = e.get("method")
        conf = e.get("conf")
        if not (src and dst and rel and method) or src == dst:
            continue
        if not isinstance(conf, (int, float)):
            continue
        rows.append((edge_id(src, dst, rel, method), src, dst, rel,
                     float(conf), method, e.get("basis"),
                     int(e.get("events") or 1), e.get("first_seen"),
                     e.get("last_seen"), e.get("source_url"), now))
    conn.executemany(
        "INSERT INTO graph_edges (id, src, dst, relation, conf, method, basis,"
        " events, first_seen, last_seen, source_url, updated_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
        " ON CONFLICT(id) DO UPDATE SET conf=excluded.conf, basis=excluded.basis,"
        " events=excluded.events,"
        " first_seen=COALESCE(MIN(excluded.first_seen, graph_edges.first_seen),"
        "                     excluded.first_seen),"
        " last_seen=MAX(COALESCE(excluded.last_seen,''), COALESCE(graph_edges.last_seen,'')),"
        " source_url=COALESCE(excluded.source_url, graph_edges.source_url),"
        " updated_at=excluded.updated_at", rows)
    conn.commit()
    return len(rows)


def neighbourhood(conn: sqlite3.Connection, root: str, *, hops: int = 2,
                  min_conf: float = 0.0, limit_per_hop: int = 250) -> dict:
    """A node, its links, AND its links' links.

    This is the thing the ontology could not do. The old feed returned
    one flat ring of countries, so an analyst could see that Ukraine is
    connected to things but never that those things are connected to
    each other — which is where the actual finding lives.

    Bounded per hop rather than globally, because an unbounded second
    hop off a hub like a country returns the whole graph and takes the
    interface down with it.
    """
    seen_nodes: set = {root}
    edges: dict = {}
    frontier = [root]

    for _ in range(max(1, hops)):
        if not frontier:
            break
        marks = ",".join("?" * len(frontier))
        rows = conn.execute(
            f"SELECT id, src, dst, relation, conf, method, basis, events,"
            f" first_seen, last_seen, source_url FROM graph_edges"
            f" WHERE (src IN ({marks}) OR dst IN ({marks})) AND conf >= ?"
            f" ORDER BY conf DESC, events DESC LIMIT ?",
            (*frontier, *frontier, min_conf, limit_per_hop)).fetchall()
        nxt = []
        for r in rows:
            edges[r[0]] = {
                "id": r[0], "src": r[1], "dst": r[2], "relation": r[3],
                "conf": r[4], "method": r[5], "basis": r[6], "events": r[7],
                "first_seen": r[8], "last_seen": r[9], "source_url": r[10],
                # The spec derives this rather than storing it (§6.6).
                "inferred": r[4] < 0.8,
            }
            for end in (r[1], r[2]):
                if end not in seen_nodes:
                    seen_nodes.add(end)
                    nxt.append(end)
        frontier = nxt

    nodes = []
    if seen_nodes:
        marks = ",".join("?" * len(seen_nodes))
        for r in conn.execute(
                f"SELECT id, type, label, country, lat, lon, risk, props_json"
                f" FROM graph_nodes WHERE id IN ({marks})",
                tuple(seen_nodes)).fetchall():
            nodes.append({"id": r[0], "type": r[1], "label": r[2], "country": r[3],
                          "lat": r[4], "lon": r[5], "risk": r[6],
                          "props": _json.loads(r[7] or "{}")})

    # A node with no row of its own still appears as an edge endpoint;
    # returning it unlabelled is better than dropping the edge.
    known = {n["id"] for n in nodes}
    for nid in seen_nodes - known:
        ntype = nid.split(":", 1)[0]
        nodes.append({"id": nid, "type": ntype if ntype in NODE_TYPES else "event",
                      "label": nid.split(":", 1)[-1], "props": {}})

    return {"root": root, "hops": hops, "nodes": nodes,
            "links": list(edges.values()),
            "counts": {"nodes": len(nodes), "links": len(edges)}}


def stats(conn: sqlite3.Connection) -> dict:
    by_type = dict(conn.execute(
        "SELECT type, COUNT(*) FROM graph_nodes GROUP BY type").fetchall())
    by_rel = dict(conn.execute(
        "SELECT relation, COUNT(*) FROM graph_edges GROUP BY relation"
        " ORDER BY 2 DESC LIMIT 25").fetchall())
    by_method = dict(conn.execute(
        "SELECT method, COUNT(*) FROM graph_edges GROUP BY method").fetchall())
    asserted = conn.execute(
        "SELECT COUNT(*) FROM graph_edges WHERE conf >= 0.8").fetchone()[0]
    total = conn.execute("SELECT COUNT(*) FROM graph_edges").fetchone()[0]
    return {"nodes": sum(by_type.values()), "nodes_by_type": by_type,
            "edges": total, "edges_by_relation": by_rel,
            "edges_by_method": by_method,
            "asserted": asserted, "inferred": total - asserted}
