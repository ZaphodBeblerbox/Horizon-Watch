"""
exit_watch.py — "Unrest near you — leave via Rue X (safest route ready)".

Every minute (main._exit_watch_loop) each person sharing a precise live
position is held against the live hazards (safe_route.hazards_near). A
hazard within ALERT_M of them (default 1 km; an announced gathering only
from an hour before it starts) that they have not been told about raises
ONE alert row per person per hazard (exit_alerts, primary key subject +
hazard), with the safest route computed at that moment so the title can
name the street to leave by. Several new hazards at once are one alert:
the heaviest is the card, the others are recorded (folded) so they never
alert later.

WHO SEES THE CARD. The person themself ("Unrest near you …"), the owner
of the asset linked to them and the admins ("Unrest near Anna …"). The
cards go into the one notification feed (main._notification_feed), and
event_watch.sweep pushes them like every other card (kind "exit" is an
interrupting kind) — the phone gets what the desktop gets. A click opens
the safest-route view (src/notify/openSignal.js, alert type "Leave now").

SENT BY HAND. The owner or an admin can send the safest route to the
person linked to an asset (send()); that is a card for that person only.
"""
from __future__ import annotations

import asyncio
import datetime as _dt
import json
import os
import sqlite3

ALERT_M = float(os.getenv("EXIT_ALERT_M", "1000") or 1000)
MIN_WEIGHT = 0.15
ANNOUNCED_LEAD_MIN = 60
CARD_HOURS = 6
ALERT_TYPE = "Leave now"

DDL = """
CREATE TABLE IF NOT EXISTS exit_alerts (
    subject_id TEXT NOT NULL, hazard_id TEXT NOT NULL, kind TEXT, created_at TEXT,
    lat REAL, lon REAL, asset_id TEXT, hazard TEXT, leave_via TEXT, explanation TEXT,
    distance_m REAL, sent_by TEXT, folded INTEGER DEFAULT 0, route_plan_id TEXT,
    PRIMARY KEY (subject_id, hazard_id)
);
CREATE INDEX IF NOT EXISTS ix_exit_alerts_at ON exit_alerts (created_at);
"""


def _con(timeout: float = 10):
    import owned_assets as oa
    con = sqlite3.connect(oa._db_path(), timeout=timeout)
    con.executescript(DDL)
    if "route_plan_id" not in {r[1] for r in con.execute("PRAGMA table_info(exit_alerts)")}:
        con.execute("ALTER TABLE exit_alerts ADD COLUMN route_plan_id TEXT")
    con.row_factory = sqlite3.Row
    return con


def _now() -> _dt.datetime:
    return _dt.datetime.now(_dt.timezone.utc)


def relevant(h: dict, now: _dt.datetime) -> bool:
    """Close enough and live enough to tell someone to leave."""
    if h.get("distance_m") is None or h["distance_m"] > ALERT_M or h.get("weight", 0) < MIN_WEIGHT:
        return False
    if h.get("starts_utc"):
        import safe_route as sr
        st = sr._utc(h["starts_utc"])
        if st and (st - now).total_seconds() / 60 > ANNOUNCED_LEAD_MIN:
            return False
    return True


def subjects(now: _dt.datetime | None = None) -> list[dict]:
    """People with a fresh, precise position: {user_id, lat, lon, at}."""
    import owned_assets as oa
    now = now or _now()
    out = []
    for p in oa.people(1, now=now):
        if p.get("live") and not oa.is_coarse(p.get("accuracy_m"), p.get("source")):
            out.append(p)
    return out


def _told(con, subject_id: str) -> set[str]:
    return {r[0] for r in con.execute("SELECT hazard_id FROM exit_alerts WHERE subject_id=?", (str(subject_id),))}


def _linked_asset(user_id: str) -> str | None:
    import owned_assets as oa
    assets = oa.linked_to(user_id)
    people = [a for a in assets if a.get("kind") == "person"] or assets
    return people[0]["id"] if people else None


def record(subject_id: str, lat: float, lon: float, new: list[dict], plan: dict | None, now: _dt.datetime,
           kind: str = "auto", sent_by: str | None = None, asset_id: str | None = None, plan_id: str | None = None) -> dict | None:
    """One alert for the heaviest new hazard, the others folded. Returns the row written, or None."""
    if not new:
        return None
    new = sorted(new, key=lambda h: -h["weight"])
    con = _con()
    try:
        row = None
        for i, h in enumerate(new):
            cur = con.execute(
                "INSERT OR IGNORE INTO exit_alerts (subject_id, hazard_id, kind, created_at, lat, lon, asset_id, hazard,"
                " leave_via, explanation, distance_m, sent_by, folded, route_plan_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (str(subject_id), h["id"], kind, now.isoformat(), lat, lon, asset_id,
                 json.dumps({k: h.get(k) for k in ("id", "kind", "label", "lat", "lon", "place", "what", "age_min",
                                                   "starts_utc", "radius_m", "core_m", "source", "at")}),
                 (plan or {}).get("leave_via"), (plan or {}).get("explanation"), h.get("distance_m"), sent_by,
                 1 if (i > 0 and row is not None) else 0, plan_id or (plan or {}).get("id")))
            if cur.rowcount and row is None:
                row = {"subject_id": str(subject_id), "hazard_id": h["id"]}
        con.commit()
    finally:
        con.close()
    return row


async def check(now: _dt.datetime | None = None, plan_fn=None, hazards_fn=None) -> int:
    """One sweep: alerts raised. Network (the routers) only for someone with a new hazard."""
    import safe_route as sr
    now = now or _now()
    plan_fn = plan_fn or sr.plan
    hazards_fn = hazards_fn or sr.hazards_near
    raised = 0
    for p in await asyncio.to_thread(subjects, now):
        uid = str(p["user_id"])
        try:
            hz = await asyncio.to_thread(hazards_fn, p["lat"], p["lon"], sr.HAZARD_SEARCH_KM, now)
            near = [h for h in hz if relevant(h, now)]
            if not near:
                continue
            con = _con()
            told = _told(con, uid)
            con.close()
            new = [h for h in near if h["id"] not in told]
            if not new:
                continue
            try:
                plan = await plan_fn(p["lat"], p["lon"], "foot", hazards=hz, now=now)
            except Exception as e:                       # noqa: BLE001 — the warning goes out without a street
                print(f"[exit-watch] error: plan for {uid}: {type(e).__name__}: {e}", flush=True)
                plan = None
            asset_id = await asyncio.to_thread(_linked_asset, uid)
            plan_id = None
            if plan and plan.get("origin"):
                try:
                    import route_plans as rp
                    req = {"from": {"asset_id": asset_id} if asset_id else {"me": True}, "to": None, "mode": "foot", "purpose": "exit"}
                    plan_id = await asyncio.to_thread(rp.save, uid, req, {**plan, "purpose": "exit"}, asset_id, uid)
                except Exception as e:                   # noqa: BLE001
                    print(f"[exit-watch] error: saving the plan for {uid}: {type(e).__name__}: {e}", flush=True)
            if await asyncio.to_thread(record, uid, p["lat"], p["lon"], new, plan, now, "auto", None, asset_id, plan_id):
                raised += 1
        except Exception as e:                           # noqa: BLE001
            print(f"[exit-watch] error: {uid}: {type(e).__name__}: {e}", flush=True)
    return raised


def send(subject_id: str, lat: float, lon: float, plan: dict, sender: dict, asset_id: str | None,
         now: _dt.datetime | None = None, plan_id: str | None = None) -> dict:
    """The owner or an admin sends the safest route to the person themself."""
    now = now or _now()
    top = (plan.get("hazards") or [None])[0]
    h = {"id": f"sent:{int(now.timestamp())}", "kind": top["kind"] if top else "other", "label": top["label"] if top else "",
         "lat": top["lat"] if top else lat, "lon": top["lon"] if top else lon, "place": top["place"] if top else "",
         "what": top["what"] if top else "", "weight": 1.0, "distance_m": top.get("distance_m") if top else None,
         "source": {"label": f"sent by {sender.get('name') or sender.get('email') or 'the desk'}"}}
    record(subject_id, lat, lon, [h], plan, now, "sent", str(sender.get("id") or ""), asset_id, plan_id)
    return {"subject_id": subject_id, "hazard_id": h["id"]}


# ── the cards ─────────────────────────────────────────────────────────────

def _users() -> dict:
    import owned_assets as oa
    try:
        con = sqlite3.connect(oa._db_path(), timeout=5)
        rows = con.execute("SELECT id, name, email, role, is_super_admin FROM users").fetchall()
        con.close()
    except sqlite3.Error:
        return {}
    return {str(r[0]): {"name": r[1] or (r[2] or "").split("@")[0] or "Someone",
                        "admin": bool(r[4]) or str(r[3] or "").lower() == "admin"} for r in rows}


def _dist(m) -> str:
    if m is None:
        return "near"
    return f"{round(m / 10) * 10:g} m" if m < 1000 else f"{m / 1000:.1f} km"


def card(row: dict, viewer_id: str, users: dict, now: _dt.datetime | None = None) -> dict:
    import safe_route as sr
    now = now or _now()
    h = json.loads(row.get("hazard") or "{}")
    me = str(row["subject_id"]) == str(viewer_id)
    who = "you" if me else users.get(str(row["subject_id"]), {}).get("name", "your asset")
    via = row.get("leave_via")
    if row.get("kind") == "sent":
        sender = users.get(str(row.get("sent_by")), {}).get("name", "The desk")
        title = f"{sender} sent you the safest way out" + (f" — leave via {via}" if via else "")
        reason = (f"{h.get('label', '').capitalize()} at {h.get('place')}, {_dist(row.get('distance_m'))} from you"
                  if h.get("label") and h.get("place") else "No live hazard was named; the route avoids what is known")
        sev = "high"
    else:
        what = "Unrest" if h.get("kind") not in ("kinetic", "verified", "advance") else "Violence"
        title = f"{what} near {who} — " + (f"leave via {via} (safest route ready)" if via else "safest route out ready")
        when = ""
        if h.get("starts_utc"):
            st = sr._utc(h["starts_utc"])
            if st:
                mins = round((st - now).total_seconds() / 60)
                when = f"starts in {mins} min" if mins > 0 else f"under way for {-mins} min"
        elif h.get("at"):
            t = sr._utc(h["at"])
            when = f"reported {sr.ago((now - t).total_seconds() / 60)}" if t else ""
        src = (h.get("source") or {}).get("label")
        reason = (f"{(h.get('label') or 'hazard').capitalize()} at {h.get('place') or 'a place nearby'}, "
                  f"{_dist(row.get('distance_m'))} from {'you' if me else who}"
                  + (f" — {when}" if when else "") + (f" ({src})" if src else ""))
        sev = "critical"
    return {"id": f"exit:{row['subject_id']}:{row['hazard_id']}", "kind": "exit", "alert_type": ALERT_TYPE,
            "title": title, "reason": reason, "advice": row.get("explanation"), "sev": sev, "notify": True,
            "lat": row["lat"], "lon": row["lon"], "asset_id": row.get("asset_id"), "subject_id": str(row["subject_id"]),
            "route_plan_id": row.get("route_plan_id"),
            "hazard": {k: h.get(k) for k in ("id", "label", "place", "lat", "lon")}, "created_at": row["created_at"],
            "source": (h.get("source") or {}).get("label")}


def notifications_for(uid: str | None, now: _dt.datetime | None = None) -> list[dict]:
    """The exit cards this user may see: their own, the people linked to
    assets they own, everyone's when they are an admin."""
    if not uid:
        return []
    import owned_assets as oa
    now = now or _now()
    since = (now - _dt.timedelta(hours=CARD_HOURS)).isoformat()
    try:
        con = _con(5)
        rows = [dict(r) for r in con.execute("SELECT * FROM exit_alerts WHERE created_at >= ? AND folded = 0 "
                                             "ORDER BY created_at DESC LIMIT 50", (since,))]
        con.close()
    except sqlite3.Error:
        return []
    if not rows:
        return []
    users = _users()
    admin = users.get(str(uid), {}).get("admin", False)
    owned = set()
    try:
        c2 = oa._con(5)
        owned = {r[0] for r in c2.execute("SELECT json_extract(identifiers, '$.user_id') FROM owned_assets WHERE owner_id=?",
                                          (str(uid),)) if r[0]}
        c2.close()
    except sqlite3.Error:
        pass
    out = []
    for r in rows:
        mine = str(r["subject_id"]) == str(uid)
        if r.get("kind") == "sent" and not mine:
            continue
        if mine or admin or str(r["subject_id"]) in owned:
            out.append(card(r, str(uid), users, now))
    return out
