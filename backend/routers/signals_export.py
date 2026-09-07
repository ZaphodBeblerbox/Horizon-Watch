"""routers/signals_export.py — /api/signals/export* endpoints.

A real, deterministic "top signals for a period" export — zero Claude/model
calls anywhere in this module or in signals_export.py, the module this
router calls into. Every exported field traces to a real stored value; see
signals_export.py's own module docstring for the full per-domain field
mapping and why each excerpt field is guaranteed non-Claude-authored.
"""
from __future__ import annotations
import datetime

from fastapi import APIRouter, Query, Response
from fastapi.responses import JSONResponse

import signals_export as _se
from database import get_db

router = APIRouter(prefix="/api/signals", tags=["signals-export"])


def _parse_window(date_from: str | None, date_to: str | None) -> tuple[datetime.datetime, datetime.datetime]:
    """Real ISO-8601 parsing, real UTC-now defaults — never a fabricated
    fallback window. `to` defaults to now; `from` defaults to 7 real days
    before `to` if not supplied."""
    dt_to = datetime.datetime.fromisoformat(date_to) if date_to else datetime.datetime.utcnow()
    dt_from = datetime.datetime.fromisoformat(date_from) if date_from else (dt_to - datetime.timedelta(days=7))
    return dt_from, dt_to


@router.get("/export")
def signals_export_json(
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
    domain: str | None = Query(None),
    region: str | None = Query(None),
    country: str | None = Query(None),
    min_severity: str | None = Query(None),
    limit: int = Query(3000, ge=1, le=20000),
):
    """Real JSON preview — same real query the CSV/PDF exports use, for the
    UI's live count/preview before the user actually downloads a file."""
    dt_from, dt_to = _parse_window(date_from, date_to)
    with get_db() as db:
        result = _se.query_top_signals(
            db, dt_from, dt_to, domain=domain, region=region, country=country,
            min_severity=min_severity, limit=limit,
        )
    # Real timestamps only — just serialized to ISO strings for JSON (the
    # CSV/PDF builders below call the same query_top_signals() and handle
    # the real datetime objects themselves; only this JSON response needs
    # the conversion).
    json_signals = []
    for r in result["signals"]:
        r2 = dict(r)
        ts = r2.get("timestamp")
        r2["timestamp"] = ts.isoformat() if isinstance(ts, datetime.datetime) else ts
        json_signals.append(r2)
    result = {**result, "signals": json_signals}
    return JSONResponse(result)


@router.get("/export.csv")
def signals_export_csv(
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
    domain: str | None = Query(None),
    region: str | None = Query(None),
    country: str | None = Query(None),
    min_severity: str | None = Query(None),
    limit: int = Query(3000, ge=1, le=20000),
):
    dt_from, dt_to = _parse_window(date_from, date_to)
    with get_db() as db:
        result = _se.query_top_signals(
            db, dt_from, dt_to, domain=domain, region=region, country=country,
            min_severity=min_severity, limit=limit,
        )
    csv_text = _se.build_csv(result)
    fname = f"signals-export-{dt_from.date().isoformat()}-to-{dt_to.date().isoformat()}.csv"
    return Response(
        content=csv_text, media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.get("/export.pdf")
def signals_export_pdf(
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
    domain: str | None = Query(None),
    region: str | None = Query(None),
    country: str | None = Query(None),
    min_severity: str | None = Query(None),
    limit: int = Query(3000, ge=1, le=20000),
):
    dt_from, dt_to = _parse_window(date_from, date_to)
    with get_db() as db:
        result = _se.query_top_signals(
            db, dt_from, dt_to, domain=domain, region=region, country=country,
            min_severity=min_severity, limit=limit,
        )
    pdf_bytes = _se.build_pdf(result)
    fname = f"signals-export-{dt_from.date().isoformat()}-to-{dt_to.date().isoformat()}.pdf"
    return Response(
        content=pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
