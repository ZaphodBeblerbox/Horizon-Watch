"""my_assets.py — the asset register's API (owned_assets.py does the work).

    GET    /api/my-assets/kinds            the kinds an asset can be, grouped
    GET    /api/my-assets                  this user's assets (and shared ones), each with
                                           its position, exposure and top signal
    POST   /api/my-assets                  register one
    PUT    /api/my-assets/{id}             change one (owner only)
    DELETE /api/my-assets/{id}             remove one (owner only)
    GET    /api/my-assets/{id}/situation   where it is and every signal near it, ranked
    GET    /api/my-assets/{id}/track       where a moving asset has been (linked to a person: their phone)
    GET    /api/my-assets/linkable-users   who can be linked to an asset (your organisation, then outside it)
    GET    /api/my-assets/{id}/link        who it follows, and how fresh
    PUT    /api/my-assets/{id}/link        link a person: it follows their phone from now on (owner, admin)
    DELETE /api/my-assets/{id}/link        unlink
    POST   /api/my-assets/live             this user's device position (live sharing)
    GET    /api/my-assets/me/positions     this user's own position history
    GET    /api/my-assets/people           the team's latest shared positions (the location signal;
                                           pushed live by GET /api/positions/stream, position_stream.py)
    POST   /api/my-assets/{id}/brief       how it affects us, what could come next, measures
"""
from __future__ import annotations

import asyncio
import json
import os
import datetime as _dt
import sqlite3
import threading
import time

from fastapi import APIRouter, Body, HTTPException, Request

import owned_assets as oa

router = APIRouter(prefix="/api/my-assets", tags=["assets"])


def _me(request: Request) -> dict:
    from main import _require_current_user
    return _require_current_user(request)


def _uid(user: dict) -> str:
    return str(user.get("id") or user.get("email"))


def _live_vessel(mmsi: str):
    """Live from the AIS cache; else the last position the daily roll-up
    recorded (vessel_day) — the cache only holds ships heard since start."""
    import main as m
    with m._AIS_LOCK:
        v = m._AIS_VESSELS.get(mmsi) or m._AIS_VESSELS.get(str(mmsi))
    if v:
        return {**v, "_live": True}
    try:
        con = sqlite3.connect(oa._db_path(), timeout=30)
        r = con.execute("SELECT day, last_lat, last_lon, max_speed FROM vessel_day WHERE mmsi=? AND last_lat IS NOT NULL "
                        "ORDER BY day DESC LIMIT 1", (str(mmsi),)).fetchone()
        con.close()
    except sqlite3.Error:
        r = None
    return {"lat": r[1], "lon": r[2], "timestamp": r[0], "_live": False} if r else None


def _live_aircraft(icao: str):
    import main as m
    return m._GLOBAL_ADSB_CACHE.get(icao.upper()) or m._GLOBAL_ADSB_CACHE.get(icao.lower())


def _txt(v, n: int = 400) -> str | None:
    t = " ".join(str(v or "").split())
    return t[:n] or None


def _raw(j) -> dict:
    try:
        d = json.loads(j or "{}")
        return d if isinstance(d, dict) else {}
    except (TypeError, ValueError):
        return {}


def _first_url(text) -> str | None:
    import re as _re
    m = _re.search(r"https?://\S+", str(text or ""))
    return m.group(0) if m else None


def _trigger_of_pool(it: dict) -> str:
    st = str(it.get("source_type") or it.get("type") or "signal").replace("_", " ")
    src = it.get("source")
    return f"{st}{' from ' + src if src and src.lower() not in st.lower() else ''}"


# What a kind of asset is, in the words reports use — for "the same kind of
# target, attacked elsewhere in the country" (analogues()).
TARGET_WORDS = {
    "power": r"substation|umspannwerk|power (station|plant|grid|line|cable)|pylon|transformer|electricity|grid|blackout|stromnetz|kraftwerk|strommast",
    "oil": r"pipeline|refiner\w*|fuel depot|oil (depot|terminal|facility)|gas (terminal|facility|plant)|lng|tank farm",
    "telecom": r"(fibre|fiber|data|internet|undersea|subsea|telecom\w*) cables?|cable cut|mast|transmitter|data cent\w*|antenna|funkmast",
    "port": r"\bport\b|harbou?r|terminal|quay|container",
    "air": r"airport|airfield|air base|runway|flughafen",
    "industry": r"factory|plant|warehouse|logistics|depot|arms (maker|factory)|rheinmetall",
    "rail": r"railway|rail line|train|bahn|track|signal box|stellwerk",
}
KIND_TARGETS = {
    "substation": ["power"], "power_plant": ["power"], "nuclear_plant": ["power"], "wind_farm": ["power"], "solar_farm": ["power"],
    "hydro_dam": ["power"], "power_line": ["power"], "pipeline": ["oil"], "tank_farm": ["oil"], "refinery": ["oil"], "oil_well": ["oil"],
    "telecom_mast": ["telecom"], "data_center": ["telecom"], "subsea_cable": ["telecom"], "port": ["port"], "airport": ["air"],
    "factory": ["industry"], "warehouse": ["industry"],
}


def analogues(asset: dict, at: dict, days: int = 30, limit: int = 6) -> list[dict]:
    """The same kind of target, attacked or sabotaged elsewhere in the
    asset's country lately — a precedent for this one (the owner: "a hybrid
    warfare action at a similar station in Germany is relevant")."""
    import re as _re
    groups = KIND_TARGETS.get(asset.get("kind") or "")
    country = (asset.get("country") or "").strip()
    if not groups or not country:
        return []
    rx = _re.compile("|".join(TARGET_WORDS[g] for g in groups), _re.I)
    cands: list[dict] = []
    try:
        import telegram_ingest as _tg
        for p in _tg.published(days * 24):
            cands.append({"id": f"tg:{p['id']}", "title": p.get("headline"), "lat": p.get("lat"), "lon": p.get("lon"),
                          "when": p.get("posted_at"), "place": p.get("place"), "detail": _txt(p.get("summary_en")),
                          "source": f"Telegram · {p.get('channel_title') or p.get('channel')}", "url": p.get("url"),
                          "trigger": f"a post on the Telegram channel {p.get('channel_title') or p.get('channel')}", "kind": "footage",
                          "country_hint": p.get("place")})
    except Exception:                                        # noqa: BLE001
        pass
    import main as m
    with m._SURFACE_POOL_LOCK:
        pool = list(m._SURFACE_POOL)
    for it in pool:
        cands.append({"id": f"pool:{it.get('id')}", "title": it.get("headline") or it.get("title"), "lat": it.get("lat"), "lon": it.get("lon"),
                      "when": it.get("published_at"), "place": it.get("location"), "detail": _txt(it.get("context")),
                      "source": it.get("source"), "url": it.get("url"), "trigger": _trigger_of_pool(it), "kind": it.get("source_type") or "signal",
                      "country_hint": f"{it.get('location_country') or ''} {it.get('location') or ''}"})
    out, seen = [], set()
    cutoff = _dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=days)
    for c in cands:
        if country.lower() not in str(c.get("country_hint") or "").lower():
            continue
        text = f"{c.get('title') or ''} {c.get('detail') or ''}"
        if not rx.search(text):
            continue
        cat = oa.category(c)
        if cat not in ("sabotage", "kinetic", "fire"):
            continue
        try:
            t = _dt.datetime.fromisoformat(str(c.get("when")).replace("Z", "+00:00"))
            if (t if t.tzinfo else t.replace(tzinfo=_dt.timezone.utc)) < cutoff:
                continue
        except (TypeError, ValueError):
            pass
        key = str(c.get("title") or "").lower()[:60]
        if key in seen:
            continue
        seen.add(key)
        km = oa.km(at["lat"], at["lon"], float(c["lat"]), float(c["lon"])) if c.get("lat") is not None and c.get("lon") is not None else None
        out.append({**{k: v for k, v in c.items() if k != "country_hint"}, "category": cat, "km": round(km) if km is not None else None,
                    "why": f"the same kind of target ({', '.join(groups)}) in {country}"})
    out.sort(key=lambda x: str(x.get("when") or ""), reverse=True)
    return out[:limit]


def gather(at: dict, radius_km: float, hours: int = 72) -> list[dict]:
    """Every recent located signal within a box around the point; rank() does the rest."""
    import main as m
    dlat = radius_km / 111.0
    dlon = radius_km / max(5.0, 111.0 * abs(__import__("math").cos(__import__("math").radians(at["lat"]))))
    box = (at["lat"] - dlat, at["lat"] + dlat, at["lon"] - dlon, at["lon"] + dlon)
    inside = lambda la, lo: la is not None and lo is not None and box[0] <= la <= box[1] and box[2] <= lo <= box[3]  # noqa: E731
    items: list[dict] = []
    with m._SURFACE_POOL_LOCK:
        pool = list(m._SURFACE_POOL)
    for it in pool:
        la, lo = it.get("lat"), it.get("lon")
        if inside(la, lo):
            items.append({"id": f"pool:{it.get('id')}", "title": it.get("headline") or it.get("title"), "lat": la, "lon": lo,
                          "severity": it.get("severity_tier") or it.get("severity"), "when": it.get("published_at"),
                          "source": it.get("source"), "kind": it.get("source_type") or it.get("type") or "signal",
                          "detail": _txt(it.get("context") or it.get("summary") or it.get("description")),
                          "trigger": _trigger_of_pool(it), "place": it.get("location") or it.get("location_name"),
                          "url": it.get("url") or it.get("source_url")})
    seen_pool = {i["id"] for i in items}
    # Footage from the ground, read directly: the pool is rebuilt after a
    # restart and an asset should not go quiet for that.
    try:
        import telegram_ingest as _tg
        for p in _tg.published(hours):
            if inside(p.get("lat"), p.get("lon")) and f"pool:{p['id']}" not in seen_pool:
                items.append({"id": f"tg:{p['id']}", "title": p.get("headline"), "lat": p["lat"], "lon": p["lon"],
                              "severity": p.get("severity_tier") or "high", "when": p.get("posted_at"),
                              "source": f"Telegram · {p.get('channel_title') or p.get('channel')}", "kind": "footage",
                              "detail": _txt(p.get("summary_en")), "place": p.get("place"), "url": p.get("url"),
                              "trigger": f"a {'video' if p.get('media') == 'video' else 'post'} on the Telegram channel "
                                         f"{p.get('channel_title') or p.get('channel')} ({p.get('verification') or 'unverified'})"})
    except Exception:                                        # noqa: BLE001
        pass
    # News events the judge kept (gdelt_judge.py): acts of force only.
    try:
        import gdelt_events as _ge
        import gdelt_judge as _gj
        kept, _ = _gj.filter_points(_ge.map_points(_ge.EVENTS_CACHE.get("events") or []))
        for g in kept:
            if inside(g.get("lat"), g.get("lon")):
                items.append({"id": f"gdelt:{g.get('id')}", "title": g.get("title"), "lat": g["lat"], "lon": g["lon"],
                              "severity": "high", "when": g.get("date"), "source": "news (GDELT)", "kind": "news",
                              "detail": _txt(g.get("context")), "place": g.get("location_name"), "url": g.get("source_url"),
                              "trigger": f"a news report coded by GDELT as {', '.join(g.get('event_types') or []) or 'an event'}"
                                         f"{', ' + str(g.get('mentions')) + ' mentions' if g.get('mentions') else ''}"})
    except Exception:                                        # noqa: BLE001
        pass
    cutoff = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(hours=hours)).strftime("%Y-%m-%d %H:%M:%S")
    try:
        con = sqlite3.connect(oa._db_path(), timeout=30)
        con.row_factory = sqlite3.Row
        for r in con.execute(
                "SELECT alert_id, title, lat, lon, severity, created_at, source, alert_type, raw_json, region, entity_name FROM alerts "
                "WHERE status != 'resolved' AND created_at >= ? AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? "
                "AND severity IN ('critical','high') ORDER BY created_at DESC LIMIT 400",
                (cutoff, box[0], box[1], box[2], box[3])):
            raw = _raw(r["raw_json"])
            items.append({"id": f"alert:{r['alert_id']}", "title": r["title"], "lat": r["lat"], "lon": r["lon"],
                          "severity": r["severity"], "when": r["created_at"], "source": r["source"], "kind": r["alert_type"] or "alert",
                          "detail": _txt(raw.get("message") or raw.get("description") or raw.get("summary") or raw.get("reason")),
                          "place": r["region"], "trigger": f"the {r['alert_type'] or 'alert'} detector"
                          + (f" ({raw.get('rule_name') or raw.get('rule')})" if raw.get("rule_name") or raw.get("rule") else "")
                          + (f" on {r['entity_name']}" if r["entity_name"] else "")})
        for r in con.execute(
                "SELECT fusion_id, title, lat, lon, severity, updated_at, domains, narrative, subtitle, location_name FROM fusion_events "
                "WHERE (expires_at IS NULL OR expires_at > datetime('now')) AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?",
                (box[0], box[1], box[2], box[3])):
            items.append({"id": f"fusion:{r['fusion_id']}", "title": r["title"], "lat": r["lat"], "lon": r["lon"],
                          "severity": r["severity"], "when": r["updated_at"], "source": f"fusion of {r['domains']}", "kind": "fusion",
                          "detail": _txt(r["narrative"] or r["subtitle"]), "place": r["location_name"],
                          "trigger": f"independent observations fused at one place ({r['domains']})"})
        # Verified footage (GeoConfirmed): a person found the place in the video.
        for r in con.execute(
                "SELECT id, name, latitude, longitude, date, description, title, original_source FROM geoconfirmed_placemarks "
                "WHERE date >= ? AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?",
                (cutoff[:10], box[0], box[1], box[2], box[3])):
            items.append({"id": f"gc:{r['id']}", "title": r["title"] or r["name"], "lat": r["latitude"], "lon": r["longitude"],
                          "severity": "high", "when": r["date"], "source": "GeoConfirmed — verified", "kind": "verified footage",
                          "detail": _txt(r["description"]), "url": _first_url(r["original_source"]),
                          "trigger": "footage geolocated by a GeoConfirmed analyst"})
        con.close()
    except sqlite3.Error:
        pass
    return items


def situation(asset: dict) -> dict:
    at = oa.position(asset, _live_vessel, _live_aircraft)
    if not at:
        return {"asset": asset, "position": None, "signals": [], "exposure": "unknown",
                "why": "No position: give a vessel's MMSI or an aircraft's ICAO code, or place it on the map."}
    ranked = oa.rank(at, asset["radius_km"], gather(at, asset["radius_km"]), kind=asset.get("kind"))
    try:
        elsewhere = analogues(asset, at)
    except Exception:                                        # noqa: BLE001
        elsewhere = []
    return {"asset": asset, "position": at, "signals": ranked, "exposure": oa.exposure(ranked), "analogues": elsewhere}


_CREATE_LOCK = threading.Lock()


@router.post("/live")
def live(request: Request, body: dict = Body(...)):
    """This user's device, sharing where it is (with their consent): kept in
    their position history, moves the assets linked to them and has what is
    near them reassessed.

    A plain def, so it runs in the threadpool: it was `async def` doing
    SQLite with a 60 s busy timeout ON THE EVENT LOOP — in production a
    locked database held POST /live for 60.1 s and the whole API with it
    (2026-10-12 06:12, "[slow-request] POST /api/my-assets/live in 60.1s",
    500). A locked database now answers 503 within five seconds and the
    phone sends again on its next fix."""
    user = _me(request)
    try:
        lat, lon = float(body["lat"]), float(body["lon"])
        acc = float(body["accuracy"]) if body.get("accuracy") is not None else None
        source = str(body.get("source") or "")
        if not source:
            # An older client (the desktop app up to 1.1.18) sends its connection's
            # city-level fix unmarked: that coarse, it is "ip", never a GPS fix
            # that could override the phone's.
            try:
                source = "ip" if body.get("accuracy") is not None and float(body.get("accuracy")) >= 3000 else "gps"
            except (TypeError, ValueError):
                source = "gps"
    except (KeyError, TypeError, ValueError) as e:
        raise HTTPException(400, f"a position is lat and lon: {e}")
    uid = _uid(user)
    try:
        r = oa.record_position(uid, lat, lon, acc, source)
        # THE LOCATION BECOMES AN ASSET (owner, 2026-10-10): the first live
        # position of someone with no linked asset creates theirs — shared
        # with the team, moved by every later position, and assessed like
        # every other asset. Under a lock: two positions in flight at once
        # made two assets (seen in the 2026-10-12 browser run).
        with _CREATE_LOCK:
            # …unless their live asset was deleted on purpose (oa.delete): not brought back by itself
            if r["stored"] and not r["moved"] and not oa.linked_to(uid) and not oa.live_asset_dismissed(uid):
                name = (user.get("name") or user.get("email") or "Me").split("@")[0]
                oa.create(uid, {"name": f"{name} (live)", "kind": "person", "lat": lat, "lon": lon, "shared": True,
                                "identifiers": {"user_id": uid}, "importance": "high",
                                "notes": "Created from this person's shared live location."})
                r["moved"] = oa.live_position(uid, lat, lon, acc, "ip" if source.lower() == "ip" else "gps")
    except oa.TooSoon as e:
        raise HTTPException(429, f"too many positions: {e}", headers={"Retry-After": str(e.retry_after)})
    except ValueError as e:
        raise HTTPException(400, str(e))
    except sqlite3.OperationalError as e:
        raise HTTPException(503, f"busy, send the next position: {e}", headers={"Retry-After": "15"})
    if r["stored"]:
        # REAL TIME: pushed at once to every viewer allowed to see it
        # (position_stream.py) — from this thread, never waiting on the loop
        import position_stream
        position_stream.publish_position(user, lat, lon, acc, "ip" if source.lower() == "ip" else "gps", r.get("at"), r["moved"])
    if r.get("history", True):
        # what is near them is reassessed when they have really moved (or a
        # minute on), not at every fix of a walk
        import asset_watch
        for owner in {m["owner_id"] for m in r["moved"]} | {uid}:
            asset_watch.invalidate(owner)
    return {"linked": len(r["moved"]), "assets": [m["id"] for m in r["moved"]], "stored": r["stored"],
            "history": r.get("history", False), "held": r["held"], "coarse": r["coarse"]}


@router.get("/me/positions")
def my_positions(request: Request, hours: int = 24):
    """Where I have been: my own position history, oldest first."""
    user = _me(request)
    pts = oa.positions(_uid(user), max(1, min(24 * 30, hours)))
    return {"positions": pts, "latest": pts[-1] if pts else None}


@router.get("/people")
def people(request: Request, hours: int = 24):
    """THE LOCATION SIGNAL: everyone on the team sharing where they are, at
    their latest position, with the assets linked to them — for the map and
    the asset page."""
    me = _me(request)
    import position_stream as ps
    # the same rule as the live stream: your organisation, people linked to
    # your organisation's assets, admins — never strangers
    return {"people": ps.visible_people(me, oa.people(max(1, min(168, hours))))}


# ── linking a person to an asset ───────────────────────────────────────────

def _directory() -> list[dict]:
    """Every approved account: {id, name, email, company, team_id}."""
    try:
        con = sqlite3.connect(oa._db_path(), timeout=5)
        try:
            rows = con.execute("SELECT id, name, email, company, team_id FROM users WHERE approved = 1").fetchall()
        finally:
            con.close()
    except sqlite3.Error:
        return []
    return [{"id": str(r[0]), "name": r[1] or (r[2] or "").split("@")[0], "email": r[2], "company": r[3], "team_id": r[4]} for r in rows]


def _link_view(a: dict) -> dict:
    """Who an asset follows and how fresh their position is."""
    uid = (a.get("identifiers") or {}).get("user_id")
    if not uid:
        return {"asset_id": a["id"], "user": None}
    u = next((x for x in _directory() if x["id"] == str(uid)), None) or {"id": str(uid), "name": None}
    last = oa.latest(str(uid))
    live = False
    if last:
        t = oa._ts(last.get("at"))
        live = bool(t and (_dt.datetime.now(_dt.timezone.utc) - t).total_seconds() <= oa.LIVE_FRESH_S)
    return {"asset_id": a["id"], "user": {"id": u["id"], "name": u.get("name") or "Someone", "company": u.get("company")},
            "latest": last, "live": live}


def _may_link(a: dict | None, me: dict) -> bool:
    import position_stream as ps
    return bool(a) and (str(a.get("owner_id")) == _uid(me) or ps.is_admin(me))


@router.get("/linkable-users")
def linkable_users(request: Request, q: str = ""):
    """Who can be linked to an asset: anyone with an account — your own
    organisation first, then people outside it (a driver, a contractor);
    linking one makes their live position visible to you and your team
    (position_stream.can_see)."""
    import position_stream as ps
    me = _me(request)
    q = q.strip().lower()
    out = []
    for u in _directory():
        if q and q not in f"{u['name'] or ''} {u['email'] or ''} {u['company'] or ''}".lower():
            continue
        org = u["id"] == _uid(me) or ps.same_org(me, u)
        out.append({"id": u["id"], "name": u["name"] or "Someone", "email": u["email"], "company": u["company"],
                    "affiliation": "you" if u["id"] == _uid(me) else "organisation" if org else "outside"})
    rank = {"you": 0, "organisation": 1, "outside": 2}
    out.sort(key=lambda x: (rank[x["affiliation"]], (x["name"] or "").lower()))
    return {"users": out}


@router.get("/{asset_id}/link")
def asset_link(asset_id: str, request: Request):
    a = oa.visible_to(asset_id, _me(request))
    if not a:
        raise HTTPException(404, "no such asset")
    return _link_view(a)


@router.put("/{asset_id}/link")
def asset_link_set(asset_id: str, request: Request, body: dict = Body(...)):
    """Link a person: from now on the asset is where their phone is."""
    import position_stream as ps
    me = _me(request)
    a = oa.visible_to(asset_id, me)
    if not _may_link(a, me):
        raise HTTPException(404, "no such asset of yours")
    uid = str((body or {}).get("user_id") or "").strip()
    who = next((u for u in _directory() if u["id"] == uid), None)
    if not uid or who is None:
        raise HTTPException(400, "no such person")
    a = oa.link_user(asset_id, uid)
    ps.forget_users()
    last = oa.latest(uid)
    if last:
        # the owner's open map shows the asset at the person at once
        ps.publish_position({"id": uid, "name": who["name"], "team_id": who.get("team_id"), "company": who.get("company")},
                            last["lat"], last["lon"], last.get("accuracy_m"), last.get("source") or "gps", last["at"],
                            [{"id": a["id"], "owner_id": a["owner_id"], "shared": a["shared"]}])
    import asset_watch
    asset_watch.invalidate(str(a["owner_id"]))
    return _link_view(a)


@router.delete("/{asset_id}/link")
def asset_link_clear(asset_id: str, request: Request):
    import position_stream as ps
    me = _me(request)
    a = oa.visible_to(asset_id, me)
    if not _may_link(a, me):
        raise HTTPException(404, "no such asset of yours")
    a = oa.link_user(asset_id, None)
    ps.forget_users()
    return _link_view(a)


@router.get("/{asset_id}/track")
def asset_track(asset_id: str, request: Request, hours: int = 24):
    user = _me(request)
    if not oa.get(asset_id, _uid(user)):
        raise HTTPException(404, "no such asset")
    return {"track": oa.track(asset_id, max(1, min(168, hours)))}


def _track_points(asset: dict, hours: int) -> list[dict]:
    """A person's asset follows their phone: its track is their position
    history (30 days); any other mover, its own trail (7 days)."""
    uid = (asset.get("identifiers") or {}).get("user_id")
    return oa.positions(str(uid), hours) if uid else oa.track(asset["id"], hours)


@router.get("/{asset_id}/track/range")
def asset_track_range(asset_id: str, request: Request, range: str = "24h", max_points: int = 500):
    """THE TRACK (owner, 2026-10-12): where an asset has been over 1h / 6h /
    24h / 7d / 30d — thinned (Douglas-Peucker) to at most max_points, with
    its stops (≥ 10 min) and start and end (track_view.py). Visible to the
    asset's owner, everyone when it is shared, admins."""
    import track_view as tv
    user = _me(request)
    a = oa.visible_to(asset_id, user)
    if not a:
        raise HTTPException(404, "no such asset")
    if range not in tv.RANGES:
        raise HTTPException(400, f"range is one of {', '.join(tv.RANGES)}")
    return {"asset_id": asset_id, "name": a.get("name"), "user_id": (a.get("identifiers") or {}).get("user_id"),
            **tv.view(_track_points(a, tv.hours_of(range)), range, max_points)}


@router.get("/people/{user_id}/track")
def person_track(user_id: str, request: Request, range: str = "24h", max_points: int = 500):
    """A person's own track (their phone's history) — for themself, admins,
    and their team (position_stream.can_see, the live stream's rule)."""
    import position_stream as ps
    import track_view as tv
    me = _me(request)
    u = ps.user_index().get(str(user_id))
    if u is None and str(user_id) != _uid(me):
        raise HTTPException(404, "no such person")
    if not ps.can_see_user(me, str(user_id)):
        raise HTTPException(404, "no such person")
    if range not in tv.RANGES:
        raise HTTPException(400, f"range is one of {', '.join(tv.RANGES)}")
    return {"user_id": str(user_id), "name": (u or {}).get("name"),
            **tv.view(oa.positions(str(user_id), tv.hours_of(range)), range, max_points)}


@router.get("/reverse")
async def reverse(lat: float, lon: float):
    """The address at a clicked point (placing an asset on the map)."""
    from geocode_utils import reverse_geocode
    return {"place": await asyncio.get_event_loop().run_in_executor(None, reverse_geocode, lat, lon)}


@router.get("/kinds")
def kinds():
    return {"kinds": [{"key": k, **v} for k, v in oa.KINDS.items()], "importance": list(oa.IMPORTANCE)}


# The list must answer at once: the exposure of every asset (gather + rank +
# analogues) took 54 s on a cold server and the app gave up, so the registry
# showed nothing (owner, 2026-10-22). The list serves the last assessment of
# each asset and warms the missing or stale ones on one background thread.
_EXPO: dict = {}                     # key -> (built_at, {exposure, signal_count, top, position})
_EXPO_LOCK = threading.Lock()
_EXPO_WARMING: set = set()
EXPO_TTL_S = 120
# Bounded: the key carries the asset's position and identifiers, so every edit
# (and every deleted asset) used to leave an entry behind for the life of the
# process. One entry per asset id, nothing older than EXPO_MAX_AGE_S, and at
# most EXPO_MAX entries (oldest dropped first).
EXPO_MAX = int(os.getenv("ASSET_EXPO_MAX", "2000"))
EXPO_MAX_AGE_S = 6 * 3600


def _expo_put(k: tuple, val: dict, now: float | None = None) -> None:
    """Store one assessment; caller holds no lock."""
    now = time.time() if now is None else now
    with _EXPO_LOCK:
        for old in [o for o in _EXPO if o[0] == k[0] and o != k]:
            _EXPO.pop(old, None)
        _EXPO[k] = (now, val)
        for old in [o for o, (t, _) in _EXPO.items() if now - t > EXPO_MAX_AGE_S]:
            _EXPO.pop(old, None)
        if len(_EXPO) > EXPO_MAX:
            for old, _ in sorted(_EXPO.items(), key=lambda kv: kv[1][0])[:len(_EXPO) - EXPO_MAX]:
                _EXPO.pop(old, None)


def _expo_key(a: dict) -> tuple:
    return (a["id"], a.get("lat"), a.get("lon"), a.get("radius_km"), a.get("kind"), json_key(a.get("identifiers")))


def json_key(v) -> str:
    try:
        import json as _j
        return _j.dumps(v, sort_keys=True, default=str)
    except Exception:                                             # noqa: BLE001
        return str(v)


def _expo_warm(assets: list[dict]) -> None:
    for a in assets:
        k = _expo_key(a)
        try:
            s = situation(a)
            val = {"exposure": s["exposure"], "signal_count": len(s["signals"]), "top": s["signals"][0] if s["signals"] else None}
            _expo_put(k, val)
        except Exception as e:                                    # noqa: BLE001
            print(f"[my-assets] error: exposure of {a.get('id')}: {type(e).__name__}: {e}", flush=True)
        finally:
            with _EXPO_LOCK:
                _EXPO_WARMING.discard(k)


@router.get("")
async def list_assets(request: Request):
    user = _me(request)
    loop = asyncio.get_event_loop()

    def run():
        import position_stream as ps
        out, todo = [], []
        now = time.time()
        for a in oa.list_for(_uid(user)):
            # a person's live asset is shared, but where a person is shows only
            # to who may see them (position_stream.can_see): never strangers
            linked = (a.get("identifiers") or {}).get("user_id")
            if linked and a["owner_id"] != _uid(user) and not ps.can_see_user(user, str(linked)):
                continue
            k = _expo_key(a)
            with _EXPO_LOCK:
                hit = _EXPO.get(k)
                stale = hit is None or now - hit[0] > EXPO_TTL_S
                if stale and k not in _EXPO_WARMING:
                    _EXPO_WARMING.add(k)
                    todo.append(a)
            e = hit[1] if hit else {"exposure": "unknown", "signal_count": 0, "top": None}
            try:
                at = oa.position(a, _live_vessel, _live_aircraft)
            except Exception:                                     # noqa: BLE001
                at = None
            out.append({**a, "position": at, **e, "building": hit is None, "mine": a["owner_id"] == _uid(user)})
        if todo:
            threading.Thread(target=_expo_warm, args=(todo,), name="asset-exposure", daemon=True).start()
        return out
    return {"assets": await loop.run_in_executor(None, run)}


def _locate_address(body: dict) -> dict:
    """An address with no pin is located here: typing "12 Rue de Rivoli,
    Paris" is enough to register something. The address stays as typed."""
    if not isinstance(body, dict) or body.get("lat") is not None or not (body.get("address") or "").strip():
        return body
    from geocode_utils import geocode_place
    try:
        hits = geocode_place(body["address"].strip())
    except Exception:
        hits = []
    if not hits:
        raise ValueError(f"could not find '{body['address'].strip()}' — try adding the town or country, or click the map")
    h = hits[0]
    out = {**body, "lat": float(h["lat"]), "lon": float(h["lon"])}
    if not out.get("country"):
        try:
            from location_extract import country_name_from_code
            out["country"] = country_name_from_code(h.get("country_code") or "") or None
        except Exception:
            pass
    return out


@router.post("")
async def create_asset(request: Request):
    user = _me(request)
    try:
        body = await asyncio.get_event_loop().run_in_executor(None, _locate_address, await request.json())
        return oa.create(_uid(user), body)
    except (ValueError, TypeError) as e:
        raise HTTPException(400, str(e))


@router.put("/{asset_id}")
async def update_asset(asset_id: str, request: Request):
    user = _me(request)
    try:
        body = await asyncio.get_event_loop().run_in_executor(None, _locate_address, await request.json())
        a = oa.update(asset_id, _uid(user), body)
    except (ValueError, TypeError) as e:
        raise HTTPException(400, str(e))
    if not a:
        raise HTTPException(404, "no such asset of yours")
    return a


@router.delete("/{asset_id}")
def delete_asset(asset_id: str, request: Request):
    """Remove one: its owner or an admin. Someone who can see it but may not
    remove it is told so (403), not left wondering (owner, 2026-10-12)."""
    import position_stream as ps
    user = _me(request)
    a = oa.visible_to(asset_id, user)
    if not a:
        raise HTTPException(404, "no such asset")
    admin = ps.is_admin(user)
    if str(a.get("owner_id")) != _uid(user) and not admin:
        raise HTTPException(403, "only whoever added this asset, or an admin, can remove it")
    if not oa.delete(asset_id, _uid(user), admin=admin):
        raise HTTPException(404, "no such asset")
    ps.forget_users()
    try:
        import asset_watch
        asset_watch.invalidate(str(a.get("owner_id")))
    except Exception:                                        # noqa: BLE001
        pass
    return {"ok": True, "id": asset_id}


@router.get("/{asset_id}/situation")
async def asset_situation(asset_id: str, request: Request):
    user = _me(request)
    a = oa.get(asset_id, _uid(user))
    if not a:
        raise HTTPException(404, "no such asset")
    return await asyncio.get_event_loop().run_in_executor(None, situation, a)


@router.post("/{asset_id}/brief")
async def asset_brief(asset_id: str, request: Request, force: bool = False):
    user = _me(request)
    a = oa.get(asset_id, _uid(user))
    if not a:
        raise HTTPException(404, "no such asset")

    def run():
        s = situation(a)
        return {"exposure": s["exposure"], **oa.brief(a, s["position"], s["signals"], force=force, analogues=s.get("analogues"))}
    return await asyncio.get_event_loop().run_in_executor(None, run)
