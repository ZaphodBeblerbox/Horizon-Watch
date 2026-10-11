"""
track_photos.py — a photograph of THIS aircraft or THIS ship, with its credit.

Two sources, chosen for what their terms allow:

  Aircraft  planespotters.net public photo API, by ICAO24 hex and then by
            registration. Their terms: hotlink their thumbnail (never copy
            or re-host it), show the photographer's name, and link to the
            photo's page on planespotters.net. We store only the URLs and
            the credit, never the picture.
  Ships     Wikidata → Wikimedia Commons, by IMO number (Wikidata P458 →
            P18 image). Commons files carry a licence (mostly CC BY-SA) whose
            condition is attribution, so the author and licence travel with
            every result. The IMO names one hull for its whole life; a ship's
            NAME does not (see wikimedia_image_service: "PACITA" found a
            supermarket), so a ship without an IMO gets no photograph.
  Fallback  an aircraft with no planespotters photo is tried on Wikidata by
            registration (P426) — individual airframes with an article.

MarineTraffic / VesselFinder / ShipSpotting photos are not used: their terms
do not permit third-party display.

Cached in DATA_DIR/track_photo_cache.json: a found photo for 7 days, "none
found" for 1 day, a network failure not at all. Outbound calls go through a
3-wide semaphore and a 60-per-minute ceiling; this module is synchronous and
must be called from an executor, never on the event loop.

NO PERSONAL DATA LEAVES IN A REQUEST: the User-Agent names the product and a
project URL, which is what Wikimedia's policy asks for. An email address in a
User-Agent is the owner's personal data sent to a third party on every call.
"""
from __future__ import annotations

import collections
import json
import logging
import os
import re
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

logger = logging.getLogger(__name__)

USER_AGENT = "HorizonWatch/2.0 (+https://github.com/ZaphodBeblerbox/Horizon-Watch)"
POSITIVE_TTL = 7 * 86400
NEGATIVE_TTL = 1 * 86400
TIMEOUT = 8
MAX_PARALLEL = 3
MAX_PER_MINUTE = 60
MAX_ENTRIES = 5000

PLANESPOTTERS = "https://api.planespotters.net/pub/photos"
WIKIDATA = "https://www.wikidata.org/w/api.php"
COMMONS = "https://commons.wikimedia.org/w/api.php"

_NOT_A_PHOTOGRAPH = re.compile(r"(logo|emblem|seal|coat[_ ]of[_ ]arms|flag|map|diagram|\.svg)", re.I)


class Busy(Exception):
    """The outbound ceiling was reached; the answer is unknown, not 'none'."""


# ── cache ─────────────────────────────────────────────────────────────────────

_lock = threading.Lock()
_cache: dict | None = None
_cache_path: Path | None = None
_key_locks: dict = collections.defaultdict(threading.Lock)


def _path() -> Path:
    global _cache_path
    if _cache_path is None:
        try:
            from paths import DATA_DIR
            _cache_path = Path(DATA_DIR) / "track_photo_cache.json"
        except Exception:
            _cache_path = Path(__file__).resolve().parent.parent / "data" / "track_photo_cache.json"
    return _cache_path


def _ttl(entry: dict) -> int:
    return POSITIVE_TTL if (entry.get("data") or {}).get("available") else NEGATIVE_TTL


def _load() -> dict:
    global _cache
    if _cache is None:
        try:
            raw = json.loads(_path().read_text())
            now = time.time()
            _cache = {k: v for k, v in raw.items()
                      if isinstance(v, dict) and now - v.get("ts", 0) < _ttl(v)}
        except Exception:
            _cache = {}
    return _cache


def _get_cached(key: str):
    with _lock:
        hit = _load().get(key)
    if hit and time.time() - hit.get("ts", 0) < _ttl(hit):
        return hit["data"]
    return None


def _put(key: str, data: dict) -> None:
    with _lock:
        c = _load()
        c[key] = {"ts": time.time(), "data": data}
        if len(c) > MAX_ENTRIES:
            for k, _ in sorted(c.items(), key=lambda kv: kv[1].get("ts", 0))[: len(c) - MAX_ENTRIES]:
                c.pop(k, None)
        try:
            p = _path()
            p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.with_suffix(".tmp")
            tmp.write_text(json.dumps(c, ensure_ascii=False))
            os.replace(tmp, p)
        except Exception as exc:
            logger.warning("track_photos: cache write failed: %s", exc)


def reset_cache(path: Path | None = None) -> None:
    """For tests: forget everything, optionally point the cache elsewhere."""
    global _cache, _cache_path
    with _lock:
        _cache = None
        _cache_path = path
    _calls.clear()


# ── outbound ──────────────────────────────────────────────────────────────────

_sem = threading.BoundedSemaphore(MAX_PARALLEL)
_calls: collections.deque = collections.deque()
_calls_lock = threading.Lock()


def _fetch_json(url: str, params: dict | None = None):
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    with _calls_lock:
        now = time.time()
        while _calls and now - _calls[0] > 60:
            _calls.popleft()
        if len(_calls) >= MAX_PER_MINUTE:
            raise Busy()
        _calls.append(now)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with _sem:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read().decode("utf-8", "replace"))


# ── result shape ──────────────────────────────────────────────────────────────

def empty(kind: str, reason: str) -> dict:
    return {"available": False, "kind": kind, "thumbnail_url": None, "image_url": None,
            "link_url": None, "photographer": None, "source": None, "source_url": None,
            "licence": None, "licence_url": None, "title": None, "matched_by": None,
            "reason": reason}


def _strip_html(s) -> str | None:
    s = re.sub(r"<[^>]+>", "", str(s or ""))
    s = re.sub(r"\s*\((talk|contribs)\)", "", s)      # Commons user-page links
    s = re.sub(r"\s+", " ", s).strip()
    return s[:120] or None


# ── planespotters ─────────────────────────────────────────────────────────────

def _planespotters(path: str, matched_by: str) -> dict | None:
    d = _fetch_json(f"{PLANESPOTTERS}/{path}")
    photos = (d or {}).get("photos") or []
    if not photos:
        return None
    p = photos[0]
    thumb = (p.get("thumbnail_large") or {}).get("src") or (p.get("thumbnail") or {}).get("src")
    if not thumb:
        return None
    return {**empty("aircraft", None), "available": True,
            "thumbnail_url": thumb, "image_url": thumb,
            "link_url": p.get("link"), "photographer": p.get("photographer") or None,
            "source": "planespotters.net", "source_url": "https://www.planespotters.net",
            "licence": "All rights reserved — shown under planespotters.net API terms",
            "licence_url": "https://www.planespotters.net/photo/api",
            "matched_by": matched_by}


# ── wikidata / commons ────────────────────────────────────────────────────────

def _commons_file(filename: str, kind: str, matched_by: str) -> dict | None:
    if not filename or _NOT_A_PHOTOGRAPH.search(filename):
        return None
    d = _fetch_json(COMMONS, {
        "action": "query", "titles": f"File:{filename}", "prop": "imageinfo",
        "iiprop": "url|extmetadata", "iiurlwidth": 800, "format": "json",
        "iiextmetadatafilter": "Artist|LicenseShortName|LicenseUrl|Credit",
    })
    for page in ((d or {}).get("query") or {}).get("pages", {}).values():
        info = (page.get("imageinfo") or [None])[0]
        if not info:
            continue
        meta = info.get("extmetadata") or {}
        val = lambda k: (meta.get(k) or {}).get("value")
        return {**empty(kind, None), "available": True,
                "thumbnail_url": info.get("thumburl") or info.get("url"),
                "image_url": info.get("url"), "link_url": info.get("descriptionurl"),
                "photographer": _strip_html(val("Artist")) or _strip_html(val("Credit")),
                "source": "Wikimedia Commons", "source_url": "https://commons.wikimedia.org",
                "licence": _strip_html(val("LicenseShortName")), "licence_url": val("LicenseUrl") or None,
                "title": filename, "matched_by": matched_by}
    return None


def _wikidata_image(prop: str, value: str, kind: str, matched_by: str) -> dict | None:
    d = _fetch_json(WIKIDATA, {"action": "query", "list": "search", "format": "json",
                               "srsearch": f"haswbstatement:{prop}={value}", "srlimit": 2})
    hits = ((d or {}).get("query") or {}).get("search") or []
    if len(hits) != 1:          # none, or ambiguous: two items claim this identifier
        return None
    qid = hits[0].get("title")
    c = _fetch_json(WIKIDATA, {"action": "wbgetclaims", "entity": qid, "property": "P18", "format": "json"})
    claims = ((c or {}).get("claims") or {}).get("P18") or []
    claims = sorted(claims, key=lambda s: s.get("rank") != "preferred")
    for s in claims:
        fn = ((s.get("mainsnak") or {}).get("datavalue") or {}).get("value")
        hit = _commons_file(fn, kind, matched_by)
        if hit:
            hit["link_url"] = hit["link_url"] or f"https://www.wikidata.org/wiki/{qid}"
            return hit
    return None


def _commons_search_imo(imo: str) -> dict | None:
    """Commons files ships under 'IMO 1234567' — the number must be in the file's own text."""
    d = _fetch_json(COMMONS, {
        "action": "query", "generator": "search", "gsrsearch": f'filetype:bitmap "IMO {imo}"',
        "gsrlimit": 6, "gsrnamespace": 6, "prop": "imageinfo", "iiprop": "url|extmetadata",
        "iiurlwidth": 800, "format": "json",
    })
    for page in ((d or {}).get("query") or {}).get("pages", {}).values():
        info = (page.get("imageinfo") or [None])[0]
        title = (page.get("title") or "").replace("File:", "")
        if not info or _NOT_A_PHOTOGRAPH.search(title):
            continue
        meta = info.get("extmetadata") or {}
        text = " ".join([title] + [str((meta.get(k) or {}).get("value") or "")
                                   for k in ("ImageDescription", "ObjectName", "Categories")])
        if imo not in text:
            continue
        return _commons_file(title, "vessel", "imo")
    return None


# ── identifiers ───────────────────────────────────────────────────────────────

def clean_hex(h) -> str | None:
    h = str(h or "").strip().lower().removeprefix("adsb-").lstrip("~")
    return h if re.fullmatch(r"[0-9a-f]{6}", h) else None


def clean_reg(r) -> str | None:
    r = str(r or "").strip().upper()
    return r if re.fullmatch(r"[A-Z0-9][A-Z0-9-]{1,9}", r) else None


def valid_imo(imo) -> str | None:
    """A real IMO number: seven digits whose last is the weighted check digit."""
    s = re.sub(r"\D", "", str(imo or ""))
    if len(s) != 7 or s == "0000000":
        return None
    check = sum(int(s[i]) * (7 - i) for i in range(6)) % 10
    return s if check == int(s[6]) else None


def _cached_lookup(key: str, kind: str, work) -> dict:
    hit = _get_cached(key)
    if hit is not None:
        return hit
    with _key_locks[key]:          # one fetch per key, however many clicks
        hit = _get_cached(key)
        if hit is not None:
            return hit
        try:
            result = work()
        except Busy:
            return empty(kind, "photo lookups are rate-limited; try again in a minute")
        except Exception as exc:
            logger.warning("track_photos %s: %s", key, exc)
            return empty(kind, "photo source did not answer")     # not cached
        _put(key, result)
        return result


# ── public ────────────────────────────────────────────────────────────────────

def aircraft_photo(hex_code=None, reg=None) -> dict:
    hx, rg = clean_hex(hex_code), clean_reg(reg)
    if not hx and not rg:
        return empty("aircraft", "no ICAO24 address or registration given")

    def work():
        if hx:
            hit = _planespotters(f"hex/{hx}", "icao24")
            if hit:
                return hit
        if rg:
            hit = _planespotters(f"reg/{urllib.parse.quote(rg)}", "registration")
            if hit:
                return hit
            hit = _wikidata_image("P426", rg, "aircraft", "registration")
            if hit:
                return hit
        return empty("aircraft", "no photograph of this airframe found")

    return _cached_lookup(f"ac:{hx or ''}:{rg or ''}", "aircraft", work)


def vessel_photo(imo=None, mmsi=None) -> dict:
    im = valid_imo(imo)
    if not im:
        return empty("vessel", "no valid IMO number to identify the ship by"
                     if not imo else "the IMO number fails its check digit")

    def work():
        return (_wikidata_image("P458", im, "vessel", "imo")
                or _commons_search_imo(im)
                or empty("vessel", "no photograph of this ship found"))

    return _cached_lookup(f"vs:{im}", "vessel", work)
