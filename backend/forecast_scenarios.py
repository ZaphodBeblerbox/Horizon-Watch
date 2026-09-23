"""
forecast_scenarios.py — scenarios the analyst builds, named and kept.

WHY STORED AT ALL. A scenario is an argument: this aggressor, this
objective, this course of action, at this probability. An argument worth
making is worth coming back to, and worth being wrong in public — the
whole discipline of this module is that a forecast which cannot be
re-read cannot be scored.

WHAT IS STORED AND WHAT IS NOT. The INPUTS are stored: who, against
whom, which objective, which course of action. The laydown is not: it is
derived from geography and capability that both move, and freezing a
picture would let a saved scenario quietly disagree with the map it was
drawn on. Reopening a scenario re-derives it, so it always reflects what
is known now — and if the answer has changed, that is the point.
"""
from __future__ import annotations
import hashlib
import json
import sqlite3
import time

SCHEMA = """
CREATE TABLE IF NOT EXISTS forecast_scenarios (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    target       TEXT NOT NULL,     -- country
    target_place TEXT,              -- optional city/objective name
    target_lat   REAL,
    target_lon   REAL,
    aggressor    TEXT NOT NULL,
    coa          TEXT,              -- ground | air | missile | amphibious | hybrid
    analogues    TEXT,              -- JSON list of conflicts to reason from
    note         TEXT,
    author       TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT
);
CREATE INDEX IF NOT EXISTS ix_fcscen_target ON forecast_scenarios(target);
"""


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


def _now() -> str:
    import datetime as _dt
    return _dt.datetime.now(_dt.timezone.utc).isoformat()


def create(conn: sqlite3.Connection, *, name: str, target: str, aggressor: str,
           target_place: str | None = None, target_lat=None, target_lon=None,
           coa: str | None = None, analogues=None, note: str = "",
           author: str = "") -> dict:
    ensure_schema(conn)
    name = (name or "").strip()
    target = (target or "").strip()
    aggressor = (aggressor or "").strip()
    if not name:
        return {"ok": False, "error": "a scenario needs a name"}
    if not target or not aggressor:
        return {"ok": False, "error": "a scenario needs a target and an aggressor"}
    if target.lower() == aggressor.lower():
        return {"ok": False, "error": "target and aggressor are the same"}

    sid = "SCN-" + hashlib.sha1(
        f"{name}|{target}|{aggressor}|{time.time()}".encode()).hexdigest()[:9]
    conn.execute(
        "INSERT INTO forecast_scenarios (id, name, target, target_place, target_lat,"
        " target_lon, aggressor, coa, analogues, note, author, created_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (sid, name, target, target_place or None,
         float(target_lat) if target_lat is not None else None,
         float(target_lon) if target_lon is not None else None,
         aggressor, coa or None, json.dumps(analogues or []), note or None,
         author or None, _now()))
    conn.commit()
    return {"ok": True, "id": sid}


def _row(r) -> dict:
    return {
        "id": r[0], "name": r[1], "target": r[2], "target_place": r[3],
        "target_lat": r[4], "target_lon": r[5], "aggressor": r[6], "coa": r[7],
        "analogues": json.loads(r[8] or "[]"), "note": r[9], "author": r[10],
        "created_at": r[11], "updated_at": r[12],
    }


_COLS = ("id, name, target, target_place, target_lat, target_lon, aggressor,"
         " coa, analogues, note, author, created_at, updated_at")


def listing(conn: sqlite3.Connection, limit: int = 100) -> list:
    ensure_schema(conn)
    rows = conn.execute(
        f"SELECT {_COLS} FROM forecast_scenarios"
        " ORDER BY COALESCE(updated_at, created_at) DESC LIMIT ?",
        (max(1, min(500, limit)),)).fetchall()
    return [_row(r) for r in rows]


def get(conn: sqlite3.Connection, sid: str) -> dict | None:
    ensure_schema(conn)
    r = conn.execute(f"SELECT {_COLS} FROM forecast_scenarios WHERE id = ?",
                     (sid,)).fetchone()
    return _row(r) if r else None


def update(conn: sqlite3.Connection, sid: str, **fields) -> dict:
    ensure_schema(conn)
    allowed = {"name", "target", "target_place", "target_lat", "target_lon",
               "aggressor", "coa", "note"}
    sets, vals = [], []
    for k, v in fields.items():
        if k in allowed and v is not None:
            sets.append(f"{k} = ?")
            vals.append(v)
    if "analogues" in fields and fields["analogues"] is not None:
        sets.append("analogues = ?")
        vals.append(json.dumps(fields["analogues"]))
    if not sets:
        return {"ok": False, "error": "nothing to update"}
    sets.append("updated_at = ?")
    vals.append(_now())
    vals.append(sid)
    cur = conn.execute(
        f"UPDATE forecast_scenarios SET {', '.join(sets)} WHERE id = ?", vals)
    conn.commit()
    return {"ok": cur.rowcount > 0,
            "error": None if cur.rowcount else "no such scenario"}


def delete(conn: sqlite3.Connection, sid: str) -> dict:
    ensure_schema(conn)
    cur = conn.execute("DELETE FROM forecast_scenarios WHERE id = ?", (sid,))
    conn.commit()
    return {"ok": cur.rowcount > 0}
