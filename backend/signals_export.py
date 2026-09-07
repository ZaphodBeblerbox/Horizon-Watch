"""
signals_export.py — real, deterministic "top signals for a period" query and
CSV/PDF export. Zero Claude/model calls anywhere in this module — every
exported field traces to a real stored value, never a generated sentence.

Real "signal" universe reused from the same one asset_exposure.py and
exposure_index.py's nearby_signals() already treat as authoritative: Alert
(AIS/ADSB/dark-ship/sanctions/chokepoint/news-pattern detections),
NewsArticle (individual real articles that cleared the real relevance/tier
funnel), FusionEvent (real cross-domain convergences), SurgeEvent (real
news-volume anomalies). No new "Signal" table, no new scoring formula.

Ranking reuses exposure_index.py's own real severity-rank ordinal scale
(_SEV_RANK/_TIER_SEV) — the same one that module's real severityWeight term
already uses to score entities. This module does NOT port exposure_index.py's
full severity+persistence+corroboration composite: persistence and
corroboration are properties of a *set* of signals about one entity over
time, not of a single signal in isolation, so applying them here would be
inventing a new, unrequested formula rather than faithfully reusing the real
one. Real secondary tiebreakers (FusionEvent.confidence, Alert.
correlation_score, NewsArticle.relevance_score) are used only to order
signals that already tie on severity rank — never to override it.

Each domain's real "excerpt" field is chosen to guarantee it is never
Claude-authored text:
  - Alert.title            — a real, deterministic template string built by
                              the detector that fired (e.g. AIS loitering's
                              own message), never a Claude call.
  - NewsArticle.title/body  — the real RSS feed's own headline + a real
                              substring of the real ingested article body.
                              NewsArticle.context_summary/event_title are
                              Claude Haiku output (article_intelligence.py)
                              and are deliberately never read here.
  - SurgeEvent.headline/
    time_window_description — real, deterministic strings built directly
                              from real counts/thresholds. SurgeEvent.
                              context_summary/why_it_matters are Claude
                              output (surge_engine.py's
                              _generate_surge_explanation) and are
                              deliberately never read here.
  - FusionEvent             — title/subtitle/narrative are ALL Claude output
                              (fusion_engine.py's Haiku narrative pass) —
                              there is no real, non-generated text field on a
                              FusionEvent at all. The excerpt is left honestly
                              blank for fusion rows rather than substituting
                              Claude-authored text or inventing one.
"""
from __future__ import annotations
import csv
import io
import datetime
from typing import Optional

from exposure_index import _SEV_RANK, _TIER_SEV, classify_severity_deterministic

# Real domain taxonomy already used across this app (exposure_index.py's
# _DOMAIN_BY_SOURCE, layerRailConfig.js's LAYER_GROUPS keys) — reused
# verbatim, not reinvented.
_ALERT_SOURCE_TO_DOMAIN = {"ais": "maritime", "adsb": "air", "news": "news",
                           "surge": "news", "fusion": "zones", "manual": "zones"}


def _sev_rank(sev: str) -> int:
    return _SEV_RANK.get((sev or "").lower(), 2)


def _row_from_alert(a) -> dict:
    return {
        "id": a.alert_id,
        "kind": "alert",
        "domain": _ALERT_SOURCE_TO_DOMAIN.get((a.source or "").lower(), (a.source or "").lower() or "unknown"),
        "timestamp": a.created_at,
        "severity": (a.severity or "medium").lower(),
        "title": a.title,
        "excerpt": a.title,  # Alert.title is already the real, deterministic full message string
        "country": a.country_code,
        "region": a.region,
        "lat": a.lat, "lon": a.lon,
        "source_name": (a.source or "").upper() or None,
        "source_url": None,
        "corroboration_count": None,
        "score_tiebreak": a.correlation_score if a.correlation_score is not None else 0.0,
    }


def _row_from_article(n) -> dict:
    severity = classify_severity_deterministic(n.title, n.lat, n.lon) or _TIER_SEV.get(n.tier, "medium")
    body = (n.body or "").strip()
    excerpt = body[:280] if body else None
    return {
        "id": n.url,
        "kind": "article",
        "domain": "news",
        "timestamp": n.ingested_at,
        "severity": severity,
        "title": n.title,
        "excerpt": excerpt,
        "country": n.country_code,
        "region": n.region,
        "lat": n.lat, "lon": n.lon,
        "source_name": n.source_name,
        "source_url": n.url,
        "corroboration_count": None,
        "score_tiebreak": (n.relevance_score or 0.0) if n.relevance_score is not None else 0.0,
    }


def _row_from_fusion(f) -> dict:
    try:
        import json as _j
        domains = _j.loads(f.domains) if f.domains else []
    except Exception:
        domains = []
    return {
        "id": f.fusion_id,
        "kind": "fusion",
        "domain": "zones",
        "timestamp": f.created_at,
        "severity": (f.severity or "medium").lower(),
        # Real, structured, non-generated summary of what converged — real
        # domain list + real signal count, not prose. f.title/subtitle/
        # narrative are Claude output and are never read here.
        "title": f"{f.domain_count or len(domains)}-domain convergence ({'+'.join(sorted(domains)) or 'unknown'})",
        "excerpt": None,  # honestly blank — no real non-Claude text field exists on FusionEvent
        "country": f.location_country,
        "region": f.region_id,
        "lat": f.lat, "lon": f.lon,
        "source_name": "FUSION",
        "source_url": None,
        "corroboration_count": f.signal_count,
        "score_tiebreak": f.confidence if f.confidence is not None else 0.0,
    }


def _row_from_surge(s) -> dict:
    evidence_source, evidence_url = None, None
    try:
        import json as _j
        items = _j.loads(s.evidence_items) if s.evidence_items else []
        if items:
            evidence_source = items[0].get("source")
            evidence_url = items[0].get("url")
    except Exception:
        pass
    return {
        "id": s.surge_id,
        "kind": "surge",
        "domain": "news",
        "timestamp": s.created_at,
        "severity": (s.severity or "medium").lower(),
        "title": s.headline,
        "excerpt": s.time_window_description,  # real, deterministic — built from real counts, not Claude
        "country": s.location_country,
        "region": s.region_id,
        "lat": s.lat, "lon": s.lon,
        "source_name": evidence_source or "SURGE",
        "source_url": evidence_url,
        "corroboration_count": s.article_count,
        "score_tiebreak": s.multiplier if s.multiplier is not None else 0.0,
    }


def query_top_signals(
    db,
    dt_from: datetime.datetime,
    dt_to: datetime.datetime,
    domain: Optional[str] = None,       # "maritime" | "air" | "news" | "zones"
    region: Optional[str] = None,
    country: Optional[str] = None,
    min_severity: Optional[str] = None,  # "low" | "medium" | "high" | "critical"
    limit: int = 200,
) -> dict:
    """Real, deterministic top-N signals in [dt_from, dt_to), ranked by the
    real severity-rank scale (exposure_index.py's own _SEV_RANK), with a
    real per-domain numeric tiebreaker for signals that tie on severity.
    Never invents a match, never returns a placeholder — an empty window is
    a real empty result."""
    from database import Alert, NewsArticle, FusionEvent, SurgeEvent

    rows: list[dict] = []

    if domain in (None, "maritime", "air", "zones"):
        q = db.query(Alert).filter(Alert.created_at >= dt_from, Alert.created_at < dt_to)
        if country:
            q = q.filter(Alert.country_code == country)
        if region:
            q = q.filter(Alert.region == region)
        for a in q.limit(5000).all():
            r = _row_from_alert(a)
            if domain and r["domain"] != domain:
                continue
            rows.append(r)

    if domain in (None, "news"):
        q = db.query(NewsArticle).filter(NewsArticle.ingested_at >= dt_from, NewsArticle.ingested_at < dt_to)
        if country:
            q = q.filter(NewsArticle.country_code == country)
        if region:
            q = q.filter(NewsArticle.region == region)
        for n in q.limit(5000).all():
            rows.append(_row_from_article(n))

    if domain in (None, "zones"):
        q = db.query(FusionEvent).filter(FusionEvent.created_at >= dt_from, FusionEvent.created_at < dt_to)
        if country:
            q = q.filter(FusionEvent.location_country == country)
        if region:
            q = q.filter(FusionEvent.region_id == region)
        for f in q.limit(5000).all():
            rows.append(_row_from_fusion(f))

    if domain in (None, "news"):
        q = db.query(SurgeEvent).filter(SurgeEvent.created_at >= dt_from, SurgeEvent.created_at < dt_to)
        if country:
            q = q.filter(SurgeEvent.location_country == country)
        if region:
            q = q.filter(SurgeEvent.region_id == region)
        for s in q.limit(5000).all():
            rows.append(_row_from_surge(s))

    if min_severity:
        floor = _sev_rank(min_severity)
        rows = [r for r in rows if _sev_rank(r["severity"]) >= floor]

    rows.sort(key=lambda r: (_sev_rank(r["severity"]), r["score_tiebreak"] or 0.0, r["timestamp"] or dt_from),
              reverse=True)
    total_matched = len(rows)
    top = rows[:limit]

    return {
        "from": dt_from.isoformat(), "to": dt_to.isoformat(),
        "domain": domain, "region": region, "country": country, "min_severity": min_severity,
        "total_matched": total_matched,
        "returned": len(top),
        "signals": top,
    }


# ── CSV export ────────────────────────────────────────────────────────────

_CSV_FIELDS = [
    "timestamp", "domain", "severity", "title", "country", "region",
    "source_name", "source_url", "corroboration_count", "excerpt",
]


def build_csv(result: dict) -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=_CSV_FIELDS, extrasaction="ignore")
    w.writeheader()
    for r in result["signals"]:
        row = dict(r)
        ts = row.get("timestamp")
        row["timestamp"] = ts.isoformat() if isinstance(ts, datetime.datetime) else (ts or "")
        row["corroboration_count"] = row.get("corroboration_count") if row.get("corroboration_count") is not None else ""
        w.writerow(row)
    return buf.getvalue()


# ── PDF export ────────────────────────────────────────────────────────────

def build_pdf(result: dict) -> bytes:
    """A clean, plain tabular PDF — real fields only, a factual (non-
    narrative) header, no generated summary text anywhere. Reuses report_
    pdf.py's real page-chrome/style plumbing (ReportLab SimpleDocTemplate,
    the same design-token colours, the same running header/footer), not its
    report-specific claims/citation rendering logic."""
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    import report_pdf as _rp
    import functools

    buf = io.BytesIO()
    ss = _rp._styles()
    doc = SimpleDocTemplate(
        buf, pagesize=landscape(A4),
        topMargin=_rp._MARGIN + 10 * mm, bottomMargin=_rp._MARGIN + 6 * mm,
        leftMargin=_rp._MARGIN, rightMargin=_rp._MARGIN,
    )

    story = []
    story.append(Paragraph("Signals Export", ss["ReportTitle"]))
    meta = (
        f"Window: {result['from']} → {result['to']} &middot; "
        f"Domain: {result['domain'] or 'all'} &middot; "
        f"Region: {result['region'] or 'all'} &middot; "
        f"Country: {result['country'] or 'all'} &middot; "
        f"Min severity: {result['min_severity'] or 'none'} &middot; "
        f"Total matched: {result['total_matched']} &middot; "
        f"Shown: {result['returned']}"
    )
    story.append(Paragraph(meta, ss["MetaLine"]))
    story.append(Spacer(1, 8))

    if not result["signals"]:
        story.append(Paragraph("No signals matched this window and these filters.", ss["SectionNote"]))
    else:
        header = ["Time (UTC)", "Domain", "Severity", "Title", "Country", "Source", "Corrob.", "Excerpt"]
        data = [header]
        for r in result["signals"]:
            ts = r.get("timestamp")
            ts_str = ts.strftime("%Y-%m-%d %H:%M") if isinstance(ts, datetime.datetime) else ""
            data.append([
                ts_str,
                r.get("domain") or "",
                (r.get("severity") or "").upper(),
                Paragraph((r.get("title") or "")[:90], ss["ClaimText"]),
                r.get("country") or "",
                r.get("source_name") or "",
                str(r.get("corroboration_count")) if r.get("corroboration_count") is not None else "",
                Paragraph((r.get("excerpt") or "")[:160], ss["ClaimMeta"]),
            ])
        col_widths = [24*mm, 16*mm, 16*mm, 55*mm, 16*mm, 22*mm, 14*mm, 60*mm]
        table = Table(data, colWidths=col_widths, repeatRows=1)
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), _rp._BG_PRIMARY),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CCCCCC")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F5F5F5")]),
        ]))
        story.append(table)

    doc.build(
        story,
        onFirstPage=functools.partial(_rp._page_chrome, classification="UNCLASSIFIED", title="Signals Export"),
        onLaterPages=functools.partial(_rp._page_chrome, classification="UNCLASSIFIED", title="Signals Export"),
    )
    return buf.getvalue()
