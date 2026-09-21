"""
Verification script for the entity_linker.py fix (roadmap Phase 2: zone
containment / cable proximity).

Before this fix, EntityLinker.load_cache() queried columns that don't exist
on CableSegment (midpoint_lat/midpoint_lon), Airport (name), WatchZone
(center_lat/center_lon/radius_km), and StrategicZone (center_lat/center_lon,
and filtered on `active` instead of `enabled`) — every one of those four
queries threw an exception on every load, so cables/airports/watch-zones/
strategic-zones NEVER actually linked to anything, silently, since whenever
this code was written. This script seeds one real row of each entity type
plus a handful of test alerts and checks that linking actually happens now,
with genuinely-computed geometry (real point-in-polygon containment for
zones, real point-to-route distance for cables — not a centroid guess).

Runs against the REAL backend/data directory (gitignored).

Usage:
    cd backend
    python3 test_entity_linker_zones.py
"""
import os, sys, json
os.environ.setdefault("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
sys.path.insert(0, os.path.dirname(__file__))

FAILURES = []

def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


print("="*70)
print("  entity_linker zone/cable fix — verification")
print("="*70)

from database import (
    get_db, CableSegment, PortBoundary, Airport, WatchZone, StrategicZone, OntologyLink,
)
from entity_linker import EntityLinker

PREFIX = "TESTQEL"
alert_ids = []

# ── Seed one real row of each entity type ──────────────────────────────────
wz_polygon = {"type": "Polygon", "coordinates": [[[44.0, 12.0], [44.2, 12.0], [44.2, 12.2], [44.0, 12.2], [44.0, 12.0]]]}
sz_polygon = {"type": "Polygon", "coordinates": [[[45.0, 13.0], [45.2, 13.0], [45.2, 13.2], [45.0, 13.2], [45.0, 13.0]]]}
cable_geom = {"type": "LineString", "coordinates": [[46.0, 10.0], [46.0, 20.0]]}  # ~1110km long, lon fixed at 46

with get_db() as db:
    db.add(CableSegment(
        cable_id=f"{PREFIX}-CABLE-1", cable_name=f"{PREFIX} Cable",
        geometry=cable_geom, system_id=f"{PREFIX}-CABLE-SYS-1",
    ))
    db.add(PortBoundary(
        system_id=f"{PREFIX}-PORT-1", port_name=f"{PREFIX} Port",
        latitude=12.05, longitude=44.05,
    ))
    db.add(Airport(
        system_id=f"{PREFIX}-ARPT-1", airport_name=f"{PREFIX} Airport", airport_type="small_airport",
        latitude=12.06, longitude=44.06,
    ))
    db.add(WatchZone(
        system_id=f"{PREFIX}-WZ-1", name=f"{PREFIX} Watch Zone",
        polygon_geojson=json.dumps(wz_polygon),
        bbox_min_lon=44.0, bbox_min_lat=12.0, bbox_max_lon=44.2, bbox_max_lat=12.2,
        enabled=True,
    ))
    db.add(StrategicZone(
        zone_id=f"{PREFIX}-SZONE-1", name=f"{PREFIX} Strategic Zone", zone_type="CHOKEPOINT_EXTENDED",
        polygon_geojson=json.dumps(sz_polygon),
        bbox_min_lon=45.0, bbox_min_lat=13.0, bbox_max_lon=45.2, bbox_max_lat=13.2,
        enabled=True,
    ))
    db.commit()

    wz_row = db.query(WatchZone).filter(WatchZone.system_id == f"{PREFIX}-WZ-1").first()
    sz_row = db.query(StrategicZone).filter(StrategicZone.zone_id == f"{PREFIX}-SZONE-1").first()
    wz_db_id = str(wz_row.id)
    sz_db_id = str(sz_row.id)

# ── Load a fresh linker against the seeded data ─────────────────────────────
linker = EntityLinker()
linker.load_cache()

check("cable cache loaded (was always 0 before the fix)", len(linker._cables) >= 1, len(linker._cables))
check("port cache loaded", len(linker._ports) >= 1, len(linker._ports))
check("airport cache loaded (was always 0 before the fix)", len(linker._airports) >= 1, len(linker._airports))
check("watch_zone cache loaded (was always 0 before the fix)", len(linker._watch_zones) >= 1, len(linker._watch_zones))
check("strategic_zone cache loaded (was always 0 before the fix)", len(linker._strategic_zones) >= 1, len(linker._strategic_zones))

our_wz = next((z for z in linker._watch_zones if z["id"] == wz_db_id), None)
our_sz = next((z for z in linker._strategic_zones if z["id"] == sz_db_id), None)
check("our watch zone has a real parsed polygon (not None)", our_wz and our_wz["polygon"] is not None)
check("our strategic zone has a real parsed polygon (not None)", our_sz and our_sz["polygon"] is not None)

def fire(alert_id, lat, lon):
    alert_ids.append(alert_id)
    linker.link_alert(alert_id=alert_id, source_type="alert", lat=lat, lon=lon, title="")

def links_for(alert_id):
    with get_db() as db:
        rows = db.query(OntologyLink).filter(OntologyLink.source_id == alert_id).all()
        return [{"entity_type": r.entity_type, "entity_id": r.entity_id, "link_type": r.link_type, "distance_km": r.distance_km} for r in rows]

# ── Point strictly inside the watch zone polygon ────────────────────────────
fire(f"{PREFIX}-ALT-inside-wz", 12.1, 44.1)
ls = links_for(f"{PREFIX}-ALT-inside-wz")
wz_link = next((l for l in ls if l["entity_type"] == "watch_zone" and l["entity_id"] == wz_db_id), None)
check("point inside watch zone polygon links as 'contains'", wz_link is not None and wz_link["link_type"] == "contains", ls)
check("'contains' link has distance_km == 0.0", wz_link and wz_link["distance_km"] == 0.0, wz_link)

# ── Point strictly inside the strategic zone polygon ────────────────────────
fire(f"{PREFIX}-ALT-inside-sz", 13.1, 45.1)
ls = links_for(f"{PREFIX}-ALT-inside-sz")
sz_link = next((l for l in ls if l["entity_type"] == "strategic_zone" and l["entity_id"] == sz_db_id), None)
check("point inside strategic zone polygon links as 'contains'", sz_link is not None and sz_link["link_type"] == "contains", ls)

# ── Point just outside the watch zone boundary, within the proximity margin ─
fire(f"{PREFIX}-ALT-near-wz", 12.1, 44.205)  # ~0.5km east of the 44.2 boundary
ls = links_for(f"{PREFIX}-ALT-near-wz")
near_link = next((l for l in ls if l["entity_type"] == "watch_zone" and l["entity_id"] == wz_db_id), None)
check("point just outside watch zone boundary links as 'proximity'", near_link is not None and near_link["link_type"] == "proximity", ls)
check("'proximity' link's distance is small and real (< 15km, > 0)", near_link and 0 < near_link["distance_km"] < 15, near_link)

# ── Point far from every zone — must NOT link to either ─────────────────────
fire(f"{PREFIX}-ALT-far-away", 0.0, 0.0)
ls = links_for(f"{PREFIX}-ALT-far-away")
check("point far from both zones has no watch_zone/strategic_zone link",
      not any(l["entity_type"] in ("watch_zone", "strategic_zone") for l in ls), ls)

# ── Cable: point near one END of a long cable, far from its geometric midpoint ──
# The cable runs lat 10→20 at lon 46 (~1110km long); its midpoint is ~(46, 15).
# A point at (46.001, 10.01) is ~0.1km from the actual route but ~560km from
# the midpoint — a midpoint-proxy (or the old, broken code) would have missed
# this entirely; real point-to-route distance must catch it.
fire(f"{PREFIX}-ALT-cable-near-end", 10.01, 46.001)
ls = links_for(f"{PREFIX}-ALT-cable-near-end")
cable_link = next((l for l in ls if l["entity_type"] == "cable"), None)
check("point near cable's end (far from its midpoint) still links to the cable", cable_link is not None, ls)
check("cable link distance is small and real (< 5km)", cable_link and cable_link["distance_km"] < 5, cable_link)

# ── Point far from the cable's route entirely — must NOT link ───────────────
fire(f"{PREFIX}-ALT-cable-far", 25.0, 46.001)
ls = links_for(f"{PREFIX}-ALT-cable-far")
check("point far from the cable route has no cable link", not any(l["entity_type"] == "cable" for l in ls), ls)

# ── Cleanup ──────────────────────────────────────────────────────────────────
with get_db() as db:
    db.query(CableSegment).filter(CableSegment.system_id == f"{PREFIX}-CABLE-SYS-1").delete(synchronize_session=False)
    db.query(PortBoundary).filter(PortBoundary.system_id == f"{PREFIX}-PORT-1").delete(synchronize_session=False)
    db.query(Airport).filter(Airport.system_id == f"{PREFIX}-ARPT-1").delete(synchronize_session=False)
    db.query(WatchZone).filter(WatchZone.system_id == f"{PREFIX}-WZ-1").delete(synchronize_session=False)
    db.query(StrategicZone).filter(StrategicZone.zone_id == f"{PREFIX}-SZONE-1").delete(synchronize_session=False)
    db.query(OntologyLink).filter(OntologyLink.source_id.in_(alert_ids)).delete(synchronize_session=False)
    db.commit()

with get_db() as db:
    remaining = db.query(OntologyLink).filter(OntologyLink.source_id.in_(alert_ids)).count()
    check("cleanup removed all test OntologyLink rows", remaining == 0)
    remaining_wz = db.query(WatchZone).filter(WatchZone.system_id == f"{PREFIX}-WZ-1").count()
    check("cleanup removed the test watch zone", remaining_wz == 0)

print("="*70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    sys.exit(1)
else:
    print("  RESULT: ALL CHECKS PASSED")
print("="*70)
