"""
briefing/render.py — a briefing document (dict) to HTML and to PDF.

    html = render_html(doc)
    info = render_pdf(doc, "out.pdf")   # {"path", "pages", "qa": [...]}

The PDF is printed by headless Chromium (tools/render_pdf.mjs) from the
HTML, in two passes: the first finds the page each part landed on (an
invisible marker in each heading), the second prints the contents page with
those numbers — the contents page has a fixed number of lines, so filling the
numbers in cannot move anything. Then the running header and footer are
stamped on every page but the cover ("page X of Y" counting the cover, as in
the Trifecta report), and the layout is checked: a page whose last line ends
mid-sentence, or that ends on a heading, is reported.
"""
from __future__ import annotations

import html as _html
import os
import re
import subprocess
import tempfile
from pathlib import Path

import jinja2
from markupsafe import Markup

from . import spec

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
TEMPLATES = HERE / "templates"

# Labels beyond spec.LABELS that only the layout needs.
EXTRA = {
    "de": {"conf_note": "Konfidenz beschreibt die Qualität von Quellenlage und Schlussfolgerung, Wahrscheinlichkeit das Eintreten des Ereignisses. Beide werden getrennt geführt und nie im selben Satz vermischt.",
           "levels_title": "Was die Stufen bedeuten.", "mark_head": "Kennzeichen", "meaning_head": "Bedeutung", "indicators_col": "Indikator",
           "diagnostic": "diagnostisch (trennt Hypothesen)", "precaution": "Günstigste Vorsorge",
           "tiers_note": "Quellenarten: 1 — amtliche Dokumente, Register, Behördenmitteilungen. 2 — internationale Agenturen und Leitmedien. 3 — Regional- und fremdsprachige Presse, Ausrichtung jeweils benannt. 4 — Fachpresse, Fachanalyse, Aggregation und der eigene Signalbestand. 5 — Institute und Anbieter, verwendet für Rahmen und Fragestellung, nicht als Tatsachenbeleg.",
           "procedure": "Vorgehen", "checks": "Prüfschritte vor Auslieferung", "weakest": "Schwächste Stelle dieser Ausgabe", "internal": "Was vor einer Entscheidung intern zu prüfen ist",
           "limits": "Grenzen", "running": "PARALLAX · LAGEBERICHT"},
    "en": {"conf_note": "Confidence describes the quality of the sourcing and the reasoning; probability, the likelihood of the event. The two are kept apart and never mixed in one sentence.",
           "levels_title": "What the levels mean.", "mark_head": "Mark", "meaning_head": "Meaning", "indicators_col": "Indicator",
           "diagnostic": "diagnostic (separates hypotheses)", "precaution": "Cheapest precaution",
           "tiers_note": "Source tiers: 1 — official documents, registers, government statements. 2 — international agencies and leading media. 3 — regional and foreign-language press, alignment named. 4 — specialist press, analysis, aggregation and our own signal inventory. 5 — institutes and vendors, used for framing, not as evidence of fact.",
           "procedure": "Procedure", "checks": "Checks before release", "weakest": "Weakest point of this issue", "internal": "What to check internally before deciding",
           "limits": "Limits", "running": "PARALLAX · INTELLIGENCE REPORT"},
    "fr": {"conf_note": "La confiance décrit la qualité des sources et du raisonnement ; la probabilité, la survenue de l'événement. Les deux sont tenues séparées et jamais mêlées dans une même phrase.",
           "levels_title": "Ce que signifient les niveaux.", "mark_head": "Marque", "meaning_head": "Signification", "indicators_col": "Indicateur",
           "diagnostic": "diagnostique (départage les hypothèses)", "precaution": "Précaution la moins coûteuse",
           "tiers_note": "Niveaux de sources : 1 — documents officiels, registres, communications des autorités. 2 — agences internationales et grands médias. 3 — presse régionale et en langue étrangère, orientation indiquée. 4 — presse spécialisée, analyse, agrégation et notre propre inventaire de signaux. 5 — instituts et prestataires, utilisés pour le cadrage, non comme preuve.",
           "procedure": "Démarche", "checks": "Contrôles avant diffusion", "weakest": "Point le plus faible de ce numéro", "internal": "Ce qu'il faut vérifier en interne avant de décider",
           "limits": "Limites", "running": "PARALLAX · RAPPORT DE SITUATION"},
}


def labels(lang: str) -> dict:
    lang = lang if lang in spec.LANGUAGES else "en"
    L = {**spec.LABELS[lang], **EXTRA[lang]}
    L.update({"lang": lang, "tags": spec.TAG_LABEL[lang], "tag_meaning": spec.TAG_MEANING[lang], "tag_order": list(spec.TAGS),
              "bands": spec.BAND_LABEL[lang], "conf": spec.CONFIDENCE_LABEL[lang], "levels": spec.LEVELS[lang],
              "level_meaning": spec.LEVEL_MEANING[lang]})
    return L


# ── filters ──────────────────────────────────────────────────────────────────
_REF = re.compile(r"\[((?:[SQEF]|IMG)-?\d+(?:\s*[,;]\s*(?:[SQEF]|IMG)-?\d+)*)\]")
_BOLD = re.compile(r"\*\*(.+?)\*\*")


def fmt(text) -> Markup:
    """Escape; **bold**; [S-12] / [Q-03, Q-07] as superscript references."""
    t = _html.escape(str(text or ""), quote=False)
    t = _BOLD.sub(r"<b>\1</b>", t)
    t = _REF.sub(lambda m: '<sup class="ref">' + ", ".join(r.strip() for r in re.split(r"[,;]", m.group(1))) + "</sup>", t)
    return Markup(t)


def shorturl(u) -> str:
    u = re.sub(r"^https?://(www\.)?", "", str(u or ""))
    return u if len(u) <= 70 else u[:67] + "…"


def achclass(s) -> str:
    return {"++": "pp", "+": "p", "o": "o", "-": "m", "−": "m", "--": "mm", "−−": "mm"}.get(str(s).strip(), "o")


_env = jinja2.Environment(loader=jinja2.FileSystemLoader(str(TEMPLATES)), autoescape=True, trim_blocks=True, lstrip_blocks=True)
_env.filters.update(fmt=fmt, shorturl=shorturl, achclass=achclass)


# ── contents ─────────────────────────────────────────────────────────────────
PART_TITLE = {"key_judgments": "key_judgments", "exposure": "exposure", "decisions": "decisions", "how_to_read": "how_to_read",
              "chronology": "chronology", "imagery": "imagery", "analyst_desk": "analyst_desk", "scenarios": "scenarios",
              "indicators": "indicators", "calendar": "calendar", "gaps": "gaps", "exposure_cards": "exposure_cards",
              "sources": "sources", "method": "method", "glossary": "glossary"}


def contents_entries(doc: dict, L: dict) -> list[dict]:
    out = []
    parts = spec.parts_for(doc["meta"]["cadence"])
    for p in parts:
        if p in ("cover", "contents"):
            continue
        if p == "sections":
            for s in doc.get("sections") or []:
                out.append({"id": s["id"], "title": f"{s.get('number', '')} {s['title']}".strip(), "level": 1})
                for sub in s.get("subsections") or []:
                    out.append({"id": sub["id"], "title": f"{sub.get('number', '')} {sub['title']}".strip(), "level": 2})
            continue
        if p == "imagery" and not (doc.get("imagery") or {}).get("items"):
            continue
        if doc.get(p):
            out.append({"id": p, "title": L[PART_TITLE[p]], "level": 1})
    return out


def render_html(doc: dict, pages: dict | None = None) -> str:
    L = labels(doc["meta"].get("language", "en"))
    parts = set(spec.parts_for(doc["meta"]["cadence"]))
    ctx = {k: (doc.get(k) if k in parts else None) for k in
           ("key_judgments", "exposure", "decisions", "how_to_read", "chronology", "imagery", "analyst_desk", "scenarios",
            "indicators", "calendar", "gaps", "exposure_cards", "sources", "method", "glossary")}
    ctx["sections"] = doc.get("sections") if "sections" in parts else []
    contents = None
    if "contents" in parts:
        contents = contents_entries(doc, L)
        for e in contents:
            e["page"] = (pages or {}).get(e["id"])
    fonts_dir = HERE / "fonts"
    font_css = re.sub(r"url\('([^']+)'\)", lambda m: f"url('{(fonts_dir / m.group(1)).as_uri()}')", (fonts_dir / "fonts.css").read_text())
    css = font_css + (TEMPLATES / "briefing.css").read_text()
    return _env.get_template("briefing.html.j2").render(
        meta=doc["meta"], L=L, css=css, figures=doc.get("figures") or {}, contents=contents, **ctx)


# ── PDF ──────────────────────────────────────────────────────────────────────
def _print(html: str, out: Path) -> None:
    with tempfile.TemporaryDirectory() as d:
        src = Path(d) / "briefing.html"
        src.write_text(html, encoding="utf-8")
        r = subprocess.run(["node", str(REPO / "tools" / "render_pdf.mjs"), str(src), str(out)],
                           cwd=str(REPO), capture_output=True, text=True, timeout=600)
        if r.returncode != 0:
            raise RuntimeError(f"PDF printing failed: {r.stderr.strip()[:500]}")


def _marker_pages(pdf: Path) -> dict:
    import fitz
    pages = {}
    with fitz.open(str(pdf)) as d:
        for i, page in enumerate(d):
            for m in re.finditer(r"§§([A-Za-z0-9_.\-]+)§§", page.get_text()):
                pages.setdefault(m.group(1), i + 1)
    return pages


BODY_FONTS = ("sourceserif",)          # the reading face; tables, captions and headings are Inter


def layout_check(pdf: Path, skip_first: bool) -> list[dict]:
    """Pages that end mid-sentence, or on a heading."""
    import fitz
    issues = []
    with fitz.open(str(pdf)) as d:
        for i, page in enumerate(d):
            if skip_first and i == 0:
                continue
            spans = []
            for b in page.get_text("dict")["blocks"]:
                for line in b.get("lines", []):
                    for s in line.get("spans", []):
                        if s["text"].strip() and s["size"] > 2:
                            spans.append((line["bbox"][3], s))
            if not spans or i == len(d) - 1:
                continue
            bottom = max(y for y, _ in spans)
            last_line = [s for y, s in spans if abs(y - bottom) < 1.0]
            text = " ".join(s["text"] for s in last_line).strip()
            font = last_line[-1]["font"].lower()
            size = max(s["size"] for s in last_line)
            bold = any("bold" in s["font"].lower() for s in last_line)
            if size >= 10.8 and bold and not any(f in font for f in BODY_FONTS):
                issues.append({"page": i + 1, "kind": "heading at the foot of the page", "text": text[:90]})
            elif any(f in font for f in BODY_FONTS) and not re.search(r"[.!?:;)»\"”’…]\s*$", text):
                issues.append({"page": i + 1, "kind": "sentence cut by the page break", "text": text[-90:]})
    return issues


def _stamp(pdf: Path, doc: dict, out: Path) -> int:
    import fitz
    meta = doc["meta"]
    L = labels(meta.get("language", "en"))
    daily = meta["cadence"] == "daily"
    with fitz.open(str(pdf)) as d:
        n = len(d)
        for i, page in enumerate(d):
            if i == 0 and not daily:
                continue                                        # the cover stays clean
            w, h = page.rect.width, page.rect.height
            x0, x1 = 56.7, w - 56.7                               # 20 mm margins
            grey = (0.42, 0.45, 0.5)
            if i > 0:
                page.insert_text((x0, 40), L["running"], fontname="hebo", fontsize=6.6, color=(0.1, 0.12, 0.14))
                right = meta.get("month_label") or meta.get("period_label") or ""
                page.insert_text((x1 - fitz.get_text_length(right, "helv", 6.6), 40), right, fontname="helv", fontsize=6.6, color=grey)
                page.draw_line((x0, 46), (x1, 46), color=(0.79, 0.77, 0.74), width=0.5)
            page.draw_rect(fitz.Rect(0, h - 30, w, h), color=None, fill=(0.106, 0.122, 0.141))
            foot_l = (meta.get("org") or "").upper()
            foot_c = f"{L['page']} {i + 1} {L['of']} {n}"
            foot_r = meta.get("serial") or ""
            page.insert_text((x0, h - 12), foot_l, fontname="hebo", fontsize=6.6, color=(1, 1, 1))
            page.insert_text(((w - fitz.get_text_length(foot_c, "helv", 6.6)) / 2, h - 12), foot_c, fontname="helv", fontsize=6.6, color=(1, 1, 1))
            page.insert_text((x1 - fitz.get_text_length(foot_r, "helv", 6.6), h - 12), foot_r, fontname="helv", fontsize=6.6, color=(1, 1, 1))
        d.set_metadata({"title": meta.get("title") or "", "author": "Parallax", "subject": meta.get("serial") or "",
                        "creator": "Parallax briefing engine"})
        d.save(str(out), garbage=3, deflate=True)
    return n


def render_pdf(doc: dict, out_path: str | os.PathLike) -> dict:
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as d:
        p1 = Path(d) / "pass1.pdf"
        _print(render_html(doc), p1)
        pages = _marker_pages(p1)
        p2 = Path(d) / "pass2.pdf"
        _print(render_html(doc, pages), p2)
        qa = layout_check(p2, skip_first=doc["meta"]["cadence"] != "daily")
        n = _stamp(p2, doc, out)
    return {"path": str(out), "pages": n, "qa": qa, "part_pages": pages}
