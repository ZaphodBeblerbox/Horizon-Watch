"""route_plans.py — saved route plans (the `route_plans` table).

A plan is saved with what was asked (origin, destination, mode, depart
time, the hazard providers used) and its last answer, so it can be opened
again by id, RE-CHECKED against the hazards of the moment, and sent to a
person. Status: ok · unsafe (a check found a new danger on it) · rerouted
(re-planned after that) · no_safe_route · no_route.
"""
from __future__ import annotations

import datetime as _dt
import json
import sqlite3
import uuid

DDL = """
CREATE TABLE IF NOT EXISTS route_plans (
    id           TEXT PRIMARY KEY,
    owner_id     TEXT NOT NULL,
    asset_id     TEXT,
    subject_id   TEXT,             -- the person it is for, when known
    purpose      TEXT,             -- exit · access · trip · …
    mode         TEXT NOT NULL,
    origin       TEXT NOT NULL,    -- JSON {lat, lon, label?}
    destination  TEXT,             -- JSON {lat, lon, name?} or null (automatic safe points)
    depart_at    TEXT,
    request      TEXT,             -- JSON: the request as given (providers, avoid …)
    created_at   TEXT NOT NULL,
    last_checked TEXT,
    status       TEXT,
    plan         TEXT              -- JSON: the last answer
);
CREATE INDEX IF NOT EXISTS ix_route_plans_owner ON route_plans (owner_id, created_at);
"""
KEEP_DAYS = 30


def _con(timeout: float = 10):
    import owned_assets as oa
    con = sqlite3.connect(oa._db_path(), timeout=timeout)
    con.executescript(DDL)
    con.row_factory = sqlite3.Row
    return con


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat()


def save(owner_id: str, request: dict, plan: dict, asset_id: str | None = None, subject_id: str | None = None) -> str:
    pid = f"RP-{uuid.uuid4().hex[:10]}"
    con = _con()
    try:
        con.execute("INSERT INTO route_plans (id, owner_id, asset_id, subject_id, purpose, mode, origin, destination, depart_at,"
                    " request, created_at, last_checked, status, plan) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (pid, str(owner_id), asset_id, subject_id, request.get("purpose"), plan.get("mode"),
                     json.dumps(plan.get("origin")), json.dumps(request.get("to")) if request.get("to") else None,
                     plan.get("depart_at"), json.dumps(request), _now(), _now(), plan.get("status"), json.dumps(plan)))
        con.execute("DELETE FROM route_plans WHERE created_at < ?",
                    ((_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=KEEP_DAYS)).isoformat(),))
        con.commit()
    finally:
        con.close()
    return pid


def get(pid: str) -> dict | None:
    con = _con()
    try:
        r = con.execute("SELECT * FROM route_plans WHERE id=?", (pid,)).fetchone()
    finally:
        con.close()
    if not r:
        return None
    d = dict(r)
    for k in ("origin", "destination", "request", "plan"):
        d[k] = json.loads(d[k]) if d.get(k) else None
    return d


def update(pid: str, status: str, plan: dict | None = None) -> None:
    con = _con()
    try:
        if plan is not None:
            con.execute("UPDATE route_plans SET status=?, last_checked=?, plan=? WHERE id=?", (status, _now(), json.dumps(plan), pid))
        else:
            con.execute("UPDATE route_plans SET status=?, last_checked=? WHERE id=?", (status, _now(), pid))
        con.commit()
    finally:
        con.close()


def visible(row: dict, user: dict) -> bool:
    """The owner, the person it is for, and admins."""
    uid = str(user.get("id") or user.get("email"))
    admin = bool(user.get("is_super_admin")) or str(user.get("role") or "").lower() == "admin"
    return admin or str(row.get("owner_id")) == uid or str(row.get("subject_id") or "") == uid
