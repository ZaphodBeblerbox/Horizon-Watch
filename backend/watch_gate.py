"""
watch_gate.py — model calls only for what someone watches (owner, 2026-10-23).

"Be smart, don't fire the OpenAI API on everything." A post is worth a
model call (live_incident's extractor) only when it may concern at least
one user's profile: their theaters, assets, position or watched countries
(user_concern.py), as a UNION over every user, computed once (cached
WATCH_TTL_S) — never per user per post. Posts nobody watches get the cheap
rule path only (telegram_ingest's rule reading, live_incident.rule_decide).

PRIORITY. Within the watched posts, those in a FOCUS area go first: a
city-scale theater (reach <= FOCUS_KM, e.g. "Paris Watch"), a user's own
position or an asset — the places someone is looking at closely — and posts
with protest words there (Paris, Saturday 2026-10-24).

BEFORE THE MODEL there is no extracted place, so a post is judged by its
hints: the chat's country (telegram_channels.json), the post's own country
and coordinates when an earlier reading set them, a square or street the
gazetteers know in its words (protest_status.place_in, street_reports.place_in),
and the watched countries' names in its text. A post with no hint at all is
not watched. When no user has a profile yet the gate is open (a fresh
install must not go blind).

Counts go to live_incident.STATUS (model calls spent / skipped_not_watched)
and to /api/telegram/status > watch_gate.
"""
from __future__ import annotations

import math
import re
import threading
import time
import unicodedata

WATCH_TTL_S = 300
FOCUS_KM = 400.0
SAMPLE_BEARINGS = 12

_lock = threading.Lock()
_cache: dict = {"at": 0.0, "v": None}
STATUS = {"watched": 0, "not_watched": 0, "focus": 0, "users_with_profile": None, "countries": None, "built_at": None,
          "last_error": None}


def _fold(s: str | None) -> str:
    t = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in t if not unicodedata.combining(c)).lower()


def km(a_lat, a_lon, b_lat, b_lon) -> float:
    r = math.radians
    h = (math.sin(r(b_lat - a_lat) / 2) ** 2 + math.cos(r(a_lat)) * math.cos(r(b_lat)) * math.sin(r(b_lon - a_lon) / 2) ** 2)
    return 12742 * math.asin(math.sqrt(min(1.0, h)))


def _offset(lat, lon, bearing_deg, dist_km):
    d = dist_km / 6371.0
    b = math.radians(bearing_deg)
    p1, l1 = math.radians(lat), math.radians(lon)
    p2 = math.asin(math.sin(p1) * math.cos(d) + math.cos(p1) * math.sin(d) * math.cos(b))
    l2 = l1 + math.atan2(math.sin(b) * math.sin(d) * math.cos(p1), math.cos(d) - math.sin(p1) * math.sin(p2))
    return math.degrees(p2), (math.degrees(l2) + 540) % 360 - 180


def norm_country(name: str | None) -> str | None:
    """One spelling per country ('United States of America' and 'United States' are one), lower case."""
    if not name:
        return None
    try:
        import country_registry
        hit = country_registry.canonical_country(str(name))
        if hit:
            return hit[1].strip().lower()
    except Exception:                                          # noqa: BLE001
        pass
    return str(name).strip().lower()


def countries_near(lat: float, lon: float, reach_km: float, country_at=None) -> set[str]:
    """Lower-case names of the countries a circle touches, sampled (centre, and rings at 1/3, 2/3 and the
    edge). country_at(lat, lon) -> name | None (geo_land.country_at by default)."""
    if country_at is None:
        import geo_land
        country_at = geo_land.country_at
    out = set()
    pts = [(lat, lon)] + [_offset(lat, lon, b * 360 / SAMPLE_BEARINGS, reach_km * f)
                          for f in (1 / 3, 2 / 3, 1.0) for b in range(SAMPLE_BEARINGS)]
    for la, lo in pts:
        try:
            n = country_at(la, lo)
        except Exception:                                      # noqa: BLE001
            n = None
        if n:
            out.add(norm_country(n))
    return out


def build(concerns: list[dict], country_at=None) -> dict:
    """The union of every profile: {open, points: [{lat, lon, reach, focus, name}], countries: {names}}. Pure
    but for country_at."""
    pts, countries = [], set()
    n = 0
    for c in concerns:
        if not (c.get("assets") or c.get("theaters") or c.get("countries") or c.get("topics")):
            continue
        if c.get("only_mine") is False:
            # the user chose to see everything: they still WATCH what their profile says
            pass
        n += 1
        countries |= {norm_country(x) for x in c.get("countries") or () if x}
        for a in c.get("assets") or []:
            pts.append({"lat": a["lat"], "lon": a["lon"], "reach": float(a["radius"]), "focus": True, "name": a.get("name"),
                        "kind": "asset"})
        for t in c.get("theaters") or []:
            pts.append({"lat": t["lat"], "lon": t["lon"], "reach": float(t["reach"]), "focus": float(t["reach"]) <= FOCUS_KM,
                        "name": t.get("name"), "kind": "theater"})
    for p in pts:
        countries |= countries_near(p["lat"], p["lon"], p["reach"], country_at)
    return {"open": n == 0, "points": pts, "countries": countries, "users_with_profile": n}


def _all_concerns() -> list[dict]:
    import user_concern as uc
    from database import Theater, User, get_db
    with get_db() as db:
        ids = {str(u.id) for u in db.query(User.id).all()}
        ids |= {str(t.owner_user_id) for t in db.query(Theater.owner_user_id).all() if t.owner_user_id}
    return [uc.concern_of(uid) for uid in sorted(ids)]


def watched(force: bool = False) -> dict:
    """The union, cached WATCH_TTL_S. A failure keeps the previous union (or opens the gate)."""
    with _lock:
        if not force and _cache["v"] is not None and time.time() - _cache["at"] < WATCH_TTL_S:
            return _cache["v"]
    try:
        v = build(_all_concerns())
        STATUS.update(users_with_profile=v["users_with_profile"], countries=sorted(v["countries"]),
                      built_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), last_error=None)
    except Exception as e:                                     # noqa: BLE001
        print(f"[watch-gate] error: building the union: {type(e).__name__}: {e}", flush=True)
        STATUS["last_error"] = f"{type(e).__name__}: {e}"
        v = _cache["v"] or {"open": True, "points": [], "countries": set(), "users_with_profile": None}
    with _lock:
        _cache.update(at=time.time(), v=v)
    return v


def _country_name(cc: str | None) -> str | None:
    import user_concern as uc
    return uc._country_name((cc or "").lower() or None)


def hints(row: dict, chat_country: str | None = None) -> dict:
    """What a post says about where it is, before any model: {countries: {names}, points: [(lat, lon)]}."""
    cs, pts = set(), []
    for cc in (chat_country, row.get("country_code")):
        n = _country_name(cc) if cc else None
        if n:
            cs.add(norm_country(n))
    if row.get("lat") is not None and row.get("lon") is not None:
        try:
            pts.append((float(row["lat"]), float(row["lon"])))
        except (TypeError, ValueError):
            pass
    text = row.get("text") or ""
    try:
        import protest_status as ps
        pl = ps.place_in(text)
        if pl:
            pts.append((pl["lat"], pl["lon"]))
            n = _country_name(pl.get("cc"))
            if n:
                cs.add(norm_country(n))
    except Exception:                                          # noqa: BLE001
        pass
    try:
        import street_reports as sr
        pl = sr.place_in(text)
        if pl and pl.get("lat") is not None:
            pts.append((pl["lat"], pl["lon"]))
    except Exception:                                          # noqa: BLE001
        pass
    return {"countries": cs, "points": pts}


PROTEST_WORDS = re.compile(r"\b(manif\w*|cortege|rassemblement|gilets? jaunes|crs|bac|nasse|lacrymo\w*|protest\w*|"
                           r"demonstrat\w*|rally|march\w*|police|gendarm\w*|greve|blocage)\b")


def judge(row: dict, w: dict | None = None, chat_country: str | None = None) -> tuple[bool, bool, str]:
    """(watched, focus, why) for one post."""
    w = w if w is not None else watched()
    if w.get("open"):
        return True, False, "no user has a profile yet: open"
    h = hints(row, chat_country)
    text = _fold(row.get("text"))
    protest = bool(PROTEST_WORDS.search(text))
    for la, lo in h["points"]:
        for p in w["points"]:
            if km(p["lat"], p["lon"], la, lo) <= p["reach"]:
                return True, bool(p["focus"]), f"near {p.get('name') or 'a watched place'}"
    for n in h["countries"]:
        if n in w["countries"]:
            return True, protest and _focus_country(n, w), f"{n} is watched"
    for n in w["countries"]:
        if len(n) >= 4 and re.search(rf"\b{re.escape(_fold(n))}\b", text):
            return True, False, f"names {n}"
    if not h["countries"] and not h["points"]:
        return False, False, "no place or country to go by"
    return False, False, "outside every user's profile"


def _focus_country(name: str, w: dict) -> bool:
    """A country holding a focus point (a city-scale theater, a position, an asset)."""
    fc = w.get("_focus_countries")
    if fc is None:
        fc = set()
        try:
            import geo_land
            for p in w["points"]:
                if p["focus"]:
                    n = geo_land.country_at(p["lat"], p["lon"])
                    if n:
                        fc.add(norm_country(n))
        except Exception:                                      # noqa: BLE001
            pass
        w["_focus_countries"] = fc
    return name in fc


def status() -> dict:
    return {k: v for k, v in STATUS.items()}
