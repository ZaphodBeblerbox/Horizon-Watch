import re

import pymupdf as fitz
import pytest

from briefing import render, sample, spec


def test_labels_cover_three_languages():
    for lang in spec.LANGUAGES:
        L = render.labels(lang)
        assert L["key_judgments"] and L["tags"]["FACT"] and L["bands"]["likely"]


def test_fmt_escapes_and_marks_references():
    out = str(render.fmt("a <b> **bold** [Q-03, Q-07] and [S-12]"))
    assert "&lt;b&gt;" in out and "<b>bold</b>" in out
    assert '<sup class="ref">Q-03, Q-07</sup>' in out and '<sup class="ref">S-12</sup>' in out


@pytest.mark.parametrize("cadence", ["daily", "weekly", "monthly"])
def test_pdf_has_contents_numbers_stamps_and_clean_breaks(tmp_path, cadence):
    r = render.render_pdf(sample.sample_doc(cadence), tmp_path / "b.pdf")
    assert r["pages"] >= 2 and r["qa"] == []
    with fitz.open(r["path"]) as d:
        last = d[-1].get_text()
        assert f"{r['pages']}" in last                      # "page N of N" stamped
        fonts = {f[3].split("+")[-1] for p in d for f in p.get_fonts()}
        assert any(f.startswith("SourceSerif4") for f in fonts) and any(f.startswith("Inter") for f in fonts)
        if cadence != "daily":
            i = next(k for k, p in enumerate(d) if p.get_text().lstrip().splitlines()[2:3] == ["Inhalt"] or "\nInhalt\n" in p.get_text())
            toc = d[i].get_text() + d[i + 1].get_text()
            assert re.search(r"Glossar und Abkürzungen\s*\n?\s*\d+", toc)    # contents carries page numbers
