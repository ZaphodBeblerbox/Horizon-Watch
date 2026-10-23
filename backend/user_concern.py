"""
user_concern.py — what concerns a user, in one place.

WHY. "Jakob in Berlin" must never see signals about protests in Paris
(owner, 2026-10-22: "the user normally already determines what is
interesting for him, so it should be restricted to that"). A user's profile
is what they already told us:
  - assets: within the asset's watch radius (at least 5 km), and the
    position they shared ("where you are", Settings › Your interests);
  - theaters: inside the framed view (camera height x 0.9 km, at least
    350 km — the same reach src/state/interests.js gives a theater);
  - countries and regions added in Settings › Your interests;
  - topics added there: a CRITICAL signal on a followed topic is theirs
    wherever it happens.
event_watch.py already told people by exactly this; it now imports it from
here, and the maps and lists filter by it too, so the two cannot drift.

THE RULE (concerns(), keep()):
  - a located item concerns the user when why() finds an asset, a theater
    or a watched country for it (reason says which);
  - an item without a place concerns the user only when its country is
    watched, or it is critical and on a followed topic, or critical and
    marked global. A missing place never lets an item through by itself;
  - a user with NO theater, interest or asset yet (a new account) is not
    filtered: they see everything, with a hint to say what they watch;
  - the switch `settings.interests.onlyMine` (Settings › Your interests):
    true / unset = filter (once there is a profile), false = everything.

WHERE IT RUNS. After the shared build, on the way out of the endpoint: the
per-request caches (shared_cache.SharedCache, street_reports, the surface
pool) are computed ONCE for everybody and never rebuilt per user (the
2026-10-19 multi-user stall); this is a cheap list filter over their result.
Derived on read: nothing here is stored per item.
"""
from __future__ import annotations

import functools
import math
import re
import threading
import time

_lock = threading.Lock()
_concern_cache: dict[str, tuple[float, dict]] = {}
CONCERN_TTL_S = 60          # a new theater or interest counts within a minute

NO_PROFILE_HINT = ("You see everything because you have not said what you watch. Add a theater, "
                   "a country or an asset and Parallax shows only what concerns you.")


def km(a_lat, a_lon, b_lat, b_lon) -> float:
    r = math.radians
    h = (math.sin(r(b_lat - a_lat) / 2) ** 2
         + math.cos(r(a_lat)) * math.cos(r(b_lat)) * math.sin(r(b_lon - a_lon) / 2) ** 2)
    return 12742 * math.asin(math.sqrt(min(1.0, h)))


def theater_reach_km(view: dict) -> float:
    return max(350.0, float(view.get("height") or 2_000_000) / 1000 * 0.9)


# ── what concerns a user ────────────────────────────────────────────────────

def concern_of(uid: str) -> dict:
    """{assets, theaters, countries: {lowercase names}, topics, only_mine}."""
    with _lock:
        hit = _concern_cache.get(uid)
        if hit and time.time() - hit[0] < CONCERN_TTL_S:
            return hit[1]
    c = {"assets": [], "theaters": [], "countries": set(), "topics": set(), "only_mine": None, "alerts": {}}
    try:
        import owned_assets as oa
        for a in oa.list_for(uid):
            if a.get("lat") is not None and a.get("lon") is not None:
                c["assets"].append({"lat": float(a["lat"]), "lon": float(a["lon"]),
                                    "radius": max(5.0, float(a.get("radius_km") or 25)),
                                    "name": a.get("name") or "asset",
                                    "label": (a.get("kind_label") or "asset").lower()})
    except Exception as e:                                     # noqa: BLE001
        print(f"[user_concern] assets for {uid}: {type(e).__name__}: {e}", flush=True)
    try:
        from database import Theater, User, get_db
        with get_db() as db:
            for t in db.query(Theater).filter(Theater.owner_user_id == uid).all():
                v = t.view or {}
                if v.get("lat") is not None and v.get("lon") is not None:
                    c["theaters"].append({"lat": float(v["lat"]), "lon": float(v["lon"]),
                                          "reach": theater_reach_km(v), "name": t.name, "id": str(t.id)})
            u = db.query(User).filter(User.id == uid).first()
            interests = ((u.settings or {}).get("interests") or {}) if u else {}
            # the user's alert rules (thresholds, mutes, quiet hours, hourly cap, digest), read by event_watch;
            # written by Settings › Alerts and by the assistant's confirmed proposal (DATAMINR_PLAN B4)
            c["alerts"] = interests.get("alerts") if isinstance(interests.get("alerts"), dict) else {}
            c["countries"] = {str(x).strip().lower() for x in (interests.get("countries") or []) if x}
            c["topics"] = {str(x).strip().lower() for x in (interests.get("topics") or []) if x}
            c["only_mine"] = interests.get("onlyMine") if isinstance(interests.get("onlyMine"), bool) else None
            # where the user is (asked once in the app): watched like an asset
            here = interests.get("here") or {}
            try:
                c["assets"].append({"lat": float(here["lat"]), "lon": float(here["lon"]),
                                    "radius": max(5.0, float(here.get("radius_km") or 30)),
                                    "name": "where you are", "label": "", "me": True})
            except (KeyError, TypeError, ValueError):
                pass
            regions = regions_table()
            for r in interests.get("regions") or []:
                c["countries"] |= {x.lower() for x in regions.get(r, [])}
    except Exception as e:                                     # noqa: BLE001
        print(f"[user_concern] profile for {uid}: {type(e).__name__}: {e}", flush=True)
    with _lock:
        _concern_cache[uid] = (time.time(), c)
    return c


def forget(uid: str | None = None) -> None:
    """A profile changed: the next read sees it at once, not after the ttl."""
    with _lock:
        if uid is None:
            _concern_cache.clear()
        else:
            _concern_cache.pop(str(uid), None)


_REGIONS: dict | None = None


def regions_table() -> dict:
    """The one-click regions of Settings › Your interests: the copy in
    backend/seed (production deploys backend/ only), kept equal to the
    frontend's src/state/interests.js REGIONS by test_seed_copies.py."""
    global _REGIONS
    if _REGIONS is None:
        import json as _json
        from paths import SEED_DIR
        try:
            _REGIONS = _json.loads((SEED_DIR / "interest_regions.json").read_text(encoding="utf-8"))["regions"]
        except Exception as e:                                 # noqa: BLE001
            print(f"[user_concern] regions table unreadable: {type(e).__name__}: {e}", flush=True)
            _REGIONS = {}
    return _REGIONS


@functools.lru_cache(maxsize=512)
def _country_name(code: str | None) -> str | None:
    if not code:
        return None
    try:
        from location_extract import country_name_from_code
        return country_name_from_code(code)
    except Exception:                                          # noqa: BLE001
        return None


def why(ev: dict, c: dict) -> tuple[str, str] | None:
    """(reason, strength) when this event concerns the user, else None.
    strength: "asset" (closest), "theater", "country"."""
    lat, lon = ev.get("lat"), ev.get("lon")
    if lat is None or lon is None:
        return None
    near = []
    for a in c["assets"]:
        d = km(a["lat"], a["lon"], lat, lon)
        if d <= a["radius"]:
            near.append((d, a))
    if near:
        near.sort(key=lambda x: x[0])
        d, a = near[0]
        dist = "under 1 km" if d < 1 else f"{round(d)} km"
        if len(near) == 1:
            if a.get("me"):
                return f"{dist} from where you are", "asset"
            return f"{dist} from your {a['label']} {a['name']}", "asset"
        # several assets at one place: one card naming them all
        names = [x[1]["name"] for x in near]
        listed = ", ".join(names[:-1]) + f" and {names[-1]}" if len(names) <= 4 else f"{', '.join(names[:3])} and {len(names) - 3} more"
        return f"{dist} from your assets {listed}", "asset"
    for t in c["theaters"]:
        if km(t["lat"], t["lon"], lat, lon) <= t["reach"]:
            return f"in your theater {t['name']}", "theater"
    name = _country_name(ev.get("country_code"))
    if name and name.lower() in c["countries"]:
        return f"{name} — a country you watch", "country"
    return None


def proximity(ev: dict, c: dict) -> dict | None:
    """why(), with the distance: {reason, strength, km, theater_id}. km is the distance to the nearest asset (or
    "where you are") for an asset match, to the theater's centre for a theater, None for a country."""
    w = why(ev, c)
    if not w:
        return None
    lat, lon = ev.get("lat"), ev.get("lon")
    out = {"reason": w[0], "strength": w[1], "km": None, "theater_id": None}
    if w[1] == "asset":
        out["km"] = min(km(a["lat"], a["lon"], lat, lon) for a in c["assets"] if km(a["lat"], a["lon"], lat, lon) <= a["radius"])
    elif w[1] == "theater":
        for t in c["theaters"]:
            d = km(t["lat"], t["lon"], lat, lon)
            if d <= t["reach"]:
                out["km"], out["theater_id"] = d, t.get("id")
                break
    return out


# ── the per-user filter ─────────────────────────────────────────────────────

# src/state/interests.js TOPICS, as the server needs them (an unlocated
# critical signal on a followed topic is the user's wherever it happens).
TOPIC_RE = {
    "maritime": re.compile(r"\b(vessel|ship|tanker|port|maritime|navy|naval|strait|cargo|sanctioned vessel|piracy|ais)\b", re.I),
    "aviation": re.compile(r"\b(aircraft|airport|flight|airspace|drone|uav|jet|air ?force|gps|jamming|missile)\b", re.I),
    "conflict": re.compile(r"\b(attack|strike|shelling|killed|clash|fighting|offensive|troops|militant|insurgent|bomb|explosion|frontline|artillery)\b", re.I),
    "energy": re.compile(r"\b(oil|gas|pipeline|refinery|power|grid|cable|lng|energy|infrastructure|substation)\b", re.I),
    "cyber": re.compile(r"\b(cyber|hack|ransomware|malware|outage|ddos)\b", re.I),
    "unrest": re.compile(r"\b(protest|riot|coup|election|unrest|curfew|sanction|arrest|demonstrat)\w*", re.I),
}


def _has_profile(c: dict) -> bool:
    return bool(c.get("assets") or c.get("theaters") or c.get("countries") or c.get("topics"))


def _first(d: dict, *keys):
    for k in keys:
        v = d.get(k)
        if v is not None and v != "":
            return v
    return None


def _point(item: dict):
    """(lat, lon) of an item, whatever shape it has, else (None, None)."""
    lat, lon = _first(item, "lat", "latitude"), _first(item, "lon", "lng", "longitude")
    if lat is None or lon is None:
        for k in ("center", "last", "position", "location", "place"):
            p = item.get(k)
            if isinstance(p, dict) and p.get("lat") is not None and p.get("lon", p.get("lng")) is not None:
                lat, lon = p["lat"], p.get("lon", p.get("lng"))
                break
    try:
        lat, lon = float(lat), float(lon)
    except (TypeError, ValueError):
        return None, None
    if lat == 0 and lon == 0:                                   # "null island": no position
        return None, None
    return lat, lon


def _sev(item: dict) -> str:
    vals = [str(item.get(k) or "").lower() for k in ("sev", "severity", "signal_severity", "severity_tier")]
    return "critical" if "critical" in vals else next((v for v in vals if v), "")


def _text(item: dict) -> str:
    return " ".join(str(item[k]) for k in ("headline", "title", "type", "alert_type", "event_type", "category", "summary_en",
                                            "rule_name", "kind") if item.get(k))


def decide(c: dict, item: dict) -> tuple[bool, str]:
    """(concerns, reason) for one item against a concern dict."""
    lat, lon = _point(item)
    cc = _first(item, "country_code", "country", "cc")
    cc = cc if isinstance(cc, str) and 2 <= len(cc) <= 3 else None
    sev = _sev(item)
    if lat is not None:
        hit = why({"lat": lat, "lon": lon, "country_code": cc}, c)
        if hit:
            return True, hit[0]
    elif cc:
        name = _country_name(cc)
        if name and name.lower() in (c.get("countries") or ()):
            return True, f"{name} — a country you watch"
        # a country-level row (a mood reading): an asset, a theater or the
        # user's position inside it counts, as it does for the mood alert
        try:
            import telegram_mood_alert as _tma
            r = _tma.concern_reason(cc, c)
            if r:
                return True, r
        except Exception as e:                                  # noqa: BLE001
            print(f"[user_concern] error: country-level concern: {type(e).__name__}: {e}", flush=True)
    if lat is None and not cc:
        # surface items name it in words (location_country); a frontline or risk card by `region`
        for k in ("location_country", "region"):
            named = str(item.get(k) or "").strip().lower()
            if named and named in (c.get("countries") or ()):
                return True, f"{item[k]} — a country you watch"
    if sev == "critical" and c.get("topics"):
        t = _text(item)
        for k in c["topics"]:
            rx = TOPIC_RE.get(k)
            if rx and rx.search(t):
                return True, f"critical, on a topic you follow ({k})"
    if lat is None and sev == "critical" and (item.get("scope") == "global" or item.get("global") is True):
        return True, "critical and global"
    return False, "outside your profile" if lat is not None else "no place, and nothing you follow"


class Scope:
    """One user's view of the filter: build once per request, apply to any
    number of lists."""

    def __init__(self, c: dict | None, only_mine: bool | None = None):
        self.c = c or {}
        self.has_profile = _has_profile(self.c)
        om = only_mine if only_mine is not None else self.c.get("only_mine")
        self.switch = om                                        # None = default
        self.active = bool(self.has_profile and om is not False)

    def concerns(self, item: dict) -> tuple[bool, str]:
        if not self.active:
            return True, "no filter" if self.has_profile else "no profile yet"
        return decide(self.c, item)

    def filter(self, items, key=None) -> tuple[list, int]:
        """(kept, hidden). `key(x)` gives the dict to judge when it is not x."""
        items = list(items or [])
        if not self.active:
            return items, 0
        kept = []
        for x in items:
            try:
                ok, _ = decide(self.c, key(x) if key else x)
            except Exception as e:                              # noqa: BLE001
                print(f"[user_concern] error: judging an item: {type(e).__name__}: {e}", flush=True)
                ok = True
            if ok:
                kept.append(x)
        return kept, len(items) - len(kept)

    def block(self, hidden: int = 0) -> dict:
        """What the app says about the filter, on every filtered answer."""
        return {"filtered": self.active, "hidden": hidden, "has_profile": self.has_profile,
                "switch": self.switch, "hint": None if self.has_profile else NO_PROFILE_HINT}


def scope_for(user) -> Scope:
    """The Scope of a user dict (with settings, as _get_current_user gives)
    or a user id. No user (a script, no session): no filter."""
    if not user:
        return Scope(None)
    uid = str(user.get("id")) if isinstance(user, dict) else str(user)
    if not uid or uid == "None":
        return Scope(None)
    only = None
    if isinstance(user, dict):
        v = ((user.get("settings") or {}).get("interests") or {}).get("onlyMine")
        only = v if isinstance(v, bool) else None
    return Scope(concern_of(uid), only)


def concerns(user, lat=None, lon=None, country_code=None, sev=None, text=None, scope_flag=None) -> tuple[bool, str]:
    """Does this place (or, unlocated, this country/topic) concern the user?
    -> (bool, reason). The one question every list asks."""
    item = {"lat": lat, "lon": lon, "country_code": country_code, "sev": sev, "title": text}
    if scope_flag:
        item["scope"] = scope_flag
    return scope_for(user).concerns(item)
