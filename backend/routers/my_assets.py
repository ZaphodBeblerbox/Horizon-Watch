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
                          "source": it.get("source"), "kind": it.get("source_type") or it.get("type") or "signal"})
    seen_pool = {i["id"] for i in items}
    # Footage from the ground, read directly: the pool is rebuilt after a
    # restart and an asset should not go quiet for that.
    try:
        import telegram_ingest as _tg
        for p in _tg.published(hours):
            if inside(p.get("lat"), p.get("lon")) and f"pool:{p['id']}" not in seen_pool:
                items.append({"id": f"tg:{p['id']}", "title": p.get("headline"), "lat": p["lat"], "lon": p["lon"],
                              "severity": p.get("severity_tier") or "high", "when": p.get("posted_at"),
                              "source": f"Telegram · {p.get('channel_title') or p.get('channel')}", "kind": "footage"})
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
                              "severity": "high", "when": g.get("date"), "source": "news (GDELT)", "kind": "news"})
    except Exception:                                        # noqa: BLE001
        pass
    cutoff = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(hours=hours)).strftime("%Y-%m-%d %H:%M:%S")
    try:
        con = sqlite3.connect(oa._db_path(), timeout=30)
        con.row_factory = sqlite3.Row
        for r in con.execute(
                "SELECT alert_id, title, lat, lon, severity, created_at, source, alert_type FROM alerts "
                "WHERE status != 'resolved' AND created_at >= ? AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? "
                "AND severity IN ('critical','high') ORDER BY created_at DESC LIMIT 400",
                (cutoff, box[0], box[1], box[2], box[3])):
            items.append({"id": f"alert:{r['alert_id']}", "title": r["title"], "lat": r["lat"], "lon": r["lon"],
                          "severity": r["severity"], "when": r["created_at"], "source": r["source"], "kind": r["alert_type"] or "alert"})
        for r in con.execute(
                "SELECT fusion_id, title, lat, lon, severity, updated_at, domains FROM fusion_events "
                "WHERE (expires_at IS NULL OR expires_at > datetime('now')) AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?",
                (box[0], box[1], box[2], box[3])):
            items.append({"id": f"fusion:{r['fusion_id']}", "title": r["title"], "lat": r["lat"], "lon": r["lon"],
                          "severity": r["severity"], "when": r["updated_at"], "source": f"fusion of {r['domains']}", "kind": "fusion"})
        # Verified footage (GeoConfirmed): a person found the place in the video.
        for r in con.execute(
                "SELECT id, name, latitude, longitude, date FROM geoconfirmed_placemarks "
                "WHERE date >= ? AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?",
                (cutoff[:10], box[0], box[1], box[2], box[3])):
            items.append({"id": f"gc:{r['id']}", "title": r["name"], "lat": r["latitude"], "lon": r["longitude"],
                          "severity": "high", "when": r["date"], "source": "GeoConfirmed — verified", "kind": "verified footage"})
        con.close()
    except sqlite3.Error:
        pass
    return items


def situation(asset: dict) -> dict:
    at = oa.position(asset, _live_vessel, _live_aircraft)
    if not at:
        return {"asset": asset, "position": None, "signals": [], "exposure": "unknown",
                "why": "No position: give a vessel's MMSI or an aircraft's ICAO code, or place it on the map."}
    ranked = oa.rank(at, asset["radius_km"], gather(at, asset["radius_km"]))
    return {"asset": asset, "position": at, "signals": ranked, "exposure": oa.exposure(ranked)}


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
        return {"exposure": s["exposure"], **oa.brief(a, s["position"], s["signals"], force=force)}
    return await asyncio.get_event_loop().run_in_executor(None, run)
