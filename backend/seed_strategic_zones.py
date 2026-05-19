"""
seed_strategic_zones.py — Seed hardcoded baseline strategic zones.

Run directly or imported by main.py startup.
Inserts zones that don't yet exist; skips existing ones.
Also registers each zone in OntologyEntity.
"""
from __future__ import annotations
import json
import datetime

_ZONE_IMAGES = {
    "SZONE-001": [
        "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e9/Bakhmut_during_the_battle_%282023-04-05%29%2C_frame_15989.jpg/800px-Bakhmut_during_the_battle_%282023-04-05%29%2C_frame_15989.jpg",
    ],
    "SZONE-002": [
        "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/Penghu_County_Montage.png/800px-Penghu_County_Montage.png",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/8/82/Bathymetry_and_ocean_currents_of_the_Taiwan_Strait_and_nearby_areas.png/800px-Bathymetry_and_ocean_currents_of_the_Taiwan_Strait_and_nearby_areas.png",
    ],
    "SZONE-003": [
        "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/%C2%A9Nile-Project_-Sari_Omer_0025.jpg/800px-%C2%A9Nile-Project_-Sari_Omer_0025.jpg",
    ],
    "SZONE-004": [
        "https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/Fires_in_Israel_and_the_Gaza_strip_-_7_October_2023_%2853245908850%29.jpg/800px-Fires_in_Israel_and_the_Gaza_strip_-_7_October_2023_%2853245908850%29.jpg",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/IDF_Iron_Dome_2021.jpg/800px-IDF_Iron_Dome_2021.jpg",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/Damage_in_Gaza_Strip_during_the_October_2023_-_29.jpg/800px-Damage_in_Gaza_Strip_during_the_October_2023_-_29.jpg",
    ],
    "SZONE-005": [
        "https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Scarborough_Shoal_Landsat.jpg/800px-Scarborough_Shoal_Landsat.jpg",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Mar_de_China_Meridional_-_BM_WMS_2004.jpg/800px-Mar_de_China_Meridional_-_BM_WMS_2004.jpg",
    ],
    "SZONE-006": [
        "https://upload.wikimedia.org/wikipedia/commons/thumb/7/79/Op%C3%A9ration_Barkhane.jpg/800px-Op%C3%A9ration_Barkhane.jpg",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/7/77/Place_de_la_libert%C3%A9_-_Bamako.jpg/800px-Place_de_la_libert%C3%A9_-_Bamako.jpg",
    ],
    "SZONE-007": [
        "https://upload.wikimedia.org/wikipedia/commons/thumb/8/82/Bushehr_Nuclear_Plant.jpg/800px-Bushehr_Nuclear_Plant.jpg",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Shrine_Complex_of_Sheikh_%27Abd_al-Samad%2C_Natanz_01.jpg/800px-Shrine_Complex_of_Sheikh_%27Abd_al-Samad%2C_Natanz_01.jpg",
    ],
    "SZONE-008": [
        "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e7/The_Arch_of_Triumph_%2811360607534%29.jpg/800px-The_Arch_of_Triumph_%2811360607534%29.jpg",
    ],
    "SZONE-009": [
        "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/ShwedagonPagoda.jpg/800px-ShwedagonPagoda.jpg",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f1/Mandalay_-_The_worship_of_Buddha.jpg/800px-Mandalay_-_The_worship_of_Buddha.jpg",
    ],
    "SZONE-010": [
        "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/Bab-el-Mandeb%2C_outer_space.jpg/800px-Bab-el-Mandeb%2C_outer_space.jpg",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/7/70/Envisat_image_of_the_Gulf_of_Aden_ESA219526.jpg/800px-Envisat_image_of_the_Gulf_of_Aden_ESA219526.jpg",
    ],
    "SZONE-011": [
        "https://upload.wikimedia.org/wikipedia/commons/thumb/8/83/The_Baltic_Sea.png/800px-The_Baltic_Sea.png",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Suomenlinna_%28cropped%29.jpg/800px-Suomenlinna_%28cropped%29.jpg",
    ],
    "SZONE-012": [
        "https://upload.wikimedia.org/wikipedia/commons/thumb/5/51/Aleppo_Citadel_entrance_-_seen_from_southeast_9933.jpg/800px-Aleppo_Citadel_entrance_-_seen_from_southeast_9933.jpg",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/2/22/Damascus_from_qasioun_mountain.jpg/800px-Damascus_from_qasioun_mountain.jpg",
    ],
    "SZONE-013": [
        "https://upload.wikimedia.org/wikipedia/commons/thumb/1/16/Strait_of_Hormuz_and_Musandam_Peninsula_%28MODIS_2018-12-10%29.jpg/800px-Strait_of_Hormuz_and_Musandam_Peninsula_%28MODIS_2018-12-10%29.jpg",
    ],
    "SZONE-014": [
        "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Addis_in_night.jpg/800px-Addis_in_night.jpg",
    ],
    "SZONE-015": [
        "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bd/Caracas_desde_el_%C3%A1vila.jpg/800px-Caracas_desde_el_%C3%A1vila.jpg",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fd/Juan_Guaid%C3%B3_february_2020.jpg/800px-Juan_Guaid%C3%B3_february_2020.jpg",
    ],
}

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
                # Patch images into zone_metadata if missing
                try:
                    meta = json.loads(existing.zone_metadata) if existing.zone_metadata else {}
                except Exception:
                    meta = {}
                images = _ZONE_IMAGES.get(z["zone_id"], [])
                if meta.get("images") != images:
                    meta["images"] = images
                    existing.zone_metadata = json.dumps(meta)
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
                    "colour":            z["colour"],
                    "images":            _ZONE_IMAGES.get(z["zone_id"], []),
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
