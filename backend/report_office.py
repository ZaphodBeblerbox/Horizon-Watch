"""report_office.py — a briefing as a .docx, a deck as a .pptx.

WHY THESE TWO FORMATS AND NOT JUST THE PDF WE ALREADY HAD. A PDF is the
end of a document's life: the person who receives it can read it and
nothing else. A briefing is usually the start of someone else's work —
they add a paragraph, cut a slide, put it in their own pack. Exporting
only PDF means every one of those edits happens by retyping.

THE IDENTITY TRAVELS WITH THE FILE. Every page and every slide carries the
PARALLAX wordmark and the "Trifecta Technologies" line, in the same places
print/PageFrame.jsx puts them on screen — a file that leaves the system
and loses its provenance is a file nobody can place a week later.

Both libraries are pure Python with no system dependencies.
"""
from __future__ import annotations

import io
import re
from datetime import datetime, timezone

# The on-screen page's own marks (src/print/PageFrame.jsx), so an exported
# file and a printed one say the same thing in the same words.
WORDMARK = "PARALLAX"
ORG = "TRIFECTA TECHNOLOGIES"

# Matching print/PageFrame.jsx's palette.
_INK = (0x1A, 0x1D, 0x2C)
_MUTED = (0x6A, 0x6F, 0x77)
_RULE = (0xD8, 0xD3, 0xCA)


def _plain(html_or_text: str) -> str:
    """Body fields are sometimes HTML and sometimes plain text. Tags in a
    Word document read as literal angle brackets, so they come out."""
    if not html_or_text:
        return ""
    t = re.sub(r"<br\s*/?>", "\n", str(html_or_text), flags=re.I)
    t = re.sub(r"</(p|div|li|h[1-6])>", "\n", t, flags=re.I)
    t = re.sub(r"<[^>]+>", "", t)
    t = (t.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
          .replace("&quot;", '"').replace("&#39;", "'").replace("&nbsp;", " "))
    return re.sub(r"\n{3,}", "\n\n", t).strip()


def _paras(text: str) -> list[str]:
    return [p.strip() for p in _plain(text).split("\n") if p.strip()]


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%d %b %Y %H:%MZ")


# ── Inline links survive the export ─────────────────────────────────────
#
# The writer inserts a saved signal as an inline <a> in the sentence. If
# the export flattened tags the way _plain() does, every one of those
# would arrive in Word as plain text and the evidence behind the claim
# would be unreachable — which is the one thing the link was for.
#
# python-docx has no hyperlink API, so the relationship and the w:hyperlink
# element are written directly. This is the documented way to do it; there
# is no higher-level call being avoided here.
import html as _html
from html.parser import HTMLParser

_BLOCK_TAGS = {"p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6",
               "blockquote", "br", "hr", "tr"}


class _Inline(HTMLParser):
    """HTML → [[(text, href|None), ...], ...] — one list of runs per block."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks: list[list[tuple[str, str | None]]] = []
        self._cur: list[tuple[str, str | None]] = []
        self._href: str | None = None

    def _flush(self):
        if any(t.strip() for t, _ in self._cur):
            self.blocks.append(self._cur)
        self._cur = []

    def handle_starttag(self, tag, attrs):
        if tag in _BLOCK_TAGS:
            self._flush()
        elif tag == "a":
            self._href = dict(attrs).get("href")

    def handle_endtag(self, tag):
        if tag in _BLOCK_TAGS:
            self._flush()
        elif tag == "a":
            self._href = None

    def handle_data(self, data):
        if data:
            self._cur.append((data, self._href))

    def close(self):
        super().close()
        self._flush()


def _rich_blocks(html_or_text: str) -> list[list[tuple[str, str | None]]]:
    if not html_or_text:
        return []
    raw = str(html_or_text)
    if "<" not in raw:
        return [[(line, None)] for line in raw.split("\n") if line.strip()]
    p = _Inline()
    p.feed(raw)
    p.close()
    return p.blocks


def _add_hyperlink(paragraph, text, url, color="2F5C90"):
    """A real w:hyperlink run, clickable in Word."""
    from docx.oxml.shared import OxmlElement, qn

    part = paragraph.part
    r_id = part.relate_to(
        url,
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
        is_external=True,
    )
    link = OxmlElement("w:hyperlink")
    link.set(qn("r:id"), r_id)

    run = OxmlElement("w:r")
    rPr = OxmlElement("w:rPr")
    c = OxmlElement("w:color"); c.set(qn("w:val"), color); rPr.append(c)
    u = OxmlElement("w:u"); u.set(qn("w:val"), "single"); rPr.append(u)
    run.append(rPr)
    t = OxmlElement("w:t")
    t.text = text
    t.set(qn("xml:space"), "preserve")
    run.append(t)
    link.append(run)
    paragraph._p.append(link)
    return link


def _write_rich(doc, html_or_text, Pt, RGBColor):
    """Add one Word paragraph per block, keeping links as links."""
    wrote = False
    for runs in _rich_blocks(html_or_text):
        para = doc.add_paragraph()
        para.paragraph_format.space_after = Pt(6)
        for text, href in runs:
            if not text:
                continue
            if href and not href.startswith("#"):
                # An in-app reference (#sig:...) is dead outside the app, so
                # it is written as plain text rather than a broken link.
                _add_hyperlink(para, text, href)
            else:
                r = para.add_run(text)
                r.font.color.rgb = RGBColor(*_INK)
        wrote = True
    return wrote


# ── Word ────────────────────────────────────────────────────────────────

def render_report_docx(report: dict, snapshot_content=None, snapshot_meta=None) -> bytes:
    from docx import Document
    from docx.shared import Pt, RGBColor, Inches
    from docx.enum.text import WD_ALIGN_PARAGRAPH

    doc = Document()

    # One place where the page geometry is set, so every section matches
    # the printed sheet rather than Word's default US Letter margins.
    for s in doc.sections:
        s.top_margin = Inches(0.9)
        s.bottom_margin = Inches(0.9)
        s.left_margin = Inches(1.0)
        s.right_margin = Inches(1.0)
        # The marks go in the real header and footer, not as body text:
        # that is what makes them repeat on every page, which is the whole
        # point of putting them there.
        h = s.header.paragraphs[0]
        h.text = WORDMARK
        h.alignment = WD_ALIGN_PARAGRAPH.LEFT
        hr = h.runs[0]
        hr.font.size = Pt(9)
        hr.font.bold = True
        hr.font.color.rgb = RGBColor(*_INK)

        f = s.footer.paragraphs[0]
        f.text = f"{ORG}    ·    {report.get('classification') or 'UNCLASSIFIED'}"
        f.alignment = WD_ALIGN_PARAGRAPH.LEFT
        fr = f.runs[0]
        fr.font.size = Pt(7.5)
        fr.font.color.rgb = RGBColor(*_MUTED)

    base = doc.styles["Normal"]
    base.font.name = "Calibri"
    base.font.size = Pt(10.5)

    t = doc.add_paragraph()
    tr = t.add_run(report.get("title") or "Untitled briefing")
    tr.font.size = Pt(22)
    tr.font.bold = True
    tr.font.color.rgb = RGBColor(*_INK)

    meta_bits = [report.get("report_id"), report.get("scope"),
                 report.get("audience"), report.get("horizon"),
                 f"exported {_stamp()}"]
    m = doc.add_paragraph()
    mr = m.add_run("   ·   ".join(str(b) for b in meta_bits if b))
    mr.font.size = Pt(8)
    mr.font.color.rgb = RGBColor(*_MUTED)

    def heading(text):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(16)
        p.paragraph_format.space_after = Pt(4)
        r = p.add_run(text.upper())
        r.font.size = Pt(9)
        r.font.bold = True
        r.font.color.rgb = RGBColor(*_MUTED)
        return p

    for label, key in (("Key judgements", "key_judgments"),
                       ("Assessment", "narrative"),
                       ("Exposure", "exposure")):
        value = report.get(key)
        if not _plain(value):
            continue
        heading(label)
        _write_rich(doc, value, Pt, RGBColor)

    claims = report.get("claims")
    if isinstance(claims, list) and claims:
        heading("Evidence")
        for c in claims:
            if isinstance(c, dict):
                text = c.get("text") or c.get("claim") or c.get("label") or ""
                src = c.get("source") or c.get("ref") or ""
            else:
                text, src = str(c), ""
            if not text:
                continue
            p = doc.add_paragraph(_plain(text), style="List Bullet")
            if src:
                r = p.add_run(f"  [{src}]")
                r.font.size = Pt(8)
                r.font.color.rgb = RGBColor(*_MUTED)

    findings = report.get("council_findings")
    if isinstance(findings, list) and findings:
        heading("Review")
        for f_ in findings:
            txt = f_.get("text") if isinstance(f_, dict) else str(f_)
            if txt:
                doc.add_paragraph(_plain(txt), style="List Bullet")

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# ── PowerPoint ──────────────────────────────────────────────────────────

def render_report_pptx(report: dict, slides: list | None = None) -> bytes:
    from pptx import Presentation
    from pptx.util import Pt, Inches, Emu
    from pptx.dml.color import RGBColor

    prs = Presentation()
    # 16:9. The default is 4:3, which nobody presents on any more.
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank = prs.slide_layouts[6]

    W, H = prs.slide_width, prs.slide_height
    MARGIN = Inches(0.7)

    def textbox(slide, left, top, width, height, text, size, bold=False,
                color=_INK, align=None, wrap=True):
        box = slide.shapes.add_textbox(left, top, width, height)
        tf = box.text_frame
        tf.word_wrap = wrap
        lines = text if isinstance(text, list) else [text]
        for i, line in enumerate(lines):
            p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            p.text = str(line)
            if align is not None:
                p.alignment = align
            for r in p.runs:
                r.font.size = Pt(size)
                r.font.bold = bold
                r.font.color.rgb = RGBColor(*color)
                r.font.name = "Calibri"
        return box

    def chrome(slide, number):
        """The wordmark and the org line, on every slide — the same pair
        the on-screen deck footer carries."""
        textbox(slide, MARGIN, H - Inches(0.55), Inches(4), Inches(0.3),
                WORDMARK, 9, bold=True, color=_MUTED)
        textbox(slide, W - Inches(4.7), H - Inches(0.55), Inches(4), Inches(0.3),
                f"{ORG}    ·    {number}", 8, color=_MUTED)

    # Title slide
    s0 = prs.slides.add_slide(blank)
    textbox(s0, MARGIN, Inches(2.2), W - MARGIN * 2, Inches(1.6),
            report.get("title") or "Untitled briefing", 40, bold=True)
    textbox(s0, MARGIN, Inches(3.9), W - MARGIN * 2, Inches(0.8),
            "   ·   ".join(str(b) for b in [report.get("scope"), report.get("audience"),
                                            report.get("horizon"), _stamp()] if b),
            12, color=_MUTED)
    textbox(s0, MARGIN, Inches(4.6), W - MARGIN * 2, Inches(0.5),
            report.get("classification") or "UNCLASSIFIED", 9, color=_MUTED)
    chrome(s0, 1)

    # Content slides: one per supplied slide, or one per section.
    body_slides = slides if isinstance(slides, list) and slides else [
        {"title": label, "body": _paras(report.get(key))}
        for label, key in (("Key judgements", "key_judgments"),
                           ("Assessment", "narrative"),
                           ("Exposure", "exposure"))
        if _paras(report.get(key))
    ]

    for i, sl in enumerate(body_slides, start=2):
        s = prs.slides.add_slide(blank)
        title = sl.get("title") or sl.get("heading") or ""
        body = sl.get("body") or sl.get("text") or ""
        if isinstance(body, str):
            body = _paras(body)
        textbox(s, MARGIN, Inches(0.7), W - MARGIN * 2, Inches(1.0), title, 26, bold=True)
        # A rule under the title, matching the printed sheet.
        line = s.shapes.add_shape(1, MARGIN, Inches(1.62), W - MARGIN * 2, Emu(9525))
        line.fill.solid()
        line.fill.fore_color.rgb = RGBColor(*_RULE)
        line.line.fill.background()
        if body:
            textbox(s, MARGIN, Inches(1.95), W - MARGIN * 2, H - Inches(3.0),
                    body[:12], 15)
        if sl.get("notes"):
            s.notes_slide.notes_text_frame.text = str(sl["notes"])
        chrome(s, i)

    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()
