"""
infra_entities.py — the fixed things worth knowing about, as entities.

WHY THE ONTOLOGY NEEDED THIS. 50,686 entities, of which 49,260 are
airports. Not one hospital, police station or military base; no ports or
power plants either, despite 3,807 and 34,936 of them sitting in memory
at startup. An ontology that is 97% one category is a database of that
category with some decoration, which is what "doesn't notice enough
entities" means in practice.

THE QUERIES ALREADY EXISTED. main.py has carried _INFRA_QUERIES — with
military, medical and security categories spelled out — referenced from
nowhere. The work was written and never wired, so this is less a new
capability than a connection that was never made.

SCOPED TO THE ZONES BEING WATCHED, not the globe. A worldwide hospital
query is tens of millions of nodes and would be refused, slowly. Every
one of these is fetched inside a strategic zone's bounding box, which is
also the honest scope: a clinic in Gaza is context for what this system
watches, and a clinic in Lisbon is not.

WHAT A FACILITY IS AND IS NOT. These are OpenStreetMap features —
crowd-mapped, unevenly complete, and current as of whenever a mapper
last looked. A missing hospital means nobody mapped it, never that there
is no hospital. Every record says so, because the failure mode here is a
planner concluding an area has no medical capacity.
"""
from __future__ import annotations

import time

# OSM tag selectors per category. Kept close to main.py's long-dead
# _INFRA_QUERIES so the vocabulary does not fork.
CATEGORIES: dict[str, dict] = {
    "military": {
        "label": "Military",
        "selectors": ['node["military"]', 'way["military"]'],
        "kinds": ("base", "barracks", "checkpoint", "bunker", "training_area",
                  "naval_base", "airfield", "danger_area", "range", "depot"),
    },
    "medical": {
        "label": "Medical",
        "selectors": ['node["amenity"~"^(hospital|clinic|doctors)$"]',
                      'way["amenity"~"^(hospital|clinic)$"]'],
        "kinds": ("hospital", "clinic", "doctors"),
    },
    "security": {
        "label": "Police & fire",
        "selectors": ['node["amenity"~"^(police|fire_station)$"]',
                      'way["amenity"~"^(police|fire_station)$"]'],
        "kinds": ("police", "fire_station"),
    },
}

# Per zone, per pass. Overpass will happily start returning a hundred
# thousand nodes for the Sahel and then time out, which yields nothing at
# all — a bounded answer beats an unbounded failure.
DEFAULT_CAP = 800

_CACHE: dict = {}
_CACHE_TTL = 7 * 24 * 3600      # a hospital does not move

CAVEAT = ("OpenStreetMap, crowd-mapped and unevenly complete — a missing "
          "facility means nobody mapped it, not that none exists")


def build_query(bbox: tuple, categories: list[str] | None = None,
                cap: int = DEFAULT_CAP) -> str:
    """One Overpass query for every requested category in a bbox."""
    s, w, n, e = bbox
    bb = f"{s},{w},{n},{e}"
    parts = []
    for key in (categories or list(CATEGORIES)):
        spec = CATEGORIES.get(key)
        if not spec:
            continue
        for sel in spec["selectors"]:
            parts.append(f"{sel}({bb});")
    # `out center` so a way (a hospital campus) still yields one point.
    return f"[out:json][timeout:90];({''.join(parts)});out center {cap};"


def _kind_of(tags: dict) -> tuple[str | None, str | None]:
    """(category, kind) for an OSM element, or (None, None) to skip."""
    mil = (tags.get("military") or "").strip().lower()
    if mil:
        return ("military", mil)
    am = (tags.get("amenity") or "").strip().lower()
    for key, spec in CATEGORIES.items():
        if am in spec["kinds"]:
            return (key, am)
    return (None, None)


def normalise(element: dict, zone_id: str | None = None) -> dict | None:
    tags = element.get("tags") or {}
    cat, kind = _kind_of(tags)
    if not cat:
        return None
    lat = element.get("lat")
    lon = element.get("lon")
    if lat is None or lon is None:
        centre = element.get("center") or {}
        lat, lon = centre.get("lat"), centre.get("lon")
    if lat is None or lon is None:
        return None
    osm_id = f"{element.get('type', 'node')}/{element.get('id')}"
    return {
        "system_id": f"OSM-{element.get('type','n')[0].upper()}{element.get('id')}",
        "osm_id": osm_id,
        "name": tags.get("name") or tags.get("official_name") or None,
        "category": cat,
        "kind": kind,
        "lat": float(lat), "lon": float(lon),
        "operator": tags.get("operator"),
        "zone_id": zone_id,
        "source": "OpenStreetMap",
        "source_url": f"https://www.openstreetmap.org/{osm_id}",
    }


def fetch_zone(bbox: tuple, zone_id: str | None = None,
               categories: list[str] | None = None,
               cap: int = DEFAULT_CAP, force: bool = False) -> dict:
    """Facilities inside one bounding box. Never raises."""
    key = f"{zone_id or bbox}:{','.join(categories or sorted(CATEGORIES))}:{cap}"
    hit = _CACHE.get(key)
    if hit and not force and time.time() - hit["ts"] < _CACHE_TTL:
        return hit["data"]

    try:
        from main import _fetch_overpass
    except ImportError:
        from backend.main import _fetch_overpass

    try:
        raw = _fetch_overpass(build_query(bbox, categories, cap))
    except Exception as ex:                                 # noqa: BLE001
        return {"available": False, "error": f"{type(ex).__name__}: {ex}",
                "facilities": [], "zone_id": zone_id}

    seen, out = set(), []
    for el in raw.get("elements") or []:
        rec = normalise(el, zone_id)
        if not rec or rec["system_id"] in seen:
            continue
        seen.add(rec["system_id"])
        out.append(rec)

    from collections import Counter
    data = {
        "available": bool(out),
        "zone_id": zone_id,
        "facilities": out,
        "count": len(out),
        "by_category": dict(Counter(f["category"] for f in out)),
        "by_kind": dict(Counter(f["kind"] for f in out).most_common(12)),
        # Said plainly: a capped result is a partial answer, and a reader
        # must not read "800 hospitals" as "all the hospitals".
        "capped": len(out) >= cap,
        "caveat": CAVEAT,
        "source": "OpenStreetMap",
        "error": None,
    }
    _CACHE[key] = {"ts": time.time(), "data": data}
    return data


ENTITY_TYPE = {
    "military": "Military Facility",
    "medical": "Medical Facility",
    "security": "Security Facility",
}


def to_ontology_rows(facilities: list[dict]) -> list[dict]:
    """Facilities as ontology_entities rows.

    Unnamed features are kept — an unnamed bunker at a known coordinate
    is still a fact about the ground, and dropping it would quietly make
    the map look emptier than the data is. It is labelled by kind and
    place instead of being given an invented name.
    """
    import json as _j
    rows = []
    for f in facilities:
        name = f["name"] or f"{f['kind'].replace('_', ' ')} (unnamed)"
        rows.append({
            "system_id": f["system_id"],
            "entity_type": ENTITY_TYPE.get(f["category"], "Facility"),
            "name": name,
            "infra_type": f["kind"],
            "region_id": f.get("zone_id"),
            "entity_metadata": _j.dumps({
                "lat": f["lat"], "lon": f["lon"],
                "operator": f.get("operator"),
                "osm_id": f["osm_id"],
                "source": f["source"],
                "source_url": f["source_url"],
                "named": bool(f["name"]),
                "caveat": CAVEAT,
            }),
        })
    return rows


def persist(rows: list[dict]) -> dict:
    """Upsert into ontology_entities. Returns counts, never raises."""
    written = skipped = 0
    try:
        from database import OntologyEntity, get_db
    except Exception as ex:                                 # noqa: BLE001
        return {"written": 0, "skipped": 0, "error": str(ex)}
    try:
        with get_db() as db:
            for r in rows:
                exists = (db.query(OntologyEntity)
                            .filter(OntologyEntity.system_id == r["system_id"])
                            .first())
                if exists:
                    skipped += 1
                    continue
                db.add(OntologyEntity(**r))
                written += 1
            db.commit()
    except Exception as ex:                                 # noqa: BLE001
        return {"written": written, "skipped": skipped, "error": str(ex)}
    return {"written": written, "skipped": skipped, "error": None}
