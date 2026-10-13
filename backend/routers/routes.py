"""routes.py — route planning over HTTP (safe_route.py plans, route_plans.py keeps them).

    GET  /api/routes/modes                 the modes and hazard providers (the panel's registries)
    POST /api/routes/plan                  plan (and save) a route — body below
    GET  /api/routes/{id}                  a saved plan, RE-CHECKED against the hazards now (?replan=1 forces a new plan)
    POST /api/routes/{id}/send             {asset_id?, user_id?} — to a person, as a notification that opens it
    GET  /api/routes/context               ?lat&lon&asset_id — is a route plan relevant here, and why
    GET  /api/routes/hazards               ?lat&lon&km&providers — the live hazards near a point
    GET  /api/routes/status                the last calls to the routing services

POST /api/routes/plan
    {"from": {"lat", "lon", "label"?} | {"asset_id"} | {"me": true, "lat"?, "lon"?},
     "to":   {"lat", "lon", "name"?} | {"asset_id"} | null      (null: automatic safe points — an exit),
     "mode": "foot" | "car" | "truck" | <a registered mode>,
     "depart_at": ISO time | null (now),
     "avoid": [provider names]   — the hazard providers to take into account (default: the mode's own),
     "purpose": "exit" | "access" | …,  "save": true}
 -> the plan (safe_route.plan) + {"id", "subject", "request", "status"}.
 "access" with no "from": the approach starts 3–8 km out, on the side away from the dangers.

Visibility: a plan from an asset needs the asset to be visible to the caller
(owner, shared, admin); a saved plan is visible to its owner, the person it
is for, and admins. Every handler is async; the routers are called over
httpx and the hazards read in a thread.
"""
from __future__ import annotations

import asyncio
import datetime as _dt

from fastapi import APIRouter, Body, HTTPException, Request

import owned_assets as oa
import route_plans as rp
import safe_route as sr

router = APIRouter(prefix="/api/routes", tags=["routes"])


def _me(request: Request) -> dict:
    from main import _require_current_user
    return _require_current_user(request)


def _uid(user: dict) -> str:
    return str(user.get("id") or user.get("email"))


def _is_admin(user: dict) -> bool:
    return bool(user.get("is_super_admin")) or str(user.get("role") or "").lower() == "admin"


def _point(d) -> tuple[float, float]:
    try:
        lat, lon = float(d["lat"]), float(d["lon"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(400, "a point is {lat, lon}")
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise HTTPException(400, "position out of range")
    return lat, lon


async def _asset(asset_id: str, user: dict) -> dict:
    a = await asyncio.to_thread(oa.visible_to, str(asset_id), user)
    if not a:
        raise HTTPException(404, "no such asset")
    return a


async def _asset_position(a: dict) -> dict | None:
    uid = (a.get("identifiers") or {}).get("user_id")
    if uid:
        last = await asyncio.to_thread(oa.latest, str(uid))
        if last and not oa.is_coarse(last.get("accuracy_m"), last.get("source")):
            return {"lat": last["lat"], "lon": last["lon"], "at": last["at"]}
    if a.get("lat") is not None and a.get("lon") is not None:
        return {"lat": a["lat"], "lon": a["lon"], "at": a.get("updated_at")}
    return None


def _sites(owner_id: str, lat: float, lon: float) -> list[dict]:
    """The owner's own fixed sites within 5 km — the first refuges to offer."""
    out = []
    for a in oa.list_for(owner_id):
        if a.get("lat") is None or oa.KINDS.get(a.get("kind"), {}).get("moves"):
            continue
        if sr.metres(lat, lon, a["lat"], a["lon"]) <= 5000:
            out.append({"name": a["name"], "kind": "your site", "lat": a["lat"], "lon": a["lon"]})
    return out


def _when(v) -> _dt.datetime | None:
    if not v:
        return None
    t = sr._utc(v)
    if t is None:
        raise HTTPException(400, "depart_at is an ISO time")
    return t


@router.get("/modes")
async def modes():
    return {"modes": [{"name": m["name"], "label": m["label"], "providers": m["providers"], "hard": sorted(m["hard"])} for m in sr.MODES.values()],
            "providers": [{"name": p["name"], "label": p["label"], "description": p["description"]} for p in sr.PROVIDERS.values()]}


async def make_plan(user: dict, body: dict) -> dict:
    """Resolve the request's points, plan, and (by default) save. -> the plan with its id."""
    to = body.get("to")
    # no start: an approach to a site starts outside it; anything else starts where I am
    frm = body.get("from") or ({} if (to and body.get("purpose") == "access") else {"me": True})
    mode = sr.mode_of(body.get("mode"))["name"]
    depart = _when(body.get("depart_at"))
    providers = body.get("avoid")
    if providers is not None and not isinstance(providers, list):
        raise HTTPException(400, "avoid is a list of provider names")
    purpose = str(body.get("purpose") or ("exit" if not to else "trip"))[:40]
    subject: dict = {}
    asset_id = None
    # where to
    dest = None
    if isinstance(to, dict) and to.get("asset_id"):
        ta = await _asset(to["asset_id"], user)
        tp = await _asset_position(ta)
        if not tp:
            raise HTTPException(404, "the destination asset has no position")
        dest = {"lat": tp["lat"], "lon": tp["lon"], "name": ta["name"], "kind": "your site"}
        asset_id = ta["id"]
    elif isinstance(to, dict) and to:
        lat2, lon2 = _point(to)
        dest = {"lat": lat2, "lon": lon2, "name": to.get("name") or "destination"}
    # from where
    if isinstance(frm, dict) and frm.get("asset_id"):
        a = await _asset(frm["asset_id"], user)
        at = await _asset_position(a)
        if not at:
            raise HTTPException(404, "this asset has no position")
        lat, lon = at["lat"], at["lon"]
        asset_id = a["id"]
        linked = (a.get("identifiers") or {}).get("user_id")
        subject = {"kind": "asset", "asset_id": a["id"], "name": a["name"], "position_at": at.get("at"), "user_id": linked,
                   "can_send": bool(linked) and (str(a.get("owner_id")) == _uid(user) or _is_admin(user))}
        owner_for_sites = str(a.get("owner_id"))
    elif isinstance(frm, dict) and frm.get("me"):
        if frm.get("lat") is not None and frm.get("lon") is not None:
            lat, lon = _point(frm)
        else:
            last = await asyncio.to_thread(oa.latest, _uid(user))
            if not last:
                raise HTTPException(404, "no position: allow location or share your live location first")
            lat, lon = last["lat"], last["lon"]
        subject = {"kind": "me", "user_id": _uid(user), "name": "you"}
        owner_for_sites = _uid(user)
    elif isinstance(frm, dict) and frm.get("lat") is not None:
        lat, lon = _point(frm)
        subject = {"kind": "point", "name": frm.get("label") or "the start"}
        owner_for_sites = _uid(user)
    elif dest and purpose == "access":
        # THE APPROACH: from outside, on the side away from the dangers around the site
        hz = await asyncio.to_thread(sr.hazards_near, dest["lat"], dest["lon"], 8.0, depart or None, providers)
        out = sr.candidate_destinations(dest["lat"], dest["lon"], sr.for_mode(hz, sr.mode_of(mode)), [], mode, 1)
        if not out:
            raise HTTPException(400, "give a start point")
        lat, lon = out[0]["lat"], out[0]["lon"]
        subject = {"kind": "point", "name": f"approach from the {sr.compass(out[0]['bearing'])}"}
        owner_for_sites = _uid(user)
    else:
        raise HTTPException(400, "from is {lat, lon}, {asset_id} or {me: true}")
    refuges = None if dest else await asyncio.to_thread(_sites, owner_for_sites, lat, lon)
    plan = await sr.plan(lat, lon, mode, refuges=refuges, destinations=[dest] if dest else None, depart_at=depart,
                         providers=providers)
    req = {"from": frm, "to": to, "mode": mode, "depart_at": body.get("depart_at"), "avoid": providers, "purpose": purpose}
    out = {**plan, "id": None, "purpose": purpose, "subject": subject, "request": req}
    if body.get("save", True):
        out["id"] = await asyncio.to_thread(rp.save, _uid(user), req, out, asset_id, subject.get("user_id"))
    return out


@router.post("/plan")
async def plan_route(request: Request, body: dict = Body(...)):
    return await make_plan(_me(request), body)


@router.get("/context")
async def context(request: Request, lat: float | None = None, lon: float | None = None, asset_id: str | None = None):
    """Is a route plan relevant here? -> {relevant, contexts: [{kind, purpose, title, reason, mode, depart_at?}]}
      exit    a person or a mover within 1 km of a live danger;
      access  a fixed site with a public call (roadblock, picket, gathering) within 2 km in the next 48 h."""
    user = _me(request)
    a = None
    if asset_id:
        a = await _asset(asset_id, user)
        at = await _asset_position(a)
        if not at:
            return {"relevant": False, "contexts": []}
        lat, lon = at["lat"], at["lon"]
    if lat is None or lon is None:
        raise HTTPException(400, "lat and lon, or asset_id")
    lat, lon = _point({"lat": lat, "lon": lon})
    out = await asyncio.to_thread(contexts_at, lat, lon, a)
    return {"relevant": bool(out), "contexts": out, "lat": lat, "lon": lon, "asset_id": asset_id}


def contexts_at(lat: float, lon: float, asset: dict | None, now: _dt.datetime | None = None) -> list[dict]:
    import exit_watch as ew
    now = now or _dt.datetime.now(_dt.timezone.utc)
    kind = (asset or {}).get("kind")
    moves = asset is None or bool(oa.KINDS.get(kind, {}).get("moves")) or bool(((asset or {}).get("identifiers") or {}).get("user_id"))
    out = []
    hz = sr.hazards_near(lat, lon, 3.0, now)
    if moves:
        near = [h for h in hz if ew.relevant(h, now)]
        if near:
            h = near[0]
            out.append({"kind": "exit", "purpose": "exit", "title": "Exit route",
                        "mode": "car" if oa.KINDS.get(kind, {}).get("group") == "Vehicles" else "foot",
                        "reason": f"{h['label'].capitalize()} at {h['place'] or 'a place nearby'}, {h['distance_m']} m away"
                                  + (f" — {h['source']['label']}" if h.get("source") else ""),
                        "hazard_ids": [x["id"] for x in near]})
    else:
        # a site: calls to block or gather within 2 km, today or in the next two days
        try:
            import endangered_places as ep
            best = None
            for p in ep.load_places().get("places") or []:
                if not p.get("calls") or p.get("lat") is None or p.get("approx"):
                    continue
                d = sr.metres(lat, lon, p["lat"], p["lon"])
                if d > 2000:
                    continue
                q = ep.annotate(p, now)
                if q["status"] not in ep.LIVE_STATUSES or not q.get("next_at"):
                    continue
                start = sr._utc(q["next_at"])
                if not start or (start - now).total_seconds() > 48 * 3600:
                    continue
                if best is None or start < best[0]:
                    best = (start, q, d)
            if best:
                start, q, d = best
                line = next((c.get("line") for c in q.get("calls") or [] if c.get("line")), None) or "a public call"
                out.append({"kind": "access", "purpose": "access", "title": "Deliveries / access route", "mode": "truck",
                            "depart_at": start.isoformat(),
                            "reason": f"{line} — at {q.get('name') or q.get('city')}, {round(d / 10) * 10:g} m away"})
        except Exception as e:                              # noqa: BLE001
            print(f"[routes] error: access context: {type(e).__name__}: {e}", flush=True)
        near = [h for h in hz if h["distance_m"] <= 1000 and h["kind"] in ("roadblock", "strike", "call", "closure")]
        if near and not any(c["kind"] == "access" for c in out):
            h = near[0]
            out.append({"kind": "access", "purpose": "access", "title": "Deliveries / access route", "mode": "truck",
                        "reason": f"{h['label'].capitalize()} at {h['place'] or 'a place nearby'}, {h['distance_m']} m away"})
    return out


@router.get("/hazards")
async def hazards(request: Request, lat: float, lon: float, km: float = 3.0, providers: str | None = None):
    _me(request)
    lat, lon = _point({"lat": lat, "lon": lon})
    provs = [p for p in providers.split(",") if p] if providers else None
    return {"hazards": await asyncio.to_thread(sr.hazards_near, lat, lon, max(0.2, min(20.0, km)), None, provs),
            "attribution": sr.ATTRIBUTION}


@router.get("/status")
async def status(request: Request):
    _me(request)
    return {"calls": list(sr.SERVICE_LOG), "attribution": sr.ATTRIBUTION, "user_agent": sr.USER_AGENT}


@router.get("/{plan_id}")
async def saved(plan_id: str, request: Request, replan: bool = False, lat: float | None = None, lon: float | None = None):
    """A saved plan, RE-CHECKED: the hazards now against its safest route.
    Unsafe (or ?replan=1): planned again from the same request (an asset's
    or your position as it is now), saved over, status "rerouted"."""
    user = _me(request)
    row = await asyncio.to_thread(rp.get, plan_id)
    if not row or not rp.visible(row, user):
        raise HTTPException(404, "no such plan")
    if (row["plan"] or {}).get("kind") == "evacuation":
        import evacuation                                    # a multi-leg evacuation: its own re-check
        return await evacuation.recheck(row, user, replan)
    plan = row["plan"] or {}
    o = plan.get("origin") or row["origin"]
    hz = await asyncio.to_thread(sr.hazards_near, o["lat"], o["lon"], sr.HAZARD_SEARCH_KM, None, plan.get("providers"))
    hz = sr.for_mode(hz, sr.mode_of(row["mode"]))
    coords = ((plan.get("safest") or {}).get("coords")) or []
    check = sr.still_safe(coords, hz) if coords else {"safe": plan.get("status") == "ok", "through_core": [], "inside": []}
    known = {h["id"] for h in plan.get("hazards") or []}
    check["new_hazards"] = [h["id"] for h in hz if h["id"] not in known and h.get("distance_m", 1e9) <= 3000]
    if replan or not check["safe"] or check["new_hazards"]:
        req = {**(row["request"] or {}), "save": False}
        if lat is not None and lon is not None and (req.get("from") or {}).get("me"):
            req["from"] = {"me": True, "lat": lat, "lon": lon}          # the phone's fix now, not where it was
        fresh = await make_plan(user, req)
        status = "rerouted" if fresh.get("status") == "ok" else fresh.get("status")
        await asyncio.to_thread(rp.update, plan_id, status, fresh)
        changed = next((h for h in fresh.get("hazards") or [] if h["id"] in check["new_hazards"] + check.get("through_core", []) + check.get("inside", [])), None)
        return {**fresh, "id": plan_id, "check": check, "status": status, "rerouted": True,
                "changed_because": (f"New danger: {changed['label']} at {changed['place'] or 'a place nearby'} — the route was changed."
                                    if changed else "The route was changed to avoid a new danger.")}
    await asyncio.to_thread(rp.update, plan_id, plan.get("status") or "ok")
    return {**plan, "id": plan_id, "purpose": row.get("purpose"), "subject": (plan.get("subject") or {}), "check": check,
            "status": plan.get("status"), "rerouted": False, "hazards": hz}


@router.post("/{plan_id}/send")
async def send(plan_id: str, request: Request, body: dict = Body(default={})):
    """To the person: a notification ("… sent you the safest way out — leave via …") that opens it."""
    import exit_watch as ew
    user = _me(request)
    row = await asyncio.to_thread(rp.get, plan_id)
    if not row or not rp.visible(row, user):
        raise HTTPException(404, "no such plan")
    subject = body.get("user_id") or row.get("subject_id")
    asset_id = body.get("asset_id") or row.get("asset_id")
    if body.get("asset_id"):
        a = await _asset(body["asset_id"], user)
        subject = (a.get("identifiers") or {}).get("user_id") or subject
    if asset_id and not (str(row.get("owner_id")) == _uid(user) or _is_admin(user)):
        raise HTTPException(403, "only the plan's owner or an admin can send it")
    if not subject:
        raise HTTPException(400, "no person to send it to: give asset_id (linked to a phone) or user_id")
    plan = row["plan"] or {}
    o = plan.get("origin") or row["origin"]
    sent = await asyncio.to_thread(ew.send, str(subject), o["lat"], o["lon"], plan, user, asset_id, None, plan_id)
    return {"sent": True, **sent, "id": plan_id, "leave_via": plan.get("leave_via"), "explanation": plan.get("explanation")}
