"""
coastal_targets.py — what a drone launched from a ship off Europe could reach.

THE THREAT MODEL (owner, 2026-10-11): a Russia-linked vessel loitering off a
European coast as a launch platform for fixed-wing Shahed-136/Geran-2-class
drones fired from containers. What counts as a target is broad on purpose:
airports, military bases, power, LNG and oil terminals, cable landings,
government buildings, and soft or symbolic targets such as stadiums and large
venues, because a "meaningless" object is a deniable one.

THE SET. Everything within `coastal_band_km` (300 km) of the sea in a
European country (russia_loiter_watch.EUROPE), labelled with one of the
weighted types in target_weights.json, and kept compact: the top N per
country per type by importance. Sources, all public:

  * airports table (OurAirports): large/medium airports are civil; a name
    that says air base / RAF / naval air station / Fliegerhorst … is military.
  * powerplants_cache.csv (WRI Global Power Plant Database): capacity >= 200 MW.
  * ports_cache.csv (World Port Index): large and medium ports; ports whose
    oil terminal facility is "Yes" also give an oil terminal.
  * landing_points table (TeleGeography): cable landing stations.
  * OpenStreetMap through Overpass, per sea region (Baltic, North Sea, …):
    military bases, refineries/oil terminals, high-voltage substations,
    stadiums (capacity >= 20k or a national/olympic stadium), malls and
    exhibition centres that have a Wikidata entry, data centres, main rail
    stations, defence-industry sites, and government offices in capitals.
    Public Overpass is slow and flaky: each region is fetched on its own,
    cached in DATA_DIR/coastal_targets.json and refreshed weekly; a region
    that fails keeps its previous copy.
  * A short curated list of LNG import terminals and publicly reported
    military-logistics/aid ports (approximate public coordinates) — OSM and
    the WPI barely tag LNG.

Never on the event loop: build_region()/build_static() do network and
shapely work and are run in a worker thread by main._coastal_targets_loop.
"""
from __future__ import annotations

import json
import math
import os
import re
import sqlite3
import threading
import time
import urllib.parse
import urllib.request
from typing import Callable, Iterable, Optional

TYPE_LABEL = {
    "airport_civil": "Civil airport", "airport_military": "Military airfield",
    "military_base": "Military base", "arms_industry": "Defence industry",
    "logistics_aid_hub": "Military logistics / aid hub", "power_plant": "Power plant",
    "substation": "High-voltage substation", "lng_terminal": "LNG terminal",
    "oil_terminal": "Oil terminal / refinery", "port": "Port",
    "cable_landing": "Cable landing station", "rail_hub": "Main rail station",
    "government": "Government building", "stadium_venue": "Stadium / large venue",
    "shopping_centre": "Shopping centre", "data_centre": "Data centre",
}

# Sea regions, (south, west, north, east): each box reaches 300 km inland
# from its coast. They overlap; items are de-duplicated on merge.
REGIONS: dict[str, tuple[float, float, float, float]] = {
    "baltic": (53.0, 9.0, 66.5, 30.5),
    "north_sea": (49.5, -6.0, 62.0, 12.5),
    "atlantic_isles": (49.5, -11.0, 61.0, -2.0),
    "norway_arctic": (62.0, 4.0, 71.5, 31.5),
    "biscay_iberia": (36.0, -10.0, 49.5, 1.5),
    "west_med": (35.5, -6.0, 45.5, 10.5),
    "central_med": (35.0, 8.0, 47.0, 21.0),
    "east_med": (34.5, 19.0, 42.5, 35.0),
    "black_sea": (41.5, 22.0, 48.5, 32.0),
}

# European capitals, for the government query (OSM office=government is
# everywhere; only the national seats matter here). Public coordinates.
CAPITALS = {
    "Lisbon": (38.7223, -9.1393), "Madrid": (40.4168, -3.7038), "Paris": (48.8566, 2.3522),
    "London": (51.5007, -0.1246), "Dublin": (53.3498, -6.2603), "Brussels": (50.8466, 4.3528),
    "Amsterdam": (52.3676, 4.9041), "The Hague": (52.0799, 4.3113), "Luxembourg": (49.6116, 6.1319),
    "Berlin": (52.5200, 13.4050), "Copenhagen": (55.6761, 12.5683), "Oslo": (59.9139, 10.7522),
    "Stockholm": (59.3293, 18.0686), "Helsinki": (60.1699, 24.9384), "Tallinn": (59.4370, 24.7536),
    "Riga": (56.9496, 24.1052), "Vilnius": (54.6872, 25.2797), "Warsaw": (52.2297, 21.0122),
    "Ljubljana": (46.0569, 14.5058), "Zagreb": (45.8150, 15.9819), "Sarajevo": (43.8563, 18.4131),
    "Podgorica": (42.4304, 19.2594), "Tirana": (41.3275, 19.8187), "Athens": (37.9755, 23.7348),
    "Sofia": (42.6977, 23.3219), "Bucharest": (44.4268, 26.1025), "Chisinau": (47.0105, 28.8638),
    "Rome": (41.9028, 12.4964), "Valletta": (35.8989, 14.5146), "Nicosia": (35.1856, 33.3823),
    "Reykjavik": (64.1466, -21.9426), "Monaco": (43.7384, 7.4246), "Torshavn": (62.0079, -6.7900),
    "Belgrade": (44.7866, 20.4489), "Skopje": (41.9981, 21.4254), "Kyiv": (50.4501, 30.5234),
}

# Curated, public, approximate (+-2 km): Europe's LNG import terminals and
# ports publicly reported as hubs for military logistics or aid to Ukraine.
CURATED = [
    ("lng_terminal", "Świnoujście LNG terminal", 53.909, 14.272),
    ("lng_terminal", "Klaipėda FSRU (Independence)", 55.680, 21.115),
    ("lng_terminal", "Inkoo FSRU (Exemplar)", 60.040, 24.000),
    ("lng_terminal", "Hamina LNG terminal", 60.560, 27.200),
    ("lng_terminal", "Wilhelmshaven LNG terminal", 53.565, 8.150),
    ("lng_terminal", "Brunsbüttel LNG terminal", 53.890, 9.200),
    ("lng_terminal", "Mukran LNG terminal (Deutsche Ostsee)", 54.480, 13.620),
    ("lng_terminal", "Eemshaven LNG terminal", 53.450, 6.830),
    ("lng_terminal", "Gate LNG terminal (Rotterdam)", 51.970, 4.060),
    ("lng_terminal", "Zeebrugge LNG terminal", 51.350, 3.200),
    ("lng_terminal", "Dunkirk LNG terminal", 51.030, 2.250),
    ("lng_terminal", "Le Havre FSRU", 49.470, 0.200),
    ("lng_terminal", "Montoir-de-Bretagne LNG terminal", 47.310, -2.150),
    ("lng_terminal", "Fos Cavaou LNG terminal", 43.400, 4.870),
    ("lng_terminal", "Isle of Grain LNG terminal", 51.440, 0.710),
    ("lng_terminal", "South Hook LNG terminal (Milford Haven)", 51.700, -5.100),
    ("lng_terminal", "Dragon LNG terminal (Milford Haven)", 51.690, -4.980),
    ("lng_terminal", "Barcelona LNG terminal", 41.340, 2.150),
    ("lng_terminal", "Huelva LNG terminal", 37.140, -6.930),
    ("lng_terminal", "Cartagena LNG terminal", 37.570, -0.960),
    ("lng_terminal", "Bilbao LNG terminal", 43.350, -3.070),
    ("lng_terminal", "Mugardos LNG terminal", 43.460, -8.250),
    ("lng_terminal", "Sagunto LNG terminal", 39.640, -0.210),
    ("lng_terminal", "Sines LNG terminal", 37.940, -8.850),
    ("lng_terminal", "Panigaglia LNG terminal", 44.070, 9.850),
    ("lng_terminal", "Adriatic LNG (offshore Rovigo)", 45.090, 12.590),
    ("lng_terminal", "OLT Offshore LNG Toscana", 43.650, 9.990),
    ("lng_terminal", "Piombino FSRU", 42.930, 10.530),
    ("lng_terminal", "Revithoussa LNG terminal", 37.960, 23.400),
    ("lng_terminal", "Alexandroupolis FSRU", 40.750, 25.850),
    ("lng_terminal", "Krk LNG terminal", 45.230, 14.550),
    ("lng_terminal", "Delimara LNG (Malta)", 35.830, 14.550),
    ("lng_terminal", "Hammerfest LNG (Melkøya)", 70.690, 23.600),
    ("logistics_aid_hub", "Port of Bremerhaven (military logistics)", 53.560, 8.560),
    ("logistics_aid_hub", "Port of Gdynia (military logistics)", 54.530, 18.550),
    ("logistics_aid_hub", "Port of Constanța (aid corridor)", 44.170, 28.660),
    ("logistics_aid_hub", "Port of Alexandroupolis (military logistics)", 40.840, 25.880),
    ("logistics_aid_hub", "Rzeszów–Jasionka airport (aid hub)", 50.110, 22.020),
]

_MIL_AIRPORT = re.compile(
    r"air ?base|\bAB\b|\bRAF\b|royal air force|naval air|air station|\bNAS\b|military|fliegerhorst|"
    r"base a[ée]rienne|\bBA ?\d|base a[ée]rea|aeroporto militare|flyvestation|flystasjon|"
    r"lotnisko wojskowe|baza lotnicza|air force|airbase|army airfield|marineflieger|vliegbasis|"
    r"luchtmacht|flygflottilj|\bF ?\d{1,2}\b|lentotukikohta|naval station|aer[óo]dromo militar|"
    r"flugplatz .*bundeswehr|heeresflieger|jagdgeschwader|wing\b", re.I)
_DEFENCE = ("Rheinmetall|BAE Systems|Saab|Nammo|Thales|Leonardo|KNDS|Krauss|Naval Group|MBDA|Kongsberg|"
            "Patria|Fincantieri|Navantia|Damen|Babcock|thyssenkrupp Marine|TKMS|Diehl|Hensoldt|"
            "Airbus Defence|Huta Stalowa|PGZ|Mesko|Bofors|Eurenco|Nexter|Dassault|Safran|Indra|"
            "Santa B[áa]rbara|Expal|Roxel|Arquus|Lürssen|Naval Yard|Orlogsværft|Arsenal")
_STADIUM_NAME = re.compile(r"national|nacional|nazionale|olymp|olimp|wembley|stade de france|"
                           r"parken|friends arena|strawberry|ullevi|ullevaal|ullevål|"
                           r"narodowy|nationaal|krest|johan cruijff|santiago bernab|camp nou", re.I)
_RAIL_MAIN = ("Hauptbahnhof|Hbf|Central|Centraal|Centrale|Termini|Centralstation|Hovedbanegård|"
              "Główny|rautatieasema|Keskus|Gare du Nord|Gare de Lyon|Gare Saint-Lazare|Gare Montparnasse|"
              "King's Cross|Euston|Paddington|Waterloo|Victoria|Liverpool Street|Atocha|Chamartín|"
              "Santa Apolónia|Oriente|Sants|Bruxelles-Midi|Brussel-Zuid|Zentralbahnhof")

# kumi first: measured 2026-10-11, the main instance and mail.ru answered
# 504 to anything bigger than a city while kumi returned in ~10 s.
_OVERPASS_URLS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


# ── geography: which European country, how far from the sea ───────────────

class Geography:
    """Country polygons (backend/geo/countries.geojson) for point-in-country,
    and the COASTLINE: the exterior of all land in the region dissolved into
    one, so a land border is never mistaken for a coast."""

    def __init__(self, geojson_path: str, box=(-35.0, 25.0, 50.0, 75.0)):
        from shapely.geometry import shape, box as _box
        from shapely.strtree import STRtree
        from shapely.ops import unary_union
        import russia_loiter_watch as rlw
        clip = _box(*box)
        geoms, names, land = [], [], []
        with open(geojson_path, encoding="utf-8") as fh:
            feats = json.load(fh).get("features", [])
        for f in feats:
            p = f.get("properties") or {}
            name = (p.get("name") or p.get("n") or "").strip()
            try:
                g = shape(f["geometry"]).buffer(0)
            except Exception:                                   # noqa: BLE001
                continue
            if not g.intersects(clip):
                continue
            g = g.intersection(clip)
            land.append(g.simplify(0.01, preserve_topology=True))
            if name in rlw.EUROPE:
                geoms.append(g)
                names.append(name)
        self.europe = rlw.EUROPE
        self.geoms, self.names = geoms, names
        self.tree = STRtree(geoms) if geoms else None
        # Coastline: exterior rings of the dissolved land, in short chunks.
        merged = unary_union(land)
        chunks = []
        from shapely.geometry import LineString
        for poly in getattr(merged, "geoms", [merged]):
            if poly.geom_type != "Polygon":
                continue
            ring = list(poly.exterior.coords)
            for i in range(0, len(ring) - 1, 40):
                part = ring[i:i + 41]
                if len(part) >= 2:
                    seg = LineString(part)
                    # the clip box edge is not a coast
                    if not _on_box_edge(seg, box):
                        chunks.append(seg)
        self.coast = chunks
        self.coast_tree = STRtree(chunks) if chunks else None

    def country(self, lat: float, lon: float) -> Optional[tuple[str, str]]:
        """(dataset name, ISO2) when the point is in a European country."""
        if self.tree is None:
            return None
        from shapely.geometry import Point
        pt = Point(lon, lat)
        for i in self.tree.query(pt):
            if self.geoms[int(i)].covers(pt):
                name = self.names[int(i)]
                return name, self.europe[name][0]
        # A coastal site can sit just outside the simplified polygon.
        best = None
        for i in self.tree.query(pt.buffer(0.05)):
            d = self.geoms[int(i)].distance(pt)
            if d <= 0.05 and (best is None or d < best[0]):
                best = (d, self.names[int(i)])
        return (best[1], self.europe[best[1]][0]) if best else None

    def coast_km(self, lat: float, lon: float, cap_km: float = 400.0) -> Optional[float]:
        """Distance to the nearest sea coast, or None beyond cap_km."""
        if self.coast_tree is None:
            return None
        import shapely
        from shapely.geometry import box as _box, Point
        kx = 111.320 * max(0.05, math.cos(math.radians(lat)))
        ky = 110.574
        dlon, dlat = cap_km / kx, cap_km / ky
        best = None
        import numpy as np

        def to_km(c):
            return np.column_stack(((c[:, 0] - lon) * kx, (c[:, 1] - lat) * ky))
        origin = Point(0.0, 0.0)
        for i in self.coast_tree.query(_box(lon - dlon, lat - dlat, lon + dlon, lat + dlat)):
            d = float(shapely.transform(self.coast[int(i)], to_km).distance(origin))
            if best is None or d < best:
                best = d
        return best if best is not None and best <= cap_km else None


def _on_box_edge(seg, box) -> bool:
    (x0, y0, x1, y1) = box
    xs = [c[0] for c in seg.coords]
    ys = [c[1] for c in seg.coords]
    eps = 1e-6
    return (all(abs(x - x0) < eps for x in xs) or all(abs(x - x1) < eps for x in xs)
            or all(abs(y - y0) < eps for y in ys) or all(abs(y - y1) < eps for y in ys))


# ── items ─────────────────────────────────────────────────────────────────

def item(ttype: str, name: str, lat: float, lon: float, importance: float, source: str,
         **extra) -> dict:
    out = {"type": ttype, "name": (name or "").strip() or TYPE_LABEL.get(ttype, ttype),
           "lat": round(float(lat), 5), "lon": round(float(lon), 5),
           "importance": round(max(0.05, min(1.0, float(importance))), 3), "source": source}
    for k, v in extra.items():
        if v not in (None, "", []):
            out[k] = v
    return out


def static_items(db_path: Optional[str], code_dir: str, min_mw: float = 200.0) -> list[dict]:
    """Airports, power plants, ports, cable landings and the curated list —
    no network. Unfiltered by geography (place_and_cap does that)."""
    import csv
    out: list[dict] = []
    if db_path and os.path.exists(db_path):
        con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=30)
        try:
            for name, atype, lat, lon, icao in con.execute(
                    "SELECT airport_name, airport_type, latitude, longitude, icao_code FROM airports "
                    "WHERE latitude BETWEEN 27 AND 72 AND longitude BETWEEN -32 AND 45 "
                    "AND airport_type IN ('large_airport','medium_airport','small_airport')"):
                mil = bool(_MIL_AIRPORT.search(name or ""))
                if atype == "small_airport" and not mil:
                    continue
                if mil:
                    out.append(item("airport_military", name, lat, lon,
                                    0.6 if atype == "small_airport" else 0.9, "OurAirports", icao=icao))
                else:
                    out.append(item("airport_civil", name, lat, lon,
                                    1.0 if atype == "large_airport" else 0.55, "OurAirports", icao=icao))
            try:
                for name, lat, lon, cables in con.execute(
                        "SELECT name, latitude, longitude, cable_ids FROM landing_points "
                        "WHERE latitude BETWEEN 27 AND 72 AND longitude BETWEEN -32 AND 45"):
                    n = len([c for c in str(cables or "").split(",") if c.strip()])
                    out.append(item("cable_landing", f"Cable landing, {name}", lat, lon,
                                    max(0.4, min(1.0, n / 5)), "TeleGeography", cables=n))
            except sqlite3.Error as e:
                print(f"[coastal-targets] error: landing points unreadable: {e}")
        finally:
            con.close()
    pp = os.path.join(code_dir, "powerplants_cache.csv")
    if os.path.exists(pp):
        with open(pp, encoding="utf-8", newline="") as fh:
            for r in csv.DictReader(fh):
                try:
                    lat, lon, mw = float(r["latitude"]), float(r["longitude"]), float(r["capacity_mw"] or 0)
                except (TypeError, ValueError):
                    continue
                if not (27 <= lat <= 72 and -32 <= lon <= 45) or mw < min_mw:
                    continue
                fuel = (r.get("primary_fuel") or "").strip()
                imp = min(1.0, mw / 2000.0) + (0.3 if fuel == "Nuclear" else 0.0)
                out.append(item("power_plant", r.get("name"), lat, lon, imp, "Global Power Plant Database",
                                capacity_mw=round(mw), fuel=fuel))
    wpi = os.path.join(code_dir, "ports_cache.csv")
    if os.path.exists(wpi):
        with open(wpi, encoding="utf-8-sig", newline="") as fh:
            for r in csv.DictReader(fh):
                try:
                    lat, lon = float(r["Latitude"]), float(r["Longitude"])
                except (TypeError, ValueError, KeyError):
                    continue
                if not (27 <= lat <= 72 and -32 <= lon <= 45):
                    continue
                size = (r.get("Harbor Size") or "").strip()
                name = (r.get("Main Port Name") or "").strip()
                if size in ("Large", "Medium"):
                    out.append(item("port", f"Port of {name}", lat, lon, 1.0 if size == "Large" else 0.6,
                                    "World Port Index"))
                    if (r.get("Facilities - Oil Terminal") or "").strip() == "Yes":
                        out.append(item("oil_terminal", f"{name} oil terminal", lat, lon,
                                        0.7 if size == "Large" else 0.5, "World Port Index"))
                lng = (r.get("Liquified Natural Gas Terminal Depth (m)") or "").strip()
                try:
                    if float(lng or 0) > 0:
                        out.append(item("lng_terminal", f"{name} LNG terminal", lat, lon, 0.9, "World Port Index"))
                except ValueError:
                    pass
    for ttype, name, lat, lon in CURATED:
        out.append(item(ttype, name, lat, lon, 1.0, "curated public list (approximate)"))
    return out


# ── OpenStreetMap ─────────────────────────────────────────────────────────

TILE_DEG = (3.0, 5.0)        # lat, lon — big unions over a whole sea time out on public Overpass


def tiles(region: str) -> list[tuple[float, float, float, float]]:
    s, w, n, e = REGIONS[region]
    out = []
    lat = s
    while lat < n:
        lon = w
        while lon < e:
            out.append((round(lat, 3), round(lon, 3), round(min(n, lat + TILE_DEG[0]), 3), round(min(e, lon + TILE_DEG[1]), 3)))
            lon += TILE_DEG[1]
        lat += TILE_DEG[0]
    return out


def overpass_queries(region: str) -> list[str]:
    """Two small queries per tile (military/energy/industry; civic)."""
    out = []
    for (s, w, n, e) in tiles(region):
        bb = f"({s},{w},{n},{e})"
        out.append(f"""[out:json][timeout:90];
(
  nwr["military"~"^(base|airfield|naval_base)$"]{bb};
  way["landuse"="military"]["name"]{bb};
  relation["landuse"="military"]["name"]{bb};
  nwr["industrial"~"^(refinery|oil|oil_terminal|lng|gas_terminal|liquefied_natural_gas)$"]{bb};
  nwr["power"="substation"]["voltage"~"(^|;)(380000|400000|330000|420000)"]{bb};
  nwr["landuse"="industrial"]["name"~"{_DEFENCE}"]{bb};
);
out center tags;""")
        out.append(f"""[out:json][timeout:90];
(
  nwr["leisure"="stadium"]["capacity"]{bb};
  nwr["leisure"="stadium"]["name"~"National|Nacional|Nazionale|Olymp|Olimp|Narodowy|Nationaal|Wembley|Stade de France|Parken",i]{bb};
  nwr["shop"="mall"]["wikidata"]{bb};
  nwr["amenity"~"^(exhibition_centre|conference_centre)$"]["wikidata"]{bb};
  nwr["telecom"="data_center"]{bb};
  nwr["building"="data_center"]["name"]{bb};
  nwr["railway"="station"]["name"~"{_RAIL_MAIN}"]{bb};
);
out center tags;""")
    return out


def capitals_queries(chunk: int = 6) -> list[str]:
    caps = list(CAPITALS.values())
    out = []
    for i in range(0, len(caps), chunk):
        parts = "\n".join(f'  nwr["office"="government"]["name"](around:3500,{lat},{lon});'
                          for lat, lon in caps[i:i + chunk])
        out.append(f"[out:json][timeout:90];\n(\n{parts}\n);\nout center tags;")
    return out


def fetch_overpass(query: str, retries: int = 3, timeout: int = 120) -> Optional[dict]:
    """None on failure (the caller keeps the old copy and logs loudly)."""
    data = urllib.parse.urlencode({"data": query}).encode()
    for attempt in range(retries):
        url = _OVERPASS_URLS[attempt % len(_OVERPASS_URLS)]
        try:
            req = urllib.request.Request(url, data=data, headers={
                "User-Agent": "Parallax-coastal-targets/1.0", "Content-Type": "application/x-www-form-urlencoded"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                out = json.loads(resp.read())
            if out.get("remark") and "runtime error" in str(out.get("remark")):
                raise RuntimeError(str(out["remark"])[:160])
            return out
        except Exception as e:                                  # noqa: BLE001
            print(f"[coastal-targets] overpass attempt {attempt + 1} failed ({url}): {type(e).__name__}: {e}")
            time.sleep(5 * (attempt + 1))
    return None


def _num(v) -> Optional[float]:
    try:
        return float(re.sub(r"[^\d.]", "", str(v).split(";")[0].replace(",", "")) or "x")
    except ValueError:
        return None


def classify_osm(el: dict, stadium_min: int = 20000) -> Optional[dict]:
    """One Overpass element -> a target item, or None."""
    t = el.get("tags") or {}
    lat = el.get("lat", (el.get("center") or {}).get("lat"))
    lon = el.get("lon", (el.get("center") or {}).get("lon"))
    if lat is None or lon is None:
        return None
    name = t.get("name:en") or t.get("name") or ""
    wd = 0.2 if t.get("wikidata") else 0.0
    osm = f"{el.get('type')}/{el.get('id')}"
    mil = t.get("military")
    if mil in ("base", "airfield", "naval_base"):
        imp = {"naval_base": 1.0, "airfield": 0.9, "base": 0.8}[mil] + wd
        return item("military_base", name or f"Military {mil.replace('_', ' ')}", lat, lon, imp, "OpenStreetMap",
                    osm=osm, kind=mil)
    if t.get("landuse") == "military" and name:
        return item("military_base", name, lat, lon, 0.5 + wd, "OpenStreetMap", osm=osm)
    if t.get("name") and re.search(_DEFENCE, t.get("name") or "", re.I) and (
            t.get("landuse") == "industrial" or t.get("industrial")):
        return item("arms_industry", name, lat, lon, 0.8 + wd, "OpenStreetMap", osm=osm)
    ind = t.get("industrial") or ""
    if ind in ("lng", "liquefied_natural_gas", "gas_terminal"):
        return item("lng_terminal", name or "LNG terminal", lat, lon, 0.9, "OpenStreetMap", osm=osm)
    if ind in ("refinery", "oil", "oil_terminal"):
        return item("oil_terminal", name or ("Refinery" if ind == "refinery" else "Oil terminal"), lat, lon,
                    (0.9 if ind == "refinery" else 0.6) + wd, "OpenStreetMap", osm=osm)
    if t.get("power") == "substation":
        v = max((_num(x) or 0) for x in str(t.get("voltage") or "0").split(";"))
        return item("substation", name or f"{int(v / 1000)} kV substation", lat, lon,
                    0.8 if v >= 380000 else 0.6, "OpenStreetMap", osm=osm, kv=int(v / 1000) if v else None)
    if t.get("leisure") == "stadium":
        cap = _num(t.get("capacity"))
        if cap and cap >= stadium_min:
            return item("stadium_venue", name or "Stadium", lat, lon, min(1.0, cap / 80000) + wd,
                        "OpenStreetMap", osm=osm, capacity=int(cap))
        if not cap and name and _STADIUM_NAME.search(name):
            return item("stadium_venue", name, lat, lon, 0.6 + wd, "OpenStreetMap", osm=osm)
        return None
    if t.get("shop") == "mall":
        return item("shopping_centre", name or "Shopping centre", lat, lon, 0.5 + wd, "OpenStreetMap", osm=osm)
    if t.get("amenity") in ("exhibition_centre", "conference_centre"):
        return item("stadium_venue", name or "Exhibition centre", lat, lon, 0.5 + wd, "OpenStreetMap", osm=osm)
    if t.get("telecom") == "data_center" or t.get("building") == "data_center":
        return item("data_centre", name or "Data centre", lat, lon, 0.6 + wd, "OpenStreetMap", osm=osm,
                    operator=t.get("operator"))
    if t.get("railway") == "station":
        if t.get("station") in ("subway", "light_rail", "monorail") or not name:
            return None
        return item("rail_hub", name, lat, lon, 0.6 + wd, "OpenStreetMap", osm=osm)
    if t.get("office") == "government" and name:
        g = (t.get("government") or "").lower()
        high = any(k in g for k in ("ministry", "parliament", "presidency", "prime_minister", "legislative", "defence"))
        return item("government", name, lat, lon, (0.85 if high else 0.6) + wd, "OpenStreetMap", osm=osm)
    return None


def osm_items(elements: Iterable[dict], stadium_min: int = 20000) -> list[dict]:
    out = []
    for el in elements or []:
        try:
            it = classify_osm(el, stadium_min)
        except Exception as e:                                  # noqa: BLE001
            print(f"[coastal-targets] error: element {el.get('id')}: {type(e).__name__}: {e}")
            continue
        if it:
            out.append(it)
    return out


# ── placing, de-duplicating, capping ──────────────────────────────────────

def dedupe(items: list[dict], km: float = 1.5) -> list[dict]:
    """One item per type per place: the most important wins. A military
    base within 3 km of a military airfield (either way round) is the same
    site."""
    items = sorted(items, key=lambda x: -x["importance"])
    grid: dict = {}
    out = []
    for it in items:
        key = (round(it["lat"] * 20), round(it["lon"] * 20))
        dup = False
        near_types = {it["type"]}
        # a military airfield from OurAirports and the same base from OSM or
        # Wikidata (Ämari Air Base, twice) are one site
        if it["type"] in ("military_base", "airport_military"):
            near_types |= {"military_base", "airport_military"}
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for o in grid.get((key[0] + dy, key[1] + dx), ()):
                    if o["type"] in near_types:
                        lim = 3.0 if o["type"] != it["type"] else km
                        if haversine_km(it["lat"], it["lon"], o["lat"], o["lon"]) <= lim:
                            dup = True
                            break
                if dup:
                    break
            if dup:
                break
        if not dup:
            grid.setdefault(key, []).append(it)
            out.append(it)
    return out


def place_and_cap(items: list[dict], geo: Geography, band_km: float, caps: dict) -> list[dict]:
    """Keep what lies in a European country within band_km of the sea,
    with its country and coast distance; then the top N per country/type."""
    placed = []
    for it in items:
        if "iso2" not in it:
            c = geo.country(it["lat"], it["lon"])
            if not c:
                continue
            it["country"], it["iso2"] = c
        if "coast_km" not in it:
            d = geo.coast_km(it["lat"], it["lon"], cap_km=band_km)
            if d is None:
                continue
            it["coast_km"] = round(d, 1)
        if it["coast_km"] <= band_km:
            placed.append(it)
    return cap(placed, caps)


def cap(items: list[dict], caps: dict) -> list[dict]:
    groups: dict = {}
    for it in items:
        groups.setdefault((it.get("iso2"), it["type"]), []).append(it)
    out = []
    for (iso, t), lst in groups.items():
        lst.sort(key=lambda x: -x["importance"])
        out.extend(lst[: int(caps.get(t, 10))])
    return out


# ── the cache ─────────────────────────────────────────────────────────────

def cache_path() -> str:
    import paths
    return str(paths.DATA_DIR / "coastal_targets.json")


def load_cache(path: Optional[str] = None) -> dict:
    explicit = path is not None
    path = path or cache_path()
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        # A fresh server starts from the copy shipped with the code (built
        # 2026-10-11, Baltic and North Sea) until its own weekly refresh
        # succeeds — public Overpass is often down for hours.
        if not explicit:
            import paths
            seed = paths.CODE_DIR / "data" / "coastal_targets.json"
            if str(seed) != path and seed.exists():
                try:
                    with open(seed, encoding="utf-8") as fh:
                        return json.load(fh)
                except (OSError, ValueError):
                    pass
        return {"version": 1, "static": [], "regions": {}, "osm": {}}
    except (OSError, ValueError) as e:
        print(f"[coastal-targets] error: cache unreadable ({path}): {type(e).__name__}: {e}")
        return {"version": 1, "static": [], "regions": {}, "osm": {}}


def save_cache(data: dict, path: Optional[str] = None) -> None:
    path = path or cache_path()
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


_GEO: Optional[Geography] = None
_GEO_LOCK = threading.Lock()


def geography() -> Geography:
    global _GEO
    with _GEO_LOCK:
        if _GEO is None:
            import paths
            t0 = time.monotonic()
            _GEO = Geography(str(paths.CODE_DIR / "geo" / "countries.geojson"))
            print(f"[coastal-targets] geography ready: {len(_GEO.geoms)} European polygons, "
                  f"{len(_GEO.coast)} coast chunks in {time.monotonic() - t0:.1f}s")
        return _GEO


def build_static(cfg: dict, data: dict, db_path: Optional[str] = None) -> int:
    import paths
    tc = cfg["targets"]
    raw = static_items(db_path or str(paths.DB_PATH), str(paths.CODE_DIR), float(tc.get("power_plant_min_mw", 200)))
    kept = place_and_cap(dedupe(raw), geography(), tc["coastal_band_km"], tc["per_country_per_type"])
    data["static"] = kept
    data["static_built_at"] = time.time()
    return len(kept)


def build_region(region: str, cfg: dict, data: dict,
                 fetch: Callable[[str], Optional[dict]] = fetch_overpass, pause_s: float = 2.0,
                 now: Optional[float] = None) -> Optional[int]:
    """Fetch one region from Overpass, TILE BY TILE: each query's result is
    cached on its own (data["tiles"]), so a public-Overpass outage costs only
    the tiles it hit, and the next pass retries just those. The region's
    item list is rebuilt from every tile it has. Returns the region's count,
    or None when no tile has ever succeeded."""
    tc = cfg["targets"]
    now = now or time.time()
    fresh_s = float(tc.get("refresh_days", 7)) * 86400
    tiles_d = data.setdefault("tiles", {})
    caps2 = {k: 2 * int(v) for k, v in tc["per_country_per_type"].items()}
    qs = overpass_queries(region)
    failed = fetched = 0
    for i, q in enumerate(qs):
        key = f"{region}:{i}"
        t = tiles_d.get(key)
        if t and now - t.get("built_at", 0) < fresh_s:
            continue
        if fetched or failed:
            time.sleep(pause_s)
        res = fetch(q)
        if res is None:
            failed += 1
            continue
        fetched += 1
        its = osm_items(res.get("elements") or [], int(tc.get("stadium_min_capacity", 20000)))
        tiles_d[key] = {"built_at": now, "elements": len(res.get("elements") or []),
                        "items": place_and_cap(dedupe(its), geography(), tc["coastal_band_km"], caps2)}
    have = [tiles_d[f"{region}:{i}"] for i in range(len(qs)) if f"{region}:{i}" in tiles_d]
    st = {"tiles_done": len(have), "tiles": len(qs), "failed_now": failed, "tried_at": now}
    if not have:
        data.setdefault("regions", {})[region] = {**(data.get("regions", {}).get(region) or {}), **st,
                                                  "error": "overpass failed on every tile"}
        print(f"[coastal-targets] error: region {region}: Overpass failed on all {len(qs)} queries")
        return None
    allx = [it for t in have for it in t["items"]]
    kept = cap(dedupe(allx), caps2)
    data.setdefault("osm", {})[region] = kept
    if len(have) == len(qs):
        st["built_at"] = min(t["built_at"] for t in have)
    else:
        st["error"] = f"{len(qs) - len(have)}/{len(qs)} tiles missing (Overpass failures); retried next pass"
    st["count"] = len(kept)
    data.setdefault("regions", {})[region] = st
    if failed:
        print(f"[coastal-targets] error: region {region}: {failed} Overpass queries failed this pass; "
              f"{len(have)}/{len(qs)} tiles cached")
    return len(kept)


# ── Wikidata (a second public source; answers when Overpass does not) ─────

WIKIDATA_URL = "https://query.wikidata.org/sparql"
WIKIDATA_CLASSES = {
    "military_base": ["Q245016", "Q695850", "Q1324633", "Q18691599"],   # military base, airbase, naval base, installation
    "stadium_venue": ["Q483110", "Q641226"],                            # stadium, arena (capacity filtered)
    "lng_terminal": ["Q15709854"],
    "oil_terminal": ["Q12353044", "Q592856"],                           # refinery, oil terminal
    "government": ["Q30124446", "Q2114972", "Q109568071", "Q481289"],   # legislature, presidential palace, ministry, official residence
    "data_centre": ["Q671224"],
    "shopping_centre": ["Q11315"],
    "rail_hub": ["Q18543139"],                                          # central station
}


def wikidata_query(ttype: str) -> str:
    """Class membership with a coordinate — worldwide, filtered to Europe in
    Python. Measured 2026-10-11: joining on country (P17/P297) and the label
    SERVICE ran past Wikidata's 60 s limit; this shape answers in ~5 s."""
    vals = " ".join(f"wd:{q}" for q in WIKIDATA_CLASSES[ttype])
    cap = "OPTIONAL { ?i wdt:P1083 ?cap }" if ttype == "stadium_venue" else ""
    return f"""SELECT ?i ?c ?links (SAMPLE(?en) AS ?iLabel) (SAMPLE(?any) AS ?alt) (MAX(?cap) AS ?capacity) WHERE {{
  VALUES ?t {{ {vals} }}
  ?i wdt:P31 ?t ; wdt:P625 ?c ; wikibase:sitelinks ?links .
  FILTER NOT EXISTS {{ ?i wdt:P576 ?gone }}
  {cap}
  OPTIONAL {{ ?i rdfs:label ?en FILTER(LANG(?en) = "en") }}
  OPTIONAL {{ ?i rdfs:label ?any FILTER(LANG(?any) IN ("mul","de","fr","es","it","pl","sv","da","nb","fi","nl","pt","el","ro","bg","hr","et","lv","lt")) }}
}} GROUP BY ?i ?c ?links"""


def fetch_wikidata(query: str, timeout: int = 90) -> Optional[dict]:
    for attempt in range(2):
        try:
            req = urllib.request.Request(WIKIDATA_URL, data=urllib.parse.urlencode({"query": query}).encode(),
                                         headers={"Accept": "application/sparql-results+json",
                                                  "User-Agent": "Parallax-coastal-targets/1.0",
                                                  "Content-Type": "application/x-www-form-urlencoded"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read())
        except Exception as e:                                  # noqa: BLE001
            print(f"[coastal-targets] wikidata attempt {attempt + 1} failed: {type(e).__name__}: {e}")
            time.sleep(5)
    return None


_POINT = re.compile(r"Point\(([-\d.eE]+) ([-\d.eE]+)\)")


def wikidata_items(ttype: str, bindings: Iterable[dict], stadium_min: int = 20000) -> list[dict]:
    out = []
    for b in bindings or []:
        m = _POINT.match((b.get("c") or {}).get("value") or "")
        if not m:
            continue
        lon, lat = float(m.group(1)), float(m.group(2))
        if not (27 <= lat <= 72 and -32 <= lon <= 45):
            continue
        name = (b.get("iLabel") or {}).get("value") or (b.get("alt") or {}).get("value") or ""
        qid = ((b.get("i") or {}).get("value") or "").rsplit("/", 1)[-1]
        if not name or re.fullmatch(r"Q\d+", name):
            continue                                            # no label in any language we read
        links = int(float((b.get("links") or {}).get("value") or 0))
        imp = 0.4 + min(0.6, links / 40.0)
        extra = {}
        if ttype == "stadium_venue":
            cap_v = _num((b.get("capacity") or {}).get("value"))
            if cap_v and cap_v >= stadium_min:
                imp, extra = min(1.0, cap_v / 80000), {"capacity": int(cap_v)}
            elif not cap_v and _STADIUM_NAME.search(name):
                imp = 0.6
            else:
                continue
        if ttype == "shopping_centre" and links < 2:
            continue
        out.append(item(ttype, name, lat, lon, imp, "Wikidata", wikidata=qid, **extra))
    return out


def build_wikidata(cfg: dict, data: dict, fetch: Callable[[str], Optional[dict]] = fetch_wikidata,
                   pause_s: float = 3.0) -> Optional[int]:
    tc = cfg["targets"]
    caps2 = {k: 2 * int(v) for k, v in tc["per_country_per_type"].items()}
    old: dict = {}
    for it in (data.get("osm") or {}).get("wikidata") or []:
        old.setdefault(it["type"], []).append(it)
    got, failed = [], []
    for i, ttype in enumerate(WIKIDATA_CLASSES):
        if i:
            time.sleep(pause_s)
        res = fetch(wikidata_query(ttype))
        if res is None:
            failed.append(ttype)
            got += old.get(ttype, [])                           # keep the previous copy of that type
            continue
        got += wikidata_items(ttype, (res.get("results") or {}).get("bindings") or [],
                              int(tc.get("stadium_min_capacity", 20000)))
    kept = place_and_cap(dedupe(got), geography(), tc["coastal_band_km"], caps2)
    data.setdefault("osm", {})["wikidata"] = kept
    st = {"count": len(kept), "tried_at": time.time()}
    if failed:
        st["error"] = f"failed: {', '.join(failed)}"
        print(f"[coastal-targets] error: wikidata failed for {', '.join(failed)}")
    else:
        st["built_at"] = time.time()
    data.setdefault("regions", {})["wikidata"] = st
    return len(kept)


def build_capitals(cfg: dict, data: dict, fetch: Callable[[str], Optional[dict]] = fetch_overpass) -> Optional[int]:
    tc = cfg["targets"]
    elements, failed = [], 0
    qs = capitals_queries()
    for i, q in enumerate(qs):
        if i:
            time.sleep(2.0)
        res = fetch(q)
        if res is None:
            failed += 1
            continue
        elements += res.get("elements") or []
    if failed > len(qs) // 4:
        print(f"[coastal-targets] error: capitals: Overpass failed on {failed}/{len(qs)} — keeping the previous copy")
        return None
    its = [i for i in osm_items(elements) if i["type"] == "government"]
    kept = place_and_cap(dedupe(its, km=0.3), geography(), tc["coastal_band_km"], tc["per_country_per_type"])
    data.setdefault("osm", {})["capitals"] = kept
    data.setdefault("regions", {})["capitals"] = {"built_at": time.time(), "count": len(kept)}
    return len(kept)


def stale_regions(data: dict, refresh_days: float, now: Optional[float] = None) -> list[str]:
    now = now or time.time()
    out = []
    for r in ["wikidata"] + list(REGIONS) + ["capitals"]:
        st = (data.get("regions") or {}).get(r) or {}
        if not st.get("built_at") or now - st["built_at"] > refresh_days * 86400:
            # a failed try waits six hours before the next
            if st.get("tried_at") and now - st["tried_at"] < 6 * 3600:
                continue
            out.append(r)
    return out


# ── the in-memory index the scorer uses ───────────────────────────────────

class TargetIndex:
    """Merged, de-duplicated, capped targets on a one-degree grid."""

    def __init__(self, items: list[dict]):
        self.items = items
        self.grid: dict = {}
        for it in items:
            self.grid.setdefault((math.floor(it["lat"]), math.floor(it["lon"])), []).append(it)

    def within(self, lat: float, lon: float, radius_km: float) -> list[tuple[float, dict]]:
        dlat = int(math.ceil(radius_km / 110.574)) + 1
        dlon = int(math.ceil(radius_km / max(5.0, 111.32 * math.cos(math.radians(lat))))) + 1
        cy, cx = math.floor(lat), math.floor(lon)
        out = []
        for y in range(cy - dlat, cy + dlat + 1):
            for x in range(cx - dlon, cx + dlon + 1):
                for it in self.grid.get((y, x), ()):
                    d = haversine_km(lat, lon, it["lat"], it["lon"])
                    if d <= radius_km:
                        out.append((d, it))
        return out


def merged_items(data: dict, caps: dict) -> list[dict]:
    allx = list(data.get("static") or [])
    for lst in (data.get("osm") or {}).values():
        allx += lst
    return cap(dedupe(allx), caps)


_INDEX: Optional[TargetIndex] = None
_INDEX_KEY = None
_INDEX_LOCK = threading.Lock()


def index(cfg: dict, path: Optional[str] = None) -> TargetIndex:
    """The process-wide index, rebuilt when the cache file changes."""
    global _INDEX, _INDEX_KEY
    path = path or cache_path()
    try:
        key = (path, os.path.getmtime(path))
    except OSError:
        key = (path, None)
    with _INDEX_LOCK:
        if _INDEX is None or key != _INDEX_KEY:
            data = load_cache(path)
            _INDEX = TargetIndex(merged_items(data, cfg["targets"]["per_country_per_type"]))
            _INDEX_KEY = key
        return _INDEX


def counts(items: Iterable[dict], region_box: Optional[tuple] = None) -> dict:
    out: dict = {}
    for it in items:
        if region_box:
            s, w, n, e = region_box
            if not (s <= it["lat"] <= n and w <= it["lon"] <= e):
                continue
        out[it["type"]] = out.get(it["type"], 0) + 1
    return dict(sorted(out.items(), key=lambda kv: -kv[1]))


def refresh(cfg: dict, regions: Optional[list[str]] = None, *, static: bool = True,
            fetch: Callable[[str], Optional[dict]] = fetch_overpass, pause_s: float = 20.0) -> dict:
    """Build the static part and the given (else the stale) OSM regions,
    saving after each so a crash loses at most one region. Blocking."""
    data = load_cache()
    if static or not data.get("static"):
        n = build_static(cfg, data)
        save_cache(data)
        print(f"[coastal-targets] static sources: {n} targets in the coastal band")
    todo = regions if regions is not None else stale_regions(data, cfg["targets"].get("refresh_days", 7))
    for i, r in enumerate(todo):
        if i:
            time.sleep(pause_s)              # be gentle with public Overpass
        if r == "capitals":
            n = build_capitals(cfg, data, fetch)
        elif r == "wikidata":
            n = build_wikidata(cfg, data)
        else:
            n = build_region(r, cfg, data, fetch)
        save_cache(data)
        if n is not None:
            print(f"[coastal-targets] region {r}: {n} OSM targets")
    return data
