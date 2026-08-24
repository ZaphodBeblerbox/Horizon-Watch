"""
report_pdf.py — Renders a Report row into an actual PDF file.

This is the piece the earlier audit found completely missing: "no PDF-
generation library exists in the repo, no export endpoint." reportlab is now
a real dependency (requirements.txt) and this module does real, structured
rendering from the report's own stored fields — it does not invent content,
confidence labels, or source-reliability scores that weren't already on the
report. A claim's "Source Evaluation" line only appears if a reviewer
actually filled one in (the NATO Admiralty System — reliability A-F,
credibility 1-6 — entered by a human, never computed).
"""
from __future__ import annotations
import io
from datetime import datetime

from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable,
)


def _styles():
    ss = getSampleStyleSheet()
    ss.add(ParagraphStyle("ClassBanner", parent=ss["Normal"], alignment=TA_CENTER,
                           fontSize=9, textColor=colors.white, leading=12))
    ss.add(ParagraphStyle("ReportTitle", parent=ss["Title"], fontSize=18, spaceAfter=4))
    ss.add(ParagraphStyle("MetaLine", parent=ss["Normal"], fontSize=8, textColor=colors.grey))
    ss.add(ParagraphStyle("SectionHead", parent=ss["Heading2"], fontSize=12, spaceBefore=14, spaceAfter=6))
    ss.add(ParagraphStyle("ClaimText", parent=ss["Normal"], fontSize=10, leading=14, spaceAfter=2))
    ss.add(ParagraphStyle("ClaimMeta", parent=ss["Normal"], fontSize=8, textColor=colors.HexColor("#555555"), leading=11))
    return ss


def _citation_line(citation: dict) -> str:
    if not isinstance(citation, dict):
        return "Citation: none provided"
    if citation.get("type") == "snapshot_ref":
        return f"Source: snapshot data — {citation.get('section', '?')} / {citation.get('item_id', '?')}"
    if citation.get("type") == "external":
        return f"Source: {citation.get('url', 'no URL provided')}"
    return "Citation: unrecognized format"


def _source_eval_line(ev) -> str:
    if not isinstance(ev, dict) or not (ev.get("reliability") or ev.get("credibility")):
        return ""
    code = f"{ev.get('reliability', '?')}{ev.get('credibility', '?')}"
    label = ev.get("confidence_label")
    return f"Source Evaluation: {code}" + (f" / Confidence: {label}" if label else "")


def render_report_pdf(report: dict) -> bytes:
    """report: {report_id, title, classification, status, key_judgments,
    claims (list of {claim_id, text, citation, source_evaluation}),
    created_at, published_at}. Returns raw PDF bytes."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=LETTER,
        topMargin=0.6 * inch, bottomMargin=0.6 * inch,
        leftMargin=0.75 * inch, rightMargin=0.75 * inch,
    )
    ss = _styles()
    story = []

    classification = report.get("classification") or "UNCLASSIFIED"
    banner = Table([[Paragraph(classification, ss["ClassBanner"])]], colWidths=[doc.width])
    banner.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#7a1f1f") if "SECRET" in classification.upper() else colors.HexColor("#2b3a55")),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(banner)
    story.append(Spacer(1, 14))

    story.append(Paragraph(report.get("title") or "Untitled Report", ss["ReportTitle"]))
    status = (report.get("status") or "draft").upper()
    meta_bits = [f"Status: {status}", f"Report ID: {report.get('report_id', '—')}"]
    if report.get("published_at"):
        meta_bits.append(f"Published: {report['published_at']}")
    elif report.get("created_at"):
        meta_bits.append(f"Drafted: {report['created_at']}")
    if status != "PUBLISHED":
        meta_bits.append("NOT YET APPROVED FOR RELEASE")
    story.append(Paragraph(" · ".join(meta_bits), ss["MetaLine"]))
    story.append(Spacer(1, 8))
    story.append(HRFlowable(width="100%", thickness=0.75, color=colors.HexColor("#999999")))

    if report.get("key_judgments"):
        story.append(Paragraph("Key Judgments", ss["SectionHead"]))
        for para in str(report["key_judgments"]).split("\n\n"):
            if para.strip():
                story.append(Paragraph(para.strip().replace("\n", "<br/>"), ss["ClaimText"]))
        story.append(Spacer(1, 6))

    claims = report.get("claims") or []
    story.append(Paragraph(f"Sourced Claims ({len(claims)})", ss["SectionHead"]))
    if not claims:
        story.append(Paragraph("No claims have been added to this report.", ss["ClaimMeta"]))
    for i, c in enumerate(claims, start=1):
        story.append(Paragraph(f"{i}. {c.get('text', '')}", ss["ClaimText"]))
        meta = _citation_line(c.get("citation") or {})
        ev_line = _source_eval_line(c.get("source_evaluation"))
        if ev_line:
            meta += "  ·  " + ev_line
        story.append(Paragraph(meta, ss["ClaimMeta"]))
        story.append(Spacer(1, 6))

    doc.build(story)
    return buf.getvalue()
