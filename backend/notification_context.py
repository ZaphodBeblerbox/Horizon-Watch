"""
notification_context.py — a notification has to say what happened, where, and
why it is on your screen.

WHY THIS MODULE EXISTS
----------------------
Two real alert families in this system were shipping titles that carry no
information at all:

  * GeoConfirmed placemarks arrive with `name` set to the publication date,
    so 3,305 active alerts were titled "02 SEP 2026" — while the real prose
    ("Moment of the earthquake at Caracas") sat unread in `description`.
  * Sanctioned-vessel hits were titled "SANCTIONED: NAUTILUS detected",
    naming a hull nobody recognises and dropping the three facts that make
    it actionable: where it is, whose flag it flies, and who listed it —
    all of which were already in hand at title time.

So this module owns one job: turn the facts an alert already has into a
sentence a human can act on, and decide whether that sentence has earned an
interruption.

THE TWO DECISIONS ARE SEPARATE, AND STAY SEPARATE
-------------------------------------------------
`headline()` is a pure improvement — every alert gets a better title, none
are lost. `notification_relevance()` decides only whether the alert also
raises a NOTIFICATION. Nothing is ever suppressed at the alert layer: all
40,318 sanctioned-vessel alerts are still written, still queryable, still on
the map. What changes is that a tanker sitting in Singapore roads because it
is on a US screening list no longer pushes a card, while the same hull
entering the Gulf of Finland does. Merging those two decisions is how an
alert system becomes a mute button.

WHAT THIS MODULE WILL NOT CLAIM
-------------------------------
It does not resolve EEZs. `geo/eez.geojson` in this repo is MarineRegions'
*boundary lines*, not country polygons, so "the EEZ of Denmark" is not
derivable from it and is not asserted. What IS derivable and is used: a
named-waters gazetteer (below), the chokepoint polygons main.py already
maintains, and the StrategicZone/WatchZone bboxes already in the database.
The label says "in the Gulf of Finland", which is true, rather than "in
Finland's EEZ", which would be a guess wearing a uniform.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
import threading
import time
from typing import Any, Iterable, Optional

log = logging.getLogger("notification_context")


# ═══════════════════════════════════════════════════════════════════════════
# 1. NAMED WATERS
# ═══════════════════════════════════════════════════════════════════════════
# A gazetteer, not a geometry engine. Each entry is a coarse bbox for a named
# sea area plus the coastal states that make the name mean something. Ordered
# most-specific first: the first containing entry wins, so the Gulf of Finland
# beats the Baltic Sea and the Strait of Hormuz beats the Persian Gulf.
#
# `watched` marks waters where a sanctioned hull is inherently newsworthy —
# chokepoints, contested seas, and the approaches to active theatres. It is
# the first of the three relevance gates in notification_relevance().

_W = lambda name, lat0, lon0, lat1, lon1, states, watched=False: {   # noqa: E731
    "name": name, "bbox": (lat0, lon0, lat1, lon1),
    "states": states, "watched": watched,
}

WATERS: list[dict] = [
    # ── Chokepoints and narrow seas (most specific) ──────────────────────
    _W("the Strait of Hormuz",      25.4,  54.3,  27.3,  57.3, ["Iran", "Oman", "UAE"], True),
    _W("the Bab el-Mandeb Strait",  11.5,  42.2,  13.8,  44.3, ["Yemen", "Djibouti", "Eritrea"], True),
    _W("the Suez Canal",            29.8,  32.1,  31.4,  32.8, ["Egypt"], True),
    _W("the Turkish Straits",       40.2,  26.0,  41.4,  29.6, ["Türkiye"], True),
    _W("the Kerch Strait",          44.9,  36.2,  45.6,  36.8, ["Russia", "Ukraine"], True),
    _W("the Strait of Malacca",      0.8,  98.0,   6.5, 104.5, ["Indonesia", "Malaysia", "Singapore"], True),
    _W("the Singapore Strait",        1.0, 103.4,   1.5, 104.5, ["Singapore", "Indonesia", "Malaysia"], True),
    _W("the Taiwan Strait",         22.0, 117.5,  26.5, 121.5, ["Taiwan", "China"], True),
    _W("the Strait of Gibraltar",   35.7,  -6.1,  36.3,  -5.1, ["Spain", "Morocco"], True),
    _W("the Danish Straits",        54.5,   9.5,  58.0,  13.2, ["Denmark", "Sweden", "Germany"], True),
    _W("the Gulf of Finland",       58.8,  21.8,  60.8,  30.4, ["Finland", "Estonia", "Russia"], True),
    _W("the Gulf of Aden",          10.0,  43.0,  15.5,  52.0, ["Yemen", "Somalia", "Djibouti"], True),
    _W("the Gulf of Oman",          22.5,  56.5,  26.5,  62.0, ["Oman", "Iran", "Pakistan", "UAE"], True),
    _W("the Gulf of Sidra",         30.0,  15.0,  33.5,  20.5, ["Libya"]),
    _W("the Sea of Azov",           45.2,  34.8,  47.4,  39.5, ["Russia", "Ukraine"], True),
    _W("the Korea Strait",          33.0, 127.0,  36.0, 131.0, ["South Korea", "Japan"]),

    # ── Seas and gulfs ───────────────────────────────────────────────────
    _W("the Baltic Sea",            53.5,   9.5,  66.0,  30.5,
       ["Sweden", "Finland", "Estonia", "Latvia", "Lithuania", "Poland", "Germany", "Denmark", "Russia"], True),
    _W("the Black Sea",             40.8,  27.3,  47.4,  42.0,
       ["Ukraine", "Russia", "Türkiye", "Romania", "Bulgaria", "Georgia"], True),
    _W("the Persian Gulf",          23.5,  47.5,  30.5,  56.5,
       ["Iran", "Iraq", "Kuwait", "Saudi Arabia", "Qatar", "UAE", "Bahrain"], True),
    _W("the Red Sea",               12.0,  32.0,  28.5,  43.5,
       ["Egypt", "Saudi Arabia", "Sudan", "Eritrea", "Yemen", "Israel", "Jordan"], True),
    _W("the East China Sea",        24.0, 119.0,  33.5, 131.0, ["China", "Japan", "South Korea", "Taiwan"]),
    _W("the South China Sea",        0.0, 105.0,  23.5, 121.0,
       ["China", "Vietnam", "Philippines", "Malaysia", "Brunei", "Indonesia", "Taiwan"], True),
    _W("the Sea of Japan",          34.0, 127.5,  50.0, 142.5, ["Japan", "South Korea", "North Korea", "Russia"], True),
    _W("the Yellow Sea",            32.0, 117.0,  41.0, 126.5, ["China", "North Korea", "South Korea"]),
    _W("the Barents Sea",           68.0,  16.0,  80.0,  60.0, ["Norway", "Russia"], True),
    _W("the Eastern Mediterranean", 30.0,  25.0,  37.5,  37.0,
       ["Greece", "Türkiye", "Cyprus", "Lebanon", "Israel", "Syria", "Egypt"], True),
    _W("the Central Mediterranean", 30.0,  10.0,  41.0,  25.0, ["Italy", "Malta", "Libya", "Tunisia", "Greece"]),
    _W("the Western Mediterranean", 34.0,  -6.0,  44.5,  10.0, ["Spain", "France", "Italy", "Algeria", "Morocco", "Tunisia"]),
    _W("the Adriatic Sea",          39.5,  12.0,  45.9,  20.0, ["Italy", "Croatia", "Albania", "Montenegro", "Slovenia"]),
    _W("the Aegean Sea",            35.0,  22.5,  41.0,  27.5, ["Greece", "Türkiye"]),
    _W("the Norwegian Sea",         62.0,  -5.0,  72.0,  20.0, ["Norway", "Iceland"]),
    _W("the North Sea",             51.0,  -4.5,  62.0,  10.0, ["UK", "Norway", "Netherlands", "Germany", "Denmark", "Belgium"]),
    _W("the English Channel",       48.5,  -6.0,  51.5,   2.0, ["UK", "France"]),
    _W("the Irish Sea",             51.0, -11.0,  56.0,  -2.5, ["UK", "Ireland"]),
    _W("the Bay of Biscay",         43.0, -10.0,  48.5,  -1.0, ["France", "Spain"]),
    _W("the Arabian Sea",            5.0,  52.0,  25.0,  75.0, ["Oman", "Yemen", "India", "Pakistan", "Somalia"]),
    _W("the Bay of Bengal",          5.0,  78.0,  23.0,  95.0, ["India", "Bangladesh", "Myanmar", "Sri Lanka"]),
    _W("the Gulf of Guinea",        -6.0,  -8.0,   7.0,  12.0, ["Nigeria", "Ghana", "Cameroon", "Gabon", "Côte d'Ivoire"]),
    _W("the Caribbean Sea",          8.0, -88.0,  23.0, -59.0, ["Venezuela", "Colombia", "Cuba", "Jamaica", "Panama"]),
    _W("the Gulf of Mexico",        18.0, -98.0,  31.0, -80.0, ["United States", "Mexico", "Cuba"]),
    _W("the Sea of Okhotsk",        45.0, 135.0,  62.0, 165.0, ["Russia", "Japan"]),
    _W("the Bering Sea",            52.0, 162.0,  66.0, -157.0, ["Russia", "United States"]),
    _W("the Kara Sea",              68.0,  55.0,  81.0, 100.0, ["Russia"], True),

    # ── Ocean basins (least specific — a fallback, never a headline) ─────
    _W("the North Atlantic",        20.0, -80.0,  66.0,  -5.0, []),
    _W("the South Atlantic",       -60.0, -70.0,  20.0,  20.0, []),
    _W("the Indian Ocean",         -45.0,  20.0,  25.0, 115.0, []),
    _W("the North Pacific",          0.0, 120.0,  60.0, -100.0, []),
    _W("the South Pacific",        -60.0, 140.0,   0.0,  -70.0, []),
]


# The gazetteer entries that ARE chokepoints. Severity must not depend on
# whether main.py's richer polygon table happens to be imported in this
# process — a hull transiting Hormuz is critical either way.
_CHOKEPOINT_WATERS = {
    "the Strait of Hormuz", "the Bab el-Mandeb Strait", "the Suez Canal",
    "the Turkish Straits", "the Kerch Strait", "the Strait of Malacca",
    "the Singapore Strait", "the Taiwan Strait", "the Strait of Gibraltar",
    "the Danish Straits", "the Korea Strait",
}


def _the(name: str) -> str:
    """main.py's chokepoint table names them bare ("Suez Canal") while the
    gazetteer carries the article ("the Suez Canal"). Reasons are shown to a
    human, so they read as English either way."""
    n = (name or "").strip()
    return n if not n or n.startswith("the ") else f"the {n}"


def named_waters(lat: float, lon: float) -> Optional[dict]:
    """First containing gazetteer entry, most-specific first. None off-index.

    Bboxes that cross the antimeridian (max_lon < min_lon) are handled — the
    Bering Sea and the North/South Pacific all do."""
    if lat is None or lon is None:
        return None
    try:
        lat = float(lat)
        lon = float(lon)
    except (TypeError, ValueError):
        return None
    for w in WATERS:
        lat0, lon0, lat1, lon1 = w["bbox"]
        if not (lat0 <= lat <= lat1):
            continue
        if lon0 <= lon1:
            if lon0 <= lon <= lon1:
                return w
        else:                       # crosses the antimeridian
            if lon >= lon0 or lon <= lon1:
                return w
    return None


# ═══════════════════════════════════════════════════════════════════════════
# 2. FLAG STATES
# ═══════════════════════════════════════════════════════════════════════════
# sanctioned_entities.flag holds lowercase ISO-3166 alpha-2 ('ru', 'lr',
# 'ck'). "Belonging to" in the analyst's sense is the flag state — the
# ownership columns (owner_chain, topics) are empty for every vessel row in
# production, so claiming an owner would be inventing one.

FLAG_NAMES: dict[str, str] = {
    "ae": "UAE", "af": "Afghanistan", "ag": "Antigua & Barbuda", "al": "Albania",
    "am": "Armenia", "ao": "Angola", "ar": "Argentina", "at": "Austria",
    "au": "Australia", "az": "Azerbaijan", "bb": "Barbados", "bd": "Bangladesh",
    "be": "Belgium", "bg": "Bulgaria", "bh": "Bahrain", "bm": "Bermuda",
    "bn": "Brunei", "bo": "Bolivia", "br": "Brazil", "bs": "Bahamas",
    "by": "Belarus", "bz": "Belize", "ca": "Canada", "cd": "DR Congo",
    "cg": "Congo", "ch": "Switzerland", "ci": "Côte d'Ivoire", "ck": "Cook Islands",
    "cl": "Chile", "cm": "Cameroon", "cn": "China", "co": "Colombia",
    "cr": "Costa Rica", "cu": "Cuba", "cv": "Cabo Verde", "cy": "Cyprus",
    "cz": "Czechia", "de": "Germany", "dj": "Djibouti", "dk": "Denmark",
    "dm": "Dominica", "do": "Dominican Republic", "dz": "Algeria", "ec": "Ecuador",
    "ee": "Estonia", "eg": "Egypt", "er": "Eritrea", "es": "Spain",
    "et": "Ethiopia", "fi": "Finland", "fj": "Fiji", "fr": "France",
    "ga": "Gabon", "gb": "UK", "ge": "Georgia", "gh": "Ghana",
    "gi": "Gibraltar", "gn": "Guinea", "gq": "Equatorial Guinea", "gr": "Greece",
    "gt": "Guatemala", "gy": "Guyana", "hk": "Hong Kong", "hn": "Honduras",
    "hr": "Croatia", "ht": "Haiti", "hu": "Hungary", "id": "Indonesia",
    "ie": "Ireland", "il": "Israel", "in": "India", "iq": "Iraq",
    "ir": "Iran", "is": "Iceland", "it": "Italy", "jm": "Jamaica",
    "jo": "Jordan", "jp": "Japan", "ke": "Kenya", "kh": "Cambodia",
    "ki": "Kiribati", "km": "Comoros", "kn": "St Kitts & Nevis", "kp": "North Korea",
    "kr": "South Korea", "kw": "Kuwait", "ky": "Cayman Islands", "kz": "Kazakhstan",
    "lb": "Lebanon", "lc": "St Lucia", "lk": "Sri Lanka", "lr": "Liberia",
    "lt": "Lithuania", "lu": "Luxembourg", "lv": "Latvia", "ly": "Libya",
    "ma": "Morocco", "md": "Moldova", "me": "Montenegro", "mg": "Madagascar",
    "mh": "Marshall Islands", "mm": "Myanmar", "mn": "Mongolia", "mt": "Malta",
    "mu": "Mauritius", "mv": "Maldives", "mx": "Mexico", "my": "Malaysia",
    "mz": "Mozambique", "na": "Namibia", "ng": "Nigeria", "ni": "Nicaragua",
    "nl": "Netherlands", "no": "Norway", "nz": "New Zealand", "om": "Oman",
    "pa": "Panama", "pe": "Peru", "pg": "Papua New Guinea", "ph": "Philippines",
    "pk": "Pakistan", "pl": "Poland", "pt": "Portugal", "pw": "Palau",
    "py": "Paraguay", "qa": "Qatar", "ro": "Romania", "rs": "Serbia",
    "ru": "Russia", "sa": "Saudi Arabia", "sc": "Seychelles", "sd": "Sudan",
    "se": "Sweden", "sg": "Singapore", "si": "Slovenia", "sk": "Slovakia",
    "sl": "Sierra Leone", "sn": "Senegal", "so": "Somalia", "sr": "Suriname",
    "ss": "South Sudan", "sv": "El Salvador", "sy": "Syria", "tg": "Togo",
    "th": "Thailand", "tj": "Tajikistan", "tm": "Turkmenistan", "tn": "Tunisia",
    "to": "Tonga", "tr": "Türkiye", "tt": "Trinidad & Tobago", "tv": "Tuvalu",
    "tw": "Taiwan", "tz": "Tanzania", "ua": "Ukraine", "ug": "Uganda",
    "us": "United States", "uy": "Uruguay", "uz": "Uzbekistan", "vc": "St Vincent",
    "ve": "Venezuela", "vn": "Vietnam", "vu": "Vanuatu", "ye": "Yemen",
    "za": "South Africa", "zw": "Zimbabwe",
}


def flag_country(code: Optional[str]) -> Optional[str]:
    """'ru' -> 'Russia'. Unknown or blank -> None (the caller then says
    nothing about the flag rather than printing a two-letter code at an
    analyst)."""
    if not code:
        return None
    c = str(code).strip().lower()
    if len(c) != 2:
        return None
    return FLAG_NAMES.get(c)


# ═══════════════════════════════════════════════════════════════════════════
# 3. SANCTIONING AUTHORITIES
# ═══════════════════════════════════════════════════════════════════════════
# The sanctions data names lists, not authorities: "EU Council Official
# Journal Sanctioned Entities", "Canadian Consolidated Autonomous Sanctions
# List". An analyst needs "listed by EU, Canada" — the jurisdiction, because
# that is what determines whether the listing bites. Prefix-matched against
# the real dataset names observed in production, longest prefix first.

_AUTHORITY_PREFIXES: list[tuple[str, str]] = [
    ("united arab emirates", "UAE"),
    ("new zealand", "New Zealand"),
    ("south africa", "South Africa"),
    ("australian", "Australia"),
    ("canadian", "Canada"),
    ("belgian", "Belgium"),
    ("french", "France"),
    ("monaco", "Monaco"),
    ("swiss", "Switzerland"),
    ("ukraine", "Ukraine"),
    ("taiwan", "Taiwan"),
    ("türkiye", "Türkiye"),
    ("turkiye", "Türkiye"),
    ("turkey", "Türkiye"),
    ("israel", "Israel"),
    ("qatar", "Qatar"),
    ("japan", "Japan"),
    ("us ", "US"),
    ("eu ", "EU"),
    ("uk ", "UK"),
]

# Raw dataset slugs also appear ('us_ofac_sdn,us_trade_csl', 'ua_war_sanctions').
_AUTHORITY_SLUGS: list[tuple[str, str]] = [
    ("us_", "US"), ("eu_", "EU"), ("gb_", "UK"), ("ua_", "Ukraine"),
    ("ch_", "Switzerland"), ("ca_", "Canada"), ("au_", "Australia"),
    ("jp_", "Japan"), ("nz_", "New Zealand"), ("fr_", "France"),
]


def _authority_for(list_name: str) -> Optional[str]:
    s = (list_name or "").strip().lower()
    if not s:
        return None
    for prefix, label in _AUTHORITY_PREFIXES:
        if s.startswith(prefix):
            return label
    for prefix, label in _AUTHORITY_SLUGS:
        if s.startswith(prefix):
            return label
    return None


def sanction_authorities(lists: Iterable[Any]) -> list[str]:
    """['EU Council Official Journal…', 'Canadian Consolidated…'] ->
    ['EU', 'Canada']. Order-preserving, deduplicated. A list whose authority
    cannot be identified is dropped rather than printed raw — the headline
    has room for jurisdictions, not for list titles."""
    out: list[str] = []
    for item in (lists or []):
        # Some rows carry several lists in one semicolon/comma-joined string.
        for part in re.split(r"[;,]", str(item)):
            a = _authority_for(part)
            if a and a not in out:
                out.append(a)
    return out


def _join_authorities(auths: list[str], limit: int = 3) -> str:
    """'EU, UK and Canada' / 'EU, UK, Canada and 4 others'."""
    if not auths:
        return ""
    if len(auths) <= limit:
        head, tail = auths[:-1], auths[-1]
        return f"{', '.join(head)} and {tail}" if head else tail
    shown = auths[:limit]
    return f"{', '.join(shown)} and {len(auths) - limit} others"


# ═══════════════════════════════════════════════════════════════════════════
# 4. PLACE
# ═══════════════════════════════════════════════════════════════════════════
# Three sources, cheapest first, none of them fatal if missing:
#   1. the named-waters gazetteer above (in-process, always available)
#   2. main.py's chokepoint polygons (precise, already maintained there)
#   3. StrategicZone / WatchZone bboxes from the database (what the operator
#      has actually told the system to care about)
#
# Zones are cached for _ZONE_TTL_S because they change on operator action,
# not on vessel movement, and this runs on every sanctions hit.

_ZONE_TTL_S = int(os.getenv("NOTIF_ZONE_CACHE_TTL_S", "300"))
_zone_cache: dict[str, Any] = {"at": 0.0, "strategic": [], "watch": []}
_zone_lock = threading.Lock()


def _load_zones() -> tuple[list[dict], list[dict]]:
    """(strategic, watch) as light bbox dicts. Failure returns empty lists —
    a zone lookup that cannot reach the database must degrade to "no zone",
    never raise into an alert-writing path."""
    now = time.time()
    with _zone_lock:
        if now - _zone_cache["at"] < _ZONE_TTL_S and _zone_cache["at"]:
            return _zone_cache["strategic"], _zone_cache["watch"]
    strategic: list[dict] = []
    watch: list[dict] = []
    try:
        from database import StrategicZone, WatchZone, get_db
        with get_db() as db:
            for z in db.query(StrategicZone).all():
                strategic.append({
                    "name": z.name, "kind": z.zone_type,
                    "severity": z.severity_baseline,
                    "bbox": (z.bbox_min_lat, z.bbox_min_lon, z.bbox_max_lat, z.bbox_max_lon),
                })
            for z in db.query(WatchZone).filter(WatchZone.enabled.is_(True)).all():
                watch.append({
                    "name": z.name, "kind": "WATCH_ZONE", "severity": z.priority,
                    "bbox": (z.bbox_min_lat, z.bbox_min_lon, z.bbox_max_lat, z.bbox_max_lon),
                })
    except Exception as e:                                  # pragma: no cover
        log.debug("[notif-ctx] zone load failed: %s", e)
    with _zone_lock:
        _zone_cache.update({"at": now, "strategic": strategic, "watch": watch})
    return strategic, watch


def _bbox_hit(lat: float, lon: float, zones: list[dict]) -> Optional[dict]:
    for z in zones:
        lat0, lon0, lat1, lon1 = z["bbox"]
        if lat0 is None or lon0 is None:
            continue
        if lat0 <= lat <= lat1 and lon0 <= lon <= lon1:
            return z
    return None


def _chokepoint(lat: float, lon: float) -> Optional[str]:
    """Containing chokepoint by main.py's own polygon_bounds, when main is
    already loaded.

    Deliberately reads sys.modules rather than importing: `import main` from
    here would boot the entire application — schedulers, fusion engine, the
    lot — for any caller that reached this module first. The gazetteer above
    already names every chokepoint in _CHOKEPOINT_DEFS; main's polygons only
    sharpen the boundary, so absent main this degrades to a coarser true
    answer instead of a side effect."""
    try:
        _m = sys.modules.get("main")
        if _m is None:
            return None
        for c in getattr(_m, "_CHOKEPOINT_DEFS", []):
            b = c.get("polygon_bounds")
            if not b or len(b) != 4:
                continue
            if b[0] <= lat <= b[2] and b[1] <= lon <= b[3]:
                return c.get("name")
    except Exception:                                       # pragma: no cover
        pass
    return None


def describe_place(lat: Any, lon: Any) -> dict:
    """Everything this system can honestly say about a point.

    Returns keys that are always present, so callers never guard:
      label      — "in the Gulf of Finland", or "" when nothing is known
      waters     — gazetteer name, or None
      chokepoint — precise chokepoint name, or None
      states     — coastal states of the named waters (may be empty)
      zone       — containing StrategicZone/WatchZone name, or None
      zone_kind  — that zone's type, or None
      watched    — the waters are inherently newsworthy
    """
    out = {"label": "", "waters": None, "chokepoint": None, "states": [],
           "zone": None, "zone_kind": None, "zone_severity": None, "watched": False}
    try:
        lat = float(lat)
        lon = float(lon)
    except (TypeError, ValueError):
        return out

    w = named_waters(lat, lon)
    if w:
        out["waters"] = w["name"]
        out["states"] = list(w["states"])
        out["watched"] = bool(w["watched"])

    cp = _chokepoint(lat, lon) or (w["name"] if w and w["name"] in _CHOKEPOINT_WATERS else None)
    if cp:
        out["chokepoint"] = cp
        out["watched"] = True

    strategic, watchz = _load_zones()
    z = _bbox_hit(lat, lon, strategic) or _bbox_hit(lat, lon, watchz)
    if z:
        out["zone"] = z["name"]
        out["zone_kind"] = z["kind"]
        out["zone_severity"] = z.get("severity")

    # The label prefers the most specific true thing, in that order.
    name = out["chokepoint"] or out["waters"]
    if name:
        out["label"] = name if name.startswith("the ") else f"the {name}"
        out["label"] = f"in {out['label']}"
    elif out["zone"]:
        out["label"] = f"in {out['zone']}"
    return out


# ═══════════════════════════════════════════════════════════════════════════
# 5. HEADLINES
# ═══════════════════════════════════════════════════════════════════════════

_DATE_TITLE = re.compile(
    r"""^\s*\d{1,2}\s*[-/ ]?\s*
        (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*
        \s*[-/ ]?\s*\d{2,4}\s*$""",
    re.IGNORECASE | re.VERBOSE,
)
_ISO_DATE_TITLE = re.compile(r"^\s*\d{4}-\d{2}-\d{2}\s*$")


def is_dateish_title(title: Optional[str]) -> bool:
    """True for '09 August 2026', '02 SEP 2026', '2026-08-09' — GeoConfirmed's
    placemark `name` is the publication date, which is why it must never be
    used as a headline."""
    if not title:
        return True
    t = title.strip()
    return bool(_DATE_TITLE.match(t) or _ISO_DATE_TITLE.match(t))


def _first_clause(text: str, limit: int = 110) -> str:
    """The first sentence of a description, trimmed to something that fits on
    a notification card without a scrollbar."""
    s = re.sub(r"\s+", " ", (text or "")).strip()
    if not s:
        return ""
    m = re.match(r"^(.{20,%d}?[.!?])(\s|$)" % limit, s)
    if m:
        return m.group(1).rstrip(".").strip()
    if len(s) <= limit:
        return s.rstrip(".").strip()
    cut = s[:limit].rsplit(" ", 1)[0]
    return cut.rstrip(" ,;:").rstrip(".") + "…"


def _place_phrase(*parts: Optional[str]) -> str:
    """'Caracas, Venezuela' from ('Caracas', 'Venezuela'), skipping blanks and
    refusing to repeat itself."""
    seen: list[str] = []
    for p in parts:
        p = (p or "").strip()
        if not p:
            continue
        if any(p.lower() == s.lower() for s in seen):
            continue
        seen.append(p)
    return ", ".join(seen)


# GeoConfirmed prefixes a description with the timecode of the moment in the
# source clip it is drawn from. Three real shapes occur in this database:
# "0:13 - ", "1:35-1:41 - " and "0:32-end - " (916 rows, 'end' in either
# case). The last was missed by the original pattern, which leaked a literal
# "end - " into the composed title.
_TIMECODE = re.compile(
    r"""^\s*\d{1,2}:\d{2}(?::\d{2})?
        (?:\s*[-–—]\s*(?:\d{1,2}:\d{2}(?::\d{2})?|end))?
        \s*[-–—]\s*""",
    re.IGNORECASE | re.VERBOSE,
)

# A description that is nothing but the citation is not prose. 6,109 active
# placemarks carry only source links ("https://twitter.com/... <br><br>Geo:
# <br>https://..."), and a title built from one is a URL on an analyst's
# screen — strictly worse than the date it replaced. Strip the markup and the
# links; if nothing is left, the caller falls back to the category noun.
# GeoConfirmed's older placemark names are archive filing lines:
# "01 SEP 2022 - PIC - A downed Ukrainian kamikaze drone fell on the roof…".
# 6,511 active placemarks carry one. The prose after the prefix is the best
# sentence on the record — these are exactly the placemarks whose description
# is nothing but a citation — but the prefix puts the publication date back
# at the front of the title, which is the whole defect §A3 exists to remove.
# The media token (PIC/VID/UAV/SAT…) indexes the medium, not the event.
_ARCHIVE_PREFIX = re.compile(
    r"""^\s*\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}\s*
        (?:[-–—:]\s*(?:PIC|VID|IMG|UAV|SAT|PHOTO|VIDEO|MAP|AUDIO)\s*)?
        [-–—:]\s*""",
    re.IGNORECASE | re.VERBOSE,
)

_MARKUP = re.compile(r"<[^>]{0,80}>")
_URL = re.compile(r"https?://\S+")
_GEO_LABEL = re.compile(r"\bgeo\s*:", re.IGNORECASE)


def strip_citation(text: Optional[str]) -> str:
    """The prose in a description, with HTML tags, bare URLs and the trailing
    'Geo:' citation label removed. Returns '' when the description was only a
    citation."""
    if not text:
        return ""
    s = _MARKUP.sub(" ", text)
    s = _URL.sub(" ", s)
    s = _GEO_LABEL.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip(" -–—,;:")


def geoconfirmed_headline(
    *,
    name: Optional[str] = None,
    description: Optional[str] = None,
    location: Optional[str] = None,
    country: Optional[str] = None,
    theatre_slug: Optional[str] = None,
    faction: Optional[str] = None,
) -> str:
    """"A car was reportedly hit by Russian FPV drone — Kherson, Kherson
    Oblast, Ukraine".

    The rule: `name` is used ONLY when it is not the publication date. In
    production it essentially always is — GeoConfirmed's placemark name IS
    the date — which is the defect this replaces: 3,305 active alerts titled
    "02 SEP 2026" while the real prose sat in `description`.

    Two things are stripped that would otherwise reach an analyst:
      * leading video timecodes ("0:13 - ", "1:35-1:41 - ", "0:32-end - ") —
        these index a source clip, not the event;
      * the citation itself — 6,109 placemarks carry a description that is
        only source links, and a URL is a worse title than the date it
        replaced;
      * the faction tag, which is frequently "Neutral" and, where it is not,
        merely repeats a belligerent the sentence already names.
    """
    def _prose(v):
        return _first_clause(_TIMECODE.sub("", _ARCHIVE_PREFIX.sub("", strip_citation(v))))

    what = ""
    if name and not is_dateish_title(name):
        what = _prose(name)
    if not what:
        what = _prose(description)
    if not what:
        what = "Confirmed incident"

    # `location` from the plus-code resolver is already fully qualified
    # ("Kherson, Kherson Oblast, Ukraine"), so appending the country again
    # produced "…, Ukraine, Ukraine". Only add what is not already said.
    place = (location or "").strip()
    # theatre_slug names the CONFLICT ("ukraine"), not the country the point
    # is in — appending it to a resolved Russian location produced
    # "Kursk Oblast, Russia, Ukraine". Only used when nothing else placed it.
    extra = (country or "").strip()
    if not place and not extra:
        extra = (theatre_slug or "").replace("-", " ").strip().title()
    if extra and extra.lower() not in place.lower():
        place = _place_phrase(place, extra)

    if place and place.split(",")[0].strip().lower() in what.lower():
        # The sentence already names the town; keep only the wider context.
        rest = [x.strip() for x in place.split(",")[1:]]
        place = ", ".join(rest)

    return f"{what} — {place}" if place else what


def sanctioned_vessel_headline(
    *,
    vessel_name: Optional[str],
    mmsi: Optional[str] = None,
    lat: Any = None,
    lon: Any = None,
    flag: Optional[str] = None,
    sanction_lists: Optional[Iterable[Any]] = None,
    place: Optional[dict] = None,
    confirmed: bool = True,
) -> tuple[str, str]:
    """(title, message) for a sanctions hit — the four facts that make it
    actionable, in the order an analyst reads them: what, where, whose, and
    on whose authority.

        "Sanctioned vessel NAUTILUS in the Gulf of Finland — Russia-flagged,
         listed by EU, UK and Canada"

    Falls back gracefully: an unplaceable hull still gets
    "Sanctioned vessel NAUTILUS — Russia-flagged, listed by EU", and a hull
    with no name at all is named by MMSI only as a last resort, never first.
    """
    p = place if place is not None else describe_place(lat, lon)
    name = (vessel_name or "").strip() or (f"MMSI {mmsi}" if mmsi else "Unidentified vessel")

    lead = "Sanctioned vessel" if confirmed else "Possible sanctions match"
    title = f"{lead} {name}"
    if p.get("label"):
        title += f" {p['label']}"
    elif p.get("zone"):
        title += f" in {p['zone']}"

    quals: list[str] = []
    fc = flag_country(flag)
    if fc:
        quals.append(f"{fc}-flagged")
    auths = sanction_authorities(sanction_lists or [])
    if auths:
        quals.append(f"listed by {_join_authorities(auths)}")
    if quals:
        title += " — " + ", ".join(quals)

    # The message carries what the title had to leave out: the hull number,
    # the coastal states whose waters these are, and any zone the point falls
    # inside. The title is for recognition; the message is for the decision.
    bits: list[str] = []
    if mmsi:
        bits.append(f"MMSI {mmsi}")
    if p.get("states"):
        bits.append("waters of " + ", ".join(p["states"][:4]))
    if p.get("zone") and p.get("zone") != p.get("waters"):
        kind = (p.get("zone_kind") or "").replace("_", " ").lower()
        bits.append(f"inside {p['zone']}" + (f" ({kind})" if kind else ""))
    if not confirmed:
        bits.append("flag does not match the sanctions record — needs review")
    message = title + (". " + "; ".join(bits) + "." if bits else ".")
    return title, message


def surge_headline(
    *,
    keyword: Optional[str] = None,
    article_type: Optional[str] = None,
    location_name: Optional[str] = None,
    location_country: Optional[str] = None,
    article_count: Any = None,
    baseline_count: Any = None,
    multiplier: Any = None,
    time_window_description: Optional[str] = None,
    headline: Optional[str] = None,
) -> str:
    """A surge is "more people are talking about X in Y than normally do".
    The headline has to carry the topic, the place, and the size of the jump,
    or it is just the word "surge" with a colour on it.

        "Reporting on drone strikes in Kharkiv, Ukraine up 4.2× — 38 items
         vs 9 typical, last 24h"
    """
    topic = (keyword or "").strip() or (article_type or "").strip() or "reporting"
    place = _place_phrase(location_name, location_country)
    head = f"Reporting on {topic}"
    if place:
        head += f" in {place}"
    try:
        mult = float(multiplier)
        head += f" up {mult:.1f}×"
    except (TypeError, ValueError):
        head += " surging"

    tail: list[str] = []
    try:
        ac = int(article_count)
        bc = int(baseline_count)
        tail.append(f"{ac} items vs {bc} typical")
    except (TypeError, ValueError):
        pass
    if time_window_description:
        tail.append(str(time_window_description).strip())
    if tail:
        head += " — " + ", ".join(tail)
    # A curated headline, where one exists, is the better sentence — keep it
    # as the trailing context rather than discarding either.
    if headline and headline.strip() and headline.strip().lower() not in head.lower():
        head += f". {headline.strip().rstrip('.')}."
    return head


def fusion_headline(
    *,
    title: Optional[str] = None,
    subtitle: Optional[str] = None,
    location_name: Optional[str] = None,
    location_country: Optional[str] = None,
    domains: Any = None,
    signal_count: Any = None,
    lat: Any = None,
    lon: Any = None,
) -> str:
    """A fusion point is several independent signals landing in one place. The
    headline must say how many, from which domains, and where — that
    coincidence IS the finding.

        "3 signals converging in the Gulf of Finland — AIS, SAR, news"
    """
    try:
        n = int(signal_count)
    except (TypeError, ValueError):
        n = 0

    doms: list[str] = []
    if isinstance(domains, str):
        try:
            doms = [str(d) for d in json.loads(domains)]
        except Exception:
            doms = [d.strip() for d in domains.split(",") if d.strip()]
    elif isinstance(domains, (list, tuple)):
        doms = [str(d) for d in domains]

    place = _place_phrase(location_name, location_country)
    if not place:
        p = describe_place(lat, lon)
        place = (p.get("waters") or p.get("zone") or "")

    head = f"{n} signals converging" if n > 1 else "Signals converging"
    if place:
        head += f" in {place}" if not place.startswith("the ") else f" in {place}"
    if doms:
        head += " — " + ", ".join(doms[:4])
    # The generated title is a real sentence about the event; keep it as the
    # second line rather than replacing the coincidence statement with it.
    detail = (subtitle or title or "").strip()
    if detail and detail.lower() != "intelligence fusion event" and detail.lower() not in head.lower():
        head += f". {detail.rstrip('.')}."
    return head


def _unwrap_raw(value: Any) -> dict:
    """The alerts table's raw_json is an envelope, and in places an envelope
    inside an envelope.

    write_alert() serialises the producer's whole dict, so raw_json usually
    mirrors the row. GeoConfirmed nests the placemark facts one level deeper
    under a "raw" key — and stores that inner dict as a PYTHON REPR
    ("{'description': ...}", single quotes), not JSON, because it was passed
    through str() by json.dumps(default=str). json.loads cannot read it, which
    is why the real prose for 3,305 alerts looked absent.

    Returns a single flattened dict: inner keys are merged under the outer
    ones, so an explicit outer value always wins.
    """
    if isinstance(value, dict):
        out = dict(value)
    elif isinstance(value, str) and value.strip():
        out = _parse_loose(value)
    else:
        return {}
    inner = out.get("raw")
    if inner is not None and not isinstance(inner, dict):
        inner = _parse_loose(inner) if isinstance(inner, str) else {}
    if isinstance(inner, dict):
        merged = dict(inner)
        merged.update({k: v for k, v in out.items() if k != "raw"})
        merged["raw"] = inner
        return merged
    return out


def _parse_loose(text: str) -> dict:
    """JSON first, then a Python literal. Anything else is not a payload."""
    t = (text or "").strip()
    if not t:
        return {}
    try:
        v = json.loads(t)
        return v if isinstance(v, dict) else {}
    except Exception:
        pass
    try:
        import ast as _ast
        v = _ast.literal_eval(t)
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def _coords(alert: dict, raw: dict) -> tuple[Any, Any]:
    """Longitude is stored under three different names across producers and
    was NULL in 302,284 of 346,570 active rows because only one was read (see
    alert_writer.write_alert). Read all of them, row first then payload."""
    lat = alert.get("lat")
    lon = alert.get("lon")
    for src in (alert, raw):
        if lat in (None, "", "None"):
            lat = src.get("lat") or src.get("latitude")
        if lon in (None, "", "None"):
            lon = src.get("lon") or src.get("lng") or src.get("longitude")
    return lat, lon


def _kind_of(alert: dict, raw: dict) -> str:
    """The alert family. "unknown" is treated as ABSENT, not as a type: 290,119
    production rows carry alert_type="unknown" while raw_json.rule_name says
    exactly what they are. A truthy-or chain silently preferred the useless
    value — the fallback has to skip it explicitly."""
    for v in (alert.get("alert_type"), raw.get("rule_name"), raw.get("rule_trigger"),
              raw.get("alert_type"), raw.get("type")):
        t = (v or "").strip()
        if t and t.lower() != "unknown":
            return t
    return ""


def detector_headline(
    *,
    rule: str,
    vessel: Optional[str] = None,
    mmsi: Optional[str] = None,
    message: Optional[str] = None,
    gap_minutes: Any = None,
    trigger: Optional[str] = None,
    place: Optional[dict] = None,
) -> str:
    """AIS detector output, said in English.

    The producers write "Dark ship: MMSI:413442370 — no AIS signal for 63 min"
    into `message` and leave `title` empty, so 302,274 alerts had no title at
    all. An MMSI is a licence plate: it belongs in the detail line, never as
    the thing a human is asked to recognise.

        "Vessel went dark for 1h 3m in the Taiwan Strait (MMSI 413442370)"
    """
    p = place or {}
    r = (rule or "").upper()
    name = (vessel or "").strip()
    if name.upper().startswith("MMSI:") or name == mmsi:
        name = ""                       # not a name, just the number again

    what = {
        "AIS_DARK_SHIP": "went dark",
        "DARK SHIP": "went dark",
        "AIS_POSITION_JUMP": "reported an impossible position jump",
        "AIS_LOITERING_NEAR_CABLE": "loitered near a submarine cable",
        "AIS_IDENTITY_MISMATCH": "broadcast an identity that does not match its record",
        "SHIP-TO-SHIP TRANSFER": "conducted a ship-to-ship transfer",
    }.get(r, "was flagged by " + (rule or "a detector"))

    subject = f"{name} " if name else "Vessel "
    head = subject + what

    where = p.get("label") or ""
    if not where and trigger:
        # "strategic:Taiwan Strait" — the detector already knows where, and
        # says so, even for the rows whose longitude was lost.
        t = str(trigger).split(":", 1)[-1].strip()
        if t and t.upper() != r:
            where = f"in {t}"
    if where:
        head += f" {where}"

    detail: list[str] = []
    try:
        m = int(float(gap_minutes))
        detail.append(f"no AIS signal for {m // 60}h {m % 60:02d}m" if m >= 60 else f"no AIS signal for {m} min")
    except (TypeError, ValueError):
        pass
    if mmsi:
        detail.append(f"MMSI {mmsi}")
    if detail:
        head += " (" + ", ".join(detail) + ")"
    elif message:
        head = head + " — " + _first_clause(message)
    return head


def aircraft_headline(
    *, callsign: Optional[str] = None, icao: Optional[str] = None,
    altitude: Any = None, place: Optional[dict] = None,
) -> str:
    """"Military aircraft RCH5024 over the Black Sea at FL284"."""
    p = place or {}
    name = (callsign or "").strip() or (f"ICAO {icao}" if icao else "")
    head = f"Military aircraft {name}".strip()
    if p.get("label"):
        head += " " + p["label"].replace("in the ", "over the ").replace("in ", "over ")
    try:
        fl = int(float(altitude)) // 100
        if fl > 0:
            head += f" at FL{fl:03d}"
    except (TypeError, ValueError):
        pass
    return head


def headline(alert: dict) -> str:
    """Dispatch on alert family for any alert dict or row.

    The governing rule: an informative title is NEVER replaced. Measured
    against real data this matters — the surge engine's own titles
    ("Conflict spike — Novorossiysk, Krasnodar Krai, Russia") are better than
    anything reconstructable from the alert, because the surge metrics
    (multiplier, counts, window) are not carried in the alert payload at all;
    they live in surge_events. A generic rebuild there would have been a
    regression, so surge titles are left alone unless they are empty.
    """
    a = alert or {}
    raw = _unwrap_raw(a.get("raw") if a.get("raw") is not None else a.get("raw_json"))
    title = (a.get("title") or "").strip()
    kind = _kind_of(a, raw)
    k = kind.lower()
    lat, lon = _coords(a, raw)

    if k == "geoconfirmed_event":
        return geoconfirmed_headline(
            name=title, description=raw.get("description"),
            location=a.get("region") or raw.get("region"),
            country=_clean(a.get("country_code") or raw.get("country_code")),
            theatre_slug=raw.get("theatre_slug"), faction=raw.get("faction"),
        )

    if k.startswith("sanctioned vessel"):
        payload = raw.get("payload") or {}
        t, _msg = sanctioned_vessel_headline(
            vessel_name=raw.get("vessel_name") or a.get("entity_name"),
            mmsi=raw.get("mmsi") or a.get("entity_id"),
            lat=lat, lon=lon,
            flag=payload.get("flag") or raw.get("flag"),
            sanction_lists=payload.get("sanction_lists") or _lists_from_message(raw.get("message")),
            confirmed=not k.endswith("(possible)"),
        )
        return t

    if k.startswith("surge_"):
        if title:
            return title                     # already the better sentence
        return surge_headline(
            keyword=raw.get("keyword"), article_type=raw.get("article_type"),
            location_name=raw.get("location_name") or a.get("region"),
            location_country=raw.get("location_country") or _clean(a.get("country_code")),
            article_count=raw.get("article_count"), baseline_count=raw.get("baseline_count"),
            multiplier=raw.get("multiplier"),
            time_window_description=raw.get("time_window_description"),
            headline=raw.get("headline"),
        )

    if k.startswith("ais_") or k in ("dark ship", "ship-to-ship transfer"):
        return detector_headline(
            rule=kind, vessel=raw.get("vessel"), mmsi=raw.get("mmsi") or a.get("entity_id"),
            message=raw.get("message"), gap_minutes=raw.get("gap_minutes"),
            trigger=raw.get("dark_ship_trigger") or raw.get("rule_trigger"),
            place=describe_place(lat, lon),
        )

    if k == "military_aircraft":
        return aircraft_headline(
            callsign=raw.get("aircraft") or a.get("entity_name"),
            icao=raw.get("icao") or a.get("entity_id"),
            altitude=raw.get("altitude"), place=describe_place(lat, lon),
        )

    if title and not is_dateish_title(title):
        return title

    # Unknown family with no usable title: say what the payload says, placed.
    p = describe_place(lat, lon)
    what = _first_clause(raw.get("message") or raw.get("description") or "") or (kind or "Signal")
    return f"{what} {p['label']}".strip() if p.get("label") else what


def _clean(v: Any) -> Optional[str]:
    """SQLite rows round-tripped through str() turn None into the string
    "None"; a country code of "None" must not reach a headline."""
    if v is None:
        return None
    s = str(v).strip()
    return None if not s or s.lower() == "none" else s


_LISTED_BY = re.compile(r"listed by:\s*(.+?)(?:\.\s|$)", re.IGNORECASE | re.DOTALL)


def _lists_from_message(message: Optional[str]) -> list[str]:
    """The sanctioning authorities survive in the alert's own message text
    ("Listed by: Australian Sanctions Consolidated List;Canadian…") even
    where the structured payload did not make it into raw_json. Recovering
    them there is what lets an existing row still name its authorities."""
    if not message:
        return []
    m = _LISTED_BY.search(str(message))
    if not m:
        return []
    return [x.strip() for x in re.split(r"[;,]", m.group(1)) if x.strip()]


# ═══════════════════════════════════════════════════════════════════════════
# 6. RELEVANCE — which alerts have earned an interruption
# ═══════════════════════════════════════════════════════════════════════════
# This decides NOTIFICATION, never storage. Every alert is still written,
# still on the map, still queryable through /api/alerts. What this controls is
# whether it also pushes a card and increments the bell.
#
# The problem it solves is concrete: 40,318 active "Sanctioned Vessel" alerts.
# Most are a hull on a US screening list going about ordinary trade in
# ordinary water. Notifying on all of them trains an analyst to dismiss
# sanctions alerts as a class — which loses the one that mattered. The gates
# below are the user's own rule: relevant waters, OR connected to relevant
# entities.

_PRIORITY_FLAGS = {
    f.strip().lower()
    for f in os.getenv("NOTIF_PRIORITY_FLAGS", "ru,ir,kp,sy,ve,cu,by,cn").split(",")
    if f.strip()
}

# Authorities whose listing is a designation with teeth, as opposed to a
# screening/entity list that flags an export-control concern. A hull listed by
# any of these is notification-worthy wherever it is.
_HARD_AUTHORITIES = {
    a.strip()
    for a in os.getenv("NOTIF_HARD_AUTHORITIES", "EU,UK,US,Ukraine,Canada,Switzerland").split(",")
    if a.strip()
}

# Alert families that are notification-worthy by their nature: each one is a
# discrete, human-verified or multi-signal finding, not a continuous feed.
_ALWAYS_NOTIFY = {
    "geoconfirmed_event",        # every new confirmed point — explicit requirement
    "surge_velocity_spike",
    "surge_volume_surge",
    "fusion_event",
}

# Detector families that are notification-worthy only where they occur.
_PLACE_GATED = {
    "ais_dark_ship",
    "dark ship",
    "ais_loitering_near_cable",
    "ais_position_jump",
    "ais_identity_mismatch",
    "ship-to-ship transfer",
    "isr pattern detected",
}


_SEV_RANK = {"low": 0, "moderate": 1, "medium": 1, "high": 2, "critical": 3}


def _max_sev(a: str, b: str) -> str:
    return a if _SEV_RANK.get(a, 0) >= _SEV_RANK.get(b, 0) else b


def sanctioned_vessel_relevance(
    *,
    lat: Any = None,
    lon: Any = None,
    flag: Optional[str] = None,
    sanction_lists: Optional[Iterable[Any]] = None,
    place: Optional[dict] = None,
) -> dict:
    """{"notify": bool, "reason": str, "sev": str, "place": dict}

    Three gates, any one of which is sufficient:

      1. OPERATOR-DECLARED GEOGRAPHY — the point is inside a StrategicZone or
         a WatchZone. Somebody explicitly told the system to care about this
         square of the earth; that is the strongest available signal.
      2. INHERENTLY RELEVANT WATERS — a chokepoint, or a sea area marked
         `watched` in the gazetteer. A sanctioned hull in the Baltic or
         transiting Hormuz is a finding; the same hull in the Bay of Biscay
         is ordinary trade.
      3. CONNECTED TO A RELEVANT ENTITY — flying the flag of a state under
         broad sanctions.

    Every gate is evaluated, not just the first to fire, and severity is the
    HIGHEST any of them justifies. Short-circuiting on the first match meant
    a hull transiting Hormuz inside a "medium" baseline zone was reported at
    the zone's severity — the zone made the finding less urgent, which is
    backwards.

    Deliberately NOT a gate: "listed by a serious authority". Measured over
    400 real production alerts it fired on nearly everything left — the US
    Trade Consolidated Screening List alone carries 8,178 entries, so
    designation is the baseline condition of every row in this table rather
    than a discriminator within it. Including it reinstated a 98% notify
    rate. Authority still shapes the headline; it no longer decides the
    interruption.
    """
    p = place if place is not None else describe_place(lat, lon)

    sev = "low"
    reasons: list[str] = []

    if p.get("chokepoint"):
        sev = _max_sev(sev, "critical")
        reasons.append("transiting " + _the(p["chokepoint"]))
    if p.get("zone"):
        sev = _max_sev(sev, "critical" if p.get("zone_severity") == "critical" else "high")
        reasons.append(f"inside {p['zone']}")
    if p.get("watched") and not p.get("chokepoint"):
        sev = _max_sev(sev, "high")
        reasons.append("in " + _the(p.get("waters") or ""))

    fc = (flag or "").strip().lower()
    if fc in _PRIORITY_FLAGS:
        sev = _max_sev(sev, "high")
        reasons.append(f"{flag_country(fc) or fc.upper()}-flagged")

    if reasons:
        return {"notify": True, "sev": sev, "reason": "; ".join(reasons[:2]), "place": p}
    return {"notify": False, "sev": "low",
            "reason": "listed, but in uncontested water and not a priority flag",
            "place": p}


# ── Arrival, not presence ──────────────────────────────────────────────────
# A sanctioned vessel sitting in the Baltic is a STATE. The same vessel
# entering the Baltic is an EVENT. Only the second one is news.
#
# Measured on real production traffic: ~600 sanctioned-vessel alerts a day
# across ~500 distinct hulls, so collapsing repeats of one hull saves only
# 1.5x — nowhere near enough on its own. What bounds the volume honestly is
# notifying on a CHANGE of resolved place, with a long cooldown as the
# backstop for a vessel that simply stays somewhere it should not be.
#
# In-process state. This app runs one uvicorn worker on one event loop, so a
# dict is the whole mechanism; a restart costs one re-notification per hull,
# which is the right failure direction (re-announce, never swallow).

_ARRIVAL_COOLDOWN_S = int(os.getenv("NOTIF_ARRIVAL_COOLDOWN_S", "86400"))
_ARRIVAL_MAX = int(os.getenv("NOTIF_ARRIVAL_MAX_TRACKED", "50000"))
_arrival: dict[str, tuple[str, float]] = {}
_arrival_lock = threading.Lock()


def is_new_arrival(subject: str, place: str, *, cooldown_s: Optional[int] = None) -> bool:
    """True when `subject` has moved to a different place, or when the
    cooldown has expired. False means "we already said this"."""
    if not subject:
        return True
    cd = _ARRIVAL_COOLDOWN_S if cooldown_s is None else cooldown_s
    now = time.time()
    with _arrival_lock:
        prev = _arrival.get(subject)
        if prev is not None and prev[0] == place and (now - prev[1]) < cd:
            return False
        if len(_arrival) >= _ARRIVAL_MAX and subject not in _arrival:
            # Evict the oldest quarter rather than one entry at a time, so
            # this stays amortised O(1) on a feed that never stops.
            for k, _ in sorted(_arrival.items(), key=lambda kv: kv[1][1])[: _ARRIVAL_MAX // 4]:
                _arrival.pop(k, None)
        _arrival[subject] = (place, now)
    return True


def place_key(p: dict) -> str:
    """The identity of a place for arrival purposes — zone beats waters, and
    an unplaceable point is its own bucket so it never masks a real move."""
    return (p.get("zone") or p.get("chokepoint") or p.get("waters") or "?")


def __reset_arrivals() -> None:
    """Test seam."""
    with _arrival_lock:
        _arrival.clear()


def _coverage_note(lat, lon) -> str:
    """How well we see this water, appended to an AIS-derived reason.

    Our AIS is terrestrial and clusters where volunteers run receivers,
    so counting vessels ranks northern Europe as the busiest place on
    earth and reports Hormuz — where we hold zero positions — as quiet.
    A finding made in a blind region has to say so on its own face.
    """
    try:
        import ais_coverage as _ac
        c = _ac.coverage_for(lat, lon)
    except Exception:                                       # noqa: BLE001
        return ""
    if not c or not c.get("blind"):
        return ""
    return f" (AIS coverage here is near zero — {c['region']})"


def notification_relevance(alert: dict) -> dict:
    """The same decision for any alert dict or row. {"notify", "sev", "reason"}."""
    a = alert or {}
    raw = _unwrap_raw(a.get("raw") if a.get("raw") is not None else a.get("raw_json"))
    kind = _kind_of(a, raw)
    k = kind.lower()
    sev = (a.get("severity") or raw.get("severity") or "moderate").lower()
    lat, lon = _coords(a, raw)

    if k.startswith("sanctioned vessel"):
        payload = raw.get("payload") or {}
        v = sanctioned_vessel_relevance(
            lat=lat, lon=lon,
            flag=payload.get("flag") or raw.get("flag"),
            sanction_lists=payload.get("sanction_lists") or _lists_from_message(raw.get("message")),
        )
        if k.endswith("(possible)") and v["notify"]:
            v["sev"] = "moderate"       # never outranks a confirmed match
        if v["notify"]:
            subject = str(raw.get("mmsi") or a.get("entity_id") or "").strip()
            if subject and not is_new_arrival(f"ais:{subject}", place_key(v["place"])):
                return {"notify": False, "sev": v["sev"],
                        "reason": "already reported in " + place_key(v["place"])}
        return {"notify": v["notify"], "sev": v["sev"],
                "reason": v["reason"] + _coverage_note(lat, lon)}

    if k in _ALWAYS_NOTIFY:
        return {"notify": True,
                "sev": sev if sev in ("critical", "high", "moderate", "low") else "moderate",
                "reason": "confirmed finding"}

    if k in _PLACE_GATED:
        p = describe_place(lat, lon)
        if p.get("zone"):
            return {"notify": True, "sev": "high", "reason": f"inside {p['zone']}"}
        if p.get("chokepoint") or p.get("watched"):
            return {"notify": True, "sev": "high",
                    "reason": f"in {p.get('chokepoint') or p.get('waters')}"}
        # The detector often knows the zone even where the longitude was lost
        # ("strategic:Taiwan Strait") — trust its own trigger over our failure
        # to place the point.
        trig = str(raw.get("dark_ship_trigger") or raw.get("rule_trigger") or "")
        if trig.lower().startswith(("strategic:", "watch:", "zone:")):
            return {"notify": True, "sev": "high",
                    "reason": f"in {trig.split(':', 1)[-1].strip()}"}
        return {"notify": False, "sev": "low", "reason": "outside watched waters"}

    # Everything else is a continuous feed, not an event. The military
    # aircraft track and the 290k reclassified AIS rows are a picture of
    # normality; they belong on the map and in the record, not on a card.
    # Criticals still get through.
    if sev == "critical":
        return {"notify": True, "sev": "critical", "reason": "critical severity"}
    return {"notify": False, "sev": sev, "reason": "routine feed traffic"}


# ═══════════════════════════════════════════════════════════════════════════
# 7. KIND — which icon and word the card wears
# ═══════════════════════════════════════════════════════════════════════════
# Mirrors the KIND map in src/state/notificationStore.js. Kept here rather
# than inferred in the browser so one vocabulary governs both ends.

def notification_kind(alert_type: Optional[str]) -> str:
    k = (alert_type or "").strip().lower()
    if k.startswith("surge_"):
        return "escalate"           # a surge IS an escalation in coverage
    if k == "fusion_event":
        return "escalate"
    if k.startswith("ais_") or k.startswith("sanctioned vessel") or k in (
        "dark ship", "ship-to-ship transfer", "isr pattern detected", "military_aircraft"
    ):
        return "detector"
    if k == "geoconfirmed_event":
        return "signal"
    return "signal"



# ── Plain words ───────────────────────────────────────────────────────────
#
# Every notification title passes through plain() before it reaches a
# person. "EMERGENCY: BAF431 squawking 7700", "at FL068" and "RCH5013" are
# codes an analyst has to decode; the card should already have done it.

# Callsign prefixes of the military operators seen most in the feed.
MILITARY_CALLSIGNS = {
    "RCH": "US Air Force transport", "REACH": "US Air Force transport", "CNV": "US Navy",
    "RRR": "Royal Air Force", "ASCOT": "Royal Air Force transport", "GAF": "German Air Force",
    "BAF": "Belgian Air Force", "FAF": "French Air Force", "CTM": "French Air Force",
    "IAM": "Italian Air Force", "NAF": "Royal Netherlands Air Force", "PLF": "Polish Air Force",
    "HKY": "US Air Force", "DUKE": "US Army", "PAT": "US Army", "SAM": "US government VIP",
    "NATO": "NATO", "MMF": "NATO tanker fleet", "SVF": "Swedish Air Force", "HAF": "Hellenic Air Force",
    "TUAF": "Turkish Air Force", "RSD": "Russian state flight", "RFF": "Russian Air Force",
}
SQUAWK_MEANING = {
    "7700": "declared an emergency", "7600": "lost radio contact", "7500": "signalled a hijacking",
}


def operator_of(callsign: str | None) -> str | None:
    cs = (callsign or "").upper()
    for k in sorted(MILITARY_CALLSIGNS, key=len, reverse=True):
        if cs.startswith(k) and (len(cs) == len(k) or cs[len(k)].isdigit()):
            return MILITARY_CALLSIGNS[k]
    return None


def plain(title: str | None) -> str | None:
    """A notification title with its codes turned into words."""
    if not title:
        return title
    t = str(title)
    m = re.match(r"^(?:EMERGENCY|HIJACK|COMMS FAILURE): (\S+) squawking (7[567]00)(.*)$", t)
    if m:
        cs, code, rest = m.groups()
        who = f"{operator_of(cs)} {cs}" if operator_of(cs) else f"Aircraft {cs}"
        t = f"{who} {SQUAWK_MEANING[code]} (squawk {code}){rest}"
    m = re.match(r"^Military aircraft (\S+)(.*)$", t)
    if m and operator_of(m.group(1)):
        t = f"{operator_of(m.group(1))} {m.group(1)}{m.group(2)}"
    t = re.sub(r"\bat FL(\d{2,3})\b", lambda x: f"at {int(x.group(1)) * 100:,} ft", t)
    return t
