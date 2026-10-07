"""
routers/briefing_engine.py — the briefing engine over HTTP (briefing/ package).

  GET  /api/briefings2/profile           the caller's recipient profile (derived until saved)
  PUT  /api/briefings2/profile           save it
  POST /api/briefings2/profile/reset     back to what the console derives
  GET  /api/briefings2/estimate?cadence  cost estimate, cap, and whether the model is available
  POST /api/briefings2/runs              start a run {cadence, language, rehearse?}
  GET  /api/briefings2/runs              the caller's runs
  GET  /api/briefings2/runs/{id}         one run's state (the stepper polls this)
  GET  /api/briefings2/runs/{id}/doc     the document, for the interactive reader
  GET  /api/briefings2/runs/{id}/pdf     the PDF
  GET  /api/briefings2/runs/{id}/deck    the deck (.pptx), built from the document
"""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse

from briefing import job, profile as prof_mod, spec

router = APIRouter(prefix="/api/briefings2", tags=["briefings"])


def _me(request: Request) -> dict:
    from main import _require_current_user
    return _require_current_user(request)


def _uid(u: dict) -> str:
    return str(u.get("id") or u.get("email"))


def _mine(request: Request, run_id: str) -> dict:
    u = _me(request)
    r = job.get(run_id)
    if not r or r["user_id"] != _uid(u):
        raise HTTPException(404, "no such briefing")
    return r


@router.get("/profile")
def get_profile(request: Request):
    return prof_mod.get(_uid(_me(request)))


@router.put("/profile")
async def put_profile(request: Request):
    u = _me(request)
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "a JSON object is required")
    return prof_mod.save(_uid(u), body)


@router.post("/profile/reset")
def reset_profile(request: Request):
    return prof_mod.reset(_uid(_me(request)))


@router.get("/estimate")
def estimate(request: Request, cadence: str = "weekly"):
    _me(request)
    if cadence not in spec.CADENCES:
        raise HTTPException(400, "cadence must be daily, weekly or monthly")
    return {**spec.estimate(cadence), "cap_usd": job.cap_for(cadence), **job.model_status(),
            "parts": spec.parts_for(cadence), "languages": list(spec.LANGUAGES)}


@router.post("/runs")
async def start_run(request: Request):
    u = _me(request)
    body = await request.json()
    cadence = body.get("cadence") or "weekly"
    language = body.get("language") or "de"
    if cadence not in spec.CADENCES or language not in spec.LANGUAGES:
        raise HTTPException(400, "cadence or language not supported")
    running = [r for r in job.list_for(_uid(u), 10) if r["status"] in ("queued", "running")]
    if len(running) >= 2:
        raise HTTPException(429, "two briefings are already being written; wait for one to finish")
    return job.start(_uid(u), cadence, language, rehearse=bool(body.get("rehearse")))


@router.get("/runs")
def list_runs(request: Request):
    return job.list_for(_uid(_me(request)))


@router.get("/runs/{run_id}")
def get_run(request: Request, run_id: str):
    return _mine(request, run_id)


@router.get("/runs/{run_id}/doc")
def get_doc(request: Request, run_id: str):
    _mine(request, run_id)
    p = job.run_dir(run_id) / "doc.json"
    if not p.exists():
        raise HTTPException(404, "the document is not written yet")
    return JSONResponse(json.loads(p.read_text()))


@router.get("/runs/{run_id}/pdf")
def get_pdf(request: Request, run_id: str):
    r = _mine(request, run_id)
    p = job.run_dir(run_id) / "briefing.pdf"
    if not p.exists():
        raise HTTPException(404, "the PDF is not printed yet")
    name = f"{(r.get('title') or 'Parallax briefing').replace('/', '-')}.pdf"
    return FileResponse(str(p), media_type="application/pdf", filename=name)


@router.get("/runs/{run_id}/deck")
def get_deck(request: Request, run_id: str):
    r = _mine(request, run_id)
    d = job.run_dir(run_id)
    if not (d / "doc.json").exists():
        raise HTTPException(404, "the document is not written yet")
    from briefing import deck
    out = d / "briefing.pptx"
    if not out.exists() or out.stat().st_mtime < (d / "doc.json").stat().st_mtime:
        deck.build(json.loads((d / "doc.json").read_text()), out)
    name = f"{(r.get('title') or 'Parallax briefing').replace('/', '-')}.pptx"
    return FileResponse(str(out), media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation", filename=name)
