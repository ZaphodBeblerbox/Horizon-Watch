"""
routers/events_api.py — events, following, attention and the model budget (DATAMINR_PLAN B0-B4).

  POST   /api/attention                 what the asking user looks at now (desktop and phone, every 60 s)
  GET    /api/ai/budget                 spend per purpose, today's pace, queues and skipped counts
  GET    /api/events                    "Developing in your areas": events ranked by YOUR priority
  GET    /api/events/{id}               one event: brief versions, members, sources, timeline
  POST   /api/events/{id}/feedback      not_live | wrong_place | not_relevant | duplicate | useful
  POST   /api/events/{id}/mute          mute this event (hours, default 24); DELETE unmutes
  GET    /api/follows                   the Following list (status, last update, one-line brief)
  POST   /api/follows                   follow {target, kind, label, lat, lon, radius_km}
  DELETE /api/follows/{target}          unfollow
  GET    /api/follows/{target}/timeline the followed thing's live timeline

Everything per user is derived on read from the shared event build (events.recent_shared), never rebuilt per user.
"""
from __future__ import annotations

import asyncio
import datetime as _dt

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(tags=["events"])

FEEDBACK_KINDS = {"not_live", "wrong_place", "not_relevant", "duplicate", "useful"}


def _user(request: Request) -> dict:
    from main import _require_current_user
    return _require_current_user(request)


def _maybe_user(request: Request) -> dict | None:
    from main import _get_current_user
    try:
        return _get_current_user(request)
    except Exception:                                          # noqa: BLE001
        return None


def _with_con(fn):
    import events
    con = events.connect()
    try:
        return fn(con)
    finally:
        con.close()


# ── attention and budget (B0) ───────────────────────────────────────────────

@router.post("/api/attention")
async def api_attention(request: Request):
    user = _user(request)
    body = await request.json()
    import attention
    return await asyncio.to_thread(attention.note, str(user["id"]), body if isinstance(body, dict) else {})


def budget_report() -> dict:
    import attention
    import events
    import live_incident
    import openai_gate
    st = openai_gate.status()
    purposes = sorted(set(openai_gate.effective_shares()) | set(openai_gate.allowed_purposes()) | set(openai_gate.REFUSED))
    per = {}
    for p in purposes:
        b = openai_gate.purpose_budget(p)
        b["enabled"] = openai_gate.is_enabled(p)
        b["refused"] = openai_gate.REFUSED.get(p)
        b["refusal_now"] = openai_gate.refusal(p)
        b["attention"] = attention.STATS.get(p)
        per[p] = b
    li = live_incident.STATUS
    return {"month": st["month"], "budget_usd": st["budget_usd"], "spent_usd": st["spent_usd"], "remaining_usd": st["remaining_usd"],
            "over_budget": st["over_budget"], "credit_exhausted": st["credit_exhausted"], "reserve_usd": st["reserve_usd"],
            "pace_factor": openai_gate.PACE_FACTOR, "purposes": per,
            "queues": {"live_incident": {"waiting": li.get("queue", 0), "per_day": live_incident.per_day(),
                                         "share_day_cap": live_incident.share_day_cap(),
                                         "skipped_not_watched": li.get("skipped_not_watched", 0),
                                         "dropped_to_rules": li.get("dropped_to_rules", 0), "capped": li.get("capped", 0),
                                         "model_calls": li.get("model_calls", 0)}},
            "brief": {k: v for k, v in events.status().items() if k.startswith("brief") or k in ("versions", "model_versions")},
            "events": {k: v for k, v in events.status().items() if not k.startswith("brief")},
            "attention": attention.status()}


@router.get("/api/ai/budget")
async def api_ai_budget(request: Request):
    _user(request)
    return await asyncio.to_thread(budget_report)


# ── events (B1-B3) ──────────────────────────────────────────────────────────

def events_for(user: dict | None, status: str | None = None, hours: float = 12.0, limit: int = 30) -> dict:
    """The events that concern the user, each with their priority and why, ranked: priority, then developing
    before ongoing before ended, then the newest."""
    import events
    import event_watch as ew
    import user_concern as uc
    views = events.recent_shared(max(1.0, min(hours, 48.0)))
    uid = str(user["id"]) if user and user.get("id") else None
    c = uc.concern_of(uid) if uid else None
    sc = uc.scope_for(user)
    follows = ew._follows_of(uid)
    followed = events.followed_ids(follows, views)
    out = []
    for v in views:
        if status and v["status"] != status:
            continue
        pr = events.priority_for(v, c) if c else None
        if sc.active and not pr and v["id"] not in followed:
            continue
        out.append({**v, "priority": (pr or {}).get("priority"), "priority_label": (pr or {}).get("label"),
                    "why": (pr or {}).get("why") or ("You follow it" if v["id"] in followed else None),
                    "followed": v["id"] in followed})
    st_rank = {"developing": 0, "ongoing": 1, "ended": 2, "contradicted": 3}
    pr_rank = {"flash": 0, "urgent": 1, "alert": 2, None: 3}
    out.sort(key=lambda v: (st_rank.get(v["status"], 4), pr_rank.get(v["priority"], 3), -(events.utc(v["last_update"]).timestamp()
                                                                                         if v.get("last_update") else 0)))
    counts = {k: sum(1 for v in out if v["status"] == k) for k in st_rank}
    return {"items": out[:limit], "counts": counts, "profile": sc.block(0),
            "note": None if out else "Nothing developing in your areas. An absence of reporting, not an absence of events."}


@router.get("/api/events")
async def api_events(request: Request, status: str | None = None, hours: float = 12.0, limit: int = 30):
    user = _maybe_user(request)
    return await asyncio.to_thread(events_for, user, status, hours, max(1, min(limit, 100)))


@router.get("/api/events/{eid}")
async def api_event(request: Request, eid: str):
    user = _maybe_user(request)
    import events

    def run(con):
        v = events.get(con, eid, full=True)
        if not v:
            return None
        v["timeline"] = events.timeline(con, {"target": v["id"], "kind": "event", "lat": v["lat"], "lon": v["lon"],
                                              "radius_km": 1.0, "at": v["first_seen"]}, protest_items=[])
        return v
    v = await asyncio.to_thread(_with_con, run)
    if not v:
        raise HTTPException(status_code=404, detail="event not found")
    if user:
        import event_watch as ew
        import user_concern as uc
        pr = events.priority_for(v, uc.concern_of(str(user["id"])))
        v.update({"priority": (pr or {}).get("priority"), "priority_label": (pr or {}).get("label"), "why": (pr or {}).get("why")})
        fs = ew._follows_of(str(user["id"]))
        v["followed"] = v["id"] in events.followed_ids(fs, [v])
        rules = ew.alert_rules(uc.concern_of(str(user["id"])))
        v["muted"] = bool(ew.muted_by(rules, {"event_id": v["id"]}, None, _dt.datetime.now(_dt.timezone.utc)))
    return v


@router.post("/api/events/{eid}/feedback")
async def api_event_feedback(request: Request, eid: str):
    user = _user(request)
    body = await request.json()
    kind = str((body or {}).get("kind") or "")
    if kind not in FEEDBACK_KINDS:
        raise HTTPException(status_code=400, detail=f"kind must be one of {sorted(FEEDBACK_KINDS)}")
    import events

    def run(con):
        real = events.resolve_id(con, eid)
        con.execute("INSERT OR REPLACE INTO event_feedback (event_id, user_id, kind, note, at) VALUES (?,?,?,?,?)",
                    (real, str(user["id"]), kind, str((body or {}).get("note") or "")[:500], events.iso(_dt.datetime.now(_dt.timezone.utc))))
        con.commit()
        return {"ok": True, "event_id": real}
    return await asyncio.to_thread(_with_con, run)


def _write_mutes(uid: str, fn) -> list:
    """Read-modify-write settings.interests.alerts.mutes for one user."""
    import copy

    from sqlalchemy.orm.attributes import flag_modified

    import event_watch as ew
    import user_concern as uc
    from database import User, get_db
    with get_db() as db:
        u = db.query(User).filter(User.id == uid).first()
        if not u:
            raise HTTPException(status_code=404, detail="user not found")
        s = copy.deepcopy(u.settings or {})
        alerts = s.setdefault("interests", {}).setdefault("alerts", {})
        now = _dt.datetime.now(_dt.timezone.utc)
        mutes = [m for m in (alerts.get("mutes") or []) if (ew._utc(m.get("until")) or now) > now]
        alerts["mutes"] = ew.validate_alerts({"mutes": fn(mutes)}).get("mutes", [])
        u.settings = s
        flag_modified(u, "settings")
        db.commit()
    uc.forget(uid)
    return alerts["mutes"]


@router.post("/api/events/{eid}/mute")
async def api_event_mute(request: Request, eid: str):
    user = _user(request)
    try:
        body = await request.json()
    except Exception:                                          # noqa: BLE001
        body = {}
    hours = max(1.0, min(float((body or {}).get("hours") or 24), 24 * 14))
    until = (_dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%SZ")
    real = await asyncio.to_thread(_with_con, lambda con: __import__("events").resolve_id(con, eid))
    mutes = await asyncio.to_thread(_write_mutes, str(user["id"]),
                                    lambda ms: [m for m in ms if m.get("event_id") != real] + [{"event_id": real, "until": until}])
    return {"ok": True, "event_id": real, "until": until, "mutes": mutes}


@router.delete("/api/events/{eid}/mute")
async def api_event_unmute(request: Request, eid: str):
    user = _user(request)
    real = await asyncio.to_thread(_with_con, lambda con: __import__("events").resolve_id(con, eid))
    mutes = await asyncio.to_thread(_write_mutes, str(user["id"]), lambda ms: [m for m in ms if m.get("event_id") not in (eid, real)])
    return {"ok": True, "event_id": real, "mutes": mutes}


# ── following ───────────────────────────────────────────────────────────────

@router.get("/api/follows")
async def api_follows(request: Request):
    user = _user(request)
    import events
    items = await asyncio.to_thread(_with_con, lambda con: events.following(con, str(user["id"])))
    return {"items": items}


@router.post("/api/follows")
async def api_follow(request: Request):
    user = _user(request)
    body = await request.json()
    if not isinstance(body, dict) or not body.get("target"):
        raise HTTPException(status_code=400, detail="target is required")
    import events

    def run(con):
        return events.follow(con, str(user["id"]), str(body["target"]), kind=str(body.get("kind") or "event"),
                             label=body.get("label"), lat=body.get("lat"), lon=body.get("lon"), radius_km=body.get("radius_km"))
    try:
        return await asyncio.to_thread(_with_con, run)
    except KeyError:
        raise HTTPException(status_code=404, detail="event not found")
    except (ValueError, OverflowError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/api/follows/{target:path}")
async def api_unfollow(request: Request, target: str):
    user = _user(request)
    import events
    ok = await asyncio.to_thread(_with_con, lambda con: events.unfollow(con, str(user["id"]), target))
    return {"ok": ok}


@router.get("/api/follows/{target:path}/timeline")
async def api_follow_timeline(request: Request, target: str):
    user = _user(request)
    import events

    def run(con):
        f = next((x for x in events.follows_of(con, str(user["id"])) if x["target"] == target), None)
        if not f:
            return None
        return {"follow": f, "items": events.timeline(con, f)}
    out = await asyncio.to_thread(_with_con, run)
    if out is None:
        raise HTTPException(status_code=404, detail="not followed")
    return out
