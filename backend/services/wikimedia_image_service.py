"""
wikimedia_image_service.py — reference photographs for real places and ships.

Ports, airports and named vessels, from Wikipedia/Wikimedia Commons.

WHY THIS EXISTS. MarineTraffic's photo CDN (services/vessel_photo_service.py)
stopped answering — every request to photos.marinetraffic.com now times out,
so vessel photos have been silently unavailable. Planespotters still works and
still gives the exact airframe by ICAO24, which is a better answer than any
generic source, so aircraft keep using it; this fills the rest.

WHAT IT REFUSES TO RETURN. Wikipedia's page image for an organisation is very
often a LOGO, a seal, or a locator map — "Port of Rotterdam" returns the
authority's wordmark. A logo tells an analyst nothing about berth layout,
crane count or storage yard, which is the entire reason to show a picture of a
port. Those are detected and rejected rather than displayed as though they
were photographs of the place.

Every result carries its page URL, because Wikimedia content is licensed and
attribution is a condition of use, not a courtesy.
"""
from __future__ import annotations

import json
import logging
import re
import time
import urllib.parse
import urllib.request

logger = logging.getLogger(__name__)

_CACHE: dict = {}
_CACHE_TTL = 24 * 3600          # a port does not get rebuilt overnight
_NEGATIVE_TTL = 6 * 3600        # retry a miss sooner than a hit
_TIMEOUT = 8

_UA = "HorizonWatch/2.0 (https://github.com/ZaphodBeblerbox/Horizon-Watch)"
_SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary/"
_SEARCH = "https://en.wikipedia.org/w/api.php"
_COMMONS = "https://commons.wikimedia.org/w/api.php"

# Filename fragments that mean "this is not a photograph of the place".
_NOT_A_PHOTOGRAPH = re.compile(
    r"(logo|wordmark|seal|coat[_ ]of[_ ]arms|crest|emblem|flag|"
    r"locator|location[_ ]map|locmap|karte|map[_ ]of|\.svg$)",
    re.I,
)


# What the page must actually be ABOUT. Wikipedia's search will happily
# resolve "Yamal" to Lamine Yamal (a footballer) and "Leipzig/Halle" to the
# 2026 drone-attack article. Showing an analyst a footballer captioned as a
# vessel, or an incident photo captioned as an airfield, is worse than
# showing nothing — it is a confident wrong answer, and it looks right.
_SUBJECT = {
    "port": re.compile(r"\b(port|harbou?r|terminal|docks?|seaport|quay|marina)\b", re.I),
    "airport": re.compile(r"\b(airport|airfield|air ?base|aerodrome|airstrip|aviation)\b", re.I),
    "vessel": re.compile(r"\b(ship|vessel|tanker|freighter|cargo|carrier|ferry|"
                         r"icebreaker|frigate|destroyer|submarine|boat|trawler|"
                         r"barge|cruiser|corvette|yacht)\b", re.I),
}

# An article about something that HAPPENED at a place is not an article about
# the place, and its lead image is usually wreckage.
_IS_AN_EVENT = re.compile(
    r"\b(attack|crash|disaster|collision|sinking|explosion|fire|incident|"
    r"strike|bombing|hijack|spill|shooting|siege|\b(19|20)\d{2}\b)", re.I)


def _is_about(summary: dict, kind: str) -> bool:
    pattern = _SUBJECT.get(kind)
    if not pattern:
        return True
    text = " ".join(filter(None, (summary.get("title"), summary.get("description"),
                                  (summary.get("extract") or "")[:300])))
    if _IS_AN_EVENT.search(summary.get("title") or ""):
        return False
    return bool(pattern.search(text))


def _empty(reason: str | None = None) -> dict:
    return {"available": False, "image_url": None, "thumbnail_url": None,
            "page_url": None, "title": None, "source": "wikimedia", "reason": reason}


def _get(url: str, params: dict | None = None):
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": _UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=_TIMEOUT) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def _summary(title: str) -> dict | None:
    try:
        return _get(_SUMMARY + urllib.parse.quote(title.replace(" ", "_"), safe=""))
    except Exception:
        return None


def _search_titles(query: str, limit: int = 5) -> list[str]:
    try:
        d = _get(_SEARCH, {"action": "query", "list": "search", "srsearch": query,
                           "srlimit": limit, "format": "json"})
        return [h["title"] for h in (d.get("query", {}).get("search") or [])]
    except Exception:
        return []


def _usable_image(summary: dict) -> tuple[str | None, str | None]:
    """(full, thumb) if the page's image is a photograph, else (None, None)."""
    orig = (summary.get("originalimage") or {}).get("source")
    thumb = (summary.get("thumbnail") or {}).get("source")
    candidate = orig or thumb
    if not candidate:
        return None, None
    if _NOT_A_PHOTOGRAPH.search(urllib.parse.unquote(candidate)):
        return None, None
    return candidate, (thumb or orig)


def _candidates(name: str, kind: str) -> list[str]:
    """Title guesses, most specific first. A bare facility name collides with
    the city it sits in — 'Rotterdam' is a city, 'Port of Rotterdam' is not."""
    n = (name or "").strip()
    if not n:
        return []
    if kind == "port":
        return [f"Port of {n}", f"{n} Port", f"{n} Harbour", n]
    if kind == "airport":
        if re.search(r"airport|airfield|air base|aerodrome", n, re.I):
            return [n, f"{n} (airport)"]
        return [f"{n} Airport", f"{n} International Airport", f"{n} Air Base", n]
    if kind == "vessel":
        return [n, f"{n} (ship)", f"MV {n}", f"USS {n}"]
    return [n]


def _commons_photo(query: str) -> dict | None:
    """A real photograph from Wikimedia Commons.

    Needed because a facility's own Wikipedia page very often carries the
    OPERATOR'S LOGO as its lead image — "Port of Rotterdam" is the authority's
    wordmark — so rejecting logos correctly leaves the biggest ports with no
    picture at all. Commons has the aerial photography the page does not.
    """
    try:
        d = _get(_COMMONS, {
            "action": "query", "generator": "search",
            "gsrsearch": f"filetype:bitmap {query}", "gsrlimit": 6,
            "gsrnamespace": 6, "prop": "imageinfo",
            "iiprop": "url|extmetadata", "iiurlwidth": 800, "format": "json",
        })
    except Exception:
        return None
    pages = (d.get("query") or {}).get("pages") or {}
    for page in pages.values():
        info = (page.get("imageinfo") or [None])[0]
        if not info:
            continue
        title = page.get("title") or ""
        if _NOT_A_PHOTOGRAPH.search(urllib.parse.unquote(title)):
            continue
        return {
            "available": True,
            "image_url": info.get("url"), "thumbnail_url": info.get("thumburl"),
            "page_url": info.get("descriptionurl"),
            "title": title.replace("File:", ""), "source": "wikimedia-commons",
            "extract": None, "reason": None,
        }
    return None


def get_image(name: str, kind: str = "port", *, allow_search: bool = True) -> dict:
    """A reference photograph for a real named place or ship.

    `kind` is port | airport | vessel — it only shapes the title guesses.
    Returns available=False with a reason rather than a placeholder image:
    "no photograph found" is a true and useful answer; a stock picture of
    some other port is not.
    """
    key = f"{kind}:{(name or '').strip().lower()}"
    if not (name or "").strip():
        return _empty("no name given")

    hit = _CACHE.get(key)
    if hit and time.time() - hit["ts"] < (_CACHE_TTL if hit["data"]["available"] else _NEGATIVE_TTL):
        return hit["data"]

    result = _empty("no photograph found")
    tried: list[str] = []
    for title in _candidates(name, kind):
        tried.append(title)
        s = _summary(title)
        if not s or s.get("type") == "disambiguation":
            continue
        if not _is_about(s, kind):
            continue
        full, thumb = _usable_image(s)
        if not full:
            continue
        result = {
            "available": True, "image_url": full, "thumbnail_url": thumb,
            "page_url": (s.get("content_urls", {}).get("desktop", {}) or {}).get("page"),
            "title": s.get("title"), "source": "wikimedia",
            "extract": (s.get("extract") or "")[:400] or None, "reason": None,
        }
        break

    if not result["available"] and allow_search:
        # Last resort: let Wikipedia's own search resolve the name, which
        # catches renamed and differently-disambiguated pages.
        for title in _search_titles(f"{name} {kind}", limit=3):
            if title in tried:
                continue
            s = _summary(title)
            if not s or s.get("type") == "disambiguation":
                continue
            if not _is_about(s, kind):
                continue
            full, thumb = _usable_image(s)
            if not full:
                continue
            result = {
                "available": True, "image_url": full, "thumbnail_url": thumb,
                "page_url": (s.get("content_urls", {}).get("desktop", {}) or {}).get("page"),
                "title": s.get("title"), "source": "wikimedia",
                "extract": (s.get("extract") or "")[:400] or None, "reason": None,
            }
            break

    if not result["available"] and allow_search:
        hint = {"port": f"Port of {name}", "airport": f"{name} Airport",
                "vessel": name}.get(kind, name)
        found = _commons_photo(hint)
        if found:
            result = found

    _CACHE[key] = {"ts": time.time(), "data": result}
    return result
