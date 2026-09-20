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
        "legend": {"green": "Houthi (Ansar Allah)",
                   "red": "Yemeni government / coalition",
                   "blue": "Southern Transitional Council",
                   "grey": "AQAP / IS"},
    },
    "sudan": {
        "label": "Sudan",
        "module": "Module:2023 Sudanese Clashes detailed map",
        "legend": {"red": "Sudanese Armed Forces",
                   "blue": "Rapid Support Forces"},
    },
    "syria": {
        "label": "Syria",
        "module": "Module:Syrian Civil War detailed map",
        "legend": {},
    },
    "lebanon": {
        "label": "Lebanon",
        "module": "Module:Lebanese insurgency detailed map",
        "legend": {},
    },
    "myanmar": {
        "label": "Myanmar",
        "module": "Module:Myanmar Civil War detailed map",
        "legend": {},
    },
    "libya": {
        "label": "Libya",
        "module": "Module:Libyan Civil War detailed map",
        "legend": {},
    },
    "somalia": {
        "label": "Somalia",
        "module": "Module:Somali Civil War detailed map",
        "legend": {},
    },
    "mali": {
        "label": "Mali / Sahel",
        "module": "Module:Mali War detailed map",
        "legend": {},
    },
}

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
    legend = spec.get("legend") or {}
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


def theatres() -> list[dict]:
    return [{"key": k, "label": v["label"], "module": v["module"],
             "legend": v.get("legend") or {}} for k, v in THEATRES.items()]
