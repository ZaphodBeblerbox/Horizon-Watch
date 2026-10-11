"""
place_resolve.py — "a watch area around King Fahd Airport" → which place,
how big a box. The model extracts the words; this code resolves them.

THE MODEL NEVER GIVES COORDINATES (project rule: model extracts, code
resolves). A spoken place is matched against our own tables — the airports
(OurAirports, 49k rows), the ports, then the search box's geocoder — and
the area is sized from what the place IS: an airport by its class, a port
by a typical harbour, a city wider. "around X with 20 km" overrides it.

When several places fit ("King Fahd" is an airport in Dammam, an air base
in Taif and a port in Jubail) the best is taken — the kind that was said
first, then the biggest of that kind — and the others are offered back.

Pure: the candidates come in as dicts (routers/voice_ai.py reads them);
tested in test_place_resolve.py.
"""
from __future__ import annotations

import math
import re

# The side of the square watched, in km, by what the place is. An airport
# by its class: a large international airport's runways, aprons and
# terminals run 5-8 km end to end; a small strip is a kilometre or two.
SIZE_KM = {
    "large_airport": 8.0, "medium_airport": 5.0, "small_airport": 3.0, "heliport": 1.5,
    "seaplane_base": 3.0, "airport": 6.0,
    "port": 6.0, "city": 15.0, "place": 5.0,
}
MIN_KM, MAX_KM = 1.0, 50.0

KIND_WORDS = {
    "airport": ("airport", "airfield", "air base", "airbase", "aerodrome", "air field", "air station"),
    "port": ("port", "harbour", "harbor", "terminal", "docks", "naval base"),
    "city": ("city", "town"),
}
# Words that name the kind of place, not the place — they decide the kind
# and are then left out of the name match ("King Fahd Airport" must match
# "King Fahd International Airport").
GENERIC = {"airport", "international", "intl", "air", "base", "airbase", "airfield", "aerodrome", "field",
           "station", "regional", "municipal", "port", "harbour", "harbor", "terminal", "docks", "naval",
           "city", "town", "the", "of", "de", "del", "la"}
_COMMAND = re.compile(
    r"\b(please|can you|could you|i want|i'd like|generate|create|make|set up|setup|add|start|open|draw|put|"
    r"new|a|an|satellite|satellites|sat|imagery|watch(?:ing)?|area|zone|region|box|square|radius|keep an eye on|"
    r"monitor|around|over|at|near|on|for|of|with|by|wide|across|side|sized|size)\b", re.I)
_SIZE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(?:x\s*\d+(?:[.,]\d+)?\s*)?(km|kilometers?|kilometres?|k)\b", re.I)


def parse_request(text: str) -> dict:
    """{place, kind, size_km} from what was said. kind is airport | port |
    city | None; size_km only when a size was said."""
    t = " " + str(text or "").strip() + " "
    size = None
    m = _SIZE.search(t)
    if m:
        try:
            size = float(m.group(1).replace(",", "."))
        except ValueError:
            size = None
        t = t[:m.start()] + " " + t[m.end():]
    low = t.lower()
    kind = None
    for k, words in KIND_WORDS.items():
        if any(re.search(rf"\b{re.escape(w)}\b", low) for w in words):
            kind = k
            break
    place = _COMMAND.sub(" ", t)
    place = re.sub(r"[^\w\s'’-]", " ", place)
    place = re.sub(r"\s+", " ", place).strip(" -'")
    return {"place": place, "kind": kind, "size_km": clamp_km(size) if size else None}


def clamp_km(v) -> float | None:
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(v) or v <= 0:
        return None
    return max(MIN_KM, min(MAX_KM, v))


def tokens(s: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9]+", str(s or "").lower().replace("’", "'"))]


def name_tokens(place: str) -> list[str]:
    """The words that must be in a candidate's name."""
    return [w for w in tokens(place) if w not in GENERIC and len(w) > 1]


def match(query: list[str], name: str, codes: tuple = ()) -> float:
    """1.0 when every query word is a word (or the start of one) of the
    name, or the query is one of the place's codes; the share otherwise."""
    if not query:
        return 0.0
    if len(query) == 1 and query[0].upper() in {str(c).upper() for c in codes if c}:
        return 1.0
    words = tokens(name)
    hit = sum(1 for q in query if any(w == q or (len(q) >= 4 and w.startswith(q)) for w in words))
    return hit / len(query)


TYPE_RANK = {"large_airport": 3.0, "medium_airport": 2.0, "small_airport": 0.8, "seaplane_base": 0.2,
             "heliport": -1.0, "closed": -6.0}


def score(c: dict, query: list[str], kind: str | None) -> float:
    m = match(query, c.get("name") or "", tuple(c.get("codes") or ()))
    if m < 1.0:
        return -100.0 + m
    s = 10.0
    ck = c.get("kind")
    if kind:
        s += 4.0 if ck == kind else -3.0
    s += TYPE_RANK.get(c.get("type") or "", 0.0)
    if ck == "port":
        s += {"L": 1.5, "M": 1.0, "S": 0.4}.get(str(c.get("type") or "")[:1].upper(), 0.5)
    # fewer extra words = a closer name ("King Fahd Airport" ~ "King Fahd
    # International Airport" over "King Fahd bin Abdulaziz Airstrip 3")
    extra = len([w for w in tokens(c.get("name")) if w not in GENERIC]) - len(query)
    s -= 0.25 * max(0, extra)
    if ck in ("city", "place"):
        s -= 1.0                       # our own tables first
    return s


def rank(cands: list[dict], place: str, kind: str | None) -> list[dict]:
    q = name_tokens(place)
    scored = [(score(c, q, kind), i, c) for i, c in enumerate(cands)
              if c.get("lat") is not None and c.get("lon") is not None]
    scored = [x for x in scored if x[0] > -50]
    scored.sort(key=lambda x: (-x[0], x[1]))
    seen, out = set(), []
    for s, _, c in scored:
        key = (round(float(c["lat"]), 2), round(float(c["lon"]), 2), c.get("kind"))
        if key in seen:
            continue
        seen.add(key)
        out.append({**c, "score": round(s, 2)})
    return out


def size_for(c: dict, explicit: float | None = None) -> float:
    if explicit:
        return clamp_km(explicit) or SIZE_KM["place"]
    if c.get("kind") == "airport":
        return SIZE_KM.get(c.get("type") or "", SIZE_KM["airport"])
    return SIZE_KM.get(c.get("kind") or "place", SIZE_KM["place"])


def square(lat: float, lon: float, side_km: float) -> dict:
    """A GeoJSON square `side_km` on a side centred on the point."""
    half = side_km / 2
    dlat = half / 110.574
    dlon = half / (111.320 * max(0.05, math.cos(math.radians(lat))))
    w, s, e, n = round(lon - dlon, 6), round(lat - dlat, 6), round(lon + dlon, 6), round(lat + dlat, 6)
    return {"type": "Polygon", "coordinates": [[[w, s], [e, s], [e, n], [w, n], [w, s]]]}


def describe(c: dict) -> str:
    """"King Fahd International Airport (OEDF, Dammam)"."""
    bits = [b for b in (c.get("code"), c.get("where")) if b]
    return f"{c['name']}{' (' + ', '.join(bits) + ')' if bits else ''}"


def resolve(cands: list[dict], text_or_place: str, *, kind: str | None = None, size_km: float | None = None,
            parsed: bool = False) -> dict:
    """The answer the console acts on.

    {ok, place: {name, kind, lat, lon, size_km, polygon, label, …}, others: [...], said}
    or {ok: False, why}."""
    req = {"place": text_or_place, "kind": kind, "size_km": clamp_km(size_km) if size_km else None} if parsed \
        else parse_request(text_or_place)
    if kind and not req.get("kind"):
        req["kind"] = kind
    if size_km and not req.get("size_km"):
        req["size_km"] = clamp_km(size_km)
    if not name_tokens(req["place"]):
        return {"ok": False, "why": "Around which place? Say “a watch area around King Fahd Airport”.", "said": req}
    ranked = rank(cands, req["place"], req.get("kind"))
    if not ranked:
        return {"ok": False, "why": f"I could not find “{req['place']}” among the airports, ports and places we hold.",
                "said": req}
    best = ranked[0]
    km = size_for(best, req.get("size_km"))
    place = {**best, "size_km": km, "polygon": square(float(best["lat"]), float(best["lon"]), km),
             "label": describe(best)}
    return {"ok": True, "place": place, "said": req,
            "others": [{**o, "label": describe(o), "size_km": size_for(o, req.get("size_km"))} for o in ranked[1:5]]}
