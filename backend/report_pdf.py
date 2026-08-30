"""
report_pdf.py — Renders a Report row into the Restructure 08.26 fixed-layout
PDF (Section 6 of that spec): A4, 17-18mm margins, a repeating classification
banner + header on every page, a repeating footer with page number/date/
classification, and the 10 fixed body sections + Annex A in fixed order.

Section content comes from report_sections.build_report_sections() — the
exact same function the in-app editor's API reads from
(GET /api/reports/{report_id}/sections) — so the digital editor and this PDF
can never structurally diverge; only the on-screen chrome differs.

This module does not invent content, confidence labels, or source-reliability
scores that weren't already on the report. A claim's "Source Evaluation" line
only appears if a reviewer actually filled one in (the NATO Admiralty System —
reliability A-F, credibility 1-6 — entered by a human, never computed). A
section with no real backing data in this codebase (see report_sections.py's
module docstring) renders its honest note, never fabricated entries.
"""
from __future__ import annotations
import io
from datetime import datetime

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable,
)

from report_sections import build_report_sections

# Real product design tokens (index.html :root, Round 1 of the UI rebuild) —
# reused here so the exported PDF and the in-app product share one palette,
# not two independently-chosen ones.
_BG_PRIMARY = colors.HexColor("#0A0E16")
_ACCENT     = colors.HexColor("#22D3EE")
_SEV_CRIT   = colors.HexColor("#DC2626")
_TEXT_DIM   = colors.HexColor("#8899AA")

_MARGIN = 18 * mm
_ORG_NAME = "Trifecta Technologies"
_PRODUCT_NAME = "HORIZON WATCH"


def _styles():
    ss = getSampleStyleSheet()
    ss.add(ParagraphStyle("ReportTitle", parent=ss["Title"], fontSize=18, spaceAfter=4))
    ss.add(ParagraphStyle("MetaLine", parent=ss["Normal"], fontSize=8, textColor=colors.grey))
    ss.add(ParagraphStyle("SectionHead", parent=ss["Heading2"], fontSize=12, spaceBefore=14, spaceAfter=6))
    ss.add(ParagraphStyle("ClaimText", parent=ss["Normal"], fontSize=10, leading=14, spaceAfter=2))
    ss.add(ParagraphStyle("ClaimMeta", parent=ss["Normal"], fontSize=8, textColor=colors.HexColor("#555555"), leading=11))
    ss.add(ParagraphStyle("FindingLine", parent=ss["Normal"], fontSize=8, textColor=_SEV_CRIT, leading=11))
    ss.add(ParagraphStyle("SectionNote", parent=ss["Normal"], fontSize=9, textColor=colors.HexColor("#666666"),
                           leading=13, spaceAfter=4))
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


def _finding_lines(findings: list) -> list[str]:
    """Real council findings attached to this claim, rendered as short
    flagged lines — only the ones worth a reviewer's attention (a failed
    deterministic check, or a model lens flagging something), not every
    passing check (that would just be noise on the printed page)."""
    lines = []
    for f in findings or []:
        kind = f.get("kind")
        if kind in ("citation_exists", "geo_sanity") and f.get("passed") is False:
            lines.append(f"⚠ {kind}: {f.get('detail', '')}")
        elif kind == "citation_fidelity" and f.get("verdict") in ("overstated", "unsupported"):
            lines.append(f"⚠ citation_fidelity ({f['verdict']}): {f.get('comment', '')}")
        elif kind == "completeness" and f.get("comment"):
            lines.append(f"note: {f.get('comment', '')}")
    return lines


def _render_claims(story, ss, claims: list, empty_message: str):
    if not claims:
        story.append(Paragraph(empty_message, ss["ClaimMeta"]))
        return
    for i, c in enumerate(claims, start=1):
        story.append(Paragraph(f"{i}. {c.get('text', '')}", ss["ClaimText"]))
        meta = _citation_line(c.get("citation") or {})
        ev_line = _source_eval_line(c.get("source_evaluation"))
        if ev_line:
            meta += "  ·  " + ev_line
        story.append(Paragraph(meta, ss["ClaimMeta"]))
        for line in _finding_lines(c.get("findings")):
            story.append(Paragraph(line, ss["FindingLine"]))
        story.append(Spacer(1, 6))


def _render_section(story, ss, section: dict):
    story.append(Paragraph(f"{section['number']}. {section['title']}", ss["SectionHead"]))

    if section["section_id"] == "key_judgments":
        kj = section.get("key_judgments")
        if kj:
            for para in str(kj).split("\n\n"):
                if para.strip():
                    story.append(Paragraph(para.strip().replace("\n", "<br/>"), ss["ClaimText"]))
        else:
            story.append(Paragraph("No key judgments have been written for this report.", ss["ClaimMeta"]))
        story.append(Spacer(1, 6))
        return

    if section["section_id"] == "area_overview":
        bits = []
        if section.get("focus"):
            bits.append(section["focus"])
        if section.get("period_start") or section.get("period_end"):
            bits.append(f"Period: {section.get('period_start') or '—'} to {section.get('period_end') or 'present'}")
        if section.get("label"):
            bits.append(f"Snapshot: {section['label']}")
        if bits:
            story.append(Paragraph(" · ".join(bits), ss["ClaimMeta"]))
        regions = section.get("elevated_regions") or []
        if regions:
            story.append(Paragraph("Elevated regions: " + ", ".join(str(r) for r in regions), ss["ClaimMeta"]))
        _render_claims(story, ss, section["claims"], "No zone-scoped claims in this report.")
        story.append(Spacer(1, 6))
        return

    if section["section_id"] == "collection_gaps":
        if section.get("completeness_status") == "skipped":
            story.append(Paragraph(
                "Completeness review was not run for this report (no review model configured).",
                ss["SectionNote"]))
        elif section.get("overall_comment"):
            story.append(Paragraph(section["overall_comment"], ss["ClaimText"]))
        else:
            story.append(Paragraph("No completeness findings recorded for this report.", ss["ClaimMeta"]))
        excluded = section.get("alerts_excluded_low_quality")
        if excluded:
            story.append(Paragraph(f"Alerts excluded for low data quality this period: {excluded}", ss["ClaimMeta"]))
        story.append(Spacer(1, 6))
        return

    if section["section_id"] == "annex":
        counts = section.get("raw_counts") or {}
        if counts:
            rows = [["Category", "Count"]] + [[k.replace("_", " ").title(), str(v)] for k, v in counts.items()]
            t = Table(rows, colWidths=[300, 80])
            t.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), _BG_PRIMARY),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F0F2F5")]),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CCCCCC")),
            ]))
            story.append(t)
            story.append(Spacer(1, 8))
        if section["claims"]:
            story.append(Paragraph("Claims not covered by a fixed section above:", ss["SectionNote"]))
            _render_claims(story, ss, section["claims"], "")
        story.append(Spacer(1, 6))
        return

    # The 5 claims-driven sections (maritime, aerial, imagery, alerts, OSINT,
    # outlook) and poi_changes (always note-only, real backing data doesn't
    # exist — see report_sections.py).
    if section.get("note"):
        story.append(Paragraph(section["note"], ss["SectionNote"]))
    _render_claims(story, ss, section["claims"], f"No claims cite {section['title'].lower()} data in this report.")
    story.append(Spacer(1, 6))


def _page_chrome(canvas, doc, classification: str, title: str):
    """Runs on every page: classification banner + accent underline at top,
    a running header below it on content pages, and a footer with company/
    page/date/classification. Registered as SimpleDocTemplate's onPage
    callback — the pre-Round-3 renderer never had one, so nothing repeated
    across pages beyond ReportLab's own blank default."""
    page_w, page_h = A4
    canvas.saveState()

    # Top classification banner
    banner_h = 7 * mm
    canvas.setFillColor(_SEV_CRIT if "SECRET" in (classification or "").upper() else _BG_PRIMARY)
    canvas.rect(0, page_h - banner_h, page_w, banner_h, fill=1, stroke=0)
    canvas.setFillColor(colors.white)
    canvas.setFont("Helvetica-Bold", 8)
    canvas.drawCentredString(page_w / 2, page_h - banner_h + 2.2 * mm, classification or "UNCLASSIFIED")
    canvas.setStrokeColor(_ACCENT)
    canvas.setLineWidth(1.2)
    canvas.line(0, page_h - banner_h, page_w, page_h - banner_h)

    # Running header — product name left, title centered-ish, org right
    if doc.page > 1:
        header_y = page_h - banner_h - 6 * mm
        canvas.setFont("Helvetica-Bold", 8)
        canvas.setFillColor(colors.HexColor("#333333"))
        canvas.drawString(_MARGIN, header_y, _PRODUCT_NAME)
        canvas.setFont("Helvetica", 8)
        canvas.drawCentredString(page_w / 2, header_y, title or "")
        canvas.drawRightString(page_w - _MARGIN, header_y, _ORG_NAME)
        canvas.setStrokeColor(colors.HexColor("#CCCCCC"))
        canvas.setLineWidth(0.5)
        canvas.line(_MARGIN, header_y - 2 * mm, page_w - _MARGIN, header_y - 2 * mm)

    # Footer — dark bar, accent rule, company/page/date, classification line
    footer_h = 12 * mm
    canvas.setFillColor(_BG_PRIMARY)
    canvas.rect(0, 0, page_w, footer_h, fill=1, stroke=0)
    canvas.setStrokeColor(_ACCENT)
    canvas.setLineWidth(1)
    canvas.line(0, footer_h, page_w, footer_h)
    canvas.setFillColor(colors.white)
    canvas.setFont("Helvetica", 7)
    canvas.drawString(_MARGIN, footer_h - 4.5 * mm, f"{_ORG_NAME} · {_PRODUCT_NAME}")
    canvas.drawCentredString(page_w / 2, footer_h - 4.5 * mm, f"Page {doc.page}")
    canvas.drawRightString(page_w - _MARGIN, footer_h - 4.5 * mm, datetime.utcnow().strftime("%Y-%m-%d"))
    canvas.setFont("Helvetica-Bold", 6.5)
    canvas.drawCentredString(page_w / 2, 2 * mm, classification or "UNCLASSIFIED")

    canvas.restoreState()


def render_report_pdf(report: dict, snapshot_content: dict | None = None, snapshot_meta: dict | None = None) -> bytes:
    """report: the _report_to_dict() shape. snapshot_content/snapshot_meta:
    see report_sections.build_report_sections() — passed through unchanged so
    this renderer and the in-app editor's section API share one real mapping.
    Returns raw PDF bytes."""
    buf = io.BytesIO()
    classification = report.get("classification") or "UNCLASSIFIED"
    title = report.get("title") or "Untitled Report"

    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=_MARGIN + 10 * mm,  # clear of the classification banner
        bottomMargin=_MARGIN + 6 * mm,  # clear of the footer
        leftMargin=_MARGIN, rightMargin=_MARGIN,
    )
    ss = _styles()
    story = []

    story.append(Paragraph(title, ss["ReportTitle"]))
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
    story.append(Spacer(1, 6))

    sections = build_report_sections(report, snapshot_content, snapshot_meta)
    for section in sections:
        _render_section(story, ss, section)

    def _on_page(canvas, doc_):
        _page_chrome(canvas, doc_, classification, title)

    doc.build(story, onFirstPage=_on_page, onLaterPages=_on_page)
    return buf.getvalue()
