"""
demo_situation.py — what is happening in a city's streets NOW, and where the
crowds are likely to converge next (owner, 2026-10-17: "Ideally we can follow
the demonstrations in real time and see what's happening, the developments
and everything. Currently a lot of people are around the Élysée Palace; that
has to be shown. We have the entire map, the road/route system, so we can
align where the demonstrators are: last known locations, probable points of
convergence … Cross-reference that with the points they said they would
attack, with the points that were called for action, and with the messages
where they say where they currently are").

    GET /api/routes/demonstrations/situation   ?city=paris   every active city (or one): the model below
    GET /api/routes/demonstrations/now         ?city=paris   "what is happening in <city> now", compact

THE MODEL, PER CITY (recomputed at most every MEMO_S seconds while someone
looks; the phone and the globe poll every 30 s):

  CROWDS — last known locations. The movement layer's located reports
    (demonstrations.read_reports: posts and live developments at a site,
    street or district that say there is a crowd) plus the positions people
    report themselves ("on est devant l'Élysée", "we're at Concorde"), linked
    with demonstrations.link_tracks — a crowd seen once is still a crowd here
    (min_nodes=1). A crowd: its last place and time, its path, its posts.
    Older than CROWD_MAX_AGE_MIN: gone from the map. Its age is the time
    since that report was POSTED. A position people reported themselves
    outranks a second-hand report less than OUTRANK_MIN newer (report_rank).
    Its path's hops longer than PATH_ROUTE_MIN_M are walked on the street
    network (path_legs; straight and "estimated" until routed), and where
    it probably is NOW is estimated (now_estimate: CROWD_KMH for its age
    along where it said it was heading, or its route to its top convergence
    point, never past it) with how far it could be by now (reach_m).
    (Crowd-tracking accuracy, owner 2026-10-18.)

  TARGETS — places named in calls to action: "rendez-vous à Concorde",
    "tous à l'Élysée", "on va prendre Beauvau", "march on Parliament",
    announced gatherings (telegram_announcements, through the planner's
    hazards) and the public call map's calls (endangered places), and where
    a crowd said it was heading ("se dirige vers Bastille").

  CONVERGENCE — each target scored (score_targets): how strongly it is
    called (calls × recency × immediacy × confidence, a channel counted at
    most CHANNEL_CAP), and how many crowds could be there soon (each crowd's
    walking ETA, routed on the street network: crowd freshness × an ETA
    factor that is full under 15 min and gone at 60, × 1.5 when the crowd
    said it was heading there). score = 1 − exp(−k), capped at 0.95 — an
    ESTIMATE, labelled so everywhere; a target named in calls and reachable
    by several crowds within ~45 min ranks first. Where the routes of two
    crowds to a top target join before it, that junction is a candidate too
    (they may meet there first).

ROUTING, BOUNDED. The planner's own public OSRM (routed-foot, FOSSGIS — one
request a second, shared with "Get me out", safe_route._request; at most
NEW_REQUESTS_PER_PASS new requests a pass, none while the planner's own
queue is more than PLANNER_BUSY_S behind): ONE table
request per city for every crowd × target walking time (at most MAX_CROWDS ×
MAX_TARGETS, ROUTED_CITIES cities a pass), and the route lines for the top
points only (MAX_ROUTE_LINES a city). Every answer is cached
(safe_route's cache, 10 min; positions are place centroids, so the keys
hold). A request is waited for ROUTING_BUDGET_S at most; one not back by
then keeps running in the background and the next poll has it — until then
the time is a straight-line estimate (× DETOUR) and says so ("routed":
false). A crowd walks slower than a pedestrian: OSRM's foot times × CROWD_SLOW.

STRUCTURED INTENT (another pass of telegram ingestion is being extended to
store it; read here when present, and the fallback below otherwise). Any of
these on a telegram_posts row (JSON text or already parsed):
    intent | intent_json | intents | intents_json:
        {"act": "gather"|"march"|"attack"|"block"|"occupy"|…,
         "target": "Palais de l'Élysée" | {"name", "lat", "lon"},
         "target_lat"?: float, "target_lon"?: float,
         "when": "now" | "HH:MM" | ISO time | null,
         "confidence": 0..1}                       — or a list of them
    positions | positions_json:
        [{"kind": "at", "place": "Place de la Concorde", "lat"?, "lon"?,
          "at_time": ISO | "now" | null}]
  or a table telegram_intents (channel, msg_id, kind 'intent'|'at', act,
  target|place, target_lat|lat, target_lon|lon, when|at_time, confidence).
  A target or place without coordinates is resolved like the fallback's.

FALLBACK EXTRACTION (works today, extract_intents / extract_positions):
French and English cue words on the post's text, headline and English
summary (accents folded), the phrase after the cue resolved by resolve_place:
a small gazetteer of the places crowds go in Paris and a few other cities
(GAZETTEER), the endangered places' names, the places located posts in
the same city were geocoded to, and street-level phrases ("rue de Rivoli",
"pont Alexandre III") geocoded inside the city (street_place: the
geocoder's cache only; a miss is looked up by one background thread at
Nominatim's one request a second). A phrase that resolves to nothing is dropped
— a cue word alone ("tous les jours") never makes a target.

Pure functions first (extraction, resolution, scoring, junctions); the reads
and the routing at the bottom. Reads are blocking (SQLite): from a thread.
"""
from __future__ import annotations

import asyncio
import datetime as _dt
import functools
import json
import math
import re
import sqlite3
import threading
import time

import demonstrations as dm

LOOKBACK_H = 6
CROWD_MAX_AGE_MIN = 180          # a crowd not reported for 3 h is no longer on the map
CALL_MAX_AGE_MIN = 360
MERGE_M = 250                    # two crowds this close, seen within MERGE_MIN: one crowd
MERGE_MIN = 45
AT_TARGET_M = 200                # a crowd this close to a target is there already
TARGET_MERGE_M = 250
MAX_CROWDS = 8                   # per city, freshest first — bounds the routing matrix
MAX_TARGETS = 6
MAX_ROUTE_LINES = 6              # route lines drawn per city (top points × crowds)
ROUTED_CITIES = 3                # cities routed per pass (the busiest); the rest estimated
ROUTING_BUDGET_S = 1.2           # the endpoint waits this long for the router at most
CROWD_SLOW = 1.25                # a crowd walks at ~4 km/h; OSRM's foot profile assumes ~5
CROWD_KMH = 4.0
DETOUR = 1.3                     # straight line → street distance, for the estimate
WITHIN_MIN = 45
CHANNEL_CAP = 1.5
SCORE_CAP = 0.95
MEMO_S = 20
ESTIMATE = "Estimate from Telegram calls and reports and walking times — not a prediction anyone has confirmed"

# ── places ──────────────────────────────────────────────────────────────────
# (name, city, lat, lon, aliases). An alias marked "=" is only taken as the
# whole phrase after a cue ("à République"), never from free text — "la
# République" is a regime as often as a square.
GAZETTEER = [
    ("Palais de l'Élysée", "paris", 48.8704, 2.3167, ["elysee", "palais de l'elysee", "faubourg saint-honore"]),
    ("Place de la Concorde", "paris", 48.8656, 2.3212, ["concorde"]),
    ("Assemblée nationale", "paris", 48.8619, 2.3186, ["assemblee nationale", "palais bourbon", "=assemblee"]),
    ("Hôtel de Matignon", "paris", 48.8546, 2.3204, ["matignon"]),
    ("Place Beauvau (ministère de l'Intérieur)", "paris", 48.8722, 2.3164, ["beauvau", "ministere de l'interieur"]),
    ("Champs-Élysées", "paris", 48.8698, 2.3076, ["champs-elysees", "champs elysees", "=champs"]),
    ("Rond-point des Champs-Élysées", "paris", 48.8690, 2.3104, ["rond-point des champs"]),
    ("Arc de Triomphe", "paris", 48.8738, 2.2950, ["arc de triomphe", "place de l'etoile", "charles de gaulle-etoile", "=etoile"]),
    ("Place de la Bastille", "paris", 48.8532, 2.3692, ["bastille"]),
    ("Place de la République", "paris", 48.8674, 2.3636, ["place de la republique", "=republique"]),
    ("Place de la Nation", "paris", 48.8483, 2.3958, ["place de la nation", "=nation"]),
    ("Hôtel de Ville", "paris", 48.8566, 2.3522, ["hotel de ville", "city hall"]),
    ("Châtelet", "paris", 48.8584, 2.3470, ["chatelet"]),
    ("Les Halles", "paris", 48.8620, 2.3455, ["les halles", "=halles"]),
    ("Opéra", "paris", 48.8711, 2.3319, ["opera garnier", "place de l'opera", "=opera"]),
    ("La Madeleine", "paris", 48.8700, 2.3245, ["madeleine"]),
    ("Saint-Augustin", "paris", 48.8757, 2.3191, ["saint-augustin"]),
    ("Esplanade des Invalides", "paris", 48.8584, 2.3133, ["invalides"]),
    ("Trocadéro", "paris", 48.8616, 2.2893, ["trocadero"]),
    ("Tour Eiffel", "paris", 48.8584, 2.2945, ["tour eiffel", "eiffel tower", "champ de mars"]),
    ("Place d'Italie", "paris", 48.8314, 2.3557, ["place d'italie"]),
    ("Montparnasse", "paris", 48.8421, 2.3219, ["montparnasse"]),
    ("Denfert-Rochereau", "paris", 48.8339, 2.3324, ["denfert"]),
    ("Gare du Nord", "paris", 48.8809, 2.3553, ["gare du nord"]),
    ("Gare de l'Est", "paris", 48.8768, 2.3592, ["gare de l'est"]),
    ("Gare de Lyon", "paris", 48.8443, 2.3743, ["gare de lyon"]),
    ("Gare Saint-Lazare", "paris", 48.8763, 2.3253, ["saint-lazare", "st-lazare"]),
    ("Sorbonne", "paris", 48.8487, 2.3431, ["sorbonne"]),
    ("Sénat", "paris", 48.8483, 2.3372, ["senat", "palais du luxembourg", "jardin du luxembourg"]),
    ("Louvre", "paris", 48.8606, 2.3376, ["louvre"]),
    ("Place Vendôme", "paris", 48.8675, 2.3294, ["vendome"]),
    ("Place de Clichy", "paris", 48.8835, 2.3275, ["place de clichy"]),
    ("Barbès", "paris", 48.8838, 2.3506, ["barbes"]),
    ("Belleville", "paris", 48.8721, 2.3767, ["belleville"]),
    ("Porte Maillot", "paris", 48.8780, 2.2830, ["porte maillot"]),
    ("Place Bellecour", "lyon", 45.7578, 4.8320, ["bellecour"]),
    ("Hôtel de Ville de Lyon", "lyon", 45.7676, 4.8344, ["terreaux"]),
    ("Vieux-Port", "marseille", 43.2951, 5.3740, ["vieux-port", "vieux port"]),
    ("Préfecture des Bouches-du-Rhône", "marseille", 43.2896, 5.3810, ["prefecture de marseille"]),
    ("Place du Capitole", "toulouse", 43.6045, 1.4440, ["capitole"]),
    ("Place de la Bourse", "bordeaux", 44.8414, -0.5698, ["place de la bourse"]),
    ("Place Royale", "nantes", 47.2135, -1.5592, ["place royale"]),
]
CITY_CENTRES = {"paris": (48.8566, 2.3522), "lyon": (45.7640, 4.8357), "marseille": (43.2965, 5.3698),
                "toulouse": (43.6047, 1.4442), "bordeaux": (44.8378, -0.5792), "nantes": (47.2184, -1.5536)}
CITY_RADIUS_M = 15_000


def _alias_rx(alias: str) -> re.Pattern:
    return re.compile(r"(?<![\w-])" + re.escape(alias) + r"(?![\w-])")


_GAZ = [{"name": n, "city": c, "lat": la, "lon": lo, "id": f"g:{c}:{dm.fold(n)}",
         "aliases": [(a.lstrip("="), a.startswith("="), _alias_rx(a.lstrip("="))) for a in al]}
        for n, c, la, lo, al in GAZETTEER]


def city_near(lat, lon) -> str | None:
    """The known city a point is in (within CITY_RADIUS_M of its centre)."""
    if lat is None or lon is None:
        return None
    best = min(CITY_CENTRES.items(), key=lambda kv: dm.metres(lat, lon, *kv[1]))
    return best[0] if dm.metres(lat, lon, *best[1]) <= CITY_RADIUS_M else None


_LEAD = re.compile(r"^(?:(?:a|au|aux|a la|a l'|l'|la|le|les|du|de la|de l'|des|de|devant|sur|vers|pres de|autour de|"
                   r"aux abords de|en bas de|dans|place|the|to|at|in front of|outside|near|around)(?:\s+|(?<=')))+")


# ── street-level places (Nominatim; cache hits inline, misses to one thread) ─
# "On est rue de Rivoli", "le cortège passe pont Alexandre III", "métro
# Saint-Paul": a street word and a name, geocoded inside the city's box. The
# geocoder (geocode_utils, Nominatim) allows one request a second and is
# blocking, so the model only ever reads its cache (memory, and disk for 30
# days); a phrase not asked yet goes to ONE background thread, and the next
# pass (≤ 30 s later) has it. A hit counts only within CITY_RADIUS_M of the
# city's centre.
STREET_GEOCODE = True
STREET_WORDS = ("rue", "avenue", "av", "boulevard", "bd", "place", "pont", "quai", "porte", "gare", "metro", "station",
                "square", "parc", "jardin", "esplanade", "carrefour", "rond-point", "cours", "allee", "passage",
                "impasse", "parvis", "street", "bridge")
_SW = "|".join(sorted(STREET_WORDS, key=len, reverse=True))
_STREET = re.compile(rf"(?<![\w-])(?P<w>{_SW})\.?\s+(?P<n>[\w'-]+(?:\s+[\w'-]+){{0,6}})")
_STREET_STOP = {
    "a", "maintenant", "vers", "avec", "et", "ou", "depuis", "pour", "car", "mais", "ca", "on", "nous", "il", "ils",
    "elle", "elles", "je", "en", "direction", "apres", "puis", "deja", "encore", "toujours", "actuellement", "ici",
    "la-bas", "cote", "face", "qui", "que", "ce", "cet", "cette", "c'est", "sont", "est", "police", "crs", "flics",
    "gendarmes", "manifestants", "cortege", "foule", "bloque", "bloquee", "gaz", "lacrymo", "lacrymogene", "contre",
    "near", "in", "on", "with", "and", "at", "to", "toward", "towards", "now", "after", "before", "where", "is",
    "are", "was", "has", "have", "police", "protesters", "crowd", "right", "still", "from"}
GEO_QUEUE_MAX = 200
STREET_COUNTRY = "fr"                # every city in CITY_CENTRES is French
_geo_q: dict = {}                    # query → bounds, in arrival order
_geo_lock = threading.Lock()
_geo_wake = threading.Event()
_geo_thread: list = [None]
_GEO_GEN = [0]                       # a lookup finished: posts that waited for one are read again
GEO_STATS = {"queued": 0, "looked_up": 0, "hits": 0, "waiting_reads": 0}


def street_phrase(f: str) -> str | None:
    """"le cortege est rue de rivoli maintenant" → "rue de rivoli"; None
    without a street word followed by a name."""
    m = _STREET.search(f or "")
    if not m:
        return None
    name = []
    for w in m.group("n").split():
        if w in _STREET_STOP or any(ch.isdigit() for ch in w) and not re.fullmatch(r"[ivx]+|\d{1,2}(?:e|er|eme)?", w):
            break
        name.append(w)
    while name and name[-1] in ("de", "du", "des", "la", "le", "les", "l'", "d'", "of", "the"):
        name.pop()
    if not name:
        return None
    return f"{m.group('w')} {' '.join(name)}"


def city_box(city: str) -> tuple[float, float, float, float]:
    """(min_lon, min_lat, max_lon, max_lat) around a city, CITY_RADIUS_M each way."""
    lat, lon = CITY_CENTRES[city]
    dlat = CITY_RADIUS_M / 111_320
    dlon = dlat / max(0.2, math.cos(math.radians(lat)))
    return (round(lon - dlon, 4), round(lat - dlat, 4), round(lon + dlon, 4), round(lat + dlat, 4))


def _geo_cached(q: str, box) -> list | None:
    import geocode_utils as gu
    return gu.geocode_cached(q, [STREET_COUNTRY], None, box)


def _geo_lookup(q: str, box) -> list:
    import geocode_utils as gu
    return gu.geocode_place(q, [STREET_COUNTRY], None, box)


def _geo_enqueue(q: str, box) -> None:
    with _geo_lock:
        if q in _geo_q or len(_geo_q) >= GEO_QUEUE_MAX:
            return
        _geo_q[q] = box
        GEO_STATS["queued"] += 1
    _start_geo_thread()
    _geo_wake.set()


def geo_drain(limit: int | None = None) -> int:
    """Look up the queued phrases, oldest first (geocode_place keeps to one
    request a second and caches the answer, misses included). → how many."""
    n = 0
    while limit is None or n < limit:
        with _geo_lock:
            if not _geo_q:
                break
            q, box = next(iter(_geo_q.items()))
        try:
            hits = _geo_lookup(q, box)
        except Exception as ex:                                # noqa: BLE001
            print(f"[demo-situation] error: geocode {q!r}: {type(ex).__name__}: {ex}", flush=True)
            hits = []
        with _geo_lock:
            _geo_q.pop(q, None)
        n += 1
        GEO_STATS["looked_up"] += 1
        GEO_STATS["hits"] += 1 if hits else 0
        _GEO_GEN[0] += 1
    return n


def _geo_worker() -> None:
    while True:
        _geo_wake.wait()
        _geo_wake.clear()
        try:
            geo_drain()
        except Exception as ex:                                # noqa: BLE001
            print(f"[demo-situation] error: geocode worker: {type(ex).__name__}: {ex}", flush=True)


def _start_geo_thread() -> None:
    with _geo_lock:
        if _geo_thread[0] is not None and _geo_thread[0].is_alive():
            return
        _geo_thread[0] = threading.Thread(target=_geo_worker, name="demo-street-geocode", daemon=True)
        _geo_thread[0].start()


def street_place(f: str, city: str | None) -> dict | None:
    """A street-level phrase (folded) in a known city → a place, from the
    geocoder's cache only; a phrase not asked yet is queued and None now."""
    if not STREET_GEOCODE or city not in CITY_CENTRES:
        return None
    s = street_phrase(f)
    if not s:
        return None
    q, box = f"{s}, {city.title()}", city_box(city)
    hits = _geo_cached(q, box)
    if hits is None:
        _geo_enqueue(q, box)
        GEO_STATS["waiting_reads"] += 1
        return None
    c = CITY_CENTRES[city]
    for h in hits or []:
        lat, lon = _num(h.get("lat")), _num(h.get("lon"))
        if lat is None or lon is None or dm.metres(lat, lon, *c) > CITY_RADIUS_M:
            continue
        first = str(h.get("display_name") or "").split(",")[0].strip()
        name = first if first and set(re.findall(r"[\w'-]{3,}", dm.fold(first))) & set(s.split()) else s.title()
        return {"id": f"st:{city}:{round(lat, 4)},{round(lon, 4)}", "name": name, "city": city, "lat": lat, "lon": lon,
                "precision": "street"}
    return None


def resolve_place(phrase: str | None, city: str | None = None, near: tuple | None = None,
                  learned: list[dict] | None = None, strict_ok: bool = True, streets: bool = True) -> dict | None:
    """A phrase ("l'Élysée maintenant", "Concorde à 15h") → a place
    {id, name, city, lat, lon}, or None. Gazetteer first (the longest alias
    that occurs; one in the asked city or nearest `near` preferred), then the
    learned places (endangered places, geocoded posts) whose distinctive words
    all occur in the phrase, then — streets — a street-level phrase ("rue de
    Rivoli", "pont Alexandre III") geocoded in the city (street_place: cache
    only, a miss is looked up in the background). strict_ok: the phrase
    directly follows a cue, so the "=" aliases may match it when it starts
    with them."""
    f = dm.fold(phrase).strip()
    if not f:
        return None
    head = _LEAD.sub("", f)
    hits = []
    for g in _GAZ:
        for alias, strict, rx in g["aliases"]:
            if strict:
                if strict_ok and re.match(re.escape(alias) + r"(?![\w-])", head):
                    hits.append((len(alias), g))
            elif rx.search(f):
                hits.append((len(alias), g))
    if hits:
        def rank(h):
            g = h[1]
            same = 1 if city and g["city"] == city else 0
            d = dm.metres(near[0], near[1], g["lat"], g["lon"]) if near else 0
            return (same, -d / 1000 if near else 0, h[0])
        g = max(hits, key=rank)[1]
        if not city or g["city"] == city or not near or dm.metres(near[0], near[1], g["lat"], g["lon"]) < CITY_RADIUS_M:
            return {"id": g["id"], "name": g["name"], "city": g["city"], "lat": g["lat"], "lon": g["lon"]}
    fw = set(re.findall(r"[\w'-]{4,}", f))
    best = None
    for p in learned or []:
        w = p.get("words") or set()
        if not w or not w <= fw:
            continue
        if city and p.get("city") and p["city"] != city:
            continue
        if best is None or len(w) > len(best["words"]):
            best = p
    if best:
        return {"id": best["id"], "name": best["name"], "city": best.get("city") or city_near(best["lat"], best["lon"]),
                "lat": best["lat"], "lon": best["lon"]}
    if streets:
        c = city if city in CITY_CENTRES else (city_near(*near) if near else None)
        if c:
            return street_place(f, c)
    return None


def learned_place(pid: str, name: str, lat, lon, city: str | None = None) -> dict | None:
    """A place known from the data (an endangered place, a geocoded post)."""
    w = dm.place_words(name)
    if not w or lat is None or lon is None:
        return None
    return {"id": pid, "name": str(name).split(",")[0].strip(), "lat": float(lat), "lon": float(lon),
            "city": city or dm.city_of(name) or city_near(lat, lon), "words": w}


# ── fallback extraction (French + English) ──────────────────────────────────

_PH = r"(?P<p>[^.,;:!?\n()«»\"]{3,60})"
_CALL = re.compile(
    r"\b(?P<cue>rendez-vous|rdv|rassemblement|rassemblons-nous|retrouvons-nous|on se retrouve|rejoignez(?:-nous)?|"
    r"tou(?:s|tes|-te-s)|on va|on y va|allons|objectif|cap sur|marchons sur|marche sur|on marche sur|montons|on monte|"
    r"envahir|envahissons|prendre|prenons|on prend|bloquer|bloquons|encercler|encerclons|assieger|attaquer|attaquons|"
    r"occuper|occupons|appel a (?:se rassembler|manifester|marcher)|"
    r"meet(?:ing)?(?: up)? at|gather(?:ing)? at|rally at|everyone to|all to|let'?s go to|converge on|march on|storm|"
    r"take|occupy|block|blockade|attack|surround|besiege)\b\s+(?:(?:a|au|aux|a la|a l'|devant|sur|vers|le|la|les|l'|"
    r"de|du|the|to|at)(?:\s+|(?<=')))*" + _PH)
_ACT = [(re.compile(r"envahi|attaqu|attack|storm|assieg|besiege|prendre|prenons|on prend|^take|encercl|surround"), "attack"),
        (re.compile(r"bloqu|block"), "block"),
        (re.compile(r"occup"), "occupy"),
        (re.compile(r"march|montons|on monte"), "march")]
_NOW = re.compile(r"\b(maintenant|tout de suite|immediatement|des maintenant|en ce moment|vite|urgent|now|right now|asap|immediately)\b")
_TOMORROW = re.compile(r"\b(demain|tomorrow)\b")
_TIME = re.compile(r"\b(?:a |at |des |from |vers )?([01]?\d|2[0-3])\s*(?:h|:)\s*([0-5]\d)?\b(?!\s*(?:km|m\b))")

_POS = re.compile(
    r"\b(?P<cue>on est|on se trouve|nous sommes|nous voila|je suis|actuellement|en ce moment|toujours|deja|"
    r"(?:le cortege|la foule|les manifestants|le rassemblement|la manif) (?:est|sont|arrive\w*|stationne\w*)|"
    r"we are|we're|we re|currently|right now|still|crowd(?:s)? (?:is|are)|protesters (?:are|have reached|reached)|"
    r"the march (?:is|has reached|reached)|arrived)\s+(?:(?:(?:a|au|aux|a la|a l'|devant|sur|pres de|autour de|"
    r"aux abords de|en bas de|dans|at|outside|in front of|near|around|on|in|gathered at|massing at|the|le|la|les|l')(?:\s+|(?<=')))+"
    # or straight to a street word: "on est rue de Rivoli", "nous sommes place du Tertre"
    r"|(?=(?:" + _SW + r")\b))" + _PH)
_MENTION = re.compile(r"\b(?:devant|aux abords de|autour de|pres de|outside|in front of|around|near)\s+"
                      r"(?:(?:la|le|l'|les|the|du|de la)(?:\s+|(?<=')))*" + _PH)


_MONTHS = {m: i + 1 for i, ms in enumerate([
    ("janvier", "january", "jan"), ("fevrier", "february", "feb"), ("mars", "march", "mar"), ("avril", "april", "apr"),
    ("mai", "may"), ("juin", "june", "jun"), ("juillet", "july", "jul"), ("aout", "august", "aug"),
    ("septembre", "september", "sept", "sep"), ("octobre", "october", "oct"), ("novembre", "november", "nov"),
    ("decembre", "december", "dec")]) for m in ms}
_MON = "|".join(sorted(_MONTHS, key=len, reverse=True))
_DATE = re.compile(rf"\b(?:(?P<d1>[0-3]?\d)(?:er|st|nd|rd|th)?\s+(?P<m1>{_MON})\b|(?P<m2>{_MON})\.?\s+(?P<d2>[0-3]?\d)(?:st|nd|rd|th)?\b)")


def _day(text_f: str, local: _dt.datetime) -> _dt.date:
    """The day a post names ("le 8 octobre", "October 8", "demain"), else its own."""
    m = _DATE.search(text_f)
    if m:
        d, mon = (m.group("d1"), m.group("m1")) if m.group("d1") else (m.group("d2"), m.group("m2"))
        try:
            day = _dt.date(local.year, _MONTHS[mon], int(d))
            if (local.date() - day).days > 200:
                day = day.replace(year=local.year + 1)
            return day
        except ValueError:
            pass
    return local.date() + _dt.timedelta(days=1 if _TOMORROW.search(text_f) else 0)


def _when(text_f: str, posted: _dt.datetime | None, zone) -> tuple[str | None, _dt.datetime | None]:
    """("now" | ISO | a day | None, the start as a UTC time | None) from cue
    words: "maintenant", "à 16h", "demain 15h", "le 8 octobre à 14h30". A day
    without an hour starts at noon there (good enough for "not today")."""
    if _NOW.search(text_f):
        return "now", posted
    if not posted:
        return None, None
    z = zone or _dt.timezone.utc
    local = posted.astimezone(z)
    day = _day(text_f, local)
    m = _TIME.search(text_f)
    if m:
        try:
            start = _dt.datetime(day.year, day.month, day.day, int(m.group(1)), int(m.group(2) or 0), tzinfo=z)
        except ValueError:
            return None, None
        st = start.astimezone(_dt.timezone.utc)
        return st.strftime("%Y-%m-%dT%H:%M:%SZ"), st
    if day != local.date():
        st = _dt.datetime(day.year, day.month, day.day, 12, 0, tzinfo=z).astimezone(_dt.timezone.utc)
        return day.isoformat(), st
    return None, None


def act_of(cue: str) -> str:
    c = dm.fold(cue)
    for rx, act in _ACT:
        if rx.search(c):
            return act
    return "gather"


# English verbs news uses about wars and weather as much as protesters use
# them as calls ("woman killed in enemy attack in Obolon district", "Tu-95s
# take off from Engels-2" — both read as calls on the 72 h test, 2026-10-17):
# a call only in a post about a crowd, and only to a gazetteer place.
GENERIC_CUES = {"take", "block", "blockade", "attack", "storm", "occupy", "surround", "besiege"}
TEXT_MAX = 2000              # a post's first 2000 characters: the call is never buried below that


def extract_intents(text: str | None, posted_at=None, zone=None, city: str | None = None, near: tuple | None = None,
                    learned: list[dict] | None = None, folded: bool = False) -> list[dict]:
    """The places a post CALLS people to (fallback for structured intent):
    [{act, target, place: {id, name, city, lat, lon}, when, start_at, confidence, how: "keywords"}]."""
    f = text if folded else dm.fold(str(text or "")[:TEXT_MAX])
    posted = dm._utc(posted_at)
    out, seen = [], set()
    when, start = _when(f, posted, zone)
    crowd = None
    for m in _CALL.finditer(f):
        generic = m.group("cue") in GENERIC_CUES
        if generic:
            crowd = bool(dm._CROWD.search(f)) if crowd is None else crowd
            if not crowd:
                continue
        pl = resolve_place(m.group("p"), city, near, None if generic else learned, streets=not generic)
        if not pl or pl["id"] in seen:
            continue
        seen.add(pl["id"])
        out.append({"act": act_of(m.group(0)), "target": pl["name"], "place": pl, "when": when,
                    "start_at": start.strftime("%Y-%m-%dT%H:%M:%SZ") if start else None,
                    "confidence": 0.6, "how": "keywords"})
    return out


def extract_positions(text: str | None, city: str | None = None, near: tuple | None = None,
                      learned: list[dict] | None = None, exclude: set | None = None, folded: bool = False) -> list[dict]:
    """Where a post says people ARE now (fallback for structured positions):
    [{kind: "at"|"mentioned", place, confidence, how}]. "on est devant
    l'Élysée" is "at"; "foule devant l'Élysée" in a crowd post is "mentioned"
    (weaker); a place the same post calls people TO (exclude) is not where
    they are."""
    f = text if folded else dm.fold(str(text or "")[:TEXT_MAX])
    out, seen = [], set(exclude or ())
    for m in _POS.finditer(f):
        pl = resolve_place(m.group("p"), city, near, learned)
        if pl and pl["id"] not in seen:
            seen.add(pl["id"])
            out.append({"kind": "at", "place": pl, "confidence": 0.7, "how": "keywords"})
    if dm._CROWD.search(f):
        for m in _MENTION.finditer(f):
            pl = resolve_place(m.group("p"), city, near, learned)
            if pl and pl["id"] not in seen:
                seen.add(pl["id"])
                out.append({"kind": "mentioned", "place": pl, "confidence": 0.45, "how": "keywords"})
    return out


# ── structured intent (the ingestion's own fields, when present) ────────────

INTENT_KEYS = ("intent", "intent_json", "intents", "intents_json")
POSITION_KEYS = ("positions", "positions_json", "position", "position_json")


def _parse(v):
    if v in (None, ""):
        return None
    if isinstance(v, (dict, list)):
        return v
    try:
        return json.loads(v)
    except (TypeError, ValueError):
        return None


def _listify(v) -> list:
    v = _parse(v)
    return [x for x in (v if isinstance(v, list) else [v] if v else []) if isinstance(x, dict)]


def _num(v):
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def norm_when(v, posted: _dt.datetime | None, zone=None) -> tuple[str | None, _dt.datetime | None]:
    """"now" | "HH:MM" (the place's clock, on the post's day) | ISO → (label, UTC start)."""
    if v in (None, ""):
        return None, None
    s = str(v).strip()
    if s.lower() in ("now", "maintenant", "immediately", "asap"):
        return "now", posted
    m = re.fullmatch(r"([01]?\d|2[0-3])[:h]([0-5]\d)?", s)
    if m and posted:
        z = zone or _dt.timezone.utc
        d = posted.astimezone(z).date()
        st = _dt.datetime(d.year, d.month, d.day, int(m.group(1)), int(m.group(2) or 0), tzinfo=z).astimezone(_dt.timezone.utc)
        return st.strftime("%Y-%m-%dT%H:%M:%SZ"), st
    t = dm._utc(s)
    if t:
        return t.strftime("%Y-%m-%dT%H:%M:%SZ"), t
    return None, None


def structured_intents(row: dict, posted_at=None, zone=None, city=None, near=None, learned=None) -> list[dict]:
    """Structured intents on a post (see the module's docstring for the
    shape), normalised like extract_intents' — None-safe on any missing or
    malformed field; a target with neither coordinates nor a resolvable
    name is dropped."""
    posted = dm._utc(posted_at or row.get("posted_at"))
    out = []
    for key in INTENT_KEYS:
        for it in _listify(row.get(key)):
            if str(it.get("kind") or "").lower() == "at":
                continue
            tgt = it.get("target")
            name = tgt.get("name") or tgt.get("place") if isinstance(tgt, dict) else tgt
            lat = _num((tgt or {}).get("lat") if isinstance(tgt, dict) else None) or _num(it.get("target_lat") or it.get("lat"))
            lon = _num((tgt or {}).get("lon") if isinstance(tgt, dict) else None) or _num(it.get("target_lon") or it.get("lon"))
            if lat is not None and lon is not None:
                pl = {"id": f"s:{round(lat, 4)},{round(lon, 4)}", "name": str(name or "named place").split(",")[0].strip(),
                      "city": city_near(lat, lon) or city, "lat": lat, "lon": lon}
                g = resolve_place(name, city, (lat, lon), learned) if name else None
                if g and dm.metres(lat, lon, g["lat"], g["lon"]) <= TARGET_MERGE_M:
                    pl = g
            else:
                pl = resolve_place(name, city, near, learned) if name else None
            if not pl:
                continue
            # telegram_signals' table (telegram_intents) says it as immediate /
            # starts_utc rather than "when": read both shapes
            raw_when = it.get("when") or it.get("when_at") or ("now" if it.get("immediate") in (1, True, "1") else None) or it.get("starts_utc")
            when, start = norm_when(raw_when, posted, zone)
            conf = _num(it.get("confidence"))
            out.append({"act": str(it.get("act") or "gather").lower(), "target": name or pl["name"], "place": pl,
                        "when": when, "start_at": start.strftime("%Y-%m-%dT%H:%M:%SZ") if start else None,
                        "confidence": max(0.0, min(1.0, conf if conf is not None else 0.7)), "how": "model"})
    return out


def structured_positions(row: dict, posted_at=None, city=None, near=None, learned=None) -> list[dict]:
    posted = dm._utc(posted_at or row.get("posted_at"))
    out = []
    items = [x for k in POSITION_KEYS for x in _listify(row.get(k))]
    items += [x for k in INTENT_KEYS for x in _listify(row.get(k)) if str(x.get("kind") or "").lower() == "at"]
    for it in items:
        if str(it.get("kind") or "at").lower() != "at":
            continue
        name = it.get("place") or it.get("target")
        if isinstance(name, dict):
            it = {**it, **name}
            name = name.get("name") or name.get("place")
        lat, lon = _num(it.get("lat")), _num(it.get("lon"))
        if lat is not None and lon is not None:
            pl = {"id": f"s:{round(lat, 4)},{round(lon, 4)}", "name": str(name or "reported position").split(",")[0].strip(),
                  "city": city_near(lat, lon) or city, "lat": lat, "lon": lon}
        else:
            pl = resolve_place(name, city, near, learned) if name else None
        if not pl:
            continue
        at = it.get("at_time")
        t = posted if at in (None, "", "now") else dm._utc(at) or posted
        conf = _num(it.get("confidence"))
        out.append({"kind": "at", "place": pl, "at": t.isoformat() if t else None,
                    "confidence": conf if conf is not None else 0.8, "how": "model"})
    return out


# ── scoring ─────────────────────────────────────────────────────────────────

KIND_BASE = {"call": 1.0, "announced": 0.8, "public_call": 0.7, "heading": 0.6}


def immediacy(call: dict, now: _dt.datetime) -> float:
    """How much a call says "there, soon": now (and said recently) 1; a start
    within the hour or up to 2 h ago 1; 1–3 h ahead 0.6; later 0.25; long
    past halves hourly; no time at all 0.5."""
    at = dm._utc(call.get("at"))
    age = (now - at).total_seconds() / 60 if at else 0
    if call.get("when") == "now":
        return 1.0 if age <= 90 else 0.5
    st = dm._utc(call.get("start_at"))
    if not st:
        return 0.5
    d = (st - now).total_seconds() / 60
    if -120 <= d <= 60:
        return 1.0
    if 60 < d <= 180:
        return 0.6
    if d > 180:
        return 0.25
    return max(0.1, 0.5 ** ((-d - 120) / 60))


def call_weight(call: dict, now: _dt.datetime) -> float:
    at = dm._utc(call.get("at"))
    age = max(0.0, (now - at).total_seconds() / 60) if at else 120.0
    return (KIND_BASE.get(call.get("kind"), 0.7) * float(call.get("confidence") or 0.6)
            * 0.5 ** (age / 120) * immediacy(call, now))


def eta_factor(eta_min: float | None) -> float:
    if eta_min is None:
        return 0.0
    if eta_min <= 15:
        return 1.0
    return max(0.0, 1 - (eta_min - 15) / 45)


def estimate_eta(a: dict, b: dict) -> dict:
    m = dm.metres(a["lat"], a["lon"], b["lat"], b["lon"]) * DETOUR
    return {"min": round(m / (CROWD_KMH * 1000 / 60), 1), "m": round(m), "routed": False}


def score_targets(targets: list[dict], crowds: list[dict], etas: dict, now: _dt.datetime) -> list[dict]:
    """Rank a city's targets. targets: {id, name, lat, lon, calls: [{kind,
    at, when, start_at, confidence, channel}]}; crowds: {id, lat, lon, at,
    place, hhmm, heading_to?}; etas: {(crowd_id, target_id): {min, m,
    routed}} (missing → the straight-line estimate). Each target gets
    score (0..SCORE_CAP, an estimate), C, R, reach [{crowd_id, eta_min,
    routed, heading}], groups_within, explanation. Highest first."""
    out = []
    for t in targets:
        per_ch: dict = {}
        for c in t.get("calls") or []:
            ch = c.get("channel") or c.get("id")
            per_ch[ch] = per_ch.get(ch, 0.0) + call_weight(c, now)
        C = sum(min(CHANNEL_CAP, v) for v in per_ch.values())
        R, reach = 0.0, []
        for g in crowds:
            at = dm._utc(g.get("at"))
            age = (now - at).total_seconds() / 60 if at else 999
            if age > CROWD_MAX_AGE_MIN:
                continue
            d = dm.metres(g["lat"], g["lon"], t["lat"], t["lon"])
            e = {"min": 0.0, "m": round(d), "routed": True} if d <= AT_TARGET_M else (etas.get((g["id"], t["id"])) or estimate_eta(g, t))
            heading = (g.get("heading_to") or {}).get("id") == t.get("place_id", t["id"])
            f = eta_factor(e["min"])
            if f <= 0:
                continue
            r = 0.5 ** (age / 60) * f * (1.5 if heading else 1.0) * min(2.0, math.sqrt(max(1, g.get("n_reports") or 1)) ** 0.5)
            R += r
            reach.append({"crowd_id": g["id"], "eta_min": e["min"], "distance_m": e["m"], "routed": e["routed"],
                          "heading": heading, "there": d <= AT_TARGET_M, "place": g.get("place"), "hhmm": g.get("hhmm"),
                          "age_min": round(age, 1), "weight": round(r, 3)})
        k = 0.25 * C + 0.35 * R + 0.3 * min(C, 3) * min(R, 3) / 3
        score = min(SCORE_CAP, 1 - math.exp(-k))
        reach.sort(key=lambda x: x["eta_min"])
        within = [x for x in reach if x["eta_min"] <= WITHIN_MIN and x["age_min"] <= 120]
        out.append({**t, "score": round(score, 3), "C": round(C, 3), "R": round(R, 3), "reach": reach,
                    "groups_within": len(within), "channels": len(per_ch),
                    "explanation": explain(t, reach, within, now)})
    return sorted(out, key=lambda x: -x["score"])


def _span(minutes: float) -> str:
    return f"{max(1, round(minutes))} min" if minutes < 90 else f"{round(minutes / 60)} h"


def explain(t: dict, reach: list[dict], within: list[dict], now: _dt.datetime) -> str:
    """"named in 6 calls in the last 2 h (4 channels), 3 groups within 25 min
    walk, last seen at Concorde 14:05" — every number from the evidence."""
    parts = []
    calls = [c for c in t.get("calls") or [] if c.get("kind") != "heading"]
    if calls:
        ages = [(now - dm._utc(c["at"])).total_seconds() / 60 for c in calls if dm._utc(c.get("at"))]
        chans = {c.get("channel") for c in calls if c.get("channel")}
        s = f"named in {len(calls)} call{'s' if len(calls) != 1 else ''}"
        if ages:
            s += f" in the last {_span(max(ages))}"
        if len(chans) > 1:
            s += f" ({len(chans)} channels)"
        starts = sorted({c["start_hhmm"] for c in calls if c.get("start_hhmm")})
        if starts:
            s += f", called for {', '.join(starts[:2])}"
        parts.append(s)
    heads = [x for x in reach if x["heading"]]
    if heads:
        parts.append(f"{len(heads)} group{'s' if len(heads) != 1 else ''} said to be heading there")
    there = [x for x in reach if x["there"]]
    if there:
        parts.append(f"{len(there)} group{'s' if len(there) != 1 else ''} already there")
    walking = [x for x in within if not x["there"]]
    if walking:
        parts.append(f"{len(walking)} group{'s' if len(walking) != 1 else ''} within {round(max(x['eta_min'] for x in walking))} min walk"
                     + ("" if all(x["routed"] for x in walking) else " (walking time estimated)"))
    if reach:
        fresh = min(reach, key=lambda x: x["age_min"])
        if fresh.get("place"):
            parts.append(f"last seen at {str(fresh['place']).split(',')[0]} {fresh.get('hhmm') or ''}".strip())
    return ", ".join(parts) or "named, no crowd reported near it yet"


def route_junction(a: list, b: list, tol_m: float = 40.0) -> tuple[int, int] | None:
    """Where route B joins route A: the first point of A (from A's start)
    within tol_m of B, and B's index there. Both [[lat, lon], …] to the same
    target. None when they only meet at the end."""
    if len(a) < 2 or len(b) < 2:
        return None
    step_b = max(1, len(b) // 400)
    bs = b[::step_b]
    for i, p in enumerate(a):
        for j, q in enumerate(bs):
            if abs(p[0] - q[0]) > 0.001 or abs(p[1] - q[1]) > 0.0015:
                continue
            if dm.metres(p[0], p[1], q[0], q[1]) <= tol_m:
                return i, j * step_b
    return None


def _len(coords: list, upto: int | None = None) -> float:
    c = coords[: (upto + 1) if upto is not None else None]
    return sum(dm.metres(c[i - 1][0], c[i - 1][1], c[i][0], c[i][1]) for i in range(1, len(c)))


def junctions(top: dict, routes: list[dict], places: list[dict], steps_of: dict | None = None) -> list[dict]:
    """The points where two crowds' routes to a top target join, at least
    300 m before it: they may meet there first. routes: {crowd_id, coords,
    eta_min, routed} to `top`. → candidates {id, kind: "junction", name,
    lat, lon, crowd_ids, eta_min, score (the target's × 0.6), explanation}."""
    out = []
    rs = [r for r in routes if len(r.get("coords") or []) >= 2]
    for i in range(len(rs)):
        for j in range(i + 1, len(rs)):
            a, b = rs[i], rs[j]
            hit = route_junction(a["coords"], b["coords"])
            if not hit:
                continue
            ia, ib = hit
            p = a["coords"][ia]
            if dm.metres(p[0], p[1], top["lat"], top["lon"]) < 300:
                continue
            la, lb = _len(a["coords"]), _len(b["coords"])
            ea = a["eta_min"] * (_len(a["coords"], ia) / la if la else 0)
            eb = b["eta_min"] * (_len(b["coords"], ib) / lb if lb else 0)
            # its name: a known place within 300 m, else the nearest street a
            # turn of either route names (within 400 m)
            cands = [(dm.metres(p[0], p[1], q["lat"], q["lon"]), q["name"]) for q in places if q.get("lat") is not None]
            cands = [c for c in cands if c[0] <= 300]
            if not cands:
                cands = [(dm.metres(p[0], p[1], st["lat"], st["lon"]), st["street"])
                         for cid in (a["crowd_id"], b["crowd_id"]) for st in (steps_of or {}).get(cid, [])
                         if st.get("street") and st.get("lat") is not None]
                cands = [c for c in cands if c[0] <= 400]
            name = min(cands)[1] if cands else "a junction of their routes"
            jid = f"j:{top['id']}:{round(p[0], 4)},{round(p[1], 4)}"
            if any(x["id"] == jid for x in out):
                continue
            out.append({"id": jid, "kind": "junction", "name": f"Where routes meet: {name}", "lat": p[0], "lon": p[1],
                        "crowd_ids": [a["crowd_id"], b["crowd_id"]], "eta_min": round(max(ea, eb), 1),
                        "score": round(top["score"] * 0.6, 3), "toward": top["id"],
                        "explanation": (f"the walking routes of two groups toward {top['name']} join here, "
                                        f"both could be there within about {round(max(ea, eb))} min; they may meet before {top['name']}")})
    return out


# ── assembling a city ──────────────────────────────────────────────────────

def _ref(x: dict) -> dict:
    return {"id": x.get("id"), "title": x.get("title"), "url": x.get("url"), "source": x.get("source"),
            "published_at": x.get("at"), "place": x.get("place"), "text": (x.get("text") or "")[:300]}


OUTRANK_MIN = 15                 # a self-reported position outranks a second-hand report this much newer
PATH_ROUTE_MIN_M = 150           # a hop of a crowd's path longer than this is routed on foot
MAX_PATH_HOPS = 6                # the newest hops of a path routed, per crowd
REACH_CAP_M = 3000               # how far a crowd may have walked since it was seen, at most


def report_rank(r: dict) -> int:
    """2: a position people reported themselves ("on est à Concorde");
    1: a located crowd report (a geocoded post, a live development);
    0: a place a crowd post only mentions ("foule devant l'Élysée")."""
    if str(r.get("id", "")).startswith("pos-"):
        return 2 if (r.get("position_kind") or "at") == "at" else 0
    return 1


POSITION_WORDS = {2: "reported by people there", 1: "reported", 0: "mentioned in a report"}


def build_crowds(reports: list[dict], now: _dt.datetime, zone_of=None, learned=None) -> list[dict]:
    """Located crowd reports → crowds (link_tracks with single places kept),
    fresh ones only, near-duplicates merged, freshest first. A crowd's place
    is its newest report's, unless people there said where they were less
    than OUTRANK_MIN before it and the newer report is second-hand: then
    theirs (the later one is kept in "outranked"). Its age is the time since
    that report was posted, never since it was read."""
    rank_of = {r.get("id"): report_rank(r) for r in reports}
    tracks = dm.link_tracks(reports, now, zone_of, min_nodes=1)
    crowds = []
    for t in tracks:
        pts = t["points"]
        pr = [max((rank_of.get(s.get("id"), 1) for s in p.get("sources") or []), default=1) for p in pts]
        li, t_last = len(pts) - 1, dm._utc(pts[-1]["at"])
        for i in range(len(pts) - 2, -1, -1):
            if (t_last - dm._utc(pts[i]["at"])).total_seconds() > OUTRANK_MIN * 60:
                break
            if pr[i] == 2 and pr[-1] < 2:
                li = i
                break
        lp = pts[li]
        at = lp["at"]
        age = round((now - dm._utc(at)).total_seconds() / 60, 1)
        if age > CROWD_MAX_AGE_MIN:
            continue
        zone = None
        if zone_of:
            try:
                zone = zone_of(t["country"])
            except Exception:                                  # noqa: BLE001
                zone = None
        srcs = (lp.get("sources") or [])[-6:]
        text = " ".join(s.get("text") or "" for s in srcs[-3:])
        city = city_near(lp["lat"], lp["lon"]) or dm.city_of(lp["place"]) or t.get("city", "").lower()
        heading_to = None
        for d in dm.destinations(text):
            pl = resolve_place(d, city, (lp["lat"], lp["lon"]), learned)
            if pl and dm.metres(pl["lat"], pl["lon"], lp["lat"], lp["lon"]) > AT_TARGET_M:
                heading_to = pl
                break
        crowds.append({
            "id": f"crowd-{t['id'][3:]}", "track_id": t["id"], "city": city, "country": t["country"],
            "lat": lp["lat"], "lon": lp["lon"], "place": lp["place"], "at": at, "hhmm": dm.hhmm(at, zone),
            "age_min": age, "last_report_at": t["last_at"], "n_reports": t["n_reports"],
            "heading_deg": t["heading_deg"] if li == len(pts) - 1 else None,
            "heading_to": heading_to, "self_reported": pr[li] == 2, "position": POSITION_WORDS[pr[li]],
            "path": [{"lat": p["lat"], "lon": p["lon"], "at": p["at"], "place": p["place"]} for p in pts[:li + 1]],
            "segments": t["segments"][:li], "sources": srcs,
            "outranked": [{"place": p["place"], "at": p["at"], "position": POSITION_WORDS[pr[li + 1 + k]]}
                          for k, p in enumerate(pts[li + 1:])],
        })
    crowds.sort(key=lambda g: dm._utc(g["at"]), reverse=True)
    kept: list[dict] = []
    for g in crowds:
        twin = next((k for k in kept if dm.metres(k["lat"], k["lon"], g["lat"], g["lon"]) <= MERGE_M
                     and abs((dm._utc(k["at"]) - dm._utc(g["at"])).total_seconds()) <= MERGE_MIN * 60), None)
        if twin:
            twin["n_reports"] += g["n_reports"]
            twin["sources"] = (twin["sources"] + g["sources"])[-8:]
            twin.setdefault("merged", []).append(g["id"])
            twin["heading_to"] = twin["heading_to"] or g["heading_to"]
            # people there said where they were, a little before a second-hand report: theirs
            if g["self_reported"] and not twin["self_reported"] \
                    and (dm._utc(twin["at"]) - dm._utc(g["at"])).total_seconds() <= OUTRANK_MIN * 60:
                twin["outranked"] = twin["outranked"] + [{"place": twin["place"], "at": twin["at"], "position": twin["position"]}]
                for k in ("lat", "lon", "place", "at", "hhmm", "age_min", "self_reported", "position"):
                    twin[k] = g[k]
            if len(g["path"]) > len(twin["path"]):
                twin["path"], twin["segments"] = g["path"], g["segments"]
            continue
        kept.append(g)
    return kept


def path_legs(path: list[dict], routed_hop) -> list[dict]:
    """A crowd's path as legs between its reported places: a hop longer than
    PATH_ROUTE_MIN_M on the walking route (routed_hop(a, b) → [[lat, lon], …]
    or None while not routed), else a straight line — "estimated" when it is
    long enough that the streets matter. Only the newest MAX_PATH_HOPS hops
    are routed."""
    legs = []
    n = len(path)
    for i in range(1, n):
        a, b = path[i - 1], path[i]
        d = dm.metres(a["lat"], a["lon"], b["lat"], b["lon"])
        coords = None
        if d > PATH_ROUTE_MIN_M and i > n - 1 - MAX_PATH_HOPS:
            coords = routed_hop(a, b)
        if coords and len(coords) >= 2:
            c = [[float(x[0]), float(x[1])] for x in coords]
            if dm.metres(c[0][0], c[0][1], a["lat"], a["lon"]) > 1:
                c.insert(0, [a["lat"], a["lon"]])
            if dm.metres(c[-1][0], c[-1][1], b["lat"], b["lon"]) > 1:
                c.append([b["lat"], b["lon"]])
            legs.append({"i": i - 1, "coords": c, "routed": True, "estimated": False, "distance_m": round(_len(c))})
        else:
            legs.append({"i": i - 1, "coords": [[a["lat"], a["lon"]], [b["lat"], b["lon"]]], "routed": False,
                         "estimated": d > PATH_ROUTE_MIN_M, "distance_m": round(d)})
    return legs


def _along(coords: list, s: float) -> tuple[list, list]:
    """The point s metres along a line, and the line up to it."""
    trail = [list(coords[0])]
    for i in range(1, len(coords)):
        a, b = coords[i - 1], coords[i]
        d = dm.metres(a[0], a[1], b[0], b[1])
        if d >= s and d > 0:
            f = s / d
            p = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
            trail.append(p)
            return p, trail
        s -= d
        trail.append(list(b))
    return list(coords[-1]), trail


def now_estimate(g: dict, now: _dt.datetime, lines: list[dict]) -> tuple[dict | None, int]:
    """Where a crowd probably is now: from its last reported place, walked at
    CROWD_KMH for its age (the time since that report) along the way it
    said it was going (heading_to) or, failing that, its route toward the
    top convergence point — the walking route when routed, else the straight
    line (shortened by DETOUR) — and never past the destination. → (now_est
    {lat, lon, basis: "heading_to"|"convergence", to, routed, arrived,
    advanced_m, trail, age_min} or None without a direction, reach_m: how
    far it could be by now in any direction, capped at REACH_CAP_M)."""
    at = dm._utc(g.get("at"))
    age = max(0.0, (now - at).total_seconds() / 60) if at else 0.0
    walk = age * CROWD_KMH * 1000 / 60
    reach = round(min(REACH_CAP_M, walk))
    h = g.get("heading_to")
    mine = [ln for ln in lines if ln["crowd_id"] == g["id"] and len(ln.get("coords") or []) >= 2]
    if h:
        ln = next((x for x in mine if x["target_id"] == f"tgt-{h['id']}"), None)
        basis, to = "heading_to", h.get("name")
        coords = ln["coords"] if ln else [[g["lat"], g["lon"]], [h["lat"], h["lon"]]]
        routed = bool(ln and ln.get("routed"))
    elif mine:
        ln = mine[0]
        basis, to, coords, routed = "convergence", ln.get("target_name"), ln["coords"], bool(ln.get("routed"))
    else:
        return None, reach
    total = _len(coords)
    if total <= 0:
        return None, reach
    s = min(total, walk if routed else walk / DETOUR)
    p, trail = _along(coords, s)
    return ({"lat": round(p[0], 6), "lon": round(p[1], 6), "basis": basis, "to": to, "routed": routed,
             "arrived": s >= total - 1, "advanced_m": round(s), "trail": [[round(x[0], 6), round(x[1], 6)] for x in trail],
             "age_min": round(age, 1), "kmh": CROWD_KMH}, reach)


def build_targets(calls: list[dict]) -> list[dict]:
    """Calls (each with a resolved place) → targets: one per place (same
    id, or within TARGET_MERGE_M)."""
    out: list[dict] = []
    for c in sorted(calls, key=lambda c: c.get("at") or ""):
        pl = c["place"]
        t = next((x for x in out if x["place_id"] == pl["id"]
                  or dm.metres(x["lat"], x["lon"], pl["lat"], pl["lon"]) <= TARGET_MERGE_M), None)
        if not t:
            t = {"id": f"tgt-{pl['id']}", "place_id": pl["id"], "kind": "target", "name": pl["name"], "city": pl.get("city"),
                 "lat": pl["lat"], "lon": pl["lon"], "calls": [], "acts": []}
            out.append(t)
        t["calls"].append(c)
        if c.get("act") and c["act"] not in t["acts"]:
            t["acts"].append(c["act"])
    return out


def city_model(city: str, crowds: list[dict], calls: list[dict], developments: list[dict], etas: dict,
               routes: dict, now: _dt.datetime, places: list[dict] | None = None) -> dict:
    """One city's situation from its parts (pure): crowds, calls → targets,
    scored with `etas`; routes {(crowd_id, target_id): {coords, eta_min,
    distance_m, routed, steps?}} drawn for the top points."""
    crowds = crowds[:MAX_CROWDS]
    targets = build_targets(calls)
    # a crowd's own heading is a (soft) call for that place
    for g in crowds:
        h = g.get("heading_to")
        if h:
            targets_calls = [{"kind": "heading", "act": "march", "place": h, "at": g["at"], "when": "now", "confidence": 0.6,
                              "channel": f"crowd:{g['id']}", "id": f"head-{g['id']}", "title": f"Crowd at {str(g['place']).split(',')[0]} heading to {h['name']}",
                              "source": "Reconstructed from Telegram reports", "url": None}]
            targets = build_targets([c for t in targets for c in t["calls"]] + targets_calls)
    ranked = score_targets(targets, crowds, etas, now)[:MAX_TARGETS]
    lines, top = [], [t for t in ranked if t["score"] >= 0.15][:3]
    for t in top:
        for r in t["reach"]:
            if r["there"] or len(lines) >= MAX_ROUTE_LINES:
                continue
            g = next((x for x in crowds if x["id"] == r["crowd_id"]), None)
            if not g:
                continue
            rt = routes.get((g["id"], t["id"]))
            coords = rt["coords"] if rt and rt.get("coords") else [[g["lat"], g["lon"]], [t["lat"], t["lon"]]]
            lines.append({"id": f"route-{g['id']}-{t['id']}", "crowd_id": g["id"], "target_id": t["id"], "target_name": t["name"], "coords": coords,
                          "eta_min": r["eta_min"], "distance_m": r["distance_m"], "routed": bool(rt and rt.get("coords")),
                          "label": f"{round(r['eta_min'])} min walk to {t['name']}" + ("" if rt and rt.get("coords") else " (straight line, estimated)"),
                          "steps": (rt or {}).get("steps") or []})
    juncs = []
    for t in top[:1]:
        rts = [ln for ln in lines if ln["target_id"] == t["id"] and ln["routed"]]
        juncs = junctions(t, rts, places or [], {ln["crowd_id"]: ln["steps"] for ln in rts})
    for ln in lines:
        ln.pop("steps", None)
    for g in crowds:
        g["now_est"], g["reach_m"] = now_estimate(g, now, lines)
    convergence = sorted([{**t, "kind": "target"} for t in ranked if t["score"] >= 0.1] + juncs, key=lambda x: -x["score"])[:5]
    for i, c in enumerate(convergence):
        c["rank"] = i + 1
    two_h, one_h = now - _dt.timedelta(hours=2), now - _dt.timedelta(hours=1)
    lat = sum(g["lat"] for g in crowds) / len(crowds) if crowds else (ranked[0]["lat"] if ranked else None)
    lon = sum(g["lon"] for g in crowds) / len(crowds) if crowds else (ranked[0]["lon"] if ranked else None)
    return {
        "city": city, "center": {"lat": lat, "lon": lon} if lat is not None else None,
        "crowds": crowds, "targets": ranked, "convergence": convergence, "routes": lines,
        "developments": developments[:20],
        "counts": {"crowds": len(crowds),
                   "calls_2h": sum(1 for c in calls if (dm._utc(c.get("at")) or now) >= two_h),
                   "reports_1h": sum(1 for d in developments if (dm._utc(d.get("at")) or now) >= one_h),
                   "targets": len(ranked)},
    }


def summary(model: dict, now: _dt.datetime) -> dict:
    """"What is happening in <city> now", compact."""
    cv = model.get("convergence") or []
    c = model.get("counts") or {}
    head = f"{c.get('crowds', 0)} crowd{'s' if c.get('crowds', 0) != 1 else ''} reported"
    if cv:
        head += f"; most likely convergence: {cv[0]['name']} (estimate {round(cv[0]['score'] * 100)}%)"
    return {"city": model["city"], "headline": head, "counts": c,
            "crowds": [{"place": str(g["place"]).split(",")[0], "hhmm": g["hhmm"], "age_min": g["age_min"],
                        "heading_to": (g.get("heading_to") or {}).get("name"), "n_reports": g["n_reports"]} for g in model["crowds"]],
            "convergence": [{"name": x["name"], "score": x["score"], "explanation": x["explanation"]} for x in cv[:3]],
            "latest": [{k: d.get(k) for k in ("at", "hhmm", "kind", "place", "title", "url", "source")} for d in model["developments"][:10]],
            "estimate_note": ESTIMATE}


# ── reads (blocking) ───────────────────────────────────────────────────────

@functools.lru_cache(maxsize=256)
def _zone(cc):
    try:
        import telegram_events as te
        return te.zone_for(None, cc)
    except Exception:                                          # noqa: BLE001
        return None


def _hhmm(at, cc) -> str:
    return dm.hhmm(at, _zone(cc))


_EXTRACTED: dict = {}


def gather(now: _dt.datetime, posts: list[dict], situations_reports: list[dict], hazards: list[dict],
           extra_places: list[dict] | None = None, intent_rows: dict | None = None) -> dict:
    """The inputs, read, into per-city parts (pure but for nothing): posts
    (telegram_posts rows as dicts, any columns), the movement layer's
    located crowd reports, the planner's hazards (announced gatherings,
    public calls), places known from the data. → {city: {reports, calls,
    developments}}, learned places."""
    learned = [p for p in (extra_places or []) if p]
    for r in posts:
        if r.get("lat") is not None and (r.get("precision") or "") in dm.PRECISE and r.get("place"):
            lp = learned_place(f"p:{dm.fold(str(r['place']).split(',')[0])}", r["place"], r["lat"], r["lon"])
            if lp and not any(x["id"] == lp["id"] for x in learned):
                learned.append(lp)
    reports = list(situations_reports)
    calls: list[dict] = []
    seen_pos = {(x.get("post"), round(x["lat"], 3), round(x["lon"], 3)) for x in reports}
    for r in posts:
        text = " ".join(x for x in (r.get("headline"), r.get("summary_en"), r.get("text")) if x)
        cc = (r.get("country_code") or "").lower()
        near = (r["lat"], r["lon"]) if r.get("lat") is not None else None
        city = city_near(*near) if near else None
        city = city or dm.city_of(r.get("place")) or None
        zone = _zone(cc)
        post = f"{r.get('channel')}/{r.get('msg_id')}"
        url = None if str(r.get("channel")).startswith("c/") else f"https://t.me/{r.get('channel')}/{r.get('msg_id')}"
        base = {"post": post, "url": url, "source": f"Telegram · {r.get('channel_title') or r.get('channel')}",
                "channel": r.get("channel"), "at": r.get("posted_at"), "text": text[:600],
                "title": r.get("headline") or (r.get("summary_en") or "")[:120] or "Telegram post", "country": cc}
        extra = (intent_rows or {}).get(post) or {}
        row = {**r, **extra}
        ints = structured_intents(row, r.get("posted_at"), zone, city, near, learned)
        poss = structured_positions(row, r.get("posted_at"), city, near, learned)
        if not ints or not poss:
            # a post does not change: its reading is kept (the learned places
            # only grow, and their count is in the key)
            key = (post, r.get("posted_at"), len(text), len(learned), city)
            hit = _EXTRACTED.get(key)
            # a reading that waited for a street lookup is read again once one is back
            if hit is not None and hit[2] is not None and hit[2] != _GEO_GEN[0]:
                hit = None
            if hit is None:
                waits, gen = GEO_STATS["waiting_reads"], _GEO_GEN[0]
                f = dm.fold(text[:TEXT_MAX])
                fi = extract_intents(f, r.get("posted_at"), zone, city, near, learned, folded=True)
                fp = extract_positions(f, city, near, learned, exclude={i["place"]["id"] for i in (ints or fi)}, folded=True)
                if len(_EXTRACTED) > 20_000:
                    _EXTRACTED.clear()
                hit = _EXTRACTED[key] = (fi, fp, gen if GEO_STATS["waiting_reads"] != waits else None)
            ints = ints or hit[0]
            poss = poss or hit[1]
        for i, it in enumerate(ints):
            st = dm._utc(it.get("start_at"))
            calls.append({**base, **it, "id": f"call-{post}-{i}", "kind": "call",
                          "start_hhmm": dm.hhmm(st, zone) if st and it.get("when") != "now" else None,
                          "city": it["place"].get("city") or city})
        for i, p in enumerate(poss):
            pl = p["place"]
            k = (post, round(pl["lat"], 3), round(pl["lon"], 3))
            if k in seen_pos:
                continue
            seen_pos.add(k)
            reports.append({**base, "id": f"pos-{post}-{i}", "lat": pl["lat"], "lon": pl["lon"], "at": p.get("at") or r.get("posted_at"),
                            "place": f"{pl['name']}, {(pl.get('city') or city or '').title()}, {cc.upper()}".strip(", "),
                            "position_kind": p["kind"], "confidence": p["confidence"], "how": p["how"]})
    for h in hazards:
        if h.get("kind") not in ("gathering", "march", "call") or h.get("lat") is None:
            continue
        pl = {"id": f"h:{round(h['lat'], 4)},{round(h['lon'], 4)}", "name": str(h.get("place") or h.get("what") or "called place").split(",")[0],
              "city": city_near(h["lat"], h["lon"]) or dm.city_of(h.get("place")), "lat": h["lat"], "lon": h["lon"]}
        g = resolve_place(h.get("place"), pl["city"], (h["lat"], h["lon"]), learned)
        if g and dm.metres(g["lat"], g["lon"], h["lat"], h["lon"]) <= TARGET_MERGE_M:
            pl = g
        st = dm._utc(h.get("starts_utc"))
        calls.append({"id": f"hz-{h['id']}", "kind": "announced" if h.get("starts_utc") else "public_call",
                      "act": "march" if h["kind"] == "march" else "gather", "place": pl, "at": h.get("at") or now.isoformat(),
                      "when": h.get("starts_utc"), "start_at": h.get("starts_utc"), "confidence": 0.8,
                      "start_hhmm": dm.hhmm(st, _zone("fr" if pl["city"] in CITY_CENTRES else None)) if st else None,
                      "channel": (h.get("source") or {}).get("label"), "title": h.get("what"), "url": (h.get("source") or {}).get("url"),
                      "source": (h.get("source") or {}).get("label"), "text": h.get("what"), "city": pl["city"]})
    cities: dict = {}

    def city_of_item(x):
        return (city_near(x.get("lat"), x.get("lon")) if x.get("lat") is not None else None) or x.get("city") \
            or dm.city_of(x.get("place")) or "elsewhere"

    for x in reports:
        c = cities.setdefault(city_of_item(x), {"reports": [], "calls": [], "devs": []})
        c["reports"].append(x)
        c["devs"].append({"at": x.get("at"), "kind": "position" if str(x["id"]).startswith("pos-") else "crowd",
                          "place": x.get("place"), "title": x.get("title"), "text": (x.get("text") or "")[:240],
                          "url": x.get("url"), "source": x.get("source"), "lat": x.get("lat"), "lon": x.get("lon"),
                          "country": x.get("country")})
    for x in calls:
        pl = x["place"]
        c = cities.setdefault(city_near(pl["lat"], pl["lon"]) or pl.get("city") or x.get("city") or "elsewhere",
                              {"reports": [], "calls": [], "devs": []})
        c["calls"].append(x)
        c["devs"].append({"at": x.get("at"), "kind": "call" if x["kind"] == "call" else "announced",
                          "place": pl["name"], "title": x.get("title"), "text": (x.get("text") or "")[:240],
                          "url": x.get("url"), "source": x.get("source"), "lat": pl["lat"], "lon": pl["lon"],
                          "act": x.get("act"), "when": x.get("when"), "country": x.get("country")})
    for c in cities.values():
        c["devs"].sort(key=lambda d: d.get("at") or "", reverse=True)
        for d in c["devs"]:
            d["hhmm"] = _hhmm(d.get("at"), d.get("country") or "fr")
    return {"cities": cities, "learned": learned}


def read_inputs(now: _dt.datetime) -> dict:
    """Everything the model reads, in one go (blocking: SQLite, a JSON file)."""
    import telegram_events as te
    cutoff = (now - _dt.timedelta(hours=LOOKBACK_H)).isoformat()
    con = te._con()
    con.row_factory = sqlite3.Row
    posts, intent_rows = [], {}
    try:
        posts = [dict(r) for r in con.execute("SELECT * FROM telegram_posts WHERE posted_at >= ? ORDER BY posted_at LIMIT 4000", (cutoff,))]
        has = con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='telegram_intents'").fetchone()
        if has:
            for r in con.execute("SELECT * FROM telegram_intents WHERE posted_at >= ? LIMIT 4000", (cutoff,)):
                d = dict(r)
                k = f"{d.get('channel')}/{d.get('msg_id')}"
                slot = intent_rows.setdefault(k, {"intents": [], "positions": []})
                if str(d.get("kind") or "").lower() == "at":
                    slot["positions"].append({**d, "place": d.get("place") or d.get("target")})
                else:
                    slot["intents"].append(d)
    finally:
        con.close()
    reports = dm.read_reports(now)
    hazards = []
    try:
        hazards = dm.current(now)
    except Exception as ex:                                    # noqa: BLE001
        print(f"[demo-situation] error: hazards: {type(ex).__name__}: {ex}", flush=True)
    places = []
    try:
        import endangered_places as ep
        for p in ep.load_places().get("places") or []:
            if p.get("lat") is not None and not p.get("approx") and p.get("model_type") != "city":
                places.append(learned_place(f"ep:{p.get('id')}", p.get("name") or "", p["lat"], p["lon"], dm.fold(p.get("city") or "") or None))
    except Exception as ex:                                    # noqa: BLE001
        print(f"[demo-situation] error: places: {type(ex).__name__}: {ex}", flush=True)
    return {"posts": posts, "reports": reports, "hazards": hazards, "places": places, "intent_rows": intent_rows}


# ── routing (async, bounded, cached) ───────────────────────────────────────

_tasks: dict[str, asyncio.Task] = {}
ROUTING_LOG = {"table_calls": 0, "route_calls": 0, "failures": 0}


def _table_url(sources: list[dict], dests: list[dict]) -> str:
    import safe_route as sr
    base = sr.OSRM_URLS["foot"].replace("/route/v1/", "/table/v1/")
    pts = ";".join(f"{p['lon']:.5f},{p['lat']:.5f}" for p in sources + dests)
    n = len(sources)
    return (f"{base}/{pts}?sources={';'.join(str(i) for i in range(n))}"
            f"&destinations={';'.join(str(n + i) for i in range(len(dests)))}&annotations=duration,distance")


async def osrm_table(sources: list[dict], dests: list[dict]) -> dict | None:
    """Walking time and distance from every source to every destination, in
    ONE request (OSRM table, routed-foot). {(i, j): (seconds, metres)}; None
    when the router failed. Cached with the planner's routes."""
    import safe_route as sr
    url = _table_url(sources, dests)
    key = "ot:" + url
    hit = sr._cache_get(key)
    if hit is not None:
        return hit
    t0 = time.monotonic()
    ROUTING_LOG["table_calls"] += 1
    try:
        r = await sr._request("GET", url, "osrm")
        d = r.json()
    except Exception as e:                                     # noqa: BLE001
        ROUTING_LOG["failures"] += 1
        sr._log("osrm-table", False, (time.monotonic() - t0) * 1000, f"{type(e).__name__}: {e}")
        return None
    if r.status_code != 200 or d.get("code") != "Ok":
        ROUTING_LOG["failures"] += 1
        sr._log("osrm-table", False, (time.monotonic() - t0) * 1000, f"HTTP {r.status_code} {d.get('code')}")
        return None
    out = {}
    for i, row in enumerate(d.get("durations") or []):
        for j, s in enumerate(row):
            m = ((d.get("distances") or [[]])[i] or [None] * len(row))[j] if d.get("distances") else None
            if s is not None:
                out[(i, j)] = (float(s), float(m) if m is not None else None)
    sr._log("osrm-table", True, (time.monotonic() - t0) * 1000, f"foot {len(sources)}×{len(dests)}")
    sr._cache_put(key, out)
    return out


def _table_cached(sources, dests):
    import safe_route as sr
    return sr._cache_get("ot:" + _table_url(sources, dests))


def _route_key(g, t) -> str:
    import safe_route as sr
    return ("o:" + f"{sr.OSRM_URLS['foot']}/{g['lon']:.6f},{g['lat']:.6f};{t['lon']:.6f},{t['lat']:.6f}"
            "?overview=full&geometries=geojson&steps=true&alternatives=true")


NEW_REQUESTS_PER_PASS = 4       # the router is FOSSGIS's, one request a second, shared with "Get me out"
PLANNER_BUSY_S = 3.0            # the OSRM queue already this far ahead: a person's evacuation plan is waiting; wait too


def _spawn(key: str, factory, quota: list) -> asyncio.Task | None:
    """One background request per key: one not back within the budget keeps
    going, and the next poll finds it in the cache. At most quota[0] new
    requests a pass, and none while the planner's own queue is backed up —
    a convergence line can wait 30 s; somebody's way out cannot."""
    t = _tasks.get(key)
    if t is not None and not t.done():
        return t
    import safe_route as sr
    if quota[0] <= 0 or sr._next_slot.get("osrm", 0.0) - time.monotonic() > PLANNER_BUSY_S:
        return None
    quota[0] -= 1
    t = asyncio.ensure_future(factory())
    _tasks[key] = t
    t.add_done_callback(lambda _t, k=key: _tasks.pop(k, None) if _tasks.get(k) is _t else None)
    return t


async def _walk(g: dict, t: dict):
    import safe_route as sr
    ROUTING_LOG["route_calls"] += 1
    return await sr.osrm((g["lat"], g["lon"]), {"lat": t["lat"], "lon": t["lon"], "name": t.get("name")}, "foot")


def hops_to_route(path: list[dict]) -> list[tuple[dict, dict]]:
    """The hops of a crowd's path that path_legs routes: longer than
    PATH_ROUTE_MIN_M, the newest MAX_PATH_HOPS, newest first."""
    n = len(path)
    out = []
    for i in range(n - 1, max(0, n - 1 - MAX_PATH_HOPS), -1):
        a, b = path[i - 1], path[i]
        if dm.metres(a["lat"], a["lon"], b["lat"], b["lon"]) > PATH_ROUTE_MIN_M:
            out.append((a, b))
    return out


def cached_hop(a: dict, b: dict) -> list | None:
    """A hop's walking route from the planner's cache (None: not routed yet,
    or the router found none)."""
    import safe_route as sr
    hit = sr._cache_get(_route_key(a, b))
    return hit[0]["coords"] if hit else None


def etas_from_table(crowds, targets, table) -> dict:
    out = {}
    for i, g in enumerate(crowds):
        for j, t in enumerate(targets):
            v = (table or {}).get((i, j))
            if v:
                out[(g["id"], t["id"])] = {"min": round(v[0] / 60 * CROWD_SLOW, 1), "m": round(v[1]) if v[1] is not None else None,
                                           "routed": True}
    return out


_memo: dict = {}
_lock = asyncio.Lock()


async def situation(now: _dt.datetime | None = None, city: str | None = None) -> dict:
    """The situation of every active city (memoised MEMO_S; concurrent
    callers share one computation)."""
    if now is None:
        hit = _memo.get("v")
        if hit and time.time() - hit[0] < MEMO_S:
            return _filter(hit[1], city)
    async with _lock:
        if now is None:
            hit = _memo.get("v")
            if hit and time.time() - hit[0] < MEMO_S:
                return _filter(hit[1], city)
        out = await _compute(now or _dt.datetime.now(_dt.timezone.utc))
        if now is None:
            _memo["v"] = (time.time(), out)
    return _filter(out, city)


def _filter(out: dict, city: str | None) -> dict:
    if not city:
        return out
    c = dm.fold(city)
    return {**out, "cities": [x for x in out["cities"] if x["city"] == c]}


async def _compute(now: _dt.datetime) -> dict:
    t0 = time.monotonic()
    inp = await asyncio.to_thread(read_inputs, now)
    parts = gather(now, inp["posts"], inp["reports"], inp["hazards"], inp["places"], inp["intent_rows"])
    zone_of = _zone
    staged = []
    for name, c in parts["cities"].items():
        crowds = build_crowds(c["reports"], now, zone_of, parts["learned"])[:MAX_CROWDS]
        calls = [x for x in c["calls"] if (now - (dm._utc(x.get("at")) or now)).total_seconds() / 60 <= CALL_MAX_AGE_MIN]
        if not crowds and not calls:
            continue
        staged.append((name, crowds, calls, c["devs"]))
    staged.sort(key=lambda s: -(len(s[1]) * 2 + len(s[2])))
    # ROUTING: one table per busy city, then the route lines of the top points.
    pending, quota = [], [NEW_REQUESTS_PER_PASS]
    etas_by_city, routes_by_city = {}, {}
    for idx, (name, crowds, calls, _devs) in enumerate(staged):
        tg = build_targets(calls)[:MAX_TARGETS]
        heads = [g["heading_to"] for g in crowds if g.get("heading_to")]
        tg += [{"id": f"tgt-{h['id']}", "lat": h["lat"], "lon": h["lon"], "name": h["name"]} for h in heads
               if not any(x["id"] == f"tgt-{h['id']}" for x in tg)]
        tg = tg[:MAX_TARGETS]
        etas = {}
        if crowds and tg and idx < ROUTED_CITIES and name != "elsewhere":
            table = _table_cached(crowds, tg)
            if table is None:
                pending.append(_spawn("ot:" + _table_url(crowds, tg), lambda c=crowds, t=tg: osrm_table(c, t), quota))
            etas = etas_from_table(crowds, tg, table)
        etas_by_city[name] = (etas, tg)
    pending = [p for p in pending if p]
    if pending:
        await asyncio.wait(pending, timeout=max(0.05, ROUTING_BUDGET_S - (time.monotonic() - t0)))
        for idx, (name, crowds, calls, _devs) in enumerate(staged):
            etas, tg = etas_by_city[name]
            if crowds and tg and not etas:
                table = _table_cached(crowds, tg)
                etas_by_city[name] = (etas_from_table(crowds, tg, table), tg)
    import safe_route as sr
    cities, pending = [], []
    for idx, (name, crowds, calls, devs) in enumerate(staged):  # the quota carries on from the tables
        etas = etas_by_city[name][0]
        model = city_model(name, crowds, calls, devs, etas, {}, now, parts["learned"] + [
            {"name": g["name"], "lat": g["lat"], "lon": g["lon"]} for g in _GAZ if g["city"] == name])
        routes = {}
        if idx < ROUTED_CITIES and name != "elsewhere":
            for ln in model["routes"]:
                g = next(x for x in crowds if x["id"] == ln["crowd_id"])
                t = next(x for x in model["targets"] if x["id"] == ln["target_id"])
                hit = sr._cache_get(_route_key(g, t))
                if hit:
                    routes[(g["id"], t["id"])] = {"coords": hit[0]["coords"], "steps": hit[0].get("steps")}
                elif hit is None:
                    pending.append(_spawn(_route_key(g, t), lambda g=g, t=t: _walk(g, t), quota))
            # then the crowds' own paths, hop by hop, with what the quota has left
            for g in crowds:
                for a, b in hops_to_route(g["path"]):
                    k = _route_key(a, b)
                    if sr._cache_get(k) is None:
                        pending.append(_spawn(k, lambda a=a, b=b: _walk(a, {"lat": b["lat"], "lon": b["lon"],
                                                                              "name": str(b.get("place") or "").split(",")[0]}), quota))
        routes_by_city[name] = routes
        cities.append((name, crowds, calls, devs, etas, model))
    pending = [p for p in pending if p]
    if pending:
        await asyncio.wait(pending, timeout=max(0.05, ROUTING_BUDGET_S + 0.3 - (time.monotonic() - t0)))
    out_cities = []
    for idx, (name, crowds, calls, devs, etas, model) in enumerate(cities):
        routes = routes_by_city[name]
        for ln in model["routes"]:
            if (ln["crowd_id"], ln["target_id"]) in routes:
                continue
            g = next(x for x in crowds if x["id"] == ln["crowd_id"])
            t = next(x for x in model["targets"] if x["id"] == ln["target_id"])
            hit = sr._cache_get(_route_key(g, t))
            if hit:
                routes[(g["id"], t["id"])] = {"coords": hit[0]["coords"], "steps": hit[0].get("steps")}
        if routes:
            model = city_model(name, crowds, calls, devs, etas, routes, now, parts["learned"] + [
                {"name": g["name"], "lat": g["lat"], "lon": g["lon"]} for g in _GAZ if g["city"] == name])
        routed_city = idx < ROUTED_CITIES and name != "elsewhere"
        for g in model["crowds"]:
            g["path_legs"] = path_legs(g["path"], cached_hop if routed_city else (lambda a, b: None))
        model["country"] = next((g.get("country") for g in crowds if g.get("country")), "")
        model["routing"] = {"etas_routed": sum(1 for v in etas.values() if v["routed"]),
                            "lines_routed": sum(1 for ln in model["routes"] if ln["routed"]),
                            "lines": len(model["routes"]),
                            "path_legs_routed": sum(1 for g in model["crowds"] for x in g["path_legs"] if x["routed"]),
                            "path_legs_estimated": sum(1 for g in model["crowds"] for x in g["path_legs"] if x["estimated"])}
        out_cities.append(model)
    return {"generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "cities": out_cities,
            "estimate_note": ESTIMATE, "note": dm.RECONSTRUCTED,
            "routing": {"pending": sum(1 for t in _tasks.values() if not t.done()), **ROUTING_LOG,
                        "attribution": "© OpenStreetMap contributors · routing by FOSSGIS (OSRM)"},
            "params": {"lookback_h": LOOKBACK_H, "crowd_max_age_min": CROWD_MAX_AGE_MIN, "within_min": WITHIN_MIN,
                       "crowd_kmh": CROWD_KMH, "crowd_slow": CROWD_SLOW, "memo_s": MEMO_S},
            "took_ms": round((time.monotonic() - t0) * 1000)}


async def now_summary(city: str | None = None, now: _dt.datetime | None = None) -> dict:
    s = await situation(now, city)
    t = now or _dt.datetime.now(_dt.timezone.utc)
    return {"generated_at": s["generated_at"], "cities": [summary(c, t) for c in s["cities"]]}
