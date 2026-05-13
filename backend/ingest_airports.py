"""
Ingest global airport data from OurAirports (public domain).

Source: https://davidmegginson.github.io/ourairports-data/airports.csv
Provides ~85k airports worldwide; we ingest large, medium, small, seaplane_base.

Usage (from backend/ directory):
    python ingest_airports.py
"""

import os, sys, json, csv, io, urllib.request
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))

from database import Base, Airport, OntologyEntity, engine, SessionLocal, migrate_db

AIRPORTS_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv"
COUNTRIES_URL = "https://davidmegginson.github.io/ourairports-data/countries.csv"
HEADERS = {"User-Agent": "NaginiIngest/1.0"}

INGEST_TYPES = {"large_airport", "medium_airport", "small_airport", "seaplane_base"}


# ── Region assignment (same bounding-box logic as cables and ports) ───────────

def _region_for_point(lat: float, lon: float) -> str:
    if lat > 66:                                          return "REG-ARCTIC"
    if 50 <= lat <= 72 and -10 <= lon <= 32:              return "REG-NORSEA"
    if 30 <= lat <= 47 and -6 <= lon <= 42:               return "REG-MED"
    if 10 <= lat <= 32 and 32 <= lon <= 65:               return "REG-REDSEA"
    if -10 <= lat <= 25 and 95 <= lon <= 145:             return "REG-SEASIA"
    if 5 <= lat <= 32 and -100 <= lon <= -55:             return "REG-CARIB"
    if lat >= 20 and -80 <= lon <= 0:                     return "REG-ATL-N"
    if lat < 20 and -70 <= lon <= 20:                     return "REG-ATL-S"
    if -40 <= lat <= 30 and 40 <= lon <= 100:             return "REG-IND"
    if lat >= 15 and (lon >= 100 or lon <= -100):         return "REG-PAC-N"
    if lat < 15 and (lon >= 130 or lon <= -70):           return "REG-PAC-S"
    return "REG-ATL-N"


# ── Fetch country name lookup ─────────────────────────────────────────────────

def fetch_country_names() -> dict:
    """Returns {iso2 → name} mapping from OurAirports countries.csv."""
    try:
        req = urllib.request.Request(COUNTRIES_URL, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode("utf-8", errors="replace")
        reader = csv.DictReader(io.StringIO(raw))
        return {row["code"].strip(): row["name"].strip() for row in reader if row.get("code")}
    except Exception as e:
        print(f"  [warn] could not fetch country names: {e}")
        return {}


# ── Fetch and parse airports ──────────────────────────────────────────────────

def fetch_airports() -> list[dict]:
    print("Downloading OurAirports dataset…")
    req = urllib.request.Request(AIRPORTS_URL, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read().decode("utf-8", errors="replace")
    print(f"  Downloaded {len(raw):,} bytes")

    reader = csv.DictReader(io.StringIO(raw))
    airports = []
    skipped_type = 0

    for row in reader:
        apt_type = row.get("type", "").strip()
        if apt_type not in INGEST_TYPES:
            skipped_type += 1
            continue

        try:
            lat = float(row["latitude_deg"])
            lon = float(row["longitude_deg"])
        except (ValueError, KeyError):
            skipped_type += 1
            continue

        elev = None
        try:
            elev = int(float(row["elevation_ft"])) if row.get("elevation_ft") else None
        except (ValueError, TypeError):
            pass

        airports.append({
            "ident":        row.get("ident", "").strip(),
            "icao_code":    row.get("icao_code", "").strip() or None,
            "iata_code":    row.get("iata_code", "").strip() or None,
            "airport_name": row.get("name", "").strip(),
            "airport_type": apt_type,
            "country_code": row.get("iso_country", "").strip() or None,
            "municipality": row.get("municipality", "").strip() or None,
            "elevation_ft": elev,
            "lat":          lat,
            "lon":          lon,
        })

    print(f"  Parsed {len(airports):,} airports to ingest  (skipped {skipped_type:,} by type/coords)")
    return airports


# ── DB operations ─────────────────────────────────────────────────────────────

def upsert_airports(airports: list[dict], country_names: dict, db) -> tuple[int, int]:
    existing_idents = {row.ident for row in db.query(Airport.ident).all() if row.ident}

    # Find next system_id number
    existing_sysids = {row.system_id for row in db.query(Airport.system_id).all()}
    max_num = 0
    for sid in existing_sysids:
        if sid and sid.startswith("ARPT-"):
            try:
                max_num = max(max_num, int(sid.split("-")[1]))
            except (IndexError, ValueError):
                pass

    inserted = skipped = 0
    counter  = max_num

    for a in airports:
        ident = a["ident"]
        if not ident or ident in existing_idents:
            skipped += 1
            continue

        counter   += 1
        system_id  = f"ARPT-{counter:05d}"
        region_id  = _region_for_point(a["lat"], a["lon"])
        country_name = country_names.get(a["country_code"] or "", "")

        meta = json.dumps({
            "ident":        ident,
            "icao_code":    a["icao_code"],
            "iata_code":    a["iata_code"],
            "airport_type": a["airport_type"],
            "country_code": a["country_code"],
            "country_name": country_name,
            "municipality": a["municipality"],
            "elevation_ft": a["elevation_ft"],
            "lat":          a["lat"],
            "lon":          a["lon"],
        }, ensure_ascii=False)

        db.add(Airport(
            system_id     = system_id,
            ident         = ident,
            icao_code     = a["icao_code"],
            iata_code     = a["iata_code"],
            airport_name  = a["airport_name"],
            airport_type  = a["airport_type"],
            country_code  = a["country_code"],
            country_name  = country_name,
            region_id     = region_id,
            latitude      = a["lat"],
            longitude     = a["lon"],
            elevation_ft  = a["elevation_ft"],
            municipality  = a["municipality"],
            infra_type    = "Airport",
            airport_metadata = meta,
        ))
        existing_idents.add(ident)
        inserted += 1

        if inserted % 5000 == 0:
            db.flush()
            print(f"  … {inserted:,} inserted")

    db.commit()
    return inserted, skipped


def register_ontology_entities(db) -> int:
    airports = db.query(Airport).all()
    upserted = 0
    for apt in airports:
        meta = json.dumps({
            "ident":        apt.ident,
            "icao_code":    apt.icao_code,
            "iata_code":    apt.iata_code,
            "airport_type": apt.airport_type,
            "country_code": apt.country_code,
            "country_name": apt.country_name,
            "municipality": apt.municipality,
            "elevation_ft": apt.elevation_ft,
            "lat":          apt.latitude,
            "lon":          apt.longitude,
        }, ensure_ascii=False)

        existing = db.query(OntologyEntity).filter(
            OntologyEntity.system_id == apt.system_id
        ).first()
        if existing:
            existing.name            = apt.airport_name
            existing.infra_type      = "Airport"
            existing.region_id       = apt.region_id
            existing.entity_metadata = meta
        else:
            db.add(OntologyEntity(
                system_id       = apt.system_id,
                entity_type     = "Airport",
                name            = apt.airport_name,
                infra_type      = "Airport",
                region_id       = apt.region_id,
                entity_metadata = meta,
            ))
        upserted += 1

        if upserted % 5000 == 0:
            db.flush()

    db.commit()
    return upserted


# ── Main ──────────────────────────────────────────────────────────────────────

def ingest():
    migrate_db()
    Base.metadata.create_all(bind=engine)

    country_names = fetch_country_names()
    print(f"  Loaded {len(country_names):,} country names")

    airports = fetch_airports()

    print("\n=== Writing airports to database ===")
    with SessionLocal() as db:
        inserted, skipped = upsert_airports(airports, country_names, db)

    print(f"  Inserted: {inserted:,}  |  Skipped (already exist): {skipped:,}")

    print("\n=== Registering ontology entities ===")
    with SessionLocal() as db:
        onto_count = register_ontology_entities(db)
    print(f"  {onto_count:,} Airport ontology entities registered")

    # Summary
    with SessionLocal() as db:
        total = db.query(Airport).count()
        type_counts   = defaultdict(int)
        region_counts = defaultdict(int)
        for row in db.query(Airport).all():
            type_counts[row.airport_type]   += 1
            region_counts[row.region_id or "unknown"] += 1

    print()
    print("=== INGEST COMPLETE ===")
    print(f"  Total airports in DB: {total:,}")
    print()
    print("  By type:")
    for t in ["large_airport", "medium_airport", "small_airport", "seaplane_base"]:
        print(f"    {t:<20} {type_counts.get(t, 0):,}")
    print()
    print("  By region (top 8):")
    for region_id, count in sorted(region_counts.items(), key=lambda x: -x[1])[:8]:
        print(f"    {region_id:<15} {count:,}")


if __name__ == "__main__":
    ingest()
