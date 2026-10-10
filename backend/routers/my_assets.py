"""my_assets.py — the asset register's API (owned_assets.py does the work).

    GET    /api/my-assets/kinds            the kinds an asset can be, grouped
    GET    /api/my-assets                  this user's assets (and shared ones), each with
                                           its position, exposure and top signal
    POST   /api/my-assets                  register one
    PUT    /api/my-assets/{id}             change one (owner only)
    DELETE /api/my-assets/{id}             remove one (owner only)
    GET    /api/my-assets/{id}/situation   where it is and every signal near it, ranked
    POST   /api/my-assets/{id}/brief       how it affects us, what could come next, measures
"""
from __future__ import annotations

import asyncio
import json
import datetime as _dt
import sqlite3

from fastapi import APIRouter, HTTPException, Request

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


@router.post("/live")
async def live(request: Request):
    """This user's phone, sharing where it is (with their consent): moves the
    person assets linked to them and has what is near them reassessed."""
    user = _me(request)
    b = await request.json()
    try:
        lat, lon = float(b["lat"]), float(b["lon"])
        acc = float(b["accuracy"]) if b.get("accuracy") is not None else None
        moved = oa.live_position(_uid(user), lat, lon, acc)
    except (KeyError, TypeError, ValueError) as e:
        raise HTTPException(400, f"a position is lat and lon: {e}")
    import asset_watch
    for owner in {m["owner_id"] for m in moved} | {_uid(user)}:
        asset_watch.invalidate(owner)
    return {"linked": len(moved)}


@router.get("/{asset_id}/track")
def asset_track(asset_id: str, request: Request, hours: int = 24):
    user = _me(request)
    if not oa.get(asset_id, _uid(user)):
        raise HTTPException(404, "no such asset")
    return {"track": oa.track(asset_id, max(1, min(168, hours)))}


@router.get("/reverse")
async def reverse(lat: float, lon: float):
    """The address at a clicked point (placing an asset on the map)."""
    from geocode_utils import reverse_geocode
    return {"place": await asyncio.get_event_loop().run_in_executor(None, reverse_geocode, lat, lon)}


@router.get("/kinds")
def kinds():
    return {"kinds": [{"key": k, **v} for k, v in oa.KINDS.items()], "importance": list(oa.IMPORTANCE)}


@router.get("")
async def list_assets(request: Request):
    user = _me(request)
    loop = asyncio.get_event_loop()

    def run():
        out = []
        for a in oa.list_for(_uid(user)):
            s = situation(a)
            out.append({**a, "position": s["position"], "exposure": s["exposure"], "signal_count": len(s["signals"]),
                        "top": s["signals"][0] if s["signals"] else None, "mine": a["owner_id"] == _uid(user)})
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
    user = _me(request)
    if not oa.delete(asset_id, _uid(user)):
        raise HTTPException(404, "no such asset of yours")
    return {"ok": True}


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
