"""
Ingest World Port data from UN LOCODE (public domain, UN-published).

Source: https://service.unece.org/trade/locode/loc242csv.zip
Provides ~11,800 maritime port entries with country code, name, and coordinates.

Usage (from backend/ directory):
    python ingest_ports.py
"""

import os, sys, json, csv, io, math, zipfile, urllib.request
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))

from database import Base, PortBoundary, OntologyEntity, engine, SessionLocal, migrate_db

LOCODE_URL  = "https://service.unece.org/trade/locode/loc242csv.zip"
LOCODE_PARTS = [
    "2024-2 UNLOCODE CodeListPart1.csv",
    "2024-2 UNLOCODE CodeListPart2.csv",
    "2024-2 UNLOCODE CodeListPart3.csv",
]
HEADERS = {"User-Agent": "NaginiIngest/1.0"}


# ── Region assignment (shared logic with cables) ──────────────────────────────

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


# ── Port size from UN LOCODE function code ─────────────────────────────────────
# Function code chars represent transport modes (each non-dash = one mode).
# More modes = larger / more significant port.

def _port_size_from_func(func: str) -> str:
    count = sum(1 for c in func if c not in ("-", " ", ""))
    if count >= 4: return "Very Large"
    if count == 3: return "Large"
    if count == 2: return "Medium"
    return "Small"


def _radius_for_size(size: str) -> int:
    return {"Small": 2000, "Medium": 5000, "Large": 10000, "Very Large": 15000}.get(size, 2000)


# ── Coordinate parsing ────────────────────────────────────────────────────────

def _parse_locode_coords(coord_str: str):
    """Parse '5115N 00430E' → (51.25, 4.50). Returns (None, None) on failure."""
    try:
        coord_str = coord_str.strip()
        if not coord_str or len(coord_str) < 9:
            return None, None
        parts = coord_str.split()
        if len(parts) != 2:
            return None, None
        lat_s, lon_s = parts
        lat = int(lat_s[:2]) + int(lat_s[2:4]) / 60.0
        if lat_s[4].upper() == "S":
            lat = -lat
        lon = int(lon_s[:3]) + int(lon_s[3:5]) / 60.0
        if lon_s[5].upper() == "W":
            lon = -lon
        return round(lat, 6), round(lon, 6)
    except Exception:
        return None, None


# ── Download and parse ────────────────────────────────────────────────────────

def fetch_locode_ports() -> list[dict]:
    print("Downloading UN LOCODE dataset…")
    req = urllib.request.Request(LOCODE_URL, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as r:
        zip_data = r.read()
    print(f"  Downloaded {len(zip_data):,} bytes")

    zf = zipfile.ZipFile(io.BytesIO(zip_data))
    ports = []

    for part_name in LOCODE_PARTS:
        if part_name not in zf.namelist():
            print(f"  [warn] {part_name} not found in ZIP")
            continue
        with zf.open(part_name) as f:
            reader = csv.reader(io.TextIOWrapper(f, encoding="utf-8", errors="replace"))
            for row in reader:
                if len(row) < 11:
                    continue
                country = row[1].strip()
                locode  = row[2].strip()
                name    = row[3].strip()
                func    = row[6].strip()
                coords  = row[10].strip()

                # Only maritime ports (function code starts with '1')
                if not func or func[0] != "1":
                    continue
                if not coords or not name or not locode:
                    continue

                lat, lon = _parse_locode_coords(coords)
                if lat is None:
                    continue

                full_locode = f"{country}{locode}" if locode else ""
                ports.append({
                    "country":    country,
                    "locode":     full_locode,
                    "port_name":  name,
                    "lat":        lat,
                    "lon":        lon,
                    "func":       func,
                })

    print(f"  Parsed {len(ports):,} maritime ports with coordinates")
    return ports


# ── DB operations ─────────────────────────────────────────────────────────────

def upsert_ports(ports: list[dict], db) -> tuple[int, int]:
    existing_locodes = {row.locode for row in db.query(PortBoundary.locode).all() if row.locode}
    existing_sysids  = {row.system_id for row in db.query(PortBoundary.system_id).all()}

    # Find next system_id number
    max_num = 0
    for sid in existing_sysids:
        if sid and sid.startswith("PORT-"):
            try:
                n = int(sid.split("-")[1])
                max_num = max(max_num, n)
            except (IndexError, ValueError):
                pass

    inserted = skipped = 0
    counter  = max_num

    for p in ports:
        if p["locode"] in existing_locodes:
            skipped += 1
            continue

        size      = _port_size_from_func(p["func"])
        radius    = _radius_for_size(size)
        region_id = _region_for_point(p["lat"], p["lon"])
        counter  += 1
        system_id = f"PORT-{counter:04d}"

        meta = json.dumps({
            "country":               p["country"],
            "locode":                p["locode"],
            "port_size":             size,
            "boundary_radius_metres": radius,
            "lat":                   p["lat"],
            "lon":                   p["lon"],
            "func":                  p["func"],
        }, ensure_ascii=False)

        db.add(PortBoundary(
            system_id              = system_id,
            port_name              = p["port_name"],
            country                = p["country"],
            locode                 = p["locode"],
            region_id              = region_id,
            latitude               = p["lat"],
            longitude              = p["lon"],
            port_size              = size,
            boundary_radius_metres = radius,
            infra_type             = "Port",
            port_metadata          = meta,
        ))
        existing_locodes.add(p["locode"])
        inserted += 1

        if inserted % 1000 == 0:
            db.flush()
            print(f"  … {inserted:,} inserted")

    db.commit()
    return inserted, skipped


def register_ontology_entities(db) -> int:
    ports = db.query(PortBoundary).all()
    upserted = 0
    for port in ports:
        meta = json.dumps({
            "country":               port.country,
            "locode":                port.locode,
            "port_size":             port.port_size,
            "boundary_radius_metres": port.boundary_radius_metres,
            "lat":                   port.latitude,
            "lon":                   port.longitude,
        }, ensure_ascii=False)

        existing = db.query(OntologyEntity).filter(
            OntologyEntity.system_id == port.system_id
        ).first()
        if existing:
            existing.name           = port.port_name
            existing.infra_type     = "Port"
            existing.region_id      = port.region_id
            existing.entity_metadata = meta
        else:
            db.add(OntologyEntity(
                system_id       = port.system_id,
                entity_type     = "Port",
                name            = port.port_name,
                infra_type      = "Port",
                region_id       = port.region_id,
                entity_metadata = meta,
            ))
        upserted += 1

    db.commit()
    return upserted


# ── Main ──────────────────────────────────────────────────────────────────────

def ingest():
    migrate_db()
    Base.metadata.create_all(bind=engine)

    ports = fetch_locode_ports()

    print("\n=== Writing ports to database ===")
    with SessionLocal() as db:
        inserted, skipped = upsert_ports(ports, db)

    print(f"  Inserted: {inserted:,}  |  Skipped (already exist): {skipped:,}")

    print("\n=== Registering ontology entities ===")
    with SessionLocal() as db:
        onto_count = register_ontology_entities(db)
    print(f"  {onto_count:,} Port ontology entities registered")

    # Summary stats
    with SessionLocal() as db:
        total = db.query(PortBoundary).count()
        region_counts = {}
        for row in db.query(PortBoundary).all():
            region_counts[row.region_id] = region_counts.get(row.region_id, 0) + 1
        size_counts = {}
        for row in db.query(PortBoundary).all():
            size_counts[row.port_size] = size_counts.get(row.port_size, 0) + 1

    print()
    print("=== INGEST COMPLETE ===")
    print(f"  Total ports in DB: {total:,}")
    print()
    print("  By size:")
    for size in ["Very Large", "Large", "Medium", "Small"]:
        print(f"    {size:<12} {size_counts.get(size, 0):,}")
    print()
    print("  By region:")
    for region_id, count in sorted(region_counts.items(), key=lambda x: -x[1]):
        print(f"    {region_id:<15} {count:,}")


def run_ingest(db=None) -> dict:
    """Programmatic entry point for startup auto-ingest."""
    from database import SessionLocal as _SL
    _own = db is None
    if _own:
        db = _SL()
    try:
        ports = fetch_locode_ports()
        inserted, skipped = upsert_ports(ports, db)
        onto_count = register_ontology_entities(db)
        return {"ports_inserted": inserted, "ports_skipped": skipped, "ontology_upserted": onto_count}
    finally:
        if _own:
            db.close()


if __name__ == "__main__":
    ingest()
