"""
link_predict.py — connections the graph implies but has never stated.

THE POINT. The ontology could hold "Ukraine is allied with the UAE" and
"the UAE supplies Sudan" as two unrelated rows and never put them
together. A human reading both draws a conclusion immediately; the
system did not, because nothing in it ever asked "what does this
neighbourhood imply?". That question is this module.

WHY PATHS AND NOT EMBEDDINGS. A graph-embedding model (TransE, R-GCN and
relatives) would score candidate links well and be unable to say why.
For this product the reason IS the deliverable: an operator cannot act
on "0.68", and should not. They can act on "Ukraine — allied with →
UAE — supplies → Sudan", because they can check each step and reject the
one that is wrong. So scoring is path-based, every prediction carries
the chain that produced it, and a prediction whose chain cannot be
written in a sentence is not returned.

SCORING. A weighted Adamic-Adar. Two nodes that share an intermediate
are evidence for a link between them, but a shared intermediate is only
informative if it is not shared by everyone: 30,115 vessels are flagged
in some country, so "both connect to Panama" means nothing at all. Each
shared neighbour therefore contributes

    conf(a,m) * conf(m,b) / log(1 + degree(m))

which is near zero for a hub and substantial for a rare, specific
intermediate. Intermediates above HUB_DEGREE are skipped outright, both
because they carry no signal and because expanding them is what made a
two-hop query from a country return the entire graph.

CONFIDENCE IS CAPPED, AND LOW. Everything this module emits is
inference from co-occurrence in a graph that is itself mostly inference.
Nothing here exceeds MAX_CONF, which sits below the 0.8 the rest of the
system uses to mark an edge `inferred`, so a predicted link can never be
mistaken for an observed one. A prediction is a question worth asking,
not a finding.
"""
from __future__ import annotations
import math
import sqlite3
import time
from collections import defaultdict

# Above this, an intermediate is a hub: shared by so many nodes that
# sharing it is not evidence of anything.
HUB_DEGREE = 400

# Nothing inferred is ever allowed to look observed. The rest of the
# system treats conf < 0.8 as `inferred`; this stays well under it.
MAX_CONF = 0.60

# Relations that describe an actual channel between parties, as opposed
# to a shared attribute. Two ships being flagged in the same country is
# not a link between the ships; a company owning both of them is.
# Relations naming an actual channel between two parties, as opposed to
# a shared attribute. Two ships flagged in the same country is not a
# link between the ships; a company owning both of them is. Spelled the
# way graph_build stores them (spaces, not underscores — relations.py
# works in underscores internally and converts on the way in, and using
# its spelling here would silently match nothing).
ALIGNMENT = frozenset({
    "allied with", "visited", "hosted visit from", "signed agreement with",
    "diplomatic cooperation with", "economic cooperation with",
    "material cooperation with", "intends to cooperate with",
    "negotiating with", "consulting with",
})

SUPPLY = frozenset({
    "provides aid to", "provides economic aid to",
    "provides humanitarian aid to", "material cooperation with",
})

HOSTILITY = frozenset({
    "uses military force against", "uses air or missile force against",
    "fights with ground forces", "assaults", "threatens",
    "threatens force against", "coerces", "imposes embargo on",
})

STRUCTURAL = frozenset({
    "owns", "operates", "manufactures", "originates in", "observed in",
    "sanctioned by",
})

CHANNEL_RELATIONS = ALIGNMENT | SUPPLY | HOSTILITY | STRUCTURAL


# ── Caching ───────────────────────────────────────────────────────────
#
# WHY THIS IS NOT OPTIONAL. Every call here loads the whole edge table
# and walks it. Measured on the live graph, grouped_chains() took 5.8
# seconds — and it is polled by the notification feed, so that was 5.8
# seconds of server CPU per client every five minutes, on the same event
# loop everything else is served from. The graph only changes when it is
# rebuilt, which is on a timer, so recomputing per request was buying
# nothing at all.
#
# Keyed on the parameters AND on the edge count, so a rebuild that adds
# edges invalidates the cache without needing to be told.
CACHE_TTL_S = 900

#: THE ADJACENCY IS 59 MEGABYTES AND min_conf IS A QUERY PARAMETER.
#:
#: The first version of this cache held up to 64 entries keyed partly on
#: min_conf, which /api/ontology/predict and /api/ontology/findings both
#: expose to the caller. Every distinct value stacked another full
#: adjacency — measured at 59MB for 85,146 nodes — so a handful of
#: different values was enough to exhaust a small container's memory and
#: have it killed, which reaches a browser as a 502 with no CORS headers
#: on it.
#:
#: So the big object gets exactly ONE slot: a different min_conf
#: replaces it rather than joining it. Recomputing costs a couple of
#: seconds; running out of memory costs the process.
_ADJ_SLOTS = 1

#: Derived results are small (a few hundred dicts), so they may be kept.
_RESULT_ENTRIES = 16

_cache: dict = {}
_adj_cache: dict = {}


def _edge_count(conn: sqlite3.Connection) -> int:
    try:
        return conn.execute("SELECT COUNT(*) FROM graph_edges").fetchone()[0]
    except sqlite3.Error:
        return -1


def _db_identity(conn: sqlite3.Connection):
    """Which database this is, so two of them cannot share a cache entry.

    Keying on the edge count alone was wrong, and the tests caught it
    immediately: two different in-memory graphs that happen to hold the
    same number of edges are indistinguishable, so one test's answer was
    served to another. On a file-backed database the path is the
    identity and the cache survives across connections, which is the
    whole point — a request opens its own connection. An in-memory
    database has no path, so it falls back to the connection object,
    which is exactly the right granularity for a throwaway graph.
    """
    try:
        for _seq, name, path in conn.execute("PRAGMA database_list"):
            if name == "main":
                return path or f"mem:{id(conn)}"
    except sqlite3.Error:
        pass
    return f"mem:{id(conn)}"


def _cached(conn: sqlite3.Connection, key: tuple, build, *, store=None,
            max_entries: int = _RESULT_ENTRIES):
    """Memoised on (database, key, edge count), with a TTL as a backstop.

    `store` lets the caller keep the one enormous object in its own
    single-slot cache — see _ADJ_SLOTS.
    """
    cache = _cache if store is None else store
    full = (_db_identity(conn), key, _edge_count(conn))
    hit = cache.get(full)
    now = time.time()
    if hit and now - hit[0] < CACHE_TTL_S:
        return hit[1]
    val = build()
    cache[full] = (now, val)
    # Evict oldest first, down to the cap. Unbounded growth in a
    # process that runs for weeks is how a slow leak starts, and for
    # the adjacency it is not slow at all.
    if len(cache) > max_entries:
        for k in sorted(cache, key=lambda k: cache[k][0])[:len(cache) - max_entries]:
            cache.pop(k, None)
    return val


def _load(conn: sqlite3.Connection, min_conf: float = 0.5):
    """Adjacency and degree for the whole graph, once — and memoised.

    Every entry point here needs the whole adjacency, and predict(),
    chains() and meta_path_findings() each rebuilt it from scratch. It
    is the same 85,000 rows every time and it only changes on a rebuild.

    Undirected for traversal — "who connects to this company" and "who
    does this company connect to" are the same question for prediction —
    but each edge keeps its direction so the explanation can be written
    the right way round.
    """
    return _cached(conn, ("load", min_conf),
                   lambda: _load_uncached(conn, min_conf),
                   store=_adj_cache, max_entries=_ADJ_SLOTS)


def _load_uncached(conn: sqlite3.Connection, min_conf: float):
    adj: dict[str, list] = defaultdict(list)
    deg: dict[str, int] = defaultdict(int)
    rows = conn.execute(
        "SELECT src, dst, relation, conf, basis, method FROM graph_edges"
        " WHERE conf >= ?", (min_conf,)).fetchall()
    for src, dst, rel, conf, basis, method in rows:
        adj[src].append((dst, rel, conf, basis, True, method or ""))
        adj[dst].append((src, rel, conf, basis, False, method or ""))
        deg[src] += 1
        deg[dst] += 1
    return adj, deg


def _phrase(a_label: str, rel: str, b_label: str, forward: bool) -> str:
    return f"{a_label} —{rel}→ {b_label}" if forward else f"{b_label} —{rel}→ {a_label}"


def predict(conn: sqlite3.Connection, root: str, *,
            limit: int = 25, min_conf: float = 0.5,
            min_score: float = 0.05,
            types: tuple | None = None) -> list[dict]:
    """Links from `root` that the graph implies but does not contain.

    Returns predictions ordered by score, each with the paths that
    produced it written out in full.
    """
    adj, deg = _load(conn, min_conf)
    if root not in adj:
        return []

    labels = dict(conn.execute("SELECT id, label FROM graph_nodes").fetchall())
    ntypes = dict(conn.execute("SELECT id, type FROM graph_nodes").fetchall())

    direct = {n for n, *_ in adj[root]}
    direct.add(root)

    # target -> list of (intermediate, contribution, path description)
    hits: dict[str, list] = defaultdict(list)

    for mid, rel1, conf1, _basis1, fwd1, _m1 in adj[root]:
        d = deg.get(mid, 0)
        if d > HUB_DEGREE or d < 2:
            continue
        if rel1 not in CHANNEL_RELATIONS:
            continue
        weight_mid = 1.0 / math.log(1 + d)
        for tgt, rel2, conf2, _basis2, fwd2, _m2 in adj[mid]:
            if tgt in direct:
                continue
            if rel2 not in CHANNEL_RELATIONS:
                continue
            if types and ntypes.get(tgt) not in types:
                continue
            contrib = conf1 * conf2 * weight_mid
            chain = (f"{_phrase(labels.get(root, root), rel1, labels.get(mid, mid), fwd1)}"
                     f"  ·  {_phrase(labels.get(mid, mid), rel2, labels.get(tgt, tgt), fwd2)}")
            hits[tgt].append((mid, contrib, chain))

    out = []
    for tgt, paths in hits.items():
        score = sum(c for _, c, _ in paths)
        if score < min_score:
            continue
        paths.sort(key=lambda p: -p[1])
        # Independent routes are the thing that separates a coincidence
        # from a pattern, so the count is reported and it raises
        # confidence — but only towards the cap, never past it.
        n_paths = len(paths)
        conf = min(MAX_CONF, score * (1.0 + 0.15 * (n_paths - 1)))
        out.append({
            "src": root,
            "dst": tgt,
            "dst_label": labels.get(tgt, tgt),
            "dst_type": ntypes.get(tgt),
            "score": round(score, 4),
            "conf": round(conf, 3),
            "inferred": True,
            "paths": n_paths,
            "via": [{"node": m, "label": labels.get(m, m),
                     "weight": round(c, 4), "chain": ch}
                    for m, c, ch in paths[:4]],
            "basis": paths[0][2],
            "caveat": ("Inferred from shared connections, not observed. "
                       f"{n_paths} independent route{'s' if n_paths != 1 else ''} "
                       "through the graph; each step should be checked."),
        })

    out.sort(key=lambda r: -r["score"])
    return out[:limit]


# ── Meta-paths: the inferences worth naming ───────────────────────────
#
# Adamic-Adar finds structure but does not know what any of it MEANS.
# These are the specific two-step patterns that carry a real-world
# reading, written out so the system can say the sentence rather than
# emit a number. Each one names the claim it licenses AND the reason it
# might be wrong, because a rule that cannot fail is not a rule.
META_PATHS = [
    {
        "name": "materiel_reach",
        "a": frozenset({"originates in"}), "b": ALIGNMENT | SUPPLY,
        "claim": "{a} materiel may appear in {c}",
        "why_wrong": "A design lineage is not a supply record: the origin "
                     "country may not be the party that transferred it, and "
                     "captured or third-party stock is common.",
        "conf": 0.45,
    },
    {
        "name": "aligned_supply",
        "a": frozenset({"allied with"}), "b": SUPPLY,
        "claim": "{a} may reach {c} through {b_node}",
        "why_wrong": "An alliance is not a transfer. This is a route that "
                     "exists, not one that has been used.",
        "conf": 0.40,
    },
    {
        "name": "shared_operator",
        "a": frozenset({"operates"}), "b": frozenset({"operates"}),
        "claim": "{a} and {c} are fielded by the same force",
        "why_wrong": "Co-fielding by one unit says nothing about where "
                     "either system came from.",
        "conf": 0.50,
    },
    {
        "name": "supplier_of_adversary",
        "a": ALIGNMENT, "b": HOSTILITY,
        "claim": "{a} is aligned with {b_node}, which is in conflict with {c}",
        "why_wrong": "Alignment with a belligerent is not participation in "
                     "its conflict, and CAMEO codes reporting, not acts.",
        "conf": 0.35,
    },
]


def _specificity(adj: dict, node: str, relation: str) -> float:
    """How much it means that THIS node has THIS relation.

    The correction that makes the difference between a finding and
    spam. "The United States is allied with Belgium" is true and
    carries almost no information, because the United States is allied
    with thirty-one other countries through the same treaty — so a
    chain routed through it explains nothing. A relation a node holds
    with two parties is a far stronger signal than one it holds with
    thirty. This is the same Adamic-Adar correction used above, applied
    to the relation rather than the node.
    """
    n = sum(1 for _d, rel, _c, _b, _f, _m in adj.get(node, []) if rel == relation)
    return 1.0 / math.log(2.718 + n)


def _conflict_weight(conn: sqlite3.Connection) -> dict:
    """How much it would MATTER if materiel reached a given country.

    Ranking by route strength alone put "NLAW could reach Luxembourg"
    at the top, which is structurally true and of no use to anybody. A
    weapon reaching a country with an active armed conflict is a
    different proposition from one reaching a peaceful treaty ally, and
    the ranking has to know the difference or the feed is noise.

    Scaled logarithmically on UCDP recorded events, so an order of
    magnitude more violence is a couple of points of weight rather than
    a hundred times the score.
    """
    try:
        import graph_build as gb
        cmap = gb.country_map(conn)
    except Exception:                                        # noqa: BLE001
        return {}
    out: dict[str, float] = {}
    try:
        rows = conn.execute(
            "SELECT country, COUNT(*) FROM ucdp_events GROUP BY country").fetchall()
    except sqlite3.Error:
        return {}
    for name, n in rows:
        node = gb._country_node(name, cmap)
        if not node:
            continue
        out[node["id"]] = 1.0 + math.log(1 + (n or 0))
    return out


def chains(conn: sqlite3.Connection, *, limit: int = 40, min_conf: float = 0.5,
           min_score: float = 0.02, max_hops: int = 3) -> list[dict]:
    """Multi-step routes from a system's origin to where it might turn up.

    THE QUESTION THIS EXISTS FOR, in the operator's own words: "Ukraine
    is aligned with the UAE and recently visited them; the UAE supplies
    the war in Sudan; so expect Ukrainian drones in Sudan." That is
    three steps, not two — origin, alignment, supply — which is why the
    two-hop meta-paths could never produce it however they were tuned.

    Two filters do the real work, and without them this returns
    thousands of true, useless statements:

    NOVELTY. A route ending somewhere the system is ALREADY recorded is
    not a finding. "US-origin M113 may appear in Belgium" is both true
    and worthless; Belgium operates them and we know it.

    SPECIFICITY. Every step is discounted by how many parties the
    bridging node holds that relation with. A route through a 33-member
    treaty is worth very little; a route through a bilateral agreement
    signed by two countries is worth a great deal. Without this, NATO
    alone generated several hundred identical "findings".
    """
    adj, _deg = _load(conn, min_conf)
    labels = dict(conn.execute("SELECT id, label FROM graph_nodes").fetchall())
    ntypes = dict(conn.execute("SELECT id, type FROM graph_nodes").fetchall())

    # Where each system is already known to have been seen — the novelty test.
    known: dict[str, set] = defaultdict(set)
    for e_id, c_id in conn.execute(
            "SELECT src, dst FROM graph_edges WHERE relation = 'observed in'"):
        known[e_id].add(c_id)

    origins = conn.execute(
        "SELECT src, dst, conf FROM graph_edges WHERE relation = 'originates in'"
    ).fetchall()
    conflict = _conflict_weight(conn)

    out = []
    for eq_id, home, conf0 in origins:
        # Walk outward from the home country through alignment/supply
        # relations only. Hostility is deliberately not a transfer route.
        frontier = [(home, conf0, [f"{labels.get(eq_id, eq_id)} originates in "
                                   f"{labels.get(home, home)}"], set([home]), [])]
        for _hop in range(max_hops - 1):
            nxt = []
            for node, score, trail, visited, methods in frontier:
                for dst, rel, conf, _basis, fwd, method in adj.get(node, []):
                    if not fwd or dst in visited or rel not in (ALIGNMENT | SUPPLY):
                        continue
                    if ntypes.get(dst) != "country":
                        continue
                    # THE SAME TREATY IS NOT TWO STEPS. Walking NATO into
                    # NATO produced several hundred "findings" that all
                    # said the same empty thing: these countries are in
                    # one bloc. A membership edge may appear once.
                    if method.startswith("wikidata_membership") and any(
                            m.startswith("wikidata_membership") for m in methods):
                        continue
                    spec = _specificity(adj, node, rel)
                    s2 = score * conf * spec
                    if s2 < min_score / 4:
                        continue
                    t2 = trail + [f"{labels.get(node, node)} —{rel}→ "
                                  f"{labels.get(dst, dst)}"]
                    m2 = methods + [method]
                    nxt.append((dst, s2, t2, visited | {dst}, m2))
                    if dst in known.get(eq_id, ()):    # already seen there
                        continue
                    # A ROUTE MUST CONTAIN AN OBSERVED ACT. Treaty
                    # membership is a standing fact about a bloc; it
                    # describes who is adjacent to whom and nothing about
                    # what anyone has done. A chain built only from it
                    # restates the map. Requiring at least one dated,
                    # directional, event-coded step is what separates
                    # "these states are in the same alliance" from
                    # "these states have been dealing with each other".
                    if s2 >= min_score and len(t2) >= 3 and "cameo" in m2:
                        w = conflict.get(dst, 1.0)
                        via_nodes = sorted(visited - {home, dst})
                        out.append({
                            "equipment": eq_id,
                            "destination_conflict_weight": round(w, 2),
                            "equipment_label": labels.get(eq_id, eq_id),
                            "origin": home,
                            "origin_label": labels.get(home, home),
                            "dst": dst,
                            "dst_label": labels.get(dst, dst),
                            "via": via_nodes,
                            "via_labels": [labels.get(v, v) for v in via_nodes],
                            # Ranked by route strength AND by whether
                            # the destination is a place where this
                            # would matter. Confidence stays a property
                            # of the ROUTE only: a war does not make a
                            # supply chain more likely to exist, it
                            # makes it more worth asking about.
                            "score": round(s2 * w, 4),
                            "route_score": round(s2, 4),
                            "conf": round(min(MAX_CONF, s2 * 4), 3),
                            "hops": len(t2),
                            "inferred": True,
                            "claim": (f"{labels.get(eq_id, eq_id)} "
                                      f"({labels.get(home, home)} origin) could "
                                      f"reach {labels.get(dst, dst)}"),
                            "chain": "  ·  ".join(t2),
                            "why_wrong": (
                                "Every step is a reported relationship, not a "
                                "transfer. Design lineage is not supply, an "
                                "alignment is a route that exists rather than "
                                "one that has been used, and the system is not "
                                "recorded in the destination — which is what "
                                "makes this worth checking and also what makes "
                                "it unconfirmed."),
                        })
            frontier = nxt
            if not frontier:
                break

    out.sort(key=lambda r: -r["score"])
    return out[:limit]


def meta_path_findings(conn: sqlite3.Connection, *, limit: int = 50,
                       min_conf: float = 0.5) -> list[dict]:
    """Named, readable inferences — the ones that make a sentence.

    Separate from predict() on purpose. predict() answers "what else is
    this node probably connected to"; this answers "what does the graph
    now imply that somebody should be told about", which is the feed a
    notification is built from.
    """
    adj, _deg = _load(conn, min_conf)
    labels = dict(conn.execute("SELECT id, label FROM graph_nodes").fetchall())
    out = []
    seen = set()

    by_rel: dict[str, list] = defaultdict(list)
    for src, links in adj.items():
        for dst, rel, conf, basis, fwd, _m in links:
            if fwd:
                by_rel[rel].append((src, dst, conf, basis))

    for rule in META_PATHS:
        first = [row + (rel,) for rel in rule["a"] for row in by_rel.get(rel, [])]
        second_index: dict[str, list] = defaultdict(list)
        for rel2 in rule["b"]:
            for s2, d2, c2, b2 in by_rel.get(rel2, []):
                second_index[s2].append((d2, c2, rel2))
        for s1, d1, c1, _b1, rel_a in first:
            for d2, c2, rel_b in second_index.get(d1, []):
                if d2 == s1:
                    continue
                key = (rule["name"], s1, d2)
                if key in seen:
                    continue
                seen.add(key)
                claim = rule["claim"].format(
                    a=labels.get(s1, s1), b_node=labels.get(d1, d1),
                    c=labels.get(d2, d2))
                out.append({
                    "rule": rule["name"],
                    "src": s1, "via": d1, "dst": d2,
                    "claim": claim,
                    "chain": f"{labels.get(s1, s1)} —{rel_a}→ "
                             f"{labels.get(d1, d1)} —{rel_b}→ {labels.get(d2, d2)}",
                    "conf": round(min(MAX_CONF, rule["conf"] * c1 * c2), 3),
                    "inferred": True,
                    "why_wrong": rule["why_wrong"],
                })
    out.sort(key=lambda r: -r["conf"])
    return out[:limit]


def grouped_chains(conn: sqlite3.Connection, *, limit: int = 25,
                   min_conf: float = 0.05, min_score: float = 0.002,
                   per_group: int = 400) -> list[dict]:
    """The same routes, reported the way a person would say them.

    Ungrouped, this produced twelve findings that differed only in which
    American system was named — "Stinger could reach Nigeria", "M113
    could reach Nigeria", and so on down the inventory, all through one
    identical bridge. That is one observation about a route, not twelve
    about weapons, and a notification feed built on the ungrouped form
    would bury the operator in restatements of a single fact.

    Grouped by (origin, bridge, destination), which is the thing that is
    actually being claimed.
    """
    raw = _cached(conn, ("chains", per_group, min_conf, min_score),
                  lambda: chains(conn, limit=per_group, min_conf=min_conf,
                                 min_score=min_score))
    groups: dict[tuple, dict] = {}
    for r in raw:
        key = (r["origin"], tuple(r["via"]), r["dst"])
        g = groups.get(key)
        if g is None:
            g = groups[key] = {
                "origin": r["origin"], "origin_label": r["origin_label"],
                "via": r["via"], "via_labels": r["via_labels"],
                "dst": r["dst"], "dst_label": r["dst_label"],
                "destination_conflict_weight": r["destination_conflict_weight"],
                "score": 0.0, "conf": r["conf"], "hops": r["hops"],
                "inferred": True, "systems": [], "system_kinds": [],
                "chain": r["chain"].split("  \u00b7  ", 1)[-1],
                "why_wrong": r["why_wrong"],
            }
        g["systems"].append(r["equipment_label"])
        g["score"] = max(g["score"], r["score"])
        g["conf"] = max(g["conf"], r["conf"])

    out = []
    for g in groups.values():
        g["systems"] = sorted(set(g["systems"]))
        n = len(g["systems"])
        shown = ", ".join(g["systems"][:4])
        more = f" and {n - 4} more" if n > 4 else ""
        g["claim"] = (f"{g['origin_label']}-origin materiel ({shown}{more}) "
                      f"could reach {g['dst_label']}")
        g["system_count"] = n
        out.append(g)
    out.sort(key=lambda r: -r["score"])
    return out[:limit]
