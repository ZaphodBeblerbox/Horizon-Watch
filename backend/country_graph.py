"""
country_graph.py — one graph per country, instead of one graph for everything.

WHY THE ONTOLOGY LOOKED EMPTY. There were two of them. The Ontology page
renders the Forge JSON store curated to 40 nodes a tier — about 160 nodes
— while ontology_entities holds 50,686 rows and ontology_links 502,473.
The page was not showing a sparse ontology; it was showing a different,
much smaller one.

ONE GRAPH FOR THE WORLD CANNOT BE BOTH COMPLETE AND LEGIBLE. Fifty
thousand nodes is a hairball at any zoom, so the only way to show
everything was to show almost nothing. Scoped to a country, "everything"
is a few hundred nodes: its airports, ports, hospitals, bases, police
stations, the events reported there, and the factions holding ground in
it. That is a graph a person can actually read, and nothing has to be
left out to make it readable.

PROXIMITY IS A REAL RELATIONSHIP. A shooting reported two hundred metres
from a barracks is a different event from the same shooting in a
suburb, and until now nothing in this system could express that — the
event and the barracks were unconnected rows. Every event here is linked
to the fixed things near it, with the distance on the edge, so the reader
can judge the coincidence rather than being told it matters.

FOREIGN KEYS, NOT COPIES. A vessel, a cable or a neighbouring country's
faction belongs to its own graph; here it appears as an edge that names
the other country. Copying it in would duplicate the entity and make two
graphs disagree about the same thing.
"""
from __future__ import annotations

import json
import math

# The Ontology page draws four fixed tiers and speaks a specific node and
# link shape. Emitting a different one is how the first cut of this threw
# on load: nodes with no `tier` indexed an array at undefined, and links
# named source/target where the renderer reads s/t. The page is the
# consumer, so the page's vocabulary wins.
TIER = {
    "country": 0, "corridor": 0,       # Geography
    "faction": 1, "org": 1,            # Actors
    "facility": 2, "airport": 2, "port": 2, "power": 2,   # Assets & sites
    "event": 3,                        # Observations
}

# Rough salience, so the tier sort has something to order by. A confirmed
# incident outranks a machine-coded report; a base outranks a clinic only
# in the sense that it is rarer, not that it matters more.
RISK = {"event": 55, "faction": 60, "facility": 40,
        "airport": 35, "port": 35, "power": 30}

# How near a fixed thing has to be before an event is said to be "at" it.
# 2km is a walk: close enough that a reporter naming the district and a
# mapper naming the building are plausibly describing one place.
PROXIMITY_KM = 2.0

# Beyond this a country graph stops being legible again, which is the
# whole reason for scoping. Reported when it bites rather than silently
# truncating.
MAX_NODES = 1200


def haversine_km(a_lat, a_lon, b_lat, b_lon) -> float:
    R = 6371.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp = math.radians(b_lat - a_lat)
    dl = math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def _bbox_of(iso3: str) -> tuple | None:
    """A country's rough extent, derived from data rather than declared.

    Deliberately crude: this is a scoping filter, not a boundary. A
    facility a few kilometres outside the line is still context for the
    country, and excluding it would be the worse error.

    THREE SOURCES, IN ORDER OF HOW WELL THEY KNOW THE COUNTRY. The first
    cut used only strategic-zone names, which meant Yemen — with 1,270
    mapped control points — had no extent at all, because this system
    happens not to keep a Yemen zone. Scoping a country by whether we
    drew a box around it is scoping by our own bookkeeping.
    """
    import country_codes as cc
    iso2 = cc.ISO3_TO_ISO2.get(iso3)
    if not iso2:
        return None

    # 1. A war map's own control points: the tightest real extent there is.
    try:
        import wiki_warmaps as wm
        theatre_for = {"YE": "yemen", "SD": "sudan", "SY": "syria",
                       "LB": "lebanon", "MM": "myanmar", "LY": "libya",
                       "SO": "somalia", "ML": "mali"}
        key = theatre_for.get(iso2)
        if key:
            d = wm.fetch(key)
            pts = d.get("points") or []
            if pts:
                lats = [p["lat"] for p in pts]
                lons = [p["lon"] for p in pts]
                pad = 0.3
                return (min(lats) - pad, min(lons) - pad,
                        max(lats) + pad, max(lons) + pad)
    except Exception:                                       # noqa: BLE001
        pass

    # 2a. Zones this system named after the conflict rather than the
    #     country. "Gaza Strip" does not contain "Palestine", so a name
    #     match alone loses the most-watched place on the map.
    ZONE_ALIAS = {"PS": "gaza", "IR": "iranian", "KP": "korean",
                  "KR": "korean", "TW": "taiwan", "ET": "ethiopia",
                  "VE": "venezuela"}
    alias = ZONE_ALIAS.get(iso2)
    if alias:
        try:
            from database import StrategicZone, get_db
            with get_db() as db:
                for z in db.query(StrategicZone).all():
                    if alias in (z.name or "").lower() and None not in (
                            z.bbox_min_lat, z.bbox_min_lon,
                            z.bbox_max_lat, z.bbox_max_lon):
                        return (z.bbox_min_lat, z.bbox_min_lon,
                                z.bbox_max_lat, z.bbox_max_lon)
        except Exception:                                   # noqa: BLE001
            pass

    # 2. A strategic zone whose name contains the country's.
    try:
        import country_registry
        name = (getattr(country_registry, "_ISO_TO_NAME", {}).get(iso2) or "").lower()
    except Exception:                                       # noqa: BLE001
        name = ""
    if name:
        try:
            from database import StrategicZone, get_db
            with get_db() as db:
                for z in db.query(StrategicZone).all():
                    if name in (z.name or "").lower() and None not in (
                            z.bbox_min_lat, z.bbox_min_lon,
                            z.bbox_max_lat, z.bbox_max_lon):
                        return (z.bbox_min_lat, z.bbox_min_lon,
                                z.bbox_max_lat, z.bbox_max_lon)
        except Exception:                                   # noqa: BLE001
            pass

    # 3. The country's own power plants, which carry a country name and
    #    are spread widely enough to bound it.
    if name:
        try:
            from main import _STATIC_POWERPLANTS
        except ImportError:
            try:
                from backend.main import _STATIC_POWERPLANTS
            except Exception:                               # noqa: BLE001
                _STATIC_POWERPLANTS = []
        pts = [r for r in _STATIC_POWERPLANTS
               if name in (r.get("country") or "").lower()]
        if len(pts) >= 3:
            lats = [r["lat"] for r in pts]
            lons = [r["lon"] for r in pts]
            pad = 0.3
            return (min(lats) - pad, min(lons) - pad,
                    max(lats) + pad, max(lons) + pad)
    return None


def _node(nid, ntype, label, *, subtype=None, lat=None, lon=None,
          kind=None, source=None, url=None, risk=None) -> dict:
    """A node in the shape the Ontology renderer already reads."""
    return {
        "id": nid, "type": ntype, "label": label or ntype,
        "tier": TIER.get(ntype, 3),
        "risk": risk if risk is not None else RISK.get(ntype, 30),
        "lat": lat, "lon": lon, "manual": False,
        "props": {k: str(v) for k, v in
                  {"subtype": subtype, "kind": kind,
                   "source": source, "url": url}.items() if v},
    }


def _in_bbox(lat, lon, bbox) -> bool:
    if lat is None or lon is None or not bbox:
        return False
    s, w, n, e = bbox
    return s <= lat <= n and w <= lon <= e


# ── the fixed things ─────────────────────────────────────────────────────

def _facilities(iso3: str, bbox) -> list[dict]:
    """Bases, hospitals and police stations, from the ontology."""
    from database import OntologyEntity, get_db
    import infra_entities as ie
    out = []
    types = list(ie.ENTITY_TYPE.values())
    with get_db() as db:
        for r in db.query(OntologyEntity).filter(
                OntologyEntity.entity_type.in_(types)).limit(20000).all():
            try:
                m = json.loads(r.entity_metadata or "{}")
            except Exception:                               # noqa: BLE001
                continue
            if not _in_bbox(m.get("lat"), m.get("lon"), bbox):
                continue
            out.append(_node(r.system_id, "facility", r.name,
                              subtype=r.infra_type, lat=m["lat"], lon=m["lon"],
                              kind=r.entity_type, source=m.get("source")))
    return out


def _static_infra(iso3: str, bbox) -> list[dict]:
    """Airports, ports and power plants already loaded at startup.

    These have been in memory since boot and were never entities. A
    country's airfields and ports are the first thing anyone asks about
    it, so leaving them out was most of why the graph felt thin.
    """
    try:
        from main import _STATIC_AIRPORTS, _STATIC_PORTS, _STATIC_POWERPLANTS
    except ImportError:
        from backend.main import (_STATIC_AIRPORTS, _STATIC_PORTS,
                                  _STATIC_POWERPLANTS)
    out = []
    for rows, typ in ((_STATIC_AIRPORTS, "airport"),
                      (_STATIC_PORTS, "port"),
                      (_STATIC_POWERPLANTS, "power")):
        for r in rows:
            if not _in_bbox(r.get("lat"), r.get("lon"), bbox):
                continue
            out.append(_node(r["id"], typ, r.get("name") or typ,
                              subtype=r.get("subcategory"),
                              lat=r["lat"], lon=r["lon"],
                              kind=typ, source="static roster"))
    return out


# ── the things that happen ───────────────────────────────────────────────

def _events(iso3: str, bbox, hours: int) -> list[dict]:
    """Reported and confirmed incidents inside the country."""
    import datetime as dt
    out = []
    cutoff = (dt.datetime.now(dt.timezone.utc)
              - dt.timedelta(hours=hours))

    try:
        import gdelt_events as ge
        for pin in ge.map_points(ge.EVENTS_CACHE.get("events") or []):
            if not _in_bbox(pin.get("lat"), pin.get("lon"), bbox):
                continue
            out.append(_node(f"gdelt-{pin['id']}", "event", pin["title"][:120],
                              subtype=pin.get("event_type"),
                              lat=pin["lat"], lon=pin["lon"],
                              kind="Reported event", source="GDELT",
                              url=pin.get("source_url")))
    except Exception as ex:                                 # noqa: BLE001
        print(f"[country-graph] gdelt: {type(ex).__name__}: {ex}")

    try:
        from database import GeoConfirmedPlacemark, get_db
        with get_db() as db:
            rows = (db.query(GeoConfirmedPlacemark)
                      .filter(GeoConfirmedPlacemark.status == "active",
                              GeoConfirmedPlacemark.date >= cutoff.replace(tzinfo=None))
                      .limit(3000).all())
            for p in rows:
                if not _in_bbox(p.latitude, p.longitude, bbox):
                    continue
                out.append(_node(f"gc-{p.id}", "event",
                                  (p.title or "Confirmed incident")[:120],
                                  subtype="confirmed",
                                  lat=float(p.latitude), lon=float(p.longitude),
                                  kind="Confirmed incident",
                                  source="GeoConfirmed", risk=70))
    except Exception as ex:                                 # noqa: BLE001
        print(f"[country-graph] geoconfirmed: {type(ex).__name__}: {ex}")

    return out


def _factions(iso3: str) -> list[dict]:
    """Who holds ground here, including non-state and proscribed groups.

    These were known only as a colour on a control map. A faction is an
    actor — it holds terrain, it takes towns, it is named in reporting —
    and it belongs in the graph as an entity that those things can link to.
    """
    import wiki_warmaps as wm
    import country_codes as cc
    iso2 = (cc.ISO3_TO_ISO2.get(iso3) or "").lower()
    theatre_for = {"ye": "yemen", "sd": "sudan", "sy": "syria",
                   "lb": "lebanon", "mm": "myanmar", "ly": "libya",
                   "so": "somalia", "ml": "mali"}
    key = theatre_for.get(iso2)
    if not key:
        return []
    try:
        d = wm.fetch(key)
    except Exception:                                       # noqa: BLE001
        return []
    if not d.get("available"):
        return []
    out = []
    for colour, name in (d.get("legend") or {}).items():
        out.append(_node(f"faction-{key}-{colour}", "faction", name,
                          subtype=colour, kind="Faction",
                          source=d.get("source")))
    return out


# ── what connects to what ────────────────────────────────────────────────

def proximity_links(events: list[dict], fixed: list[dict],
                    radius_km: float = PROXIMITY_KM) -> list[dict]:
    """Every event joined to the fixed things near it.

    THE LINK THIS SYSTEM WAS MISSING. "A news point is more important if
    it happened next to a military base" — and nothing could express
    that, because the event and the base were unrelated rows in unrelated
    tables. The distance rides on the edge so a reader judges the
    coincidence instead of being told it means something.

    Naive O(n*m), deliberately: a country graph is a few hundred events
    against a few thousand fixed points, which is milliseconds. A spatial
    index here would be complexity bought for a cost that does not exist.
    """
    out = []
    located = [f for f in fixed
               if f.get("lat") is not None and f.get("lon") is not None]
    for ev in events:
        if ev.get("lat") is None or ev.get("lon") is None:
            continue
        for f in located:
            d = haversine_km(ev["lat"], ev["lon"], f["lat"], f["lon"])
            if d > radius_km:
                continue
            out.append({
                "id": f"near_{ev['id']}_{f['id']}",
                "s": ev["id"], "t": f["id"],
                "kind": "near",
                "conf": round(max(0.2, 1.0 - d / max(radius_km, 0.1)), 2),
                "label": f"{d:.1f} km from {f['props'].get('subtype') or f['type']}",
                "distance_km": round(d, 2),
                "inferred": True,
                # Said explicitly: nearness is not causation, and a graph
                # that draws an edge is easily read as asserting one.
                "note": "co-location only — proximity is not attribution",
            })
    return out


def faction_links(events: list[dict], factions: list[dict]) -> list[dict]:
    """Events tied to a faction named in their own text.

    Only when the faction's name actually appears — an event inside a
    faction's territory is not thereby that faction's doing, and
    inferring it from geography would manufacture attributions this
    system has no basis for.
    """
    out = []
    for f in factions:
        name = (f.get("label") or "").lower()
        if len(name) < 4:
            continue
        # The distinctive part: "Houthi (Ansar Allah)" should match on
        # "Houthi" without also matching every mention of "allah".
        head = name.split("(")[0].strip()
        if len(head) < 4:
            continue
        for ev in events:
            if head in (ev.get("label") or "").lower():
                out.append({"id": f"names_{ev['id']}_{f['id']}",
                            "s": ev["id"], "t": f["id"],
                            "kind": "names", "conf": 0.8, "inferred": False,
                            "label": "named in the report",
                            "note": "the faction is named in the text, "
                                    "not inferred from where it happened"})
    return out


def build(iso3: str, hours: int = 168, radius_km: float = PROXIMITY_KM) -> dict:
    """One country's graph. Never raises."""
    iso3 = (iso3 or "").upper()
    bbox = _bbox_of(iso3)
    if not bbox:
        return {"available": False, "iso3": iso3, "nodes": [], "links": [],
                "error": ("no extent known for this country — country graphs "
                          "are scoped by the strategic zones this system "
                          "watches, and this one is not among them")}

    fixed = _facilities(iso3, bbox) + _static_infra(iso3, bbox)
    events = _events(iso3, bbox, hours)
    factions = _factions(iso3)

    # The country itself, so the Geography tier is never empty and
    # everything in the graph has something to hang from. Without it a
    # country graph opens with two blank bands and reads as broken.
    import country_codes as cc
    iso2 = cc.ISO3_TO_ISO2.get(iso3) or iso3
    try:
        import country_registry
        cname = (getattr(country_registry, "_ISO_TO_NAME", {}).get(iso2)
                 or iso3)
    except Exception:                                       # noqa: BLE001
        cname = iso3
    country_node = _node(f"country_{iso2}", "country", cname,
                         kind="Country", source="country registry", risk=50)

    links = proximity_links(events, fixed, radius_km)
    links += faction_links(events, factions)
    # Factions and events are IN the country; fixed sites reach it through
    # whatever they are linked to, so the country does not become a hub
    # that every node touches and the layout stays readable.
    for f in factions:
        links.append({"id": f"in_{f['id']}", "s": f["id"],
                      "t": country_node["id"], "kind": "operates_in",
                      "conf": 0.9, "inferred": False,
                      "label": "holds ground in"})
    for ev in events:
        links.append({"id": f"in_{ev['id']}", "s": ev["id"],
                      "t": country_node["id"], "kind": "reported_in",
                      "conf": 0.7, "inferred": True,
                      "label": "reported in"})

    # Only fixed things that something actually connects to, plus events
    # and factions. A country's 4,000 unconnected airports are true and
    # useless here; the graph is for relationships.
    linked_ids = {l["t"] for l in links} | {l["s"] for l in links}
    kept_fixed = [f for f in fixed if f["id"] in linked_ids]
    nodes = [country_node] + events + factions + kept_fixed

    truncated = False
    if len(nodes) > MAX_NODES:
        nodes = nodes[:MAX_NODES]
        keep = {n["id"] for n in nodes}
        links = [l for l in links
                 if l["s"] in keep and l["t"] in keep]
        truncated = True

    from collections import Counter
    return {
        "available": bool(nodes),
        "iso3": iso3,
        "bbox": bbox,
        "window_hours": hours,
        "proximity_km": radius_km,
        "nodes": nodes,
        "links": links,
        # The renderer draws four fixed tiers and labels them from here.
        "tier_names": ["Geography", "Actors", "Assets & sites", "Observations"],
        "type_counts": dict(Counter(n["type"] for n in nodes)),
        "total_real_nodes": len(nodes),
        "total_real_links": len(links),
        "counts": {
            "nodes": len(nodes), "links": len(links),
            "by_type": dict(Counter(n["type"] for n in nodes)),
            "fixed_in_country": len(fixed),
            "fixed_linked": len(kept_fixed),
        },
        "truncated": truncated,
        "note": ("fixed infrastructure appears only where something links to "
                 "it — every airport in the country is true and tells you "
                 "nothing; the graph is for relationships"),
        "error": None,
    }
