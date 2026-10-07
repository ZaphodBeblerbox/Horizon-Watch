"""
briefing/validate.py — what a finished document must satisfy before it prints.

  citations   every [S-xx] names a collected event, every [Q-xx] a source in
              the register; a reference to nothing is removed (and counted).
  bands       every probability is one of the named bands, with its numbers;
              a pair that is not a band is moved to the band containing its
              midpoint. Confidence is a separate word (low/medium/high).
  forecasts   a [FORECAST] paragraph names a date and an indicator (I-xx) or
              a criterion — the owner's rule: falsifiable, never a rate.
  meaning     every section ends with what it means for the reader.
  acronyms    every abbreviation in the text is in the glossary; known ones
              (acronyms.py) are added, unknown ones are reported for repair.
  locations   never "Unknown Location".

fix() repairs what code can repair and returns the issues that need words
(a missing meaning box, an undefined acronym, a forecast without a date):
the writer's repair pass gets exactly those.
"""
from __future__ import annotations

import re

from . import acronyms, spec

REF = re.compile(r"\[((?:[SQ])-\d+(?:\s*[,;]\s*(?:[SQ])-\d+)*)\]")
ACRO = re.compile(r"(?<![\w-])([A-ZÄÖÜ][A-ZÄÖÜ0-9]{1,6}(?:-[A-Z]{1,3})?|[A-Z][a-z]?[A-Z]{1,4})(?![\w-])")
DATE = re.compile(r"\b(\d{1,2}\.\s?\d{1,2}\.(\d{2,4})?|\d{4}-\d{2}-\d{2}|\d{1,2}\.? (Jan|Feb|Mär|Mar|Apr|Mai|May|Jun|Jul|Aug|Sep|Okt|Oct|Nov|Dez|Dec|janv|févr|mars|avr|mai|juin|juil|août|sept|oct|nov|déc)\w*\.?(\s\d{4})?|"
                  r"(bis|by|avant|until|bis zum|d'ici)\s(Ende|end|fin)\b|Q[1-4]\s?\d{4}|KW\s?\d{1,2})", re.I)
UNKNOWN = re.compile(r"unknown location|unbekannter ort|lieu inconnu", re.I)


def texts(doc: dict):
    """(path, text) for every piece of prose in the document."""
    def walk(x, path):
        if isinstance(x, str):
            yield path, x
        elif isinstance(x, dict):
            for k, v in x.items():
                if k in ("html", "src", "url", "image", "id", "sid", "type", "tag", "figure", "band", "confidence", "key"):
                    continue
                yield from walk(v, f"{path}.{k}")
        elif isinstance(x, list):
            for i, v in enumerate(x):
                yield from walk(v, f"{path}[{i}]")
    for k, v in doc.items():
        if k in ("figures", "meta", "glossary", "sources", "evidence"):
            continue
        yield from walk(v, k)


def _map_strings(x, fn):
    if isinstance(x, str):
        return fn(x)
    if isinstance(x, dict):
        return {k: (v if k in ("html", "src", "url", "image") else _map_strings(v, fn)) for k, v in x.items()}
    if isinstance(x, list):
        return [_map_strings(v, fn) for v in x]
    return x


def fix_refs(doc: dict, sids: set[str], qids: set[str]) -> int:
    dropped = 0

    def repl(m):
        nonlocal dropped
        keep = []
        for r in re.split(r"\s*[,;]\s*", m.group(1)):
            if (r.startswith("S-") and r in sids) or (r.startswith("Q-") and r in qids):
                keep.append(r)
            else:
                dropped += 1
        return f"[{', '.join(keep)}]" if keep else ""

    for k in list(doc):
        if k in ("figures", "meta", "sources", "evidence"):
            continue
        doc[k] = _map_strings(doc[k], lambda s: REF.sub(repl, s))
    return dropped


def fix_band(k: dict) -> bool:
    """Make low/high a named band; True if it was changed."""
    try:
        lo, hi = int(k.get("low")), int(k.get("high"))
    except (TypeError, ValueError):
        lo, hi = 45, 55
    if spec.band_of(lo, hi) and k.get("band") == spec.band_of(lo, hi):
        return False
    mid = (lo + hi) / 2
    for name, a, b in spec.BANDS:
        if a <= mid <= b:
            k.update({"band": name, "low": a, "high": b})
            return True
    k.update({"band": "even", "low": 45, "high": 55})
    return True


def acronyms_in(doc: dict) -> list[str]:
    seen = []
    for _, t in texts(doc):
        t = re.sub(r"\[[^\]]*\]", " ", t)                    # tags and references
        for m in ACRO.finditer(t):
            a = m.group(1)
            if a in acronyms.NOT_ACRONYMS or re.fullmatch(r"[A-Z]-?\d+", a) or re.fullmatch(r"(KA|KJ|JC|V|E|I|H|A|W|K|L|S|Q|F)-?\d*", a):
                continue
            if a not in seen:
                seen.append(a)
    return seen


def fix(doc: dict, sids: set[str]) -> list[dict]:
    """Repair in place what code can; return the issues that need words."""
    lang = doc["meta"].get("language", "de")
    issues: list[dict] = []
    qids = {s["id"] for s in doc.get("sources") or []}
    n = fix_refs(doc, sids, qids)
    if n:
        issues.append({"kind": "refs_dropped", "count": n, "auto": True})
    for k in doc.get("key_judgments") or []:
        if fix_band(k):
            issues.append({"kind": "band_fixed", "id": k.get("id"), "auto": True})
        if k.get("confidence") not in spec.CONFIDENCE:
            k["confidence"] = "medium"
            issues.append({"kind": "confidence_fixed", "id": k.get("id"), "auto": True})
    for s in doc.get("sections") or []:
        blocks = list(s.get("blocks") or []) + [b for sub in s.get("subsections") or [] for b in sub.get("blocks") or []]
        if not any(b.get("type") == "meaning" for b in blocks):
            issues.append({"kind": "no_meaning", "section": s["id"], "title": s.get("title")})
        for b in blocks:
            if b.get("type") == "p" and b.get("tag") == "FORECAST":
                t = b.get("text") or ""
                if not DATE.search(t) or not (re.search(r"\bI-\d+", t) or re.search(r"(Kriterium|criterion|critère|wenn|if|si)\b", t, re.I)):
                    issues.append({"kind": "forecast_unfalsifiable", "section": s["id"], "text": t[:200]})
            if b.get("type") == "p" and b.get("tag") and b["tag"] not in spec.TAGS:
                b["tag"] = None
    for path, t in texts(doc):
        if UNKNOWN.search(t):
            issues.append({"kind": "unknown_location", "path": path, "text": t[:160]})
    # glossary: what the writer defined, plus every known acronym in the text
    gl = {g["term"]: g for g in doc.get("glossary") or [] if g.get("term")}
    missing = []
    for a in acronyms_in(doc):
        if a in gl:
            continue
        m = acronyms.meaning(a, lang)
        if m:
            gl[a] = {"term": a, "meaning": m}
        else:
            missing.append(a)
    doc["glossary"] = sorted(gl.values(), key=lambda g: g["term"].lower())
    if missing:
        issues.append({"kind": "acronyms_undefined", "terms": missing})
    return issues


def needs_words(issues: list[dict]) -> list[dict]:
    return [i for i in issues if not i.get("auto")]
