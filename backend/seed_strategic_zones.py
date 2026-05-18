"""
seed_strategic_zones.py — Seed hardcoded baseline strategic zones.

Run directly or imported by main.py startup.
Inserts zones that don't yet exist; skips existing ones.
Also registers each zone in OntologyEntity.
"""
from __future__ import annotations
import json
import datetime

_BASELINE_ZONES = [
    {
        "zone_id":           "SZONE-001",
        "name":              "Eastern Ukraine — Active Front",
        "zone_type":         "CONFLICT_ACTIVE",
        "severity_baseline": "critical",
        "colour":            "#FF3B30",
        "description":       "Active armed conflict between Russian and Ukrainian forces. "
                             "Front line runs through Donetsk and Zaporizhzhia oblasts. "
                             "High risk of escalation, missile strikes, and infrastructure targeting.",
        "coordinates":       [[36.0,47.5],[40.5,47.5],[40.5,50.5],[36.0,50.5],[36.0,47.5]],
    },
    {
        "zone_id":           "SZONE-002",
        "name":              "Taiwan Strait",
        "zone_type":         "CONFLICT_FROZEN",
        "severity_baseline": "high",
        "colour":            "#FF9500",
        "description":       "Contested strait between Taiwan and mainland China. "
                             "PLA conducts regular military exercises. "
                             "Any escalation would have severe global economic consequences.",
        "coordinates":       [[119.0,21.0],[123.0,21.0],[123.0,26.5],[119.0,26.5],[119.0,21.0]],
    },
    {
        "zone_id":           "SZONE-003",
        "name":              "Sudan — Active Conflict",
        "zone_type":         "CONFLICT_ACTIVE",
        "severity_baseline": "critical",
        "colour":            "#FF3B30",
        "description":       "Civil war between Sudanese Armed Forces and Rapid Support Forces. "
                             "Severe humanitarian crisis. Khartoum and Darfur most affected.",
        "coordinates":       [[21.5,8.5],[38.5,8.5],[38.5,22.0],[21.5,22.0],[21.5,8.5]],
    },
    {
        "zone_id":           "SZONE-004",
        "name":              "Gaza Strip",
        "zone_type":         "CONFLICT_ACTIVE",
        "severity_baseline": "critical",
        "colour":            "#FF3B30",
        "description":       "Active conflict zone. Ongoing military operations, severe humanitarian crisis, "
                             "regional escalation risk involving Hezbollah, Houthi, and Iranian proxy forces.",
        "coordinates":       [[34.2,31.2],[34.6,31.2],[34.6,31.6],[34.2,31.6],[34.2,31.2]],
    },
    {
        "zone_id":           "SZONE-005",
        "name":              "South China Sea — Contested Waters",
        "zone_type":         "CONFLICT_FROZEN",
        "severity_baseline": "high",
        "colour":            "#FF9500",
        "description":       "Multiple overlapping territorial claims. China maintains artificial islands "
                             "and coast guard presence. Regular confrontations with Philippine, Vietnamese, "
                             "and US vessels.",
        "coordinates":       [[109.0,3.0],[121.0,3.0],[121.0,22.0],[109.0,22.0],[109.0,3.0]],
    },
    {
        "zone_id":           "SZONE-006",
        "name":              "Sahel Instability Belt",
        "zone_type":         "INSTABILITY",
        "severity_baseline": "high",
        "colour":            "#FF9500",
        "description":       "Persistent jihadist insurgency across Mali, Burkina Faso, Niger, Chad. "
                             "Multiple coup governments. Wagner/Russian presence expanding. "
                             "French forces withdrawn.",
        "coordinates":       [[-5.5,10.0],[23.0,10.0],[23.0,20.0],[-5.5,20.0],[-5.5,10.0]],
    },
    {
        "zone_id":           "SZONE-007",
        "name":              "Iranian Nuclear Corridor",
        "zone_type":         "NUCLEAR_SENSITIVE",
        "severity_baseline": "high",
        "colour":            "#5856D6",
        "description":       "Key Iranian nuclear and missile facilities including Natanz, Fordow, "
                             "Isfahan, and Parchin. Any activity here has direct implications for "
                             "regional security and JCPOA status.",
        "coordinates":       [[48.0,31.0],[54.0,31.0],[54.0,36.5],[48.0,36.5],[48.0,31.0]],
    },
    {
        "zone_id":           "SZONE-008",
        "name":              "Korean Peninsula",
        "zone_type":         "CONFLICT_FROZEN",
        "severity_baseline": "high",
        "colour":            "#FF9500",
        "description":       "Divided peninsula with active DPRK missile and nuclear program. "
                             "Regular provocations including ballistic missile tests. "
                             "US-ROK joint exercises trigger North Korean responses.",
        "coordinates":       [[124.0,34.0],[130.0,34.0],[130.0,42.5],[124.0,42.5],[124.0,34.0]],
    },
    {
        "zone_id":           "SZONE-009",
        "name":              "Myanmar Civil War",
        "zone_type":         "CONFLICT_ACTIVE",
        "severity_baseline": "high",
        "colour":            "#FF3B30",
        "description":       "Post-coup civil war between military junta and resistance forces. "
                             "Multiple ethnic armed organisations active. "
                             "Significant civilian displacement.",
        "coordinates":       [[92.0,10.0],[101.5,10.0],[101.5,28.5],[92.0,28.5],[92.0,10.0]],
    },
    {
        "zone_id":           "SZONE-010",
        "name":              "Horn of Africa — Maritime Risk",
        "zone_type":         "CHOKEPOINT_EXTENDED",
        "severity_baseline": "high",
        "colour":            "#FF9500",
        "description":       "High piracy risk and Houthi missile threat corridor connecting Red Sea "
                             "to Indian Ocean. Coalition naval patrols active. "
                             "Critical for global shipping.",
        "coordinates":       [[40.0,-5.0],[55.0,-5.0],[55.0,15.0],[40.0,15.0],[40.0,-5.0]],
    },
    {
        "zone_id":           "SZONE-011",
        "name":              "Baltic — Russian Pressure Zone",
        "zone_type":         "MILITARY_SENSITIVE",
        "severity_baseline": "medium",
        "colour":            "#FFCC00",
        "description":       "NATO-Russia frontier. Kaliningrad exclave hosts Russian nuclear-capable missiles. "
                             "Submarine cable vulnerability. Regular NATO-Russia air and naval incidents.",
        "coordinates":       [[9.0,53.5],[30.0,53.5],[30.0,65.0],[9.0,65.0],[9.0,53.5]],
    },
    {
        "zone_id":           "SZONE-012",
        "name":              "Syria — Fragmented Control",
        "zone_type":         "CONFLICT_FROZEN",
        "severity_baseline": "high",
        "colour":            "#FF9500",
        "description":       "Multiple armed factions control different regions. Regular Israeli strikes "
                             "on Iranian assets. US forces in northeast. Russian air base at Hmeimim. "
                             "Ongoing instability.",
        "coordinates":       [[35.5,32.5],[42.5,32.5],[42.5,37.5],[35.5,37.5],[35.5,32.5]],
    },
    {
        "zone_id":           "SZONE-013",
        "name":              "Strait of Hormuz Extended",
        "zone_type":         "CHOKEPOINT_EXTENDED",
        "severity_baseline": "high",
        "colour":            "#FF9500",
        "description":       "Extended Hormuz risk zone including Iranian coastal missile batteries, "
                             "IRGCN patrol areas, and critical tanker lanes. "
                             "Twenty-one percent of global petroleum transits daily.",
        "coordinates":       [[54.0,22.0],[60.0,22.0],[60.0,27.5],[54.0,27.5],[54.0,22.0]],
    },
    {
        "zone_id":           "SZONE-014",
        "name":              "Ethiopia — Tigray Aftermath",
        "zone_type":         "INSTABILITY",
        "severity_baseline": "medium",
        "colour":            "#FFCC00",
        "description":       "Post-conflict instability following Tigray war. Fragile ceasefire. "
                             "Ongoing Amhara and Oromo insurgencies. "
                             "Regional Horn of Africa implications.",
        "coordinates":       [[33.0,3.5],[48.0,3.5],[48.0,15.0],[33.0,15.0],[33.0,3.5]],
    },
    {
        "zone_id":           "SZONE-015",
        "name":              "Venezuela — Regional Instability",
        "zone_type":         "INSTABILITY",
        "severity_baseline": "medium",
        "colour":            "#FFCC00",
        "description":       "Political and economic crisis with regional spillover. "
                             "Essequibo territorial dispute with Guyana escalating. "
                             "Russian and Chinese military engagement.",
        "coordinates":       [[-73.5,0.5],[-59.5,0.5],[-59.5,12.5],[-73.5,12.5],[-73.5,0.5]],
    },
]


def _bbox_from_coords(coords: list) -> tuple[float, float, float, float]:
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    return min(lons), min(lats), max(lons), max(lats)


def seed_strategic_zones(db=None) -> dict:
    """
    Seed baseline strategic zones. Skips existing ones.
    Returns { inserted: int, skipped: int }.
    """
    from database import StrategicZone, OntologyEntity, get_db
    inserted = 0
    skipped  = 0

    ctx = get_db() if db is None else _null_ctx(db)
    with ctx as session:
        for z in _BASELINE_ZONES:
            existing = session.query(StrategicZone).filter_by(zone_id=z["zone_id"]).first()
            if existing:
                skipped += 1
                continue

            coords   = z["coordinates"]
            geojson  = json.dumps({"type": "Polygon", "coordinates": [coords]})
            min_lon, min_lat, max_lon, max_lat = _bbox_from_coords(coords)

            zone = StrategicZone(
                zone_id           = z["zone_id"],
                name              = z["name"],
                zone_type         = z["zone_type"],
                severity_baseline = z["severity_baseline"],
                polygon_geojson   = geojson,
                bbox_min_lon      = min_lon,
                bbox_min_lat      = min_lat,
                bbox_max_lon      = max_lon,
                bbox_max_lat      = max_lat,
                colour            = z["colour"],
                description       = z["description"],
                is_baseline       = True,
                enabled           = True,
                created_at        = datetime.datetime.utcnow(),
                zone_metadata     = json.dumps({
                    "severity_baseline": z["severity_baseline"],
                    "colour": z["colour"],
                }),
            )
            session.add(zone)

            # Register / update OntologyEntity
            oe = session.query(OntologyEntity).filter_by(system_id=z["zone_id"]).first()
            meta = json.dumps({
                "severity_baseline": z["severity_baseline"],
                "colour":            z["colour"],
                "description":       z["description"],
                "is_baseline":       True,
                "lat":               (min_lat + max_lat) / 2,
                "lon":               (min_lon + max_lon) / 2,
            })
            if oe:
                oe.name           = z["name"]
                oe.infra_type     = z["zone_type"]
                oe.entity_metadata = meta
            else:
                session.add(OntologyEntity(
                    system_id       = z["zone_id"],
                    entity_type     = "Strategic Zone",
                    name            = z["name"],
                    infra_type      = z["zone_type"],
                    entity_metadata = meta,
                ))

            inserted += 1

        session.commit()

    print(f"[seed-strategic-zones] inserted={inserted} skipped={skipped}")
    return {"inserted": inserted, "skipped": skipped}


class _null_ctx:
    """Allow passing an already-open DB session."""
    def __init__(self, db):
        self._db = db
    def __enter__(self):
        return self._db
    def __exit__(self, *_):
        pass


if __name__ == "__main__":
    import os, sys
    sys.path.insert(0, os.path.dirname(__file__))
    result = seed_strategic_zones()
    print(result)
