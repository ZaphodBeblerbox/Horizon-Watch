"""
Ingest TeleGeography submarine cable and landing point data.

Usage (from backend/ directory):
    python ingest_cables.py

Sources:
    Cable geometry  : https://submarinecablemap.com/api/v3/cable/cable-geo.json
    Cable metadata  : https://submarinecablemap.com/api/v3/cable/{cable_id}.json
    Landing points  : https://submarinecablemap.com/api/v3/landing-point/landing-point-geo.json
"""

import os, sys, json, math, urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))

from database import (
    Base, CableSegment, LandingPoint,
    RegionDefinition, OntologyEntity,
    SessionLocal, engine, migrate_db,
)

GEO_URL        = "https://submarinecablemap.com/api/v3/cable/cable-geo.json"
LP_GEO_URL     = "https://submarinecablemap.com/api/v3/landing-point/landing-point-geo.json"
CABLE_DETAIL   = "https://submarinecablemap.com/api/v3/cable/{cable_id}.json"
HEADERS        = {"User-Agent": "NaginiIngest/1.0"}
WORKERS        = 25

# ── Region definitions ────────────────────────────────────────────────────────

REGION_DEFS = [
    ("REG-ARCTIC",  "Arctic",               "Arctic Ocean and surrounding areas above 66°N"),
    ("REG-NORSEA",  "North Sea / Baltic",   "North Sea, Baltic Sea, and Norwegian coast"),
    ("REG-MED",     "Mediterranean",        "Mediterranean Sea and Black Sea"),
    ("REG-REDSEA",  "Red Sea / Gulf",       "Red Sea, Persian Gulf, and Gulf of Aden"),
    ("REG-SEASIA",  "Southeast Asia",       "Southeast Asian waters including South China Sea"),
    ("REG-CARIB",   "Caribbean",            "Caribbean Sea and Gulf of Mexico"),
    ("REG-ATL-N",   "North Atlantic",       "North Atlantic Ocean"),
    ("REG-ATL-S",   "South Atlantic",       "South Atlantic Ocean"),
    ("REG-IND",     "Indian Ocean",         "Indian Ocean"),
    ("REG-PAC-N",   "North Pacific",        "North Pacific Ocean"),
    ("REG-PAC-S",   "South Pacific",        "South Pacific Ocean"),
]

# Priority-ordered bounding-box checks.
# First match wins — specific regions before broad ones.
def _region_for_point(lat: float, lon: float) -> str:
    if lat > 66:
        return "REG-ARCTIC"
    if 50 <= lat <= 72 and -10 <= lon <= 32:
        return "REG-NORSEA"
    if 30 <= lat <= 47 and -6 <= lon <= 42:
        return "REG-MED"
    if 10 <= lat <= 32 and 32 <= lon <= 65:
        return "REG-REDSEA"
    if -10 <= lat <= 25 and 95 <= lon <= 145:
        return "REG-SEASIA"
    if 5 <= lat <= 32 and -100 <= lon <= -55:
        return "REG-CARIB"
    if lat >= 20 and -80 <= lon <= 0:
        return "REG-ATL-N"
    if lat < 20 and -70 <= lon <= 20:
        return "REG-ATL-S"
    if -40 <= lat <= 30 and 40 <= lon <= 100:
        return "REG-IND"
    if lat >= 15 and (lon >= 100 or lon <= -100):
        return "REG-PAC-N"
    if lat < 15 and (lon >= 130 or lon <= -70):
        return "REG-PAC-S"
    return "REG-ATL-N"   # fallback


def _cable_midpoint(geometry: dict) -> tuple[float, float]:
    """Return mean (lat, lon) of all coordinates in a MultiLineString."""
    lats, lons = [], []
    for seg in geometry.get("coordinates", []):
        for lon, lat in seg:
            lats.append(lat)
            lons.append(lon)
    if not lats:
        return 0.0, 0.0
    return sum(lats) / len(lats), sum(lons) / len(lons)


# ── HTTP helpers ──────────────────────────────────────────────────────────────

def fetch_json(url: str) -> dict | None:
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"  [warn] {url} -> {e}")
        return None


def fetch_all(items: list, url_template: str, id_key: str) -> dict:
    results: dict = {}

    def fetch_one(item_id: str):
        return item_id, fetch_json(url_template.format(**{id_key: item_id}))

    print(f"  Fetching {len(items)} detail pages ({WORKERS} threads) …")
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(fetch_one, i): i for i in items}
        done = 0
        for future in as_completed(futures):
            item_id, detail = future.result()
            if detail:
                results[item_id] = detail
            done += 1
            if done % 200 == 0:
                print(f"    {done}/{len(items)} …")
    print(f"  Done — {len(results)}/{len(items)} succeeded")
    return results


# ── Cable geometry ────────────────────────────────────────────────────────────

def build_cable_geometry_map(geo_data: dict) -> dict:
    cables: dict = {}
    for feature in geo_data["features"]:
        props  = feature["properties"]
        cid    = props["id"]
        coords = list(feature["geometry"]["coordinates"])
        if cid not in cables:
            cables[cid] = {"cable_id": cid, "cable_name": props["name"], "coords": coords}
        else:
            cables[cid]["coords"].extend(coords)
    for c in cables.values():
        c["geometry"] = {"type": "MultiLineString", "coordinates": c.pop("coords")}
    return cables


# ── Enrichment derivation ─────────────────────────────────────────────────────

def parse_length(raw) -> int | None:
    if raw is None:
        return None
    try:
        return int(str(raw).replace(",", "").split()[0])
    except Exception:
        return None


def derive_enrichment(cable_id: str, detail: dict) -> dict:
    owners_v = detail.get("owners")
    if isinstance(owners_v, list):
        owners_v = ", ".join(o for o in owners_v if o)

    lps = detail.get("landing_points") or []
    lp_entries = [(lp.get("id", ""), lp.get("country") or "") for lp in lps if lp.get("id")]
    lp_ids     = [e[0] for e in lp_entries if e[0]]
    countries  = [e[1] for e in lp_entries if e[1]]

    seen: set = set()
    unique_countries: list = []
    for c in countries:
        if c not in seen:
            seen.add(c)
            unique_countries.append(c)

    return {
        "owners":            owners_v or None,
        "rfs_year":          detail.get("rfs_year"),
        "length_km":         parse_length(detail.get("length")),
        "country_a":         unique_countries[0] if unique_countries else None,
        "country_b":         unique_countries[-1] if len(unique_countries) > 1 else None,
        "all_countries":     ", ".join(unique_countries) if unique_countries else None,
        "landing_point_ids": ", ".join(lp_ids) if lp_ids else None,
    }


# ── Landing point helpers ─────────────────────────────────────────────────────

def parse_country_from_name(name: str) -> str | None:
    parts = [p.strip() for p in name.split(",")]
    return parts[-1] if len(parts) >= 2 else None


def build_lp_cable_map(all_details: dict) -> dict[str, list[str]]:
    lp_cables: dict = defaultdict(list)
    for cable_id, detail in all_details.items():
        for lp in (detail.get("landing_points") or []):
            lp_id = lp.get("id")
            if lp_id:
                lp_cables[lp_id].append(cable_id)
    return dict(lp_cables)


# ── DB operations ─────────────────────────────────────────────────────────────

def populate_regions(db) -> None:
    for region_id, region_name, description in REGION_DEFS:
        existing = db.query(RegionDefinition).filter(
            RegionDefinition.region_id == region_id
        ).first()
        if not existing:
            db.add(RegionDefinition(
                region_id=region_id, region_name=region_name, description=description
            ))
    db.commit()


def upsert_cables(cable_map: dict, all_details: dict, db) -> tuple[int, int]:
    # Load existing rows to determine system_id sequence
    existing_rows = db.query(CableSegment).order_by(CableSegment.id).all()
    existing_by_cable_id = {r.cable_id: r for r in existing_rows}

    # Find highest used system_id number
    max_num = 0
    for r in existing_rows:
        if r.system_id and r.system_id.startswith("CABLE-"):
            try:
                n = int(r.system_id.split("-")[1])
                max_num = max(max_num, n)
            except (IndexError, ValueError):
                pass

    inserted = 0
    counter = max_num

    for cid, cable in cable_map.items():
        detail     = all_details.get(cid, {})
        enrichment = derive_enrichment(cid, detail)

        mid_lat, mid_lon = _cable_midpoint(cable["geometry"])
        region_id  = _region_for_point(mid_lat, mid_lon)
        infra_type = "Submarine Cable"

        if cid in existing_by_cable_id:
            row = existing_by_cable_id[cid]
            for k, v in enrichment.items():
                setattr(row, k, v)
            row.region_id  = region_id
            row.infra_type = infra_type
            if not row.system_id:
                counter += 1
                row.system_id = f"CABLE-{counter:03d}"
        else:
            counter += 1
            db.add(CableSegment(
                cable_id   = cid,
                cable_name = cable["cable_name"],
                geometry   = cable["geometry"],
                system_id  = f"CABLE-{counter:03d}",
                infra_type = infra_type,
                region_id  = region_id,
                **enrichment,
            ))
            inserted += 1

    db.commit()
    return inserted, len(existing_by_cable_id)


def insert_landing_points(lp_features: list, lp_cable_map: dict, db) -> tuple[int, int]:
    existing = {row.landing_point_id for row in db.query(LandingPoint.landing_point_id).all()}
    inserted = skipped = 0

    for feature in lp_features:
        props  = feature["properties"]
        lp_id  = props["id"]
        coords = feature["geometry"]["coordinates"]

        if lp_id in existing:
            skipped += 1
            continue

        name           = props.get("name") or lp_id
        country        = parse_country_from_name(name)
        cable_ids_list = lp_cable_map.get(lp_id, [])

        db.add(LandingPoint(
            landing_point_id = lp_id,
            name             = name,
            country          = country,
            longitude        = coords[0],
            latitude         = coords[1],
            cable_ids        = ", ".join(sorted(cable_ids_list)) if cable_ids_list else None,
        ))
        inserted += 1

    db.commit()
    return inserted, skipped


def register_ontology_entities(db) -> int:
    """Upsert all CableSegment rows into OntologyEntity table."""
    cables = db.query(CableSegment).all()
    upserted = 0
    for cable in cables:
        if not cable.system_id:
            continue
        meta = json.dumps({
            "cable_id":          cable.cable_id,
            "owners":            cable.owners,
            "rfs_year":          cable.rfs_year,
            "length_km":         cable.length_km,
            "country_a":         cable.country_a,
            "country_b":         cable.country_b,
            "all_countries":     cable.all_countries,
            "landing_point_ids": cable.landing_point_ids,
        }, ensure_ascii=False)

        existing = db.query(OntologyEntity).filter(
            OntologyEntity.system_id == cable.system_id
        ).first()
        if existing:
            existing.name             = cable.cable_name
            existing.infra_type       = cable.infra_type
            existing.region_id        = cable.region_id
            existing.entity_metadata  = meta
        else:
            db.add(OntologyEntity(
                system_id       = cable.system_id,
                entity_type     = "Submarine Cable",
                name            = cable.cable_name,
                infra_type      = cable.infra_type,
                region_id       = cable.region_id,
                entity_metadata = meta,
            ))
        upserted += 1

    db.commit()
    return upserted


# ── Main ──────────────────────────────────────────────────────────────────────

def ingest():
    migrate_db()
    Base.metadata.create_all(bind=engine)

    print("=== Step 1: Regions ===")
    with SessionLocal() as db:
        populate_regions(db)
    print(f"  {len(REGION_DEFS)} regions defined")

    print("\n=== Step 2: Cable geometry ===")
    geo_data  = fetch_json(GEO_URL)
    if not geo_data:
        raise RuntimeError("Failed to fetch cable-geo.json")
    cable_map = build_cable_geometry_map(geo_data)
    print(f"  {len(cable_map)} unique cables from geometry file")

    print("\n=== Step 3: Cable detail metadata ===")
    all_details = fetch_all(list(cable_map.keys()), CABLE_DETAIL, "cable_id")

    print("\n=== Step 4: Landing point geometry ===")
    lp_geo = fetch_json(LP_GEO_URL)
    if not lp_geo:
        raise RuntimeError("Failed to fetch landing-point-geo.json")
    lp_features  = lp_geo["features"]
    lp_cable_map = build_lp_cable_map(all_details)
    print(f"  {len(lp_features)} landing point features")

    print("\n=== Step 5: Writing cables to database ===")
    with SessionLocal() as db:
        c_inserted, c_enriched = upsert_cables(cable_map, all_details, db)

    print("\n=== Step 6: Writing landing points to database ===")
    with SessionLocal() as db:
        lp_inserted, lp_skipped = insert_landing_points(lp_features, lp_cable_map, db)

    print("\n=== Step 7: Registering ontology entities ===")
    with SessionLocal() as db:
        onto_count = register_ontology_entities(db)
    print(f"  {onto_count} ontology entities registered")

    # Final stats
    with SessionLocal() as db:
        total_cables  = db.query(CableSegment).count()
        no_sys_id     = db.query(CableSegment).filter(CableSegment.system_id == None).count()
        no_country    = db.query(CableSegment).filter(CableSegment.all_countries == None).count()
        no_region     = db.query(CableSegment).filter(CableSegment.region_id == None).count()
        total_lps     = db.query(LandingPoint).count()
        total_onto    = db.query(OntologyEntity).count()

        # Region breakdown
        from sqlalchemy import func
        region_counts = (
            db.query(CableSegment.region_id, func.count().label("n"))
            .group_by(CableSegment.region_id)
            .order_by(func.count().desc())
            .all()
        )

    print()
    print("=== INGEST COMPLETE ===")
    print(f"  Cables  — new: {c_inserted}, enriched: {c_enriched}")
    print(f"  LandingPoints — inserted: {lp_inserted}, skipped: {lp_skipped}")
    print(f"  Ontology entities: {total_onto}")
    print(f"  Cables missing system_id  : {no_sys_id}")
    print(f"  Cables missing country    : {no_country}")
    print(f"  Cables missing region_id  : {no_region}")
    print()
    print("  Region breakdown:")
    for region_id, count in region_counts:
        print(f"    {region_id:<15} {count}")


if __name__ == "__main__":
    ingest()
