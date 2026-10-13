"""
safe_route.py — the SAFEST way out, not the fastest (owner, 2026-10-12:
"in case of a protest or something we can alert our asset AND display the
SAFEST exit route, not just the fastest but actually the safest").

HAZARDS (hazards_near). What is dangerous near a point right now, each with
a centre, a CORE radius (never routed through), an OUTER radius (avoided,
exposure counts fully inside it and fades to zero at twice it), a weight
(severity × kind × recency, decaying) and the source it came from:
  · Telegram live developments (telegram_events.situations): kettles,
    charges, tear gas, water cannon, clashes, closures …;
  · Telegram announced gatherings starting within the next hours, or
    under way (telegram_events.announcements);
  · public calls to act at a place today (endangered_places, "call active
    today" with a precise position);
  · open alerts in the violence / unrest / crime categories
    (owned_assets.category on the alert's title), and GeoConfirmed footage.
Radius by kind, scaled by a crowd size when the text gives one ("2 000
manifestants"). Decay: a kettle halves every 45 min and ends when the post
said it would (valid_until); an announcement ramps up over the 3 h before
it starts and decays after its 4th hour.

ROUTING (route_candidates). Valhalla (valhalla1.openstreetmap.de, FOSSGIS)
first: costing pedestrian/auto, the hazards' outer rings as
exclude_polygons. OSRM (routing.openstreetmap.de routed-foot / routed-car,
FOSSGIS) for the unconstrained alternatives and as the fallback. Both are
public servers for LIGHT use: one request per second per host (a
process-wide throttle here), a generic User-Agent naming the project's
public URL (never a person's address), every answer cached, short
timeouts, attribution "© OpenStreetMap contributors · routing FOSSGIS
(Valhalla / OSRM)" shown with every route. All network calls are async
(httpx) — nothing here blocks the event loop.

SAFEST (plan). Several candidate SAFE DESTINATIONS 1–3 km out, in the
directions away from the hazards (and the asset owner's other sites, or a
hospital / police station / station / hotel found by Overpass, when clear of
every ring), a route to each with and without the exclusions, and each
route scored by EXPOSURE: for every ~15 m of route, the time spent there
(walking 1.35 m/s, or the route's own speed) × each hazard's weight × its
proximity (1 inside the outer ring, fading to 0 at twice it), summed, plus a
mild length penalty. A route that enters a hazard CORE is never the safest
(a core the start point is already inside only counts once the route has
left it — "never re-enter"). The fastest route is always returned too, and
the difference is said in words ("avoids Place de la République — kettle
reported 12 min ago — by 650 m; 4 min longer").

API CONTRACT (other planners plug in here — maritime, air, convoy, medevac …)

  Hazard (dict, make_hazard):
    {id, kind, label, lat, lon, polygon?, core_m, radius_m, weight (0..~3, decayed),
     at, age_min, starts_utc?, place, what, crowd?, advice?, source: {label, url},
     provider, distance_m (from the point asked about), hard? (mode: the whole ring is a core)}
    A polygon is held as its centroid and covering circle (exposure is circular).

  Providers — register_provider(name, label, fn(box, inside, now) -> [hazard], description):
    "unrest"            Telegram live developments + announced gatherings
    "endangered_calls"  public calls to gather / act at a place
    "violence"          open alerts (violence, unrest, crime) + GeoConfirmed
    "strikes"           strike pickets
    "roadblocks"        called roadblocks / slow-drive convoys / blockades, road closures, checkpoints
    hazards_near(lat, lon, km, now, providers=None) — all registered, or the named ones.

  Modes — register_mode(name, label, valhalla=costing, osrm=profile, speed_mps, providers,
                        kind_weight={kind: ×}, hard={kinds never crossed}, dest_m=(min, max), maps="walking"|"driving"):
    "foot"   pedestrian / routed-foot
    "car"    auto / routed-car
    "truck"  truck / routed-car — roadblocks and closures are HARD (never crossed), calls and strikes weigh more

  exposure(coords, hazards, speed_mps) -> {exposure, through_core, per_hazard: {id: {exposure, min_m}}}

  await plan(lat, lon, mode, hazards=None, refuges=None, now=None, destinations=None | [{lat, lon, name}],
             depart_at=None, providers=None) ->
    {origin, mode, mode_label, generated_at, depart_at, providers, hazards (as the mode sees them), inside,
     destinations, candidates: [route + {why, role: safest|fastest|alternative}], safest, fastest,
     alternatives, explanation, leave_via, links: {apple, google}, routers, attribution, fix_the_map,
     status: ok | no_safe_route | no_route}
    route = {key, router, mode, distance_m, duration_s, duration_label, coords [[lat, lon]], steps [{text,
             distance_m, street, lat, lon}], dest, exposure, score, through_core, avoided_hazards, leave_via, closest}

  await nearest_reachable(lat, lon, destinations, mode, …) -> {destination, route, plan, tried}
    the least-exposed reachable one of several explicit destinations (safe houses, rally points).

  still_safe(coords, hazards) -> {safe, through_core, inside, exposure}

  HTTP (routers/routes.py): POST /api/routes/plan · GET /api/routes/{id} (re-check) ·
  POST /api/routes/{id}/send · GET /api/routes/context · GET /api/routes/modes · /hazards · /status.
  Saved plans: route_plans.py (table route_plans). Alerts: exit_watch.py.
"""
from __future__ import annotations

import asyncio
import datetime as _dt
import hashlib
import json
import math
import os
import re
import threading
import time

USER_AGENT = "HorizonWatch-SafeRoute/1.0 (+https://github.com/ZaphodBeblerbox/Horizon-Watch)"
VALHALLA_URL = os.getenv("SAFE_ROUTE_VALHALLA", "https://valhalla1.openstreetmap.de/route")
OSRM_URLS = {"foot": os.getenv("SAFE_ROUTE_OSRM_FOOT", "https://routing.openstreetmap.de/routed-foot/route/v1/driving"),
             "car": os.getenv("SAFE_ROUTE_OSRM_CAR", "https://routing.openstreetmap.de/routed-car/route/v1/driving")}
OVERPASS_URLS = [u for u in (os.getenv("SAFE_ROUTE_OVERPASS"), "https://overpass-api.de/api/interpreter",
                               "https://overpass.kumi.systems/api/interpreter") if u]
ATTRIBUTION = "© OpenStreetMap contributors · routing by FOSSGIS (Valhalla, OSRM)"
FIX_THE_MAP = "https://www.openstreetmap.org/fixthemap"
HTTP_TIMEOUT_S = 12.0
MIN_INTERVAL_S = 1.05            # FOSSGIS: one request per second, max
ROUTE_CACHE_TTL_S = 600
PLAN_CACHE_TTL_S = 60
WALK_MPS = 1.35
HAZARD_SEARCH_KM = 5.0
POI_BUDGET_S = 4.0
MAX_DESTINATIONS = 5             # explicit destinations asked in one plan (safe houses, sites)

# ── geometry ────────────────────────────────────────────────────────────────

def metres(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    h = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b_lon - a_lon) / 2) ** 2)
    return 12_742_000.0 * math.asin(min(1.0, math.sqrt(h)))


def bearing(a_lat, a_lon, b_lat, b_lon) -> float:
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dl = math.radians(b_lon - a_lon)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def destination(lat: float, lon: float, brg: float, dist_m: float) -> tuple[float, float]:
    r = 6_371_000.0
    d, b = dist_m / r, math.radians(brg)
    p1, l1 = math.radians(lat), math.radians(lon)
    p2 = math.asin(math.sin(p1) * math.cos(d) + math.cos(p1) * math.sin(d) * math.cos(b))
    l2 = l1 + math.atan2(math.sin(b) * math.sin(d) * math.cos(p1), math.cos(d) - math.sin(p1) * math.sin(p2))
    return math.degrees(p2), (math.degrees(l2) + 540) % 360 - 180


def compass(brg: float) -> str:
    return ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][int(((brg % 360) + 22.5) // 45) % 8]


def decode_polyline(s: str, precision: int = 6) -> list[list[float]]:
    """Valhalla's encoded shape (polyline6) → [[lat, lon], …]."""
    coords, i, lat, lon, f = [], 0, 0, 0, 10 ** precision
    while i < len(s):
        for k in (0, 1):
            shift = result = 0
            while True:
                b = ord(s[i]) - 63
                i += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            d = ~(result >> 1) if result & 1 else result >> 1
            if k == 0:
                lat += d
            else:
                lon += d
        coords.append([lat / f, lon / f])
    return coords


def circle(lat: float, lon: float, r_m: float, n: int = 16) -> list[list[float]]:
    """A closed ring of [lon, lat] (Valhalla's exclude_polygons order)."""
    pts = [destination(lat, lon, 360 * k / n, r_m) for k in range(n)]
    ring = [[round(p[1], 6), round(p[0], 6)] for p in pts]
    return ring + [ring[0]]


def densify(coords: list[list[float]], step_m: float = 15.0) -> list[tuple[float, float, float]]:
    """[(lat, lon, metres this sample stands for)] every ~step_m along the line."""
    out: list[tuple[float, float, float]] = []
    for (a, b) in zip(coords, coords[1:]):
        seg = metres(a[0], a[1], b[0], b[1])
        n = max(1, int(math.ceil(seg / step_m)))
        for k in range(n):
            t = (k + 0.5) / n
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, seg / n))
    return out


def length_m(coords) -> float:
    return sum(metres(a[0], a[1], b[0], b[1]) for a, b in zip(coords, coords[1:]))


# ── hazards ─────────────────────────────────────────────────────────────────

# kind → (core m, outer m, base weight, label)
KINDS = {
    "kettle":         (150, 350, 1.0, "kettle"),
    "clashes":        (200, 450, 1.0, "clashes"),
    "charge":         (150, 350, 0.9, "police charge"),
    "tear_gas":       (200, 550, 0.9, "tear gas"),
    "water_cannon":   (120, 300, 0.8, "water cannon"),
    "evacuation":     (150, 400, 0.7, "evacuation"),
    "advance":        (300, 700, 0.6, "armed advance"),
    "withdrawal":     (150, 400, 0.4, "withdrawal"),
    "reinforcements": (100, 300, 0.5, "police reinforcements"),
    "checkpoint":     (50, 150, 0.4, "checkpoint"),
    "closure":        (60, 150, 0.3, "road closure"),
    "other":          (100, 300, 0.5, "incident"),
    "gathering":      (150, 400, 0.5, "announced gathering"),
    "march":          (200, 500, 0.6, "announced march"),
    "call":           (120, 300, 0.4, "called action"),
    "unrest":         (150, 400, 0.6, "unrest reported"),
    "kinetic":        (300, 700, 1.0, "violence reported"),
    "crime":          (80, 200, 0.4, "crime reported"),
    "roadblock":      (100, 250, 0.6, "roadblock or convoy called"),
    "strike":         (80, 200, 0.35, "strike picket"),
    "verified":       (200, 500, 0.5, "verified footage of violence"),
}
CALL_WEIGHT = {"high": 0.5, "medium": 0.35, "low": 0.15}
SEV_MULT = {"critical": 1.0, "high": 0.8, "significant": 0.8, "medium": 0.6, "moderate": 0.6, "low": 0.35}
MIN_WEIGHT = 0.05

_CROWD = re.compile(r"(\d{1,3}(?:[\s., ]\d{3})+|\d{2,6})\s*(?:personnes|people|manifestants|protesters|participants|"
                    r"demonstrators|marcheurs|gilets jaunes|students|étudiants|lycéens)", re.I)
_CROWD_WORDS = [(re.compile(r"\b(dizaines de milliers|tens of thousands)\b", re.I), 20000),
                (re.compile(r"\b(milliers|thousands)\b", re.I), 3000),
                (re.compile(r"\b(centaines|hundreds)\b", re.I), 300)]


def crowd_size(text: str | None) -> int | None:
    t = str(text or "")
    m = _CROWD.search(t)
    if m:
        try:
            return int(re.sub(r"[\s., ]", "", m.group(1)))
        except ValueError:
            pass
    for rx, n in _CROWD_WORDS:
        if rx.search(t):
            return n
    return None


def crowd_scale(n: int | None) -> float:
    return 1.0 if not n else max(0.75, min(3.0, math.sqrt(n / 500.0)))


def _utc(v) -> _dt.datetime | None:
    if v in (None, ""):
        return None
    try:
        t = _dt.datetime.fromisoformat(str(v).replace("Z", "+00:00").replace(" ", "T"))
    except ValueError:
        try:
            t = _dt.datetime.fromisoformat(str(v)[:10])
        except ValueError:
            return None
    return t if t.tzinfo else t.replace(tzinfo=_dt.timezone.utc)


def ago(minutes: float) -> str:
    m = max(0, round(minutes))
    if m < 1:
        return "just now"
    if m < 60:
        return f"{m} min ago"
    h = m / 60
    return f"{round(h)} h ago" if h < 48 else f"{round(h / 24)} days ago"


def situation_decay(age_min: float, valid_left_min: float | None) -> float:
    """A live development: half weight every 45 min; nothing once the post's
    own validity (valid_until) has passed."""
    if valid_left_min is not None and valid_left_min <= 0:
        return 0.0
    return 0.5 ** (max(0.0, age_min) / 45.0)


def announcement_decay(to_start_min: float) -> float:
    """An announced gathering: 0 more than 3 h before, rising to full at the
    start, full for 4 h, then halving every hour."""
    if to_start_min > 180:
        return 0.0
    if to_start_min > 0:
        return 0.3 + 0.7 * (1 - to_start_min / 180)
    since = -to_start_min
    if since <= 240:
        return 1.0
    return 0.5 ** ((since - 240) / 60)


def alert_decay(age_min: float) -> float:
    return 0.0 if age_min > 12 * 60 else 0.5 ** (max(0.0, age_min) / 120)


def make_hazard(*, hid: str, kind: str, lat: float, lon: float, weight: float, at: str | None, place: str | None,
                what: str, source: str, url: str | None = None, crowd: int | None = None, age_min: float | None = None,
                starts_utc: str | None = None, advice: str | None = None, polygon: list | None = None,
                radius_m: float | None = None) -> dict:
    """A hazard. A POLYGON ([[lat, lon], …], an area such as a cordon or a
    march's route) is held as its centroid and the circle that covers it —
    exposure and exclusions are circular; the polygon is kept for drawing."""
    core, outer, _base, label = KINDS.get(kind, KINDS["other"])
    s = crowd_scale(crowd)
    if polygon:
        lat = sum(p[0] for p in polygon) / len(polygon)
        lon = sum(p[1] for p in polygon) / len(polygon)
        cover = max(metres(lat, lon, p[0], p[1]) for p in polygon)
        outer, core, s = max(outer, cover + 50), max(core, cover * 0.8), 1.0
    if radius_m:
        outer, core, s = float(radius_m), min(core, float(radius_m) * 0.5), 1.0
    return {"id": hid, "kind": kind, "label": label, "lat": float(lat), "lon": float(lon), "polygon": polygon,
            "core_m": round(core * s), "radius_m": round(outer * s), "weight": round(weight, 3),
            "at": at, "age_min": None if age_min is None else round(age_min, 1), "starts_utc": starts_utc,
            "place": place or "", "what": what, "crowd": crowd, "advice": advice,
            "source": {"label": source, "url": url}}


def from_situation(s: dict, now: _dt.datetime) -> dict | None:
    kind = s.get("kind") if s.get("kind") in KINDS else "other"
    posted = _utc(s.get("posted_at"))
    if not posted or s.get("lat") is None:
        return None
    age = (now - posted).total_seconds() / 60
    vu = _utc(s.get("valid_until"))
    w = KINDS[kind][2] * situation_decay(age, (vu - now).total_seconds() / 60 if vu else None)
    if w < MIN_WEIGHT:
        return None
    text = f"{s.get('happening') or ''} {s.get('text') or ''}"
    return make_hazard(hid=s.get("id") or f"tgs-{s.get('channel')}-{s.get('msg_id')}", kind=kind, lat=s["lat"], lon=s["lon"],
                       weight=w, at=s.get("posted_at"), place=s.get("place"), what=s.get("happening") or KINDS[kind][3],
                       source=f"Telegram · {s.get('channel_title') or s.get('channel')}", url=s.get("url"),
                       crowd=crowd_size(text), age_min=age, advice=s.get("advice"))


def from_announcement(a: dict, now: _dt.datetime) -> dict | None:
    if a.get("lat") is None:
        return None
    start = _utc(a.get("starts_utc"))
    if not start:
        return None                          # no hour: a reminder, not a hazard at a known time
    to_start = (start - now).total_seconds() / 60
    w0 = announcement_decay(to_start)
    what = (a.get("what") or "gathering").strip()
    kind = "march" if re.search(r"march|marche|manif|cortège|procession|demonstration", what, re.I) else "gathering"
    w = KINDS[kind][2] * w0
    if w < MIN_WEIGHT:
        return None
    posted = _utc(a.get("posted_at"))
    return make_hazard(hid=a.get("id") or f"tga-{a.get('channel')}-{a.get('msg_id')}", kind=kind, lat=a["lat"], lon=a["lon"],
                       weight=w, at=a.get("posted_at"), place=a.get("place"),
                       what=f"{what[:1].upper()}{what[1:]} — {a.get('when_label') or a.get('starts_at')}",
                       source=f"Telegram · {a.get('channel_title') or a.get('channel')} (announced)", url=a.get("url"),
                       crowd=crowd_size(f"{a.get('what') or ''} {a.get('text') or ''}"),
                       age_min=(now - posted).total_seconds() / 60 if posted else None, starts_utc=a.get("starts_utc"),
                       advice=a.get("advice"))


ROADBLOCK_CALLS = {"barrage_filtrant", "operation_escargot", "blocage", "rond_point"}


def call_hazard_kind(call_kind: str | None) -> str:
    """An endangered-place call → the hazard it is for a route: a roadblock or
    slow-drive convoy (vehicles, trucks above all), a strike picket, or a
    gathering of people."""
    k = str(call_kind or "")
    if k in ROADBLOCK_CALLS:
        return "roadblock"
    if k == "piquet_de_greve" or k.startswith("strike"):
        return "strike"
    return "call"


def from_place(p: dict, now: _dt.datetime) -> dict | None:
    """An endangered place with a call on `now`'s day, at a precise position:
    its heaviest call, as a roadblock, a strike picket or a called gathering."""
    if p.get("status") not in ("call active today", "upcoming") or p.get("approx") or p.get("lat") is None:
        return None
    if p.get("model_type") == "city":
        return None
    import endangered_places as ep
    best = None
    today = now.astimezone(ep._zone()).date().isoformat()
    for c in p.get("calls") or []:
        if not ep.covers(c, today):
            continue
        start = ep.call_start(c)
        w = CALL_WEIGHT.get(c.get("level"), 0.3)
        if c.get("time") and start:
            w *= announcement_decay((start - now).total_seconds() / 60) if start > now else 1.0
        else:
            w *= 0.7
        if best is None or w > best[0]:
            best = (w, c)
    if not best or best[0] < MIN_WEIGHT:
        return None
    w, c = best
    return make_hazard(hid=f"ep:{p['id']}", kind=call_hazard_kind(c.get("kind")), lat=p["lat"], lon=p["lon"], weight=w,
                       at=p.get("next_at"), place=p.get("name") or p.get("city"),
                       what=c.get("line") or c.get("label_en") or "called action",
                       source=p.get("source") or "public call map", url=c.get("source_url") or p.get("source_url"))


def from_alert(r: dict, now: _dt.datetime) -> dict | None:
    import owned_assets as oa
    cat = oa.category({"kind": r.get("alert_type") or "", "title": r.get("title") or ""})
    if cat not in ("unrest", "kinetic", "crime"):
        return None
    t = _utc(r.get("created_at"))
    if not t or r.get("lat") is None:
        return None
    age = (now - t).total_seconds() / 60
    w = KINDS[cat][2] * SEV_MULT.get(str(r.get("severity") or "").lower(), 0.5) * alert_decay(age)
    if w < MIN_WEIGHT:
        return None
    return make_hazard(hid=f"alert:{r.get('alert_id')}", kind=cat, lat=r["lat"], lon=r["lon"], weight=w, at=r.get("created_at"),
                       place=r.get("region"), what=r.get("title") or KINDS[cat][3],
                       source=f"{r.get('source') or 'alert'} ({r.get('alert_type') or 'alert'})", age_min=age,
                       crowd=crowd_size(r.get("title")))


def from_geoconfirmed(r: dict, now: _dt.datetime) -> dict | None:
    t = _utc(r.get("date"))
    if not t or r.get("latitude") is None:
        return None
    age = (now - t).total_seconds() / 60
    if age > 48 * 60:
        return None
    w = KINDS["verified"][2] * (0.6 if age <= 24 * 60 else 0.3)
    return make_hazard(hid=f"gc:{r.get('id')}", kind="verified", lat=r["latitude"], lon=r["longitude"], weight=w,
                       at=r.get("date"), place=r.get("name"), what=r.get("title") or r.get("name") or "verified footage",
                       source="GeoConfirmed — verified", age_min=age)


def _box(lat, lon, km):
    dlat = km / 111.0
    dlon = km / max(5.0, 111.0 * abs(math.cos(math.radians(lat))))
    return lat - dlat, lat + dlat, lon - dlon, lon + dlon


# ── hazard providers ────────────────────────────────────────────────────────
# Each provider: fn(box, inside, now) -> [hazard]; box = (south, north, west,
# east), inside(lat, lon) -> bool, now = the moment the route is for
# (depart_at). Registered by name; a plan asks for the providers its mode
# uses minus the ones the person switched off (the "avoid" chips).

PROVIDERS: dict[str, dict] = {}


def register_provider(name: str, label: str, fn, description: str = "") -> None:
    PROVIDERS[name] = {"name": name, "label": label, "fn": fn, "description": description}


def _p_unrest(box, inside, now):
    import telegram_events as te
    out = []
    for x in te.situations():
        if inside(x.get("lat"), x.get("lon")) and x.get("kind") not in ("closure", "checkpoint"):
            out.append(from_situation(x, now))
    for x in te.announcements(days_ahead=2):
        if inside(x.get("lat"), x.get("lon")):
            out.append(from_announcement(x, now))
    return out


_place_memo: dict = {}


def _place_hazards(box, inside, now) -> list[dict]:
    """Every endangered place's hazard in the box (read once for the three providers that share them)."""
    key = (tuple(round(v, 3) for v in box), now.replace(second=0, microsecond=0).isoformat())
    hit = _place_memo.get(key)
    if hit and time.time() - hit[0] < 30:
        return hit[1]
    import endangered_places as ep
    out = []
    for p in ep.load_places().get("places") or []:
        if inside(p.get("lat"), p.get("lon")) and p.get("calls"):
            h = from_place(ep.annotate(p, now), now)
            if h:
                out.append(h)
    if len(_place_memo) > 50:
        _place_memo.clear()
    _place_memo[key] = (time.time(), out)
    return out


def _p_calls(box, inside, now):
    return [h for h in _place_hazards(box, inside, now) if h["kind"] == "call"]


def _p_strikes(box, inside, now):
    return [h for h in _place_hazards(box, inside, now) if h["kind"] == "strike"]


def _p_roadblocks(box, inside, now):
    out = [h for h in _place_hazards(box, inside, now) if h["kind"] == "roadblock"]
    import telegram_events as te
    for x in te.situations():
        if inside(x.get("lat"), x.get("lon")) and x.get("kind") in ("closure", "checkpoint"):
            out.append(from_situation(x, now))
    return out


def _p_violence(box, inside, now):
    import sqlite3
    import owned_assets as oa
    s, n, w, e = box
    out = []
    con = sqlite3.connect(oa._db_path(), timeout=10)
    con.row_factory = sqlite3.Row
    try:
        cutoff = (now - _dt.timedelta(hours=12)).strftime("%Y-%m-%d %H:%M:%S")
        try:
            for r in con.execute("SELECT alert_id, title, lat, lon, severity, created_at, source, alert_type, region FROM alerts "
                                 "WHERE status != 'resolved' AND created_at >= ? AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? "
                                 "ORDER BY created_at DESC LIMIT 300", (cutoff, s, n, w, e)):
                out.append(from_alert(dict(r), now))
        except sqlite3.Error:
            pass
        try:
            for r in con.execute("SELECT id, name, latitude, longitude, date, title FROM geoconfirmed_placemarks "
                                 "WHERE date >= ? AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?",
                                 ((now - _dt.timedelta(days=2)).strftime("%Y-%m-%d"), s, n, w, e)):
                out.append(from_geoconfirmed(dict(r), now))
        except sqlite3.Error:
            pass
    finally:
        con.close()
    return out


register_provider("unrest", "Unrest", _p_unrest, "Telegram live developments (kettles, charges, tear gas …) and announced gatherings")
register_provider("endangered_calls", "Called gatherings", _p_calls, "Public calls to gather or act at a place (endangered places)")
register_provider("violence", "Violence", _p_violence, "Open alerts about violence, unrest or crime; GeoConfirmed footage")
register_provider("strikes", "Strikes", _p_strikes, "Strike pickets called at a place")
register_provider("roadblocks", "Roadblocks", _p_roadblocks, "Called roadblocks, slow-drive convoys, blockades; road closures and checkpoints")


def hazards_near(lat: float, lon: float, km: float = HAZARD_SEARCH_KM, now: _dt.datetime | None = None,
                 providers: list[str] | None = None) -> list[dict]:
    """Every live hazard within `km` from the named providers (all by
    default), heaviest first, each tagged with its provider. Blocking
    (SQLite and a JSON file): call it from a thread."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    box = _box(lat, lon, km)
    s, n, w, e = box
    inside = lambda la, lo: la is not None and lo is not None and s <= la <= n and w <= lo <= e  # noqa: E731
    out: list[dict] = []
    for name in (providers if providers is not None else list(PROVIDERS)):
        prov = PROVIDERS.get(name)
        if not prov:
            continue
        try:
            for h in prov["fn"](box, inside, now) or []:
                if h and metres(lat, lon, h["lat"], h["lon"]) <= km * 1000:
                    out.append({**h, "provider": name})
        except Exception as ex:                             # noqa: BLE001
            print(f"[safe-route] error: provider {name}: {type(ex).__name__}: {ex}", flush=True)
    # one hazard per place and kind: the same kettle from three channels
    best: dict = {}
    for h in out:
        k = (h["kind"], round(h["lat"], 3), round(h["lon"], 3))
        if k not in best or h["weight"] > best[k]["weight"]:
            best[k] = h
    for h in best.values():
        h["distance_m"] = round(metres(lat, lon, h["lat"], h["lon"]))
    return sorted(best.values(), key=lambda h: -h["weight"])


# ── exposure ────────────────────────────────────────────────────────────────

def proximity(d_m: float, h: dict) -> float:
    """1 inside the outer ring, fading (squared) to 0 at twice its radius."""
    r = h["radius_m"]
    if d_m <= r:
        return 1.0
    if d_m >= 2 * r:
        return 0.0
    return ((2 * r - d_m) / r) ** 2


def exposure(coords: list[list[float]], hazards: list[dict], speed_mps: float = WALK_MPS) -> dict:
    """How exposed a route is. coords [[lat, lon], …] from the start.
    -> {score, exposure, through_core: [hazard ids], per_hazard: {id: {exposure, min_m}}}"""
    samples = densify(coords) if len(coords) > 1 else [(coords[0][0], coords[0][1], 0.0)] if coords else []
    per = {h["id"]: {"exposure": 0.0, "min_m": float("inf")} for h in hazards}
    start = coords[0] if coords else None
    # a core the route STARTS in counts only once the route has left it
    inside_at_start = {h["id"] for h in hazards if start and metres(start[0], start[1], h["lat"], h["lon"]) < h["core_m"]}
    left = set()
    cores: set = set()
    total = 0.0
    for la, lo, seg in samples:
        minutes = seg / max(0.3, speed_mps) / 60
        for h in hazards:
            d = metres(la, lo, h["lat"], h["lon"])
            p = per[h["id"]]
            if d < p["min_m"]:
                p["min_m"] = d
            if d < h["core_m"]:
                if h["id"] in inside_at_start and h["id"] not in left:
                    pass                             # still on the way out
                else:
                    cores.add(h["id"])
            elif h["id"] in inside_at_start:
                left.add(h["id"])
            x = h["weight"] * proximity(d, h) * minutes
            p["exposure"] += x
            total += x
    for p in per.values():
        p["exposure"] = round(p["exposure"], 4)
        p["min_m"] = None if p["min_m"] == float("inf") else round(p["min_m"])
    return {"exposure": round(total, 4), "through_core": sorted(cores), "per_hazard": per}


LENGTH_PENALTY_PER_MIN = 0.01      # mild: ten extra minutes weigh like a minute beside a kettle at 0.1


def score(route: dict, hazards: list[dict]) -> dict:
    speed = route["distance_m"] / route["duration_s"] if route.get("duration_s") else WALK_MPS
    ex = exposure(route["coords"], hazards, speed)
    route.update(ex)
    route["score"] = round(ex["exposure"] + LENGTH_PENALTY_PER_MIN * route["duration_s"] / 60, 4)
    return route


def pick(routes: list[dict]) -> tuple[dict | None, dict | None]:
    """(safest, fastest). The safest never enters a hazard core."""
    if not routes:
        return None, None
    fastest = min(routes, key=lambda r: r["duration_s"])
    clean = [r for r in routes if not r["through_core"]]
    safest = min(clean, key=lambda r: (r["score"], r["duration_s"])) if clean else None
    return safest, fastest


# ── what the router said, in one shape ──────────────────────────────────────

def _valhalla_route(trip: dict, mode: str, dest: dict) -> dict | None:
    try:
        coords: list = []
        steps = []
        for leg in trip["legs"]:
            shape = decode_polyline(leg["shape"])
            base = len(coords)
            coords += shape
            for m in leg.get("maneuvers") or []:
                bi = m.get("begin_shape_index", 0) + base
                steps.append({"text": m.get("instruction") or "", "distance_m": round((m.get("length") or 0) * 1000),
                              "street": ", ".join(m.get("street_names") or []) or None,
                              "lat": coords[min(bi, len(coords) - 1)][0], "lon": coords[min(bi, len(coords) - 1)][1]})
        return {"coords": coords, "distance_m": round(trip["summary"]["length"] * 1000), "duration_s": round(trip["summary"]["time"]),
                "steps": fold_steps(steps), "router": "valhalla", "mode": mode, "dest": dest}
    except (KeyError, TypeError, ValueError, IndexError):
        return None


_UNNAMED = re.compile(r"\b(the )?(walkway|footway|path|pedestrian crossing|crosswalk|sidewalk|stairs)\b", re.I)


def fold_steps(steps: list[dict]) -> list[dict]:
    """A pedestrian route through a city is dozens of "Turn left onto the
    walkway." — consecutive unnamed steps become one "Continue along the
    footpaths (N m)", so the list reads like directions."""
    out: list[dict] = []
    for st in steps:
        unnamed = not st.get("street") and bool(_UNNAMED.search(st.get("text") or ""))
        if unnamed and out and out[-1].get("_fold"):
            out[-1]["distance_m"] += st.get("distance_m") or 0
            out[-1]["_n"] += 1
            continue
        out.append({**st, "_fold": unnamed, "_n": 1})
    for st in out:
        if st.pop("_fold") and st.pop("_n") > 1:
            st["text"] = "Continue along the footpaths and crossings."
        st.pop("_n", None)
    return out


_TURN = {"turn": "Turn", "new name": "Continue", "depart": "Head", "arrive": "Arrive", "merge": "Merge",
         "on ramp": "Take the ramp", "off ramp": "Take the exit", "fork": "Keep", "end of road": "Turn",
         "continue": "Continue", "roundabout": "At the roundabout, take the exit", "rotary": "At the roundabout, take the exit",
         "roundabout turn": "At the roundabout, turn", "notification": "Continue"}


def osrm_step_text(step: dict) -> str:
    m = step.get("maneuver") or {}
    typ, mod = m.get("type") or "continue", m.get("modifier") or ""
    name = step.get("name") or ""
    if typ == "depart":
        return f"Head {compass(m.get('bearing_after') or 0)}{' on ' + name if name else ''}."
    if typ == "arrive":
        return "You have arrived at the safe point."
    verb = _TURN.get(typ, "Continue")
    if typ in ("turn", "end of road", "fork", "continue", "new name") and mod:
        verb = {"straight": "Continue straight", "uturn": "Make a U-turn"}.get(mod, f"{verb} {mod}" if typ != "continue" or mod != "straight" else verb)
        if typ == "continue" and mod not in ("straight", "uturn"):
            verb = f"Bear {mod}"
    return f"{verb}{' onto ' + name if name else ''}."


def _osrm_route(r: dict, mode: str, dest: dict) -> dict | None:
    try:
        coords = [[c[1], c[0]] for c in r["geometry"]["coordinates"]]
        steps = []
        for leg in r.get("legs") or []:
            for st in leg.get("steps") or []:
                loc = (st.get("maneuver") or {}).get("location") or [None, None]
                steps.append({"text": osrm_step_text(st), "distance_m": round(st.get("distance") or 0),
                              "street": st.get("name") or None, "lat": loc[1], "lon": loc[0]})
        return {"coords": coords, "distance_m": round(r["distance"]), "duration_s": round(r["duration"]),
                "steps": steps, "router": "osrm", "mode": mode, "dest": dest}
    except (KeyError, TypeError, ValueError, IndexError):
        return None


# ── the public routers, politely ────────────────────────────────────────────

_throttle_lock = threading.Lock()
_next_slot: dict[str, float] = {}
_route_cache: dict[str, tuple[float, object]] = {}
_cache_lock = threading.Lock()
SERVICE_LOG: list[dict] = []                 # the last calls, for /api/safe-route/status


def _slot(host: str) -> float:
    """Seconds to wait before this host may be asked again (reserves the slot)."""
    with _throttle_lock:
        now = time.monotonic()
        at = max(now, _next_slot.get(host, 0.0))
        _next_slot[host] = at + MIN_INTERVAL_S
        return at - now


def _cache_get(key: str):
    with _cache_lock:
        v = _route_cache.get(key)
        if v and time.time() - v[0] < ROUTE_CACHE_TTL_S:
            return v[1]
    return None


def _cache_put(key: str, val) -> None:
    with _cache_lock:
        if len(_route_cache) > 500:
            for k, _ in sorted(_route_cache.items(), key=lambda kv: kv[1][0])[:250]:
                _route_cache.pop(k, None)
        _route_cache[key] = (time.time(), val)


def _log(service: str, ok: bool, ms: float, note: str = "") -> None:
    SERVICE_LOG.append({"service": service, "ok": ok, "ms": round(ms), "note": note[:160],
                        "at": _dt.datetime.now(_dt.timezone.utc).isoformat()})
    del SERVICE_LOG[:-40]
    print(f"[safe-route] {service} {'ok' if ok else 'FAILED'} in {ms:.0f} ms{' — ' + note if note else ''}", flush=True)


async def _request(method: str, url: str, host: str, **kw):
    import httpx
    wait = _slot(host)
    if wait > 0:
        await asyncio.sleep(wait)
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_S, headers={"User-Agent": USER_AGENT}) as c:
        r = await c.request(method, url, **kw)
    return r


async def valhalla(origin: tuple, dest: dict, mode: str, exclude: list | None = None, alternates: int = 1) -> list[dict]:
    body = {"locations": [{"lat": origin[0], "lon": origin[1]}, {"lat": dest["lat"], "lon": dest["lon"]}],
            "costing": mode_of(mode)["valhalla"] or "auto", "alternates": alternates,
            "directions_options": {"units": "kilometers", "language": "en-US"}}
    if exclude:
        body["exclude_polygons"] = exclude
    key = "v:" + hashlib.sha1(json.dumps(body, sort_keys=True).encode()).hexdigest()
    hit = _cache_get(key)
    if hit is not None:
        return hit
    t0 = time.monotonic()
    try:
        r = await _request("POST", VALHALLA_URL, "valhalla", json=body)
        d = r.json()
    except Exception as e:                                  # noqa: BLE001
        _log("valhalla", False, (time.monotonic() - t0) * 1000, f"{type(e).__name__}: {e}")
        return []
    if r.status_code != 200 or "trip" not in d:
        _log("valhalla", False, (time.monotonic() - t0) * 1000, f"HTTP {r.status_code}: {str(d.get('error') or d)[:120]}")
        _cache_put(key, [])
        return []
    trips = [d["trip"]] + [a.get("trip") for a in d.get("alternates") or [] if a.get("trip")]
    out = [x for x in (_valhalla_route(t, mode, dest) for t in trips) if x]
    for x in out:
        x["avoided_hazards"] = bool(exclude)
    _log("valhalla", True, (time.monotonic() - t0) * 1000,
         f"{mode} to {dest.get('name')}: {len(out)} route(s){' with ' + str(len(exclude)) + ' exclusions' if exclude else ''}")
    _cache_put(key, out)
    return out


async def osrm(origin: tuple, dest: dict, mode: str) -> list[dict]:
    url = (f"{OSRM_URLS.get(mode_of(mode)['osrm'] or 'car', OSRM_URLS['car'])}/{origin[1]:.6f},{origin[0]:.6f};{dest['lon']:.6f},{dest['lat']:.6f}"
           "?overview=full&geometries=geojson&steps=true&alternatives=true")
    key = "o:" + url
    hit = _cache_get(key)
    if hit is not None:
        return hit
    t0 = time.monotonic()
    try:
        r = await _request("GET", url, "osrm")
        d = r.json()
    except Exception as e:                                  # noqa: BLE001
        _log("osrm", False, (time.monotonic() - t0) * 1000, f"{type(e).__name__}: {e}")
        return []
    if r.status_code != 200 or d.get("code") != "Ok":
        _log("osrm", False, (time.monotonic() - t0) * 1000, f"HTTP {r.status_code} {d.get('code')}")
        _cache_put(key, [])
        return []
    out = [x for x in (_osrm_route(rt, mode, dest) for rt in d.get("routes") or []) if x]
    for x in out:
        x["avoided_hazards"] = False
    _log("osrm", True, (time.monotonic() - t0) * 1000, f"{mode} to {dest.get('name')}: {len(out)} route(s)")
    _cache_put(key, out)
    return out


_POI_TAGS = '["amenity"~"^(hospital|police|townhall|embassy)$"]'
POI_KIND = {"hospital": "hospital", "police": "police station", "townhall": "town hall", "embassy": "embassy",
            "hotel": "hotel", "station": "station"}


async def refuge_pois(lat: float, lon: float, r_m: int = 3000) -> list[dict]:
    """Hospitals, police stations, town halls, embassies, hotels and
    railway stations within r_m (Overpass; cached an hour per ~1 km cell;
    skipped quietly when Overpass is slow or down)."""
    key = f"poi:{round(lat, 2)},{round(lon, 2)}"
    hit = _cache_get(key)
    if hit is not None:
        return hit
    q = (f"[out:json][timeout:8];("
         f"node{_POI_TAGS}(around:{r_m},{lat},{lon});way{_POI_TAGS}(around:{r_m},{lat},{lon});"
         f"node[\"tourism\"=\"hotel\"](around:{r_m},{lat},{lon});"
         f"node[\"railway\"=\"station\"](around:{r_m},{lat},{lon});"
         f");out center 150;")
    import httpx
    els = None
    for url in OVERPASS_URLS[:2]:
        t0 = time.monotonic()
        try:
            wait = _slot("overpass")
            if wait > 0:
                await asyncio.sleep(wait)
            async with httpx.AsyncClient(timeout=6.0, headers={"User-Agent": USER_AGENT}) as c:
                r = await c.post(url, data={"data": q})
            els = r.json().get("elements") or []
            break
        except Exception as e:                              # noqa: BLE001
            _log("overpass", False, (time.monotonic() - t0) * 1000, f"{url.split('/')[2]}: {type(e).__name__}: {e}")
    if els is None:
        _cache_put(key, [])                                 # down: not asked again for ten minutes
        return []
    out = []
    for el in els:
        tags = el.get("tags") or {}
        la = el.get("lat") or (el.get("center") or {}).get("lat")
        lo = el.get("lon") or (el.get("center") or {}).get("lon")
        kind = tags.get("amenity") or ("hotel" if tags.get("tourism") == "hotel" else "station" if tags.get("railway") else None)
        if la is None or kind not in POI_KIND:
            continue
        out.append({"name": tags.get("name") or POI_KIND[kind].capitalize(), "kind": POI_KIND[kind], "lat": la, "lon": lo})
    _log("overpass", True, (time.monotonic() - t0) * 1000, f"{len(out)} refuges")
    _cache_put(key, out)
    return out


# ── where to go ────────────────────────────────────────────────────────────

REFUGE_RANK = {"your site": 0, "police station": 1, "hospital": 2, "embassy": 3, "town hall": 4, "station": 5, "hotel": 6}


def clearance(lat: float, lon: float, hazards: list[dict]) -> float:
    """Metres from this point to the nearest hazard's influence edge (twice its ring)."""
    return min((metres(lat, lon, h["lat"], h["lon"]) - 2 * h["radius_m"] for h in hazards), default=1e9)


def threat_vector(lat: float, lon: float, hazards: list[dict]) -> tuple[float, float]:
    """Sum of unit vectors toward each hazard × weight / distance (km): where the trouble is."""
    x = y = 0.0
    for h in hazards:
        d = max(50.0, metres(lat, lon, h["lat"], h["lon"]))
        b = math.radians(bearing(lat, lon, h["lat"], h["lon"]))
        k = h["weight"] / (d / 1000)
        x += math.sin(b) * k
        y += math.cos(b) * k
    return x, y


def candidate_destinations(lat: float, lon: float, hazards: list[dict], refuges: list[dict] | None = None,
                           mode: str = "foot", max_n: int = 4) -> list[dict]:
    """Up to max_n safe points 1–3 km out (more by car): the best refuges clear of
    every hazard, then open ground in the directions away from the hazards."""
    near = [h for h in hazards if metres(lat, lon, h["lat"], h["lon"]) <= 4000] or hazards
    tx, ty = threat_vector(lat, lon, near)
    has_threat = (tx * tx + ty * ty) > 1e-9
    away = (math.degrees(math.atan2(-tx, -ty)) + 360) % 360 if has_threat else None
    far = max([metres(lat, lon, h["lat"], h["lon"]) + 2 * h["radius_m"] for h in near if
               metres(lat, lon, h["lat"], h["lon"]) < 2 * h["radius_m"] + 300] or [0])
    lo_m, hi_m = mode_of(mode)["dest_m"]
    dist = max(lo_m, min(hi_m, far + 600))

    def off_axis(b):
        return 0 if away is None else abs(((b - away) + 180) % 360 - 180)

    out: list[dict] = []
    for r in sorted(refuges or [], key=lambda r: (REFUGE_RANK.get(r.get("kind"), 9), metres(lat, lon, r["lat"], r["lon"]))):
        d = metres(lat, lon, r["lat"], r["lon"])
        if not (600 <= d <= hi_m + 1000) or clearance(r["lat"], r["lon"], hazards) < 250:
            continue
        b = bearing(lat, lon, r["lat"], r["lon"])
        if off_axis(b) > 100:
            continue                                     # a refuge on the far side of the trouble is no refuge
        out.append({"name": r["name"], "kind": r.get("kind") or "refuge", "lat": r["lat"], "lon": r["lon"],
                    "bearing": round(b), "distance_m": round(d)})
        if len([o for o in out if o["kind"] != "open ground"]) >= 2:
            break
    # open ground: 16 bearings, scored by how far each points from the trouble and how clear it ends up
    opts = []
    for k in range(16):
        b = 22.5 * k
        if off_axis(b) > 115:
            continue                                     # toward the trouble, or nearly
        for dd in (dist, dist * 1.4):
            p = destination(lat, lon, b, dd)
            c = clearance(p[0], p[1], hazards)
            if c < 200:
                continue
            opts.append((off_axis(b) - min(c, 1500) / 100, b, dd, p))
            break
    opts.sort(key=lambda o: o[0])
    for _s, b, dd, p in opts:
        if len(out) >= max_n:
            break
        if any(abs(((b - o["bearing"]) + 180) % 360 - 180) < 50 for o in out):
            continue                                     # spread the candidates
        out.append({"name": f"open ground {round(dd / 100) / 10:g} km {compass(b)}", "kind": "open ground",
                    "lat": round(p[0], 6), "lon": round(p[1], 6), "bearing": round(b), "distance_m": round(dd)})
    return out[:max_n]


# ── the answer ──────────────────────────────────────────────────────────────

EXCLUSION_CLEAR_M = 80   # Valhalla drops every edge an exclusion touches: keep the start's own street out of it


def exclusion_polygons(origin: tuple, dests: list[dict], hazards: list[dict], max_n: int = 12, cores_only: bool = False) -> list:
    """The hazards' outer rings, as Valhalla exclusions. A ring the start or
    a destination is in shrinks to the core; any ring is shrunk to stay
    EXCLUSION_CLEAR_M clear of the start and the destinations (Valhalla
    excludes every edge a polygon touches, so a long street the start is on
    would otherwise vanish — "No path could be found"); one that cannot is
    left out. cores_only: the cores alone (the retry when the rings leave no
    way through)."""
    polys = []
    ends = [origin] + [(d["lat"], d["lon"]) for d in dests]
    for h in sorted(hazards, key=lambda h: -h["weight"]):
        near = min(metres(p[0], p[1], h["lat"], h["lon"]) for p in ends)
        r = h["core_m"] if cores_only else h["radius_m"]
        if near <= r + 30:
            r = h["core_m"]
        r = min(r, near - EXCLUSION_CLEAR_M)
        if r < 40:
            continue
        polys.append(circle(h["lat"], h["lon"], r))
        if len(polys) >= max_n:
            break
    return polys


def leave_via(route: dict | None) -> str | None:
    """The first named street the route takes (beyond the first few metres)."""
    if not route:
        return None
    walked = 0
    for s in route.get("steps") or []:
        st = s.get("street")
        if st and walked + (s.get("distance_m") or 0) >= 40:
            return st.split(",")[0].strip()
        walked += s.get("distance_m") or 0
    return None


def _dur(s: float) -> str:
    m = round(s / 60)
    return f"{m} min" if m < 60 else f"{m // 60} h {m % 60:02d}"


def explain(safest: dict | None, fastest: dict | None, hazards: list[dict]) -> str:
    if not hazards:
        return "No live hazard near this position — the fastest route is shown."
    if not safest:
        h = hazards[0]
        return (f"Every route found passes through the {h['label']} at {h['place'] or 'the hazard'}; "
                f"move {compass((bearing(h['lat'], h['lon'], fastest['coords'][0][0], fastest['coords'][0][1]) if fastest else 0))} "
                f"away from it and ask again.")
    by = {h["id"]: h for h in hazards}
    if fastest is None or fastest is safest or fastest.get("key") == safest.get("key"):
        nearest = min(hazards, key=lambda h: (safest["per_hazard"].get(h["id"], {}).get("min_m") or 1e9))
        mm = safest["per_hazard"].get(nearest["id"], {}).get("min_m")
        return (f"The fastest way out is also the safest: it keeps {mm} m from the {nearest['label']} at "
                f"{nearest['place'] or 'the hazard'}." if mm is not None else "The fastest way out is also the safest.")
    best, gain = None, -1.0
    for hid, fp in fastest["per_hazard"].items():
        sp = safest["per_hazard"].get(hid) or {}
        g = fp["exposure"] - (sp.get("exposure") or 0)
        if hid in fastest["through_core"]:
            g += 1000
        if g > gain:
            best, gain = hid, g
    h = by.get(best) if best else None
    longer = (safest["duration_s"] - fastest["duration_s"])
    tail = f"{_dur(longer)} longer" if longer >= 60 else "about as quick"
    if not h:
        return f"Less time near the trouble; {tail}."
    when = (f"reported {ago(h['age_min'])}" if h.get("age_min") is not None and not h.get("starts_utc")
            else "announced" if h.get("starts_utc") else "reported")
    fm = (fastest["per_hazard"].get(h["id"]) or {}).get("min_m")
    sm = (safest["per_hazard"].get(h["id"]) or {}).get("min_m")
    if h["id"] in fastest["through_core"]:
        why = "the fastest route goes straight through it"
    elif fm is not None and sm is not None and sm > fm:
        why = f"by {round((sm - fm) / 10) * 10:g} m"
    else:
        why = "with less time near it"
    return f"Avoids {h['place'] or 'the hazard'} — {h['label']} {when} — {why}; {tail}."


def _key(route: dict) -> str:
    c = route["coords"]
    pts = [c[int(i * (len(c) - 1) / 6)] for i in range(7)] if c else []
    return hashlib.sha1(json.dumps([[round(p[0], 4), round(p[1], 4)] for p in pts]).encode()).hexdigest()[:12]


def _public(route: dict | None, hazards_by_id: dict) -> dict | None:
    if not route:
        return None
    near = sorted(((hid, p) for hid, p in route["per_hazard"].items() if p["min_m"] is not None),
                  key=lambda x: x[1]["min_m"])[:3]
    return {"key": route["key"], "router": route["router"], "mode": route["mode"],
            "distance_m": route["distance_m"], "duration_s": route["duration_s"],
            "duration_label": _dur(route["duration_s"]),
            "coords": [[round(a, 6), round(b, 6)] for a, b in route["coords"]],
            "steps": route["steps"], "dest": route["dest"], "exposure": route["exposure"], "score": route["score"],
            "through_core": route["through_core"], "avoided_hazards": route.get("avoided_hazards", False),
            "leave_via": leave_via(route),
            "closest": [{"hazard_id": hid, "label": hazards_by_id[hid]["label"], "place": hazards_by_id[hid]["place"],
                         "min_m": p["min_m"]} for hid, p in near if hid in hazards_by_id]}


def map_links(route: dict | None, origin: tuple, travel: str = "walking") -> dict:
    """Apple Maps / Google Maps with the safest route's waypoints, for
    turn-by-turn guidance from the phone's own navigation."""
    if not route or not route.get("coords"):
        return {}
    c = route["coords"]
    dest = c[-1]
    mid = [c[int(len(c) * k / 5)] for k in (1, 2, 3, 4)] if len(c) > 10 else []
    mode_g = travel
    wp = "|".join(f"{p[0]:.6f},{p[1]:.6f}" for p in mid)
    google = (f"https://www.google.com/maps/dir/?api=1&origin={origin[0]:.6f},{origin[1]:.6f}"
              f"&destination={dest[0]:.6f},{dest[1]:.6f}&travelmode={mode_g}" + (f"&waypoints={wp}" if wp else ""))
    # Apple Maps takes one destination per daddr (+to: chains them on recent iOS)
    chain = "+to:".join(f"{p[0]:.6f},{p[1]:.6f}" for p in mid[1::2] + [dest])
    apple = (f"https://maps.apple.com/?saddr={origin[0]:.6f},{origin[1]:.6f}&daddr={chain}"
             f"&dirflg={'w' if travel == 'walking' else 'd'}")
    return {"apple": apple, "google": google}


# ── modes ───────────────────────────────────────────────────────────────────
# A mode says how to ask the routers, how fast it goes, which hazard
# providers matter to it, how much each kind of hazard weighs for it, which
# kinds must never be crossed at all ("hard": the whole ring is a core), and
# how far out its safe points lie. Other planners (maritime, air, convoy,
# medevac …) register their own.

MODES: dict[str, dict] = {}


def register_mode(name: str, label: str, *, valhalla: str | None, osrm: str | None, speed_mps: float,
                  providers: list[str], kind_weight: dict | None = None, hard: set | None = None,
                  dest_m: tuple[int, int] = (1000, 3000), maps: str = "driving") -> None:
    MODES[name] = {"name": name, "label": label, "valhalla": valhalla, "osrm": osrm, "speed_mps": speed_mps,
                   "providers": list(providers), "kind_weight": dict(kind_weight or {}), "hard": set(hard or ()),
                   "dest_m": dest_m, "maps": maps}


ALL_PROVIDERS = ["unrest", "endangered_calls", "violence", "strikes", "roadblocks"]
register_mode("foot", "On foot", valhalla="pedestrian", osrm="foot", speed_mps=WALK_MPS, providers=ALL_PROVIDERS,
              kind_weight={"roadblock": 0.4, "closure": 0.3, "checkpoint": 0.6}, dest_m=(1000, 3000), maps="walking")
register_mode("car", "By car", valhalla="auto", osrm="car", speed_mps=8.0, providers=ALL_PROVIDERS,
              kind_weight={"roadblock": 1.6, "closure": 2.0, "strike": 1.2}, dest_m=(2500, 6000))
# TRUCKS never meet a called roadblock, blockade or slow-drive convoy: the whole ring is a core
register_mode("truck", "Truck", valhalla="truck", osrm="car", speed_mps=7.0, providers=ALL_PROVIDERS,
              kind_weight={"roadblock": 3.0, "closure": 3.0, "strike": 1.6, "call": 1.4}, hard={"roadblock", "closure"},
              dest_m=(3000, 8000))


def mode_of(mode: str | None) -> dict:
    m = str(mode or "foot").lower()
    m = {"auto": "car", "drive": "car", "driving": "car", "walk": "foot", "walking": "foot", "pedestrian": "foot", "hgv": "truck"}.get(m, m)
    return MODES.get(m) or MODES["foot"]


def for_mode(hazards: list[dict], mode: dict) -> list[dict]:
    """The hazards as this mode sees them: weighted by kind, hard kinds all core."""
    out = []
    for h in hazards:
        k = mode["kind_weight"].get(h["kind"], 1.0)
        q = {**h, "weight": round(h["weight"] * k, 3)}
        if h["kind"] in mode["hard"]:
            q["core_m"] = q["radius_m"]
            q["hard"] = True
        out.append(q)
    return out


def why_line(route: dict, fastest: dict | None, hazards: list[dict]) -> str:
    """One line per candidate: what it does about the dangers, against the fastest."""
    if route.get("through_core"):
        h = next((x for x in hazards if x["id"] in route["through_core"]), None)
        return f"Goes through the {h['label']} at {h['place'] or 'the hazard'} — not advised." if h else "Goes through a danger — not advised."
    if fastest is None or route.get("key") == fastest.get("key"):
        near = [(p["min_m"], hid) for hid, p in route["per_hazard"].items() if p["min_m"] is not None]
        if not near:
            return "Fastest; no danger near it."
        mm, hid = min(near)
        h = next((x for x in hazards if x["id"] == hid), None)
        return f"Fastest; closest danger {mm} m away ({h['label']} at {h['place'] or 'the hazard'})." if h else "Fastest."
    return explain(route, fastest, hazards)


_plan_cache: dict[str, tuple[float, dict]] = {}


async def plan(lat: float, lon: float, mode: str = "foot", hazards: list[dict] | None = None,
               refuges: list[dict] | None = None, now: _dt.datetime | None = None, use_pois: bool = True,
               destinations: list[dict] | None = None, depart_at: _dt.datetime | None = None,
               providers: list[str] | None = None, fetch_valhalla=None, fetch_osrm=None, fetch_pois=None) -> dict:
    """Routes from (lat, lon) — to `destinations` ([{lat, lon, name}]), or
    when none are given to automatic safe points away from the dangers —
    scored by exposure for `mode`, at the moment `depart_at` (default now).
    Async; hazards are gathered in a thread when not given. See the module
    docstring for the shape returned."""
    md = mode_of(mode)
    mode = md["name"]
    now = now or _dt.datetime.now(_dt.timezone.utc)
    at = depart_at or now
    provs = [p for p in (providers if providers is not None else md["providers"]) if p in PROVIDERS]
    if hazards is None:
        reach = HAZARD_SEARCH_KM + (max(metres(lat, lon, d["lat"], d["lon"]) for d in destinations) / 1000 if destinations else 0)
        hazards = await asyncio.to_thread(hazards_near, lat, lon, min(reach, 40.0), at, provs)
    fv, fo, fp = fetch_valhalla or valhalla, fetch_osrm or osrm, fetch_pois or refuge_pois
    ck = json.dumps([round(lat, 4), round(lon, 4), mode, sorted((h["id"], round(h["weight"], 1)) for h in hazards),
                     sorted((r["name"], r["lat"]) for r in refuges or []),
                     sorted((round(d["lat"], 4), round(d["lon"], 4)) for d in destinations or [])])
    hit = _plan_cache.get(ck)
    if hit and time.time() - hit[0] < PLAN_CACHE_TTL_S and fetch_valhalla is None:
        return {**hit[1], "cached": True}
    origin = (lat, lon)
    mh = for_mode(hazards, md)
    if destinations:
        dests = [{"name": d.get("name") or "destination", "kind": d.get("kind") or "destination", "lat": float(d["lat"]),
                  "lon": float(d["lon"]), "bearing": round(bearing(lat, lon, float(d["lat"]), float(d["lon"]))),
                  "distance_m": round(metres(lat, lon, float(d["lat"]), float(d["lon"]))),
                  **({"id": d["id"]} if d.get("id") else {})} for d in destinations[:MAX_DESTINATIONS]]
        relevant = mh                                      # the whole way matters, not only around the start
    else:
        relevant = [h for h in mh if metres(lat, lon, h["lat"], h["lon"]) <= 4000]
        pois = []
        if use_pois and relevant:
            try:
                # refuges are a bonus: never more than four seconds of the answer
                pois = await asyncio.wait_for(fp(lat, lon), POI_BUDGET_S)
            except Exception:                              # noqa: BLE001 — a timeout too
                pois = []
        dests = candidate_destinations(lat, lon, relevant, (refuges or []) + pois, mode)
    excl = exclusion_polygons(origin, dests, relevant)
    jobs = []
    for i, d in enumerate(dests):
        if excl:
            jobs.append(fv(origin, d, mode, excl, 1))
        if i < 2 or not excl:
            jobs.append(fo(origin, d, mode))               # the unconstrained ways, the fastest among them
    results = await asyncio.gather(*jobs, return_exceptions=True)
    routes = [r for res in results if isinstance(res, list) for r in res]
    if excl and not any(r.get("avoided_hazards") for r in routes):
        # THE RINGS LEFT NO WAY THROUGH (a truck in a dense centre, a start inside a ring):
        # ask again keeping only the cores out — those are never crossed anyway
        cores = exclusion_polygons(origin, dests, relevant, cores_only=True)
        if cores and cores != excl:
            res = await asyncio.gather(*(fv(origin, d, mode, cores, 1) for d in dests[:3]), return_exceptions=True)
            routes += [r for x in res if isinstance(x, list) for r in x]
    if not routes:
        # OSRM down too, or Valhalla refused every exclusion: plain Valhalla
        res = await asyncio.gather(*(fv(origin, d, mode, None, 1) for d in dests[:2]), return_exceptions=True)
        routes = [r for x in res if isinstance(x, list) for r in x]
    seen = set()
    uniq = []
    for r in routes:
        r["key"] = _key(r)
        if r["key"] in seen:
            continue
        seen.add(r["key"])
        uniq.append(score(r, relevant))
    safest, fastest = pick(uniq)
    by = {h["id"]: h for h in mh}
    ranked = sorted(uniq, key=lambda r: (bool(r["through_core"]), r["score"]))
    candidates = []
    shown = ranked[:5]
    if fastest is not None and fastest not in shown:
        shown.append(fastest)                              # the fastest is always offered, for comparison
    for r in shown:
        c = _public(r, by)
        c["why"] = why_line(r, fastest, relevant)
        c["role"] = "safest" if r is safest else "fastest" if r is fastest else "alternative"
        candidates.append(c)
    out = {
        "origin": {"lat": lat, "lon": lon}, "mode": mode, "mode_label": md["label"], "generated_at": now.isoformat(),
        "depart_at": at.isoformat(), "providers": provs,
        "hazards": mh,
        "inside": [h["id"] for h in relevant if metres(lat, lon, h["lat"], h["lon"]) <= h["radius_m"]],
        "destinations": dests,
        "candidates": candidates,
        "safest": _public(safest, by), "fastest": _public(fastest, by),
        "alternatives": [_public(r, by) for r in ranked if r is not safest and r is not fastest][:3],
        "explanation": explain(safest, fastest, relevant),
        "leave_via": leave_via(safest),
        "links": map_links(safest, origin, md["maps"]),
        "routers": sorted({r["router"] for r in uniq}),
        "attribution": ATTRIBUTION, "fix_the_map": FIX_THE_MAP,
        "status": "ok" if safest else ("no_safe_route" if uniq else "no_route"),
    }
    if not uniq:
        out["explanation"] = ("The routing services did not answer; head "
                              f"{compass(dests[0]['bearing']) if dests else 'away from the trouble'} and try again in a minute.")
    if fetch_valhalla is None:
        _plan_cache[ck] = (time.time(), out)
        if len(_plan_cache) > 200:
            for k in list(_plan_cache)[:100]:
                _plan_cache.pop(k, None)
    return out


async def nearest_reachable(lat: float, lon: float, destinations: list[dict], mode: str = "foot", *,
                            hazards: list[dict] | None = None, now: _dt.datetime | None = None,
                            depart_at: _dt.datetime | None = None, providers: list[str] | None = None,
                            max_n: int = 10, **fetchers) -> dict:
    """THE NEAREST REACHABLE SAFE DESTINATION — for safe houses, rally points,
    multi-hop evacuation: of `destinations` ([{lat, lon, name, id?}]), the
    one whose safest route has the least exposure (never through a core),
    ties to the quicker. The `max_n` nearest in a straight line are tried,
    MAX_DESTINATIONS per plan.
    -> {destination, route, plan, tried: [{destination, score|None, reason}]}
       destination None when none can be reached without crossing a core."""
    pts = sorted(destinations, key=lambda d: metres(lat, lon, float(d["lat"]), float(d["lon"])))[:max_n]
    best, tried, plans = None, [], []
    for i in range(0, len(pts), MAX_DESTINATIONS):
        chunk = pts[i:i + MAX_DESTINATIONS]
        p = await plan(lat, lon, mode, hazards=hazards, now=now, destinations=chunk, depart_at=depart_at,
                       providers=providers, use_pois=False, **fetchers)
        plans.append(p)
        for d in chunk:
            routes = [c for c in p.get("candidates") or []
                      if not c["through_core"] and abs(c["dest"]["lat"] - float(d["lat"])) < 1e-6 and abs(c["dest"]["lon"] - float(d["lon"])) < 1e-6]
            r = min(routes, key=lambda c: (c["score"], c["duration_s"])) if routes else None
            tried.append({"destination": d, "score": r["score"] if r else None,
                          "reason": None if r else "every route found crosses a danger, or none was found"})
            if r and (best is None or (r["score"], r["duration_s"]) < (best[1]["score"], best[1]["duration_s"])):
                best = (d, r, p)
    if not best:
        return {"destination": None, "route": None, "plan": plans[-1] if plans else None, "tried": tried}
    return {"destination": best[0], "route": best[1], "plan": best[2], "tried": tried}


def still_safe(coords: list[list[float]], hazards: list[dict]) -> dict:
    """Re-check a route already given (the phone, every minute): does it
    now enter a core, or pass inside a ring?"""
    ex = exposure(coords, hazards)
    by = {h["id"]: h for h in hazards}
    start = coords[0] if coords else None
    # a ring they are already in is the one they are leaving, not a new danger on the way
    already = {h["id"] for h in hazards if start and metres(start[0], start[1], h["lat"], h["lon"]) <= h["radius_m"]}
    inside = [hid for hid, p in ex["per_hazard"].items()
              if hid not in already and p["min_m"] is not None and p["min_m"] <= by[hid]["radius_m"]]
    return {"safe": not ex["through_core"] and not inside, "through_core": ex["through_core"], "inside": inside,
            "exposure": ex["exposure"]}


# ── a local check's synthetic dangers (never set in production) ─────────────
# SAFE_ROUTE_TEST_HAZARDS=/path/to.json — [{id, kind, lat, lon, weight, place}]:
# a browser check can put a kettle in central Paris in ITS OWN server process
# without writing a fake alert to the shared database (which would notify people).
def _p_test(box, inside, now):
    path = os.getenv("SAFE_ROUTE_TEST_HAZARDS")
    try:
        rows = json.loads(open(path).read()) if path else []
    except (OSError, ValueError):
        return []
    return [make_hazard(hid=r["id"], kind=r.get("kind") or "clashes", lat=r["lat"], lon=r["lon"], weight=float(r.get("weight") or 1.0),
                        at=now.isoformat(), place=r.get("place"), what=r.get("what") or "synthetic hazard (local check)",
                        source="local check", radius_m=r.get("radius_m"))
            for r in rows if inside(r.get("lat"), r.get("lon"))]


if os.getenv("SAFE_ROUTE_TEST_HAZARDS"):
    register_provider("test", "Local check", _p_test, "Synthetic hazards for a local browser check")
