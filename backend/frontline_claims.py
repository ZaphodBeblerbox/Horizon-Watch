"""
frontline_claims.py — what a report SAYS moved, drawn on top of what a map SHOWS.

Owner (2026-10-12): "Saudi claim X from the Houthis" or "Russia takes city Y"
should update the frontline in real time; troop movements as arrows with
NATO unit symbols; drones and missiles drawn from where they were probably
launched to where they were heading.

THREE PRODUCTS, ONE INPUT. Everything here is derived on read from the
normalised strike/control events in strike_events.py (another module owns
extraction): nothing is stored, so a later fix to extraction or to a rule
here shows up on the next request (feedback: derive on read, don't store).

1. CLAIMS (control_change). A claim is a buffer around the named place,
   sized by what the place is (village 1.5 km, town 4 km, city from its
   cached OSM bounding box, else 8 km), hatched in the claimant's side
   colour and labelled "CLAIMED — unverified, by <actor>". It is never
   merged INTO the official line; it sits on top of it. Where DeepStateMap
   covers the theatre (Ukraine) the claim is checked against the current
   occupied polygons: inside them (for a Russian claim) or inside a
   retaken area (for a Ukrainian one) it becomes "confirmed". A later claim
   by the other side for the same place marks it "contradicted". Seven
   days without either and it is "expired" — faded, then dropped at 30.
   Where no open control map exists (Yemen, Sudan, …) the claims ARE the
   line indicator, and say so.

2. MOVEMENTS (control_change, assault, airstrike, shelling, naval). An
   arrow from the actor's side of the front to the target. The start is
   the nearest point of the actor's held ground (DeepStateMap occupied
   area for Russia; outside it for Ukraine), or the same actor's previous
   claim nearby, or the actor's configured rear area — and the basis is
   always carried, because the arrow is ours, not the source's.

3. TRAJECTORIES (drone, missile). The launch origin is the event's own
   origin_hint when it has one; otherwise it is ASSUMED from a per-actor
   launch-area list (each area cited) or, for Russian drones into Ukraine,
   the nearest point of Russian-held ground — whichever is nearest the
   target. Every assumed origin is labelled "assumed origin" on screen.

SIDES ARE NEUTRAL FRAMING. Each theatre names a "blue" and a "red" side;
the colours and the APP-6 friend/hostile frames that carry them are a
convention for telling two sides apart, not a judgment, and the legend
says so.
"""
from __future__ import annotations

import datetime as _dt
import json
import math
import os
import re
import threading
import time

R_KM = 6371.0088

# ── theatres and sides ───────────────────────────────────────────────────
#
# bbox is (west, south, east, north). An event is placed in the first
# theatre whose bbox holds it AND whose aliases name its actor; failing the
# actor, the first whose bbox holds it.

THEATRES: dict[str, dict] = {
    "ukraine": {
        "label": "Russia–Ukraine",
        "bbox": (22.0, 43.5, 41.5, 53.5),
        "official_line": "deepstatemap",
        "countries": ["Ukraine", "Russia", "Belarus", "Moldova"],
        "blue": {"name": "Ukraine", "aliases": ["ukrain", "afu", "zsu", "kyiv", "kiev", "sbu", "gur"]},
        "red": {"name": "Russia", "aliases": ["russia", "rf ", "wagner", "moscow", "kremlin", "vsrf", "chechen", "akhmat"]},
    },
    "yemen": {
        "label": "Yemen / Saudi-led coalition",
        "bbox": (34.0, 11.0, 56.5, 32.5),          # Yemen, Saudi Arabia, the Red Sea
        "official_line": None,
        "countries": ["Yemen", "Saudi Arabia", None],
        "blue": {"name": "Saudi-led coalition", "aliases": ["saudi", "coalition", "uae", "emirat", "yemeni government",
                                                             "government forces", "plc", "giants brigade", "stc", "southern transitional"]},
        "red": {"name": "Houthis", "aliases": ["houthi", "ansar allah", "ansarallah", "ansar-allah", "sanaa forces"]},
    },
    "israel": {
        "label": "Israel / Iran and allies",
        "bbox": (29.0, 24.0, 63.5, 40.0),
        "official_line": None,
        "countries": ["Israel", "Palestine", "Lebanon", "Syria", "Iran", "Iraq", "Jordan"],
        "blue": {"name": "Israel", "aliases": ["israel", "idf", "iaf"]},
        "red": {"name": "Iran and allies", "aliases": ["iran", "irgc", "hezbollah", "hamas", "islamic jihad", "pij",
                                                       "islamic resistance in iraq", "kataib"]},
    },
    "sudan": {
        "label": "Sudan",
        "bbox": (21.5, 8.5, 39.0, 23.0),
        "official_line": None,
        "countries": ["Sudan"],
        "blue": {"name": "Sudanese Armed Forces", "aliases": ["saf", "sudanese army", "sudanese armed forces", "burhan"]},
        "red": {"name": "Rapid Support Forces", "aliases": ["rsf", "rapid support", "hemedti", "dagalo", "janjaweed"]},
    },
}

SIDE_COLOURS = {"blue": "#3d8bff", "red": "#e5484d", "unknown": "#9aa9bc"}

SIDES_NOTE = ("Blue and red tell the two sides apart in each theatre; the APP-6 "
              "friend/hostile frames carry those colours by convention and are "
              "not a judgment.")

# ── where drones and missiles are launched from, when a report doesn't say ──
#
# Keyed by the ACTOR, not the theatre: a Houthi missile at Eilat and one at
# Riyadh leave from the same place. Each area cites who publicly placed
# launches there. The nearest area to the target wins (shortest plausible
# flight), which is a reading, not a fact — hence "assumed origin".

_UAF = "Ukrainian Air Force daily launch reports (launch directions named for Shahed/Geran waves)"
_ISW = "ISW daily Russian Offensive Campaign Assessments"
_UN_YEMEN = "UN Panel of Experts on Yemen (S/2022/50, S/2024/731)"
_CENTCOM = "US CENTCOM strike statements on Houthi launch sites (2024–25)"
_IRAN = "IDF/IRGC statements and CSIS Missile Threat on the April & October 2024 and June 2025 salvos"

LAUNCH_AREAS: dict[str, dict] = {
    "russia": {
        "drone": [
            {"name": "Kursk", "lat": 51.75, "lon": 36.30, "source": _UAF},
            {"name": "Bryansk", "lat": 53.25, "lon": 34.37, "source": _UAF},
            {"name": "Oryol", "lat": 52.97, "lon": 36.07, "source": _UAF},
            {"name": "Primorsko-Akhtarsk", "lat": 46.05, "lon": 38.17, "source": _UAF},
            {"name": "Cape Chauda, Crimea", "lat": 45.00, "lon": 35.84, "source": _UAF},
            {"name": "Millerovo", "lat": 48.92, "lon": 40.40, "source": _UAF},
        ],
        "ballistic": [
            {"name": "Belgorod region", "lat": 50.60, "lon": 36.60, "source": _ISW},
            {"name": "Kursk region", "lat": 51.75, "lon": 36.30, "source": _ISW},
            {"name": "Voronezh region", "lat": 51.10, "lon": 39.30, "source": _ISW},
            {"name": "Crimea", "lat": 45.10, "lon": 33.98, "source": _ISW},
            {"name": "Rostov region", "lat": 47.90, "lon": 39.70, "source": _ISW},
        ],
        "cruise": [
            {"name": "Engels (Tu-95MS launch)", "lat": 51.48, "lon": 46.21, "source": _UAF},
            {"name": "Caspian Sea (Tu-95MS launch)", "lat": 45.50, "lon": 49.50, "source": _UAF},
            {"name": "Black Sea Fleet (Kalibr)", "lat": 44.60, "lon": 37.80, "source": _UAF},
        ],
        "front": "red",      # Russian drones may come straight off the front line
    },
    "ukraine": {
        # Ukrainian-held ground nearest the Russian border, for long-range
        # drones into Russia when the front line itself is farther.
        "drone": [
            {"name": "Sumy region (Ukrainian-held)", "lat": 50.91, "lon": 34.80, "source": "Ukrainian-held territory (DeepStateMap: not occupied)"},
            {"name": "Kharkiv region (Ukrainian-held)", "lat": 49.99, "lon": 36.23, "source": "Ukrainian-held territory (DeepStateMap: not occupied)"},
            {"name": "Chernihiv region (Ukrainian-held)", "lat": 51.49, "lon": 31.29, "source": "Ukrainian-held territory (DeepStateMap: not occupied)"},
        ],
        "ballistic": [], "cruise": [],
        "front": "blue",     # from the nearest Ukrainian-held point toward the target
    },
    "houthis": {
        "drone": [
            {"name": "Sa'dah", "lat": 16.94, "lon": 43.76, "source": _UN_YEMEN},
            {"name": "Sanaa", "lat": 15.37, "lon": 44.19, "source": _UN_YEMEN},
            {"name": "Hodeidah", "lat": 14.80, "lon": 42.95, "source": _CENTCOM},
        ],
        "ballistic": [
            {"name": "Sa'dah", "lat": 16.94, "lon": 43.76, "source": _UN_YEMEN},
            {"name": "Sanaa", "lat": 15.37, "lon": 44.19, "source": _UN_YEMEN},
            {"name": "Hodeidah", "lat": 14.80, "lon": 42.95, "source": _CENTCOM},
            {"name": "Dhamar", "lat": 14.55, "lon": 44.40, "source": _CENTCOM},
        ],
        "cruise": [
            {"name": "Hodeidah", "lat": 14.80, "lon": 42.95, "source": _CENTCOM},
            {"name": "Sanaa", "lat": 15.37, "lon": 44.19, "source": _UN_YEMEN},
        ],
    },
    "iran": {
        "drone": [
            {"name": "Kermanshah", "lat": 34.31, "lon": 47.07, "source": _IRAN},
            {"name": "Isfahan", "lat": 32.65, "lon": 51.67, "source": _IRAN},
        ],
        "ballistic": [
            {"name": "Kermanshah", "lat": 34.31, "lon": 47.07, "source": _IRAN},
            {"name": "Tabriz", "lat": 38.08, "lon": 46.29, "source": _IRAN},
            {"name": "Isfahan", "lat": 32.65, "lon": 51.67, "source": _IRAN},
            {"name": "Shiraz", "lat": 29.59, "lon": 52.58, "source": _IRAN},
        ],
        "cruise": [
            {"name": "Kermanshah", "lat": 34.31, "lon": 47.07, "source": _IRAN},
        ],
    },
    "hezbollah": {
        "drone": [{"name": "South Lebanon", "lat": 33.27, "lon": 35.40, "source": "IDF statements on Hezbollah launches"}],
        "ballistic": [{"name": "South Lebanon", "lat": 33.27, "lon": 35.40, "source": "IDF statements on Hezbollah launches"}],
        "cruise": [],
    },
}

# Which LAUNCH_AREAS key an actor string belongs to.
_ACTOR_KEYS = [
    ("houthis", ("houthi", "ansar allah", "ansarallah", "ansar-allah")),
    ("hezbollah", ("hezbollah",)),
    ("iran", ("iran", "irgc")),
    ("russia", ("russia", "wagner", "vsrf", "moscow", "kremlin")),
    ("ukraine", ("ukrain", "afu", "zsu", "sbu", "gur")),
]

# Rear areas a ground arrow may start from when nothing better is known.
REAR_AREAS = {
    ("yemen", "red"): [{"name": "Sanaa", "lat": 15.37, "lon": 44.19}, {"name": "Sa'dah", "lat": 16.94, "lon": 43.76}],
    ("yemen", "blue"): [{"name": "Marib", "lat": 15.46, "lon": 45.32}, {"name": "Aden", "lat": 12.79, "lon": 45.03}],
    ("sudan", "blue"): [{"name": "Port Sudan", "lat": 19.62, "lon": 37.22}, {"name": "Omdurman", "lat": 15.65, "lon": 32.48}],
    ("sudan", "red"): [{"name": "Nyala", "lat": 12.05, "lon": 24.88}, {"name": "El Fasher area", "lat": 13.63, "lon": 25.35}],
    ("israel", "blue"): [{"name": "Gaza envelope", "lat": 31.45, "lon": 34.50}, {"name": "Northern Israel", "lat": 33.05, "lon": 35.40},
                         {"name": "Jerusalem", "lat": 31.78, "lon": 35.22}],
}

# ── units → APP-6 / MIL-STD-2525C letter SIDCs ───────────────────────────
#
# 15 characters: S (warfighting) · affiliation · dimension · P (present) ·
# function (6) · echelon (none: "-") · country/OB ("----"). Echelon is never
# known from a news line, so it is never drawn.

_UNIT_FUNCTION = {
    "infantry": ("G", "UCI---"),
    "airborne": ("G", "UCIA--"),
    "air assault": ("G", "UCIS--"),
    "marines": ("G", "UCIN--"),
    "naval infantry": ("G", "UCIN--"),
    "mechanized": ("G", "UCIZ--"),
    "armoured": ("G", "UCA---"),
    "armored": ("G", "UCA---"),
    "armour": ("G", "UCA---"),
    "tank": ("G", "UCA---"),
    "artillery": ("G", "UCF---"),
    "air force": ("A", "MFA---"),
    "aviation": ("A", "MFA---"),
    "naval": ("S", "CL----"),
    "navy": ("S", "CL----"),
    "drones": ("A", "MFQ---"),
    "drone": ("A", "MFQ---"),
    "uav": ("A", "MFQ---"),
    "missile": ("A", "WM----"),
    "ballistic": ("A", "WMSS--"),
}
_ACT_DEFAULT_UNIT = {
    "airstrike": "air force", "shelling": "artillery", "naval": "naval",
    "drone": "drones", "missile": "missile",
}


def sidc_for(unit_type: str | None, side: str | None, act: str | None = None) -> str:
    """A 15-character 2525C SIDC. Unknown unit → a generic ground unit.
    blue → F (friend frame), red → H (hostile frame), else U (unknown)."""
    aff = {"blue": "F", "red": "H"}.get(side or "", "U")
    key = (unit_type or "").strip().lower() or _ACT_DEFAULT_UNIT.get(act or "", "")
    dim, fn = _UNIT_FUNCTION.get(key, ("G", "U-----"))
    return f"S{aff}{dim}P{fn}-----"[:15].ljust(15, "-")


def unit_label(unit_type: str | None, act: str | None = None) -> str | None:
    key = (unit_type or "").strip().lower()
    if key:
        return key[:1].upper() + key[1:]
    return None


# ── geometry, without shapely where it isn't needed ──────────────────────

def haversine_km(a: tuple, b: tuple) -> float:
    (la1, lo1), (la2, lo2) = a, b
    p1, p2 = math.radians(la1), math.radians(la2)
    dp, dl = p2 - p1, math.radians(lo2 - lo1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_KM * math.asin(min(1.0, math.sqrt(h)))


def bearing_deg(a: tuple, b: tuple) -> float:
    (la1, lo1), (la2, lo2) = a, b
    p1, p2, dl = math.radians(la1), math.radians(la2), math.radians(lo2 - lo1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def destination(p: tuple, brg: float, km: float) -> tuple:
    la, lo = math.radians(p[0]), math.radians(p[1])
    d, b = km / R_KM, math.radians(brg)
    la2 = math.asin(math.sin(la) * math.cos(d) + math.cos(la) * math.sin(d) * math.cos(b))
    lo2 = lo + math.atan2(math.sin(b) * math.sin(d) * math.cos(la), math.cos(d) - math.sin(la) * math.sin(la2))
    return (math.degrees(la2), (math.degrees(lo2) + 540) % 360 - 180)


def circle_polygon(lat: float, lon: float, km: float, n: int = 48) -> dict:
    ring = [destination((lat, lon), 360.0 * i / n, km) for i in range(n)]
    ring.append(ring[0])
    return {"type": "Polygon", "coordinates": [[[round(lo, 5), round(la, 5)] for la, lo in ring]]}


# ── how big a place is ───────────────────────────────────────────────────

PLACE_RADIUS_KM = {"hamlet": 1.0, "village": 1.5, "suburb": 2.0, "neighbourhood": 1.0, "quarter": 1.0,
                   "locality": 1.5, "town": 4.0, "city": 8.0}


def _cached_geocode(name: str) -> dict | None:
    """A cached Nominatim hit for this name, or None. Never calls out —
    this runs on the request path."""
    if not name:
        return None
    try:
        import geocode_utils as gu
        key = gu._make_cache_key(name, None, None, None)
        with gu._cache_lock:
            hits = gu._cache.get(key)
        if hits is None:
            dc = gu._get_disk_cache()
            hits = dc.get(f"geo:{key}") if dc is not None else None
        if hits:
            hits = gu.prefer_settlement(list(hits))
            return hits[0]
    except Exception:                                       # noqa: BLE001
        return None
    return None


def place_radius(ev: dict) -> tuple[float, str, str]:
    """(radius_km, place_type, basis) for the claim buffer."""
    explicit = str(ev.get("place_type") or "").lower()
    prec = str(ev.get("precision") or "").lower()
    for t in (explicit, prec):
        if t in PLACE_RADIUS_KM and t != "city":
            return PLACE_RADIUS_KM[t], t, "place type from the report"
    hit = _cached_geocode(str(ev.get("target_name") or ""))
    if hit and hit.get("class") == "place":
        t = str(hit.get("type") or "")
        if t == "city":
            bb = hit.get("boundingbox") or []
            try:
                s, n, w, e = (float(x) for x in bb[:4])
                half_diag = haversine_km((s, w), (n, e)) / 2.0
                return max(4.0, min(20.0, half_diag * 0.75)), "city", "OSM extent (cached geocode)"
            except Exception:                               # noqa: BLE001
                return PLACE_RADIUS_KM["city"], "city", "OSM place type (cached geocode)"
        if t in PLACE_RADIUS_KM:
            return PLACE_RADIUS_KM[t], t, "OSM place type (cached geocode)"
    if explicit == "city":
        return PLACE_RADIUS_KM["city"], "city", "place type from the report"
    if prec == "region":
        return PLACE_RADIUS_KM["city"], "region", "placed only to a region — approximate"
    return PLACE_RADIUS_KM["town"], "town", "size unknown — drawn as a town"


# ── events in ────────────────────────────────────────────────────────────
#
# strike_events.events(since, bbox=None, acts=None) is built concurrently by
# another module. Until it lands, this reads nothing — plus a synthetic file
# when FRONTLINE_CLAIMS_SYNTHETIC names one (screenshots only; every event
# from it is flagged synthetic and labelled so on screen).

def _parse_time(v) -> float | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v) / (1000.0 if v > 1e12 else 1.0)
    if isinstance(v, _dt.datetime):
        return (v if v.tzinfo else v.replace(tzinfo=_dt.timezone.utc)).timestamp()
    try:
        d = _dt.datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return (d if d.tzinfo else d.replace(tzinfo=_dt.timezone.utc)).timestamp()
    except Exception:                                       # noqa: BLE001
        return None


def _synthetic_events() -> list[dict]:
    path = os.environ.get("FRONTLINE_CLAIMS_SYNTHETIC")
    if not path or not os.path.exists(path):
        return []
    try:
        with open(path) as fh:
            rows = json.load(fh)
        now = time.time()
        out = []
        for r in rows:
            r = dict(r)
            if "minutes_ago" in r:
                r["time"] = _dt.datetime.fromtimestamp(now - 60 * float(r.pop("minutes_ago")),
                                                       _dt.timezone.utc).isoformat()
            r["synthetic"] = True
            out.append(_normalise(r))
        return out
    except Exception:                                       # noqa: BLE001
        return []


def _normalise(r: dict) -> dict:
    """strike_events says "control"; this module says "control_change"."""
    r = dict(r)
    if r.get("act") == "control":
        r["act"] = "control_change"
    return r


def load_events(since_ts: float, acts=None) -> tuple[list[dict], str]:
    """(events, source_status)."""
    out, status = [], "strike_events unavailable"
    try:
        import strike_events as _se                         # noqa: WPS433
        since_dt = _dt.datetime.fromtimestamp(since_ts, _dt.timezone.utc)
        try:
            rows = _se.events(since_dt, bbox=None, acts=acts)
        except TypeError:
            rows = _se.events(since_ts, None, acts)
        out = [_normalise(r) for r in (rows or []) if isinstance(r, dict)]
        status = "strike_events"
    except ImportError:
        pass
    except Exception as e:                                  # noqa: BLE001
        status = f"strike_events error: {type(e).__name__}: {e}"
    syn = _synthetic_events()
    if syn:
        out.extend(r for r in syn if (_parse_time(r.get("time")) or 0) >= since_ts)
        status += " + synthetic"
    return out, status


# ── which theatre, which side ────────────────────────────────────────────

def _in_bbox(lat, lon, bb) -> bool:
    return bb[0] <= lon <= bb[2] and bb[1] <= lat <= bb[3]


def _side_by_alias(text: str, theatre: dict) -> str | None:
    t = f" {text.lower()} "
    for side in ("blue", "red"):
        if any(a in t for a in theatre[side]["aliases"]):
            return side
    return None


def theatre_and_side(ev: dict) -> tuple[str | None, str]:
    lat, lon = ev.get("lat"), ev.get("lon")
    actor = str(ev.get("actor") or "")
    given = str(ev.get("actor_side") or "").lower()
    cands = [k for k, t in THEATRES.items()
             if lat is not None and lon is not None and _in_bbox(float(lat), float(lon), t["bbox"])]
    # the actor names the theatre when several boxes overlap (Yemen/Israel)
    for k in cands:
        s = _side_by_alias(actor, THEATRES[k])
        if s:
            return k, s
    # no actor named for any theatre: only a theatre whose countries hold the point
    country = ev.get("country") if "country" in ev else _country_at(lat, lon)
    cands = [k for k in cands if country in THEATRES[k].get("countries", [])
             or (country is None and None in THEATRES[k].get("countries", []))]
    key = cands[0] if cands else None
    if given in ("blue", "red"):
        return key, given
    # actor_side may carry a side NAME ("Russia", "Houthis")
    if key and given:
        s = _side_by_alias(given, THEATRES[key])
        if s:
            return key, s
    return key, "unknown"


def _country_at(lat, lon):
    try:
        import geo_land
        return geo_land.country_at(lat, lon)
    except Exception:                                       # noqa: BLE001
        return None


def self_target(ev: dict, theatre: str | None, side: str, occ=None) -> bool:
    """A strike on the actor's own ground: almost always a misattribution
    (an interception, a strike BY the other side). Not drawn as a flight."""
    try:
        lat, lon = float(ev["lat"]), float(ev["lon"])
    except Exception:                                       # noqa: BLE001
        return False
    if theatre == "ukraine" and occ is not None and side in ("red", "blue"):
        try:
            from shapely.geometry import Point
            own = held_ground(occ).get(side)
            return bool(own is not None and own.contains(Point(lon, lat)))
        except Exception:                                   # noqa: BLE001
            return False
    home, country = ev.get("actor_home"), ev.get("country")
    return bool(home and country and home == country)


def actor_key(actor: str | None) -> str | None:
    a = (actor or "").lower()
    for k, aliases in _ACTOR_KEYS:
        if any(x in a for x in aliases):
            return k
    return None


# ── the official line (DeepStateMap) — only when already cached ──────────

_OCC = {"snap": None, "geom": None, "dismissed": None}
_OCC_LOCK = threading.Lock()
_WARMING = {"t": 0.0}


def _warm_deepstate():
    def run():
        try:
            import frontlines as _fl
            _fl.fetch()
        except Exception:                                   # noqa: BLE001
            pass
    if time.time() - _WARMING["t"] > 600:
        _WARMING["t"] = time.time()
        threading.Thread(target=run, name="frontline-claims-warm", daemon=True).start()


def occupied_now():
    """(occupied union, dismissed union, snapshot meta) from the CACHED
    DeepStateMap snapshot, or (None, None, None). A cold cache is warmed in
    the background, never fetched on the request path."""
    try:
        import frontlines as _fl
        hit = _fl._CACHE.get("latest")
    except Exception:                                       # noqa: BLE001
        return None, None, None
    if not hit or not (hit.get("data") or {}).get("available"):
        _warm_deepstate()
        return None, None, None
    data = hit["data"]
    snap = data.get("snapshot_id")
    with _OCC_LOCK:
        if _OCC["snap"] == snap and _OCC["geom"] is not None:
            return _OCC["geom"], _OCC["dismissed"], {"snapshot_id": snap, "drawn_at": data.get("drawn_at")}
    try:
        from shapely.geometry import shape
        from shapely.ops import unary_union
        occ, dis = [], []
        for f in (data.get("geojson") or {}).get("features") or []:
            st = (f.get("properties") or {}).get("status")
            if st not in ("occupied", "dismissed"):
                continue
            try:
                g = shape(f["geometry"])
                if not g.is_valid:
                    g = g.buffer(0)
                if not g.is_empty:
                    (occ if st == "occupied" else dis).append(g)
            except Exception:                               # noqa: BLE001
                continue
        og = unary_union(occ) if occ else None
        dg = unary_union(dis) if dis else None
    except Exception:                                       # noqa: BLE001
        return None, None, None
    with _OCC_LOCK:
        _OCC.update(snap=snap, geom=og, dismissed=dg)
    return og, dg, {"snapshot_id": snap, "drawn_at": data.get("drawn_at")}


_HELD = {"key": None, "val": None}


def held_ground(occ) -> dict:
    """{"red": occupied ∪ Russia, "blue": Ukraine − occupied} — who holds
    what, for arrows and origins. Natural Earth borders (geo_land)."""
    if occ is None:
        return {}
    if _HELD["key"] is occ:
        return _HELD["val"]
    out = {"red": occ, "blue": None}
    try:
        import geo_land
        from shapely.ops import unary_union
        _tree, geoms, names = geo_land._index()
        ua = next((g for g, n in zip(geoms, names) if n == "Ukraine"), None)
        ru = next((g for g, n in zip(geoms, names) if n == "Russia"), None)
        if ru is not None:
            out["red"] = unary_union([occ, ru])
        if ua is not None:
            out["blue"] = ua.difference(occ)
    except Exception:                                       # noqa: BLE001
        pass
    _HELD.update(key=occ, val=out)
    return out


def _nearest_on(geom, lat: float, lon: float):
    """(lat, lon) of the nearest point of geom's boundary to (lat, lon)."""
    from shapely.geometry import Point
    from shapely.ops import nearest_points
    p = Point(lon, lat)
    target = geom.boundary if geom.contains(p) else geom
    q = nearest_points(p, target)[1]
    return (q.y, q.x)


# ── 1. claims ────────────────────────────────────────────────────────────

CONFIRM_WINDOW_S = 7 * 86400       # unconfirmed this long → expired
DROP_AFTER_S = 30 * 86400          # gone from the map after this
SAME_PLACE_KM = 3.0
MERGE_WINDOW_S = 48 * 3600


def _sources(ev: dict) -> list:
    s = ev.get("sources") or []
    if isinstance(s, (str, dict)):
        s = [s]
    return list(s)


def _check_official(theatre: str | None, side: str, lat: float, lon: float, occ, dis) -> str | None:
    """'confirmed' when the official line agrees, else None."""
    if theatre != "ukraine" or occ is None:
        return None
    from shapely.geometry import Point
    p = Point(lon, lat)
    if side == "red" and occ.buffer(0.005).contains(p):          # ~0.5 km tolerance
        return "confirmed"
    if side == "blue" and not occ.contains(p) and dis is not None and dis.buffer(0.005).contains(p):
        return "confirmed"
    return None


def build_claims(events: list[dict], now: float | None = None, occ=None, dis=None, official_meta=None) -> list[dict]:
    now = now or time.time()
    rows = []
    for ev in events:
        if str(ev.get("act") or "") != "control_change":
            continue
        try:
            lat, lon = float(ev["lat"]), float(ev["lon"])
        except Exception:                                   # noqa: BLE001
            continue
        t = _parse_time(ev.get("time"))
        if t is None or now - t > DROP_AFTER_S:
            continue
        theatre, side = theatre_and_side(ev)
        if not ev.get("actor"):
            continue            # "a vehicle seized near X" with nobody named is not a claim of ground
        rows.append((t, ev, lat, lon, theatre, side))
    rows.sort(key=lambda r: r[0])

    claims: list[dict] = []
    for t, ev, lat, lon, theatre, side in rows:
        # the same place, the same side, within 48 h → one claim, more sources
        same = next((c for c in claims if c["side"] == side and c["theatre"] == theatre
                     and haversine_km((c["lat"], c["lon"]), (lat, lon)) <= SAME_PLACE_KM
                     and t - c["_t_last"] <= MERGE_WINDOW_S), None)
        if same:
            same["sources"].extend(x for x in _sources(ev) if x not in same["sources"])
            same["event_ids"].append(ev.get("id"))
            same["_t_last"] = t
            if ev.get("unit_type") and not same.get("unit_type"):
                same["unit_type"] = ev.get("unit_type")
            continue
        km, ptype, basis = place_radius(ev)
        claims.append({
            "id": f"claim-{ev.get('id') or f'{lat:.3f},{lon:.3f}'}",
            "event_ids": [ev.get("id")],
            "theatre": theatre,
            "theatre_label": THEATRES.get(theatre or "", {}).get("label"),
            "side": side,
            "side_name": THEATRES.get(theatre or "", {}).get(side, {}).get("name") if side in ("blue", "red") else None,
            "colour": SIDE_COLOURS.get(side, SIDE_COLOURS["unknown"]),
            "actor": ev.get("actor"),
            "target_name": ev.get("target_name"),
            "lat": lat, "lon": lon,
            "time": _dt.datetime.fromtimestamp(t, _dt.timezone.utc).isoformat(),
            "_t": t, "_t_last": t,
            "radius_km": km, "place_type": ptype, "size_basis": basis,
            "unit_type": ev.get("unit_type"),
            "sources": _sources(ev),
            "casualties": ev.get("casualties"),
            "synthetic": bool(ev.get("synthetic")),
            "geometry": circle_polygon(lat, lon, km),
        })

    # contradiction: a later claim by the OTHER side for the same place
    for c in claims:
        later = [o for o in claims if o is not c and o["theatre"] == c["theatre"]
                 and o["side"] != c["side"] and o["_t"] > c["_t"]
                 and haversine_km((o["lat"], o["lon"]), (c["lat"], c["lon"])) <= SAME_PLACE_KM + c["radius_km"]]
        official = _check_official(c["theatre"], c["side"], c["lat"], c["lon"], occ, dis)
        age = now - c["_t"]
        if later:
            c["status"] = "contradicted"
            c["status_note"] = f"contradicted by a later claim from {later[0].get('actor') or later[0].get('side_name')}"
        elif official:
            c["status"] = "confirmed"
            c["status_note"] = ("DeepStateMap's latest map agrees"
                                + (f" (drawn {official_meta.get('drawn_at')})" if official_meta else ""))
        elif age > CONFIRM_WINDOW_S:
            c["status"] = "expired"
            c["status_note"] = ("not confirmed by the official line within 7 days"
                                if c["theatre"] == "ukraine" else
                                "older than 7 days; no open control map for this theatre to confirm it")
        else:
            c["status"] = "claimed"
            c["status_note"] = ("awaiting DeepStateMap" if c["theatre"] == "ukraine" and occ is not None
                                else "DeepStateMap not loaded yet" if c["theatre"] == "ukraine"
                                else "no open control map for this theatre — the claim is the only line indicator")
        c["opacity"] = {"claimed": 1.0, "confirmed": 0.8, "expired": 0.35, "contradicted": 0.3}[c["status"]]
        when = c["time"][:16].replace("T", " ")
        who = c.get("actor") or c.get("side_name") or "unknown"
        c["label"] = {
            "claimed": f"CLAIMED — unverified, by {who}, {when} UTC",
            "confirmed": f"CONFIRMED — claimed by {who}, {when} UTC",
            "expired": f"EXPIRED claim by {who}, {when} UTC",
            "contradicted": f"CONTRADICTED claim by {who}, {when} UTC",
        }[c["status"]]
        c["official_line"] = THEATRES.get(c["theatre"] or "", {}).get("official_line")
    for c in claims:
        c.pop("_t_last", None)
    return claims


# ── 2. movements ─────────────────────────────────────────────────────────

MOVEMENT_ACTS = ("control_change", "assault", "airstrike", "shelling", "naval")
ARROW_MAX_KM = {"control_change": 25.0, "assault": 25.0, "shelling": 30.0, "airstrike": 60.0, "naval": 60.0,
                "drone": 15.0}
ARROW_MIN_KM = 4.0
FRONT_ADJACENT_KM = 80.0


def _approach_start(ev, theatre, side, lat, lon, prior: list, occ) -> tuple[tuple | None, str]:
    """Where an arrow to (lat, lon) starts, and why."""
    act = ev.get("act")
    max_km = ARROW_MAX_KM.get(act, 25.0)
    # the same actor's previous claim nearby
    for p in sorted(prior, key=lambda c: -c["_t"]):
        if p["side"] == side and p["theatre"] == theatre and p["_t"] < (_parse_time(ev.get("time")) or 0):
            d = haversine_km((p["lat"], p["lon"]), (lat, lon))
            if 3.0 < d <= 60.0:
                return (p["lat"], p["lon"]), f"from the same side's previous claim ({p.get('target_name') or 'nearby'})"
    if theatre == "ukraine" and occ is not None and side in ("red", "blue"):
        try:
            from shapely.geometry import Point
            held = held_ground(occ)
            own, other = held.get(side), held.get("blue" if side == "red" else "red")
            word = "Russian" if side == "red" else "Ukrainian"
            p = Point(lon, lat)
            if own is not None and not own.contains(p):
                q = _nearest_on(own, lat, lon)
                d = haversine_km(q, (lat, lon))
                brg = bearing_deg((lat, lon), q)
                start = q if ARROW_MIN_KM <= d <= max_km else destination((lat, lon), brg, min(max(d, ARROW_MIN_KM), max_km))
                return start, f"from the nearest {word}-held ground (DeepStateMap)"
            if other is not None:
                # already inside its own ground (the map has caught up):
                # approach from the side away from the other side's ground
                q = _nearest_on(other, lat, lon)
                brg = (bearing_deg((lat, lon), q) + 180.0) % 360
                return destination((lat, lon), brg, min(max_km, 10.0)), f"from the {word} side of the line (DeepStateMap)"
        except Exception:                                   # noqa: BLE001
            pass
    rear = REAR_AREAS.get((theatre, side)) or []
    if rear:
        base = min(rear, key=lambda r: haversine_km((r["lat"], r["lon"]), (lat, lon)))
        d = haversine_km((base["lat"], base["lon"]), (lat, lon))
        if d <= max_km:
            return (base["lat"], base["lon"]), f"from {base['name']} (configured rear area)"
        brg = bearing_deg((lat, lon), (base["lat"], base["lon"]))
        return destination((lat, lon), brg, max_km), f"from the direction of {base['name']} (configured rear area)"
    return None, "no approach direction known"


def build_movements(events: list[dict], claims: list[dict], occ=None) -> list[dict]:
    out = []
    for ev in events:
        act = str(ev.get("act") or "")
        try:
            lat, lon = float(ev["lat"]), float(ev["lon"])
        except Exception:                                   # noqa: BLE001
            continue
        theatre, side = theatre_and_side(ev)
        if act == "drone" and ev.get("unit_type") and is_tactical_drone(ev, theatre, occ):
            pass                                            # a named drone unit on the front: its symbol
        elif act not in MOVEMENT_ACTS:
            continue
        if not theatre or side == "unknown":
            continue            # an arrow needs a front and a side to come from
        if act not in ("control_change", "assault") and self_target(ev, theatre, side, occ):
            continue
        if act in ("airstrike", "shelling", "naval") and theatre == "ukraine" and occ is not None:
            try:
                own = held_ground(occ).get(side)
                if own is not None and haversine_km(_nearest_on(own, lat, lon), (lat, lon)) > FRONT_ADJACENT_KM:
                    continue    # a deep strike is a trajectory question, not a troop movement
            except Exception:                               # noqa: BLE001
                pass
        start, basis = _approach_start(ev, theatre, side, lat, lon, claims, occ)
        unit = ev.get("unit_type") or {"airstrike": "air force", "shelling": "artillery", "naval": "naval",
                                       "drone": "drones"}.get(act)
        out.append({
            "id": f"move-{ev.get('id')}",
            "event_id": ev.get("id"),
            "act": act,
            "theatre": theatre,
            "side": side,
            "side_name": THEATRES.get(theatre or "", {}).get(side, {}).get("name") if side in ("blue", "red") else None,
            "colour": SIDE_COLOURS.get(side, SIDE_COLOURS["unknown"]),
            "actor": ev.get("actor"),
            "target_name": ev.get("target_name"),
            "to": {"lat": lat, "lon": lon},
            "from": {"lat": start[0], "lon": start[1]} if start else None,
            "from_basis": basis,
            "unit_type": unit,
            "unit_known": bool(ev.get("unit_type")),
            "unit_label": unit_label(unit),
            "sidc": sidc_for(unit, side, act),
            "time": ev.get("time"),
            "sources": _sources(ev),
            "casualties": ev.get("casualties"),
            "synthetic": bool(ev.get("synthetic")),
            "label": " · ".join(x for x in [
                (ev.get("actor") or ""), act.replace("_", " "),
                unit_label(unit) if ev.get("unit_type") else None,
                f"→ {ev.get('target_name')}" if ev.get("target_name") else None] if x),
        })
    return out


# ── 3. trajectories ──────────────────────────────────────────────────────

TRAJECTORY_ACTS = ("drone", "missile")
# A front-line FPV hit is not a flight from Kursk. These words, or a target
# within TACTICAL_KM of the front with nothing saying "long-range", make a
# drone tactical: no trajectory, and a movement only when its unit is named.
_TACTICAL = re.compile(r"\bfpv\b|bumblebee|quadcopter|mavic|drop(?:ped|s)? (?:a |an )?(?:munition|grenade)|grenade|"
                       r"unmanned systems|uas battalion|drone operators|baba yaga|vampire|lancet|loitering munition", re.I)
_LONG_RANGE = re.compile(r"shahed|geran|long-?range|wave of drones|kamikaze drones?|attack drones?|"
                         r"\d{2,} drones|dozens of drones|samad|qasef|sammad", re.I)
TACTICAL_KM = 25.0


def _blob(ev: dict) -> str:
    return " ".join(str(ev.get(k) or "") for k in ("weapon", "missile_type", "title", "summary", "text", "unit_type"))


def is_tactical_drone(ev: dict, theatre: str | None = None, occ=None) -> bool:
    if ev.get("act") != "drone":
        return False
    b = _blob(ev)
    if _LONG_RANGE.search(b):
        return False
    if _TACTICAL.search(b) or str(ev.get("unit_type") or "") == "drones":
        return True
    if theatre == "ukraine" and occ is not None:
        try:
            q = _nearest_on(occ, float(ev["lat"]), float(ev["lon"]))
            return haversine_km(q, (float(ev["lat"]), float(ev["lon"]))) <= TACTICAL_KM
        except Exception:                                   # noqa: BLE001
            return False
    return False
_BALLISTIC = re.compile(r"ballistic|iskander|kinzhal|kn-?23|fateh|fattah|burkan|zolfaghar|khorramshahr|"
                        r"emad|ghadr|kheibar|palestine-?2|toufan|tochka|s-?300|scud|hwasong", re.I)
_CRUISE = re.compile(r"cruise|kalibr|kh-?101|kh-?555|kh-?55|kh-?59|kh-?22|kh-?32|quds-?\d|paveh|"
                     r"storm shadow|taurus|neptune|soumar|hoveyzeh", re.I)
DRONE_KMH = 180.0           # Shahed-136/Geran-2 cruise, public figures ~150–185 km/h
BALLISTIC_KMH = 6000.0
CRUISE_KMH = 800.0


def missile_kind(ev: dict) -> str:
    """'ballistic', 'cruise', or 'missile' (type not stated)."""
    blob = _blob(ev)
    if _CRUISE.search(blob):
        return "cruise"
    if _BALLISTIC.search(blob):
        return "ballistic"
    return "missile"


def _hint_point(h) -> tuple | None:
    if isinstance(h, dict):
        try:
            return float(h["lat"]), float(h["lon"])
        except Exception:                                   # noqa: BLE001
            return None
    if isinstance(h, (list, tuple)) and len(h) >= 2:
        try:
            return float(h[0]), float(h[1])
        except Exception:                                   # noqa: BLE001
            return None
    return None


def infer_origin(ev: dict, theatre: str | None, side: str, occ=None) -> dict | None:
    """The launch origin of a drone/missile: {lat, lon, name, basis, assumed, source}."""
    try:
        tgt = (float(ev["lat"]), float(ev["lon"]))
    except Exception:                                       # noqa: BLE001
        return None
    hint = ev.get("origin_hint")
    p = _hint_point(hint)
    if p:
        name = hint.get("name") if isinstance(hint, dict) else None
        return {"lat": p[0], "lon": p[1], "name": name or "reported launch point",
                "basis": "origin given in the report", "assumed": False,
                "source": None}
    if isinstance(hint, str) and hint.strip():
        hit = _cached_geocode(hint.strip())
        if hit:
            return {"lat": float(hit["lat"]), "lon": float(hit["lon"]), "name": hint.strip(),
                    "basis": f"origin named in the report ({hint.strip()}), placed by geocoder",
                    "assumed": False, "source": None}
        # a named area the gazetteer doesn't know: try the configured areas by name
        for areas in LAUNCH_AREAS.values():
            for kind in ("drone", "ballistic", "cruise"):
                for a in areas.get(kind) or []:
                    if a["name"].lower().split(",")[0] in hint.lower():
                        return {**{k: a[k] for k in ("lat", "lon", "name", "source")},
                                "basis": f"origin named in the report ({hint.strip()})", "assumed": False}

    akey = actor_key(ev.get("actor"))
    if not akey and theatre == "ukraine":
        akey = "russia" if side == "red" else "ukraine" if side == "blue" else None
    if not akey and theatre == "yemen" and side == "red":
        akey = "houthis"
    if not akey and theatre == "israel" and side == "red":
        akey = "iran"
    cfg = LAUNCH_AREAS.get(akey or "") or {}
    act = ev.get("act")
    kind = "drone" if act == "drone" else ("cruise" if missile_kind(ev) == "cruise" else "ballistic")
    cands = []
    for a in cfg.get(kind) or (cfg.get("ballistic") if kind == "cruise" else []) or []:
        cands.append({"lat": a["lat"], "lon": a["lon"], "name": a["name"], "source": a["source"],
                      "basis": f"assumed origin — nearest known {kind} launch area"})
    front = cfg.get("front")
    if front and theatre == "ukraine" and occ is not None and kind == "drone":
        try:
            from shapely.geometry import Point
            own = held_ground(occ).get(front)
            if own is not None and not own.contains(Point(tgt[1], tgt[0])):
                q = _nearest_on(own, *tgt)
                word = "Russian" if front == "red" else "Ukrainian"
                cands.append({"lat": q[0], "lon": q[1], "name": f"{word}-held ground",
                              "source": "DeepStateMap occupied area + Natural Earth borders",
                              "basis": f"assumed origin — nearest point of {word}-held ground toward the target",
                              "_front": True})
        except Exception:                                   # noqa: BLE001
            pass
    if not cands:
        return None
    # a named launch area is preferred unless the front is clearly nearer
    dist = lambda c: haversine_km((c["lat"], c["lon"]), tgt) * (1.0 if c.get("_front") else 0.8)  # noqa: E731
    best = dict(min(cands, key=dist))
    best.pop("_front", None)
    return {**best, "assumed": True}


def build_trajectories(events: list[dict], occ=None) -> list[dict]:
    out = []
    for ev in events:
        act = str(ev.get("act") or "")
        if act not in TRAJECTORY_ACTS:
            continue
        try:
            lat, lon = float(ev["lat"]), float(ev["lon"])
        except Exception:                                   # noqa: BLE001
            continue
        theatre, side = theatre_and_side(ev)
        if is_tactical_drone(ev, theatre, occ) or self_target(ev, theatre, side, occ):
            continue
        origin = infer_origin(ev, theatre, side, occ)
        if not origin:
            continue            # nothing to draw a line from; the Strikes layer still marks the target
        kind = "drone" if act == "drone" else missile_kind(ev)
        rng = haversine_km((origin["lat"], origin["lon"]), (lat, lon)) if origin else None
        speed = DRONE_KMH if kind == "drone" else CRUISE_KMH if kind == "cruise" else BALLISTIC_KMH
        out.append({
            "id": f"traj-{ev.get('id')}",
            "event_id": ev.get("id"),
            "act": act,
            "kind": kind,
            "kind_label": {"drone": "Drone (Shahed/Geran-class)" if (actor_key(ev.get("actor")) in ("russia", "iran", "houthis"))
                           else "Drone", "ballistic": "Ballistic missile", "cruise": "Cruise missile",
                           "missile": "Missile (type not stated)"}[kind],
            "theatre": theatre,
            "side": side,
            "colour": SIDE_COLOURS.get(side, SIDE_COLOURS["unknown"]),
            "actor": ev.get("actor"),
            "target_name": ev.get("target_name"),
            "to": {"lat": lat, "lon": lon},
            "from": origin,
            "range_km": round(rng, 1) if rng is not None else None,
            "speed_kmh": speed,
            "flight_minutes": round(rng / speed * 60.0, 1) if rng else None,
            "apogee_km": apogee_km(kind, rng) if rng else None,
            "sidc": sidc_for("drones" if kind == "drone" else ("ballistic" if kind == "ballistic" else "missile"), side, act),
            "time": ev.get("time"),
            "sources": _sources(ev),
            "casualties": ev.get("casualties"),
            "synthetic": bool(ev.get("synthetic")),
            "label": " · ".join(x for x in [ev.get("actor"), {"drone": "drones", "ballistic": "ballistic missile",
                                                              "cruise": "cruise missile", "missile": "missile"}[kind],
                                             f"→ {ev.get('target_name')}" if ev.get("target_name") else None] if x),
        })
    return out


def apogee_km(kind: str, range_km: float | None) -> float:
    """How high the drawn arc peaks. Ballistic ≈ range/4 (minimum-energy
    trajectory), capped; cruise a low arc; drones fly flat."""
    r = float(range_km or 0)
    if kind == "ballistic":
        return round(max(20.0, min(600.0, r / 4.0)), 1)
    if kind == "missile":
        return round(max(10.0, min(300.0, r / 6.0)), 1)
    if kind == "cruise":
        return round(max(2.0, min(25.0, r * 0.03)), 1)
    return 1.5


# ── the whole overlay, cached briefly ────────────────────────────────────

_CACHE: dict = {}
_CACHE_TTL = 60


def overlay(hours: int = 168, now: float | None = None) -> dict:
    hours = max(1, min(int(hours or 168), 24 * 30))
    key = f"overlay:{hours}"
    hit = _CACHE.get(key)
    if hit and now is None and time.time() - hit["ts"] < _CACHE_TTL:
        return hit["data"]
    t_now = now or time.time()
    # claims look back up to 30 days whatever the window (they fade, then drop)
    events, status = load_events(t_now - max(hours * 3600, DROP_AFTER_S))
    occ, dis, meta = occupied_now()
    claims = build_claims(events, t_now, occ, dis, meta)
    win = t_now - hours * 3600
    recent = [e for e in events if (_parse_time(e.get("time")) or 0) >= win]
    claims_all = [dict(c) for c in claims]
    movements = build_movements(recent, claims_all, occ)
    trajectories = build_trajectories(recent, occ)
    for c in claims:
        c.pop("_t", None)
    data = {
        "available": True,
        "window_hours": hours,
        "claims": [c for c in claims if (_parse_time(c["time"]) or 0) >= win or c["status"] in ("claimed", "confirmed")],
        "movements": movements,
        "trajectories": trajectories,
        "sides": {k: {"label": t["label"], "blue": t["blue"]["name"], "red": t["red"]["name"],
                      "official_line": t["official_line"]} for k, t in THEATRES.items()},
        "side_colours": SIDE_COLOURS,
        "sides_note": SIDES_NOTE,
        "official_line": meta,
        "events_source": status,
        "synthetic": any(e.get("synthetic") for e in events),
        "notes": {
            "claims": "A claim is what a report says, drawn on top of the official line — never merged into it.",
            "origins": "Launch origins marked 'assumed' are inferred from cited launch areas or the nearest held ground; reports rarely say where a drone left from.",
        },
    }
    if now is None:
        _CACHE[key] = {"ts": time.time(), "data": data}
    return data
