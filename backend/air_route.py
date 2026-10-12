"""
air_route.py — the SAFEST flight path, not just the shortest (owner,
2026-10-12: "risk of a flight path through conflict airspace, GPS-jamming
areas and missile ranges, useful for business travel and charter decisions").

HAZARDS (hazard_set). Every one has a geometry, a weight, why, its source and
a date:
  · conflict-zone airspace — EASA Conflict Zone Information Bulletins and
    state prohibitions (FAA SFARs, EASA Safety Directives), curated by hand in
    backend/air_hazards.json with each bulletin's number, revision and
    valid-until dates. It MUST be kept current: a lapsed bulletin and a stale
    file are both flagged in every answer (`warnings`);
  · standing SAM envelopes where public sources describe them (same file);
  · GPS interference — this app's own measurement from ADS-B integrity
    (gps_interference.py: the live grid, else the last 24 h of its alerts);
  · missile / air-defence / airstrike activity from our events (GeoConfirmed,
    open alerts), classified by keywords and turned into zones that halve
    every 48 h and end after 7 days;
  · a ground-conflict baseline from UCDP (lags ~3 months; low weight, matters
    mostly below FL150 — climb and descent);
  · prohibited / restricted airspace from openAIP, from the tiles already
    cached on disk only (never a network call here).
ALTITUDE is not modelled beyond weights: a hazard has a factor for the
cruise phase and one for the terminal phase (within 200 km of an airport at
either end, i.e. climbing or descending). "Do not operate below FL320" counts
fully at the terminal phase and at a fifth at cruise (FL350 assumed).

PATHS. The direct great circle; then alternatives from a shortest-path search
over a coarse lat/lon grid (16 directions) whose edge cost is distance ×
(1 + λ · hazard weight), with do-not-operate areas blocked in the strict pass;
the grid path is string-pulled into a few waypoints joined by great circles.

SCORING. Exposure = Σ weight × minutes in the zone at cruise speed (850 km/h),
per hazard and in total, the added distance and time, and the trade-off in
words ("Avoiding Iraqi and Iranian airspace adds 47 min via Turkey and the
Caucasus; the direct path crosses 2 EASA conflict-zone bulletin areas and a
GPS-interference area …").

Everything here is blocking (SQLite, shapely, numpy): call it from a thread.
The hazard set is built once per 10 minutes behind a lock.
"""
from __future__ import annotations

import datetime as _dt
import glob
import heapq
import json
import math
import os
import re
import sqlite3
import threading
import time
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import MultiPolygon, Polygon, box, shape
from shapely.ops import unary_union

CODE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = CODE_DIR / "air_hazards.json"
COUNTRIES_PATH = CODE_DIR / "geo" / "countries.geojson"

R_KM = 6371.0088
CRUISE_KMH = 850.0
CRUISE_FL = 350
TERMINAL_KM = 200.0            # climbing / descending this close to an airport
TERMINAL_EXCEPTION_KM = 250.0  # "except to arrive at / depart from aerodromes in the FIR"
TERMINAL_EXCEPTION_FACTOR = 0.25
BELOW_FL_CRUISE_FACTOR = 0.2   # "do not operate below FLxxx", flown above it: caution only
HARD_WEIGHT = 0.75             # an effective weight from here is a do-not-operate area
HAZARD_TTL_S = 600
PLAN_TTL_S = 300
ALT_MIN_EXPOSURE = 12.0        # below this (and no do-not-operate minute) no detour is searched
SAMPLE_KM = 10.0
FAMILY = {"czib": "airspace", "state": "airspace", "openaip": "airspace", "sam": "airspace",
          "air_defence": "conflict", "missile": "conflict", "airstrike": "conflict", "ucdp": "conflict",
          "gps": "gps"}
KIND_LABEL = {"czib": "Conflict-zone bulletin", "state": "State prohibition", "openaip": "Restricted airspace",
              "sam": "Air-defence envelope", "air_defence": "Air-defence activity", "missile": "Missile / drone strikes",
              "airstrike": "Airstrikes", "ucdp": "Ground conflict", "gps": "GPS interference"}


# ── great-circle geometry ───────────────────────────────────────────────────

def wrap_lon(lon):
    return ((np.asarray(lon, dtype=float) + 180.0) % 360.0) - 180.0 if isinstance(lon, np.ndarray) \
        else ((float(lon) + 180.0) % 360.0) - 180.0


def gc_km(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    h = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b_lon - a_lon) / 2) ** 2)
    return 2 * R_KM * math.asin(min(1.0, math.sqrt(h)))


def gc_km_np(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    h = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(np.radians(np.asarray(lon2) - np.asarray(lon1)) / 2) ** 2
    return 2 * R_KM * np.arcsin(np.minimum(1.0, np.sqrt(h)))


def bearing(a_lat, a_lon, b_lat, b_lon) -> float:
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dl = math.radians(b_lon - a_lon)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def destination(lat: float, lon: float, brg: float, km: float) -> tuple[float, float]:
    d = km / R_KM
    p1, l1, b = math.radians(lat), math.radians(lon), math.radians(brg)
    p2 = math.asin(math.sin(p1) * math.cos(d) + math.cos(p1) * math.sin(d) * math.cos(b))
    l2 = l1 + math.atan2(math.sin(b) * math.sin(d) * math.cos(p1), math.cos(d) - math.sin(p1) * math.sin(p2))
    return math.degrees(p2), wrap_lon(math.degrees(l2))


def _xyz(lat, lon):
    p, l = math.radians(lat), math.radians(lon)
    return (math.cos(p) * math.cos(l), math.cos(p) * math.sin(l), math.sin(p))


def gc_segment(a: tuple, b: tuple, step_km: float = 50.0) -> list[list[float]]:
    """Points along the great circle a→b (both ends included), [lat, lon]."""
    d = gc_km(a[0], a[1], b[0], b[1])
    n = max(1, int(math.ceil(d / step_km)))
    if d < 1e-6:
        return [[a[0], a[1]], [b[0], b[1]]]
    va, vb = _xyz(*a), _xyz(*b)
    om = d / R_KM
    so = math.sin(om)
    out = []
    for i in range(n + 1):
        f = i / n
        ka, kb = math.sin((1 - f) * om) / so, math.sin(f * om) / so
        x, y, z = (ka * va[k] + kb * vb[k] for k in range(3))
        out.append([math.degrees(math.atan2(z, math.hypot(x, y))), math.degrees(math.atan2(y, x))])
    return out


def densify(waypoints: list, step_km: float = 50.0) -> list[list[float]]:
    out: list[list[float]] = []
    for a, b in zip(waypoints, waypoints[1:]):
        seg = gc_segment(tuple(a), tuple(b), step_km)
        out.extend(seg if not out else seg[1:])
    return out or [list(waypoints[0])]


def length_km(coords) -> float:
    return sum(gc_km(a[0], a[1], b[0], b[1]) for a, b in zip(coords, coords[1:]))


def unwrap(coords: list) -> list[list[float]]:
    """Longitudes made continuous (no jump at ±180) — for a bbox or a grid."""
    out, prev = [], None
    for lat, lon in coords:
        if prev is not None:
            while lon - prev > 180:
                lon -= 360
            while lon - prev < -180:
                lon += 360
        out.append([lat, lon])
        prev = lon
    return out


def circle_poly(lat: float, lon: float, km: float, n: int = 28) -> Polygon:
    pts = [destination(lat, lon, 360 * i / n, km) for i in range(n)]
    pts = unwrap(pts)
    return Polygon([(lo, la) for la, lo in pts])


def minutes(km: float, kmh: float = CRUISE_KMH) -> float:
    return km / kmh * 60.0


def dur(m: float) -> str:
    m = int(round(abs(m)))
    if m < 60:
        return f"{m} min"
    return f"{m // 60} h {m % 60:02d} min" if m % 60 else f"{m // 60} h"


# ── the hazard set ──────────────────────────────────────────────────────────

_COUNTRIES: dict | None = None
_COUNTRY_TREE = None
_AIRPORT_PLACES = None
_LOCK = threading.Lock()
_HAZ_CACHE: dict = {}


def countries() -> dict:
    """ISO3 → {name, geom} (simplified a little), loaded once."""
    global _COUNTRIES, _COUNTRY_TREE
    if _COUNTRIES is None:
        d = json.loads(COUNTRIES_PATH.read_text())
        out = {}
        for f in d.get("features") or []:
            p = f.get("properties") or {}
            iso = p.get("ISO3166-1-Alpha-3")
            try:
                g = shape(f["geometry"]).buffer(0)
            except Exception:                                # noqa: BLE001
                continue
            if iso and iso != "-99":
                out[iso] = {"name": p.get("name") or iso, "geom": g.simplify(0.02)}
        _COUNTRIES = out
        isos = list(out)
        _COUNTRY_TREE = (shapely.STRtree([out[i]["geom"] for i in isos]), isos)
    return _COUNTRIES


def country_of(lats, lons) -> list[str | None]:
    """ISO3 under each point (None at sea)."""
    countries()
    tree, isos = _COUNTRY_TREE
    pts = shapely.points(wrap_lon(np.asarray(lons, dtype=float)), np.asarray(lats, dtype=float))
    out: list[str | None] = [None] * len(pts)
    pi, gi = tree.query(pts, predicate="within")
    for p, g in zip(pi, gi):
        if out[p] is None:
            out[p] = isos[g]
    return out


def load_config(path: Path | None = None) -> dict:
    return json.loads(Path(path or CONFIG_PATH).read_text())


def _date(s) -> _dt.date | None:
    try:
        return _dt.date.fromisoformat(str(s)[:10])
    except (TypeError, ValueError):
        return None


def config_warnings(cfg: dict, today: _dt.date) -> list[str]:
    """What in the curated file is out of date — said in every answer."""
    out = []
    rev = _date(cfg.get("reviewed"))
    every = int(cfg.get("review_every_days") or 14)
    if not rev or (today - rev).days > every:
        out.append(f"The conflict-zone list was last reviewed {rev or 'never'} — older than {every} days; "
                   "check EASA's CZIB page and the FAA's prohibitions for changes.")
    for z in cfg.get("zones") or []:
        for s in z.get("sources") or []:
            vu = _date(s.get("valid_until"))
            if vu and vu < today:
                out.append(f"{s.get('ref')} ({z.get('name')}) lapsed on {vu.isoformat()} — check whether it was renewed or withdrawn.")
    return out


def _source_date(sources: list) -> str | None:
    ds = [s.get("revised") or s.get("issued") for s in sources or [] if s.get("revised") or s.get("issued")]
    return max(ds) if ds else None


def zone_geometry(geo: dict):
    if geo.get("polygon"):
        return Polygon([(lon, lat) for lat, lon in geo["polygon"]]).buffer(0)
    parts = [countries()[i]["geom"] for i in geo.get("countries") or [] if i in countries()]
    if not parts:
        return None
    g = unary_union(parts)
    if geo.get("clip_lon"):
        w, e = geo["clip_lon"]
        g = g.intersection(box(w, -90, e, 90))
    return None if g.is_empty else g


def _haz(**kw) -> dict:
    h = {"weight": 1.0, "level": "all", "below_fl": None, "cruise_factor": None, "terminal_exception": False,
         "sources": [], "date": None, "valid_until": None, "caveat": None, "stats": {}}
    h.update(kw)
    h["family"] = FAMILY.get(h["kind"], "airspace")
    h["bounds"] = h["geom"].bounds
    shapely.prepare(h["geom"])
    return h


def config_hazards(cfg: dict) -> list[dict]:
    out = []
    for z in cfg.get("zones") or []:
        g = zone_geometry(z.get("geometry") or {})
        if g is None:
            continue
        vus = [s.get("valid_until") for s in z.get("sources") or [] if s.get("valid_until")]
        out.append(_haz(id=z["id"], kind=z.get("kind") or "czib", name=z["name"], adj=z.get("adj"), geom=g,
                        weight=float(z.get("weight", 1.0)), level=z.get("level") or "all", below_fl=z.get("below_fl"),
                        terminal_exception=bool(z.get("terminal_exception")), why=z.get("why"),
                        sources=z.get("sources") or [], date=_source_date(z.get("sources")),
                        valid_until=min(vus) if vus else None, caveat=z.get("geometry_caveat")))
    for s in cfg.get("sam_envelopes") or []:
        out.append(_haz(id=s["id"], kind="sam", name=s["name"], adj=None, geom=circle_poly(s["lat"], s["lon"], s["radius_km"]),
                        weight=float(s.get("weight", 0.3)), why=s.get("why"), sources=s.get("sources") or [],
                        date=_source_date(s.get("sources")), stats={"radius_km": s["radius_km"]}))
    return out


# ── event-derived hazards ───────────────────────────────────────────────────

_AIR_DEF = re.compile(r"\b(air[- ]?defen[cs]e|anti[- ]aircraft|intercept\w*|shot down|shoot[- ]?down|s-[345]00|buk\b|"
                      r"pantsir|tor-m|patriot|nasams|iris-t|surface[- ]to[- ]air|\bsam\b|manpads)", re.I)
_MISSILE = re.compile(r"\b(missile|ballistic|iskander|kinzhal|kalibr|kh-\d+|shahed|geran|long[- ]range (?:drone|uav)|"
                      r"rocket attack|drone attack on|drones? (?:hit|struck|attack(?:ed)?) (?:the )?(?:city|refinery|airport|port))", re.I)
_AIRSTRIKE = re.compile(r"\b(air ?strikes?|air raid|glide bomb|guided bomb|\bkab\b|fab-\d+|bomber|warplane|fighter jet)", re.I)
_TACTICAL = re.compile(r"\b(fpv|molniya|quadcopter|mavic|drop(?:ped)? (?:a )?(?:grenade|munition)|lancet|kamikaze drone)\b", re.I)


def classify_event(text: str | None) -> str | None:
    """air_defence | missile | airstrike, or None (tactical / not airborne)."""
    t = text or ""
    if _AIR_DEF.search(t):
        return "air_defence"
    if _TACTICAL.search(t):
        return None
    if _MISSILE.search(t):
        return "missile"
    if _AIRSTRIKE.search(t):
        return "airstrike"
    return None


def event_decay(age_h: float, half_life_h: float = 48.0, max_age_h: float = 168.0) -> float:
    if age_h < 0:
        age_h = 0.0
    if age_h > max_age_h:
        return 0.0
    return 0.5 ** (age_h / half_life_h)


def _place_from_title(t: str | None) -> str | None:
    if not t or " — " not in t:
        return None
    return t.rsplit(" — ", 1)[1].split(",")[0].strip() or None


def _components(geom) -> list:
    if geom.is_empty:
        return []
    return list(geom.geoms) if isinstance(geom, MultiPolygon) else [geom]


def event_hazards(events: list[dict], rules: dict, now: _dt.datetime) -> list[dict]:
    """events: {lat, lon, cls, at (datetime), title, source, url?} → one hazard per
    connected area per class, weight = the freshest event's decayed weight,
    raised a little by how many there were."""
    out = []
    hl = float(rules.get("half_life_hours", 48))
    max_h = float(rules.get("max_age_days", 7)) * 24
    by_cls: dict[str, list] = {}
    for e in events:
        c = rules.get("classes", {}).get(e["cls"])
        if not c:
            continue
        age_h = (now - e["at"]).total_seconds() / 3600
        d = event_decay(age_h, hl, max_h)
        if d * c["weight"] < 0.05:
            continue
        by_cls.setdefault(e["cls"], []).append({**e, "w": d * c["weight"], "age_h": age_h})
    for cls, evs in by_cls.items():
        c = rules["classes"][cls]
        circles = [circle_poly(e["lat"], e["lon"], c["radius_km"], 20) for e in evs]
        merged = unary_union(circles)
        for k, comp in enumerate(_components(merged)):
            shapely.prepare(comp)
            inside = [e for e, ci in zip(evs, circles) if comp.intersects(ci.centroid)]
            if not inside:
                continue
            inside.sort(key=lambda e: e["at"], reverse=True)
            n = len(inside)
            w = min(1.0, max(e["w"] for e in inside) * min(1.25, 0.85 + 0.05 * n))
            place = next((_place_from_title(e["title"]) for e in inside if _place_from_title(e["title"])), None)
            latest = inside[0]
            out.append(_haz(id=f"ev-{cls}-{round(latest['lat'], 2)}-{round(latest['lon'], 2)}", kind=cls,
                            name=f"{c['label']}{f' near {place}' if place else ''}", adj=None, geom=comp,
                            weight=round(w, 3), cruise_factor=c.get("cruise_factor", 1.0), why=c.get("why"),
                            date=latest["at"].isoformat(),
                            sources=[{"issuer": e["source"], "ref": (e["title"] or "")[:160], "url": e.get("url"),
                                      "issued": e["at"].isoformat()} for e in inside[:3]],
                            stats={"events": n, "radius_km": c["radius_km"], "latest_hours_ago": round(latest["age_h"], 1)}))
    return out


GPS_SEVERE_PCT = 25.0
GPS_DEGRADED_PCT = 15.0
GPS_MIN_DEGRADED = 5


def gps_level(c: dict) -> dict | None:
    """Stricter than the alert (10 %, 3 aircraft): a cell is a routing hazard at
    15 % and five aircraft, severe from 25 % — otherwise the 10 % alerts paint
    half the northern hemisphere and the word stops meaning anything."""
    pct, deg = c.get("pct"), c.get("degraded")
    if pct is None or deg is None:
        return {**c, "level": c.get("level")} if c.get("level") == "severe" else None
    if deg < GPS_MIN_DEGRADED or pct < GPS_DEGRADED_PCT:
        return None
    return {**c, "level": "severe" if pct >= GPS_SEVERE_PCT else "degraded"}


def gps_hazards(cells: list[dict], cfg: dict, place_of) -> list[dict]:
    """cells: {lat, lon, level (degraded|severe), degraded, aircraft, cell_deg} → one hazard per
    connected area, with the peak count of aircraft without a fix."""
    cells = [c for c in (gps_level(c) for c in cells) if c]
    if not cells:
        return []
    squares = []
    for c in cells:
        h = float(c.get("cell_deg") or 0.5)
        squares.append(box(c["lon"] - h, c["lat"] - h, c["lon"] + h, c["lat"] + h))
    out = []
    for comp in _components(unary_union(squares)):
        shapely.prepare(comp)
        mine = [c for c, s in zip(cells, squares) if comp.intersects(s.centroid)]
        if not mine:
            continue
        severe = any(c["level"] == "severe" for c in mine)
        peak = max(mine, key=lambda c: (c.get("degraded") or 0))
        ctr = comp.representative_point()
        place = place_of(peak["lat"], peak["lon"]) or place_of(ctr.y, ctr.x)
        out.append(_haz(id=f"gps-{round(ctr.y, 1)}-{round(ctr.x, 1)}", kind="gps",
                        name=f"GPS interference{f' near {place}' if place else ''}", adj=None, geom=comp,
                        weight=cfg.get("severe_weight", 0.35) if severe else cfg.get("degraded_weight", 0.2),
                        cruise_factor=cfg.get("cruise_factor", 1.0), why=cfg.get("why"),
                        date=max((c.get("at") or "") for c in mine) or None,
                        sources=[{"issuer": "This app — ADS-B navigation integrity (adsb.lol)",
                                  "ref": "gps_interference.py: share of aircraft above 10,000 ft reporting NIC<7 or NACp<8",
                                  "url": None}],
                        stats={"cells": len(mine), "peak_degraded": peak.get("degraded"), "peak_aircraft": peak.get("aircraft"),
                               "peak_pct": peak.get("pct"), "severe": severe}))
    return out


def ucdp_hazards(rows: list[tuple], cfg: dict, data_to: str | None) -> list[dict]:
    """rows: (lat, lon) of recent UCDP events → 1° cells with enough events, merged."""
    cell = float(cfg.get("cell_deg", 1.0))
    counts: dict = {}
    for lat, lon in rows:
        k = (math.floor(lat / cell), math.floor(lon / cell))
        counts[k] = counts.get(k, 0) + 1
    keep = {k: n for k, n in counts.items() if n >= int(cfg.get("min_events", 15))}
    if not keep:
        return []
    sq = {k: box(k[1] * cell, k[0] * cell, (k[1] + 1) * cell, (k[0] + 1) * cell) for k in keep}
    out = []
    for comp in _components(unary_union(list(sq.values()))):
        n = sum(keep[k] for k, s in sq.items() if comp.intersects(s.centroid))
        ctr = comp.representative_point()
        out.append(_haz(id=f"ucdp-{round(ctr.y, 1)}-{round(ctr.x, 1)}", kind="ucdp", name="Ground conflict (baseline)",
                        adj=None, geom=comp, weight=float(cfg.get("weight", 0.12)), cruise_factor=cfg.get("cruise_factor", 0.15),
                        why=cfg.get("why"), date=data_to,
                        sources=[{"issuer": "UCDP Georeferenced Event Dataset (candidate)", "ref": f"events to {data_to}",
                                  "url": "https://ucdp.uu.se/downloads/"}],
                        stats={"events": n}))
    return out


def openaip_hazards(items: list[dict], cfg: dict) -> list[dict]:
    """Normalised openAIP airspaces (airspace.normalise) of type 3 (prohibited) or
    1 (restricted) reaching above min_ceiling_m."""
    out, seen = [], set()
    for a in items:
        t = a.get("openaip_type")
        w = cfg.get("prohibited_weight", 0.3) if t == 3 else cfg.get("restricted_weight", 0.0)
        if t not in (1, 3) or not w or (a.get("ceiling_m") or 0) < float(cfg.get("min_ceiling_m", 5800)):
            continue
        if a.get("id") in seen:
            continue
        seen.add(a.get("id"))
        try:
            g = Polygon(a["ring"]).buffer(0)
        except Exception:                                    # noqa: BLE001
            continue
        if g.is_empty:
            continue
        out.append(_haz(id=f"oaip-{a.get('id')}", kind="openaip", name=f"{'Prohibited' if t == 3 else 'Restricted'} area {a.get('name') or ''}".strip(),
                        adj=None, geom=g, weight=w,
                        level="all", why=cfg.get("why"),
                        sources=[{"issuer": "openAIP", "ref": f"{a.get('name')} ({a.get('country')}) {a.get('floor_label')}–{a.get('ceiling_label')}"
                                  + (" · active by NOTAM" if a.get("by_notam") else ""), "url": "https://www.openaip.net"}],
                        stats={"ceiling": a.get("ceiling_label")}))
    return out


# ── reading the app's data (blocking) ───────────────────────────────────────

def _db_path() -> str:
    try:
        import paths
        return str(paths.DB_PATH)
    except Exception:                                        # noqa: BLE001
        return str(CODE_DIR / "data" / "akili.db")


def _ro(db: str | None = None):
    con = sqlite3.connect(f"file:{db or _db_path()}?mode=ro", uri=True, timeout=10)
    con.row_factory = sqlite3.Row
    return con


def _utc(v) -> _dt.datetime | None:
    if v is None:
        return None
    try:
        t = v if isinstance(v, _dt.datetime) else _dt.datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=_dt.timezone.utc)


_OF = re.compile(r"(\d+) of (\d+) aircraft")


def read_events(con, now: _dt.datetime, max_days: int = 7) -> list[dict]:
    since = (now - _dt.timedelta(days=max_days)).strftime("%Y-%m-%d %H:%M:%S")
    out = []
    try:
        for r in con.execute("SELECT id, title, name, latitude, longitude, date, category, status, original_source "
                             "FROM geoconfirmed_placemarks WHERE date >= ?", (since,)):
            if (r["status"] not in (None, "active")) or r["category"] not in (None, "air", "conflict", "infrastructure"):
                continue
            cls = classify_event(f"{r['title'] or ''} {r['name'] or ''}")
            t = _utc(r["date"])
            if cls and t and r["latitude"] is not None:
                url = (r["original_source"] or "").split()[0] if r["original_source"] else None
                out.append({"lat": r["latitude"], "lon": r["longitude"], "cls": cls, "at": t, "title": r["title"],
                            "source": "GeoConfirmed", "url": url if url and url.startswith("http") else None})
    except sqlite3.Error:
        pass
    try:
        for r in con.execute("SELECT alert_id, title, lat, lon, created_at, source, alert_type FROM alerts WHERE created_at >= ? "
                             "AND lat IS NOT NULL AND status != 'resolved' AND alert_type NOT IN "
                             "('gps_interference','AIS_DARK_SHIP','military_aircraft','geoconfirmed_event','AIS_POSITION_JUMP',"
                             "'AIS_CHOKEPOINT_ACTIVITY','Sanctioned Vessel','Sanctioned Vessel (Possible)') LIMIT 5000", (since,)):
            cls = classify_event(r["title"])
            t = _utc(r["created_at"])
            if cls and t:
                out.append({"lat": float(r["lat"]), "lon": float(r["lon"]), "cls": cls, "at": t, "title": r["title"],
                            "source": f"Alert ({r['source'] or r['alert_type']})", "url": None})
    except sqlite3.Error:
        pass
    return out


def read_gps_cells(con, now: _dt.datetime) -> tuple[list[dict], str]:
    """The live grid when this process has one, else the last 24 h of alerts."""
    try:
        import gps_interference as gi
        live = [c for c in gi.cells() if c.get("level") != "clear"]
        if live:
            at = now.isoformat()
            return [{**c, "at": at} for c in live], "live grid (last 30 min)"
    except Exception:                                        # noqa: BLE001
        pass
    out = []
    since = (now - _dt.timedelta(hours=24)).strftime("%Y-%m-%d %H:%M:%S")
    try:
        for r in con.execute("SELECT entity_id, lat, lon, severity, title, MAX(created_at) AS at FROM alerts "
                             "WHERE alert_type = 'gps_interference' AND created_at >= ? AND lat IS NOT NULL GROUP BY entity_id", (since,)):
            m = _OF.search(r["title"] or "")
            deg, tot = (int(m.group(1)), int(m.group(2))) if m else (None, None)
            pct = (deg / tot * 100) if deg is not None and tot else None
            sev = str(r["severity"] or "").lower()
            out.append({"lat": float(r["lat"]), "lon": float(r["lon"]), "degraded": deg, "aircraft": tot,
                        "pct": round(pct, 1) if pct is not None else None,
                        "level": "severe" if (sev in ("high", "critical") or (pct or 0) >= 25) else "degraded",
                        "cell_deg": 0.5, "at": r["at"]})
    except sqlite3.Error:
        pass
    return out, "alerts, last 24 h"


def read_ucdp(con, days: int = 180) -> tuple[list[tuple], str | None]:
    try:
        last = con.execute("SELECT MAX(date) FROM ucdp_events").fetchone()[0]
        if not last:
            return [], None
        since = (_dt.date.fromisoformat(last[:10]) - _dt.timedelta(days=days)).isoformat()
        rows = [(r[0], r[1]) for r in con.execute("SELECT lat, lon FROM ucdp_events WHERE date >= ? AND pinnable = 1", (since,))]
        return rows, last[:10]
    except (sqlite3.Error, ValueError):
        return [], None


def read_openaip_cache() -> list[dict]:
    try:
        import airspace
        import paths
        d = paths.DATA_DIR / "airspace_cache"
    except Exception:                                        # noqa: BLE001
        return []
    out = []
    for f in glob.glob(str(d / "*.json")):
        try:
            data = json.loads(Path(f).read_text())
        except (OSError, ValueError):
            continue
        for it in data.get("items") or []:
            if it.get("type") in (1, 3):
                n = airspace.normalise(it)
                if n:
                    out.append(n)
    return out


def large_airports(con) -> list[tuple]:
    global _AIRPORT_PLACES
    if _AIRPORT_PLACES is None:
        try:
            _AIRPORT_PLACES = [(r[0], r[1], r[2] or r[3]) for r in con.execute(
                "SELECT latitude, longitude, municipality, airport_name FROM airports WHERE airport_type = 'large_airport'")]
        except sqlite3.Error:
            _AIRPORT_PLACES = []
    return _AIRPORT_PLACES


def place_namer(airports: list[tuple], max_km: float = 400):
    if not airports:
        return lambda lat, lon: None
    la = np.array([a[0] for a in airports])
    lo = np.array([a[1] for a in airports])

    def f(lat, lon):
        d = gc_km_np(lat, lon, la, lo)
        i = int(np.argmin(d))
        return airports[i][2] if d[i] <= max_km else None
    return f


def hazard_set(now: _dt.datetime | None = None, force: bool = False, db: str | None = None) -> dict:
    """Every hazard, built at most every 10 minutes. Blocking."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    with _LOCK:
        hit = _HAZ_CACHE.get(db or "")
        if hit and not force and time.time() - hit["ts"] < HAZARD_TTL_S:
            return hit["data"]
        cfg = load_config()
        hz = config_hazards(cfg)
        notes = {"airspace": f"curated bulletins, reviewed {cfg.get('reviewed')}"}
        try:
            con = _ro(db)
        except sqlite3.Error:
            con = None
        if con is not None:
            try:
                places = place_namer(large_airports(con))
                try:
                    hz += event_hazards(read_events(con, now), cfg.get("event_rules") or {}, now)
                except Exception as ex:                      # noqa: BLE001
                    print(f"[air-route] error: event hazards: {type(ex).__name__}: {ex}", flush=True)
                try:
                    cells, how = read_gps_cells(con, now)
                    hz += gps_hazards(cells, cfg.get("gps") or {}, places)
                    notes["gps"] = how
                except Exception as ex:                      # noqa: BLE001
                    print(f"[air-route] error: gps hazards: {type(ex).__name__}: {ex}", flush=True)
                try:
                    rows, to = read_ucdp(con)
                    hz += ucdp_hazards(rows, (cfg.get("event_rules") or {}).get("ucdp") or {}, to)
                    notes["ucdp"] = f"to {to}" if to else "none"
                except Exception as ex:                      # noqa: BLE001
                    print(f"[air-route] error: ucdp hazards: {type(ex).__name__}: {ex}", flush=True)
            finally:
                con.close()
        try:
            hz += openaip_hazards(read_openaip_cache(), cfg.get("openaip") or {})
        except Exception as ex:                              # noqa: BLE001
            print(f"[air-route] error: openaip hazards: {type(ex).__name__}: {ex}", flush=True)
        data = {"hazards": hz, "warnings": config_warnings(cfg, now.date()), "notes": notes,
                "built_at": now.isoformat(), "reviewed": cfg.get("reviewed")}
        _HAZ_CACHE[db or ""] = {"ts": time.time(), "data": data}
        return data


# ── weights along a path ────────────────────────────────────────────────────

def phase_factor(h: dict, terminal):
    """The hazard's factor at each point (terminal: bool array)."""
    terminal = np.asarray(terminal, dtype=bool)
    if h.get("cruise_factor") is not None:
        return np.where(terminal, 1.0, float(h["cruise_factor"]))
    if h.get("level") == "below_fl" and h.get("below_fl") and CRUISE_FL > int(h["below_fl"]):
        return np.where(terminal, 1.0, BELOW_FL_CRUISE_FACTOR)
    return np.ones(terminal.shape)


def point_weights(hazards: list[dict], lats, lons, terminal, endpoints: list[tuple] = (),
                  per_hazard: bool = False):
    """Effective weight at each point: the heaviest hazard of each family,
    summed over families (airspace + conflict + GPS). Optionally the per-hazard
    arrays too (for the explanation)."""
    lats = np.asarray(lats, dtype=float)
    lons = np.asarray(lons, dtype=float)
    xs = wrap_lon(lons)
    n = len(lats)
    fam: dict[str, np.ndarray] = {}
    hard = np.zeros(n)
    each: dict[str, np.ndarray] = {}
    if n == 0:
        return (np.zeros(0), hard, each) if per_hazard else (np.zeros(0), hard)
    lo_y, hi_y = lats.min(), lats.max()
    lo_x, hi_x = xs.min(), xs.max()
    near_end = None
    for h in hazards:
        b = h["bounds"]
        if b[1] > hi_y or b[3] < lo_y or b[0] > hi_x or b[2] < lo_x:
            continue
        m = shapely.contains_xy(h["geom"], xs, lats)
        if not m.any():
            continue
        w = m * h["weight"] * phase_factor(h, terminal)
        if h.get("terminal_exception") and endpoints:
            if near_end is None:
                near_end = np.zeros(n, dtype=bool)
                for (ea, eo) in endpoints:
                    near_end |= gc_km_np(lats, lons, ea, eo) <= TERMINAL_EXCEPTION_KM
            w = np.where(near_end, w * TERMINAL_EXCEPTION_FACTOR, w)
        f = h["family"]
        fam[f] = np.maximum(fam.get(f, np.zeros(n)), w)
        if f in ("airspace", "conflict"):
            hard = np.maximum(hard, w)
        if per_hazard:
            each[h["id"]] = w
    total = sum(fam.values()) if fam else np.zeros(n)
    return (total, hard, each) if per_hazard else (total, hard)


def terminal_mask(lats, lons, terminals: list[tuple]):
    lats, lons = np.asarray(lats, dtype=float), np.asarray(lons, dtype=float)
    m = np.zeros(len(lats), dtype=bool)
    for (a, o) in terminals or []:
        m |= gc_km_np(lats, lons, a, o) <= TERMINAL_KM
    return m


def score_path(coords: list, hazards: list[dict], terminals: list[tuple] = (), endpoints: list[tuple] = ()) -> dict:
    """Exposure of a path (waypoints joined by great circles): weight × minutes
    at cruise speed, per hazard and in total."""
    pts = densify(coords, SAMPLE_KM)
    la = np.array([p[0] for p in pts])
    lo = np.array([p[1] for p in pts])
    seg = np.array([gc_km(a[0], a[1], b[0], b[1]) for a, b in zip(pts, pts[1:])] + [0.0])
    seg = (seg + np.concatenate([[0.0], seg[:-1]])) / 2       # each sample stands for half of each side
    mins = seg / CRUISE_KMH * 60
    term = terminal_mask(la, lo, terminals)
    total, hard, each = point_weights(hazards, la, lo, term, endpoints, per_hazard=True)
    by_id = {h["id"]: h for h in hazards}
    crossings = []
    for hid, w in each.items():
        inside = w > 0
        if not inside.any():
            continue
        idx = np.nonzero(inside)[0]
        h = by_id[hid]
        crossings.append({"id": hid, "kind": h["kind"], "name": h["name"], "adj": h.get("adj"),
                          "minutes": round(float(mins[inside].sum()), 1),
                          "weighted_minutes": round(float((w * mins).sum()), 2),
                          "max_weight": round(float(w.max()), 3),
                          "first_km": round(float(np.cumsum(seg)[idx[0]]), 0)})
    crossings.sort(key=lambda c: c["first_km"])
    dist = length_km(coords)
    return {"distance_km": round(dist, 1), "minutes": round(minutes(dist), 1),
            "exposure": round(float((total * mins).sum()), 2),
            "max_weight": round(float(total.max()) if len(total) else 0.0, 3),
            "hard_minutes": round(float(mins[hard >= HARD_WEIGHT].sum()), 1),
            "crossings": crossings}


# ── the routing grid ────────────────────────────────────────────────────────

_DIRS = [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1),
         (2, 1), (2, -1), (-2, 1), (-2, -1), (1, 2), (1, -2), (-1, 2), (-1, -2)]


class Field:
    """The weight field over a corridor, on a fine raster: looked up by the
    grid search and the string-pulling instead of testing polygons again."""

    def __init__(self, hazards, lat0, lat1, lon0, lon1, terminals, endpoints, max_cells: int = 160_000):
        area = (lat1 - lat0) * (lon1 - lon0)
        self.res = max(0.2, math.sqrt(area / max_cells))
        self.lat0, self.lon0 = lat0, lon0
        self.ny = int(math.ceil((lat1 - lat0) / self.res)) + 1
        self.nx = int(math.ceil((lon1 - lon0) / self.res)) + 1
        ys = lat0 + np.arange(self.ny) * self.res
        xs = lon0 + np.arange(self.nx) * self.res
        gy, gx = np.meshgrid(ys, xs, indexing="ij")
        fy, fx = gy.ravel(), gx.ravel()
        term = terminal_mask(fy, fx, terminals)
        total, hard = point_weights(hazards, fy, fx, term, endpoints)
        self.total = total.reshape(self.ny, self.nx)
        # the do-not-operate mask grown by one cell, so a path string-pulled
        # past a zone's corner keeps a margin instead of clipping it
        h = hard.reshape(self.ny, self.nx)
        grown = h.copy()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                grown = np.maximum(grown, np.roll(np.roll(h, dy, axis=0), dx, axis=1))
        self.hard = grown

    def at(self, lats, lons):
        iy = np.clip(np.rint((np.asarray(lats) - self.lat0) / self.res).astype(int), 0, self.ny - 1)
        ix = np.clip(np.rint((np.asarray(lons) - self.lon0) / self.res).astype(int), 0, self.nx - 1)
        return self.total[iy, ix], self.hard[iy, ix]


def _seg_cost(field: Field, a, b, lam: float, strict: bool, step_km: float = 12.0) -> float:
    """Cost of the great circle a→b ([lat, lon] in the field's unwrapped longitudes)."""
    d = gc_km(a[0], a[1], b[0], b[1])
    n = max(2, int(d / step_km) + 1)
    pts = unwrap([[a[0], a[1]]] + gc_segment((a[0], a[1]), (b[0], b[1]), d / (n - 1) if d else 1)[1:])
    shift = a[1] - pts[0][1]
    la = np.array([p[0] for p in pts])
    lo = np.array([p[1] for p in pts]) + shift
    w, hd = field.at(la, lo)
    cost = d * (1 + lam * float(w.mean()))
    if strict and (hd >= HARD_WEIGHT).any():
        cost += d * 1000 * float((hd >= HARD_WEIGHT).mean())
    return cost


def grid_route(origin: tuple, dest: tuple, hazards: list[dict], lam: float, strict: bool,
               terminals: list[tuple] = (), endpoints: list[tuple] = (), field: Field | None = None) -> list[list[float]] | None:
    """A cheapest path over a coarse grid, string-pulled to a few waypoints."""
    field = field or corridor_field(origin, dest, hazards, terminals, endpoints)
    step = field.step
    lat0, lon0, ny, nx = field.glat0, field.glon0, field.gny, field.gnx
    o_lon = origin[1]
    d_lon = dest[1]
    while d_lon - o_lon > 180:
        d_lon -= 360
    while d_lon - o_lon < -180:
        d_lon += 360

    def node_ll(i, j):
        return lat0 + i * step, lon0 + j * step

    def snap(lat, lon):
        return (int(round((lat - lat0) / step)), int(round((lon - lon0) / step)))

    s, g = snap(origin[0], o_lon), snap(dest[0], d_lon)
    s = (min(max(s[0], 0), ny - 1), min(max(s[1], 0), nx - 1))
    g = (min(max(g[0], 0), ny - 1), min(max(g[1], 0), nx - 1))
    # node weights, then edge cost from the two ends and the middle
    iy, ix = np.meshgrid(np.arange(ny), np.arange(nx), indexing="ij")
    nw, nh = field.at(lat0 + iy * step, lon0 + ix * step)
    g_lat, g_lon = node_ll(*g)
    dist: dict = {s: 0.0}
    prev: dict = {}
    heap = [(gc_km(*node_ll(*s), g_lat, g_lon), 0.0, s)]
    done = set()
    while heap:
        _, c, u = heapq.heappop(heap)
        if u in done:
            continue
        done.add(u)
        if u == g:
            break
        ula, ulo = node_ll(*u)
        for di, dj in _DIRS:
            v = (u[0] + di, u[1] + dj)
            if not (0 <= v[0] < ny and 0 <= v[1] < nx) or v in done:
                continue
            vla, vlo = node_ll(*v)
            if abs(vla) > 85:
                continue
            d = gc_km(ula, ulo, vla, vlo)
            mla, mlo = (ula + vla) / 2, (ulo + vlo) / 2
            mw, mh = field.at(np.array([mla]), np.array([mlo]))
            w = (nw[u] + nw[v] + 2 * float(mw[0])) / 4
            cost = d * (1 + lam * w)
            if strict:
                hmax = max(nh[u], nh[v], float(mh[0]))
                if hmax >= HARD_WEIGHT and v not in (s, g) and u not in (s, g):
                    cost += d * 1000
            nc = c + cost
            if nc < dist.get(v, float("inf")):
                dist[v] = nc
                prev[v] = u
                heapq.heappush(heap, (nc + gc_km(vla, vlo, g_lat, g_lon), nc, v))
    if g not in dist:
        return None
    nodes = [g]
    while nodes[-1] != s:
        nodes.append(prev[nodes[-1]])
    nodes.reverse()
    pts = [[origin[0], o_lon]] + [list(node_ll(*n)) for n in nodes[1:-1]] + [[dest[0], d_lon]]
    pts = pull_string(pts, field, lam, strict)
    return [[round(p[0], 4), round(wrap_lon(p[1]), 4)] for p in pts]


def pull_string(pts: list, field: Field, lam: float, strict: bool) -> list:
    """Drop every waypoint whose removal does not make the path costlier."""
    if len(pts) <= 2:
        return pts
    legs = [_seg_cost(field, a, b, lam, strict) for a, b in zip(pts, pts[1:])]
    cum = np.concatenate([[0.0], np.cumsum(legs)])
    out = [pts[0]]
    i = 0
    n = len(pts)
    while i < n - 1:
        for j in range(n - 1, i, -1):
            if j == i + 1 or _seg_cost(field, pts[i], pts[j], lam, strict) <= (cum[j] - cum[i]) * 1.005 + 1e-6:
                out.append(pts[j])
                i = j
                break
    return out


def corridor_field(origin, dest, hazards, terminals=(), endpoints=()) -> Field:
    gc = unwrap(gc_segment(origin, dest, 100.0))
    lats = [p[0] for p in gc]
    lons = [p[1] for p in gc]
    span = max(max(lats) - min(lats), max(lons) - min(lons), 1.0)
    m = min(28.0, max(8.0, 0.45 * span))
    lat0, lat1 = max(-84.0, min(lats) - m), min(84.0, max(lats) + m)
    lon0, lon1 = min(lons) - m, max(lons) + m
    f = Field(hazards, lat0, lat1, lon0, lon1, terminals, endpoints)
    f.step = min(2.0, max(0.5, span / 40.0))
    f.glat0, f.glon0 = lat0, lon0
    f.gny = int((lat1 - lat0) / f.step) + 1
    f.gnx = int((lon1 - lon0) / f.step) + 1
    return f


# ── words ───────────────────────────────────────────────────────────────────

REGION = {"GEO": "the Caucasus", "ARM": "the Caucasus", "AZE": "the Caucasus",
          "TKM": "Central Asia", "UZB": "Central Asia", "KAZ": "Central Asia", "KGZ": "Central Asia", "TJK": "Central Asia",
          "ARE": "the UAE", "USA": "the United States", "GBR": "the United Kingdom", "NLD": "the Netherlands",
          "CZE": "Czechia"}


def _join(xs: list[str]) -> str:
    xs = [x for x in xs if x]
    if len(xs) <= 1:
        return "".join(xs)
    return ", ".join(xs[:-1]) + " and " + xs[-1]


def countries_along(coords: list, step_km: float = 50.0) -> list[str]:
    pts = densify(coords, step_km)
    isos = country_of([p[0] for p in pts], [p[1] for p in pts])
    out = []
    for i in isos:
        if i and i not in out:
            out.append(i)
    return out


def via_words(cand: list, direct: list) -> str | None:
    """The two countries the detour takes it furthest from the direct path
    through, in the order flown ("via Egypt and Saudi Arabia")."""
    pts = densify(cand, 50.0)
    dp = densify(direct, 50.0)
    la, lo = np.array([p[0] for p in pts]), np.array([p[1] for p in pts])
    dla, dlo = np.array([p[0] for p in dp]), np.array([p[1] for p in dp])
    off = gc_km_np(la[:, None], lo[:, None], dla[None, :], dlo[None, :]).min(axis=1)
    isos = country_of(la, lo)
    on_direct = set(countries_along(direct))
    best: dict = {}
    for i, (iso, o) in enumerate(zip(isos, off)):
        if not iso or iso in on_direct or o < 150:
            continue
        nm = REGION.get(iso) or countries().get(iso, {}).get("name") or iso
        if nm not in best or o > best[nm][0]:
            best[nm] = (float(o), best.get(nm, (0, i))[1] if nm in best else i)
    top = sorted(best.items(), key=lambda kv: -kv[1][0])[:2]
    top.sort(key=lambda kv: kv[1][1])
    return _join([k for k, _ in top]) or None


def _avoid_names(direct_x: list[dict], cand_x: list[dict]) -> list[str]:
    cand = {c["id"]: c for c in cand_x}
    out = []
    for c in direct_x:
        if c["weighted_minutes"] < 1:
            continue
        k = cand.get(c["id"])
        if k and k["weighted_minutes"] > 0.2 * c["weighted_minutes"]:
            continue
        if c["kind"] in ("czib", "state") and c.get("adj"):
            nm = f"{c['adj']} airspace"
        elif c["kind"] == "gps":
            if any(k["kind"] in ("czib", "state", "air_defence", "missile", "airstrike") for k in direct_x):
                continue          # the conflict airspace is the story; the GPS areas are said in the summary
            nm = "the " + c["name"].replace("GPS interference", "GPS-jamming area", 1)
        elif c["kind"] in ("ucdp", "openaip"):
            continue
        else:
            nm = "the " + c["name"][0].lower() + c["name"][1:]
        if nm not in out:
            out.append(nm)
    # "Iraqi airspace and Iranian airspace" → "Iraqi and Iranian airspace"
    air = [n[:-len(" airspace")] for n in out if n.endswith(" airspace")]
    rest = [n for n in out if not n.endswith(" airspace")]
    lead = [f"{_join(air)} airspace"] if air else []
    return lead + rest


def summary_words(sc: dict, hazards_by_id: dict) -> str:
    x = sc["crossings"]
    czib = sorted({(hazards_by_id[c["id"]]["sources"] or [{}])[0].get("ref") for c in x if c["kind"] == "czib"})
    state = [c for c in x if c["kind"] == "state"]
    gps = [c for c in x if c["kind"] == "gps"]
    conf = [c for c in x if c["kind"] in ("air_defence", "missile", "airstrike")]
    parts = []
    if czib:
        parts.append(f"{len(czib)} EASA conflict-zone bulletin area{'s' if len(czib) > 1 else ''}")
    if state:
        parts.append(_join([c["name"].split(" (")[0] for c in state]) + " (state prohibition)")
    if conf:
        parts.append(_join([c["name"][0].lower() + c["name"][1:] for c in conf[:2]]))
    if gps:
        peak = max((hazards_by_id[c["id"]]["stats"].get("peak_degraded") or 0) for c in gps)
        g = f"{len(gps)} GPS-interference area{'s' if len(gps) > 1 else ''}" if len(gps) > 1 else "a GPS-interference area"
        if peak:
            g += f" (up to {peak} aircraft without a reliable fix at once, last 24 h)"
        parts.append(g)
    return _join(parts)


def tradeoff(direct: dict, alt: dict | None, hazards_by_id: dict) -> str:
    sd = direct["score"]
    what = summary_words(sd, hazards_by_id)
    if not alt:
        if not what:
            return "The direct great-circle path crosses no conflict-zone bulletin area, no recent missile or air-defence activity and no GPS interference we know of."
        return f"The direct path crosses {what}; no alternative avoids it at a reasonable cost."
    sa = alt["score"]
    extra = sa["minutes"] - sd["minutes"]
    names = _avoid_names(sd["crossings"], sa["crossings"])
    av = f"Avoiding {_join(names)}" if names else "The safer path"
    cost = f"adds {dur(extra)}" if extra >= 1 else "costs no extra time"
    via = f" via {alt['via']}" if alt.get("via") else ""
    s = f"{av} {cost}{via}"
    s += f"; the direct path crosses {what}." if what else "."
    left = [c for c in sa["crossings"] if c["max_weight"] >= 0.3]
    if left:
        s += f" The detour still passes {_join([c['name'].split(' (')[0] for c in left[:3]])}."
    return s


# ── plans ───────────────────────────────────────────────────────────────────

def _public_hazard(h: dict, tol: float = 0.08) -> dict:
    g = h["geom"].simplify(tol, preserve_topology=True)
    rings = [[[round(y, 3), round(x, 3)] for x, y in p.exterior.coords] for p in _components(g) if p.area > 0]
    return {"id": h["id"], "kind": h["kind"], "kind_label": KIND_LABEL.get(h["kind"], h["kind"]), "family": h["family"],
            "name": h["name"], "weight": h["weight"], "level": h["level"], "below_fl": h.get("below_fl"),
            "cruise_factor": h.get("cruise_factor"), "why": h.get("why"), "sources": h.get("sources"),
            "date": h.get("date"), "valid_until": h.get("valid_until"), "caveat": h.get("caveat"),
            "stats": h.get("stats"), "rings": rings}


def _candidate(key: str, label: str, coords: list, hazards, terminals, endpoints) -> dict:
    sc = score_path(coords, hazards, terminals, endpoints)
    return {"key": key, "label": label, "waypoints": coords, "coords": [[round(a, 3), round(b, 3)] for a, b in densify(coords, 60.0)],
            "score": sc}


def _same(a: dict, b: dict) -> bool:
    da, db = a["score"]["distance_km"], b["score"]["distance_km"]
    return abs(da - db) <= 0.004 * max(da, db) and abs(a["score"]["exposure"] - b["score"]["exposure"]) <= 0.05 * max(1.0, a["score"]["exposure"])


def risk_level(sc: dict) -> str:
    if sc["hard_minutes"] > 0:
        return "high"
    if sc["max_weight"] >= 0.3:
        return "elevated"
    if sc["exposure"] > 0:
        return "low"
    return "clear"


def plan(origin: dict, dest: dict, hazard_data: dict | None = None, mode: str = "plan",
         terminals: list[tuple] | None = None) -> dict:
    """origin/dest: {lat, lon, code?, name?}. mode "assess": the direct path only."""
    hazard_data = hazard_data or hazard_set()
    hazards = hazard_data["hazards"]
    o, d = (origin["lat"], origin["lon"]), (dest["lat"], dest["lon"])
    terminals = [o, d] if terminals is None else terminals
    endpoints = list(terminals)
    by_id = {h["id"]: h for h in hazards}
    direct = _candidate("direct", "Direct (great circle)", [list(o), list(d)], hazards, terminals, endpoints)
    cands = [direct]
    if mode != "assess" and (direct["score"]["hard_minutes"] > 0 or direct["score"]["exposure"] >= ALT_MIN_EXPOSURE):
        field = corridor_field(o, d, hazards, terminals, endpoints)
        for key, lam, strict in (("avoid", 4.0, True), ("balanced", 1.5, False)):
            wp = grid_route(o, d, hazards, lam, strict, terminals, endpoints, field)
            if not wp:
                continue
            c = _candidate(key, "", wp, hazards, terminals, endpoints)
            if any(_same(c, k) for k in cands):
                continue
            if c["score"]["exposure"] >= direct["score"]["exposure"] * 0.7:
                continue
            cands.append(c)
    for c in cands:
        sc = c["score"]
        c["extra_minutes"] = round(sc["minutes"] - direct["score"]["minutes"], 1)
        c["extra_km"] = round(sc["distance_km"] - direct["score"]["distance_km"], 1)
        c["risk"] = risk_level(sc)
        if c["key"] != "direct":
            c["via"] = via_words(c["waypoints"], direct["waypoints"])
            names = _avoid_names(direct["score"]["crossings"], sc["crossings"])
            c["label"] = (f"Avoiding {_join(names)}" if names else "Lower-exposure path") + (f" via {c['via']}" if c.get("via") else "")
    top = max(c["score"]["exposure"] for c in cands) or 1.0
    for c in cands:
        c["exposure_share"] = round(c["score"]["exposure"] / top, 3)
    best = min(cands, key=lambda c: c["score"]["exposure"] + 0.01 * max(0.0, c["extra_minutes"]))
    if len(cands) == 1:
        best = direct
    alt = best if best is not direct else (min(cands[1:], key=lambda c: c["score"]["exposure"]) if len(cands) > 1 else None)
    sentence = tradeoff(direct, alt, by_id)
    touched = {x["id"] for c in cands for x in c["score"]["crossings"]}
    lats = [p[0] for c in cands for p in c["coords"]]
    lons = [p[1] for c in cands for p in unwrap(c["coords"])]
    bb = box(min(lons) - 3, min(lats) - 3, max(lons) + 3, max(lats) + 3)
    shown = [h for h in hazards if h["id"] in touched
             or (h["family"] == "airspace" and h["kind"] != "openaip" and h["geom"].intersects(bb))]
    shown.sort(key=lambda h: -h["weight"])
    sources = []
    for h in shown:
        for s in h.get("sources") or []:
            k = (s.get("issuer"), s.get("ref"))
            if k not in [(x.get("issuer"), x.get("ref")) for x in sources] and h["id"] in touched:
                sources.append({**s, "for": h["name"]})
    for c in cands:
        c.pop("waypoints", None)
    return {"kind": "air", "mode": mode, "origin": origin, "destination": dest,
            "candidates": cands, "recommended": best["key"], "tradeoff": sentence,
            "hazards": [_public_hazard(h) for h in shown[:120]], "sources": sources,
            "warnings": hazard_data.get("warnings") or [], "data": hazard_data.get("notes"),
            "assumptions": {"cruise_kmh": CRUISE_KMH, "cruise_fl": CRUISE_FL, "terminal_km": TERMINAL_KM,
                            "note": "Exposure = Σ weight × minutes in the zone at 850 km/h. Altitude is modelled only as weights "
                                    "(terminal phase within 200 km of an airport, cruise at FL350 elsewhere). Not an operational "
                                    "flight plan: airways, ATC routings, overflight permits and NOTAMs are not modelled."},
            "generated_at": _dt.datetime.now(_dt.timezone.utc).isoformat()}


# ── airports ────────────────────────────────────────────────────────────────

_TYPE_RANK = "CASE airport_type WHEN 'large_airport' THEN 0 WHEN 'medium_airport' THEN 1 ELSE 2 END"


def _ap(r) -> dict:
    return {"icao": r["icao_code"] or r["ident"], "iata": r["iata_code"] or None, "name": r["airport_name"],
            "city": r["municipality"], "country": r["country_code"], "lat": r["latitude"], "lon": r["longitude"],
            "type": r["airport_type"]}


def airport(code: str, db: str | None = None) -> dict | None:
    c = (code or "").strip().upper()
    if not c:
        return None
    con = _ro(db)
    try:
        r = con.execute(f"SELECT * FROM airports WHERE icao_code = ? OR ident = ? OR iata_code = ? ORDER BY {_TYPE_RANK} LIMIT 1",
                        (c, c, c)).fetchone()
        return _ap(r) if r else None
    finally:
        con.close()


def airport_search(q: str, limit: int = 10, db: str | None = None) -> list[dict]:
    s = (q or "").strip()
    if len(s) < 2:
        return []
    con = _ro(db)
    try:
        up = s.upper()
        rows = con.execute(
            f"SELECT * FROM airports WHERE airport_type IN ('large_airport','medium_airport') AND "
            f"(icao_code = ? OR iata_code = ? OR airport_name LIKE ? OR municipality LIKE ?) "
            f"ORDER BY (CASE WHEN iata_code = ? OR icao_code = ? THEN 0 ELSE 1 END), {_TYPE_RANK}, length(airport_name) LIMIT ?",
            (up, up, f"%{s}%", f"{s}%", up, up, max(1, min(25, limit)))).fetchall()
        return [_ap(r) for r in rows]
    finally:
        con.close()


def resolve_point(v, db: str | None = None) -> dict | None:
    """An airport code, or {lat, lon}, or {code}."""
    if isinstance(v, dict):
        if v.get("lat") is not None and v.get("lon") is not None:
            return {"lat": float(v["lat"]), "lon": float(v["lon"]), "name": v.get("name"), "code": v.get("code")}
        v = v.get("code") or v.get("icao") or v.get("iata")
    if isinstance(v, str):
        a = airport(v, db)
        if a:
            return {**a, "code": a.get("iata") or a.get("icao")}
    return None


_PLAN_CACHE: dict = {}


def plan_between(frm, to, mode: str = "plan", db: str | None = None) -> dict:
    o, d = resolve_point(frm, db), resolve_point(to, db)
    if not o or not d:
        raise ValueError(f"Unknown airport: {frm if not o else to}")
    key = (o["lat"], o["lon"], d["lat"], d["lon"], mode)
    hit = _PLAN_CACHE.get(key)
    if hit and time.time() - hit[0] < PLAN_TTL_S:
        return hit[1]
    res = plan(o, d, hazard_set(db=db), mode)
    if len(_PLAN_CACHE) > 200:
        _PLAN_CACHE.clear()
    _PLAN_CACHE[key] = (time.time(), res)
    return res


# ── live aircraft ───────────────────────────────────────────────────────────

PROJECT_HOURS = 2.0


def projection(ac: dict, hours: float = PROJECT_HOURS) -> list[list[float]]:
    """Straight ahead along the track at the ground speed (great circle)."""
    gs_kmh = float(ac.get("gs") or 450) * 1.852
    km = min(2500.0, max(300.0, gs_kmh * hours))
    lat, lon, trk = float(ac["lat"]), float(ac["lon"]), float(ac.get("track") or 0)
    end = destination(lat, lon, trk, km)
    return [[lat, lon], [end[0], end[1]]]


def assess_live(ac: dict, route: dict | None = None, hazard_data: dict | None = None, mode: str = "plan",
                db: str | None = None) -> dict:
    """A live aircraft: its path to the destination when the route is known
    (with alternatives from where it is now), else its heading projected."""
    hazard_data = hazard_data or hazard_set(db=db)
    pos = {"lat": float(ac["lat"]), "lon": float(ac["lon"]), "name": (ac.get("flight") or ac.get("hex") or "").strip() or "Aircraft"}
    dep = resolve_point(route.get("departure"), db) if route and route.get("departure") else None
    dst = resolve_point(route.get("destination"), db) if route and route.get("destination") else None
    alt = ac.get("alt_baro")
    climbing = isinstance(alt, (int, float)) and alt < 10000
    if dst:
        terms = [(dst["lat"], dst["lon"])] + ([(pos["lat"], pos["lon"])] if climbing else [])
        res = plan(pos, dst, hazard_data, mode, terminals=terms)
        res["projection"] = "destination"
    else:
        path = projection(ac)
        end = {"lat": path[-1][0], "lon": path[-1][1], "name": f"{int(PROJECT_HOURS)} h ahead on {int(round(float(ac.get('track') or 0)))}°"}
        res = plan(pos, end, hazard_data, "assess", terminals=[(pos["lat"], pos["lon"])] if climbing else [])
        res["projection"] = "heading"
        res["candidates"][0]["label"] = f"Projected {int(PROJECT_HOURS)} h on its current heading"
    if dep:
        res["flown"] = [[round(a, 3), round(b, 3)] for a, b in gc_segment((dep["lat"], dep["lon"]), (pos["lat"], pos["lon"]), 60.0)]
    _, _, here = point_weights(hazard_data["hazards"], [pos["lat"]], [pos["lon"]], [climbing], per_hazard=True)
    by_id = {h["id"]: h for h in hazard_data["hazards"]}
    res["inside_now"] = [by_id[k]["name"] for k, w in here.items() if w[0] > 0]
    res["aircraft"] = {"hex": ac.get("hex"), "flight": (ac.get("flight") or "").strip() or None, "lat": pos["lat"], "lon": pos["lon"],
                       "alt_baro": alt, "gs": ac.get("gs"), "track": ac.get("track"), "type": ac.get("type"),
                       "departure": dep, "destination_airport": dst,
                       "route_source": "hexdb.io (by transponder address; may be a previous flight's)" if route and (dep or dst) else None}
    return res


def context_reason(res: dict) -> dict:
    """Is this path worth a look, and why — for the automatic offer."""
    direct = res["candidates"][0]["score"]
    by_id = {h["id"]: h for h in res.get("hazards") or []}
    heavy = [c for c in direct["crossings"] if c["max_weight"] >= 0.3 or c["kind"] in ("czib", "state", "gps")]
    relevant = bool(heavy) or bool(res.get("inside_now"))
    who = (res.get("aircraft") or {}).get("flight") or "This flight"
    if not relevant:
        return {"relevant": False, "reason": None}
    words = summary_words({"crossings": [c for c in heavy if c["id"] in by_id]}, by_id) if heavy else ""
    if res.get("projection") == "heading":
        lead = f"{who}, on its current heading, is projected to cross"
    elif res.get("projection") == "destination":
        dn = (res.get("destination") or {}).get("city") or (res.get("destination") or {}).get("name")
        lead = f"{who}, on its way to {dn}, is projected to cross"
    else:
        lead = "The direct path crosses"
    reason = f"{lead} {words}." if words else ""
    if res.get("inside_now"):
        reason = (reason + " " if reason else "") + f"It is inside {_join(res['inside_now'][:2])} now."
    return {"relevant": True, "reason": reason.strip(), "label": "Check this flight's route", "risk": risk_level(direct)}
