"""
sea_route.py — the SAFEST sea route between two ports, not just the shortest.

Owner, 2026-10-12: "sea routes that avoid Houthi strike ranges in the Red
Sea, GPS-jamming areas and piracy zones, including the Suez versus Cape of
Good Hope choice, with the added days weighed against the risk".

HOW
    routing     `searoute` (MIT; Eurostat's marine network graph, runs
                offline). Passages can be closed — suez, babalmandab, ormuz,
                malacca, gibraltar, bosporus, panama, sunda — so closing the
                risky ones on the shortest route gives the alternatives
                (closing Bab-el-Mandeb from Singapore to Rotterdam gives the
                Cape of Good Hope).
    hazards     configured areas with their sources (sea_hazards.json: the
                Red Sea strike zone, piracy areas, war-risk listed waters),
                the event-driven ones raised by what we recorded inside them
                in the last 30 days (GeoConfirmed, our alerts, UCDP), live
                GPS interference cells from the ADS-B integrity measurement
                (alerts source 'gps', last 24 h), and chokepoint pressure
                (attack-type events near a strait, 14 days).
    exposure    Σ over route samples every 10 nm of (hazard weight × hours
                spent there at the ship's speed) — "risk-hours".
    choice      cost = exposure + DAY_VALUE × transit days; the cheapest is
                recommended. DAY_VALUE (risk-hours one extra day at sea is
                worth) is a parameter, so the trade-off is explicit.

Everything here is blocking (SQLite, the graph search): call it from a
thread. Results are plain dicts; coordinates are [lat, lon].
"""
from __future__ import annotations

import csv
import datetime as _dt
import json
import math
import os
import re
import sqlite3
import threading
import time
from pathlib import Path

CODE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = CODE_DIR / "sea_hazards.json"

NM_M = 1852.0
STEP_NM = 10.0                     # route sampling for exposure
DAY_VALUE = 4.0                    # risk-hours one extra day at sea is worth
EVENT_DAYS = 30
EVENT_HALF_LIFE_D = 10.0
UCDP_DAYS = 60                     # UCDP candidate releases lag about a month
GPS_HOURS = 24
GPS_RADIUS_KM = 80.0
CHOKE_DAYS = 14
CHOKE_RADIUS_KM = 120.0
CACHE_S = 300
# Alert sources that report events (news agreement). Not 'geoconfirmed' (read
# from its own table), not the AIS/ADS-B/GPS detectors (behaviour, not
# attacks) — and a positive list keeps the query on the source index: the
# detectors write ~15,000 rows a day.
EVENT_ALERT_SOURCES = ("CORROBORATED",)
BASE_RESTRICTIONS = ["northwest"]  # the Northwest Passage is not a commercial option

PASSAGES = {
    "suez": "the Suez Canal", "babalmandab": "Bab-el-Mandeb", "ormuz": "the Strait of Hormuz",
    "malacca": "the Strait of Malacca", "gibraltar": "the Strait of Gibraltar", "bosporus": "the Bosporus",
    "panama": "the Panama Canal", "sunda": "the Sunda Strait", "south_africa": "the Cape of Good Hope",
    "chili": "Cape Horn", "bering": "the Bering Strait", "northwest": "the Northwest Passage",
}
SERIOUS = ("strike", "piracy", "war-risk", "chokepoint")   # kinds worth closing a passage for
AVOIDABLE = ("babalmandab", "suez", "ormuz", "malacca", "gibraltar", "bosporus", "panama", "sunda")

# Service speed by AIS ship type (knots) — typical, not a promise.
SPEEDS = [("container", 17.0), ("lng", 17.0), ("passenger", 18.0), ("cruise", 18.0), ("ro-ro", 17.0),
          ("vehicle", 17.0), ("tanker", 13.0), ("bulk", 13.0), ("cargo", 14.0), ("fishing", 10.0),
          ("tug", 9.0), ("sailing", 6.0), ("pleasure", 8.0)]
DEFAULT_SPEED = 14.0

SHIPPING_WORDS = re.compile(r"\b(ship|ships|vessel|tanker|carrier|bulker|freighter|merchant|crew|m/?v|boat|maritime|"
                            r"navy|naval|usv|sea drone|hijack\w*|pirat\w*|seiz\w*|board\w*|cargo|container ship|ukmto|jmic)\b", re.I)
ATTACK_WORDS = re.compile(r"(attack|strike|struck|missile|drone|explosion|explosive|hijack|seiz|boarded|fired|"
                          r"sunk|sink|mine|projectile|pirat|armed|shell|clash|target)", re.I)


# ── geometry ────────────────────────────────────────────────────────────────

def haversine_km(a_lat, a_lon, b_lat, b_lon) -> float:
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0088 * math.asin(min(1.0, math.sqrt(h)))


def in_ring(lat: float, lon: float, ring: list) -> bool:
    """Ray casting over [lat, lon] vertices."""
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        yi, xi = ring[i]
        yj, xj = ring[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def ring_bbox(ring: list) -> tuple:
    lats = [p[0] for p in ring]
    lons = [p[1] for p in ring]
    return min(lats), max(lats), min(lons), max(lons)


def unwrap(coords: list) -> list:
    """[lat, lon] with longitudes made continuous across the antimeridian."""
    out = []
    prev = None
    for lat, lon in coords:
        if prev is not None:
            while lon - prev > 180:
                lon -= 360
            while lon - prev < -180:
                lon += 360
        out.append([round(lat, 4), round(lon, 4)])
        prev = lon
    return out


def norm_lon(lon: float) -> float:
    return ((lon + 180.0) % 360.0) - 180.0


def samples(coords: list, step_nm: float = STEP_NM):
    """(lat, lon, nm) points every step along the route; nm is the length each one stands for."""
    out = []
    for (a_lat, a_lon), (b_lat, b_lon) in zip(coords, coords[1:]):
        d = haversine_km(a_lat, norm_lon(a_lon), b_lat, norm_lon(b_lon)) / 1.852
        n = max(1, int(math.ceil(d / step_nm)))
        for k in range(n):
            t = (k + 0.5) / n
            out.append((a_lat + (b_lat - a_lat) * t, norm_lon(a_lon + (b_lon - a_lon) * t), d / n))
    return out


# ── configuration ───────────────────────────────────────────────────────────

_cfg_cache: dict = {"mtime": None, "cfg": None}


def load_config(path: Path | str = CONFIG_PATH) -> dict:
    p = Path(path)
    m = p.stat().st_mtime
    if _cfg_cache["mtime"] != m or _cfg_cache.get("path") != str(p):
        with open(p, encoding="utf-8") as fh:
            _cfg_cache.update(mtime=m, path=str(p), cfg=json.load(fh))
    return _cfg_cache["cfg"]


# ── live evidence ───────────────────────────────────────────────────────────

def _db_path() -> str:
    try:
        import paths
        return str(paths.DB_PATH)
    except Exception:                                       # noqa: BLE001
        return str(CODE_DIR / "data" / "akili.db")


def _utc(v) -> _dt.datetime | None:
    if not v:
        return None
    try:
        t = _dt.datetime.fromisoformat(str(v).replace("Z", "+00:00").replace(" ", "T"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=_dt.timezone.utc)


def decay(age_days: float, half_life: float = EVENT_HALF_LIFE_D) -> float:
    return 0.5 ** (max(0.0, age_days) / half_life)


def _at_sea(lat, lon) -> bool:
    try:
        import geo_land
        return geo_land.country_at(lat, lon) is None
    except Exception:                                       # noqa: BLE001
        return False


def zone_events(con, ring: list, now: _dt.datetime) -> dict:
    """What we recorded inside a zone: conflict events (GeoConfirmed and our
    attack-type alerts, 30 days), how many were against shipping or at sea,
    UCDP events (60 days, the release lags) — counts, decayed weight, the latest."""
    s, n, w, e = ring_bbox(ring)
    since = (now - _dt.timedelta(days=EVENT_DAYS)).strftime("%Y-%m-%d %H:%M:%S")
    events: list[dict] = []
    try:
        for r in con.execute("SELECT id, date, latitude, longitude, COALESCE(title, name) FROM geoconfirmed_placemarks "
                             "WHERE date >= ? AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?",
                             (since, s, n, w, e)):
            events.append({"src": "GeoConfirmed", "at": r[1], "lat": r[2], "lon": r[3], "title": r[4] or ""})
    except sqlite3.Error:
        pass
    try:
        for r in con.execute(f"SELECT alert_id, created_at, lat, lon, title, source FROM alerts "
                             f"WHERE source IN ({','.join('?' * len(EVENT_ALERT_SOURCES))}) AND created_at >= ? "
                             "AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? LIMIT 2000",
                             (*EVENT_ALERT_SOURCES, since, s, n, w, e)):
            if ATTACK_WORDS.search(r[4] or ""):
                events.append({"src": f"alert ({r[5]})", "at": r[1], "lat": r[2], "lon": r[3], "title": r[4] or ""})
    except sqlite3.Error:
        pass
    inside = [x for x in events if x["lat"] is not None and in_ring(x["lat"], x["lon"], ring)]
    seen, uniq = set(), []
    for x in inside:                                        # one event per place, day and title
        k = (round(x["lat"], 2), round(x["lon"], 2), str(x["at"])[:10], x["title"][:40])
        if k not in seen:
            seen.add(k)
            uniq.append(x)
    total_w = ship_w = 0.0
    shipping = []
    for x in uniq:
        t = _utc(x["at"])
        age = (now - t).total_seconds() / 86400 if t else EVENT_DAYS
        d = decay(age)
        total_w += d
        if SHIPPING_WORDS.search(x["title"]) or _at_sea(x["lat"], x["lon"]):
            ship_w += d
            shipping.append(x)
    ucdp = 0
    ucdp_latest = None
    try:
        usince = (now - _dt.timedelta(days=UCDP_DAYS)).strftime("%Y-%m-%d")
        for r in con.execute("SELECT date, lat, lon FROM ucdp_candidate WHERE date >= ? AND lat BETWEEN ? AND ? "
                             "AND lon BETWEEN ? AND ?", (usince, s, n, w, e)):
            if r[1] is not None and in_ring(r[1], r[2], ring):
                ucdp += 1
                ucdp_latest = max(ucdp_latest or r[0], r[0])
    except sqlite3.Error:
        pass
    latest = max((str(x["at"])[:10] for x in uniq), default=None)
    return {
        "events_30d": len(uniq), "shipping_30d": len(shipping), "ucdp_60d": ucdp, "ucdp_latest": ucdp_latest,
        "events_weight": round(total_w, 2), "shipping_weight": round(ship_w, 2), "latest": latest,
        "examples": [{"title": x["title"][:140], "at": str(x["at"])[:10], "source": x["src"]}
                     for x in sorted(shipping or uniq, key=lambda x: str(x["at"]), reverse=True)[:3]],
    }


def live_weight(base: float, ev: dict) -> float:
    """The standing weight, raised by recorded conflict (up to +0.15) and
    attacks on shipping (up to +0.35), both decayed with a 10-day half-life."""
    w = base + 0.15 * min(1.0, ev["events_weight"] / 20.0) + 0.35 * min(1.0, ev["shipping_weight"] / 4.0)
    return round(min(1.0, w), 3)


def near_sea(lat: float, lon: float, reach: float = 0.5) -> bool:
    """The cell's centre or a point half a degree away is at sea — inland
    jamming does not touch a ship."""
    return any(_at_sea(lat + dy, lon + dx) for dy, dx in ((0, 0), (reach, 0), (-reach, 0), (0, reach), (0, -reach)))


def gps_cells(con, now: _dt.datetime) -> list[dict]:
    """GPS/GNSS interference cells measured in the last 24 h (alerts source 'gps',
    written by the ADS-B integrity loop in whichever process runs it), plus the
    in-process grid when this process has one."""
    since = (now - _dt.timedelta(hours=GPS_HOURS)).strftime("%Y-%m-%d %H:%M:%S")
    cells: dict[str, dict] = {}
    sql = ("SELECT entity_id, AVG(lat), AVG(lon), MAX(CAST(json_extract(raw_json, '$.pct') AS REAL)), "
           "MAX(json_extract(raw_json, '$.aircraft')), MAX(created_at), "
           "SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) FROM alerts {hint}"
           "WHERE created_at >= ? AND source = 'gps' AND alert_type = 'gps_interference' GROUP BY entity_id")
    try:
        try:     # the day's rows by time: the source index would walk every gps row ever written
            rows = con.execute(sql.format(hint="INDEXED BY ix_alerts_created_at "), (since,)).fetchall()
        except sqlite3.OperationalError:
            rows = con.execute(sql.format(hint=""), (since,)).fetchall()
        for r in rows:
            if r[1] is None:
                continue
            cells[str(r[0])] = {"cell": str(r[0]), "lat": r[1], "lon": r[2], "pct": r[3] or 0.0,
                                "aircraft": r[4], "at": r[5], "level": "severe" if (r[6] or 0) > 0 else "degraded"}
    except sqlite3.Error:
        pass
    try:
        import gps_interference as gi
        for c in gi.cells():
            if c.get("level") in ("severe", "degraded"):
                cells.setdefault(f"gps:{c['cell']}", {"cell": f"gps:{c['cell']}", "lat": c["lat"], "lon": c["lon"],
                                                      "pct": c["pct"], "aircraft": c["aircraft"],
                                                      "at": now.isoformat(), "level": c["level"]})
    except Exception:                                       # noqa: BLE001
        pass
    return list(cells.values())


def choke_pressure(con, chokepoints: list, now: _dt.datetime, skip_rings: list | None = None) -> list[dict]:
    """Attack-type events (GeoConfirmed, corroborated news alerts) within 120 km
    of each strait in the last 14 days. A strait inside a live zone is left
    out: that zone already counts the same events."""
    since = (now - _dt.timedelta(days=CHOKE_DAYS)).strftime("%Y-%m-%d %H:%M:%S")
    out = []
    for c in chokepoints:
        if any(in_ring(c["lat"], c["lon"], r) for r in (skip_rings or [])):
            continue
        dlat = CHOKE_RADIUS_KM / 111.0
        dlon = CHOKE_RADIUS_KM / max(5.0, 111.0 * math.cos(math.radians(c["lat"])))
        box = (c["lat"] - dlat, c["lat"] + dlat, c["lon"] - dlon, c["lon"] + dlon)
        rows = []
        try:
            rows += con.execute("SELECT latitude, longitude, COALESCE(title, name) FROM geoconfirmed_placemarks WHERE date >= ? "
                                "AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?", (since, *box)).fetchall()
            rows += con.execute(f"SELECT lat, lon, title FROM alerts WHERE source IN ({','.join('?' * len(EVENT_ALERT_SOURCES))}) "
                                "AND created_at >= ? AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?",
                                (*EVENT_ALERT_SOURCES, since, *box)).fetchall()
        except sqlite3.Error:
            pass
        n = sum(1 for la, lo, t in rows if la is not None and ATTACK_WORDS.search(t or "")
                and haversine_km(c["lat"], c["lon"], la, lo) <= CHOKE_RADIUS_KM)
        out.append({**c, "events_14d": n})
    return out


# ── the hazard set ──────────────────────────────────────────────────────────

_haz_lock = threading.Lock()
_haz_cache: dict = {"at": 0.0, "val": None}


def build_hazards(now: _dt.datetime | None = None, db_path: str | None = None, cfg: dict | None = None) -> list[dict]:
    """Every maritime hazard, each {id, kind, name, weight, why, sources, date,
    shape: polygon (ring) | circle (lat, lon, radius_km), stats}."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    cfg = cfg or load_config()
    out: list[dict] = []
    con = None
    try:
        con = sqlite3.connect(f"file:{db_path or _db_path()}?mode=ro", uri=True, timeout=10)
    except sqlite3.Error as ex:
        print(f"[sea-route] error: database: {ex}", flush=True)
    for z in cfg.get("zones", []):
        h = {"id": z["id"], "kind": z["kind"], "name": z["name"], "weight": float(z["weight"]), "base_weight": float(z["weight"]),
             "why": z["why"], "sources": z.get("sources", []), "date": z.get("reviewed") or cfg.get("reviewed"),
             "shape": "polygon", "ring": z["ring"], "bbox": ring_bbox(z["ring"]), "live": bool(z.get("live"))}
        if z.get("live") and con is not None:
            try:
                ev = zone_events(con, z["ring"], now)
                h["stats"] = ev
                h["weight"] = live_weight(h["base_weight"], ev)
                srcs = ["our recorded events (GeoConfirmed, alerts)"]
                if ev["ucdp_60d"]:
                    srcs.append(f"UCDP candidate events (to {ev['ucdp_latest']})")
                h["sources"] = h["sources"] + [{"label": " and ".join(srcs), "url": None, "date": now.strftime("%Y-%m-%d")}]
            except Exception as ex:                         # noqa: BLE001
                print(f"[sea-route] error: zone events {z['id']}: {type(ex).__name__}: {ex}", flush=True)
        out.append(h)
    if con is not None:
        try:
            for c in gps_cells(con, now):
                if not near_sea(c["lat"], c["lon"]):
                    continue
                w = 0.2 if c["level"] == "severe" else 0.1
                out.append({"id": f"gnss-{c['cell'].replace(':', '-')}", "kind": "gnss", "name": "GPS interference", "group": "gnss",
                            "weight": w, "base_weight": w, "live": True,
                            "why": (f"Aircraft overhead losing their satellite fix: {c['pct']:.0f}% of "
                                    f"{c.get('aircraft') or '?'} in the last 24 h ({c['level']}). Ships nearby may see "
                                    "jammed or spoofed GPS/AIS — collision and grounding risk, false positions."),
                            "sources": [{"label": "Our ADS-B navigation-integrity measurement (/api/gps-interference)",
                                         "url": None, "date": str(c.get("at"))[:16]}],
                            "date": str(c.get("at"))[:10], "shape": "circle", "lat": c["lat"], "lon": c["lon"],
                            "radius_km": GPS_RADIUS_KM, "stats": {"pct": c["pct"], "aircraft": c.get("aircraft")}})
        except Exception as ex:                             # noqa: BLE001
            print(f"[sea-route] error: gps cells: {type(ex).__name__}: {ex}", flush=True)
        try:
            live_rings = [z["ring"] for z in cfg.get("zones", []) if z.get("live")]
            for c in choke_pressure(con, cfg.get("chokepoints", []), now, live_rings):
                if c["events_14d"] <= 0:
                    continue
                w = round(min(0.3, 0.03 * c["events_14d"]), 3)
                out.append({"id": f"choke-{c['id']}", "kind": "chokepoint", "name": f"{c['name']} — recent attacks nearby",
                            "weight": w, "base_weight": w, "live": True,
                            "why": f"{c['events_14d']} attack-type events within {CHOKE_RADIUS_KM:.0f} km in the last {CHOKE_DAYS} days.",
                            "sources": [{"label": "GeoConfirmed and corroborated news alerts", "url": None, "date": now.strftime("%Y-%m-%d")}],
                            "date": now.strftime("%Y-%m-%d"), "shape": "circle", "lat": c["lat"], "lon": c["lon"],
                            "radius_km": CHOKE_RADIUS_KM, "stats": {"events_14d": c["events_14d"]}})
        except Exception as ex:                             # noqa: BLE001
            print(f"[sea-route] error: chokepoints: {type(ex).__name__}: {ex}", flush=True)
        con.close()
    for h in out:
        if h["shape"] == "circle":
            dlat = h["radius_km"] / 111.0
            dlon = h["radius_km"] / max(5.0, 111.0 * math.cos(math.radians(h["lat"])))
            h["bbox"] = (h["lat"] - dlat, h["lat"] + dlat, h["lon"] - dlon, h["lon"] + dlon)
    return out


GRID_DEG = 2.0


def grid_index(hz: list[dict]) -> dict:
    """{(i, j): [hazard, ...]} on a 2° grid, so a route sample checks only
    the hazards whose box covers its cell."""
    idx: dict = {}
    for h in hz:
        s, n, w, e = h["bbox"]
        for i in range(int(math.floor(s / GRID_DEG)), int(math.floor(n / GRID_DEG)) + 1):
            for j in range(int(math.floor(w / GRID_DEG)), int(math.floor(e / GRID_DEG)) + 1):
                idx.setdefault((i, j), []).append(h)
    return idx


_idx_cache: dict = {"key": None, "idx": None}


def _index_for(hz: list[dict]) -> dict:
    if _idx_cache["key"] is not hz:
        _idx_cache.update(key=hz, idx=grid_index(hz))
    return _idx_cache["idx"]


def hazards(force: bool = False) -> list[dict]:
    """The hazard set, cached five minutes."""
    with _haz_lock:
        if force or _haz_cache["val"] is None or time.time() - _haz_cache["at"] > CACHE_S:
            _haz_cache.update(val=build_hazards(), at=time.time())
        return _haz_cache["val"]


def contains(h: dict, lat: float, lon: float) -> bool:
    s, n, w, e = h["bbox"]
    if not (s <= lat <= n and w <= lon <= e):
        return False
    if h["shape"] == "polygon":
        return in_ring(lat, lon, h["ring"])
    return haversine_km(lat, lon, h["lat"], h["lon"]) <= h["radius_km"]


# ── routing ─────────────────────────────────────────────────────────────────

_route_lock = threading.Lock()
_M = None


def _graph():
    global _M
    if _M is None:
        import searoute as sr
        _M = sr.setup_M()
    return _M


def sea_route(origin: tuple, dest: tuple, restrictions: list[str]) -> dict | None:
    """One route via the marine network, or None when the closures leave no path.
    origin/dest are (lat, lon)."""
    import warnings
    import searoute as sr
    with _route_lock, warnings.catch_warnings(record=True) as caught:   # searoute keeps closures on the shared graph
        warnings.simplefilter("always")
        f = sr.searoute([origin[1], origin[0]], [dest[1], dest[0]], units="naut", append_orig_dest=True,
                        restrictions=list(restrictions), return_passages=True, M=_graph())
    if any("No path found" in str(w.message) for w in caught):
        return None                                          # closures leave no path (it would draw a straight line)
    p = f.properties
    length = float(p.get("length") or 0)
    coords = (f.geometry or {}).get("coordinates") or []
    if len(coords) < 3 or not math.isfinite(length) or length <= 0:
        return None
    return {"coords": unwrap([[c[1], c[0]] for c in coords]), "distance_nm": length,
            "passages": sorted(p.get("traversed_passages") or []), "restrictions": sorted(set(restrictions) - set(BASE_RESTRICTIONS))}


def route_label(route: dict) -> str:
    ps = set(route["passages"])
    if "suez" in ps:
        return "Via Suez"
    if "south_africa" in ps and "babalmandab" not in ps:
        return "Via the Cape of Good Hope"
    if "panama" in ps:
        return "Via Panama"
    if "chili" in ps:
        return "Via Cape Horn"
    if route["restrictions"]:
        return "Avoiding " + ", ".join(PASSAGES.get(r, r) for r in route["restrictions"])
    return "Shortest sea route"


def exposure(coords: list, hz: list[dict], speed_kn: float) -> dict:
    """Σ weight × hours inside each hazard, per hazard and in total. Hazards
    sharing a group (the GPS-interference cells, which overlap) count once
    per sample, at the strongest."""
    idx = _index_for(hz)
    per: dict[str, dict] = {}
    total = 0.0
    for lat, lon, nm in samples(coords):
        hours = nm / speed_kn
        here: dict[str, dict] = {}
        ids: dict[str, list] = {}
        for h in idx.get((int(math.floor(lat / GRID_DEG)), int(math.floor(lon / GRID_DEG))), ()):
            if contains(h, lat, lon):
                k = h.get("group") or h["id"]
                ids.setdefault(k, []).append(h["id"])
                if k not in here or h["weight"] > here[k]["weight"]:
                    here[k] = h
        for k, h in here.items():
            d = per.setdefault(k, {"id": k, "name": h["name"], "kind": h["kind"], "weight": 0.0,
                                   "hours": 0.0, "nm": 0.0, "risk": 0.0, "members": set()})
            d["hours"] += hours
            d["nm"] += nm
            d["risk"] += h["weight"] * hours
            d["weight"] = max(d["weight"], h["weight"])
            d["members"].update(ids[k])
            total += h["weight"] * hours
    zones = sorted(per.values(), key=lambda d: -d["risk"])
    for d in zones:
        d["hours"], d["nm"], d["risk"] = round(d["hours"], 1), round(d["nm"]), round(d["risk"], 1)
        d["members"] = sorted(d["members"])
    return {"risk_hours": round(total, 1), "zones": zones}


def default_speed(ship_type: str | None) -> float:
    t = (ship_type or "").lower()
    for k, v in SPEEDS:
        if k in t:
            return v
    return DEFAULT_SPEED


def passage_risk(passage: str, hz: list[dict], chokepoints: list) -> float:
    c = next((c for c in chokepoints if c["id"] == passage), None)
    if not c:
        return 0.0
    return sum(h["weight"] for h in hz if h["kind"] in SERIOUS and h["weight"] >= 0.2 and contains(h, c["lat"], c["lon"]))


def candidates(origin: tuple, dest: tuple, hz: list[dict], avoid: list[str] | None = None,
               chokepoints: list | None = None, max_n: int = 4) -> list[dict]:
    """The shortest route, then the same trip with each risky passage on it
    closed (and the risky ones closed together), deduplicated."""
    chokepoints = chokepoints if chokepoints is not None else load_config().get("chokepoints", [])
    base_r = BASE_RESTRICTIONS + [a for a in (avoid or []) if a in PASSAGES]
    tried, out = set(), []

    def add(restr):
        key = tuple(sorted(set(restr)))
        if key in tried:
            return None
        tried.add(key)
        r = sea_route(origin, dest, list(key))
        if r and all(abs(r["distance_nm"] - o["distance_nm"]) > 5 or r["passages"] != o["passages"] for o in out):
            out.append(r)
        return r

    base = add(base_r)
    if avoid:                                   # also show what the closure costs against the open shortest route
        add(BASE_RESTRICTIONS)
    first = base or (out[0] if out else None)
    if not first:
        return []
    risky = [p for p in first["passages"] if p in AVOIDABLE and passage_risk(p, hz, chokepoints) > 0.05]
    for p in risky:
        add(base_r + [p])
    if len(risky) > 1:
        add(base_r + risky)
    if "suez" in first["passages"] and "babalmandab" in first["passages"]:
        add(base_r + ["suez", "babalmandab"])
    for r in list(out):                         # an alternative that swung to Panama: the Cape as well
        if "panama" in r["passages"] and "panama" not in first["passages"]:
            add(base_r + r["restrictions"] + ["panama"])
    return out[:max_n]


def _fmt_days(d: float) -> str:
    return f"{d:.1f} days" if abs(d) < 100 else f"{d:.0f} days"


def _zone_brief(h: dict) -> str:
    st = h.get("stats") or {}
    if h["kind"] == "strike" or (h.get("live") and h["shape"] == "polygon" and st):
        bits = []
        if st.get("shipping_30d"):
            bits.append(f"{st['shipping_30d']} against shipping or at sea")
        if st.get("events_30d"):
            bits.insert(0, f"{st['events_30d']} conflict events in 30 days")
        return f"{h['name']} ({', '.join(bits)})" if bits else h["name"]
    return h["name"]


def _brief(z: dict, hz_by_id: dict) -> str:
    h = hz_by_id.get(z["id"])
    return _zone_brief(h) if h else z["name"]


def _cap(t: str) -> str:
    return t[:1].lower() + t[1:] if t[:2] not in ("GP",) else t


def _join(names: list[str]) -> str:
    return " and ".join([", ".join(names[:-1]), names[-1]]) if len(names) > 1 else (names[0] if names else "")


def tradeoff(rec: dict, short: dict, hz_by_id: dict, others: list[dict] | None = None, day_value: float = DAY_VALUE) -> str:
    """The choice in plain words."""
    r_rec = rec["exposure"]["risk_hours"]
    if rec["key"] == short["key"]:
        others = [c for c in (others or []) if c["key"] != rec["key"]]
        top = [_brief(z, hz_by_id) for z in rec["exposure"]["zones"] if z["risk"] >= 1][:2]
        if not others:
            if r_rec <= 0.5:
                return f"{rec['label']}: no listed hazard on the way."
            return (f"{rec['label']} — no safer passage to switch to; it crosses {_join(top)} "
                    f"({r_rec:.0f} risk-hours).")
        o = min(others, key=lambda c: c["cost"])
        dd, dn, r_o = o["days"] - rec["days"], o["distance_nm"] - rec["distance_nm"], o["exposure"]["risk_hours"]
        if r_o >= r_rec - 0.5:
            return (f"{rec['label']} is recommended: {_cap(o['label'])} would add {_fmt_days(dd)} and {dn:,.0f} nm "
                    f"without lowering the risk ({r_rec:.0f} vs {r_o:.0f} risk-hours).")
        return (f"{rec['label']} is recommended: {_cap(o['label'])} would add {_fmt_days(dd)} and {dn:,.0f} nm to cut exposure "
                f"from {r_rec:.0f} to {r_o:.0f} risk-hours — not worth it at {day_value:g} risk-hours per day at sea.")
    dd = rec["days"] - short["days"]
    dn = rec["distance_nm"] - short["distance_nm"]
    rec_ids = {z["id"] for z in rec["exposure"]["zones"]}
    avoided = [z for z in short["exposure"]["zones"] if z["id"] not in rec_ids and z["risk"] >= 1]
    names = [_brief(z, hz_by_id) for z in avoided[:2]]
    risky_closed = [p for p in short["passages"] if p not in rec["passages"] and p in AVOIDABLE
                    and passage_risk(p, list(hz_by_id.values()), load_config().get("chokepoints", [])) > 0.05]
    names += [PASSAGES.get(p, p) for p in risky_closed]
    avoids = _join(names) or "the riskiest waters"
    return (f"{rec['label']}: +{_fmt_days(dd)}, +{dn:,.0f} nm; avoids {avoids}. "
            f"Exposure falls from {short['exposure']['risk_hours']:.0f} to {r_rec:.0f} risk-hours.")


def _public_hazard(h: dict) -> dict:
    keep = ("id", "kind", "name", "weight", "base_weight", "why", "sources", "date", "shape", "live", "stats")
    d = {k: h[k] for k in keep if k in h}
    if h["shape"] == "polygon":
        d["ring"] = h["ring"]
    else:
        d.update(lat=round(h["lat"], 3), lon=round(h["lon"], 3), radius_km=h["radius_km"])
    return d


def plan(origin: tuple, dest: tuple, *, speed_kn: float | None = None, ship_type: str | None = None,
         departure: str | None = None, avoid: list[str] | None = None, day_value: float | None = None,
         hz: list[dict] | None = None, origin_name: str | None = None, dest_name: str | None = None) -> dict:
    """Candidates between two (lat, lon), scored, the recommended one first."""
    hz = hz if hz is not None else hazards()
    speed = float(speed_kn or default_speed(ship_type))
    speed = min(40.0, max(3.0, speed))
    dv = DAY_VALUE if day_value is None else max(0.0, float(day_value))
    dep = _utc(departure) or _dt.datetime.now(_dt.timezone.utc)
    cands = candidates(origin, dest, hz, avoid=avoid)
    if not cands:
        return {"ok": False, "error": "No sea route between these points with those passages closed.",
                "origin": {"lat": origin[0], "lon": origin[1], "name": origin_name},
                "destination": {"lat": dest[0], "lon": dest[1], "name": dest_name}}
    for c in cands:
        c["label"] = route_label(c)
        c["key"] = "|".join(c["passages"]) + f"#{round(c['distance_nm'])}"
        c["hours"] = c["distance_nm"] / speed
        c["days"] = round(c["hours"] / 24, 1)
        c["eta"] = (dep + _dt.timedelta(hours=c["hours"])).strftime("%Y-%m-%dT%H:%MZ")
        c["exposure"] = exposure(c["coords"], hz, speed)
        c["cost"] = round(c["exposure"]["risk_hours"] + dv * c["hours"] / 24, 1)
        c["distance_nm"] = round(c["distance_nm"])
    short = min(cands, key=lambda c: c["distance_nm"])
    rec = min(cands, key=lambda c: c["cost"])
    hz_by_id = {h["id"]: h for h in hz}
    sentence = tradeoff(rec, short, hz_by_id, cands, dv)
    mx = max(c["exposure"]["risk_hours"] for c in cands) or 1.0
    ordered = [rec] + sorted([c for c in cands if c is not rec], key=lambda c: c["cost"])
    for c in ordered:
        c["recommended"] = c is rec
        c["shortest"] = c is short
        c["exposure_share"] = round(c["exposure"]["risk_hours"] / mx, 3)
        c["extra_days"] = round(c["days"] - short["days"], 1)
        c["extra_nm"] = c["distance_nm"] - short["distance_nm"]
        c["passage_names"] = [PASSAGES.get(p, p) for p in c["passages"]]
    used = {m for c in cands for z in c["exposure"]["zones"] for m in z["members"]}
    shown = [_public_hazard(h) for h in hz if h["id"] in used or h["shape"] == "polygon"]
    sources = []
    for h in shown:
        if h["id"] in used:
            for s in h.get("sources", []):
                if s not in sources:
                    sources.append(s)
    return {
        "ok": True,
        "origin": {"lat": origin[0], "lon": origin[1], "name": origin_name},
        "destination": {"lat": dest[0], "lon": dest[1], "name": dest_name},
        "speed_kn": speed, "day_value": dv, "departure": dep.strftime("%Y-%m-%dT%H:%MZ"),
        "candidates": ordered, "recommended": rec["key"], "tradeoff": sentence,
        "hazards": shown, "sources": sources,
        "method": (f"Exposure = Σ hazard weight × hours inside it at {speed:g} kn (route sampled every {STEP_NM:g} nm). "
                   f"Recommended = lowest exposure + {dv:g} risk-hours per day at sea. Routing: searoute (Eurostat marine network)."),
    }


# ── ports ───────────────────────────────────────────────────────────────────

_ports: list[dict] | None = None
_ports_lock = threading.Lock()


def ports() -> list[dict]:
    global _ports
    with _ports_lock:
        if _ports is None:
            import searoute
            path = os.path.join(os.path.dirname(searoute.__file__), "data", "ports.geojson")
            out = []
            with open(path, encoding="utf-8") as fh:
                for f in json.load(fh).get("features", []):
                    p = f.get("properties") or {}
                    lon, lat = f["geometry"]["coordinates"][:2]
                    out.append({"name": p.get("name"), "locode": p.get("port"), "country": p.get("cty"),
                                "lat": lat, "lon": lon, "major": (p.get("t") or 0) >= 1})
            _ports = out
        return _ports


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def search_ports(q: str, limit: int = 10) -> list[dict]:
    qn = _norm(q)
    if not qn:
        return []
    hits = []
    for p in ports():
        n = _norm(p["name"])
        lc = _norm(p["locode"])
        if qn == lc:
            r = 0
        elif n == qn:
            r = 1
        elif n.startswith(qn):
            r = 2
        elif qn in n or qn in _norm(p["country"]):
            r = 3
        else:
            continue
        hits.append((r, 0 if p["major"] else 1, len(n), p))
    hits.sort(key=lambda t: t[:3])
    return [h[3] for h in hits[:limit]]


def resolve_destination(text: str) -> dict | None:
    """An AIS destination ("NL RTM", "ROTTERDAM", "EGSUZ>NLRTM", "FOR ORDERS")
    as a port, or None. Only a confident match: an exact LOCODE or name."""
    t = (text or "").strip()
    if not t:
        return None
    if ">" in t:
        t = t.split(">")[-1]
    t = re.sub(r"\b(ETA|VIA)\b.*$", "", t, flags=re.I).strip()
    tn = _norm(t)
    if len(tn) < 3 or tn in ("fororders", "orders", "unknown", "none", "na"):
        return None
    for p in ports():
        if _norm(p["locode"]) == tn:
            return p
    exact = [p for p in ports() if _norm(p["name"]) == tn]
    if exact:
        return sorted(exact, key=lambda p: not p["major"])[0]
    return None


# ── context: is a sea route plan relevant for this vessel, and why ─────────

NEAR_NM = 300.0
LOOKAHEAD_H = 48.0


def _tail(h: dict) -> str:
    b = _zone_brief(h)
    return " — " + b[len(h["name"]) + 2:-1] if b != h["name"] else ""


def _dest_point(lat, lon, brg, km):
    r = km / 6371.0088
    p1, l1, b = math.radians(lat), math.radians(lon), math.radians(brg)
    p2 = math.asin(math.sin(p1) * math.cos(r) + math.cos(p1) * math.sin(r) * math.cos(b))
    l2 = l1 + math.atan2(math.sin(b) * math.sin(r) * math.cos(p1), math.cos(r) - math.sin(p1) * math.sin(p2))
    return math.degrees(p2), norm_lon(math.degrees(l2))


def context(vessel: dict | None, *, hz: list[dict] | None = None, concern: list[str] | None = None,
            min_weight: float = 0.2) -> dict:
    """{relevant, reasons[], vessel, destination, zones[]} — offer "Plan a safer
    sea route" when the vessel's destination route crosses (or its heading
    takes it into, or it is already inside) a hazard zone of weight ≥ min_weight,
    or when it is a vessel of concern."""
    if not vessel or vessel.get("lat") is None:
        return {"relevant": False, "reasons": ["Vessel not in the live AIS picture."], "zones": []}
    hz = hz if hz is not None else hazards()
    heavy = [h for h in hz if h["weight"] >= min_weight and h["kind"] in SERIOUS]
    lat, lon = float(vessel["lat"]), float(vessel["lon"])
    name = vessel.get("name") or f"MMSI {vessel.get('mmsi')}"
    reasons, zones, dest = [], {}, None
    for h in heavy:
        if contains(h, lat, lon):
            zones[h["id"]] = h
            reasons.append(f"{name} is inside the {h['name']} now{_tail(h)}.")
    d = resolve_destination(vessel.get("destination") or "")
    if d:
        dest = {"name": d["name"], "locode": d["locode"], "lat": d["lat"], "lon": d["lon"], "raw": vessel.get("destination")}
        try:
            r = sea_route((lat, lon), (d["lat"], d["lon"]), BASE_RESTRICTIONS)
        except Exception as ex:                             # noqa: BLE001
            print(f"[sea-route] error: context route: {type(ex).__name__}: {ex}", flush=True)
            r = None
        if r:
            ex = exposure(r["coords"], heavy, default_speed(vessel.get("ship_type")))
            crossed = [z for z in ex["zones"] if z["id"] not in zones and z["hours"] >= 1]
            for z in crossed[:3]:
                zones[z["id"]] = next((h for h in heavy if h["id"] == z["id"]), None) or {**z, "shape": "group"}
                reasons.append(f"Its destination {d['name']} ({vessel.get('destination')}) takes it through the "
                               f"{z['name']} for about {z['hours']:.0f} h{_tail(zones[z['id']])}.")
            dest["distance_nm"] = round(r["distance_nm"])
            dest["passages"] = [PASSAGES.get(p, p) for p in r["passages"]]
    elif vessel.get("heading") is not None and (vessel.get("speed") or 0) >= 3:
        km_h = float(vessel["speed"]) * 1.852
        for step in range(1, 9):                            # project the heading 48 h ahead
            plat, plon = _dest_point(lat, lon, float(vessel["heading"]), km_h * LOOKAHEAD_H * step / 8)
            for h in heavy:
                if h["id"] not in zones and contains(h, plat, plon):
                    zones[h["id"]] = h
                    reasons.append(f"On its present heading ({vessel['heading']:.0f}°, {vessel['speed']:.0f} kn) it reaches the "
                                   f"{h['name']} in about {LOOKAHEAD_H * step / 8:.0f} h{_tail(h)}.")
        if not zones:
            for h in heavy:
                if h["shape"] == "polygon":
                    dmin = min(haversine_km(lat, lon, p[0], p[1]) for p in h["ring"]) / 1.852
                    if dmin <= NEAR_NM / 2:
                        zones[h["id"]] = h
                        reasons.append(f"It is about {dmin:.0f} nm from the {h['name']}{_tail(h)}.")
    for c in concern or []:
        reasons.append(f"Vessel of concern: {c}.")
    return {
        "relevant": bool(zones) or bool(concern),
        "reasons": reasons,
        "vessel": {"mmsi": vessel.get("mmsi"), "name": vessel.get("name"), "lat": lat, "lon": lon,
                   "speed": vessel.get("speed"), "heading": vessel.get("heading"), "ship_type": vessel.get("ship_type"),
                   "destination": vessel.get("destination")},
        "destination": dest,
        "default_speed_kn": default_speed(vessel.get("ship_type")),
        "zones": [{"id": h["id"], "name": h["name"], "kind": h["kind"], "weight": h["weight"]} for h in zones.values()],
        "offer": "Plan a safer sea route" if (zones or concern) else None,
    }
