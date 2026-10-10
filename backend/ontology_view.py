"""ontology_view.py — the ontology of ONE thing, for the sidebar and the
overlay: what it is, what it connects to, and, for a military unit, where it
sits in its order of battle.

Every record the sidebar opens gets a graph, not only the ones with a node
in graph_nodes. Graph entities (vessels, countries, units, organisations,
facilities, cables) read their stored neighbourhood. Signals, alerts,
Telegram reports and events have no node of their own, so one is put
together from the record itself, every link from a stored fact: the act
(what happened), the place and country, the war it falls in
(conflict_context.conflict_at), the source that reported it, the actors
named in its text (faction, organisation and country labels already in
the graph — the model extracts, code resolves), and the facilities near it.
Wars and ORBAT units are walkable too ("conflict:<id>", "orbat:<id>").

MEMBERSHIP IS COUNTED, NOT DRAWN (project_ontology_layout): 828 vessels
flagged in Malta are one node saying so, never 828 dots. Counts come from
an indexed GROUP BY, not from the capped neighbourhood, so they are true.
"""
from __future__ import annotations

import json
import math
import re
import sqlite3
import threading
import time

MEMBERSHIP = {"located in", "flagged in"}
FOLD_OVER = 6                  # more than this many of one (relation, type): one counted node
# What kind of thing each node is, for colour and grouping in the drawing.
GROUP = {
    "country": "place", "country_risk": "place", "facility": "place", "corridor": "place", "place": "place", "port": "place",
    "airport": "place", "chokepoint": "place", "cable": "place", "eez": "place", "infra_feature": "place",
    "faction": "actor", "org": "actor", "person": "actor", "unit": "actor", "orbat": "actor",
    "vessel": "object", "aircraft": "object", "equipment": "object", "owned_asset": "object",
    "act": "action", "signal": "action", "alert": "action", "telegram": "action", "event": "action",
    "geoconfirmed": "action", "detection": "action", "announcement": "action",
    "conflict": "conflict", "source": "source",
}
ACT_LABEL = {
    "strike": "Strike", "attack": "Attack", "clash": "Clash", "movement": "Troop movement", "unrest": "Unrest",
    "protest": "Protest", "explosion": "Explosion", "AIS_DARK_SHIP": "AIS switched off", "gps_interference": "GPS interference",
    "military_aircraft": "Military flight", "Sanctioned Vessel": "Sanctioned vessel seen", "emergency_squawk": "Emergency squawk",
}


def group_of(ntype: str | None) -> str:
    return GROUP.get((ntype or "").lower(), "object")


def _node(r) -> dict:
    return {"id": r[0], "type": r[1], "label": r[2], "country": r[3], "lat": r[4], "lon": r[5],
            "risk": r[6], "props": json.loads(r[7] or "{}"), "group": group_of(r[1]), "walk": r[0]}


def _get(conn, nid: str) -> dict | None:
    r = conn.execute("SELECT id, type, label, country, lat, lon, risk, props_json FROM graph_nodes WHERE id = ?", (nid,)).fetchone()
    return _node(r) if r else None


def _country_node(conn, cc: str | None) -> dict | None:
    """ "ua", "UKR", "Ukraine" → the country node."""
    c = (cc or "").strip()
    if not c:
        return None
    if len(c) == 2:
        n = _get(conn, f"country:{c.upper()}")
        if n:
            return n
    try:
        from location_extract import country_name_from_code
        name = country_name_from_code(c) if len(c) <= 3 else c
    except Exception:                                          # noqa: BLE001
        name = c
    r = conn.execute("SELECT id, type, label, country, lat, lon, risk, props_json FROM graph_nodes"
                     " WHERE type = 'country' AND label = ? COLLATE NOCASE", (name or c,)).fetchone()
    return _node(r) if r else None


# ── ORBAT ──────────────────────────────────────────────────────────────────

def orbat_for(conn, name: str | None = None, orbat_id: int | None = None) -> dict | None:
    """Where a unit sits: the chain above it, the units under it (each with
    how many under them), and how many stand beside it."""
    try:
        if orbat_id is not None:
            r = conn.execute("SELECT id, parent_id, theatre_slug, name, is_disbanded, flag_path FROM geoconfirmed_orbat_nodes"
                             " WHERE id = ? AND coalesce(is_deleted, 0) = 0", (orbat_id,)).fetchone()
        else:
            nm = (name or "").strip()
            if len(nm) < 4:
                return None
            r = conn.execute("SELECT id, parent_id, theatre_slug, name, is_disbanded, flag_path FROM geoconfirmed_orbat_nodes"
                             " WHERE name = ? COLLATE NOCASE AND coalesce(is_deleted, 0) = 0"
                             " ORDER BY is_disbanded LIMIT 1", (nm,)).fetchone()
    except sqlite3.OperationalError:
        return None
    if not r:
        return None
    unit = {"id": r[0], "name": r[3], "theatre": r[2], "disbanded": bool(r[4]), "emblem": _emblem(r[5])}
    chain, pid, guard = [], r[1], 0
    while pid is not None and guard < 12:
        p = conn.execute("SELECT id, parent_id, name, flag_path FROM geoconfirmed_orbat_nodes WHERE id = ?", (pid,)).fetchone()
        if not p:
            break
        chain.append({"id": p[0], "name": p[2], "emblem": _emblem(p[3])})
        pid, guard = p[1], guard + 1
    chain.reverse()
    kids = conn.execute(
        "SELECT o.id, o.name, o.is_disbanded, (SELECT count(*) FROM geoconfirmed_orbat_nodes c WHERE c.parent_id = o.id"
        " AND coalesce(c.is_deleted, 0) = 0) FROM geoconfirmed_orbat_nodes o WHERE o.parent_id = ? AND coalesce(o.is_deleted, 0) = 0"
        " ORDER BY o.is_disbanded, o.name", (r[0],)).fetchall()
    siblings = conn.execute("SELECT count(*) FROM geoconfirmed_orbat_nodes WHERE parent_id IS ? AND id != ?"
                            " AND coalesce(is_deleted, 0) = 0", (r[1], r[0])).fetchone()[0] if r[1] is not None else 0
    return {"unit": unit, "chain": chain, "siblings": siblings,
            "children": [{"id": k[0], "name": k[1], "disbanded": bool(k[2]), "under": k[3]} for k in kids[:80]],
            "n_children": len(kids), "source": "GeoConfirmed order of battle"}


def _emblem(flag_path: str | None) -> str | None:
    first = (flag_path or "").split(",")[0].strip()
    if not first:
        return None
    return first if first.startswith("http") else f"https://geoconfirmed.org{first}"


def _orbat_graph(conn, oid: int) -> dict | None:
    o = orbat_for(conn, orbat_id=oid)
    if not o:
        return None
    u = o["unit"]
    root = {"id": f"orbat:{u['id']}", "type": "unit", "label": u["name"], "group": "actor", "walk": f"orbat:{u['id']}",
            "props": {"theatre": u["theatre"], "status": "disbanded" if u["disbanded"] else None}}
    nodes, links = [], []
    if o["chain"]:
        p = o["chain"][-1]
        nodes.append({"id": f"orbat:{p['id']}", "type": "unit", "label": p["name"], "group": "actor", "walk": f"orbat:{p['id']}"})
        links.append({"src": root["id"], "dst": f"orbat:{p['id']}", "relation": "part of", "conf": 1.0, "basis": o["source"]})
    for k in o["children"][:24]:
        nodes.append({"id": f"orbat:{k['id']}", "type": "unit", "label": k["name"], "group": "actor", "walk": f"orbat:{k['id']}"})
        links.append({"src": f"orbat:{k['id']}", "dst": root["id"], "relation": "part of", "conf": 1.0, "basis": o["source"]})
    # the same unit in the graph, with what it operates and where it was seen
    g = conn.execute("SELECT id FROM graph_nodes WHERE type IN ('faction','org') AND label = ? COLLATE NOCASE LIMIT 1", (u["name"],)).fetchone()
    if g:
        sub = graph_view(conn, g[0], hops=1)
        if sub:
            have = {n["id"] for n in nodes}
            for n in sub["nodes"]:
                if n["id"] not in have:
                    nodes.append(n); have.add(n["id"])
            for l in sub["links"]:
                links.append({**l, "src": root["id"] if l["src"] == g[0] else l["src"], "dst": root["id"] if l["dst"] == g[0] else l["dst"]})
    return {"root": root, "nodes": nodes, "links": links, "orbat": o}


# ── conflicts ─────────────────────────────────────────────────────────────

def _conflict_graph(conn, cid: str) -> dict | None:
    try:
        import conflict_context as cc
        c = next((x for x in cc.conflicts(ids={cid})), None)
    except Exception:                                          # noqa: BLE001
        c = None
    if not c:
        return None
    root = {"id": f"conflict:{cid}", "type": "conflict", "label": c["name"], "group": "conflict", "walk": f"conflict:{cid}",
            "props": {"since": c.get("since"), "sides": c.get("sides_line"), "trend": c.get("trend"), "summary": c.get("summary")},
            "lat": (c.get("center") or [None, None])[0], "lon": (c.get("center") or [None, None])[1]}
    nodes, links = [], []
    for code in c.get("countries") or []:
        n = _country_node(conn, code)
        if n:
            nodes.append(n)
            links.append({"src": root["id"], "dst": n["id"], "relation": "fought in", "conf": 1.0, "basis": "conflict baseline (reviewed)"})
    for f in c.get("factions") or []:
        fid = _actor_id(conn, f.get("name"))
        nodes.append({"id": fid, "type": "unit" if fid.startswith("orbat:") else "faction", "label": f.get("name"), "group": "actor",
                      "walk": fid if not fid.startswith("name:") else None,
                      "props": {"side": f.get("side"), "leader": f.get("leader"), "aims": f.get("aims"), "holds": f.get("holds")}})
        links.append({"src": fid, "dst": root["id"], "relation": f"fights ({f.get('side')})" if f.get("side") else "fights",
                      "conf": 1.0, "basis": "conflict baseline (reviewed)"})
        for b in f.get("backers") or []:
            bname = re.split(r"\s*\(", b)[0].strip()
            bid = _actor_id(conn, bname)
            if bid not in {n["id"] for n in nodes}:
                nodes.append({"id": bid, "type": "country" if bid.startswith("country:") else "org", "label": bname,
                              "group": "place" if bid.startswith("country:") else "actor", "walk": None if bid.startswith("name:") else bid})
            links.append({"src": bid, "dst": fid, "relation": "backs", "conf": 1.0, "basis": b})
    return {"root": root, "nodes": _dedupe(nodes), "links": links}


def _actor_id(conn, name: str | None) -> str:
    """A name → the graph node, else the ORBAT unit ("Israel Defense
    Forces" is "Israel Defense Forces (IDF)" there), else a bare name."""
    nm = (name or "").strip()
    if nm:
        r = conn.execute("SELECT id FROM graph_nodes WHERE type IN ('faction','org','country') AND label = ? COLLATE NOCASE LIMIT 1",
                         (nm,)).fetchone()
        if r:
            return r[0]
        try:
            base = re.split(r"\s*\(", nm)[0].strip()
            r = conn.execute("SELECT id FROM geoconfirmed_orbat_nodes WHERE coalesce(is_deleted,0) = 0 AND (name = ? COLLATE NOCASE"
                             " OR name LIKE ? OR name = ? COLLATE NOCASE) ORDER BY parent_id IS NULL, id LIMIT 1",
                             (nm, f"{base} (%", base)).fetchone() if len(base) >= 6 else None
            if r:
                return f"orbat:{r[0]}"
        except sqlite3.OperationalError:
            pass
    return f"name:{nm.lower()}"


# ── a graph node ──────────────────────────────────────────────────────────

def graph_view(conn, nid: str, hops: int = 1) -> dict | None:
    if nid.startswith("orbat:"):
        try:
            return _orbat_graph(conn, int(nid.split(":", 1)[1]))
        except ValueError:
            return None
    if nid.startswith("conflict:"):
        return _conflict_graph(conn, nid.split(":", 1)[1])
    root = _get(conn, nid)
    if not root:
        return None
    nodes: dict = {}
    links: list = []
    _ring(conn, nid, nodes, links, per_group=FOLD_OVER, cap=60)
    if hops >= 2:
        # the second ring: from each named neighbour, its own non-membership
        # links, a few each — a hub's second ring is the whole graph otherwise
        for n in list(nodes.values())[:28]:
            if n.get("count") or n["type"] == "country":
                continue
            _ring(conn, n["id"], nodes, links, per_group=3, cap=8, skip_membership=True, exclude={nid})
    nodes.pop(nid, None)
    if root["type"] in ("faction", "org"):
        o = orbat_for(conn, root["label"])
        return {"root": root, "nodes": list(nodes.values()), "links": links, "orbat": o}
    return {"root": root, "nodes": list(nodes.values()), "links": links}


def _ring(conn, nid, nodes, links, *, per_group, cap, skip_membership=False, exclude=frozenset()):
    """nid's links: membership folded into counted nodes, the rest drawn,
    strongest first."""
    q = ("SELECT e.src, e.dst, e.relation, e.conf, e.basis, e.source_url, n.id, n.type, n.label, n.country, n.lat, n.lon, n.risk, n.props_json"
         " FROM graph_edges e JOIN graph_nodes n ON n.id = {other} WHERE e.{me} = ? ORDER BY e.conf DESC, e.events DESC LIMIT 400")
    rows = []
    for me, other in (("src", "e.dst"), ("dst", "e.src")):
        rows += [(me, r) for r in conn.execute(q.format(me=me, other=other), (nid,))]
    groups: dict = {}
    for me, r in rows:
        key = (r[2], me, r[7])
        groups.setdefault(key, []).append(r)
    drawn = 0
    for (rel, me, otype), rs in sorted(groups.items(), key=lambda kv: -max(x[3] for x in kv[1])):
        if rel in MEMBERSHIP and skip_membership:
            continue
        fold = len(rs) > per_group and (rel in MEMBERSHIP or len(rs) > per_group * 3)
        if fold:
            n_true = _count(conn, nid, rel, me, otype)
            fid = f"count:{nid}:{rel}:{me}:{otype}"
            noun = _plural(otype, n_true)
            nodes[fid] = {"id": fid, "type": otype, "label": f"{n_true:,} {noun}", "group": group_of(otype), "count": n_true,
                          "walk": None, "sample": [x[8] for x in rs[:8]], "relation": rel}
            links.append({"src": fid if me == "dst" else nid, "dst": nid if me == "dst" else fid, "relation": rel, "conf": 1.0,
                          "basis": f"{n_true:,} recorded", "count": n_true})
            continue
        for r in rs[:per_group]:
            if drawn >= cap or r[6] in exclude:
                break
            other = r[6:]
            if other[0] not in nodes:
                nodes[other[0]] = _node(other)
            links.append({"src": r[0], "dst": r[1], "relation": rel, "conf": r[3], "basis": r[4], "source_url": r[5],
                          "inferred": (r[3] or 0) < 0.8})
            drawn += 1


_PLURAL = {"country": "countries", "facility": "facilities", "faction": "units and factions", "org": "organisations",
           "corridor": "cables", "equipment": "equipment types", "vessel": "vessels"}


def _plural(t: str, n: int) -> str:
    if n == 1:
        return {"org": "organisation", "corridor": "cable", "faction": "unit or faction", "equipment": "equipment type"}.get(t, t)
    return _PLURAL.get(t) or (t + "s")


def _count(conn, nid, rel, me, otype) -> int:
    other = "src" if me == "dst" else "dst"
    return conn.execute(f"SELECT count(*) FROM graph_edges e JOIN graph_nodes n ON n.id = e.{other}"
                        f" WHERE e.{me} = ? AND e.relation = ? AND n.type = ?", (nid, rel, otype)).fetchone()[0]


# ── a record with no node of its own ──────────────────────────────────────

_ACTORS: dict = {"at": 0.0, "re": None, "by": {}}
_ACTORS_LOCK = threading.Lock()


def _actor_matcher(conn):
    """One regex over every actor the system knows by name: countries,
    units and organisations in the graph, ORBAT units, and the wars'
    factions with their short names (conflicts.json). Rebuilt every ten
    minutes. Earlier entries win a shared name: a country beats a faction
    node that happens to carry the same label."""
    with _ACTORS_LOCK:
        if _ACTORS["re"] is not None and time.time() - _ACTORS["at"] < 600:
            return _ACTORS["re"], _ACTORS["by"]
        by: dict = {}

        def put(name, ref):
            nm = (name or "").strip()
            if len(nm) >= 4 and not nm.isdigit() and nm.lower() not in by:
                by[nm.lower()] = ref
        for nid, label in conn.execute("SELECT id, label FROM graph_nodes WHERE type = 'country'"):
            if label and len(label) > 3 and label.upper() != label:
                put(label, {"id": nid})
        for nid, label in conn.execute("SELECT id, label FROM graph_nodes WHERE type IN ('faction','org')"):
            put(label, {"id": nid})
        try:
            # only names that pick out one unit: unique in the tree, and
            # specific (a number, a quoted name, or three words or more) —
            # "Militias" or "1st Battalion" would match everything
            for oid, name in conn.execute("SELECT min(id), name FROM geoconfirmed_orbat_nodes WHERE coalesce(is_deleted,0) = 0"
                                          " AND parent_id IS NOT NULL AND length(name) >= 8 GROUP BY lower(name) HAVING count(*) = 1"):
                if re.search(r"\d|\"|«", name) or len(name.split()) >= 3:
                    put(name, {"orbat": oid, "label": name})
        except sqlite3.OperationalError:
            pass
        try:
            import conflict_context as cc
            for c in cc.baseline().get("conflicts", []):
                for f in c.get("factions") or []:
                    full = f.get("name") or ""
                    ref = {"name": full, "conflict": c["id"]}
                    put(full, ref)
                    for part in re.findall(r"\(([^)]+)\)", full) + [re.split(r"\s*\(", full)[0]]:
                        put(part, ref)
        except Exception:                                      # noqa: BLE001
            pass
        alts = sorted(by, key=len, reverse=True)
        rx = re.compile(r"(?<![\w])(" + "|".join(re.escape(a) for a in alts) + r")(?![\w])", re.I) if alts else None
        _ACTORS.update(at=time.time(), re=rx, by=by)
        return rx, by


def _actor_node(conn, ref: dict) -> dict | None:
    if ref.get("id"):
        return _get(conn, ref["id"])
    if ref.get("orbat"):
        return {"id": f"orbat:{ref['orbat']}", "type": "unit", "label": ref["label"], "group": "actor", "walk": f"orbat:{ref['orbat']}"}
    nid = _actor_id(conn, ref.get("name"))
    if nid.startswith("orbat:"):
        return {"id": nid, "type": "unit", "label": ref.get("name"), "group": "actor", "walk": nid}
    n = _get(conn, nid) if not nid.startswith("name:") else None
    return n or {"id": nid, "type": "faction", "label": ref.get("name"), "group": "actor", "walk": None}


def _first(d: dict, *keys):
    for k in keys:
        v = d.get(k)
        if v not in (None, "", []):
            return v
    return None


def record_view(conn, entity_type: str, data: dict) -> dict:
    d = data or {}
    title = str(_first(d, "headline", "title", "name", "label", "summary_en", "summary", "text") or entity_type).strip()[:160]
    text = " ".join(str(_first(d, k) or "") for k in ("headline", "title", "summary_en", "summary", "description", "text"))[:4000]
    rid = str(_first(d, "id", "alert_id", "signal_id", "event_id") or abs(hash(title)) % 10**9)
    root = {"id": f"rec:{entity_type}:{rid}", "type": entity_type, "label": title, "group": group_of(entity_type), "walk": None,
            "lat": _num(d.get("lat")), "lon": _num(d.get("lon") if d.get("lon") is not None else d.get("lng")),
            "props": {k: d.get(k) for k in ("severity", "severity_tier", "place", "posted_at", "created_at", "timestamp") if d.get(k)}}
    nodes, links = [], []

    def add(n, rel, basis, outward=True, conf=1.0):
        nodes.append(n)
        links.append({"src": root["id"] if outward else n["id"], "dst": n["id"] if outward else root["id"],
                      "relation": rel, "conf": conf, "basis": basis})

    act = _first(d, "event_type", "alert_type", "kind", "category", "type")
    if act and str(act).lower() not in (entity_type.lower(), "signal", "unknown"):
        add({"id": f"act:{act}", "type": "act", "label": ACT_LABEL.get(act) or str(act).replace("_", " ").capitalize(),
             "group": "action", "walk": None}, "is a", "how the record was classified")
    place = _first(d, "place", "location_name", "location", "city")
    if isinstance(place, str) and place.strip():
        add({"id": f"place:{place.lower()}", "type": "place", "label": place, "group": "place", "walk": None}, "at", "the record's place")
    cn = _country_node(conn, _first(d, "country_code", "country", "flag", "location_country"))
    if cn:
        add(cn, "in", "the record's country")
    lat, lon = root["lat"], root["lon"]
    if lat is not None and lon is not None:
        c, why = _which_war(conn, d, text, lat, lon)
        if c:
            add({"id": f"conflict:{c['id']}", "type": "conflict", "label": c["name"], "group": "conflict",
                 "walk": f"conflict:{c['id']}"}, "part of", why)
        for n, km in _near(conn, lat, lon):
            add(n, "near", f"{km:.0f} km away", conf=0.9)
    src = _first(d, "channel_title", "source_name", "source", "channel", "provider")
    if isinstance(src, str) and src.strip():
        add({"id": f"source:{src.lower()}", "type": "source", "label": src, "group": "source", "walk": None},
            "reported by", "the record's source", outward=True)
    party = d.get("party")
    if isinstance(party, str) and len(party.strip()) >= 3:
        _, by0 = _actor_matcher(conn)
        ref = by0.get(re.sub(r"-aligned$", "", party.strip(), flags=re.I).lower()) or {"name": party.strip()}
        pn = _actor_node(conn, ref)
        if pn and src:
            rel = "speaks for" if d.get("role") == "official" else "sides with"
            nodes.append(pn)
            links.append({"src": f"source:{src.lower()}", "dst": pn["id"], "relation": rel, "conf": 0.9,
                          "basis": "the channel's affiliation"})
    rx, by = _actor_matcher(conn)
    have = {n["id"] for n in nodes}
    if rx and text.strip():
        seen = set()
        for m in rx.finditer(text):
            n = _actor_node(conn, by.get(m.group(1).lower()) or {})
            if n and n["id"] not in seen and n["id"] not in have:
                seen.add(n["id"])
                add(n, "involves" if n.get("group") == "actor" else "mentions", "named in the text", conf=0.85)
            if len(seen) >= 6:
                break
    op = _first(d, "operator", "owner", "registered_owner", "airline")
    if isinstance(op, str) and len(op.strip()) >= 3:
        oid = _actor_id(conn, op)
        n = _get(conn, oid) if not oid.startswith("name:") else None
        add(n or {"id": oid, "type": "org", "label": op.strip(), "group": "actor", "walk": None}, "operated by", "the registry")
    model = _first(d, "aircraft_type", "model", "type_name", "vessel_type", "ship_type")
    if isinstance(model, str) and model.strip() and model.lower() != str(act or "").lower():
        add({"id": f"model:{model.lower()}", "type": "equipment", "label": model.strip(), "group": "object", "walk": None},
            "is a", "the record's type")
    if d.get("entity_type") == "vessel" and d.get("entity_id"):
        d = {**d, "mmsi": d["entity_id"]}
    for k in ("vessel_mmsi", "mmsi"):
        if d.get(k) and entity_type != "vessel":
            n = _get(conn, f"vessel:{d[k]}")
            if n:
                add(n, "involves", "the vessel in the record")
    out = {"root": root, "nodes": _dedupe(nodes), "links": links}
    units = [n for n in out["nodes"] if n.get("type") in ("faction", "org", "unit")]
    for u in units:
        o = orbat_for(conn, orbat_id=int(u["id"].split(":")[1])) if u["id"].startswith("orbat:") else orbat_for(conn, u["label"])
        if o:
            out["orbat"] = o
            break
    return out


def _which_war(conn, d, text, lat, lon):
    """The war a record belongs to, by the best evidence there is: a
    faction of that war named in it (a Houthi strike on Riyadh is the
    Yemen war, not the nearest war area), then the war tracker's own test
    (inside the area AND about it), then the area alone."""
    try:
        import conflict_context as cc
    except Exception:                                          # noqa: BLE001
        return None, None
    rx, by = _actor_matcher(conn)
    if rx and text.strip():
        for m in rx.finditer(text):
            ref = by.get(m.group(1).lower()) or {}
            if ref.get("conflict"):
                c = next(iter(cc.conflicts(ids={ref["conflict"]})), None)
                if c:
                    return c, f"{ref.get('name')} fights in it (conflict baseline)"
    try:
        c = cc.war_signal({**d, "lat": lat, "lon": lon}, d.get("event_type"))
        if c:
            return c, "inside the war's area and about it"
    except Exception:                                          # noqa: BLE001
        pass
    c = cc.conflict_at(lat, lon)
    return (c, "inside the war's area (conflict baseline)") if c else (None, None)


def _near(conn, lat, lon, km=30.0, n=3):
    dlat = km / 111.0
    dlon = km / max(20.0, 111.0 * math.cos(math.radians(lat)))
    rows = conn.execute("SELECT id, type, label, country, lat, lon, risk, props_json FROM graph_nodes WHERE type = 'facility'"
                        " AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? LIMIT 200",
                        (lat - dlat, lat + dlat, lon - dlon, lon + dlon)).fetchall()
    out = []
    for r in rows:
        dist = _hav(lat, lon, r[4], r[5])
        if dist <= km:
            out.append((_node(r), dist))
    return sorted(out, key=lambda x: x[1])[:n]


def _hav(a, b, c, d):
    p = math.pi / 180
    h = 0.5 - math.cos((c - a) * p) / 2 + math.cos(a * p) * math.cos(c * p) * (1 - math.cos((d - b) * p)) / 2
    return 12742 * math.asin(math.sqrt(max(0.0, h)))


def _num(v):
    try:
        return float(v) if v is not None and v != "" else None
    except (TypeError, ValueError):
        return None


def _dedupe(nodes):
    seen, out = set(), []
    for n in nodes:
        if n["id"] not in seen:
            seen.add(n["id"]); out.append(n)
    return out


# Records the graph holds as nodes, by the sidebar's entity type.
def direct_id(entity_type: str, d: dict) -> str | None:
    if entity_type == "vessel" and (d.get("mmsi") or d.get("MMSI")):
        return f"vessel:{d.get('mmsi') or d.get('MMSI')}"
    if entity_type in ("country", "country_risk") and (d.get("iso2") or (d.get("code") and len(str(d["code"])) == 2)):
        return f"country:{str(d.get('iso2') or d.get('code')).upper()}"
    if entity_type == "cable" and d.get("id"):
        return f"corridor:{d['id']}"
    if entity_type in ("airport",) and (d.get("icao") or d.get("ident")):
        return f"facility:{d.get('icao') or d.get('ident')}"
    return None


def view(db_path: str, *, id: str | None = None, entity_type: str | None = None, data: dict | None = None,
         hops: int = 1) -> dict:
    conn = sqlite3.connect(db_path, timeout=15)
    try:
        if id:
            g = graph_view(conn, id, hops=hops)
            if g:
                return {"available": True, **g}
        if entity_type and data is not None:
            did = direct_id(entity_type, data)
            if not did and entity_type in ("country", "country_risk"):
                cn = _country_node(conn, _first(data, "iso3", "iso_code", "country_name", "country", "name"))
                did = cn["id"] if cn else None
            g = graph_view(conn, did, hops=hops) if did else None
            if g is None and group_of(entity_type) in ("place", "actor", "object"):
                # a named thing: the graph node with exactly its name, if any
                nm = str(_first(data, "name", "label", "vessel_name") or "").strip()
                if len(nm) >= 3:
                    r = conn.execute("SELECT id FROM graph_nodes WHERE label = ? COLLATE NOCASE ORDER BY type = 'country' DESC LIMIT 1",
                                     (nm,)).fetchone()
                    g = graph_view(conn, r[0], hops=hops) if r else None
            if g:
                return {"available": True, **g}
            out = record_view(conn, entity_type, data)
            if hops >= 2:
                # the second ring, for the overlay: what the actors, vessels
                # and facilities named here connect to in turn
                nodes = {n["id"]: n for n in out["nodes"]}
                for n in list(out["nodes"]):
                    if n.get("walk") and not n["walk"].startswith(("conflict:", "orbat:")) and n.get("type") != "country":
                        _ring(conn, n["id"], nodes, out["links"], per_group=3, cap=6, skip_membership=True, exclude={out["root"]["id"]})
                out["nodes"] = list(nodes.values())
            return {"available": True, **out}
        return {"available": False, "nodes": [], "links": []}
    finally:
        conn.close()
