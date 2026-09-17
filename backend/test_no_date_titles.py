"""§A3/§A13 #1 — "No alert anywhere in the product is titled with a date."

This is a STATIC guard over the read paths, because the defect it catches is
not a bad value in the database: the placemarks carry real composed titles.
It is a call site reaching past `title` to `name`, which is the publication
date, and doing so silently — the surface simply shows a date and nothing
errors.

That exact bug survived the original §A3 pass in two places (/api/surface's
headline and the news_points snapshot) and shipped date titles to every
surface fed by them long after the records themselves were fixed.
"""
import re
from pathlib import Path

BACKEND = Path(__file__).parent
FILES = ["main.py", "geoconfirmed.py", "routers/geoconfirmed.py"]

# Scoped to `p.name`, which is the idiom these placemark loops use ("for p in
# rows"). Deliberately narrow: `r.name or r.rule_name` is a detector rule's
# real name and has nothing to do with this, and a guard that cries wolf on
# unrelated code is a guard someone deletes.
DATE_FIRST = re.compile(r"\bp\.name\s+or\s+", re.MULTILINE)


def _strip_comments(src: str) -> str:
    return "\n".join(l for l in src.splitlines() if not l.strip().startswith("#"))


def test_no_read_path_prefers_the_placemark_name_over_its_title():
    offenders = []
    for rel in FILES:
        src = _strip_comments((BACKEND / rel).read_text(encoding="utf-8"))
        for m in DATE_FIRST.finditer(src):
            line_no = src[: m.start()].count("\n") + 1
            line = src.splitlines()[line_no - 1]
            # faction/theatre/orbat names are real names, not dates.
            if any(w in line.lower() for w in ("faction", "theatre", "node.name", "zone", "flag_path", "rule")):
                continue
            offenders.append(f"{rel}:{line_no}: {line.strip()}")
    assert not offenders, (
        "a read path prefers the GeoConfirmed placemark `name` (its publication "
        "date) over the composed `title`:\n  " + "\n  ".join(offenders)
    )


def test_the_composed_title_is_what_the_surfaces_read():
    main = (BACKEND / "main.py").read_text(encoding="utf-8")
    assert "headline = p.title or" in main
    assert '"title": (p.title or' in main
