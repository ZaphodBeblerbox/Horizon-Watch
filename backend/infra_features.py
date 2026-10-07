"""
infra_features.py — the world's infrastructure as things you can click.

The "Power grid" layer was OpenInfraMap rendered to a picture: lines on the
globe with nothing behind them. OpenInfraMap's vector tiles carry the
OpenStreetMap objects themselves — every power plant, substation, wind
turbine, line, telecom mast, data centre, pipeline, well and oil site, with
operator, voltage, circuits, capacity, fuel, pressure, diameter, start date
and Wikidata ids — so the layer is now built from them:

  features(bbox, zoom)  what is in view, at the detail the zoom deserves.
                        The tiles already thin by zoom (a country view has
                        the 380 kV grid and the big plants; a town view has
                        every substation and mast); on top of that, tiny
                        things are dropped until you are close.
  detail(fid)           everything known about one object: all its OSM tags
                        (fetched from the OSM API — the tile carries a
                        subset), its Wikidata entry (what it is, a photo,
                        capacity, owner, opening date, Wikipedia), the
                        signals near it ranked the way an asset's are, and
                        which 3D model shows it.

Tiles are cached on the data volume for a week; details for a day.
"""
from __future__ import annotations

import json
import math
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import httpx

from paths import data_path

OIM = "https://openinframap.org/tiles"
UA = {"User-Agent": "Parallax/2.0 infrastructure layer (+https://openinframap.org)"}
TILE_TTL = 7 * 86400
DETAIL_TTL = 86400
MAX_TILES = 16
_mem: dict[str, tuple[float, list]] = {}
_lock = threading.Lock()

# OIM layer -> our kind. None: not drawn.
LAYER_KIND = {
    "power_plant_point": "power_plant",
    "power_substation_point": "substation",
    "power_generator": "generator",          # wind turbines only, below
    "power_line": "power_line",
    "telecoms_mast": "telecom_mast",
    "telecoms_data_center": "data_center",
    "telecoms_communication_line": "telecom_line",
    "telecoms_line": "telecom_line",
    "petroleum_pipeline": "pipeline",
    "water_pipeline": "water_pipeline",
    "petroleum_well": "well",
    "petroleum_site": "petroleum_site",
}
LABEL = {
    "power_plant": "Power plant", "substation": "Substation", "wind_turbine": "Wind turbine",
    "power_line": "Power line", "power_cable": "Power cable", "telecom_mast": "Telecom mast",
    "data_center": "Data centre", "telecom_line": "Telecom line", "pipeline": "Pipeline",
    "water_pipeline": "Water pipeline", "well": "Oil or gas well", "petroleum_site": "Oil and gas site",
}
# watch radius (km) used to rank the signals near one
RADIUS = {"power_plant": 40, "substation": 20, "wind_turbine": 15, "power_line": 25, "power_cable": 25,
          "telecom_mast": 15, "data_center": 20, "telecom_line": 20, "pipeline": 30, "water_pipeline": 15,
          "well": 20, "petroleum_site": 30}


# ── tiles ────────────────────────────────────────────────────────────────────

def tile_of(lat: float, lon: float, z: int) -> tuple[int, int]:
    n = 2 ** z
    lat = max(-85.0511, min(85.0511, lat))
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return max(0, min(n - 1, x)), max(0, min(n - 1, y))


def tiles_for(west: float, south: float, east: float, north: float, zoom: int) -> tuple[int, list[tuple[int, int]]]:
    """The tiles covering a box, at the deepest zoom that needs at most MAX_TILES."""
    z = max(2, min(14, int(zoom)))
    while True:
        x0, y0 = tile_of(north, west, z)
        x1, y1 = tile_of(south, east, z)
        if east < west:                           # across the antimeridian: take the wider side
            x1 = 2 ** z - 1
        tiles = [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
        if len(tiles) <= MAX_TILES or z <= 2:
            return z, tiles[:MAX_TILES]
        z -= 1


def _fetch_tile(z: int, x: int, y: int) -> bytes | None:
    p = data_path("oim_tiles", str(z), str(x), f"{y}.pbf")
    if p.exists() and time.time() - p.stat().st_mtime < TILE_TTL:
        return p.read_bytes() or None
    try:
        r = httpx.get(f"{OIM}/{z}/{x}/{y}.pbf", headers=UA, timeout=15)
    except httpx.HTTPError:
        return p.read_bytes() if p.exists() else None
    body = r.content if r.status_code == 200 else b""
    if r.status_code in (200, 204, 404):
        p.write_bytes(body)
    return body or None


def _num(v) -> float | None:
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _to_lonlat(z, x, y, ext, px, py):
    n = 2 ** z
    lon = (x + px / ext) / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + py / ext) / n))))
    return round(lon, 6), round(lat, 6)


def _lines(geom) -> list[list]:
    t, c = geom["type"], geom["coordinates"]
    if t == "LineString":
        return [c]
    if t == "MultiLineString":
        return c
    return []


def _point(geom):
    t, c = geom["type"], geom["coordinates"]
    if t == "Point":
        return c
    if t == "MultiPoint":
        return c[0]
    if t in ("Polygon", "MultiPolygon"):
        ring = c[0] if t == "Polygon" else c[0][0]
        return [sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)]
    return None


def kind_of(layer: str, props: dict) -> str | None:
    k = LAYER_KIND.get(layer)
    if k == "generator":
        return "wind_turbine" if (props.get("source") == "wind") else None
    if k == "power_line" and (props.get("type") == "cable" or props.get("location") in ("underground", "underwater")):
        return "power_cable"
    return k


def keep(kind: str, props: dict, z: int) -> bool:
    """Level of detail on top of the tiles' own: what is worth drawing at this zoom."""
    if props.get("disused"):
        return z >= 12
    if kind == "power_plant":
        out = _num(props.get("output")) or 0
        return z >= 11 or (z >= 9 and out >= 1) or (z >= 7 and out >= 50) or out >= 300
    if kind == "substation":
        v = _num(props.get("voltage")) or 0
        return z >= 12 or (z >= 9 and v >= 60) or (z >= 7 and v >= 220) or (z >= 6 and v >= 380)
    if kind in ("power_line", "power_cable"):
        v = _num(props.get("voltage")) or 0
        return z >= 11 or (z >= 8 and v >= 100) or (z >= 6 and v >= 220) or v >= 380
    if kind == "pipeline":
        d = _num(props.get("diameter")) or 0
        return z >= 7 or (z >= 6 and props.get("usage") == "transmission") or d >= 900
    if kind == "wind_turbine":
        return z >= 11
    if kind in ("telecom_mast", "well"):
        return z >= 11
    if kind == "water_pipeline":
        return z >= 11
    if kind == "telecom_line":
        return z >= 9
    return True


def _decode(z: int, x: int, y: int) -> list[dict]:
    key = f"{z}/{x}/{y}"
    with _lock:
        hit = _mem.get(key)
        if hit and time.time() - hit[0] < 3600:
            return hit[1]
    raw = _fetch_tile(z, x, y)
    out: list[dict] = []
    if raw:
        import mapbox_vector_tile as mvt
        try:
            tile = mvt.decode(raw, default_options={"y_coord_down": True})
        except Exception:
            tile = {}
        for layer, body in tile.items():
            ext = body.get("extent", 4096)
            for f in body.get("features", []):
                props = f.get("properties") or {}
                kind = kind_of(layer, props)
                if not kind:
                    continue
                osm_id = props.get("osm_id")
                feat = {"id": f"oim:{layer}:{osm_id}", "kind": kind, "layer": layer, "osm_id": osm_id,
                        "osm_type": "node" if props.get("is_node") else ("relation" if (osm_id or 0) < 0 else "way"),
                        "props": {k: v for k, v in props.items() if k not in ("osm_id", "is_node")}}
                lines = _lines(f["geometry"])
                if lines:
                    feat["line"] = [[_to_lonlat(z, x, y, ext, px, py) for px, py in seg] for seg in lines]
                    mid = feat["line"][0][len(feat["line"][0]) // 2]
                    feat["lon"], feat["lat"] = mid
                else:
                    pt = _point(f["geometry"])
                    if not pt:
                        continue
                    feat["lon"], feat["lat"] = _to_lonlat(z, x, y, ext, pt[0], pt[1])
                out.append(feat)
    with _lock:
        _mem[key] = (time.time(), out)
        if len(_mem) > 400:
            for k in sorted(_mem, key=lambda k: _mem[k][0])[:100]:
                _mem.pop(k, None)
    return out


def thin(seg: list, step: float) -> list:
    """Drop points closer than `step` degrees to the last kept one; keep the ends."""
    if len(seg) <= 2:
        return seg
    out = [seg[0]]
    for p in seg[1:-1]:
        if abs(p[0] - out[-1][0]) + abs(p[1] - out[-1][1]) >= step:
            out.append(p)
    out.append(seg[-1])
    return out


KEEP_PROPS = {"name", "name_en", "voltage", "voltage_2", "voltage_3", "output", "source", "method", "substance",
              "operator", "diameter", "pressure", "usage", "location", "type", "wikidata", "ref", "start_date",
              "circuits", "frequency", "area", "construction", "disused", "substation"}

_pool = ThreadPoolExecutor(max_workers=6, thread_name_prefix="oim")


def features(west: float, south: float, east: float, north: float, zoom: int) -> dict:
    z, tiles = tiles_for(west, south, east, north, zoom)
    seen: dict[str, dict] = {}
    for feats in _pool.map(lambda t: _decode(z, t[0], t[1]), tiles):
        for f in feats:
            if not keep(f["kind"], f["props"], int(zoom)):
                continue
            prev = seen.get(f["id"])
            if prev and "line" in prev and "line" in f:
                prev["line"] += f["line"]                    # a line crossing tiles: its pieces together
            elif not prev:
                seen[f["id"]] = {**f, "line": list(f["line"])} if "line" in f else f
    feats = list(seen.values())
    # Zoomed out, a line needs far fewer points than the tile gives it.
    step = 0.02 if zoom <= 5 else 0.006 if zoom <= 7 else 0.0015 if zoom <= 9 else 0
    nd = 3 if zoom <= 5 else 4 if zoom <= 9 else 5
    for f in feats:
        f["label"] = LABEL.get(f["kind"], f["kind"])
        f["title"] = title_of(f)
        f["props"] = {k: v for k, v in f["props"].items() if k in KEEP_PROPS and v not in (None, "", False)}
        f["lat"], f["lon"] = round(f["lat"], 5), round(f["lon"], 5)
        if "line" in f:
            segs = [thin(seg, step) for seg in f["line"]] if step else f["line"]
            out_segs = []
            for seg in segs:
                pts = []
                for q in seg:
                    q = [round(q[0], nd), round(q[1], nd)]
                    if not pts or q != pts[-1]:
                        pts.append(q)
                if len(pts) >= 2:
                    out_segs.append(pts)
            f["line"] = out_segs
    return {"zoom": z, "tiles": len(tiles), "count": len(feats), "features": feats}


# ── what one object is ───────────────────────────────────────────────────────

def _fmt_num(v, unit: str, digits: int = 0) -> str | None:
    n = _num(v)
    if n is None or n == 0:
        return None
    return f"{n:,.{digits}f} {unit}".replace(".0 ", " ") if digits else f"{round(n):,} {unit}"


def voltage_text(props: dict) -> str | None:
    vs = sorted({v for v in (_num(props.get("voltage")), _num(props.get("voltage_2")), _num(props.get("voltage_3"))) if v}, reverse=True)
    if not vs:
        return None
    return " / ".join(f"{v:g} kV" for v in vs)


SOURCE = {"gas": "Gas", "coal": "Coal", "nuclear": "Nuclear", "wind": "Wind", "solar": "Solar", "hydro": "Hydro",
          "oil": "Oil", "diesel": "Diesel", "biomass": "Biomass", "biogas": "Biogas", "waste": "Waste",
          "geothermal": "Geothermal", "battery": "Battery storage", "tidal": "Tidal"}


def title_of(f: dict) -> str:
    p = f.get("props") or {}
    name = p.get("name_en") or p.get("name")
    k = f["kind"]
    if name:
        return str(name)
    if k == "power_plant":
        return f"{SOURCE.get(p.get('source'), '').strip()} power plant".strip().capitalize()
    if k in ("power_line", "power_cable"):
        v = voltage_text(p)
        return f"{v} {'cable' if k == 'power_cable' else 'line'}" if v else LABEL[k]
    if k == "pipeline":
        sub = p.get("substance")
        return f"{sub.replace('_', ' ').capitalize()} pipeline" if sub else "Pipeline"
    if k == "telecom_mast" and p.get("operator"):
        return f"{p['operator']} mast"
    return LABEL.get(k, k)


def model_for(kind: str, props: dict) -> str:
    """Which 3D model shows it (src/assets/three/index.js MODELS)."""
    if kind == "power_plant":
        return {"nuclear": "nuclear_plant", "wind": "wind_farm", "solar": "solar_farm",
                "hydro": "hydro_dam", "tidal": "hydro_dam"}.get(props.get("source"), "power_plant")
    if kind == "power_cable":
        return "subsea_cable" if props.get("location") == "underwater" else "pylon"
    if kind == "petroleum_site":
        return "tank_farm"
    if kind == "telecom_line":
        return "subsea_cable"
    return {"substation": "substation", "wind_turbine": "wind_turbine", "power_line": "pylon",
            "telecom_mast": "telecom_mast", "data_center": "data_center", "pipeline": "pipeline",
            "water_pipeline": "pipeline", "well": "oil_well"}.get(kind, "factory")


def facts(kind: str, props: dict, tags: dict | None = None) -> list[list[str]]:
    """The facts worth reading for this kind of object, in order."""
    t = {**(tags or {}), **{k: v for k, v in props.items() if v not in (None, "", False)}}
    rows: list[tuple[str, str | None]] = []
    add = lambda k, v: rows.append((k, v))  # noqa: E731
    if kind == "power_plant":
        add("Fuel", SOURCE.get(t.get("source") or t.get("plant:source"), t.get("source") or t.get("plant:source")))
        add("Capacity", _fmt_num(t.get("output"), "MW", 1) or t.get("plant:output:electricity"))
        add("Method", (t.get("method") or t.get("plant:method") or "").replace("_", " ") or None)
        add("Heat output", t.get("plant:output:hot_water") or t.get("plant:output:steam"))
    elif kind == "substation":
        add("Voltage", voltage_text(t))
        add("Type", (t.get("substation") or "").replace("_", " ") or None)
        add("Footprint", _fmt_num(t.get("area"), "m²"))
        add("Gas insulated", "yes" if t.get("gas_insulated") == "yes" else None)
    elif kind in ("power_line", "power_cable"):
        add("Voltage", voltage_text(t))
        add("Circuits", str(t.get("circuits")) if _num(t.get("circuits")) else None)
        add("Cables", t.get("cables"))
        add("Frequency", f"{t['frequency']} Hz" if t.get("frequency") and str(t.get("frequency")) != "0" else None)
        add("Runs", (t.get("location") or "overhead").replace("underwater", "under water"))
        add("Line type", {"minor_line": "distribution line", "line": "transmission line", "cable": "cable"}.get(t.get("type")))
    elif kind == "wind_turbine":
        add("Rated output", _fmt_num(t.get("output"), "MW", 1) or t.get("generator:output:electricity"))
        add("Hub height", t.get("height:hub") or t.get("height"))
        add("Rotor diameter", t.get("rotor:diameter"))
        add("Model", t.get("model") or t.get("manufacturer"))
    elif kind == "telecom_mast":
        add("Height", f"{t['height']} m" if t.get("height") and str(t["height"]).replace(".", "").isdigit() else t.get("height"))
        add("Serves", ", ".join(x.replace("communication:", "").replace("_", " ") for x, v in t.items()
                                if x.startswith("communication:") and v == "yes") or None)
        add("Structure", (t.get("tower:construction") or t.get("tower:type") or "").replace("_", " ") or None)
    elif kind == "data_center":
        add("Type", (t.get("type") or t.get("telecom") or "").replace("_", " ") or None)
    elif kind in ("pipeline", "water_pipeline"):
        add("Carries", (t.get("substance") or "").replace("_", " ") or None)
        add("Diameter", f"{t['diameter']} mm" if _num(t.get("diameter")) else None)
        add("Pressure", f"{t['pressure']} bar" if _num(t.get("pressure")) else None)
        add("Use", (t.get("usage") or "").replace("_", " ") or None)
        add("Runs", t.get("location"))
    elif kind == "well":
        add("Produces", t.get("substance") or t.get("product"))
    elif kind == "petroleum_site":
        add("Product", t.get("product") or t.get("substance"))
    add("Operator", t.get("operator"))
    add("Owner", t.get("owner"))
    add("Reference", t.get("ref"))
    add("In service since", t.get("start_date"))
    add("Status", "under construction" if t.get("construction") else ("disused" if t.get("disused") else None))
    return [[k, str(v)] for k, v in rows if v not in (None, "", "None")]


# ── detail: OSM tags, Wikidata, signals near ─────────────────────────────────

def _cached(name: str, ttl: float, make):
    p = data_path("infra_detail", re.sub(r"[^A-Za-z0-9_.-]", "_", name) + ".json")
    if p.exists() and time.time() - p.stat().st_mtime < ttl:
        try:
            return json.loads(p.read_text())
        except ValueError:
            pass
    v = make()
    if v is not None:
        p.write_text(json.dumps(v))
    return v


def osm_tags(osm_type: str, osm_id: int) -> dict:
    oid = abs(int(osm_id))

    def make():
        try:
            r = httpx.get(f"https://api.openstreetmap.org/api/0.6/{osm_type}/{oid}.json", headers=UA, timeout=12)
            if r.status_code != 200:
                return {}
            els = r.json().get("elements") or []
            return (els[0].get("tags") if els else {}) or {}
        except (httpx.HTTPError, ValueError):
            return None
    return _cached(f"osm_{osm_type}_{oid}", DETAIL_TTL * 7, make) or {}


WD_PROPS = {"P2109": "Installed capacity", "P127": "Owned by", "P137": "Operator", "P571": "Opened",
            "P17": "Country", "P2043": "Length", "P2386": "Diameter", "P2048": "Height", "P176": "Manufacturer"}


def wikidata(qid: str) -> dict:
    if not re.fullmatch(r"Q\d+", qid or ""):
        return {}

    def make():
        try:
            r = httpx.get("https://www.wikidata.org/w/api.php", headers=UA, timeout=12, params={
                "action": "wbgetentities", "ids": qid, "format": "json",
                "props": "labels|descriptions|claims|sitelinks", "languages": "en", "sitefilter": "enwiki"})
            e = (r.json().get("entities") or {}).get(qid) or {}
        except (httpx.HTTPError, ValueError):
            return None
        claims = e.get("claims") or {}
        out = {"qid": qid, "label": (e.get("labels") or {}).get("en", {}).get("value"),
               "description": (e.get("descriptions") or {}).get("en", {}).get("value"), "facts": []}
        wiki = ((e.get("sitelinks") or {}).get("enwiki") or {}).get("title")
        if wiki:
            out["wikipedia"] = f"https://en.wikipedia.org/wiki/{wiki.replace(' ', '_')}"
        img = claims.get("P18")
        if img:
            name = img[0]["mainsnak"].get("datavalue", {}).get("value")
            if name:
                out["image"] = f"https://commons.wikimedia.org/wiki/Special:FilePath/{name.replace(' ', '_')}?width=720"
        refs: list[tuple[str, str]] = []
        for pid, label in WD_PROPS.items():
            for c in (claims.get(pid) or [])[:1]:
                dv = c["mainsnak"].get("datavalue", {})
                v = dv.get("value")
                if dv.get("type") == "wikibase-entityid":
                    refs.append((label, v["id"]))
                elif dv.get("type") == "quantity":
                    amt = float(v["amount"])
                    unit = {"Q6982035": "MW", "Q11573": "m", "Q828224": "km", "Q174789": "mm"}.get(v.get("unit", "").rsplit("/", 1)[-1], "")
                    out["facts"].append([label, f"{amt:,.0f} {unit}".strip()])
                elif dv.get("type") == "time":
                    out["facts"].append([label, v["time"].lstrip("+")[:4]])
        if refs:
            try:
                r = httpx.get("https://www.wikidata.org/w/api.php", headers=UA, timeout=12, params={
                    "action": "wbgetentities", "ids": "|".join(q for _, q in refs), "format": "json",
                    "props": "labels", "languages": "en"})
                ents = r.json().get("entities") or {}
                for label, q in refs:
                    name = ((ents.get(q) or {}).get("labels") or {}).get("en", {}).get("value")
                    if name:
                        out["facts"].append([label, name])
            except (httpx.HTTPError, ValueError):
                pass
        return out
    return _cached(f"wd_{qid}", DETAIL_TTL * 7, make) or {}


def parse_id(fid: str) -> tuple[str, int] | None:
    m = re.fullmatch(r"oim:([a-z_]+):(-?\d+)", fid or "")
    return (m.group(1), int(m.group(2))) if m else None


def detail(fid: str, kind: str, lat: float, lon: float, props: dict, osm_type: str) -> dict:
    """Everything about one object. `props` are the tile's own (the client
    has them); the OSM API adds the rest of the tags."""
    pid = parse_id(fid)
    tags = osm_tags(osm_type, pid[1]) if pid else {}
    merged = {**props, **{k: v for k, v in tags.items()}}
    qid = merged.get("wikidata") or None
    wd = wikidata(qid) if qid else {}
    name = merged.get("name:en") or merged.get("name_en") or merged.get("name") or wd.get("label")
    out = {
        "id": fid, "kind": kind, "label": LABEL.get(kind, kind), "lat": lat, "lon": lon,
        "title": name or title_of({"kind": kind, "props": merged}),
        "model": model_for(kind, merged),
        "facts": facts(kind, merged, tags),
        "wikidata": wd or None,
        "tags": dict(sorted(tags.items())),
        "osm_url": f"https://www.openstreetmap.org/{osm_type}/{abs(pid[1])}" if pid else None,
        "radius_km": RADIUS.get(kind, 25),
    }
    # registered as one of our assets, it is this kind (owned_assets.KINDS)
    out["asset_kind"] = {"pylon": "power_line", "wind_turbine": "wind_farm"}.get(out["model"], out["model"])
    return out


def signals_near(kind: str, lat: float, lon: float) -> dict:
    """The signals near it, ranked as an asset's are (slower: its own request)."""
    import owned_assets as oa
    from routers.my_assets import gather
    radius = RADIUS.get(kind, 25)
    at = {"lat": lat, "lon": lon}
    ranked = oa.rank(at, radius, gather(at, radius), limit=12)
    return {"radius_km": radius, "signals": ranked, "exposure": oa.exposure(ranked)}
