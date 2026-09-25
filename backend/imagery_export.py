"""
imagery_export.py — a satellite scene as a document you can send.

One completed scan rendered as a plain white PDF: the frame itself, the
metadata that says when and under what cloud it was taken, every
detection with its real coordinates, and — where a reference scene
exists — what changed against it.

Everything here is read from the database. Unlike the scenario export
there is no client payload: the image bytes, the detections and the
comparison all already live server-side, so re-sending them from the
browser would only add a way for the two to disagree.

WHAT THIS DOCUMENT WILL NOT DO. It does not upscale the stored frame, it
does not redraw detections it cannot place, and it does not describe a
scan that never completed. A scene with no detections says so; that is a
finding, not an empty page to be padded.
"""
import base64
import io


def _fmt(v, nd=4):
    return f"{v:.{nd}f}" if isinstance(v, (int, float)) else "—"


def _plain(v) -> str:
    return "" if v is None else str(v)


def _image_flowable(b64: str, max_w: float, max_h: float):
    """The stored frame at its real aspect ratio, never stretched.

    Returns None rather than a placeholder if the bytes will not decode —
    a scene that cannot show its image should say so in words, not print
    a grey box that reads like sensor noise.
    """
    from reportlab.platypus import Image as RLImage
    from reportlab.lib.utils import ImageReader
    if not b64:
        return None
    try:
        raw = base64.b64decode(b64, validate=False)
        reader = ImageReader(io.BytesIO(raw))
        iw, ih = reader.getSize()
        if not iw or not ih:
            return None
        scale = min(max_w / iw, max_h / ih)
        return RLImage(io.BytesIO(raw), width=iw * scale, height=ih * scale)
    except Exception:                                        # noqa: BLE001
        return None


def build_pdf(scene: dict) -> bytes:
    """`scene` is exactly what GET /api/imagery/scenes/{scan_id} returns."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                    TableStyle, KeepTogether, PageBreak)
    from xml.sax.saxutils import escape as esc
    import report_pdf as _rp
    import functools

    scan = scene.get("scan") or {}
    zone = scene.get("zone") or {}
    dets = scene.get("detections") or []
    changes = scene.get("changes") or []
    counts = scene.get("counts") or []

    _completed = scan.get("status") == "completed"
    zname = _plain(zone.get("name")) or "Unnamed area"
    title = f"{zname} — {_plain(scan.get('instrument')) or 'OPTICAL'}"

    ss = _rp._styles()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=_rp._MARGIN + 10 * mm, bottomMargin=_rp._MARGIN + 6 * mm,
        leftMargin=_rp._MARGIN, rightMargin=_rp._MARGIN,
    )
    avail_w = doc.width

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

    story = [Paragraph(esc(title), ss["ReportTitle"])]

    bbox = zone.get("bbox") or {}
    story.append(Paragraph(
        f"Scan {esc(_plain(scan.get('scan_id')))} &middot; "
        f"status {esc(_plain(scan.get('status')) or 'unknown')} &middot; "
        f"captured {esc(_plain(scan.get('image_timestamp_utc')) or 'date not recorded')}",
        ss["MetaLine"]))
    story.append(Paragraph(
        f"Cloud cover: {_plain(scan.get('cloud_cover_percent')) or '—'}% &middot; "
        f"Age at scan: {_plain(scan.get('image_age_hours')) or '—'} h &middot; "
        f"Area: {_fmt(bbox.get('min_lat'))}, {_fmt(bbox.get('min_lon'))} to "
        f"{_fmt(bbox.get('max_lat'))}, {_fmt(bbox.get('max_lon'))}",
        ss["MetaLine"]))

    if scan.get("status") != "completed":
        story.append(Spacer(1, 6))
        story.append(Paragraph(
            "This scan did not complete"
            + (f": {esc(_plain(scan.get('error_message')))}." if scan.get("error_message") else ".")
            + " Anything below is what was recorded before it stopped.",
            ss["SectionNote"]))

    # ── The frame ───────────────────────────────────────────────────────
    story.append(Spacer(1, 8))
    img = _image_flowable(scene.get("image_b64"), avail_w, 150 * mm)
    if img is None:
        story.append(Paragraph(
            "No image is stored for this scan, so this document carries the "
            "detections and the metadata only.", ss["SectionNote"]))
    else:
        story.append(img)
        story.append(Paragraph(
            "The frame as stored, at its own resolution. Detection positions "
            "are listed below as real coordinates rather than drawn over the "
            "image, so they stay readable when this is printed.",
            ss["ClaimMeta"]))

    # ── Detections ──────────────────────────────────────────────────────
    story.append(Paragraph("What was detected", ss["SectionHead"]))
    if not dets and not _completed:
        # NOT "the models returned nothing" — they never ran. Reporting a
        # crashed scan as a clean negative is how an empty frame becomes
        # evidence of absence.
        story.append(Paragraph(
            "No detection was recorded, because this scan did not finish. "
            "This is not a statement that the frame is empty.",
            ss["SectionNote"]))
    elif not dets:
        story.append(Paragraph(
            "Nothing was detected in this frame. That is a result, not a gap: "
            "the models ran and returned no object above threshold.",
            ss["SectionNote"]))
    else:
        rows = []
        for d in dets:
            conf = d.get("confidence")
            rows.append([
                Paragraph(esc(_plain(d.get("object_type"))), ss["ClaimMeta"]),
                f"{conf * 100:.0f}%" if isinstance(conf, (int, float)) else "—",
                _fmt(d.get("centroid_lat")),
                _fmt(d.get("centroid_lon")),
                f"{d.get('area_m2'):,.0f}" if isinstance(d.get("area_m2"), (int, float)) else "—",
                _plain(d.get("severity")) or "—",
                _plain(d.get("reviewed_status")) or "pending",
            ])
        story.append(grid(
            ["Object", "Conf.", "Latitude", "Longitude", "Area m²", "Severity", "Review"],
            rows, [34 * mm, 14 * mm, 25 * mm, 25 * mm, 22 * mm, 22 * mm, 22 * mm]))

    # ── Change against the reference ────────────────────────────────────
    ref_id = scene.get("reference_scan_id")
    story.append(Paragraph("Change against the reference scene", ss["SectionHead"]))
    if not ref_id and not _completed:
        story.append(Paragraph(
            "No comparison was made, because this scan did not finish. "
            "Earlier scans of this area may well exist.", ss["SectionNote"]))
    elif not ref_id:
        story.append(Paragraph(
            "This is the first scan of this area, so there is nothing to "
            "compare it against. Counts below become meaningful from the "
            "second scan onward.", ss["SectionNote"]))
    else:
        story.append(Paragraph(
            f"Compared against scan {esc(_plain(ref_id))}"
            + (f", captured {esc(_plain(scene.get('reference_date')))}."
               if scene.get("reference_date") else "."),
            ss["ClaimMeta"]))
        if counts:
            story.append(Spacer(1, 4))
            story.append(grid(
                ["Class", "This scene", "Change"],
                [[Paragraph(esc(_plain(c[0])), ss["ClaimMeta"]), str(c[1]),
                  (f"+{c[2]}" if isinstance(c[2], int) and c[2] > 0 else str(c[2]))]
                 for c in counts if isinstance(c, (list, tuple)) and len(c) >= 3],
                [70 * mm, 30 * mm, 30 * mm]))
        moved = [c for c in changes if c.get("type") in ("new", "removed")]
        if moved:
            story.append(Spacer(1, 6))
            story.append(grid(
                ["Change", "Object", "Latitude", "Longitude", "Note"],
                [[_plain(c.get("type")), Paragraph(esc(_plain(c.get("label"))), ss["ClaimMeta"]),
                  _fmt(c.get("lat")), _fmt(c.get("lon")),
                  Paragraph(esc(_plain(c.get("note")) or "—"), ss["ClaimMeta"])]
                 for c in moved],
                [20 * mm, 34 * mm, 25 * mm, 25 * mm, 60 * mm]))
        elif counts:
            story.append(Spacer(1, 4))
            story.append(Paragraph(
                "No object appeared or disappeared against the reference.",
                ss["SectionNote"]))

    # ── The reference frame itself ──────────────────────────────────────
    ref_img = _image_flowable(scene.get("reference_image_b64"), avail_w, 150 * mm)
    if ref_img is not None:
        story.append(PageBreak())
        story.append(Paragraph("The reference scene", ss["SectionHead"]))
        story.append(Paragraph(
            f"Scan {esc(_plain(ref_id))}"
            + (f", captured {esc(_plain(scene.get('reference_date')))}."
               if scene.get("reference_date") else "."),
            ss["ClaimMeta"]))
        story.append(Spacer(1, 6))
        story.append(ref_img)

    chrome = functools.partial(_rp._page_chrome, classification="UNCLASSIFIED",
                               title=title[:60])
    doc.build(story, onFirstPage=chrome, onLaterPages=chrome)
    return buf.getvalue()
