"""
overwatch.py — "generate overwatch zones for <conflict>" and the border sweep.

WHAT "INTERESTING" MEANS HERE (owner, 2026-10-10/11). An overwatch zone is
a place where a change visible from orbit would tell you what a side does
next. Not "a place in the war" — a place where the next picture can differ
from the last one in a way that means something:

  Air bases            aircraft arriving, dispersing or leaving precede
                       strike waves; within reach of the front/border
                       (≤ 600 km; the larger fields ≤ 1,200 km).
  Naval & ports        ships in or out of a fleet port or a major port in
                       the theatre.
  Strike targets       large power plants (nuclear always), oil terminals
                       and refineries — damage confirms a strike, repair
                       says how long it lasts. Slower cadence (72 h).
  Front hotspots       territory that changed hands in the last 14 days
                       (DeepStateMap, Ukraine only), one zone per cluster.
  Hot right now        where our own reports cluster in the last 30 days
                       (GeoConfirmed equipment/orbat/conflict/air, imagery
                       signals, corroborated findings, fusion events).
  Ground bases &       named military sites from OpenStreetMap within
  training grounds     ~150 km of a border or the front, on either side —
                       a vehicle park filling or emptying precedes a move.
  Border sweep         the places nobody has mapped (owner's sweep idea,
                       2026-10-11): makeshift bases, field hospitals and
                       build-ups cannot be looked up, so they are found by
                       SWEEPING the staging band beside a border, tile by
                       tile. See the sweep section below.

SCORING (0-100, all three parts stored with the zone):
  proximity   40 × (1 − distance to the front/border ÷ reach). For a
              conflict with no mapped contact line (one country, or two
              that share no border) the distance is to the conflict's
              centre and the reach its radius.
  signals     35 × log-scaled weight of our own signals within 25 km in
              the last 30 days (saturates around 25 weighted reports).
  visibility  0-25 by what can actually be seen at 10 m: a nuclear plant
              or a large port 25, a medium air base 22, a small airstrip
              14, an unmeasured OSM site 12.

PROPOSALS, NEVER SCANS. Everything generated here is inserted as
status="proposed", enabled=False — the scheduler and every other imagery
loop only touch enabled zones — and the user confirms (accept all / a
subgroup / one) before a single Sentinel request is spent. At most
MAX_PROPOSALS per generation; the remainder is reported per subgroup as
"more available". Re-running generation updates the proposals it made
before (matched by source key, or by ≥ 50 % overlap / ≤ 3 km), never
duplicates them, and never re-offers a declined one.

NAMES RESOLVE FROM DATA ONLY. Every named place comes from a register
(OurAirports, the World Port Index, the Global Power Plant Database,
OpenStreetMap, our curated key_facilities.json) — coordinates are never
guessed.

This module is pure where it can be (geometry, scoring, selection, sweep
evaluation — unit-tested in test_overwatch.py); the loaders and the DB
writers are kept at the bottom and take their session/fetcher as
arguments.
"""
from __future__ import annotations

import csv
import datetime as _dt
import json
import math
import os
import re
import threading
import time

# ── tunables ─────────────────────────────────────────────────────────────

MAX_PROPOSALS = int(os.getenv("OVERWATCH_MAX_PROPOSALS", "40"))
DIVERSITY_PENALTY = 4.0       # points per place already chosen from the same subgroup
MIN_PER_SUBGROUP = 3          # every subgroup with candidates gets a voice before the score race
DEDUPE_KM = 3.0
DEDUPE_OVERLAP = 0.5
SIGNAL_RADIUS_KM = 25.0
SIGNAL_DAYS = 30
FRONT_DAYS = 14
REACH_KM = 600.0              # small fields, ports, plants: within reach of the contact line
REACH_BIG_KM = 1200.0         # medium/large air bases and nuclear plants reach further
GROUND_BASE_KM = 150.0        # OSM military sites within this of a border or the front
BIG_PLANT_MW = 1000.0
OSM_REFRESH_DAYS = 7

GROUP_ORDER = ("Air bases", "Naval & ports", "Strike targets", "Ground bases & training grounds",
               "Front hotspots", "Hot right now", "Border sweep")
FOUND_BY_SWEEP = "Found by sweep"
SWEEP_IN_PROGRESS = "Sweep in progress"
DYNAMIC_SUBGROUPS = ("Front hotspots", "Hot right now")   # re-derived each run; stale ones are pruned

# Owner decision 2026-10-11: 24 h for force build-up and border zones,
# 72 h for strike targets (damage does not change by the hour).
CADENCE_H = {"Strike targets": 72}
DEFAULT_CADENCE_H = 24

# Zone footprint per subgroup, km a side. Sites 4-8 km (a runway is 2.5-
# 3.5 km, a port basin or a plant a few km); sweep tiles 20 km.
BOX_KM = {"Air bases": 6.0, "Naval & ports": 6.0, "Strike targets": 4.0,
          "Ground bases & training grounds": 5.0, "Front hotspots": 8.0, "Hot right now": 6.0}

# What a scan looks for there — the kind imagery_signals.py judges a pass by.
AOI = {  # subgroup -> (aoi_class, metadata.kind)
    "Air bases": ("airport", "airbase"),
    "Naval & ports": ("port", "naval_base"),
    "Strike targets": ("energy", "energy_site"),
    "Ground bases & training grounds": ("military", "other"),
    "Front hotspots": ("border", "other"),
    "Hot right now": ("border", "other"),
}

# What each subgroup is scanned FOR (2026-10-11). The zones were created
# with ml_tasks=[] and the owner saw "we detect nothing": the optical
# detectors find ships, aircraft and vehicles, which at 10 m a front line,
# a power plant or a report cluster rarely shows. What those places show is
# CHANGE — a hard scatterer appearing or going between radar passes — so
# every overwatch site gets "radar_change" (main._change_detect_pass, PWTT
# on Sentinel-1), plus the object tasks where objects are the point.
TASKS = {
    "Air bases": ["object_detection", "radar_change"],
    "Naval & ports": ["ship_detection", "vessel_cluster_detection", "object_detection", "radar_change"],
    "Strike targets": ["object_detection", "radar_change"],
    "Ground bases & training grounds": ["object_detection", "radar_change"],
    "Front hotspots": ["radar_change", "object_detection"],
    "Hot right now": ["radar_change", "object_detection"],
    FOUND_BY_SWEEP: ["radar_change", "object_detection"],
}


def tasks_for(subgroup: str | None) -> list[str]:
    """The ml_tasks an overwatch zone of this subgroup is created with. The
    sweep plan and its temporary tiles are never scanned as zones: none."""
    if subgroup in ("Border sweep", SWEEP_IN_PROGRESS):
        return []
    return list(TASKS.get(subgroup or "", ["object_detection", "radar_change"]))


def backfill_tasks(db) -> list[str]:
    """One-off repair: overwatch zones created before TASKS existed have
    ml_tasks=[] — give them their subgroup's tasks. Touches ONLY zones with
    zone_metadata.generated_by == "overwatch" and empty ml_tasks, and never
    the sweep plan or a sweep tile. Returns the system ids changed."""
    from database import WatchZone
    changed = []
    for z in db.query(WatchZone).all():
        m = _meta(z)
        if m.get("generated_by") != "overwatch" or z.aoi_class in ("sweep_plan", "sweep"):
            continue
        try:
            cur = json.loads(z.ml_tasks) if z.ml_tasks else []
        except ValueError:
            cur = []
        if cur:
            continue
        tasks = tasks_for(m.get("subgroup"))
        if not tasks:
            continue
        z.ml_tasks = json.dumps(tasks)
        changed.append(z.system_id)
    if changed:
        db.commit()
    return changed


WHY = {   # the half-sentence that says what a change there would mean
    "Air bases": "aircraft arriving or dispersing precede strike waves",
    "Naval & ports": "ships entering or leaving show fleet and supply moves",
    "Strike targets": "damage confirms a strike, repair says how long it lasts",
    "Ground bases & training grounds": "vehicle parks filling or emptying precede a move",
    "Front hotspots": "where the line is moving now",
    "Hot right now": "our own reports cluster here",
}

# ── the theatres ─────────────────────────────────────────────────────────
#
# Generic rule for any conflict in seed/conflicts.json: its countries, the
# shared borders between any two of them as contact lines, and both sides
# of each such border as sweep bands. A theatre entry here only ADDS what
# the generic rule cannot know.
#
# Ukraine (owner, 2026-10-11): the opposing/allied staging territory —
# Belarus, Transnistria (Moldova's polygon), Kaliningrad (Russia's borders
# with Lithuania and Poland) and the Narva/Ivangorod Estonia–Russia border
# — and the sweep on the side that would STAGE: Belarus facing Ukraine,
# Russia facing Ukraine north of the front (south of 49.8°N the Russian
# side faces occupied territory, already behind the line), Russia facing
# Estonia and Latvia.
THEATRES = {
    "ukraine": {
        "extra_countries": ["by", "md"],
        "contact_pairs": [("ua", "ru"), ("ua", "by"), ("ua", "md"), ("ru", "ee"), ("ru", "lv"),
                          ("ru", "lt"), ("ru", "pl")],
        "sweep_bands": [
            {"stager": "by", "facing": "ua"},
            {"stager": "ru", "facing": "ua", "min_lat": 49.8},
            {"stager": "ru", "facing": "ee"},
            {"stager": "ru", "facing": "lv"},
        ],
        "front": "deepstate",
        "geoconfirmed_slug": "ukraine",
    },
}

ALIASES = {   # spoken / written names -> conflict id (plus each conflict's own id and name)
    "ukraine": ["ukraine war", "russia ukraine", "russia-ukraine", "the war in ukraine", "ukrainian war",
                "russo-ukrainian war", "russia", "donbas", "donbass"],
    "gaza": ["israel hamas", "hamas", "gaza war", "palestine"],
    "lebanon": ["hezbollah", "israel hezbollah"],
    "yemen": ["red sea", "houthis", "houthi"],
    "sudan": ["sudan war", "rsf"],
    "sahel": ["mali", "burkina faso", "niger"],
    "drc": ["congo", "dr congo", "eastern congo", "m23"],
    "somalia": ["al shabaab", "al-shabaab"],
    "ethiopia": ["eritrea", "amhara", "tigray"],
    "myanmar": ["burma"],
    "syria": [],
    "israel_iran": ["iran", "israel iran", "israel-iran"],
    "haiti": [],
    "nigeria": ["boko haram"],
    "mozambique": ["cabo delgado"],
    "libya": [],
    "pakistan": ["afghanistan", "afghan border"],
    "kashmir": ["india pakistan", "india-pakistan"],
    "colombia": [],
    "mexico": ["cartels", "cartel war"],
    "cameroon": ["anglophone crisis"],
    "south_sudan": ["south sudan"],
}

# ── small geometry ───────────────────────────────────────────────────────

KM_PER_DEG = 111.32


def km_between(lat1, lon1, lat2, lon2) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def box(lat: float, lon: float, side_km: float) -> tuple:
    """(min_lon, min_lat, max_lon, max_lat) of a square side_km across."""
    h = side_km / 2.0
    dlat = h / KM_PER_DEG
    dlon = h / (KM_PER_DEG * max(0.05, math.cos(math.radians(lat))))
    return (round(lon - dlon, 6), round(lat - dlat, 6), round(lon + dlon, 6), round(lat + dlat, 6))


def bbox_polygon(b: tuple) -> dict:
    w, s, e, n = b
    return {"type": "Polygon", "coordinates": [[[w, s], [e, s], [e, n], [w, n], [w, s]]]}


def bbox_center(b: tuple) -> tuple:
    return ((b[1] + b[3]) / 2.0, (b[0] + b[2]) / 2.0)


def overlap_fraction(a: tuple, b: tuple) -> float:
    """Intersection over the SMALLER box — a small site inside a big zone
    counts as covered."""
    w, s = max(a[0], b[0]), max(a[1], b[1])
    e, n = min(a[2], b[2]), min(a[3], b[3])
    if e <= w or n <= s:
        return 0.0
    inter = (e - w) * (n - s)
    small = min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]))
    return inter / small if small > 0 else 0.0


def same_place(a: tuple, b: tuple, km: float = DEDUPE_KM, overlap: float = DEDUPE_OVERLAP) -> bool:
    """The dedupe rule: ≥ 50 % overlap, or centres within 3 km."""
    (la, oa), (lb, ob) = bbox_center(a), bbox_center(b)
    return km_between(la, oa, lb, ob) <= km or overlap_fraction(a, b) >= overlap


def _to_km(geom, lat0: float, lon0: float):
    """Local equirectangular km plane around (lat0, lon0) — buffers in km
    without pyproj (not installed). Measured on the Ukraine bands, a tile
    centre lands up to ~15 km past the nominal 150 km (a tile is 20 km
    across anyway) — inside the precision of "20-150 km"."""
    from shapely.ops import transform
    k = KM_PER_DEG * math.cos(math.radians(lat0))
    return transform(lambda x, y, z=None: ((x - lon0) * k, (y - lat0) * KM_PER_DEG), geom)


def _from_km(geom, lat0: float, lon0: float):
    from shapely.ops import transform
    k = KM_PER_DEG * math.cos(math.radians(lat0))
    return transform(lambda x, y, z=None: (x / k + lon0, y / KM_PER_DEG + lat0), geom)


def distance_km(lat: float, lon: float, geom) -> float | None:
    """Great-circle km from a point to the nearest point of a geometry."""
    if geom is None or geom.is_empty:
        return None
    from shapely.geometry import Point
    from shapely.ops import nearest_points
    p = Point(lon, lat)
    q = nearest_points(geom, p)[0]
    return km_between(lat, lon, q.y, q.x)


# ── zone ids ─────────────────────────────────────────────────────────────

_ZONE_NUM = re.compile(r"^ZONE-(\d+)$")


def next_zone_ids(existing_ids, n: int = 1) -> list[str]:
    """n new ZONE-### ids above the highest numeric one in use.

    THE OLD RULE WAS count+1. With ZONE-001..ZONE-004 and ZONE-002
    deleted, the count is 3 and the next id ZONE-004 — which exists, so
    the insert failed on the unique index (or, without one, two zones
    shared an id). max+1 never collides with a live id."""
    hi = 0
    for sid in existing_ids or ():
        m = _ZONE_NUM.match(str(sid or ""))
        if m:
            hi = max(hi, int(m.group(1)))
    return [f"ZONE-{hi + i:03d}" for i in range(1, n + 1)]


# ── conflicts ────────────────────────────────────────────────────────────

def load_conflicts() -> list[dict]:
    try:
        import conflict_context
        return list((conflict_context.baseline() or {}).get("conflicts") or [])
    except Exception:                                      # noqa: BLE001
        here = os.path.join(os.path.dirname(__file__), "seed", "conflicts.json")
        with open(here, encoding="utf-8") as fh:
            return list(json.load(fh).get("conflicts") or [])


def _norm(s: str) -> str:
    s = str(s or "").lower().replace("–", " ").replace("-", " ").replace("_", " ")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"\b(the|war|conflict|in|for|of|zones?|overwatch)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def resolve_conflict(text: str, conflicts: list[dict] | None = None) -> dict | None:
    """A conflict from its id, its name or a spoken alias ("Ukraine war",
    "the war in Ukraine", "russia-ukraine"). None when nothing matches —
    the caller says so rather than guessing."""
    conflicts = conflicts if conflicts is not None else load_conflicts()
    want = _norm(text)
    if not want:
        return None
    by_id = {c["id"]: c for c in conflicts if c.get("id")}
    raw = str(text or "").strip().lower()
    if raw in by_id:
        return by_id[raw]
    for cid, c in by_id.items():
        names = [cid, c.get("name") or ""] + ALIASES.get(cid, [])
        if any(_norm(n) == want for n in names if n):
            return c
    # A longer sentence that CONTAINS one name ("overwatch for the ukraine war please").
    hits = []
    for cid, c in by_id.items():
        for n in [cid, c.get("name") or ""] + ALIASES.get(cid, []):
            nn = _norm(n)
            if nn and re.search(rf"(^| ){re.escape(nn)}( |$)", want):
                hits.append((len(nn), cid))
    if hits:
        hits.sort(reverse=True)
        return by_id[hits[0][1]]
    return None


# ── countries and contact lines ──────────────────────────────────────────

_COUNTRY_LOCK = threading.Lock()
_COUNTRIES: dict | None = None
_COUNTRY_NAMES: dict = {}


def country_shapes() -> dict:
    """{iso2 lower: shapely geometry} from backend/geo/countries.geojson."""
    global _COUNTRIES
    with _COUNTRY_LOCK:
        if _COUNTRIES is None:
            from shapely.geometry import shape
            out = {}
            path = os.path.join(os.path.dirname(__file__), "geo", "countries.geojson")
            with open(path, encoding="utf-8") as fh:
                for f in json.load(fh).get("features", []):
                    p = f.get("properties") or {}
                    iso = str(p.get("ISO3166-1-Alpha-2") or "").lower()
                    if not iso or iso == "-99":
                        continue
                    try:
                        g = shape(f["geometry"])
                        if not g.is_valid:
                            g = g.buffer(0)
                        out[iso] = g
                        _COUNTRY_NAMES[iso] = p.get("name") or iso.upper()
                    except Exception:                      # noqa: BLE001
                        continue
            _COUNTRIES = out
    return _COUNTRIES


def country_name(iso2: str) -> str:
    country_shapes()
    return _COUNTRY_NAMES.get(str(iso2 or "").lower(), str(iso2 or "").upper())


def shared_border(a: str, b: str, shapes: dict | None = None):
    """The line two countries share (Natural Earth polygons do not meet
    exactly, so b is grown by ~3 km before cutting a's outline)."""
    shapes = shapes or country_shapes()
    ga, gb = shapes.get(a), shapes.get(b)
    if ga is None or gb is None:
        return None
    line = ga.boundary.intersection(gb.buffer(0.03))
    if line.is_empty or line.length < 0.05:      # < ~5 km is a tripoint, not a border
        return None
    return line.simplify(0.005)


def theatre_for(conflict: dict) -> dict:
    """The conflict's countries, contact pairs and sweep bands — the
    generic rule plus whatever THEATRES adds for this conflict."""
    cid = conflict.get("id")
    t = dict(THEATRES.get(cid) or {})
    base = [c.lower() for c in conflict.get("countries") or []]
    countries = list(dict.fromkeys(base + [c.lower() for c in t.get("extra_countries", [])]))
    pairs = t.get("contact_pairs")
    if pairs is None:
        pairs = [(a, b) for i, a in enumerate(base) for b in base[i + 1:]]
    bands = t.get("sweep_bands")
    if bands is None:
        bands = [{"stager": a, "facing": b} for a, b in pairs] + [{"stager": b, "facing": a} for a, b in pairs]
    return {"id": cid, "countries": countries, "contact_pairs": pairs, "sweep_bands": bands,
            "front": t.get("front"), "geoconfirmed_slug": t.get("geoconfirmed_slug")}


def contact_components(theatre: dict, front_line=None, shapes: dict | None = None) -> list[tuple]:
    """[(label, line geometry)] — the front first, then each shared border
    that exists. Empty for a conflict with no mapped contact line."""
    shapes = shapes or country_shapes()
    out = []
    if front_line is not None and not front_line.is_empty:
        out.append(("the front line", front_line))
    for a, b in theatre["contact_pairs"]:
        line = shared_border(a, b, shapes)
        if line is not None:
            out.append((f"the {country_name(a)}–{country_name(b)} border", line))
    return out


def front_line_from_polygons(features: list, ua_shape=None):
    """The front: the outline of occupied territory, minus the stretches
    that are really the international border or the coast (both lie on
    Ukraine's own outline, so cutting to its interior removes them)."""
    from shapely.geometry import shape
    from shapely.ops import unary_union
    polys = []
    for f in features or []:
        if ((f.get("properties") or {}).get("status")) != "occupied":
            continue
        try:
            g = shape(f["geometry"])
            if g.is_valid and not g.is_empty:
                polys.append(g)
        except Exception:                                  # noqa: BLE001
            continue
    if not polys:
        return None
    occ = unary_union(polys)
    line = occ.boundary
    if ua_shape is not None:
        line = line.intersection(ua_shape.buffer(-0.04))
    return None if line.is_empty else line.simplify(0.005)


def nearest_contact(lat: float, lon: float, components: list[tuple]) -> tuple:
    """(km, label) to the nearest contact line, or (None, None)."""
    best = (None, None)
    for label, geom in components:
        d = distance_km(lat, lon, geom)
        if d is not None and (best[0] is None or d < best[0]):
            best = (d, label)
    return best


# ── own signals ──────────────────────────────────────────────────────────

class SignalIndex:
    """Weighted points on a 0.25° grid, for "how much have we seen near
    here" without a scan of every signal per candidate."""
    CELL = 0.25

    def __init__(self, signals: list[dict]):
        self.cells: dict = {}
        self.n = 0
        for s in signals or []:
            try:
                lat, lon = float(s["lat"]), float(s["lon"])
            except (KeyError, TypeError, ValueError):
                continue
            key = (int(math.floor(lat / self.CELL)), int(math.floor(lon / self.CELL)))
            self.cells.setdefault(key, []).append({**s, "lat": lat, "lon": lon})
            self.n += 1

    def near(self, lat: float, lon: float, km: float = SIGNAL_RADIUS_KM) -> list[dict]:
        r = int(math.ceil(km / (KM_PER_DEG * self.CELL * max(0.2, math.cos(math.radians(lat)))))) + 1
        ci, cj = int(math.floor(lat / self.CELL)), int(math.floor(lon / self.CELL))
        out = []
        for i in range(ci - r, ci + r + 1):
            for j in range(cj - r, cj + r + 1):
                for s in self.cells.get((i, j), ()):
                    if km_between(lat, lon, s["lat"], s["lon"]) <= km:
                        out.append(s)
        return out

    def weight_near(self, lat: float, lon: float, km: float = SIGNAL_RADIUS_KM) -> tuple:
        hits = self.near(lat, lon, km)
        return round(sum(float(s.get("weight") or 1.0) for s in hits), 2), len(hits)

    def all(self):
        for v in self.cells.values():
            yield from v


# What one report of each kind is worth when deciding where to look.
# Footage of equipment or a unit is the strongest own evidence of force
# presence; a news surge is located only to a city.
SIGNAL_WEIGHTS = {
    "gc:equipment": 3.0, "gc:orbat": 3.0, "gc:air": 2.0, "gc:conflict": 1.0,
    "gc:infrastructure": 1.0, "gc:maritime": 1.5,
    "alert:SAT-TASK": 2.0, "alert:CORROBORATED": 2.0, "alert:FIRMS": 1.0, "alert:surge": 0.5,
    "fusion": 1.5,
}


# ── scoring ──────────────────────────────────────────────────────────────

def score(d_km: float | None, reach_km: float, sig_weight: float, visibility: float) -> dict:
    prox = 0.0 if d_km is None else 40.0 * max(0.0, 1.0 - d_km / max(1.0, reach_km))
    sig = 35.0 * min(1.0, math.log1p(max(0.0, sig_weight)) / math.log1p(25.0))
    vis = max(0.0, min(25.0, visibility))
    return {"score": round(prox + sig + vis, 1), "proximity": round(prox, 1),
            "signals": round(sig, 1), "visibility": round(vis, 1)}


def _where(d_km, label) -> str:
    if d_km is None:
        return ""
    if label and label.endswith("(centre)"):
        return f"{d_km:.0f} km from the conflict's centre"
    return f"{d_km:.0f} km from {label}" if label else f"{d_km:.0f} km from the contact line"


def make_reason(subgroup: str, what: str, d_km, label, sig_count: int, extra: str = "") -> str:
    """One line a human reads: what it is, where it sits, what we have seen
    there, and why a change there would matter."""
    parts = [what]
    w = _where(d_km, label)
    if w:
        parts.append(w)
    if extra:
        parts.append(extra)
    if sig_count:
        parts.append(f"{sig_count} own report{'s' if sig_count != 1 else ''} within 25 km in {SIGNAL_DAYS} d")
    why = WHY.get(subgroup)
    line = " · ".join(parts)
    return f"{line} — {why}" if why else line


class Context:
    """Everything candidate builders need to place and score a site."""

    def __init__(self, conflict: dict, theatre: dict, components: list[tuple], signals: SignalIndex,
                 places: list[dict] | None = None):
        self.conflict = conflict
        self.theatre = theatre
        self.components = components
        self.signals = signals
        self.places = places or []
        c = conflict.get("center") or [None, None]
        self.center = (c[0], c[1]) if c and c[0] is not None else None
        self.radius_km = float(conflict.get("radius_km") or 800)

    def contact(self, lat: float, lon: float) -> tuple:
        """(km, label, reach_scale) — to the nearest contact line, or to the
        conflict centre when the conflict has none."""
        if self.components:
            d, label = nearest_contact(lat, lon, self.components)
            return d, label, 1.0
        if self.center:
            return km_between(lat, lon, *self.center), "(centre)", self.radius_km / REACH_KM
        return None, None, 1.0

    def place_near(self, lat: float, lon: float, max_km: float = 40.0) -> str | None:
        return nearest_place(lat, lon, self.places, max_km)


def nearest_place(lat: float, lon: float, places: list[dict], max_km: float = 40.0) -> str | None:
    """The nearest named town or city from data (OSM place=city|town, the
    airport register's municipalities) — never invented."""
    best, best_d = None, max_km
    for p in places or []:
        try:
            d = km_between(lat, lon, p["lat"], p["lon"])
        except (KeyError, TypeError):
            continue
        # A city is a better reference than a hamlet 5 km closer.
        d_eff = d * {"city": 0.6, "airport_town": 1.5}.get(p.get("kind"), 1.0)
        if d_eff < best_d:
            best, best_d = p.get("name"), d_eff
    return best


def _cand(ctx: Context, subgroup: str, key: str, name: str, lat: float, lon: float, *,
          reach_km: float, visibility: float, what: str, extra: str = "", box_km: float | None = None,
          meta: dict | None = None) -> dict | None:
    d, label, scale = ctx.contact(lat, lon)
    reach = reach_km * scale
    if d is not None and d > reach:
        return None
    w, n = ctx.signals.weight_near(lat, lon)
    sc = score(d, reach, w, visibility)
    side = box_km or BOX_KM.get(subgroup, 6.0)
    return {
        "key": key, "subgroup": subgroup, "name": name, "lat": round(lat, 5), "lon": round(lon, 5),
        "bbox": box(lat, lon, side), "score": sc["score"], "parts": sc,
        "distance_km": None if d is None else round(d, 1), "contact": label,
        "signals": n, "signal_weight": w,
        "reason": make_reason(subgroup, what, d, label, n, extra),
        "meta": meta or {},
    }


# ── candidate builders (pure: plain records in, candidates out) ──────────

AIRBASE_NAME = re.compile(r"\b(air ?base|airbase|military|air force|aviation base|naval air)\b", re.I)


def airbase_candidates(ctx: Context, airports: list[dict]) -> list[dict]:
    """Military airfields in the theatre's countries. OurAirports names
    them "… Air Base"; medium fields (long runways, the bombers' and
    fighters' homes) reach 1,200 km, small strips 600 km."""
    want = {c.upper() for c in ctx.theatre["countries"]}
    out = []
    for a in airports or []:
        if str(a.get("country_code") or "").upper() not in want:
            continue
        if not AIRBASE_NAME.search(str(a.get("name") or "")):
            continue
        big = a.get("type") in ("medium_airport", "large_airport")
        c = _cand(ctx, "Air bases", f"airport:{a.get('ident')}", a["name"], a["lat"], a["lon"],
                  reach_km=REACH_BIG_KM if big else REACH_KM, visibility=22 if big else 14,
                  what=f"{'Military airfield' if big else 'Military airstrip'} ({country_name(a.get('country_code'))})",
                  meta={"ident": a.get("ident"), "source": "OurAirports"})
        if c:
            out.append(c)
    return out


PORT_VIS = {"Large": 25, "Medium": 18, "Small": 10, "Very Small": 4}


def port_candidates(ctx: Context, ports: list[dict], naval_bases: list[dict] | None = None) -> list[dict]:
    """Fleet ports (curated key_facilities) and World Port Index ports in
    the theatre's countries, within reach. Size class is what decides
    whether a ship is even resolvable in the basin."""
    want = {country_name(c).lower() for c in ctx.theatre["countries"]}
    out = []
    for b in naval_bases or []:
        c = _cand(ctx, "Naval & ports", f"kf:{b['name']}", b["name"], b["lat"], b["lon"],
                  reach_km=REACH_BIG_KM, visibility=25, what=f"Naval base ({b.get('operator') or b.get('country')})",
                  meta={"source": "key_facilities.json"})
        if c:
            out.append(c)
    for p in ports or []:
        if str(p.get("country") or "").lower() not in want:
            continue
        vis = PORT_VIS.get(p.get("size"), 4) + (8 if p.get("use") == "Military" else 0)
        what = f"{p.get('size') or 'Unrated'} port" + (" (military use)" if p.get("use") == "Military" else "")
        c = _cand(ctx, "Naval & ports", f"wpi:{p.get('wpi')}", p["name"], p["lat"], p["lon"],
                  reach_km=REACH_KM, visibility=vis, what=what, meta={"source": "World Port Index"})
        if c:
            out.append(c)
    return out


def strike_candidates(ctx: Context, plants: list[dict], oil_terminals: list[dict] | None = None,
                      refineries: list[dict] | None = None) -> list[dict]:
    """Nuclear plants always; other plants from BIG_PLANT_MW; oil terminals
    (WPI ports with one) and refineries (OSM)."""
    want = {country_name(c).lower() for c in ctx.theatre["countries"]}
    out = []
    for p in plants or []:
        if not p.get("in_theatre"):
            continue
        nuclear = p.get("fuel") == "Nuclear"
        cap = float(p.get("capacity_mw") or 0)
        if not nuclear and cap < BIG_PLANT_MW:
            continue
        vis = 25 if nuclear else 10 + 15 * min(1.0, cap / 4000.0)
        c = _cand(ctx, "Strike targets", f"gppd:{p.get('id')}", p["name"], p["lat"], p["lon"],
                  reach_km=REACH_BIG_KM if nuclear else REACH_KM, visibility=vis,
                  what=f"{p.get('fuel')} power plant, {cap:,.0f} MW", box_km=6.0 if nuclear else 4.0,
                  meta={"source": "Global Power Plant Database", "fuel": p.get("fuel"), "capacity_mw": cap})
        if c:
            c["meta"]["kind"] = "energy_site"
            out.append(c)
    for t in oil_terminals or []:
        if str(t.get("country") or "").lower() not in want:
            continue
        c = _cand(ctx, "Strike targets", f"oilterm:{t.get('wpi')}", f"{t['name']} oil terminal", t["lat"], t["lon"],
                  reach_km=REACH_KM, visibility=16, what="Oil terminal (World Port Index)",
                  meta={"source": "World Port Index", "kind": "oil_terminal"})
        if c:
            out.append(c)
    for r in refineries or []:
        c = _cand(ctx, "Strike targets", f"osm:{r['osm']}", r["name"], r["lat"], r["lon"],
                  reach_km=REACH_KM, visibility=18, what="Oil refinery (OpenStreetMap)",
                  meta={"source": "OpenStreetMap", "kind": "oil_terminal"})
        if c:
            out.append(c)
    return out


OSM_SKIP_MILITARY = {"office", "bunker", "danger_area", "airfield", "checkpoint", "obstacle_course",
                     "trench", "shelter", "nuclear_explosion_site", "ammunition"}
OSM_NOISE = re.compile(r"(paintball|страйкбол|airsoft|колишн|бывш|former|abandoned|закинут|музей|museum|"
                       r"военкомат|військкомат|ваенкамат|recruit|комісаріат|комиссариат|"
                       r"вышка|вежа|tower|радар|radar|кпп|checkpoint|пост\b)", re.I)
OSM_VIS = {"training_area": 18, "range": 16, "base": 16, "naval_base": 20, "barracks": 12}


def ground_base_candidates(ctx: Context, osm: list[dict]) -> list[dict]:
    """Named military sites from OpenStreetMap within GROUND_BASE_KM of a
    border or the front, on either side of it."""
    if not ctx.components:
        return []     # the 150 km rule needs a contact line to be measured from
    # Only sites ON a side's territory: the query boxes are rectangles and
    # reach into Romania, Poland and the Baltics, whose bases are not a
    # party's staging ground in this conflict.
    from shapely.geometry import Point
    from shapely.prepared import prep
    shapes = country_shapes()
    sides = [prep(shapes[c]) for c in ctx.theatre["countries"] if c in shapes]
    out = []
    for e in osm or []:
        if e.get("kind") != "military":
            continue
        if sides and not any(g.contains(Point(e["lon"], e["lat"])) for g in sides):
            continue
        mil = e.get("military") or ""
        if mil in OSM_SKIP_MILITARY or OSM_NOISE.search(e.get("name") or ""):
            continue
        what_word = {"training_area": "Training ground", "range": "Firing range", "base": "Military base",
                     "naval_base": "Naval base", "barracks": "Barracks"}.get(mil, "Military site")
        c = _cand(ctx, "Ground bases & training grounds", f"osm:{e['osm']}", e["name"], e["lat"], e["lon"],
                  reach_km=GROUND_BASE_KM, visibility=OSM_VIS.get(mil, 12),
                  what=f"{what_word} (OpenStreetMap)", meta={"source": "OpenStreetMap", "military": mil or None})
        if c:
            # Proximity on a 150 km reach would swamp the score; rescale it
            # to the same 600 km yardstick as everything else.
            d = c["distance_km"]
            c["parts"] = score(d, REACH_KM, c["signal_weight"], OSM_VIS.get(mil, 12))
            c["score"] = c["parts"]["score"]
            out.append(c)
    return out


def _cluster_points(points: list[dict], km: float) -> list[list[dict]]:
    """Single-linkage clusters of {lat, lon, ...} within km."""
    clusters: list[list[dict]] = []
    for p in sorted(points, key=lambda q: (q["lat"], q["lon"])):
        joined = None
        for c in clusters:
            if any(km_between(p["lat"], p["lon"], q["lat"], q["lon"]) <= km for q in c):
                if joined is None:
                    c.append(p)
                    joined = c
                else:
                    joined.extend(c)
                    c.clear()
        clusters = [c for c in clusters if c]
        if joined is None:
            clusters.append([p])
    return clusters


def front_hotspot_candidates(ctx: Context, changes: dict | None, min_km2: float = 0.2) -> list[dict]:
    """One zone per cluster of territory that changed hands in FRONT_DAYS
    (frontlines.changes()). The biggest changes first."""
    if not changes or not changes.get("available"):
        return []
    from shapely.geometry import shape
    km2 = KM_PER_DEG * KM_PER_DEG * math.cos(math.radians(48.0))
    pieces = []
    for f in ((changes.get("geojson") or {}).get("features") or []):
        kind = (f.get("properties") or {}).get("change")
        try:
            g = shape(f["geometry"])
        except Exception:                                  # noqa: BLE001
            continue
        for part in getattr(g, "geoms", [g]):
            a = part.area * km2
            if a < min_km2:
                continue
            c = part.centroid
            pieces.append({"lat": c.y, "lon": c.x, "area_km2": a, "change": kind})
    out = []
    for cl in _cluster_points(pieces, 10.0):
        area = sum(p["area_km2"] for p in cl)
        lat = sum(p["lat"] * p["area_km2"] for p in cl) / area
        lon = sum(p["lon"] * p["area_km2"] for p in cl) / area
        gained = sum(p["area_km2"] for p in cl if p["change"] == "gained")
        lost = area - gained
        near = ctx.place_near(lat, lon, 30.0)
        name = f"Front near {near}" if near else f"Front at {lat:.2f}, {lon:.2f}"
        how = (f"{gained:.1f} km² newly occupied" if gained else "") + \
              (", " if gained and lost else "") + (f"{lost:.1f} km² retaken" if lost else "")
        c = _cand(ctx, "Front hotspots", f"front:{round(lat, 1)},{round(lon, 1)}", name, lat, lon,
                  reach_km=REACH_KM, visibility=10 + 15 * min(1.0, area / 20.0),
                  what=f"Territory changed hands in {FRONT_DAYS} d ({how})",
                  meta={"source": "DeepStateMap", "area_km2": round(area, 2)})
        if c:
            out.append(c)
    return out


HOT_SPACING_KM = 15.0


def hot_candidates(ctx: Context, min_weight: float = 4.0, top: int = 12) -> list[dict]:
    """Where our own reports cluster: 5 km single-linkage clusters of the
    signal index, weighted, the strongest first — and no two within
    HOT_SPACING_KM, because along an active front the reports form a
    continuous smear and twenty boxes on one town are one place."""
    pts = list(ctx.signals.all())
    out = []
    for cl in _cluster_points(pts, 5.0):
        w = sum(float(p.get("weight") or 1.0) for p in cl)
        if w < min_weight:
            continue
        lat = sum(p["lat"] for p in cl) / len(cl)
        lon = sum(p["lon"] for p in cl) / len(cl)
        kinds: dict = {}
        for p in cl:
            kinds[p.get("label") or "report"] = kinds.get(p.get("label") or "report", 0) + 1
        mix = ", ".join(f"{k} {v}" for k, v in sorted(kinds.items(), key=lambda kv: -kv[1])[:3])
        near = ctx.place_near(lat, lon, 30.0)
        name = f"Reports cluster near {near}" if near else f"Reports cluster at {lat:.2f}, {lon:.2f}"
        c = _cand(ctx, "Hot right now", f"hot:{round(lat, 1)},{round(lon, 1)}", name, lat, lon,
                  reach_km=REACH_BIG_KM, visibility=12,
                  what=f"{len(cl)} own reports within 5 km in {SIGNAL_DAYS} d ({mix})",
                  meta={"source": "own signals", "cluster_weight": round(w, 1)})
        if c:
            out.append(c)
    # Strongest cluster weight first: it is the evidence, the score adds geography.
    out.sort(key=lambda c: (-c["meta"]["cluster_weight"], -c["score"]))
    spaced = []
    for c in out:
        if all(km_between(c["lat"], c["lon"], k["lat"], k["lon"]) > HOT_SPACING_KM for k in spaced):
            spaced.append(c)
    spaced.sort(key=lambda c: -c["score"])
    return spaced[:top]


# ── the border sweep ─────────────────────────────────────────────────────
#
# THE OWNER'S SWEEP IDEA (2026-10-11). Unmapped makeshift bases, field
# hospitals and troop build-ups are in no register, so they cannot be
# proposed from data — they can only be FOUND, by looking everywhere they
# could be. The staging band beside a border (20-150 km in, on the side
# that would stage) is tiled into ~20 km squares — sentinel_tiles.py's
# 2048 px at 10 m, the largest single Sentinel Hub request — and a sweep
# processes them ONE AT A TIME as temporary zones (aoi_class "sweep"):
#
#   create the tile zone → radar change pass over it → evaluate →
#     nothing interesting: delete the zone, keep one log row (tile, bbox,
#       when, what was measured) so coverage can be shown and the tile is
#       not re-swept for RESWEEP_CLEAN_DAYS;
#     interesting: keep it as an active 24 h zone under
#       "<Conflict> → Found by sweep", with what was found, and raise a
#       high-severity notification through the alert writer.
#
# RADAR FIRST. Sentinel-1 sees through cloud and at night, and a change
# between two radar stacks (pwtt.py, Welch t per pixel) is the one thing
# our pipeline can measure that a build-up produces: vehicles, tents,
# containers and fresh structures are hard scatterers — a cluster of them
# brightens the ground where there was field or forest.
#
# WHAT 10-20 m CAN AND CANNOT SAY, said here so nobody reads more into a
# finding than is in it: a field hospital cannot be told apart from any
# other tent cluster, nor a tent cluster from a vehicle park or a new farm
# shed. A finding is "new bright-scatterer cluster" (or "new cleared /
# disturbed ground") of a measured size — a reason for a human or
# high-resolution imagery to look, never an identification.

SWEEP_TILE_KM = 20.48            # sentinel_tiles.TILE_PX × NATIVE_M_PER_PX
SWEEP_BAND_MIN_KM = float(os.getenv("OVERWATCH_SWEEP_BAND_MIN_KM", "20"))
SWEEP_BAND_MAX_KM = float(os.getenv("OVERWATCH_SWEEP_BAND_MAX_KM", "150"))
RESWEEP_CLEAN_DAYS = int(os.getenv("OVERWATCH_RESWEEP_DAYS", "14"))
RESWEEP_RETRY_DAYS = 3           # no data / inconclusive / error: try again sooner
# The first finds of a day interrupt (high severity); later ones that day are
# still kept and listed in the sweep panel, written at medium so a noisy
# season does not become a stream of pop-ups.
SWEEP_MAX_ALERTS_PER_DAY = int(os.getenv("OVERWATCH_SWEEP_MAX_ALERTS_PER_DAY", "5"))

# Evaluation thresholds. A region must clear |t| ≥ SWEEP_MIN_T — well past
# the 1.63 per-pixel threshold pwtt uses to draw the mask — to count.
SWEEP_MIN_T = 3.0
APPEAR_MIN_AREA_M2 = 10_000      # 1 ha: the smallest region pwtt reports at 20 m/px (25 px)
REGION_MAX_AREA_M2 = 150_000     # one region over 15 ha is a field or a meadow being worked, not a camp
CLUSTER_KM = 1.0
# A cluster counts when it is camp-sized — 3 to 25 ha of new bright
# scatterers (a company's vehicle park is a few ha, a brigade's
# assembly area tens) — and is either more than one region or one strong one.
CLUSTER_MIN_AREA_M2 = 30_000
CLUSTER_MAX_AREA_M2 = 250_000
CLUSTER_MIN_REGIONS = 2
STRONG_REGION_T = 8.0
# Darkening (cleared or disturbed ground) is also harvest, ploughing and
# flooding, which in September-October cover these plains — so it needs a
# far bigger, stronger signal to count on its own.
CLEARED_MIN_T = 5.0
CLEARED_MIN_AREA_M2 = 150_000
WIDESPREAD_CLUSTERS = 12         # more findings than this in one tile = a season, not a build-up
WIDESPREAD_FRACTION = 0.08       # or this share of the tile changed

# MEASURED, 2026-10-11, on five real tiles (Kursk, Belgorod, Gomel ×2,
# Pskov): with "both" directions 11-17 % of a tile changed between late
# August and October — harvest and ploughing — so every tile came out
# inconclusive. With brightening only ("increase", the direction new
# vehicles, tents and structures go) 6-84 regions per tile remained, all
# small, compact and strong (|t| 10-100 on three-pass stacks): no region
# statistic separates a ploughed field from a vehicle park at 20 m.
# What does separate them is WHERE: 99 % of those regions lay on cropland
# (ESA WorldCover class 40) or water. So a region only counts on land
# where a new hard-scatterer cluster is not a farming season — forest,
# shrub, grassland, bare ground (WorldCover 10/20/30/60/100). A camp IN a
# field in harvest season is therefore not findable by this sweep, and
# that is said rather than hidden. Without land cover the tile is
# inconclusive, never kept on statistics alone.
SWEEP_DIRECTION = os.getenv("OVERWATCH_SWEEP_DIRECTION", "increase")
SWEEP_LANDCOVER = {10: "tree cover", 20: "shrubland", 30: "grassland", 60: "bare ground", 100: "moss"}
LANDCOVER_WORD = {**SWEEP_LANDCOVER, 40: "cropland", 50: "built-up", 80: "water", 90: "wetland", 95: "mangrove", 0: "unknown"}


def annotate_landcover(out: dict, classes) -> dict:
    """Give each pwtt region the WorldCover class most of its box lies on.
    `classes` is the class raster on the same grid as the change image (or
    None when WorldCover could not be read)."""
    if classes is None:
        out["landcover_available"] = False
        return out
    import numpy as np
    out["landcover_available"] = True
    h, w = classes.shape
    for d in out.get("detections") or []:
        x0, y0, x1, y1 = d.get("bbox_px") or (0, 0, -1, -1)
        win = classes[max(0, y0):min(h, y1 + 1), max(0, x0):min(w, x1 + 1)]
        if win.size == 0:
            d["landcover"] = 0
            continue
        vals, cnt = np.unique(win, return_counts=True)
        d["landcover"] = int(vals[int(np.argmax(cnt))])
    return out


def _grid_dlat() -> float:
    return SWEEP_TILE_KM / KM_PER_DEG


def tile_for(lat: float, lon: float) -> dict:
    """The fixed global grid cell containing a point — anchored at 0,0 so a
    tile id means the same square in every plan, run and sweep."""
    dlat = _grid_dlat()
    r = int(math.floor(lat / dlat))
    row_lat = (r + 0.5) * dlat
    dlon = SWEEP_TILE_KM / (KM_PER_DEG * max(0.05, math.cos(math.radians(row_lat))))
    c = int(math.floor(lon / dlon))
    return {"tile_id": f"T{r}_{c}",
            "bbox": (round(c * dlon, 6), round(r * dlat, 6), round((c + 1) * dlon, 6), round((r + 1) * dlat, 6))}


def band_geometry(stager: str, facing: str, shapes: dict | None = None,
                  min_km: float = SWEEP_BAND_MIN_KM, max_km: float = SWEEP_BAND_MAX_KM):
    """The stager's land between min_km and max_km of its border with
    `facing`, in lon/lat, plus the border line itself."""
    shapes = shapes or country_shapes()
    line = shared_border(stager, facing, shapes)
    land = shapes.get(stager)
    if line is None or land is None:
        return None, None
    c = line.centroid
    lat0, lon0 = c.y, c.x
    line_k = _to_km(line, lat0, lon0)
    reach = line_k.buffer(max_km)
    land_k = _to_km(land.intersection(_from_km(reach, lat0, lon0).envelope), lat0, lon0)
    band_k = land_k.intersection(reach).difference(line_k.buffer(min_km))
    if band_k.is_empty:
        return None, line
    return _from_km(band_k, lat0, lon0), line


def plan_sweep_tiles(theatre: dict, shapes: dict | None = None) -> list[dict]:
    """Every tile of every sweep band of the theatre, de-duplicated (a tile
    in two bands keeps the first). Each carries its band, the stager and
    facing countries and its distance to that border."""
    from shapely.geometry import Point
    from shapely.prepared import prep
    shapes = shapes or country_shapes()
    out, seen = [], set()
    for band in theatre.get("sweep_bands") or []:
        geom, line = band_geometry(band["stager"], band["facing"], shapes)
        if geom is None:
            continue
        pg = prep(geom)
        w, s, e, n = geom.bounds
        dlat = _grid_dlat()
        r0, r1 = int(math.floor(s / dlat)), int(math.floor(n / dlat))
        for r in range(r0, r1 + 1):
            row_lat = (r + 0.5) * dlat
            if band.get("min_lat") is not None and row_lat < band["min_lat"]:
                continue
            if band.get("max_lat") is not None and row_lat > band["max_lat"]:
                continue
            dlon = SWEEP_TILE_KM / (KM_PER_DEG * max(0.05, math.cos(math.radians(row_lat))))
            for c in range(int(math.floor(w / dlon)), int(math.floor(e / dlon)) + 1):
                lon_c = (c + 0.5) * dlon
                if not pg.contains(Point(lon_c, row_lat)):
                    continue
                tid = f"T{r}_{c}"
                if tid in seen:
                    continue
                seen.add(tid)
                out.append({
                    "tile_id": tid, "band": f"{band['stager']}>{band['facing']}",
                    "stager": band["stager"], "facing": band["facing"],
                    "bbox": (round(c * dlon, 6), round(r * dlat, 6), round((c + 1) * dlon, 6), round((r + 1) * dlat, 6)),
                    "lat": round(row_lat, 5), "lon": round(lon_c, 5),
                    "border_km": round(distance_km(row_lat, lon_c, line) or 0.0, 1),
                })
    return out


def order_tiles(tiles: list[dict], signals: SignalIndex) -> list[dict]:
    """Most suspicious first — own signals within 25 km of the tile's
    centre, then the tiles nearest the border — so a sweep spends its first
    passes where something has already been seen. The rest rotate behind."""
    scored = []
    for t in tiles:
        w, n = signals.weight_near(t["lat"], t["lon"], SIGNAL_RADIUS_KM)
        scored.append({**t, "signal_weight": w, "signals": n})
    scored.sort(key=lambda t: (-t["signal_weight"], t["border_km"], t["tile_id"]))
    return scored


def resweep_after(result: str) -> int:
    return RESWEEP_CLEAN_DAYS if result in ("clean", "found") else RESWEEP_RETRY_DAYS


def tile_is_due(tile_id: str, log: list[dict], now: _dt.datetime) -> bool:
    """False while a previous look at this tile is still fresh enough — the
    sweep log is what stops a clean tile being re-swept for N days."""
    for row in log or []:
        if row.get("tile_id") != tile_id:
            continue
        at = row.get("scanned_at")
        if isinstance(at, str):
            try:
                at = _dt.datetime.fromisoformat(at.replace("Z", ""))
            except ValueError:
                continue
        if at and now - at < _dt.timedelta(days=resweep_after(row.get("result") or "")):
            return False
    return True


def next_tiles(order: list[str], log: list[dict], now: _dt.datetime, n: int = 1,
               skip: set | None = None) -> list[str]:
    skip = skip or set()
    out = []
    for tid in order or []:
        if tid in skip or not tile_is_due(tid, log, now):
            continue
        out.append(tid)
        if len(out) >= n:
            break
    return out


def sweep_region(d: dict, m_per_px: float = 10.0) -> dict | None:
    """One pwtt region as the sweep counts it (appeared / cleared, with its
    area and |t|), or None when it does not qualify. Land cover is checked
    by the caller; this is the strength-and-size rule alone."""
    t = abs(float(d.get("t_peak") or 0))
    area = float(d.get("pixels") or 0) * m_per_px * m_per_px
    if d.get("change_direction") == "appeared" and t >= SWEEP_MIN_T and APPEAR_MIN_AREA_M2 <= area <= REGION_MAX_AREA_M2:
        kind = "appeared"
    elif d.get("change_direction") == "removed" and t >= CLEARED_MIN_T and area >= APPEAR_MIN_AREA_M2:
        kind = "cleared"
    else:
        return None
    return {**d, "area_m2": area, "kind": kind, "t": t, "lat": d["centroid_lat"], "lon": d["centroid_lon"]}


def sweep_finding_regions(finding: dict, detections: list[dict], m_per_px: float = 10.0) -> list[dict]:
    """The stored regions that made up a sweep finding, rebuilt for a finding
    written before the sweep kept its own extent: the qualifying regions are
    clustered exactly as the sweep clusters them, and the cluster holding
    the region nearest the finding's centre is returned (empty when none is
    within CLUSTER_KM of it). Land cover was not stored, so this can include
    a region the sweep had excluded — the box is then a little larger, never
    elsewhere."""
    regs = [q for q in (sweep_region(d, m_per_px) for d in detections or []) if q is not None]
    if not regs or finding.get("lat") is None:
        return []
    best, best_km = None, None
    for cl in _cluster_points(regs, CLUSTER_KM):
        km = min(km_between(finding["lat"], finding["lon"], r["lat"], r["lon"]) for r in cl)
        if best_km is None or km < best_km:
            best, best_km = cl, km
    return best if best is not None and best_km <= CLUSTER_KM else []


def evaluate_sweep_result(out: dict) -> dict:
    """Decide KEEP or DELETE for one swept tile from a pwtt job result.

    Returns {result: clean|found|no_data|inconclusive|error, keep: bool,
    findings: [...], summary: str, metrics: {...}}. Only "found" keeps the
    zone. Everything here is measured at Sentinel-1's 10 m (rendered at
    ~20 m for a 20 km tile) — see the section comment above for what a
    finding can and cannot mean."""
    out = out or {}
    if out.get("status") != "completed":
        err = str(out.get("error") or "no result")
        res = "no_data" if out.get("recoverable") or "acquisition" in err or "Sentinel-1" in err else "error"
        return {"result": res, "keep": False, "findings": [], "summary": err[:300], "metrics": {}}

    m_per_px = float(out.get("m_per_px") or 10.0)
    metrics = {"m_per_px": m_per_px, "stack_before": out.get("stack_before"), "stack_after": out.get("stack_after"),
               "changed_fraction": out.get("changed_fraction"), "regions": len(out.get("detections") or [])}
    if out.get("suspect_wholesale_shift") or float(out.get("changed_fraction") or 0) > WIDESPREAD_FRACTION:
        return {"result": "inconclusive", "keep": False, "findings": [], "metrics": metrics,
                "summary": (f"{float(out.get('changed_fraction') or 0) * 100:.1f}% of the tile changed — a whole-scene "
                            "shift (rain, harvest, a different orbit), not a build-up; looked at again in "
                            f"{RESWEEP_RETRY_DAYS} days")}

    if out.get("landcover_available") is False:
        return {"result": "inconclusive", "keep": False, "findings": [], "metrics": metrics,
                "summary": ("land cover (ESA WorldCover) could not be read — without it a ploughed field and a "
                            f"vehicle park are the same signal; looked at again in {RESWEEP_RETRY_DAYS} days")}

    regions = []
    skipped: dict = {}
    for d in out.get("detections") or []:
        lc = d.get("landcover")
        if lc is not None and lc not in SWEEP_LANDCOVER:
            word = LANDCOVER_WORD.get(lc, str(lc))
            skipped[word] = skipped.get(word, 0) + 1
            continue
        q = sweep_region(d, m_per_px)
        if q is not None:
            regions.append(q)

    findings = []
    for cl in _cluster_points(regions, CLUSTER_KM):
        app = [r for r in cl if r["kind"] == "appeared"]
        clr = [r for r in cl if r["kind"] == "cleared"]
        app_area = sum(r["area_m2"] for r in app)
        clr_area = sum(r["area_m2"] for r in clr)
        strong = any(r["t"] >= STRONG_REGION_T for r in app)
        if app and CLUSTER_MIN_AREA_M2 <= app_area <= CLUSTER_MAX_AREA_M2 and (len(app) >= CLUSTER_MIN_REGIONS or strong):
            kind = "new tent/vehicle cluster"
        elif clr and clr_area >= CLEARED_MIN_AREA_M2:
            kind = "new cleared/disturbed ground"
        else:
            continue
        lat = sum(r["lat"] * r["area_m2"] for r in cl) / sum(r["area_m2"] for r in cl)
        lon = sum(r["lon"] * r["area_m2"] for r in cl) / sum(r["area_m2"] for r in cl)
        cover = [LANDCOVER_WORD.get(r.get("landcover"), "") for r in cl if r.get("landcover") is not None]
        # WHERE IT IS, AS A BOX (owner, 2026-10-12): the union of the member
        # regions' real pixel extents, put on the ground with the tile's
        # bounds — so a notification can draw what was found, not a dot.
        import finding_boxes as _fb
        box, box_src = _fb.cluster_extent(cl, out.get("bounds"))
        findings.append({
            "kind": kind, "lat": round(lat, 5), "lon": round(lon, 5),
            "landcover": max(set(cover), key=cover.count) if cover else None,
            "appeared_m2": round(app_area), "cleared_m2": round(clr_area), "regions": len(cl),
            "t_peak": round(max(r["t"] for r in cl), 2),
            "box": box, "box_source": box_src,
        })
    findings.sort(key=lambda f: -(f["appeared_m2"] * 2 + f["cleared_m2"]))
    metrics["qualifying_regions"] = len(regions)
    metrics["excluded_by_landcover"] = skipped
    skipped_txt = (" (" + ", ".join(f"{n} on {w}" for w, n in sorted(skipped.items(), key=lambda kv: -kv[1]))
                   + " not counted — seasonal or mapped land)") if skipped else ""

    if len(findings) > WIDESPREAD_CLUSTERS:
        # Not kept — widespread change is season or moisture — but every
        # cluster is recorded, not the first 5 (2026-10-17, no caps).
        return {"result": "inconclusive", "keep": False, "findings": findings, "metrics": metrics,
                "summary": (f"{len(findings)} change clusters across the tile — widespread change reads as "
                            "season or moisture, not one build-up; not kept")}
    if not findings:
        return {"result": "clean", "keep": False, "findings": [], "metrics": metrics,
                "summary": (f"nothing new: {len(out.get('detections') or [])} change region(s), none a cluster of "
                            f"new hard scatterers of {CLUSTER_MIN_AREA_M2 / 10000:.0f}-{CLUSTER_MAX_AREA_M2 / 10000:.0f} ha "
                            f"on forest, shrub, grass or bare ground{skipped_txt}")}
    top = findings[0]
    return {"result": "found", "keep": True, "findings": findings, "metrics": metrics,
            "summary": (f"{len(findings)} finding(s); strongest: {top['kind']}, "
                        f"{(top['appeared_m2'] or top['cleared_m2']) / 10000:.1f} ha on {top.get('landcover') or 'unmapped land'}, "
                        f"|t| {top['t_peak']}{skipped_txt} — "
                        "at 10-20 m a field hospital, a tent camp and a vehicle park look alike; for a human to identify")}


def sweep_finding_title(finding: dict, tile: dict, places: list[dict] | None = None, border_line=None) -> str:
    """"Possible new vehicle or tent concentration 34 km inside Belarus near
    Mozyr — found by sweep". The distance is measured to the band's own
    border; the town comes from data or is left out."""
    country = country_name(tile.get("stager"))
    d = distance_km(finding["lat"], finding["lon"], border_line) if border_line is not None else tile.get("border_km")
    near = nearest_place(finding["lat"], finding["lon"], places or [], 60.0)
    what = ("Possible new vehicle or tent concentration" if finding["kind"] == "new tent/vehicle cluster"
            else "New cleared or disturbed ground")
    where = f" {d:.0f} km inside {country}" if d is not None else f" in {country}"
    return f"{what}{where}{f' near {near}' if near else ''} — found by sweep"


# ── selection ────────────────────────────────────────────────────────────

def dedupe_candidates(cands: list[dict]) -> list[dict]:
    """One candidate per place across subgroups: the earlier subgroup in
    GROUP_ORDER keeps it (an air base found again as a reports cluster is
    still the air base), absorbing the other's signal count."""
    rank = {g: i for i, g in enumerate(GROUP_ORDER)}
    keep: list[dict] = []
    for c in sorted(cands, key=lambda c: (rank.get(c["subgroup"], 99), -c["score"])):
        if c["subgroup"] == "Border sweep":      # a plan spanning a theatre, not a place
            keep.append(c)
            continue
        twin = next((k for k in keep if k["subgroup"] != "Border sweep" and same_place(k["bbox"], c["bbox"])), None)
        if twin is None:
            keep.append(c)
        else:
            twin.setdefault("also", []).append(f"{c['subgroup']}: {c['name']}")
    return keep


def select_proposals(cands: list[dict], existing: list[dict], declined: set | None = None,
                     cap: int = MAX_PROPOSALS, min_per: int = MIN_PER_SUBGROUP) -> dict:
    """Which candidates become proposals now.

    existing: [{system_id, bbox, status, source_key, conflict, generated_by}]
    — the user's zones. A candidate that matches an existing PROPOSAL of
    this generator (same source key, or the same place) updates it; one
    that matches any other zone is already watched and skipped. Declined
    source keys are not offered again.

    The cap is spent in two passes: up to `min_per` per subgroup, best
    first, so no kind of place is crowded out entirely; then the rest by
    score across all of them."""
    declined = declined or set()
    by_key = {e.get("source_key"): e for e in existing if e.get("source_key")}
    usable, already = [], {}
    for c in dedupe_candidates(cands):
        if c["key"] in declined:
            continue
        hit = by_key.get(c["key"])
        if hit is None and c["subgroup"] != "Border sweep":
            # Sweep plans and sweep tiles span far more than one place;
            # they never make a site "already watched".
            hit = next((e for e in existing if e.get("bbox") and e.get("aoi_class") not in ("sweep_plan", "sweep")
                        and same_place(e["bbox"], c["bbox"])), None)
        if hit is not None and not (hit.get("status") == "proposed" and hit.get("generated_by") == "overwatch"):
            already[c["subgroup"]] = already.get(c["subgroup"], 0) + 1
            continue
        usable.append({**c, "update": hit["system_id"] if hit is not None else None})

    by_group: dict = {}
    for c in sorted(usable, key=lambda c: -c["score"]):
        by_group.setdefault(c["subgroup"], []).append(c)
    chosen, chosen_ids = [], set()
    for g in GROUP_ORDER:
        for c in by_group.get(g, [])[:min_per]:
            if len(chosen) >= cap:
                break
            chosen.append(c)
            chosen_ids.add(id(c))
    # Second pass: best remaining score, less a small penalty per place
    # already taken from the same subgroup — scores near the front saturate,
    # and without it one kind of place (report clusters) takes every slot.
    taken = {}
    for c in chosen:
        taken[c["subgroup"]] = taken.get(c["subgroup"], 0) + 1
    rest = [c for c in usable if id(c) not in chosen_ids]
    while rest and len(chosen) < cap:
        best = max(rest, key=lambda c: c["score"] - DIVERSITY_PENALTY * taken.get(c["subgroup"], 0))
        rest.remove(best)
        chosen.append(best)
        chosen_ids.add(id(best))
        taken[best["subgroup"]] = taken.get(best["subgroup"], 0) + 1

    report = {}
    for g in GROUP_ORDER:
        total = len(by_group.get(g, []))
        n = sum(1 for c in chosen if c["subgroup"] == g)
        if total or already.get(g):
            report[g] = {"proposed": n, "more_available": total - n, "already_watched": already.get(g, 0)}
    chosen.sort(key=lambda c: (GROUP_ORDER.index(c["subgroup"]) if c["subgroup"] in GROUP_ORDER else 99, -c["score"]))
    return {"chosen": chosen, "report": report, "candidates": len(usable)}


def zone_tree(zones: list[dict]) -> list[dict]:
    """group → subgroup → zones, ungrouped under "Other" (the same rule as
    src/destinations/overwatchTree.js, for API callers)."""
    groups: dict = {}
    for z in zones or []:
        m = z.get("metadata") or {}
        g = m.get("group") or "Other"
        s = m.get("subgroup") or ("Areas" if g == "Other" else "General")
        groups.setdefault(g, {}).setdefault(s, []).append(z)
    out = []
    for g in sorted(groups, key=lambda g: (g == "Other", g)):
        subs = groups[g]
        order = [s for s in GROUP_ORDER + (FOUND_BY_SWEEP, SWEEP_IN_PROGRESS) if s in subs] + \
                sorted(s for s in subs if s not in GROUP_ORDER + (FOUND_BY_SWEEP, SWEEP_IN_PROGRESS))
        out.append({"group": g, "subgroups": [{"subgroup": s, "zones": subs[s]} for s in order]})
    return out


# ═════════════════════════════════════════════════════════════════════════
# LOADERS — files, the database and the network. Thin, so the logic above
# stays testable without any of them.
# ═════════════════════════════════════════════════════════════════════════

_HERE = os.path.dirname(os.path.abspath(__file__))


def load_airports(db, countries: list[str]) -> list[dict]:
    from database import Airport
    rows = (db.query(Airport.ident, Airport.airport_name, Airport.airport_type, Airport.country_code,
                     Airport.latitude, Airport.longitude, Airport.municipality)
            .filter(Airport.country_code.in_([c.upper() for c in countries])).all())
    return [{"ident": r[0], "name": r[1], "type": r[2], "country_code": r[3], "lat": r[4], "lon": r[5],
             "municipality": r[6]} for r in rows if r[4] is not None and r[5] is not None]


def load_ports(countries: list[str]) -> tuple[list[dict], list[dict]]:
    """(ports, oil_terminals) from the World Port Index cache."""
    want = {country_name(c).lower() for c in countries}
    ports, oil = [], []
    path = os.path.join(_HERE, "ports_cache.csv")
    if not os.path.exists(path):
        return ports, oil
    with open(path, encoding="utf-8-sig") as fh:
        for r in csv.DictReader(fh):
            if str(r.get("Country Code") or "").lower() not in want:
                continue
            try:
                lat, lon = float(r["Latitude"]), float(r["Longitude"])
            except (KeyError, TypeError, ValueError):
                continue
            rec = {"wpi": str(r.get("World Port Index Number") or "").split(".")[0], "name": r.get("Main Port Name"),
                   "country": r.get("Country Code"), "lat": lat, "lon": lon,
                   "size": r.get("Harbor Size"), "use": r.get("Harbor Use")}
            ports.append(rec)
            if (r.get("Facilities - Oil Terminal") or "") == "Yes":
                oil.append(rec)
    return ports, oil


_ISO3 = {"ua": "UKR", "ru": "RUS", "by": "BLR", "md": "MDA", "ee": "EST", "lv": "LVA", "lt": "LTU", "pl": "POL"}


def load_plants(countries: list[str]) -> list[dict]:
    want = set()
    for c in countries:
        iso3 = _ISO3.get(c.lower())
        if iso3 is None:
            try:
                import pycountry  # noqa: F401 — optional
                iso3 = pycountry.countries.get(alpha_2=c.upper()).alpha_3
            except Exception:                              # noqa: BLE001
                iso3 = None
        if iso3:
            want.add(iso3)
    out = []
    path = os.path.join(_HERE, "powerplants_cache.csv")
    if not os.path.exists(path):
        return out
    with open(path, encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            if want and r.get("country") not in want:
                continue
            try:
                out.append({"id": r["gppd_idnr"], "name": r["name"], "iso3": r["country"],
                            "lat": float(r["latitude"]), "lon": float(r["longitude"]),
                            "fuel": r.get("primary_fuel"), "capacity_mw": float(r.get("capacity_mw") or 0),
                            "in_theatre": True})
            except (KeyError, TypeError, ValueError):
                continue
    return out


def load_naval_bases(countries: list[str]) -> list[dict]:
    """Curated naval bases (key_facilities.json) whose name says naval/fleet
    and whose point lies in one of the theatre's countries (or Crimea)."""
    path = os.path.join(_HERE, "data", "key_facilities.json")
    try:
        with open(path, encoding="utf-8") as fh:
            kf = json.load(fh)
    except (OSError, ValueError):
        return []
    want = {country_name(c).lower() for c in countries} | ({"crimea"} if "ua" in countries or "ru" in countries else set())
    out = []
    for b in kf.get("military_bases") or []:
        if not re.search(r"naval|fleet|navy", str(b.get("name") or ""), re.I):
            continue
        if str(b.get("country") or "").lower() in want:
            out.append(b)
    return out


def load_signals(db, region: tuple, slug: str | None, now: _dt.datetime | None = None) -> list[dict]:
    """Own signals of the last SIGNAL_DAYS inside region (w, s, e, n):
    GeoConfirmed placemarks, imagery/corroboration/FIRMS/surge alerts and
    fusion events. Continuous feeds (AIS, ADS-B, GPS jamming) are a picture
    of normality, not a reason to look, and are left out."""
    from database import Alert, FusionEvent, GeoConfirmedPlacemark
    now = now or _dt.datetime.utcnow()
    since = now - _dt.timedelta(days=SIGNAL_DAYS)
    w, s, e, n = region
    out = []
    q = (db.query(GeoConfirmedPlacemark.latitude, GeoConfirmedPlacemark.longitude, GeoConfirmedPlacemark.category,
                  GeoConfirmedPlacemark.date)
         .filter(GeoConfirmedPlacemark.date >= since,
                 GeoConfirmedPlacemark.latitude.between(s, n), GeoConfirmedPlacemark.longitude.between(w, e)))
    if slug:
        q = q.filter(GeoConfirmedPlacemark.theatre_slug == slug)
    for lat, lon, cat, when in q.all():
        cat = (cat or "conflict").lower()
        wgt = SIGNAL_WEIGHTS.get(f"gc:{cat}")
        if wgt is None:
            continue
        out.append({"lat": lat, "lon": lon, "weight": wgt, "label": f"GeoConfirmed {cat}", "when": when})
    sources = ["SAT-TASK", "CORROBORATED", "FIRMS", "surge"]
    for lat, lon, src in (db.query(Alert.lat, Alert.lon, Alert.source)
                          .filter(Alert.source.in_(sources), Alert.created_at >= since,
                                  Alert.lat.between(s, n), Alert.lon.between(w, e)).all()):
        out.append({"lat": lat, "lon": lon, "weight": SIGNAL_WEIGHTS.get(f"alert:{src}", 1.0),
                    "label": {"SAT-TASK": "imagery signal", "CORROBORATED": "corroborated", "FIRMS": "fire",
                              "surge": "news surge"}.get(src, src)})
    for lat, lon in (db.query(FusionEvent.lat, FusionEvent.lon)
                     .filter(FusionEvent.created_at >= since,
                             FusionEvent.lat.between(s, n), FusionEvent.lon.between(w, e)).all()):
        out.append({"lat": lat, "lon": lon, "weight": SIGNAL_WEIGHTS["fusion"], "label": "fusion"})
    return [x for x in out if x["lat"] is not None and x["lon"] is not None]


# ── OpenStreetMap, cached small and weekly ───────────────────────────────

def osm_cache_path(conflict_id: str) -> str:
    import paths
    return os.path.join(str(paths.DATA_DIR), f"overwatch_osm_{conflict_id}.json")


def osm_tiles(components: list[tuple], km: float = GROUND_BASE_KM, step: float = 2.0) -> list[tuple]:
    """2° query boxes (s, w, n, e) covering the contact lines grown by km —
    Overpass times out on a whole theatre in one request, and (measured
    2026-10-11) on most 3° boxes too; 2° boxes answer in ~30 s."""
    from shapely.geometry import box as _box
    from shapely.ops import unary_union
    if not components:
        return []
    lines = unary_union([g for _l, g in components])
    grown = lines.buffer(km / KM_PER_DEG * 1.6)       # degrees; generous in longitude at 45-60°N
    w, s, e, n = grown.bounds
    out = []
    lat = math.floor(s)
    while lat < n:
        lon = math.floor(w)
        while lon < e:
            if grown.intersects(_box(lon, lat, lon + step, lat + step)):
                out.append((lat, lon, round(lat + step, 4), round(lon + step, 4)))
            lon += step
        lat += step
    return out


def overpass_query(s, w, n, e) -> str:
    bb = f"({s},{w},{n},{e})"
    return ("[out:json][timeout:120];("
            f'way["landuse"="military"]["name"]{bb};'
            f'relation["landuse"="military"]["name"]{bb};'
            f'nwr["military"~"^(base|training_area|barracks|range|naval_base)$"]["name"]{bb};'
            f'nwr["industrial"="refinery"]{bb};'
            f'node["place"~"^(city|town)$"]["name"]{bb};'
            ");out tags center;")


def _osm_name(tags: dict) -> str | None:
    return tags.get("name:en") or tags.get("int_name") or tags.get("name")


def normalise_osm(elements: list) -> list[dict]:
    """Overpass elements → compact records: military sites, refineries and
    named towns (for "near X" in titles). Coordinates are OSM's own."""
    out = []
    for el in elements or []:
        tags = el.get("tags") or {}
        if "lat" in el and "lon" in el:
            lat, lon = el["lat"], el["lon"]
        elif el.get("center"):
            lat, lon = el["center"].get("lat"), el["center"].get("lon")
        else:
            continue
        osm = f"{el.get('type')}/{el.get('id')}"
        if tags.get("place") in ("city", "town"):
            out.append({"kind": tags["place"], "name": _osm_name(tags), "lat": lat, "lon": lon, "osm": osm})
        elif tags.get("industrial") == "refinery":
            name = _osm_name(tags) or (f"{tags['operator']} refinery" if tags.get("operator") else None)
            if name:
                out.append({"kind": "refinery", "name": name, "lat": lat, "lon": lon, "osm": osm})
        elif tags.get("landuse") == "military" or tags.get("military"):
            name = _osm_name(tags)
            if name:
                out.append({"kind": "military", "military": tags.get("military") or "", "name": name,
                            "lat": lat, "lon": lon, "osm": osm})
    return out


def load_osm(conflict_id: str) -> dict:
    try:
        with open(osm_cache_path(conflict_id), encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {"tiles": {}, "elements": []}


def osm_stale_tiles(cache: dict, tiles: list[tuple], now: float | None = None) -> list[tuple]:
    now = now or time.time()
    out = []
    for t in tiles:
        rec = (cache.get("tiles") or {}).get(",".join(str(x) for x in t))
        if not rec or now - float(rec.get("at") or 0) > OSM_REFRESH_DAYS * 86400:
            out.append(t)
    return out


_OSM_LOCK = threading.Lock()


def _osm_save(conflict_id: str, cache: dict) -> None:
    merged, seen = [], set()
    for recs in (cache.get("by_tile") or {}).values():
        for r in recs:
            if r["osm"] in seen:
                continue
            seen.add(r["osm"])
            merged.append(r)
    cache["elements"] = merged
    cache["updated_at"] = time.time()
    path = osm_cache_path(conflict_id)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(cache, fh, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def refresh_osm(conflict_id: str, tiles: list[tuple], fetch_overpass, max_tiles: int | None = None) -> dict:
    """Fetch the stale query boxes and merge them into the cache file,
    saved after every box so an interrupted refresh keeps what it got.

    A box that fails is left stale (and retried next time) rather than
    stored empty — an empty answer from a busy Overpass is not "no bases
    here". Elements are kept per box so a refresh replaces, not appends."""
    with _OSM_LOCK:
        cache = load_osm(conflict_id)
        todo = osm_stale_tiles(cache, tiles)
        if max_tiles is not None:
            todo = todo[:max_tiles]
        per_tile = cache.setdefault("by_tile", {})
        ok = failed = 0
        for t in todo:
            key = ",".join(str(x) for x in t)
            try:
                raw = fetch_overpass(overpass_query(*t))
            except Exception as e:                         # noqa: BLE001
                print(f"[overwatch] error: Overpass box {key}: {type(e).__name__}: {e}", flush=True)
                failed += 1
                continue
            # A real Overpass answer carries its own header ("version",
            # "osm3s"); main._fetch_overpass answers {"elements": []} when
            # every mirror failed, which must not be cached as "no bases".
            if not isinstance(raw, dict) or not ("osm3s" in raw or "version" in raw) or raw.get("remark"):
                failed += 1
                continue
            per_tile[key] = normalise_osm(raw.get("elements") or [])
            cache.setdefault("tiles", {})[key] = {"at": time.time(), "n": len(per_tile[key])}
            ok += 1
            _osm_save(conflict_id, cache)
        return {"fetched": ok, "failed": failed, "remaining": len(osm_stale_tiles(cache, tiles)),
                "elements": len(cache.get("elements") or [])}


# ── generation, end to end ───────────────────────────────────────────────

def region_of(conflict: dict, components: list[tuple]) -> tuple:
    """(w, s, e, n) to read signals in: the contact lines grown by the big
    reach, or the conflict's circle."""
    if components:
        from shapely.ops import unary_union
        w, s, e, n = unary_union([g for _l, g in components]).bounds
        pad_lat = REACH_BIG_KM / KM_PER_DEG
        pad_lon = REACH_BIG_KM / (KM_PER_DEG * math.cos(math.radians((s + n) / 2)))
        return (w - pad_lon, s - pad_lat, e + pad_lon, n + pad_lat)
    lat, lon = (conflict.get("center") or [0, 0])[:2]
    r = float(conflict.get("radius_km") or 800)
    dlat = r / KM_PER_DEG
    dlon = r / (KM_PER_DEG * max(0.1, math.cos(math.radians(lat))))
    return (lon - dlon, lat - dlat, lon + dlon, lat + dlat)


def build_candidates(ctx: Context, *, airports, ports, oil_terminals, plants, naval_bases, osm, changes) -> list[dict]:
    refineries = [e for e in osm if e.get("kind") == "refinery"]
    out = []
    out += airbase_candidates(ctx, airports)
    out += port_candidates(ctx, ports, naval_bases)
    out += strike_candidates(ctx, plants, oil_terminals, refineries)
    out += ground_base_candidates(ctx, osm)
    out += front_hotspot_candidates(ctx, changes)
    out += hot_candidates(ctx)
    return out


def sweep_plan_candidate(conflict: dict, theatre: dict, tiles: list[dict]) -> dict | None:
    """The one "Border sweep" proposal: accepting it starts the sweep. Its
    polygon is the bounding box of all tiles; it is never scanned itself."""
    if not tiles:
        return None
    w = min(t["bbox"][0] for t in tiles); s = min(t["bbox"][1] for t in tiles)
    e = max(t["bbox"][2] for t in tiles); n = max(t["bbox"][3] for t in tiles)
    bands: dict = {}
    for t in tiles:
        bands[t["band"]] = bands.get(t["band"], 0) + 1
    desc = "; ".join(f"{country_name(b.split('>')[0])} facing {country_name(b.split('>')[1])}: {k} tiles"
                     for b, k in bands.items())
    return {
        "key": f"sweep:{conflict['id']}", "subgroup": "Border sweep",
        "name": f"Border sweep — {conflict.get('name') or conflict['id']}",
        "lat": (s + n) / 2, "lon": (w + e) / 2, "bbox": (w, s, e, n), "score": 100.0,
        "parts": {"score": 100.0}, "distance_km": None, "contact": None, "signals": 0, "signal_weight": 0,
        "reason": (f"Sweep {len(tiles)} radar tiles of ~20 km, {SWEEP_BAND_MIN_KM:.0f}-{SWEEP_BAND_MAX_KM:.0f} km "
                   f"in from the border ({desc}), one or two per scheduler pass, to find unmapped "
                   "build-ups, camps and field positions"),
        "meta": {"tiles": len(tiles), "bands": bands},
    }


# ── the database side ────────────────────────────────────────────────────

def _meta(z) -> dict:
    try:
        return json.loads(z.zone_metadata) if z.zone_metadata else {}
    except (TypeError, ValueError):
        return {}


def existing_for(db, owner: str | None, include_unowned: bool = False) -> list[dict]:
    """The user's zones (plus the unowned legacy ones an admin also sees,
    so an admin is not offered a second zone on top of ZONE-001)."""
    from database import WatchZone
    from sqlalchemy import or_
    q = db.query(WatchZone)
    if owner is None:
        q = q.filter(WatchZone.owner.is_(None))
    elif include_unowned:
        q = q.filter(or_(WatchZone.owner == owner, WatchZone.owner.is_(None)))
    else:
        q = q.filter(WatchZone.owner == owner)
    out = []
    for z in q.all():
        m = _meta(z)
        out.append({"system_id": z.system_id, "status": z.status, "source_key": m.get("source_key"),
                    "generated_by": m.get("generated_by"), "conflict": m.get("conflict"),
                    "subgroup": m.get("subgroup"), "aoi_class": z.aoi_class,
                    "bbox": (z.bbox_min_lon, z.bbox_min_lat, z.bbox_max_lon, z.bbox_max_lat)
                    if None not in (z.bbox_min_lon, z.bbox_min_lat, z.bbox_max_lon, z.bbox_max_lat) else None})
    return out


def declined_keys(db, owner: str | None, conflict_id: str, days: int = 90) -> set:
    from database import OverwatchDeclined
    since = _dt.datetime.utcnow() - _dt.timedelta(days=days)
    q = db.query(OverwatchDeclined.source_key).filter(OverwatchDeclined.conflict == conflict_id,
                                                      OverwatchDeclined.declined_at >= since)
    q = q.filter(OverwatchDeclined.owner == owner) if owner is not None else q.filter(OverwatchDeclined.owner.is_(None))
    return {r[0] for r in q.all()}


def apply_selection(db, *, owner: str | None, conflict: dict, selection: dict, all_keys: set,
                    now: _dt.datetime | None = None) -> dict:
    """Write the chosen proposals: new rows (status=proposed, enabled=False
    — never scanned until accepted) or in-place updates of this
    generator's earlier proposals. Earlier DYNAMIC proposals (front
    hotspots, report clusters) that no longer appear at all are removed:
    they described a moment that has passed."""
    from database import WatchZone
    now = now or _dt.datetime.utcnow()
    group = _group_name(conflict)
    chosen = selection["chosen"]
    new = [c for c in chosen if not c.get("update")]
    ids = next_zone_ids([r[0] for r in db.query(WatchZone.system_id).all()], len(new))
    created, updated = [], []
    for c in chosen:
        sub = c["subgroup"]
        aoi_class, kind = AOI.get(sub, ("custom", "other"))
        kind = c["meta"].get("kind") or kind
        if sub == "Border sweep":
            aoi_class, kind = "sweep_plan", "other"
        meta = {"group": group, "subgroup": sub, "kind": kind, "reason": c["reason"], "score": c["score"],
                "score_parts": c.get("parts"), "generated_by": "overwatch", "conflict": conflict["id"],
                "source_key": c["key"], "distance_km": c.get("distance_km"), "contact": c.get("contact"),
                "signals_25km": c.get("signals"), "generated_at": now.isoformat(timespec="seconds"),
                **({"also": c["also"]} if c.get("also") else {}),
                **{k: v for k, v in (c.get("meta") or {}).items() if k != "kind"}}
        w, s, e, n = c["bbox"]
        if c.get("update"):
            z = db.query(WatchZone).filter(WatchZone.system_id == c["update"]).first()
            if z is None or z.status != "proposed":
                continue
            old = _meta(z)
            z.description = c["reason"]
            z.zone_metadata = json.dumps({**old, **meta})
            z.polygon_geojson = json.dumps(bbox_polygon(c["bbox"]))
            z.bbox_min_lon, z.bbox_min_lat, z.bbox_max_lon, z.bbox_max_lat = w, s, e, n
            z.priority = "high" if c["score"] >= 70 else "medium"
            updated.append(z.system_id)
            continue
        sid = ids.pop(0)
        db.add(WatchZone(
            system_id=sid, name=c["name"][:120], description=c["reason"],
            polygon_geojson=json.dumps(bbox_polygon(c["bbox"])),
            bbox_min_lon=w, bbox_min_lat=s, bbox_max_lon=e, bbox_max_lat=n,
            priority="high" if c["score"] >= 70 else "medium",
            scan_interval_hours=CADENCE_H.get(sub, DEFAULT_CADENCE_H),
            enabled=False, status="proposed", aoi_class=aoi_class, owner=owner, created_by=owner,
            created_at=now, next_scan_at=None, ml_tasks=json.dumps(tasks_for(sub)), alert_threshold="both",
            zone_metadata=json.dumps(meta),
            sensor_preference="sentinel1_sar" if sub == "Border sweep" else "sentinel2_optical",
        ))
        created.append(sid)

    pruned = []
    for e in existing_for(db, owner):
        if (e["generated_by"] == "overwatch" and e["status"] == "proposed" and e["conflict"] == conflict["id"]
                and e["subgroup"] in DYNAMIC_SUBGROUPS and e["source_key"] not in all_keys
                and e["system_id"] not in updated):
            z = db.query(WatchZone).filter(WatchZone.system_id == e["system_id"]).first()
            if z is not None:
                db.delete(z)
                pruned.append(e["system_id"])
    db.commit()
    return {"created": created, "updated": updated, "pruned": pruned}


def _group_name(conflict: dict) -> str:
    """The tree's top level: the conflict's short name ("Ukraine")."""
    cid = conflict.get("id") or ""
    return {"ukraine": "Ukraine", "israel_iran": "Israel–Iran", "drc": "DR Congo",
            "south_sudan": "South Sudan"}.get(cid, cid.replace("_", " ").title() or "Overwatch")


def proposals_query(db, owner: str | None, *, ids=None, group=None, subgroup=None, conflict=None):
    """The caller's overwatch proposals, narrowed by ids, group/subgroup or
    conflict."""
    from database import WatchZone
    q = db.query(WatchZone).filter(WatchZone.status == "proposed")
    q = q.filter(WatchZone.owner == owner) if owner is not None else q.filter(WatchZone.owner.is_(None))
    if ids:
        q = q.filter(WatchZone.system_id.in_(list(ids)))
    out = []
    for z in q.all():
        m = _meta(z)
        if not ids and m.get("generated_by") != "overwatch":
            continue
        if group and m.get("group") != group:
            continue
        if subgroup and m.get("subgroup") != subgroup:
            continue
        if conflict and m.get("conflict") != conflict:
            continue
        out.append(z)
    return out


def accept(db, owner: str | None, zones: list, now: _dt.datetime | None = None) -> dict:
    """Proposals → active. A site zone starts scanning on the scheduler's
    next pass (enabled=True, next_scan_at=now; the per-pass cap spreads a
    big acceptance over several passes). The "Border sweep" proposal is
    never scanned itself — accepting it starts the sweep instead."""
    now = now or _dt.datetime.utcnow()
    activated, sweeps = [], []
    for z in zones:
        if z.aoi_class == "sweep_plan":
            m = _meta(z)
            z.status = "active"
            z.enabled = False
            sweeps.append({"zone": z.system_id, "conflict": m.get("conflict")})
            continue
        z.status = "active"
        z.enabled = True
        z.next_scan_at = now
        activated.append(z.system_id)
    db.commit()
    return {"activated": activated, "sweeps": sweeps}


def decline(db, owner: str | None, zones: list, remember: bool = True) -> dict:
    """Delete proposals. remember=True (a real decline) keeps their source
    keys so a re-run does not offer them again; the voice command's Undo
    passes remember=False — taking back a generation is not a judgement on
    the places."""
    from database import OverwatchDeclined
    gone = []
    for z in zones:
        if z.status != "proposed":
            continue
        m = _meta(z)
        if remember and m.get("source_key") and m.get("conflict"):
            db.add(OverwatchDeclined(owner=owner, conflict=m["conflict"], source_key=m["source_key"]))
        gone.append(z.system_id)
        db.delete(z)
    db.commit()
    return {"declined": gone}


# ── sweep state ──────────────────────────────────────────────────────────

def sweep_for(db, owner: str | None, conflict_id: str):
    from database import OverwatchSweep
    q = db.query(OverwatchSweep).filter(OverwatchSweep.conflict == conflict_id)
    q = q.filter(OverwatchSweep.owner == owner) if owner is not None else q.filter(OverwatchSweep.owner.is_(None))
    return q.order_by(OverwatchSweep.id.desc()).first()


def start_sweep(db, owner: str | None, conflict_id: str, order: list[str], plan_zone: str | None = None):
    """Start (or resume) the user's sweep of one conflict with a fresh tile
    order. The sweep log carries over, so already-swept tiles stay skipped."""
    from database import OverwatchSweep
    s = sweep_for(db, owner, conflict_id)
    now = _dt.datetime.utcnow()
    if s is None:
        s = OverwatchSweep(conflict=conflict_id, owner=owner, created_at=now)
        db.add(s)
    s.status = "running"
    s.order_json = json.dumps(order)
    s.tiles_total = len(order)
    s.ordered_at = now
    s.last_error = None
    if plan_zone:
        s.plan_zone_id = plan_zone
    db.commit()
    return s


def set_sweep_status(db, owner: str | None, conflict_id: str, status: str):
    s = sweep_for(db, owner, conflict_id)
    if s is None:
        return None
    s.status = status
    db.commit()
    return s


def sweep_log(db, sweep_id: int | None = None, conflict_id: str | None = None, owner: str | None = None,
              limit: int | None = None) -> list[dict]:
    from database import OverwatchSweepTile as T
    q = db.query(T)
    if sweep_id is not None:
        q = q.filter(T.sweep_id == sweep_id)
    if conflict_id is not None:
        q = q.filter(T.conflict == conflict_id)
    if owner is not None:
        q = q.filter(T.owner == owner)
    q = q.order_by(T.scanned_at.desc())
    if limit:
        q = q.limit(limit)
    out = []
    for r in q.all():
        try:
            summ = json.loads(r.summary) if r.summary else {}
        except ValueError:
            summ = {"summary": r.summary}
        out.append({"tile_id": r.tile_id, "band": r.band, "bbox": [r.min_lon, r.min_lat, r.max_lon, r.max_lat],
                    "scanned_at": r.scanned_at.isoformat(timespec="seconds") if r.scanned_at else None,
                    "result": r.result, "summary": summ, "zone_id": r.zone_id})
    return out


def record_tile(db, sweep, tile: dict, verdict: dict, zone_id: str | None, now: _dt.datetime | None = None):
    from database import OverwatchSweepTile as T
    b = tile["bbox"]
    db.add(T(sweep_id=sweep.id if sweep is not None else None, conflict=sweep.conflict if sweep is not None else tile.get("conflict"),
             owner=sweep.owner if sweep is not None else None, tile_id=tile["tile_id"], band=tile.get("band"),
             min_lon=b[0], min_lat=b[1], max_lon=b[2], max_lat=b[3], scanned_at=now or _dt.datetime.utcnow(),
             result=verdict["result"], zone_id=zone_id,
             summary=json.dumps({"summary": verdict.get("summary"), "findings": verdict.get("findings", []),
                                 "metrics": verdict.get("metrics"), "title": verdict.get("title")})))
    db.commit()


def sweep_status(db, sweep, log: list[dict] | None = None) -> dict:
    if sweep is None:
        return {"status": "none"}
    log = log if log is not None else sweep_log(db, sweep_id=sweep.id)
    try:
        order = json.loads(sweep.order_json or "[]")
    except ValueError:
        order = []
    now = _dt.datetime.utcnow()
    fresh = {r["tile_id"] for r in log if not tile_is_due(r["tile_id"], [r], now)}
    found = [r for r in log if r["result"] == "found"]
    counts: dict = {}
    for r in log:
        counts[r["result"]] = counts.get(r["result"], 0) + 1
    return {
        "id": sweep.id, "conflict": sweep.conflict, "status": sweep.status,
        "tiles_total": len(order) or sweep.tiles_total, "tiles_done": len(fresh & set(order)) if order else len(fresh),
        "found": len(found), "results": counts, "current_tile": sweep.current_tile,
        "last_error": sweep.last_error, "plan_zone_id": sweep.plan_zone_id,
        "updated_at": sweep.updated_at.isoformat(timespec="seconds") if sweep.updated_at else None,
        "found_items": [{"tile_id": r["tile_id"], "zone_id": r["zone_id"], "scanned_at": r["scanned_at"],
                         "title": (r["summary"] or {}).get("title"), "summary": (r["summary"] or {}).get("summary")}
                        for r in found],
        # Every find and every tile of the sweep — they were cut at 20 and
        # 40; no cap (owner, 2026-10-17: "no cap on how many things we can actually recognise on the map")
        "recent": log,
    }


# ── orchestration (used by main.py's endpoints and the dry run) ──────────

_TILES_CACHE: dict = {}
_TILES_LOCK = threading.Lock()


def sweep_tiles_for(conflict: dict) -> list[dict]:
    """The conflict's sweep tiles, computed once per process (pure geometry
    over static borders)."""
    with _TILES_LOCK:
        hit = _TILES_CACHE.get(conflict["id"])
        if hit is None:
            hit = plan_sweep_tiles(theatre_for(conflict))
            _TILES_CACHE[conflict["id"]] = hit
        return hit


def front_inputs(theatre: dict) -> tuple:
    """(front line geometry, changes dict) for a theatre with a mapped front
    — DeepStateMap for Ukraine — else (None, None). Never raises."""
    if theatre.get("front") != "deepstate":
        return None, None
    try:
        import frontlines
        snap = frontlines.fetch()
        line = front_line_from_polygons(((snap.get("geojson") or {}).get("features") or []),
                                        country_shapes().get("ua"))
        ch = frontlines.changes(FRONT_DAYS)
        return line, ch
    except Exception as e:                                 # noqa: BLE001
        print(f"[overwatch] error: front line unavailable: {type(e).__name__}: {e}", flush=True)
        return None, None


def places_for(osm: list[dict], airports: list[dict]) -> list[dict]:
    """Named towns for "near X": OpenStreetMap's cities and towns, plus each
    airport's municipality placed at the airport — the latter counted as
    farther than it is (kind "airport_town"), so a real town wins."""
    places = [p for p in osm if p.get("kind") in ("city", "town") and p.get("name")]
    places += [{"kind": "airport_town", "name": a["municipality"], "lat": a["lat"], "lon": a["lon"]}
               for a in airports if a.get("municipality")]
    return places


def gather(db, conflict: dict, *, front=None, now: _dt.datetime | None = None) -> dict:
    """Everything a generation or a sweep needs to know about a conflict."""
    theatre = theatre_for(conflict)
    shapes = country_shapes()
    line, changes = front if front is not None else front_inputs(theatre)
    components = contact_components(theatre, line, shapes)
    region = region_of(conflict, components)
    signals = SignalIndex(load_signals(db, region, theatre.get("geoconfirmed_slug"), now))
    airports = load_airports(db, theatre["countries"])
    osm = load_osm(conflict["id"]).get("elements") or []
    ctx = Context(conflict, theatre, components, signals, places_for(osm, airports))
    return {"theatre": theatre, "components": components, "ctx": ctx, "changes": changes,
            "airports": airports, "osm": osm, "front_line": line, "region": region}


def generate(db, owner: str | None, conflict: dict, *, front=None, cap: int = MAX_PROPOSALS,
             now: _dt.datetime | None = None, include_unowned: bool = False) -> dict:
    """Propose overwatch zones for one conflict. Writes proposals only."""
    t0 = time.time()
    g = gather(db, conflict, front=front, now=now)
    ctx, theatre = g["ctx"], g["theatre"]
    ports, oil = load_ports(theatre["countries"])
    cands = build_candidates(ctx, airports=g["airports"], ports=ports, oil_terminals=oil,
                             plants=load_plants(theatre["countries"]),
                             naval_bases=load_naval_bases(theatre["countries"]),
                             osm=g["osm"], changes=g["changes"])
    tiles = sweep_tiles_for(conflict)
    plan = sweep_plan_candidate(conflict, theatre, tiles)
    if plan:
        cands.append(plan)
    existing = existing_for(db, owner, include_unowned)
    sel = select_proposals(cands, existing, declined_keys(db, owner, conflict["id"]), cap=cap)
    written = apply_selection(db, owner=owner, conflict=conflict, selection=sel,
                              all_keys={c["key"] for c in cands}, now=now)
    osm_cache = load_osm(conflict["id"])
    notes = []
    if not g["components"]:
        notes.append("No mapped border or front between this conflict's countries — distances are measured "
                     "from the conflict's centre, and there is no border to sweep.")
    if theatre.get("front") == "deepstate" and g["front_line"] is None:
        notes.append("The front line (DeepStateMap) could not be read — distances use the borders only "
                     "and there are no front hotspots this run.")
    if g["components"] and not osm_cache.get("tiles"):
        notes.append("Ground bases come from OpenStreetMap and are being fetched in the background — "
                     "run generate again in a few minutes to add them.")
    return {
        "conflict": conflict["id"], "group": _group_name(conflict),
        "created": written["created"], "updated": written["updated"], "pruned": written["pruned"],
        "report": sel["report"], "candidates": sel["candidates"], "cap": cap,
        "proposals": [{"system_id": None, "name": c["name"], "subgroup": c["subgroup"], "score": c["score"],
                       "reason": c["reason"], "lat": c["lat"], "lon": c["lon"], "update": c.get("update")}
                      for c in sel["chosen"]],
        "sweep_tiles": len(tiles), "signals": ctx.signals.n,
        "front_line": g["front_line"] is not None, "osm_elements": len(g["osm"]),
        "notes": notes, "took_s": round(time.time() - t0, 1),
    }


def sweep_order(db, conflict: dict, now: _dt.datetime | None = None) -> list[str]:
    """Tile ids of the conflict's sweep, most suspicious first (own signals
    near each tile, then nearest the border)."""
    tiles = sweep_tiles_for(conflict)
    if not tiles:
        return []
    w = min(t["bbox"][0] for t in tiles) - 0.5; s = min(t["bbox"][1] for t in tiles) - 0.3
    e = max(t["bbox"][2] for t in tiles) + 0.5; n = max(t["bbox"][3] for t in tiles) + 0.3
    theatre = theatre_for(conflict)
    sig = SignalIndex(load_signals(db, (w, s, e, n), theatre.get("geoconfirmed_slug"), now))
    return [t["tile_id"] for t in order_tiles(tiles, sig)]


def tile_by_id(conflict: dict, tile_id: str) -> dict | None:
    return next((t for t in sweep_tiles_for(conflict) if t["tile_id"] == tile_id), None)


def scan_budget(due: list, cap: int) -> tuple[list, list]:
    """(scan now, defer) — the scheduler's per-pass cap. `due` is already
    oldest-first, so a deferral waits one pass and is then at the front."""
    cap = max(0, int(cap))
    return list(due[:cap]), list(due[cap:])
