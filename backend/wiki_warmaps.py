"""
wiki_warmaps.py — control maps for the wars DeepStateMap does not cover.

I TOLD THE USER THESE DID NOT EXIST. That was wrong, and the correction
matters more than the feature: I probed four guessed REST URLs, found
nothing, and concluded no open source published control data for Sudan or
Yemen. Wikipedia has maintained community-edited war maps for well over a
decade — Syria, Lebanon, Yemen, Sudan, Libya, Mali, Myanmar, Somalia,
Central African Republic, Mozambique, Iraq, Nagorno-Karabakh — several
edited within the last week. They are not a REST API, which is why a
REST-shaped search missed them; they are Lua data modules reachable
through the MediaWiki API, which is fully open and has no key.

WHAT THIS GIVES AND WHAT IT DOES NOT. These are POINTS, not polygons:
"who holds this town", not a continuous line of control. Yemen carries
1,286 of them. That is a different and in some ways better primitive —
settlement-level and individually sourced — but it is not a front line
and is never drawn as one.

COLOUR MEANS A FACTION, AND WHICH FACTION DEPENDS ON THE WAR. Red is
Russia in Ukraine and the internationally-recognised government in Yemen.
So the colour is extracted and reported, and the legend is declared per
theatre where it is known from the module's own documentation. Where it
is not known this module says "faction A/B/C" rather than inventing
names — a confidently mislabelled faction is worse than an unlabelled one.

EDITORIAL PROVENANCE IS THE CAVEAT. This is Wikipedia: contested,
revert-prone and only as current as its last editor. Every response
carries the page and its last-edit timestamp so a reader can judge both.
"""
from __future__ import annotations

import json
import re
import time
import urllib.parse
import urllib.request

_UA = "HorizonWatch/2.0 (+https://github.com/ZaphodBeblerbox/Horizon-Watch)"
_API = "https://en.wikipedia.org/w/api.php"
_TIMEOUT = 40
_CACHE: dict = {}
_CACHE_TTL = 6 * 3600          # these are edited daily at most

SOURCE = "Wikipedia war map modules"

# Icon filename fragment -> the colour the editors used. Mapped from the
# real icon vocabulary observed in these modules rather than guessed.
_COLOUR_PATTERNS = [
    ("green",  re.compile(r"(green|lime|0d0)", re.I)),
    ("red",    re.compile(r"red", re.I)),
    ("blue",   re.compile(r"blue", re.I)),
    ("yellow", re.compile(r"(yellow|gold)", re.I)),
    ("purple", re.compile(r"(purple|violet)", re.I)),
    ("grey",   re.compile(r"(grey|gray|white)", re.I)),
    ("black",  re.compile(r"black", re.I)),
    ("orange", re.compile(r"orange", re.I)),
]

# What the colours mean, per war, from each module's own documentation.
# A theatre absent from here still renders; its factions are just reported
# by colour, which is honest, rather than by a name this module guessed.
THEATRES: dict[str, dict] = {
    "yemen": {
        "label": "Yemen",
        "module": "Module:Yemeni Civil War detailed map",
        "article": "Yemeni civil war (2014–present)",
        "legend": {"green": "Houthi (Ansar Allah)",
                   "red": "Yemeni government / coalition",
                   "blue": "Southern Transitional Council",
                   "grey": "AQAP / Islamic State",
                   "yellow": "Yemeni government / coalition",
                   "purple": "Southern Transitional Council",
                   "orange": "contested / mixed control",
                   "black": "Islamic State"},
    },
    "sudan": {
        "label": "Sudan",
        "module": "Module:2023 Sudanese Clashes detailed map",
        "article": "Sudanese civil war (2023–present)",
        "legend": {"red": "Sudanese Armed Forces",
                   "blue": "Rapid Support Forces",
                   "yellow": "SPLM–N (al-Hilu)",
                   "orange": "RSF and SPLM–N (allied)",
                   "purple": "SLM (al-Nur)",
                   "green": "Otoro rebel group",
                   "grey": "contested / unclear",
                   "black": "Islamic State"},
    },
    "syria": {
        "label": "Syria",
        "module": "Module:Syrian Civil War detailed map",
        "article": "Syrian civil war",
        "legend": {"yellow": "Syrian Democratic Forces",
                   "orange": "contested / mixed control",
                   "purple": "contested / mixed control"},
    },
    "lebanon": {
        "label": "Lebanon",
        "module": "Module:Lebanese insurgency detailed map",
        "article": "Lebanese insurgency",
        "legend": {"green": "Lebanese Armed Forces",
                   "yellow": "Hezbollah",
                   "blue": "Israeli Defense Forces",
                   "red": "Israeli Defense Forces",
                   "grey": "contested / unclear",
                   "black": "Islamic State",
                   "orange": "contested / mixed control",
                   "purple": "contested / mixed control"},
    },
}

# ── theatres whose factions cannot be named ──────────────────────────────
#
# Asked to make sure there are no unnamed factions on the map. The
# guarantee is kept by NOT OFFERING a war whose colours cannot all be
# named, rather than by inventing names for them — an "unnamed faction
# (grey)" is merely unhelpful, but a confidently mislabelled belligerent
# on a control map is the worst output this system can produce.
#
# These four publish no legend in their module /doc and none in their
# article's infobox, and their icon palettes are not shared with a war
# that does. They are listed with that reason, the same way Gaza is
# listed as having no open control source at all.
UNNAMED_THEATRES: dict[str, dict] = {
    "myanmar": {"label": "Myanmar",
                "module": "Module:Myanmar Civil War detailed map"},
    "libya": {"label": "Libya",
              "module": "Module:Libyan Civil War detailed map"},
    "somalia": {"label": "Somalia",
                "module": "Module:Somali Civil War detailed map"},
    "mali": {"label": "Mali / Sahel",
             "module": "Module:Mali War detailed map"},
}

NO_LEGEND_REASON = ("faction legend is not published for this war — the map "
                    "exists but its colours cannot be named, and a guessed "
                    "belligerent is worse than none")

# One Lua table row: { lat = "14.799", long = "42.949", mark = "...", label = "..." }
_MARK = re.compile(
    r"\{\s*lat\s*=\s*\"?(-?\d+(?:\.\d+)?)\"?\s*,\s*long\s*=\s*\"?(-?\d+(?:\.\d+)?)\"?"
    r"(?P<rest>[^{}]*)\}", re.I)
_MARK_FILE = re.compile(r"mark\s*=\s*\"([^\"]+)\"", re.I)
_LABEL = re.compile(r"label\s*=\s*\"([^\"]*)\"", re.I)


def _get(params: dict):
    url = f"{_API}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=_TIMEOUT) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def _colour_of(icon: str) -> str | None:
    for name, pat in _COLOUR_PATTERNS:
        if pat.search(icon or ""):
            return name
    return None


def _clean_label(raw: str) -> str | None:
    """Wikilinks to plain text: "[[Nyala, Sudan#History|Nyala]]" -> "Nyala"."""
    if not raw:
        return None
    s = re.sub(r"\[\[([^\]|]*\|)?([^\]]*)\]\]", r"\2", raw)
    s = re.sub(r"<[^>]+>", "", s)
    s = s.split("#")[0].strip()
    return s or None


def parse_marks(wikitext: str) -> list[dict]:
    """Every control mark in a module's data, as points."""
    out = []
    for m in _MARK.finditer(wikitext or ""):
        rest = m.group("rest")
        icon = (_MARK_FILE.search(rest) or [None, ""])[1] if _MARK_FILE.search(rest) else ""
        colour = _colour_of(icon)
        if not colour:
            continue                      # a mark with no faction colour is decoration
        label = _clean_label((_LABEL.search(rest).group(1)) if _LABEL.search(rest) else "")
        try:
            lat, lon = float(m.group(1)), float(m.group(2))
        except ValueError:
            continue
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        out.append({"lat": lat, "lon": lon, "colour": colour,
                    "label": label, "icon": icon})
    return out


def fetch(theatre: str, force: bool = False) -> dict:
    """Control points for one theatre. Never raises."""
    spec = THEATRES.get(theatre)
    if not spec:
        return {"available": False, "error": f"unknown theatre: {theatre}",
                "points": []}

    hit = _CACHE.get(theatre)
    if hit and not force and time.time() - hit["ts"] < _CACHE_TTL:
        return hit["data"]

    try:
        d = _get({"action": "query", "prop": "revisions",
                  "rvprop": "content|timestamp", "rvslots": "main",
                  "format": "json", "titles": spec["module"]})
        page = list(d["query"]["pages"].values())[0]
        if "revisions" not in page:
            raise RuntimeError("module page not found")
        rev = page["revisions"][0]
        text = rev["slots"]["main"]["*"]
        edited = rev.get("timestamp")
    except Exception as e:                                  # noqa: BLE001
        stale = hit["data"] if hit else None
        if stale:
            return {**stale, "stale": True, "error": f"{type(e).__name__}: {e}"}
        return {"available": False, "error": f"{type(e).__name__}: {e}",
                "theatre": theatre, "points": []}

    points = parse_marks(text)
    # The editors' own legend first; the curated table only fills gaps it
    # leaves, and is marked as such so a wrong name is traceable to me
    # rather than to Wikipedia.
    published = fetch_legend(theatre)
    curated = spec.get("legend") or {}
    # THE ARTICLE LEGEND IS NOT USED TO NAME ICON COLOURS, and the attempt
    # is left here as a warning. An article's {{leftlegend}} describes the
    # STATIC SVG map, which uses a different palette from the module's
    # icons: Sudan's SAF is #FFCDCD, a pale pink, which nearest-RGB
    # bucketed to "yellow" and so labelled every yellow icon — SPLM–N —
    # as the Sudanese Armed Forces. Two palettes for two maps; matching
    # one against the other is a category error that produces a confident
    # wrong belligerent, which is the worst output this file can make.
    #
    # Only the module's own /doc legend describes these icons, and the
    # curated table fills what it leaves.
    legend = {**curated, **published}
    legend_source = {c: ("module /doc" if c in published else "curated")
                     for c in legend}
    colours = sorted({p["colour"] for p in points})
    for p in points:
        # Named only where the module's own documentation says so.
        p["faction"] = legend.get(p["colour"])

    data = {
        "available": bool(points),
        "theatre": theatre,
        "label": spec["label"],
        "points": points,
        "count": len(points),
        "colours": colours,
        "legend": legend,
        "legend_source": legend_source,
        "unlabelled_colours": [c for c in colours if c not in legend],
        "source": SOURCE,
        "source_url": f"https://en.wikipedia.org/wiki/{urllib.parse.quote(spec['module'])}",
        "last_edited": edited,
        # What a reader has to hold in mind to use this honestly.
        "caveat": ("settlement-level control points, not a continuous front "
                   "line; community-edited on Wikipedia, so as current and as "
                   "contested as its last editor"),
        "stale": False,
        "error": None,
    }
    _CACHE[theatre] = {"ts": time.time(), "data": data}
    return data


# ── reading each war's own legend ────────────────────────────────────────
#
# The faction names were hand-written from memory, which on a control map
# is the same class of mistake as a mislabelled port photo: confident,
# plausible and unverifiable by the reader. Every one of these modules
# ships a legend table in its /doc page — a faction in one cell followed
# by that faction's icon set — so the names can be READ rather than
# recalled, and they update when the editors change them.
#
#   |-
#   |[[Assadism|Assadist]] forces and [[Russian Armed Forces]]
#   |[[File:Location dot red.svg|11px]]
#   |[[File:Abm-red-icon.png|13px]]
#
_ROW = re.compile(r"^\|-\s*$", re.M)
_CELL = re.compile(r"^\|(.*)$", re.M)
_FILE_IN = re.compile(r"\[\[File:([^|\]]+)", re.I)


def _plain(wikitext: str) -> str:
    t = re.sub(r"\[\[([^\]|]*\|)?([^\]]*)\]\]", r"\2", wikitext or "")
    t = re.sub(r"\{\{[^}]*\}\}", "", t)
    t = re.sub(r"<[^>]+>", "", t)
    return t.strip(" |")


def parse_legend(doc_wikitext: str) -> dict:
    """{colour: faction} from a module's /doc legend table.

    A row only counts when it names something AND carries icons whose
    colours agree — a row whose icons span three colours is a mixed- or
    contested-control key, not a faction, and naming a colour from it
    would mislabel everything drawn in that colour.
    """
    legend: dict = {}
    for block in _ROW.split(doc_wikitext or ""):
        cells = [c for c in _CELL.findall(block)]
        if len(cells) < 2:
            continue
        name = _plain(cells[0])
        if not name or len(name) > 90 or _FILE_IN.search(cells[0]):
            continue
        # Template parameters leak into these tables ("type = notice",
        # "image = ..."). A faction name is prose, not an assignment.
        if "=" in name or name.lower().startswith(("type", "image", "text", "style")):
            continue
        colours = {c for c in
                   (_colour_of(m.group(1)) for cell in cells[1:]
                    for m in _FILE_IN.finditer(cell)) if c}
        if len(colours) != 1:
            continue
        colour = colours.pop()
        legend.setdefault(colour, name)
    return legend


# Some wars publish the legend on the ARTICLE instead, against the static
# SVG's palette rather than the module's icon names:
#     {{leftlegend|#FFCDCD|Controlled by [[Sudanese Armed Forces]]}}
# Those hexes are bucketed into the same colour names the icons are, so
# both routes speak one vocabulary.
_ART_LEGEND = re.compile(
    r"\{\{\s*(?:left)?legend\s*\|\s*(#[0-9a-fA-F]{3,8})\s*\|([^}]*)\}\}", re.I)

_BUCKETS = {
    "red": (220, 60, 60), "green": (40, 160, 70), "blue": (50, 110, 220),
    "yellow": (225, 205, 80), "orange": (245, 150, 70), "purple": (170, 100, 200),
    "grey": (150, 150, 150), "black": (35, 35, 35),
}


def _hex_bucket(hx: str) -> str | None:
    """The named colour a hex is closest to, in the same vocabulary as icons."""
    h = (hx or "").lstrip("#")
    if len(h) in (4, 8):
        h = h[:-1] if len(h) == 4 else h[:6]
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) != 6:
        return None
    try:
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    except ValueError:
        return None
    best, bestd = None, None
    for name, (br, bg, bb) in _BUCKETS.items():
        d = (r - br) ** 2 + (g - bg) ** 2 + (b - bb) ** 2
        if bestd is None or d < bestd:
            best, bestd = name, d
    return best


def parse_article_legend(wikitext: str) -> dict:
    """{colour: faction} from an article's control legend."""
    out: dict = {}
    for m in _ART_LEGEND.finditer(wikitext or ""):
        label = _plain(m.group(2))
        if not re.search(r"control", label, re.I):
            continue        # supply/support maps use the same template
        colour = _hex_bucket(m.group(1))
        if not colour:
            continue
        name = re.sub(r"^controlled by\s+", "", label, flags=re.I).strip()
        out.setdefault(colour, name[:90])
    return out


def fetch_article_legend(theatre: str) -> dict:
    spec = THEATRES.get(theatre) or {}
    art = spec.get("article")
    if not art:
        return {}
    key = f"artlegend:{theatre}"
    hit = _CACHE.get(key)
    if hit and time.time() - hit["ts"] < _CACHE_TTL:
        return hit["data"]
    try:
        d = _get({"action": "query", "prop": "revisions", "rvprop": "content",
                  "rvslots": "main", "format": "json", "redirects": 1, "titles": art})
        page = list(d["query"]["pages"].values())[0]
        text = page["revisions"][0]["slots"]["main"]["*"]
    except Exception as ex:                                 # noqa: BLE001
        print(f"[warmaps] article legend {theatre}: {type(ex).__name__}: {ex}")
        return hit["data"] if hit else {}
    out = parse_article_legend(text)
    _CACHE[key] = {"ts": time.time(), "data": out}
    return out


def fetch_legend(theatre: str) -> dict:
    """The legend a war's editors actually published, or {}."""
    spec = THEATRES.get(theatre)
    if not spec:
        return {}
    key = f"legend:{theatre}"
    hit = _CACHE.get(key)
    if hit and time.time() - hit["ts"] < _CACHE_TTL:
        return hit["data"]
    try:
        d = _get({"action": "query", "prop": "revisions", "rvprop": "content",
                  "rvslots": "main", "format": "json", "redirects": 1,
                  "titles": spec["module"] + "/doc"})
        page = list(d["query"]["pages"].values())[0]
        text = page["revisions"][0]["slots"]["main"]["*"]
    except Exception as ex:                                 # noqa: BLE001
        print(f"[warmaps] legend {theatre}: {type(ex).__name__}: {ex}")
        return hit["data"] if hit else {}
    out = parse_legend(text)
    _CACHE[key] = {"ts": time.time(), "data": out}
    return out


def theatres() -> list[dict]:
    """Every war this module knows, named ones first.

    A theatre with an incomplete legend is reported as unavailable with
    its reason rather than omitted, so the UI can say why a war a reader
    knows about is missing.
    """
    out = [{"key": k, "label": v["label"], "module": v["module"],
            "available": True, "legend": v.get("legend") or {}}
           for k, v in THEATRES.items()]
    out += [{"key": k, "label": v["label"], "module": v["module"],
             "available": False, "reason": NO_LEGEND_REASON, "legend": {}}
            for k, v in UNNAMED_THEATRES.items()]
    return out


# ── points into areas ────────────────────────────────────────────────────
#
# Asked for these to render as polygons in the same style as Ukraine's.
# The source gives POINTS, so the areas are DERIVED and that is a real
# difference worth keeping visible: DeepStateMap's Ukraine polygons are
# drawn by an analyst who decided where the line runs, whereas these are
# computed by asking, for every spot on the map, which control point is
# nearest. Nobody asserted the boundary — it is the midline between two
# towns held by different sides, which is a reasonable estimate of a front
# and is not a survey of one.
#
# Voronoi rather than buffered discs: discs leave holes between towns and
# overlap where factions interleave, so the map would show gaps that mean
# "no data" and overlaps that mean nothing at all. A Voronoi tessellation
# partitions the ground exactly once, which is the right claim — every
# place is nearest to somebody.
#
# shapely, not scipy: scipy is installed here but absent from
# requirements.txt, so depending on it would work locally and fail on
# deploy. shapely 2.1 has voronoi_polygons and is already declared.

# How far beyond the outermost control point a faction may claim. Without
# a bound the tessellation runs to infinity and one faction appears to
# hold an ocean.
CLAIM_RADIUS_DEG = 0.45

# How tightly the claim area hugs the control points. 0 is maximally
# concave and 1 is the convex hull; this is loose enough to bridge normal
# gaps between towns and tight enough not to annex a sea.
CONCAVE_RATIO = 0.25

# Below this a cell is a rendering artefact rather than territory.
MIN_CELL_AREA_DEG2 = 1e-6


def polygons(theatre: str, force: bool = False) -> dict:
    """Faction areas derived from a theatre's control points."""
    data = fetch(theatre, force=force)
    if not data.get("available"):
        return {**data, "geojson": {"type": "FeatureCollection", "features": []}}

    try:
        import shapely
        from shapely.geometry import MultiPoint, Point, mapping
        from shapely.ops import unary_union
    except Exception as e:                                  # noqa: BLE001
        return {**data, "geojson": {"type": "FeatureCollection", "features": []},
                "polygon_error": f"shapely unavailable: {e}"}

    pts, factions = [], []
    seen = set()
    for p in data.get("points") or []:
        key = (round(p["lon"], 5), round(p["lat"], 5))
        if key in seen:
            continue            # duplicate coordinates break the tessellation
        seen.add(key)
        pts.append(Point(p["lon"], p["lat"]))
        factions.append((p.get("faction"), p.get("colour")))

    if len(pts) < 3:
        return {**data, "geojson": {"type": "FeatureCollection", "features": []},
                "polygon_error": "too few distinct points to tessellate"}

    mp = MultiPoint(pts)
    # The area anyone may claim at all: the theatre's outline, fattened.
    # Anything outside it is ground no editor has said a word about.
    #
    # The convex hull rather than a buffer of all 7,576 points. Buffering
    # the points produces a polygon with thousands of arcs, and then every
    # single cell is intersected against it — which is what made Syria run
    # past two minutes. The hull costs a little accuracy in concave
    # coastline, and the alternative was the feature not existing.
    try:
        # CONCAVE, not convex. The convex hull spans every bay and strait
        # between the outermost towns, so Yemen's government faction
        # appeared to hold several thousand square kilometres of the Gulf
        # of Aden — a straight diagonal edge across open water, which is
        # both obviously wrong and exactly the kind of confident-looking
        # error a control map must not make. A concave hull follows where
        # the towns actually are.
        envelope = shapely.concave_hull(mp, ratio=CONCAVE_RATIO).buffer(CLAIM_RADIUS_DEG)
        if envelope.is_empty:
            raise ValueError("empty concave hull")
    except Exception:                                       # noqa: BLE001
        # Degenerate point sets (collinear, tiny) have no concave hull.
        envelope = mp.convex_hull.buffer(CLAIM_RADIUS_DEG)

    try:
        # ordered=True returns one cell per input point IN INPUT ORDER.
        # Without it the cells come back unordered and each has to be
        # matched to its generator by a contains() scan — which is
        # quadratic and took Syria's 7,576 points past two minutes, on a
        # thread that must never block. With it the match is an index.
        cells = shapely.voronoi_polygons(mp, extend_to=envelope.envelope,
                                         ordered=True)
    except Exception as e:                                  # noqa: BLE001
        return {**data, "geojson": {"type": "FeatureCollection", "features": []},
                "polygon_error": f"tessellation failed: {e}"}

    by_faction: dict = {}
    geoms = list(cells.geoms)
    if len(geoms) != len(pts):
        return {**data, "geojson": {"type": "FeatureCollection", "features": []},
                "polygon_error": (f"tessellation returned {len(geoms)} cells for "
                                  f"{len(pts)} points — refusing to guess which "
                                  f"belongs to whom")}
    for i, cell in enumerate(geoms):
        clipped = cell.intersection(envelope)
        if clipped.is_empty or clipped.area < MIN_CELL_AREA_DEG2:
            continue
        by_faction.setdefault(factions[i], []).append(clipped)

    features = []
    for (faction, colour), geoms in by_faction.items():
        try:
            # coverage_union_all, not unary_union. Voronoi cells are a
            # COVERAGE — they tile the plane without overlapping and share
            # exact edges — and shapely has a dedicated path for that which
            # does not have to compute intersections it knows are empty.
            # unary_union over Syria's 7,576 cells ran past two minutes and
            # was killed; this is the difference between a feature and an
            # outage.
            try:
                merged = shapely.coverage_union_all(geoms)
            except Exception:                               # noqa: BLE001
                # Not a valid coverage (duplicate or slightly-off edges).
                # Fall back rather than lose the faction entirely.
                merged = unary_union(geoms)
            # Simplified because a dissolved tessellation carries every
            # midline vertex, and a browser drawing thousands of them per
            # faction will not thank us for precision it cannot show.
            merged = merged.simplify(0.01, preserve_topology=True)
        except Exception:                                   # noqa: BLE001
            continue
        if merged.is_empty:
            continue
        features.append({
            "type": "Feature",
            "geometry": mapping(merged),
            "properties": {
                "faction": faction,
                "colour": colour,
                "derived": True,
                "how": ("nearest-control-point areas, dissolved by faction — "
                        "the boundary is computed, not asserted by anyone"),
            },
        })

    return {
        **data,
        "geojson": {"type": "FeatureCollection", "features": features},
        "polygon_count": len(features),
        "polygon_error": None,
    }
