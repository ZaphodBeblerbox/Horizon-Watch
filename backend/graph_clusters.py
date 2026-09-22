"""
graph_clusters.py — the ontology as countries, and the things between them.

THE LAYOUT PROBLEM THIS SOLVES. The graph is overwhelmingly
country-anchored: 50,450 `located in` and 30,115 `flagged in` edges all
terminate on just 243 country nodes, against 46,778 facilities and
31,504 vessels. Drawn flat, membership wins on sheer volume and the
diagram says "country — located in — thing" forever, which is exactly
the complaint. It is also unreadable and slow: Malta alone has 828
vessels flagged to it, and nothing useful happens when you draw 828
plates around one node.

So three things are returned, and they are deliberately not equal:

  clusters   One plate per country, SUMMARISED BY COUNT. Never expanded
             to its real degree. This is scaffolding.

  links      Country to country. This is the foreground — the finding is
             never "this hospital is in Sudan", it is "this connects
             Sudan to Ukraine". Membership is not returned here at all.

  bridges    Nodes that touch TWO OR MORE countries: equipment,
             manufacturers, factions, corridors. These are the objects
             that do not belong inside any one cluster, and they are
             where the interesting claim lives — a Shahed originates in
             Iran and is observed in Ukraine, so it belongs in the gap
             between those two plates rather than inside either.

QUICK AND SMOOTH IS THE POINT, not a trade-off against it. Everything
here is a SQL aggregate over indexed columns; nothing walks the graph in
Python. The whole payload is a few hundred rows regardless of how large
the graph grows, because the expensive part — membership — is counted
server-side and never shipped.

DELIBERATELY NOT GEOGRAPHIC. It is tempting to place each cluster at its
country's real position and let the graph double as a map, but Europe
becomes an unreadable pile while the Pacific is empty, and it spends the
layout's one real degree of freedom on information the globe already
carries far better. Position is left to the client to derive from
structure.
"""
from __future__ import annotations
import sqlite3

#: Relations that say "this thing is IN that country". These are
#: counted, never drawn: they are the volume that was drowning the
#: diagram.
MEMBERSHIP = ("located in", "flagged in", "observed in", "originates in",
              "sanctioned by")

#: A bridge has to touch at least this many distinct countries. Two is
#: the whole point — one country is membership, two is a connection.
MIN_BRIDGE_COUNTRIES = 2


def _country_ids(conn: sqlite3.Connection) -> set:
    return {r[0] for r in conn.execute(
        "SELECT id FROM graph_nodes WHERE type = 'country'")}


def clusters(conn: sqlite3.Connection, *, min_conf: float = 0.0) -> list[dict]:
    """One summarised plate per country.

    Counts are by member TYPE, so a plate can say "828 vessels, 9
    facilities" rather than a single meaningless total.
    """
    marks = ",".join("?" * len(MEMBERSHIP))
    rows = conn.execute(
        f"SELECT e.dst, n.type, COUNT(*) FROM graph_edges e"
        f" JOIN graph_nodes n ON n.id = e.src"
        f" JOIN graph_nodes c ON c.id = e.dst"
        f" WHERE c.type = 'country' AND e.relation IN ({marks})"
        f"   AND e.conf >= ?"
        f" GROUP BY e.dst, n.type",
        (*MEMBERSHIP, min_conf)).fetchall()

    by_country: dict[str, dict] = {}
    for cid, ntype, n in rows:
        c = by_country.setdefault(cid, {"id": cid, "counts": {}, "total": 0})
        c["counts"][ntype] = c["counts"].get(ntype, 0) + n
        c["total"] += n

    labels = dict(conn.execute(
        "SELECT id, label FROM graph_nodes WHERE type = 'country'").fetchall())

    # Countries with no members still exist and still have links; a
    # cluster missing from the diagram because nothing is registered
    # inside it would make its links point at nothing.
    for cid, label in labels.items():
        by_country.setdefault(cid, {"id": cid, "counts": {}, "total": 0})

    out = []
    for cid, c in by_country.items():
        c["label"] = labels.get(cid, cid)
        c["iso2"] = cid.split(":", 1)[1] if ":" in cid else cid
        out.append(c)
    out.sort(key=lambda c: (-c["total"], c["label"]))
    return out


def cross_links(conn: sqlite3.Connection, *, min_conf: float = 0.0,
                limit: int = 1500) -> list[dict]:
    """Country-to-country edges only — the foreground of the diagram.

    Membership is excluded outright rather than filtered by the caller,
    because a country is never "located in" another country and any row
    of that shape here would be a data fault worth seeing separately.
    """
    marks = ",".join("?" * len(MEMBERSHIP))
    rows = conn.execute(
        f"SELECT e.id, e.src, e.dst, e.relation, e.conf, e.method, e.basis,"
        f" e.events, e.last_seen, e.source_url"
        f" FROM graph_edges e"
        f" JOIN graph_nodes a ON a.id = e.src"
        f" JOIN graph_nodes b ON b.id = e.dst"
        f" WHERE a.type = 'country' AND b.type = 'country'"
        f"   AND e.relation NOT IN ({marks}) AND e.conf >= ?"
        f" ORDER BY e.conf DESC, e.events DESC LIMIT ?",
        (*MEMBERSHIP, min_conf, limit)).fetchall()
    return [{
        "id": r[0], "src": r[1], "dst": r[2], "relation": r[3],
        "conf": r[4], "method": r[5], "basis": r[6], "events": r[7],
        "last_seen": r[8], "source_url": r[9],
        # Derived, per spec §6.6, never stored.
        "inferred": (r[4] or 0) < 0.8,
    } for r in rows]


def bridges(conn: sqlite3.Connection, *, min_conf: float = 0.0,
            limit: int = 400, types: tuple | None = None) -> list[dict]:
    """Nodes that touch two or more countries.

    The class of object the flat diagram had nowhere to put. A Shahed
    originates in Iran and is observed in Ukraine; it is not a member of
    either, and drawing it inside one of them asserts something untrue.
    """
    marks = ",".join("?" * len(MEMBERSHIP))
    # TYPE FILTER, because one type drowns the rest. Submarine cables are
    # legitimately the widest bridges in the graph — 2Africa touches 32
    # countries — but "a cable lands in many places" is structural
    # background, and unfiltered it pushes every piece of equipment and
    # every organisation off the end of the limit. The caller asks for
    # what it wants to look at.
    tclause, tparams = "", ()
    if types:
        tmarks = ",".join("?" * len(types))
        tclause = f" AND n.type IN ({tmarks})"
        tparams = tuple(types)
    rows = conn.execute(
        f"SELECT e.src, n.type, n.label, COUNT(DISTINCT e.dst) AS ncty,"
        f"       GROUP_CONCAT(DISTINCT e.dst)"
        f" FROM graph_edges e"
        f" JOIN graph_nodes n ON n.id = e.src"
        f" JOIN graph_nodes c ON c.id = e.dst"
        f" WHERE c.type = 'country' AND n.type != 'country'{tclause}"
        f"   AND e.relation IN ({marks}) AND e.conf >= ?"
        f" GROUP BY e.src"
        f" HAVING ncty >= ?"
        f" ORDER BY ncty DESC, e.src LIMIT ?",
        (*tparams, *MEMBERSHIP, min_conf, MIN_BRIDGE_COUNTRIES, limit)).fetchall()

    out = []
    for nid, ntype, label, ncty, dsts in rows:
        countries = sorted(set((dsts or "").split(",")))
        out.append({
            "id": nid, "type": ntype, "label": label or nid,
            "countries": countries, "country_count": ncty,
        })
    return out


def bridge_type_counts(conn: sqlite3.Connection, *, min_conf: float = 0.0) -> dict:
    """How many bridges there are of each type, so a filter can be offered
    without first fetching every one of them."""
    marks = ",".join("?" * len(MEMBERSHIP))
    rows = conn.execute(
        f"SELECT type, COUNT(*) FROM ("
        f"  SELECT n.type AS type, COUNT(DISTINCT e.dst) AS ncty"
        f"  FROM graph_edges e"
        f"  JOIN graph_nodes n ON n.id = e.src"
        f"  JOIN graph_nodes c ON c.id = e.dst"
        f"  WHERE c.type = 'country' AND n.type != 'country'"
        f"    AND e.relation IN ({marks}) AND e.conf >= ?"
        f"  GROUP BY e.src HAVING ncty >= ?"
        f") GROUP BY type",
        (*MEMBERSHIP, min_conf, MIN_BRIDGE_COUNTRIES)).fetchall()
    return {t: n for t, n in rows}


def overview(conn: sqlite3.Connection, *, min_conf: float = 0.0,
             link_limit: int = 1500, bridge_limit: int = 400,
             bridge_types: tuple | None = None) -> dict:
    """The whole clustered view in one call.

    One request rather than three, because the client needs all three to
    lay anything out and three round trips is three chances to render a
    half-built diagram.
    """
    cl = clusters(conn, min_conf=min_conf)
    lk = cross_links(conn, min_conf=min_conf, limit=link_limit)
    br = bridges(conn, min_conf=min_conf, limit=bridge_limit,
                 types=bridge_types)

    linked = set()
    for e in lk:
        linked.add(e["src"])
        linked.add(e["dst"])
    for b in br:
        linked.update(b["countries"])

    # How many of each a plate connects to, so the client can size and
    # order without counting the link list itself.
    out_degree: dict[str, int] = {}
    for e in lk:
        out_degree[e["src"]] = out_degree.get(e["src"], 0) + 1
        out_degree[e["dst"]] = out_degree.get(e["dst"], 0) + 1
    for c in cl:
        c["links"] = out_degree.get(c["id"], 0)
        c["bridged"] = c["id"] in linked

    return {
        "available": True,
        "clusters": cl,
        "links": lk,
        "bridges": br,
        "counts": {
            "clusters": len(cl),
            "links": len(lk),
            "bridges": len(br),
            "bridges_by_type": bridge_type_counts(conn, min_conf=min_conf),
            # Said explicitly: this is what is NOT being shipped, and
            # why the payload stays small however large the graph gets.
            "members_summarised": sum(c["total"] for c in cl),
        },
        "note": ("Country plates are summarised by count and never expanded; "
                 "membership is counted, not drawn. Links between countries "
                 "and bridging entities are the content."),
    }
