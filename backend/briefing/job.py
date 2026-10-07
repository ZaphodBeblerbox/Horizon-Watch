"""
briefing/job.py — one briefing run, from profile to PDF, in the background.

A run can take from a minute (daily) to most of an hour (monthly with
research); it is a thread, not a request. Its state is a row in
briefing_runs (stage, progress line, cost so far, error) so the console can
show a stepper and a reload does not lose it; its products are files under
DATA_DIR/briefings/<run id>/: the evidence, the research, the document
(JSON — what the interactive reader shows) and the PDF.

Stages: profile → collect → research → write → validate → print → done.
With no usable model (no key, no credit, purpose off, budget spent) or
when asked for a rehearsal, research is skipped and the rehearsal writer
fills the issue from the evidence; the reason is printed on it. A run that
reaches its cost cap mid-way finishes the same way rather than stopping.
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import sqlite3
import threading
import traceback
import uuid
from pathlib import Path

from . import collect, llm, profile as prof_mod, rehearsal, render, research, spec, validate, write

DDL = """
CREATE TABLE IF NOT EXISTS briefing_runs (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    cadence     TEXT NOT NULL,
    language    TEXT NOT NULL,
    period_start TEXT, period_end TEXT,
    status      TEXT NOT NULL,          -- queued | running | done | failed
    stage       TEXT, progress TEXT,
    mode        TEXT,                   -- model | rehearsal
    reason      TEXT,                   -- why rehearsal, when it is one
    estimate    TEXT, ledger TEXT,
    pages       INTEGER, qa TEXT,
    title       TEXT,
    error       TEXT,
    created_at  TEXT, finished_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_briefing_runs_user ON briefing_runs (user_id, created_at);
"""
STAGES = ("profile", "collect", "research", "write", "validate", "print", "done")
_THREADS: dict[str, threading.Thread] = {}


def _db_path() -> str:
    return prof_mod._db_path()


def _con(db_path: str | None = None):
    con = sqlite3.connect(db_path or _db_path(), timeout=60)
    con.executescript(DDL)
    con.row_factory = sqlite3.Row
    return con


def run_dir(run_id: str) -> Path:
    try:
        from paths import data_path
        p = Path(data_path("briefings", run_id, ".keep")).parent
    except Exception:                                        # noqa: BLE001
        p = Path(__file__).resolve().parent.parent / "data" / "briefings" / run_id
    p.mkdir(parents=True, exist_ok=True)
    return p


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


def cap_for(cadence: str) -> float:
    """The most a run may spend: BRIEFING_CAP_USD, else 1.5 × the high estimate."""
    env = os.getenv(f"BRIEFING_CAP_USD_{cadence.upper()}") or os.getenv("BRIEFING_CAP_USD")
    return float(env) if env else round(spec.estimate(cadence)["usd_high"] * 1.5, 2)


def model_status() -> dict:
    try:
        llm.client()
        return {"available": True, "model": spec.MODEL}
    except llm.Unavailable as e:
        return {"available": False, "model": spec.MODEL, "reason": str(e)}


def _update(run_id: str, db_path: str | None = None, **kw) -> None:
    con = _con(db_path)
    try:
        cols = ", ".join(f"{k} = ?" for k in kw)
        con.execute(f"UPDATE briefing_runs SET {cols} WHERE id = ?", (*[json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v
                                                                         for v in kw.values()], run_id))
        con.commit()
    finally:
        con.close()


def start(user_id: str, cadence: str, language: str, end: _dt.datetime | None = None, rehearse: bool = False,
          db_path: str | None = None, background: bool = True, cli=None) -> dict:
    if cadence not in spec.CADENCES or language not in spec.LANGUAGES:
        raise ValueError("cadence or language not supported")
    s, e = collect.period_for(cadence, end)
    run_id = f"BR-{_dt.datetime.now(_dt.timezone.utc):%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:6]}"
    est = {**spec.estimate(cadence), "cap_usd": cap_for(cadence)}
    con = _con(db_path)
    try:
        con.execute("INSERT INTO briefing_runs (id, user_id, cadence, language, period_start, period_end, status, stage, progress, "
                    "estimate, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (run_id, user_id, cadence, language, s.isoformat(), e.isoformat(), "queued", "profile", "", json.dumps(est), _now()))
        con.commit()
    finally:
        con.close()
    args = (run_id, user_id, cadence, language, s, e, rehearse, db_path, cli)
    if background:
        t = threading.Thread(target=_run, args=args, name=f"briefing-{run_id}", daemon=True)
        _THREADS[run_id] = t
        t.start()
    else:
        _run(*args)
    return get(run_id, db_path)


def _run(run_id, user_id, cadence, language, s, e, rehearse, db_path, cli) -> None:
    d = run_dir(run_id)

    def stage(name, progress=""):
        _update(run_id, db_path, status="running", stage=name, progress=progress)

    ledger = llm.Ledger(cap_usd=cap_for(cadence))
    try:
        stage("profile")
        profile = prof_mod.get(user_id, db_path)
        (d / "profile.json").write_text(json.dumps(profile, ensure_ascii=False, indent=1))

        stage("collect")
        evidence = collect.collect(profile, cadence, s, e, db_path=db_path)
        (d / "evidence.json").write_text(json.dumps(evidence, ensure_ascii=False))
        stage("collect", f"{evidence['funnel']['used']} events from {evidence['funnel']['read']} signals")

        reason = ""
        mode = "rehearsal"
        if rehearse:
            reason = "rehearsal requested"
        elif cli is None:
            st = model_status()
            mode, reason = ("model", "") if st["available"] else ("rehearsal", st["reason"])
        else:
            mode = "model"
        doc = None
        if mode == "model":
            try:
                stage("research")
                res = research.run(profile, evidence, cadence, ledger, cli=cli, progress=lambda m: stage("research", m))
                (d / "research.json").write_text(json.dumps(res, ensure_ascii=False))
                _update(run_id, db_path, ledger=ledger.as_dict())
                stage("write")
                doc = write.build(profile, evidence, res, cadence, language, s, e, ledger, cli=cli, run_id=run_id,
                                  progress=lambda m: (stage("write", m), _update(run_id, db_path, ledger=ledger.as_dict())))
            except (llm.CapReached, llm.Unavailable) as ex:
                mode, reason = "rehearsal", str(ex)
            except Exception as ex:                          # noqa: BLE001
                # a model failure (bad JSON twice, an API error) still delivers the evidence as an issue
                traceback.print_exc()
                mode, reason = "rehearsal", f"model run failed: {ex}"[:300]
        if doc is None:
            stage("write", "rehearsal")
            doc = rehearsal.build(profile, evidence, cadence, language, s, e, run_id=run_id, reason=reason)
            stage("validate")
            doc["meta"]["qa_issues"] = validate.fix(doc, {x["sid"] for x in evidence["events"]})
        doc["meta"]["run_id"] = run_id
        doc["meta"]["ledger"] = ledger.as_dict()
        (d / "doc.json").write_text(json.dumps(doc, ensure_ascii=False))

        stage("print")
        r = render.render_pdf(doc, d / "briefing.pdf")
        _update(run_id, db_path, status="done", stage="done", progress="", mode=mode, reason=reason, ledger=ledger.as_dict(),
                pages=r["pages"], qa={"layout": r["qa"], "content": doc["meta"].get("qa_issues")}, title=doc["meta"]["title"],
                finished_at=_now())
    except Exception as ex:                                  # noqa: BLE001
        traceback.print_exc()
        _update(run_id, db_path, status="failed", error=f"{type(ex).__name__}: {ex}"[:600], ledger=ledger.as_dict(), finished_at=_now())
    finally:
        _THREADS.pop(run_id, None)


def _row(r) -> dict:
    out = dict(r)
    for k in ("estimate", "ledger", "qa"):
        try:
            out[k] = json.loads(out[k]) if out.get(k) else None
        except (TypeError, ValueError):
            pass
    d = run_dir(out["id"])
    out["has_pdf"] = (d / "briefing.pdf").exists()
    out["has_doc"] = (d / "doc.json").exists()
    return out


def get(run_id: str, db_path: str | None = None) -> dict | None:
    con = _con(db_path)
    try:
        r = con.execute("SELECT * FROM briefing_runs WHERE id = ?", (run_id,)).fetchone()
    finally:
        con.close()
    return _row(r) if r else None


def list_for(user_id: str, limit: int = 30, db_path: str | None = None) -> list[dict]:
    con = _con(db_path)
    try:
        rows = con.execute("SELECT * FROM briefing_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?", (user_id, limit)).fetchall()
    finally:
        con.close()
    return [_row(r) for r in rows]


def recover_interrupted(db_path: str | None = None) -> int:
    """Runs left 'running' by a restart are failed, not shown as running forever."""
    con = _con(db_path)
    try:
        n = con.execute("UPDATE briefing_runs SET status = 'failed', error = 'interrupted by a server restart', finished_at = ? "
                        "WHERE status IN ('queued', 'running')", (_now(),)).rowcount
        con.commit()
    finally:
        con.close()
    return n
