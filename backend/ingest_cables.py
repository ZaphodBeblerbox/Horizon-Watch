"""
Ingest TeleGeography submarine cable and landing point data.

Usage (from backend/ directory):
    python ingest_cables.py

Sources:
    Cable geometry  : https://submarinecablemap.com/api/v3/cable/cable-geo.json
    Cable metadata  : https://submarinecablemap.com/api/v3/cable/{cable_id}.json
    Landing points  : https://submarinecablemap.com/api/v3/landing-point/landing-point-geo.json

Run order:
    1. Fetch cable-geo.json  → cable geometry (694 unique cables)
    2. Fetch each cable detail → metadata + ordered landing_points with country
    3. Fetch landing-point-geo.json → coordinates
    4. Insert / update CableSegment rows (geometry + metadata + enrichment)
    5. Insert LandingPoint rows (skip existing)
"""

import os, sys, json, urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))

from database import Base, CableSegment, LandingPoint, SessionLocal, engine, migrate_db

GEO_URL        = "https://submarinecablemap.com/api/v3/cable/cable-geo.json"
LP_GEO_URL     = "https://submarinecablemap.com/api/v3/landing-point/landing-point-geo.json"
CABLE_DETAIL   = "https://submarinecablemap.com/api/v3/cable/{cable_id}.json"
HEADERS        = {"User-Agent": "NaginiIngest/1.0"}
WORKERS        = 25


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
    """Batch-fetch detail pages. Returns {id -> detail_dict}."""
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
    """Group geo features by cable_id, merging multi-segment cables."""
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
    """Extract owners, rfs_year, length, and country enrichment from detail page."""
    owners_v = detail.get("owners")
    if isinstance(owners_v, list):
        owners_v = ", ".join(o for o in owners_v if o)

    lps = detail.get("landing_points") or []

    # Build ordered (lp_id, country) list
    lp_entries = [(lp.get("id", ""), lp.get("country") or "") for lp in lps if lp.get("id")]
    lp_ids   = [e[0] for e in lp_entries if e[0]]
    countries = [e[1] for e in lp_entries if e[1]]

    # Unique sorted countries preserving first occurrence for country_a/b
    seen: set = set()
    unique_countries: list = []
    for c in countries:
        if c not in seen:
            seen.add(c)
            unique_countries.append(c)

    country_a = unique_countries[0] if unique_countries else None
    country_b = unique_countries[-1] if len(unique_countries) > 1 else None

    return {
        "owners":            owners_v or None,
        "rfs_year":          detail.get("rfs_year"),
        "length_km":         parse_length(detail.get("length")),
        "country_a":         country_a,
        "country_b":         country_b,
        "all_countries":     ", ".join(unique_countries) if unique_countries else None,
        "landing_point_ids": ", ".join(lp_ids) if lp_ids else None,
    }


# ── Landing point geo ─────────────────────────────────────────────────────────

def parse_country_from_name(name: str) -> str | None:
    """'Nybor, Denmark' → 'Denmark'. Falls back to None."""
    parts = [p.strip() for p in name.split(",")]
    return parts[-1] if len(parts) >= 2 else None


def build_lp_cable_map(all_details: dict) -> dict[str, list[str]]:
    """Invert cable→lp_ids to lp_id→[cable_ids]."""
    lp_cables: dict = defaultdict(list)
    for cable_id, detail in all_details.items():
        for lp in (detail.get("landing_points") or []):
            lp_id = lp.get("id")
            if lp_id:
                lp_cables[lp_id].append(cable_id)
    return dict(lp_cables)


# ── DB operations ─────────────────────────────────────────────────────────────

def upsert_cables(cable_map: dict, all_details: dict, db) -> tuple[int, int]:
    existing = {row.cable_id for row in db.query(CableSegment.cable_id).all()}
    inserted = skipped = 0

    for cid, cable in cable_map.items():
        detail     = all_details.get(cid, {})
        enrichment = derive_enrichment(cid, detail)

        if cid in existing:
            # Update enrichment columns on existing rows
            db.query(CableSegment).filter(CableSegment.cable_id == cid).update(enrichment)
            skipped += 1
        else:
            db.add(CableSegment(
                cable_id   = cid,
                cable_name = cable["cable_name"],
                geometry   = cable["geometry"],
                **enrichment,
            ))
            inserted += 1

    db.commit()
    return inserted, skipped


def insert_landing_points(lp_features: list, lp_cable_map: dict, db) -> tuple[int, int]:
    existing = {row.landing_point_id for row in db.query(LandingPoint.landing_point_id).all()}
    inserted = skipped = 0

    for feature in lp_features:
        props  = feature["properties"]
        lp_id  = props["id"]
        coords = feature["geometry"]["coordinates"]   # [lon, lat]

        if lp_id in existing:
            skipped += 1
            continue

        name     = props.get("name") or lp_id
        country  = parse_country_from_name(name)
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


# ── Main ──────────────────────────────────────────────────────────────────────

def ingest():
    # Run migrations then ensure all tables exist
    migrate_db()
    Base.metadata.create_all(bind=engine)

    print("=== Step 1: Cable geometry ===")
    geo_data  = fetch_json(GEO_URL)
    if not geo_data:
        raise RuntimeError("Failed to fetch cable-geo.json")
    cable_map = build_cable_geometry_map(geo_data)
    print(f"  {len(cable_map)} unique cables from geometry file")

    print("\n=== Step 2: Cable detail metadata ===")
    all_details = fetch_all(list(cable_map.keys()), CABLE_DETAIL, "cable_id")

    print("\n=== Step 3: Landing point geometry ===")
    lp_geo = fetch_json(LP_GEO_URL)
    if not lp_geo:
        raise RuntimeError("Failed to fetch landing-point-geo.json")
    lp_features = lp_geo["features"]
    print(f"  {len(lp_features)} landing point features")

    lp_cable_map = build_lp_cable_map(all_details)
    print(f"  Cable→LP inversion: {len(lp_cable_map)} unique LP ids with cable associations")

    print("\n=== Step 4: Writing to database ===")
    db = SessionLocal()
    try:
        c_inserted, c_skipped = upsert_cables(cable_map, all_details, db)
        lp_inserted, lp_skipped = insert_landing_points(lp_features, lp_cable_map, db)
    finally:
        db.close()

    # Report cables missing country data
    db2 = SessionLocal()
    try:
        no_country = db2.query(CableSegment).filter(CableSegment.all_countries == None).count()
        total_cables = db2.query(CableSegment).count()
        total_lps    = db2.query(LandingPoint).count()
    finally:
        db2.close()

    print()
    print("=== INGEST COMPLETE ===")
    print(f"  Cables  — inserted: {c_inserted}, enriched (existing): {c_skipped}")
    print(f"  LandingPoints — inserted: {lp_inserted}, skipped: {lp_skipped}")
    print(f"  Total cables in DB  : {total_cables}")
    print(f"  Total LPs in DB     : {total_lps}")
    print(f"  Cables missing country data: {no_country}")


if __name__ == "__main__":
    ingest()
