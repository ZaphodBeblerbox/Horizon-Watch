"""
equipment_makers.py — who builds the equipment, from Wikidata.

WHY THIS MATTERS FOR THE ONTOLOGY. The operator's own example ends "...
drones supplied by German manufacturers", and the graph had no
manufacturer in it at all. Equipment already bridges countries — a
Shahed originates in Iran and is observed in Ukraine — but without the
firm that builds it, the chain cannot reach a company, and a company is
what the sanctions layer, the vessel-ownership layer and the FtM
resolution layer are all keyed on. A maker is the join.

IDENTITY IS CURATED, NOT SEARCHED, AND THIS IS NOT LAZINESS. Wikidata's
search endpoint is fuzzy: asked for "IRIS-T" it returns the plant genus
Iris tectorum first, and asked for "HIMARS" it returns a South African
model named Himarsha. Resolving names live would have attached an actress
to an air-defence system, with a straight face. So the QIDs below were
resolved once, each gated on its description matching a military term,
and each is recorded here with the description that justified it. This
is the same discipline wikidata_alliances.py already applies: explicit
Q-IDs, never a loose match.

ONLY 14 SYSTEMS SO FAR, AND THE FILE SAYS SO. Wikidata's query service
was in an active outage while this was written, rate-limiting to roughly
one request a minute, so the remaining gazetteer entries are unresolved
rather than guessed. `sync()` is batched — one request for up to fifty
systems — backs off on 429, and caches to disk for a month, so the map
fills in without anybody having to remember to do it.

DEGRADES TO NOTHING, NEVER TO A GUESS. With no cache and no network,
makers() returns {} and the graph producer contributes no edges. An
absent manufacturer is a gap; an invented one is a lie that the
sanctions bridge would then act on.
"""
from __future__ import annotations
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

USER_AGENT = ("HorizonWatch/1.0 (equipment manufacturer sync; "
              "contact: local deployment)")
API = "https://www.wikidata.org/w/api.php"

_CACHE = Path(__file__).parent / "data" / "forge" / "wikidata_equipment_cache.json"
#: Manufacturer and country of origin change on the scale of years.
CACHE_TTL_S = 30 * 24 * 3600

#: Wikidata properties: P176 manufacturer, P495 country of origin.
P_MANUFACTURER = "P176"
P_ORIGIN = "P495"

#: gazetteer name -> (QID, the description that justified the match)
#:
#: Every one of these was verified against a military-term gate. The
#: entries that gate REJECTED are deliberately absent rather than
#: force-matched — "Lancet" found no military description at all, so it
#: is not here.
QIDS: dict[str, tuple[str, str]] = {
    "Bayraktar": ("Q17501733", "2014 unmanned combat aerial vehicle by Baykar"),
    "Shahed":    ("Q109044360", "Iranian loitering munition"),
    "Orlan":     ("Q4336510", "Russian unmanned aerial vehicle"),
    "Zala":      ("Q16487478", "Russian six-rotor VTOL drone"),
    "HIMARS":    ("Q2495802", "light multiple rocket launcher"),
    "BM-21":     ("Q270289", "multiple launch rocket system family of Soviet origin"),
    "T-72":      ("Q155658", "Soviet main battle tank"),
    "T-80":      ("Q237135", "Soviet main battle tank"),
    "T-90":      ("Q192757", "Russian third-generation main battle tank"),
    "BMP-2":     ("Q160357", "Soviet infantry fighting vehicle series"),
    "BMP-3":     ("Q796368", "Soviet infantry fighting vehicle family"),
    "BTR-82":    ("Q21636515", "Russian wheeled armoured personnel carrier"),
    "M113":      ("Q462407", "US armored personnel carrier"),
    "Bradley":   ("Q473430", "US armored fighting vehicle"),
}


def _load_cache() -> dict | None:
    if not _CACHE.exists():
        return None
    try:
        blob = json.loads(_CACHE.read_text())
    except (OSError, ValueError):
        return None
    if time.time() - blob.get("fetched_at", 0) > CACHE_TTL_S:
        return None
    return blob


def _save_cache(blob: dict) -> None:
    try:
        _CACHE.parent.mkdir(parents=True, exist_ok=True)
        _CACHE.write_text(json.dumps(blob, indent=1))
    except OSError:
        pass


def _api(params: dict, timeout: int = 45) -> dict:
    url = f"{API}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def _entities(qids: list, fetcher=None) -> dict:
    """Claims and labels for up to 50 entities in ONE request.

    Batched because the per-entity alternative is one HTTP call each,
    which is what got this IP rate-limited to a crawl in the first
    place.
    """
    if not qids:
        return {}
    call = fetcher or _api
    return call({
        "action": "wbgetentities",
        "ids": "|".join(qids[:50]),
        "props": "claims|labels",
        "languages": "en",
        "format": "json",
    }).get("entities", {})


def _claim_ids(entity: dict, prop: str) -> list:
    out = []
    for c in (entity.get("claims") or {}).get(prop, []):
        dv = (c.get("mainsnak") or {}).get("datavalue") or {}
        val = dv.get("value") or {}
        if isinstance(val, dict) and val.get("id"):
            out.append(val["id"])
    return out


def sync(*, force: bool = False, fetcher=None) -> dict:
    """Fetch makers for every curated system, cache, and report honestly.

    Two batched requests: one for the systems, one to label the
    manufacturers and origin countries they point at. On a 429 or any
    network failure it keeps whatever the cache already had — a stale
    manufacturer list is fine, and a sync that raises would take the
    graph rebuild with it.
    """
    if not force:
        cached = _load_cache()
        if cached:
            return {"available": True, "cached": True,
                    "systems": cached.get("systems", {}),
                    "fetched_at": cached.get("fetched_at")}

    try:
        ents = _entities([q for q, _d in QIDS.values()], fetcher=fetcher)
        referenced = set()
        raw = {}
        for name, (qid, _desc) in QIDS.items():
            e = ents.get(qid)
            if not e:
                continue
            mfr = _claim_ids(e, P_MANUFACTURER)
            org = _claim_ids(e, P_ORIGIN)
            referenced.update(mfr)
            referenced.update(org)
            raw[name] = {"qid": qid, "manufacturer_qids": mfr, "origin_qids": org}

        labels = {}
        if referenced:
            lents = _entities(sorted(referenced), fetcher=fetcher)
            for qid, e in lents.items():
                lab = ((e.get("labels") or {}).get("en") or {}).get("value")
                if lab:
                    labels[qid] = lab

        systems = {}
        for name, r in raw.items():
            systems[name] = {
                "qid": r["qid"],
                "manufacturers": [labels[q] for q in r["manufacturer_qids"] if q in labels],
                "origin": [labels[q] for q in r["origin_qids"] if q in labels],
                "source_url": f"https://www.wikidata.org/wiki/{r['qid']}",
            }

        blob = {"fetched_at": time.time(), "systems": systems}
        _save_cache(blob)
        return {"available": True, "cached": False, "systems": systems,
                "fetched_at": blob["fetched_at"]}

    except (urllib.error.HTTPError, urllib.error.URLError, OSError, ValueError) as e:
        code = getattr(e, "code", None)
        cached = _load_cache() or {}
        return {
            "available": bool(cached.get("systems")),
            "cached": True,
            "systems": cached.get("systems", {}),
            # Named, because "no manufacturers" and "Wikidata would not
            # answer" are different states.
            "error": f"HTTP {code}" if code else f"{type(e).__name__}",
        }


def makers() -> dict:
    """Cached makers only — never a network call, never a guess."""
    cached = _load_cache()
    return (cached or {}).get("systems", {}) or {}
