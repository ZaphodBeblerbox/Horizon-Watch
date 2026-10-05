"""
outlook_store.py — keeping the day's forecasts so they can be marked.

WHY THIS EXISTS. The Home screen already had a scorecard that read
"Nothing has resolved yet" against `record: {n: 0}` — and it was honest,
because the old forecasts were category-level statements with no criterion
and no date. Nothing could resolve, so nothing ever did, so the
probabilities meant nothing. That is the whole defect.

A forecast is only worth a number if the number can later be shown to have
been wrong. So every statement is stored with:

  - the criterion that settles it, written before the fact
  - the date it resolves by
  - the probability given at the time
  - the signals it rested on

and `resolve()` records what happened. Then a Brier score is arithmetic
rather than an aspiration.

NOTHING IS AUTO-RESOLVED. A criterion is settled by a person or by a later
signal a person points at. A system that marks its own homework is the
failure mode this is built to avoid.
"""
from __future__ import annotations

import datetime
import hashlib
import json
import os
import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS outlook_forecasts (
    id          TEXT PRIMARY KEY,
    made_at     TEXT NOT NULL,
    place       TEXT,
    actor       TEXT,
    statement   TEXT NOT NULL,
    because     TEXT,
    criterion   TEXT NOT NULL,
    resolves_by TEXT,
    probability INTEGER,
    citations   TEXT NOT NULL DEFAULT '[]',
    model       TEXT,
    -- open | happened | did_not | void
    outcome     TEXT NOT NULL DEFAULT 'open',
    resolved_at TEXT,
    resolved_by TEXT,
    resolve_note TEXT
);
CREATE INDEX IF NOT EXISTS ix_outlook_open ON outlook_forecasts(outcome, resolves_by);
CREATE INDEX IF NOT EXISTS ix_outlook_made ON outlook_forecasts(made_at);
"""


def _path() -> str:
    try:
        from main import DATA_DIR
        return os.path.join(DATA_DIR, "akili.db")
    except Exception:
        return os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "akili.db")


def _conn():
    con = sqlite3.connect(_path(), timeout=30)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    return con


def _now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def _id(statement: str, criterion: str) -> str:
    """Stable on the CRITERION, not the wording.

    The same forecast restated slightly differently the next morning is the
    same forecast, and storing it twice would double-count it in the score.
    """
    h = hashlib.sha1(f"{statement.strip().lower()}|{criterion.strip().lower()}".encode())
    return "FC-" + h.hexdigest()[:10]


def record(statements: list[dict], model: str = "") -> dict:
    """Store today's outlook. Returns how many were new."""
    if not statements:
        return {"stored": 0, "already": 0}
    con = _conn()
    stored = already = 0
    try:
        for s in statements:
            statement = str(s.get("statement") or "").strip()
            criterion = str(s.get("criterion") or "").strip()
            if not statement or not criterion:
                continue
            fid = _id(statement, criterion)
            if con.execute("SELECT 1 FROM outlook_forecasts WHERE id=?", (fid,)).fetchone():
                already += 1
                continue
            con.execute(
                "INSERT INTO outlook_forecasts (id, made_at, place, actor, statement,"
                " because, criterion, resolves_by, probability, citations, model)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (fid, _now(), s.get("place"), s.get("actor"), statement,
                 s.get("because"), criterion, s.get("resolves_by"),
                 s.get("probability"), json.dumps(s.get("citations") or []), model))
            stored += 1
        con.commit()
    finally:
        con.close()
    return {"stored": stored, "already": already}


def _row(r) -> dict:
    d = dict(r)
    try:
        d["citations"] = json.loads(d.get("citations") or "[]")
    except json.JSONDecodeError:
        d["citations"] = []
    return d


def listing(outcome: str | None = None, limit: int = 100) -> list[dict]:
    con = _conn()
    try:
        if outcome:
            rows = con.execute(
                "SELECT * FROM outlook_forecasts WHERE outcome=? ORDER BY made_at DESC LIMIT ?",
                (outcome, limit)).fetchall()
        else:
            rows = con.execute(
                "SELECT * FROM outlook_forecasts ORDER BY made_at DESC LIMIT ?",
                (limit,)).fetchall()
        return [_row(r) for r in rows]
    finally:
        con.close()


def due(limit: int = 50) -> list[dict]:
    """Open forecasts whose date has passed — the ones awaiting a verdict.

    Surfaced rather than quietly expired, because an unresolved forecast is
    the thing that makes a scorecard a lie by omission.
    """
    today = datetime.date.today().isoformat()
    con = _conn()
    try:
        rows = con.execute(
            "SELECT * FROM outlook_forecasts WHERE outcome='open' AND resolves_by IS NOT NULL"
            " AND resolves_by <= ? ORDER BY resolves_by ASC LIMIT ?", (today, limit)).fetchall()
        return [_row(r) for r in rows]
    finally:
        con.close()


def resolve(fid: str, outcome: str, by: str = "", note: str = "") -> dict:
    """Mark one. `outcome` is happened | did_not | void.

    `void` is for a forecast the world made unanswerable — the criterion
    turned out to be unobservable, or the question stopped meaning
    anything. It is excluded from the score rather than counted as a miss,
    because a bad criterion is a fault in the forecast, not a wrong call.
    """
    if outcome not in ("happened", "did_not", "void"):
        return {"ok": False, "why": "outcome must be happened, did_not or void"}
    con = _conn()
    try:
        r = con.execute("SELECT 1 FROM outlook_forecasts WHERE id=?", (fid,)).fetchone()
        if not r:
            return {"ok": False, "why": "no such forecast"}
        con.execute(
            "UPDATE outlook_forecasts SET outcome=?, resolved_at=?, resolved_by=?,"
            " resolve_note=? WHERE id=?",
            (outcome, _now(), by or None, (note or "")[:600] or None, fid))
        con.commit()
        return {"ok": True, "id": fid, "outcome": outcome}
    finally:
        con.close()


def scorecard() -> dict:
    """Brier over everything resolved, and the counts behind it.

    Returned with its own n, because a Brier score over four forecasts is
    not a track record and presenting it without the count invites it to be
    read as one.
    """
    con = _conn()
    try:
        rows = con.execute(
            "SELECT probability, outcome FROM outlook_forecasts"
            " WHERE outcome IN ('happened','did_not') AND probability IS NOT NULL").fetchall()
        open_n = con.execute(
            "SELECT COUNT(*) FROM outlook_forecasts WHERE outcome='open'").fetchone()[0]
        void_n = con.execute(
            "SELECT COUNT(*) FROM outlook_forecasts WHERE outcome='void'").fetchone()[0]
    finally:
        con.close()

    if not rows:
        return {"n": 0, "open": open_n, "void": void_n, "brier": None,
                "note": "Nothing has resolved yet. These forecasts carry a "
                        "criterion and a date, so they will."}
    total = 0.0
    hits = 0
    for r in rows:
        p = max(0.0, min(1.0, float(r["probability"]) / 100.0))
        actual = 1.0 if r["outcome"] == "happened" else 0.0
        total += (p - actual) ** 2
        hits += int(actual)
    n = len(rows)
    return {
        "n": n, "open": open_n, "void": void_n,
        "brier": round(total / n, 4),
        "happened": hits, "did_not": n - hits,
        # A coin flip on every question scores 0.25. Saying so is the
        # difference between a number and a judgement about a number.
        "reference": {"always_50_percent": 0.25},
    }
