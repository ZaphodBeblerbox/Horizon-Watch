"""
attention.py — the one place that decides whether a model or web call is worth spending
(DATAMINR_PLAN §2, B0; owner 2026-10-23: "don't fire the OpenAI API on everything on the map").

THREE INPUTS
  * W, the watch union: every user's assets, "where you are", theaters and watched countries, computed ONCE for
    everybody (watch_gate.watched(), cached 5 min). A new account adds nothing to it.
  * A, live attention: what users look at now — the active theater, the map's viewport, the open event — sent
    by the desktop and the phone every 60 s (POST /api/attention), kept ATTENTION_TTL_S. Stored in SQLite so
    the web process (which receives it) and the worker (which spends) read the same rows.
  * I, importance: the event's highest per-user priority and whether it is developing (events.py).

THE SCORE (§2.3)
    watch = 1.0 asset / "where you are" circle · 0.7 theater · 0.4 watched country · 0.25 named only · 0 none
    look  = +0.5 inside a live viewport · +0.3 inside an active theater · +0.6 the open event itself
    imp   = flash 1.0 · urgent 0.6 · alert 0.3 · unknown 0.3 ; x1.3 developing
    fresh = +0.2 when a new member arrived in the last 15 min
    score = watch x (1 + look) x imp + fresh
watch = 0 means no model call, ever: the rule path runs instead, and the skip is counted per purpose
(GET /api/ai/budget), so a silent cut-off can never hide.

worth(purpose, score) is the gate every lane asks: the score must reach the lane's floor AND the purpose must
have budget left (openai_gate.refusal: share, daily pace, global ceiling, credit).
"""
from __future__ import annotations

import datetime as _dt
import json
import math
import sqlite3
import threading
import time

ATTENTION_TTL_S = 5 * 60
READ_CACHE_S = 15
FRESH_MIN = 15

WATCH = {"asset": 1.0, "theater": 0.7, "country": 0.4, "named": 0.25}
LOOK = {"viewport": 0.5, "theater": 0.3, "open_event": 0.6}
IMP = {"flash": 1.0, "urgent": 0.6, "alert": 0.3}
DEVELOPING_X = 1.3
FRESH_BONUS = 0.2

# the floor each lane needs (§2.4, §4a: a brief needs >= 0.4, i.e. watched by someone; §4c: the web agent 0.6)
FLOOR = {"live_incident": 0.01, "brief": 0.4, "web_agent": 0.6}

_lock = threading.Lock()
STATS: dict[str, dict] = {}


def _bump(purpose: str, key: str, n: int = 1) -> None:
    with _lock:
        s = STATS.setdefault(purpose, {"allowed": 0, "skipped_not_watched": 0, "skipped_low_score": 0,
                                       "skipped_budget": 0, "last_skip": None})
        s[key] = s.get(key, 0) + n
        if key.startswith("skipped"):
            s["last_skip"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def km(a_lat, a_lon, b_lat, b_lon) -> float:
    r = math.radians
    h = (math.sin(r(b_lat - a_lat) / 2) ** 2 + math.cos(r(a_lat)) * math.cos(r(b_lat)) * math.sin(r(b_lon - a_lon) / 2) ** 2)
    return 12742 * math.asin(math.sqrt(min(1.0, h)))


# ── W: the watch union ──────────────────────────────────────────────────────

def union(force: bool = False) -> dict:
    import watch_gate
    return watch_gate.watched(force)


def watch_score(lat=None, lon=None, country_code=None, text=None, w: dict | None = None) -> tuple[float, str]:
    """(watch, why) for a place: the strongest profile it falls in, over every user at once."""
    w = w if w is not None else union()
    if w.get("open"):
        return WATCH["country"], "no user has a profile yet"
    best, why = 0.0, "outside every user's profile"
    if lat is not None and lon is not None:
        for p in w.get("points") or []:
            if km(p["lat"], p["lon"], lat, lon) <= p["reach"]:
                v = WATCH["asset"] if p.get("kind") == "asset" else WATCH["theater"]
                if v > best:
                    best, why = v, f"near {p.get('name') or 'a watched place'}"
    if best < WATCH["country"] and country_code:
        import watch_gate
        n = watch_gate.norm_country(watch_gate._country_name(country_code))
        if n and n in (w.get("countries") or ()):
            best, why = WATCH["country"], f"{n} is watched"
    if best == 0.0 and text:
        import re

        import watch_gate
        t = watch_gate._fold(text)
        for n in w.get("countries") or ():
            if len(n) >= 4 and re.search(rf"\b{re.escape(watch_gate._fold(n))}\b", t):
                best, why = WATCH["named"], f"names {n}"
                break
    return best, why


def post_watch(row: dict, w: dict | None = None, chat_country: str | None = None) -> tuple[float, str]:
    """watch() for a Telegram post before any model: from its hints (watch_gate.hints)."""
    import watch_gate
    w = w if w is not None else union()
    if w.get("open"):
        return WATCH["country"], "no user has a profile yet"
    h = watch_gate.hints(row, chat_country)
    best, why = 0.0, "no place or country to go by" if not (h["countries"] or h["points"]) else "outside every user's profile"
    for la, lo in h["points"]:
        v, y = watch_score(la, lo, None, None, w)
        if v > best:
            best, why = v, y
    if best < WATCH["country"]:
        for n in h["countries"]:
            if n in (w.get("countries") or ()):
                best, why = WATCH["country"], f"{n} is watched"
                break
    if best == 0.0:
        v, y = watch_score(None, None, None, row.get("text"), w)
        if v:
            best, why = v, y
    return best, why


# ── A: live attention ───────────────────────────────────────────────────────

def _con():
    import telegram_ingest as tg
    con = sqlite3.connect(tg._db_path(), timeout=30)
    con.execute("CREATE TABLE IF NOT EXISTS attention (user_id TEXT PRIMARY KEY, platform TEXT, theater_id TEXT,"
                " bbox TEXT, event_id TEXT, at REAL, tz TEXT)")
    return con


def tz_of(uid: str) -> str | None:
    """The time zone the user's app last reported (for quiet hours and the digest when Settings has none)."""
    con = _con()
    try:
        r = con.execute("SELECT tz FROM attention WHERE user_id=?", (str(uid),)).fetchone()
    finally:
        con.close()
    return r[0] if r and r[0] else None


def _bbox(v) -> list[float] | None:
    """[west, south, east, north] from a list or a {west,south,east,north} dict; None when unusable."""
    try:
        if isinstance(v, dict):
            v = [v.get("west"), v.get("south"), v.get("east"), v.get("north")]
        w, s, e, n = (float(x) for x in v)
    except (TypeError, ValueError):
        return None
    if not (-90 <= s <= n <= 90 and -180 <= w <= 180 and -180 <= e <= 180):
        return None
    return [w, s, e, n]


def _tz_name(v) -> str | None:
    if not isinstance(v, str) or len(v) > 64:
        return None
    try:
        from zoneinfo import ZoneInfo
        ZoneInfo(v)
        return v
    except Exception:                                          # noqa: BLE001
        return None


def note(uid: str, body: dict, now: float | None = None) -> dict:
    """POST /api/attention: what this user looks at now."""
    body = body if isinstance(body, dict) else {}
    row = {"user_id": str(uid), "platform": str(body.get("platform") or "")[:16] or None,
           "theater_id": str(body.get("active_theater_id") or "")[:64] or None,
           "bbox": _bbox(body.get("viewport")), "event_id": str(body.get("open_event_id") or "")[:64] or None,
           "at": now if now is not None else time.time(), "tz": _tz_name(body.get("tz"))}
    con = _con()
    try:
        con.execute("INSERT OR REPLACE INTO attention (user_id, platform, theater_id, bbox, event_id, at, tz) VALUES (?,?,?,?,?,?,?)",
                    (row["user_id"], row["platform"], row["theater_id"], json.dumps(row["bbox"]) if row["bbox"] else None,
                     row["event_id"], row["at"], row["tz"]))
        con.execute("DELETE FROM attention WHERE at < ?", (row["at"] - 24 * 3600,))
        con.commit()
    finally:
        con.close()
    _LIVE["at"] = 0.0
    return {"ok": True, "kept_s": ATTENTION_TTL_S}


_LIVE: dict = {"at": 0.0, "v": None}


def _theater_circle(tid: str) -> dict | None:
    try:
        import user_concern as uc
        from database import Theater, get_db
        with get_db() as db:
            t = db.query(Theater).filter(Theater.id == tid).first()
            v = (t.view or {}) if t else {}
        if v.get("lat") is None or v.get("lon") is None:
            return None
        return {"lat": float(v["lat"]), "lon": float(v["lon"]), "reach": uc.theater_reach_km(v)}
    except Exception:                                          # noqa: BLE001
        return None


def live(now: float | None = None) -> list[dict]:
    """The attention rows of the last ATTENTION_TTL_S: [{user_id, bbox, theater: {lat, lon, reach}, event_id}]."""
    t = now if now is not None else time.time()
    if now is None and _LIVE["v"] is not None and t - _LIVE["at"] < READ_CACHE_S:
        return _LIVE["v"]
    out = []
    try:
        con = _con()
        try:
            rows = con.execute("SELECT user_id, platform, theater_id, bbox, event_id, at FROM attention WHERE at >= ?",
                               (t - ATTENTION_TTL_S,)).fetchall()
        finally:
            con.close()
        for uid, plat, tid, bbox, eid, at in rows:
            out.append({"user_id": uid, "platform": plat, "bbox": json.loads(bbox) if bbox else None,
                        "theater": _theater_circle(tid) if tid else None, "theater_id": tid, "event_id": eid, "at": at})
    except Exception as e:                                     # noqa: BLE001
        print(f"[attention] error: reading live attention: {type(e).__name__}: {e}", flush=True)
    if now is None:
        _LIVE.update(at=t, v=out)
    return out


def _in_bbox(b, lat, lon) -> bool:
    w, s, e, n = b
    if not (s <= lat <= n):
        return False
    return (w <= lon <= e) if w <= e else (lon >= w or lon <= e)        # across the antimeridian


def look_score(lat=None, lon=None, event_id=None, rows: list | None = None) -> tuple[float, list[str]]:
    rows = live() if rows is None else rows
    v, why = 0.0, []
    if event_id and any(r.get("event_id") == event_id for r in rows):
        v += LOOK["open_event"]
        why.append("open on a screen")
    if lat is not None and lon is not None:
        if any(r.get("bbox") and _in_bbox(r["bbox"], lat, lon) for r in rows):
            v += LOOK["viewport"]
            why.append("in a map view")
        if any(r.get("theater") and km(r["theater"]["lat"], r["theater"]["lon"], lat, lon) <= r["theater"]["reach"] for r in rows):
            v += LOOK["theater"]
            why.append("in an active theater")
    return v, why


# ── the score ───────────────────────────────────────────────────────────────

def importance(priority: str | None, developing: bool = False) -> float:
    return IMP.get(priority or "", IMP["alert"]) * (DEVELOPING_X if developing else 1.0)


def score(item: dict, w: dict | None = None, rows: list | None = None) -> dict:
    """{score, watch, look, imp, fresh, why} for an item {lat, lon, country_code, text?, event_id?, priority?,
    developing?, fresh?} (an event, or a post with its watch already judged in item['watch'])."""
    if item.get("watch") is not None:
        wv, wwhy = float(item["watch"]), item.get("watch_why") or ""
    else:
        wv, wwhy = watch_score(item.get("lat"), item.get("lon"), item.get("country_code"), item.get("text"), w)
    lv, lwhy = look_score(item.get("lat"), item.get("lon"), item.get("event_id"), rows)
    iv = importance(item.get("priority"), bool(item.get("developing")))
    fv = FRESH_BONUS if item.get("fresh") else 0.0
    s = wv * (1 + lv) * iv + (fv if wv > 0 else 0.0)
    return {"score": round(s, 4), "watch": wv, "look": lv, "imp": round(iv, 3), "fresh": fv,
            "why": "; ".join([wwhy] + lwhy) if wv else wwhy}


def worth(purpose: str, sc: float | dict, *, budget: bool = True) -> tuple[bool, str]:
    """May `purpose` spend a model or web call on an item with this score? (ok, why), counted."""
    s = sc["score"] if isinstance(sc, dict) else float(sc)
    w = sc.get("watch", 1.0) if isinstance(sc, dict) else (1.0 if s > 0 else 0.0)
    if w <= 0 or s <= 0:
        _bump(purpose, "skipped_not_watched")
        return False, "not watched by anyone"
    if s < FLOOR.get(purpose, 0.01):
        _bump(purpose, "skipped_low_score")
        return False, f"score {s:.2f} under {FLOOR.get(purpose):.2f}"
    if budget:
        import openai_gate
        why = openai_gate.refusal(purpose)
        if why:
            _bump(purpose, "skipped_budget")
            return False, why
    _bump(purpose, "allowed")
    return True, "watched"


def status() -> dict:
    with _lock:
        stats = {k: dict(v) for k, v in STATS.items()}
    rows = live()
    return {"stats": stats, "live_users": len({r["user_id"] for r in rows}), "ttl_s": ATTENTION_TTL_S,
            "floors": dict(FLOOR)}


def iso_now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
