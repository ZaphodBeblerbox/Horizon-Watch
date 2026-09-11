"""
Ingest real conflict-event placemarks and ORBAT data from GeoConfirmed's
public API (https://geoconfirmed.org).

Real API shape, verified live against the production endpoints (2026-09):
  GET /api/Conflict                     -> real theatre list (slug + name)
  GET /api/Placemark/{slug}              -> bulk per-theatre placemark listing,
                                             grouped by faction/icon for display;
                                             each leaf placemark is only
                                             {id, date, la, lo} — cheap, one call
  GET /api/Placemark/detail/{id}         -> real full record: name, description,
                                             date, latitude/longitude, faction,
                                             originalSource, geolocation, origin,
                                             plusCode, orbatUnits (nullable)
  GET /api/Orbat/{slug}                  -> {id, orbatNodeId, ...} — maps a
                                             theatre to its real ORBAT tree root,
                                             or 204 (no body) if the theatre has
                                             no real ORBAT tree at all
  GET /api/OrbatNode/{orbatNodeId}       -> the real, full recursive unit tree

CRITICAL, verified live: "World" is a small curated highlight reel (530 real
pins), NOT the union of every theatre — Ukraine alone carries ~59,977. Every
theatre must be fetched individually; treating World's listing as complete
would silently drop >99% of the real data.

CRITICAL, verified live: the real placemark bulk/detail endpoints carry NO
lastUpdate or version field at all (this contradicts an earlier internal
design brief that assumed one existed — flagged here rather than silently
worked around). Change-detection instead keys on id + date + lat/lon from
the cheap bulk listing: unchanged bulk fields for an already-active row skip
the expensive per-id detail fetch entirely; a new id, a changed bulk field,
or a previously-removed id reappearing all trigger one. Only ORBAT nodes
carry a real lastUpdate field.

Zero Claude/model calls anywhere in this module.
"""
from __future__ import annotations
import datetime
import json
import urllib.request
from typing import Optional

GEOCONFIRMED_BASE = "https://geoconfirmed.org"
HEADERS = {"User-Agent": "NaginiIngest/1.0"}

# Real, verified-live theatre slugs (from GET /api/Conflict on 2026-09-09).
# Not hardcoded as the source of truth — fetch_conflicts() always re-fetches
# the live list; this is only the fallback if that call ever fails.
_FALLBACK_THEATRES = [
    "world", "ukraine", "iran", "ven", "nagorno_karabakh", "africa", "drc",
    "israel", "7oct", "syria", "yemen", "afghanistan", "indpak",
    "thailandcambodia", "pac", "myanmar", "cartel", "wwi", "wwii",
]


# ── Real HTTP layer ───────────────────────────────────────────────────────────

def _get_json(path: str, timeout: int = 30):
    req = urllib.request.Request(f"{GEOCONFIRMED_BASE}{path}", headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
    if not body:
        return None
    return json.loads(body.decode("utf-8"))


def fetch_conflicts() -> list[dict]:
    """Real theatre list. Each item carries at least {url, name}."""
    try:
        data = _get_json("/api/Conflict")
        return data or []
    except Exception as e:
        print(f"[geoconfirmed] fetch_conflicts failed, using fallback list: {e}")
        return [{"url": slug, "name": slug} for slug in _FALLBACK_THEATRES]


def fetch_placemarks_bulk(theatre_slug: str) -> list[dict]:
    """Real bulk per-theatre placemark listing — cheap, single call. Returns a
    flat list of {id, date, la, lo} dicts, flattened out of GeoConfirmed's
    real faction/icon grouping (a display grouping, not load-bearing for
    storage)."""
    data = _get_json(f"/api/Placemark/{theatre_slug}")
    out = []
    for faction in data or []:
        for icon in (faction.get("icons") or []):
            for p in (icon.get("placemarks") or []):
                if p.get("id") and p.get("date") is not None:
                    out.append({"id": p["id"], "date": p["date"], "la": p.get("la"), "lo": p.get("lo")})
    return out


def fetch_placemark_detail(placemark_id: str) -> Optional[dict]:
    return _get_json(f"/api/Placemark/detail/{placemark_id}")


def fetch_orbat_summary(theatre_slug: str) -> Optional[dict]:
    """Real {id, orbatNodeId, name, ...} mapping a theatre to its ORBAT tree
    root, or None if this theatre genuinely has no real ORBAT tree (most
    non-military theatres, e.g. 'cartel', don't — an honest empty result,
    not a failure)."""
    try:
        data = _get_json(f"/api/Orbat/{theatre_slug}")
        return data if data and data.get("orbatNodeId") else None
    except Exception:
        return None


def fetch_orbat_tree(orbat_node_id: int) -> Optional[dict]:
    return _get_json(f"/api/OrbatNode/{orbat_node_id}")


# ── Placemark upsert / delta sync ────────────────────────────────────────────

def _parse_gc_date(date_str: str) -> Optional[datetime.datetime]:
    try:
        return datetime.datetime.fromisoformat(date_str)
    except Exception:
        return None


def upsert_theatre_placemarks(theatre_slug: str, db, *, since_days: int = 90,
                               _fetch_detail=fetch_placemark_detail) -> dict:
    """The real delta-sync core, bounded to a real recent window.

    Real, deliberate scoping decision: GeoConfirmed's bulk listing has no
    server-side date filter, and some theatres carry entire real historical
    archives (Ukraine ~60,000 pins; the 'wwi'/'wwii' theatres go back over a
    century). Detail-fetching every historical placemark on a first sync
    would mean tens of thousands of sequential HTTP calls per theatre — this
    is a live conflict-monitoring map layer, not a historical-archive
    importer, so only placemarks within `since_days` are ever fetched or
    stored. An already-stored placemark that simply ages out of this window
    on a later pass is left untouched (neither refreshed nor soft-deleted —
    the 'vanished' check below only ever compares rows that fall inside
    the CURRENT pass's own window against the current pass's own live ids,
    so an old real pin is never mistaken for a retracted one just because
    this pass didn't re-fetch that far back)."""
    from database import GeoConfirmedPlacemark

    cutoff = datetime.datetime.utcnow() - datetime.timedelta(days=since_days)
    bulk_all = fetch_placemarks_bulk(theatre_slug)
    bulk = []
    for p in bulk_all:
        d = _parse_gc_date(p["date"])
        if d is not None and d >= cutoff:
            bulk.append(p)
    live_ids = {p["id"] for p in bulk}

    existing = {
        row.id: row
        for row in db.query(GeoConfirmedPlacemark)
        .filter(GeoConfirmedPlacemark.theatre_slug == theatre_slug,
                GeoConfirmedPlacemark.date >= cutoff)
        .all()
    }

    inserted = updated = skipped_unchanged = removed = failed = 0

    for p in bulk:
        event_date = _parse_gc_date(p["date"])
        if event_date is None or p.get("la") is None or p.get("lo") is None:
            continue  # no real date/position -> cannot honestly store this pin

        row = existing.get(p["id"])
        unchanged = (
            row is not None
            and row.status == "active"
            and row.date == event_date
            and row.latitude is not None and abs(row.latitude - p["la"]) < 1e-7
            and row.longitude is not None and abs(row.longitude - p["lo"]) < 1e-7
        )
        if unchanged:
            skipped_unchanged += 1
            continue

        try:
            detail = _fetch_detail(p["id"])
        except Exception as e:
            print(f"[geoconfirmed] detail fetch failed for {p['id']}: {e}")
            failed += 1
            continue
        if not detail:
            failed += 1
            continue

        orbat_units = detail.get("orbatUnits") or []
        orbat_id = orbat_units[0]["id"] if orbat_units else None
        orbat_name = orbat_units[0]["name"] if orbat_units else None
        t_end = event_date.replace(hour=23, minute=59, second=59)
        now = datetime.datetime.utcnow()

        if row:
            row.name = detail.get("name")
            row.description = detail.get("description")
            row.date = event_date
            row.date_precision = "day"
            row.t_end = t_end
            row.latitude = p["la"]
            row.longitude = p["lo"]
            row.faction = detail.get("faction")
            row.icon_url = detail.get("icon")
            row.origin = detail.get("origin")
            row.original_source = detail.get("originalSource")
            row.geolocation_source = detail.get("geolocation")
            row.plus_code = detail.get("plusCode")
            row.orbat_node_id = orbat_id
            row.orbat_unit_name = orbat_name
            row.status = "active"
            row.detail_fetched_at = now
            row.updated_at = now
            updated += 1
        else:
            db.add(GeoConfirmedPlacemark(
                id=p["id"], theatre_slug=theatre_slug,
                name=detail.get("name"), description=detail.get("description"),
                date=event_date, date_precision="day", t_end=t_end,
                latitude=p["la"], longitude=p["lo"],
                faction=detail.get("faction"), icon_url=detail.get("icon"),
                origin=detail.get("origin"), original_source=detail.get("originalSource"),
                geolocation_source=detail.get("geolocation"), plus_code=detail.get("plusCode"),
                orbat_node_id=orbat_id, orbat_unit_name=orbat_name,
                status="active", detail_fetched_at=now,
            ))
            inserted += 1

    # Vanished pins -> soft delete only. Never hard-delete: a pin inside an
    # already-generated signals-export date range must stay real and
    # queryable even after GeoConfirmed removes it upstream.
    for pid, row in existing.items():
        if pid not in live_ids and row.status == "active":
            row.status = "removed"
            row.updated_at = datetime.datetime.utcnow()
            removed += 1

    db.commit()
    return {
        "theatre": theatre_slug, "live_count_all_time": len(bulk_all),
        "live_count_in_window": len(bulk), "since_days": since_days,
        "inserted": inserted, "updated": updated,
        "skipped_unchanged": skipped_unchanged, "removed": removed, "failed": failed,
    }


# ── ORBAT tree upsert ─────────────────────────────────────────────────────────

def _flatten_orbat_tree(node: dict, theatre_slug: str, parent_id: Optional[int] = None) -> list[dict]:
    rows = []
    nid = node.get("id")
    if nid is None:
        return rows
    rows.append({
        "id": nid, "parent_id": parent_id, "theatre_slug": theatre_slug,
        "name": node.get("name") or f"Unit {nid}",
        "is_deleted": bool(node.get("isDeleted")),
        "is_disbanded": bool(node.get("isDisbanded")),
        "color": node.get("color"),
        "source_last_update": node.get("lastUpdate"),
    })
    for child in (node.get("children") or []):
        rows.extend(_flatten_orbat_tree(child, theatre_slug, parent_id=nid))
    return rows


def _structure_path(node_id: int, by_id: dict) -> Optional[str]:
    """Real breadcrumb string (immediate parent first), matching the format
    GeoConfirmed's own orbatUnits[].structure carries on placemark detail."""
    parts = []
    seen = set()
    cur_id = by_id.get(node_id, {}).get("parent_id")
    while cur_id is not None and cur_id not in seen and cur_id in by_id:
        seen.add(cur_id)
        parts.append(by_id[cur_id]["name"])
        cur_id = by_id[cur_id]["parent_id"]
    return " ▸ ".join(parts) if parts else None


def upsert_orbat_tree(theatre_slug: str, db) -> dict:
    from database import GeoConfirmedOrbatNode

    summary = fetch_orbat_summary(theatre_slug)
    if not summary:
        return {"theatre": theatre_slug, "orbat": False}

    tree = fetch_orbat_tree(summary["orbatNodeId"])
    if not tree:
        return {"theatre": theatre_slug, "orbat": False}

    flat = _flatten_orbat_tree(tree, theatre_slug)
    by_id = {r["id"]: r for r in flat}

    existing = {row.id: row for row in db.query(GeoConfirmedOrbatNode).filter(
        GeoConfirmedOrbatNode.theatre_slug == theatre_slug
    ).all()}

    inserted = updated = 0
    now = datetime.datetime.utcnow()
    for r in flat:
        struct = _structure_path(r["id"], by_id)
        last_update = _parse_gc_date(r["source_last_update"]) if r["source_last_update"] else None
        row = existing.get(r["id"])
        if row:
            row.parent_id = r["parent_id"]
            row.name = r["name"]
            row.structure_path = struct
            row.is_deleted = r["is_deleted"]
            row.is_disbanded = r["is_disbanded"]
            row.color = r["color"]
            row.source_last_update = last_update
            row.updated_at = now
            updated += 1
        else:
            db.add(GeoConfirmedOrbatNode(
                id=r["id"], parent_id=r["parent_id"], theatre_slug=theatre_slug,
                name=r["name"], structure_path=struct, is_deleted=r["is_deleted"],
                is_disbanded=r["is_disbanded"], color=r["color"], source_last_update=last_update,
            ))
            inserted += 1

    db.commit()
    return {"theatre": theatre_slug, "orbat": True, "nodes": len(flat), "inserted": inserted, "updated": updated}


# ── Real-evidence-only linking to existing tracked entities ─────────────────

def link_orbat_to_existing_entities(db, *, min_name_len: int = 9) -> dict:
    """Real-evidence-only linking: an ORBAT unit name that exact-matches
    (case-insensitive) an existing OntologyEntity or SanctionedEntity name,
    long enough not to be a generic word (mirrors sanctions_loader.py's own
    fuzzy-name floor — that module explicitly discards short/generic name
    matches as unreliable), is NEVER auto-merged. It is queued as a pending
    OntologyClaim for a human to confirm or reject — the exact review gate
    this app already uses for every other entity-relationship claim. No
    hard identifier bridges an ORBAT unit to LEI/IMO/MMSI (military units
    are neither legal entities nor vessels), so a name match plus human
    review is the strongest honest path available; anything short of an
    exact name match is not even queued."""
    from database import GeoConfirmedOrbatNode, OntologyEntity, SanctionedEntity
    from routers.forge import _create_ontology_claims

    candidates = db.query(GeoConfirmedOrbatNode).filter(
        GeoConfirmedOrbatNode.link_status.is_(None),
        GeoConfirmedOrbatNode.is_deleted.is_(False),
    ).all()

    onto_by_name = {e.name.strip().lower(): e.system_id for e in db.query(OntologyEntity).all() if e.name}
    sanc_by_name = {}
    for s in db.query(SanctionedEntity).all():
        if s.entity_name:
            sanc_by_name.setdefault(s.entity_name.strip().lower(), s.entity_name)

    checked = flagged = 0
    for node in candidates:
        name = (node.name or "").strip()
        checked += 1
        if len(name) < min_name_len:
            continue  # too short/generic to evidence anything on name alone
        key = name.lower()
        onto_match = onto_by_name.get(key)
        sanc_match = sanc_by_name.get(key)
        if not onto_match and not sanc_match:
            continue

        result = _create_ontology_claims([{
            "entity_a": f"GeoConfirmed ORBAT: {name}",
            "entity_a_type": "orbat_unit",
            "relationship_type": "possible_same_as",
            "entity_b": onto_match or sanc_match,
            "entity_b_type": "sanctioned_entity" if sanc_match else "ontology_entity",
            "confidence": "inferred",
            "source_title": "GeoConfirmed ORBAT",
            "source_url": f"https://geoconfirmed.org/orbat/{node.theatre_slug}",
            "evidence": (
                f"Exact case-insensitive name match between GeoConfirmed ORBAT unit "
                f"'{name}' (GeoConfirmed node id {node.id}) and existing tracked entity "
                f"'{onto_match or sanc_match}'. Name match alone is not treated as proof of "
                f"identity — flagged for human confirmation, never auto-merged."
            ),
        }])
        node.link_status = "pending_review"
        if result.get("created", 0) > 0:
            flagged += 1

    db.commit()
    return {"checked": checked, "flagged": flagged}


# ── Orchestration ─────────────────────────────────────────────────────────────

def run_ingest(db=None, theatres: Optional[list[str]] = None, since_days: int = 90) -> dict:
    """Programmatic entry point. `theatres` overrides the real live theatre
    list — used by tests to sync a tiny theatre instead of Ukraine's ~60k
    placemarks. `since_days` bounds how far back placemarks are fetched/
    stored (see upsert_theatre_placemarks' docstring). Real network calls;
    no mock data path exists."""
    from database import SessionLocal as _SL
    own = db is None
    if own:
        db = _SL()
    try:
        if theatres is None:
            theatres = [c["url"] for c in fetch_conflicts() if c.get("url")]

        placemark_stats = []
        orbat_stats = []
        for slug in theatres:
            try:
                placemark_stats.append(upsert_theatre_placemarks(slug, db, since_days=since_days))
            except Exception as e:
                print(f"[geoconfirmed] placemark sync failed for theatre={slug}: {e}")
            try:
                orbat_stats.append(upsert_orbat_tree(slug, db))
            except Exception as e:
                print(f"[geoconfirmed] orbat sync failed for theatre={slug}: {e}")

        link_stats = link_orbat_to_existing_entities(db)
        return {"theatres": theatres, "placemarks": placemark_stats, "orbat": orbat_stats, "linking": link_stats}
    finally:
        if own:
            db.close()


if __name__ == "__main__":
    import os
    import sys
    sys.path.insert(0, os.path.dirname(__file__))
    os.environ.setdefault("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
    from database import Base, engine, migrate_db

    migrate_db()
    Base.metadata.create_all(bind=engine)
    stats = run_ingest()
    print(json.dumps(stats, indent=2, default=str))
