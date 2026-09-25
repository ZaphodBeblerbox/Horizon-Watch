"""
scenario_export.py — a saved forecast scenario as a plain document.

A white, paginated PDF of one scenario: what was asked for, what the
measured prior says about it, which courses of action this theatre
allows, and the laydown that was drawn. Reuses report_pdf.py's page
chrome and styles, the same way signals_export.py does, so every export
in the product looks like it came from the same shop.

WHY THE LAYDOWN ARRIVES FROM THE CLIENT. The scenario table stores the
*inputs* only (target, aggressor, COA, analogues) — the laydown is
computed in the browser by forecastScenario.js from the real coastline,
the real border contact and the real airfield list. Recomputing it here
in Python would be a second implementation of the same model, and the
first time the two drifted the PDF would quietly disagree with the
screen that produced it. So the caller posts what it drew, and this
renders it. Nothing here invents a number: every field is either a real
column from forecast_scenarios or a value the analyst was already
looking at.

The document never states the laydown as a forecast of fact. It is a
generated course of action, and it says so on every page, for the same
reason the on-screen stamp does.
"""
import io
import datetime


DISCLAIMER = (
    "A GENERATED COURSE OF ACTION, NOT AN OBSERVED MOVEMENT. The formations "
    "below were drawn from the real border, the real coastline and the real "
    "airfield list for this pairing. No unit on this page has been seen."
)


def _pct(p) -> str:
    """A probability as a reader can hold it, without false precision."""
    if not isinstance(p, (int, float)):
        return "—"
    if p <= 0:
        return "0%"
    if p < 0.001:
        return f"{p * 100:.3f}%"
    if p < 0.01:
        return f"{p * 100:.2f}%"
    return f"{p * 100:.1f}%"


def _plain(v) -> str:
    return "" if v is None else str(v)


def build_pdf(payload: dict) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                    TableStyle, KeepTogether)
    from xml.sax.saxutils import escape as esc
    import report_pdf as _rp
    import functools

    sc = payload.get("scenario") or {}
    asm = payload.get("assessment") or {}
    prior = payload.get("prior") or {}
    lay = payload.get("laydown") or {}

    name = _plain(sc.get("name")) or "Untitled scenario"
    ss = _rp._styles()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=_rp._MARGIN + 10 * mm, bottomMargin=_rp._MARGIN + 6 * mm,
        leftMargin=_rp._MARGIN, rightMargin=_rp._MARGIN,
    )

    def grid(header, rows, widths):
        t = Table([header] + rows, colWidths=widths, repeatRows=1)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), _rp._BG_PRIMARY),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CCCCCC")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F5F5F5")]),
        ]))
        return t

    story = []
    story.append(Paragraph(esc(name), ss["ReportTitle"]))

    target = _plain(sc.get("target"))
    place = _plain(sc.get("target_place"))
    where = f"{place}, {target}" if place and target else (place or target or "—")
    meta = (
        f"Aggressor: {esc(_plain(sc.get('aggressor')) or '—')} &middot; "
        f"Objective: {esc(where)} &middot; "
        f"Course of action: {esc(_plain(sc.get('coa')) or 'none chosen')}"
    )
    story.append(Paragraph(meta, ss["MetaLine"]))
    story.append(Paragraph(
        f"Saved {esc(_plain(sc.get('created_at')) or 'date unknown')}"
        + (f" by {esc(_plain(sc.get('author')))}" if sc.get("author") else "")
        + f" &middot; id {esc(_plain(sc.get('id')) or '—')}",
        ss["MetaLine"]))
    story.append(Spacer(1, 6))
    story.append(Paragraph(DISCLAIMER, ss["SectionNote"]))

    # ── The prior ───────────────────────────────────────────────────────
    story.append(Paragraph("Measured prior", ss["SectionHead"]))
    if not prior:
        story.append(Paragraph(
            "No prior was available for this pairing when the scenario was "
            "exported."
            + (" The laydown below still describes a course of action; it "
               "carries no probability." if lay.get("units") else ""),
            ss["SectionNote"]))
    else:
        months = prior.get("months")
        story.append(Paragraph(
            f"<b>{_pct(prior.get('p'))}</b> over "
            f"{esc(_plain(months) or '?')} months "
            f"({_pct(prior.get('annual'))} annualised), for "
            f"{esc(_plain(prior.get('a')) or '?')} against "
            f"{esc(_plain(prior.get('b')) or '?')}.",
            ss["ClaimText"]))
        why = prior.get("why") or []
        if why:
            story.append(Paragraph("How that number was reached:", ss["ClaimMeta"]))
            for line in why:
                story.append(Paragraph(f"— {esc(_plain(line))}", ss["ClaimMeta"]))
        if prior.get("ever_fought"):
            story.append(Paragraph(
                f"These two have fought before; most recently "
                f"{esc(_plain(prior.get('last_year')))}.", ss["ClaimMeta"]))
        else:
            story.append(Paragraph(
                "No interstate conflict between these two is on record, which "
                "is most of why the number is small.", ss["ClaimMeta"]))

    # ── Courses of action ───────────────────────────────────────────────
    story.append(Paragraph("Courses of action this theatre allows", ss["SectionHead"]))
    avail = asm.get("available") or []
    excl = asm.get("excluded") or []
    caps = asm.get("capabilities")
    if caps is None and avail:
        story.append(Paragraph(
            "The aggressor's equipment could not be read, so capability was "
            "treated as unknown rather than absent — a course of action is "
            "listed as uncertain below, never silently dropped.",
            ss["SectionNote"]))
    if avail:
        rows = []
        for c in avail:
            unc = c.get("uncertain") or []
            note = ("Uncertain: " + "; ".join(_plain(u) for u in unc)) if unc else "—"
            rows.append([
                _plain(c.get("kind")),
                Paragraph(esc(_plain(c.get("label"))), ss["ClaimText"]),
                Paragraph(esc(_plain(c.get("doctrine"))), ss["ClaimMeta"]),
                Paragraph(esc(note), ss["ClaimMeta"]),
            ])
        story.append(grid(["Kind", "Course of action", "Doctrine", "Caveat"],
                          rows, [20 * mm, 32 * mm, 79 * mm, 40 * mm]))
    else:
        story.append(Paragraph("No course of action is open to this pairing.",
                               ss["SectionNote"]))
    if excl:
        story.append(Spacer(1, 6))
        story.append(Paragraph("Ruled out, and why:", ss["ClaimMeta"]))
        for c in excl:
            story.append(Paragraph(
                f"— {esc(_plain(c.get('kind')))}: {esc(_plain(c.get('reason')))}",
                ss["ClaimMeta"]))

    # ── The laydown ─────────────────────────────────────────────────────
    story.append(Paragraph("The laydown", ss["SectionHead"]))
    if not lay or not lay.get("units"):
        story.append(Paragraph(
            "No laydown was drawn. A course of action has to be chosen before "
            "formations can be placed.", ss["SectionNote"]))
    else:
        if lay.get("doctrine"):
            story.append(Paragraph(esc(_plain(lay["doctrine"])), ss["ClaimText"]))
        phases = lay.get("phases") or []
        if phases:
            story.append(Spacer(1, 4))
            story.append(Paragraph(
                "Sequence: " + " &rarr; ".join(esc(_plain(p.get("label"))) for p in phases),
                ss["ClaimMeta"]))
        story.append(Spacer(1, 6))

        rows = []
        for u in lay["units"]:
            side = "attacking" if u.get("aff") == "hostile" else "defending"
            rows.append([
                _plain(u.get("id")),
                side,
                _plain(u.get("domain")),
                _plain(u.get("icon")),
                _plain(u.get("size")),
                Paragraph(esc(_plain(u.get("what"))), ss["ClaimMeta"]),
            ])
        story.append(grid(["#", "Side", "Domain", "Type", "Echelon", "What it is doing"],
                          rows, [10 * mm, 20 * mm, 18 * mm, 20 * mm, 18 * mm, 85 * mm]))

        objs = lay.get("objectives") or []
        if objs:
            story.append(Spacer(1, 10))
            story.append(KeepTogether([
                Paragraph("Objectives, in the order they rank", ss["SectionHead"]),
                grid(["Rank", "Place", "Latitude", "Longitude"],
                     [[str(i), Paragraph(esc(_plain(o.get("name"))), ss["ClaimMeta"]),
                       f"{o.get('lat'):.4f}" if isinstance(o.get("lat"), (int, float)) else "—",
                       f"{o.get('lon'):.4f}" if isinstance(o.get("lon"), (int, float)) else "—"]
                      for i, o in enumerate(objs, start=1)],
                     [15 * mm, 76 * mm, 40 * mm, 40 * mm]),
            ]))

        origins = lay.get("origins") or []
        if origins:
            story.append(Spacer(1, 10))
            story.append(KeepTogether([
                Paragraph("Origins within reach of the contact", ss["SectionHead"]),
                grid(["Rank", "Airfield", "Latitude", "Longitude"],
                     [[str(i), Paragraph(esc(_plain(o.get("name"))), ss["ClaimMeta"]),
                       f"{o.get('lat'):.4f}" if isinstance(o.get("lat"), (int, float)) else "—",
                       f"{o.get('lon'):.4f}" if isinstance(o.get("lon"), (int, float)) else "—"]
                      for i, o in enumerate(origins, start=1)],
                     [15 * mm, 76 * mm, 40 * mm, 40 * mm]),
            ]))

    if sc.get("analogues"):
        story.append(Paragraph("Reasoned from", ss["SectionHead"]))
        an = sc["analogues"]
        an = an if isinstance(an, list) else [an]
        story.append(Paragraph(", ".join(esc(_plain(a)) for a in an), ss["ClaimText"]))

    if sc.get("note"):
        story.append(Paragraph("Analyst's note", ss["SectionHead"]))
        story.append(Paragraph(esc(_plain(sc["note"])), ss["ClaimText"]))

    chrome = functools.partial(_rp._page_chrome, classification="UNCLASSIFIED",
                               title=name[:60])
    doc.build(story, onFirstPage=chrome, onLaterPages=chrome)
    return buf.getvalue()
