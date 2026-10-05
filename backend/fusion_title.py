"""
fusion_title.py — a fusion's headline from what its signals actually say.

When the model write-up is unavailable the engine fell back to
"{location} Intelligence Event", and since locations are often only a grid
key the console's "Newest critical" read "53.75°N 3.75°E Intelligence
Event" — a coordinate and a category, nothing anyone can act on. The member
signals already say what happened and where: "Sanctioned vessel MIDEA in
the North Sea", "Satellite navigation degraded over the Black Sea". The
headline is built from those: the things involved, then the place they name.

Pure, so it runs on new fusions and, on read, on stored ones.
"""
from __future__ import annotations

import re

_PLACE = re.compile(r"\b(?:over|in|near|off|at) (?:the )?([A-Z][\w'.-]*(?:[ /][A-Z][\w'.-]*|\s(?:of|el|al)\s[A-Z][\w'.-]*)*)")
_COORD = re.compile(r"^-?\d+(?:\.\d+)?°?\s*[NS]?,?\s*-?\d+(?:\.\d+)?°?\s*[EW]?$")
_SANCTIONED = re.compile(r"[Ss]anctioned vessel ([A-Z0-9][A-Z0-9 .'-]{1,30}?)(?= in | off | near | at | —|,|$)")
_MILITARY = re.compile(r"[Mm]ilitary aircraft ([A-Z0-9]{3,10})")


def _split(sig) -> tuple[str, str]:
    if isinstance(sig, dict):
        return str(sig.get("rule_name") or ""), str(sig.get("summary") or sig.get("title") or "")
    s = str(sig or "")
    head, _, rest = s.partition(": ")
    return (head, rest) if rest else ("", s)


def place_from(signals, fallback: str = "") -> str | None:
    """The place the signals name, else the fallback unless it is a coordinate."""
    for sig in signals:
        m = _PLACE.search(_split(sig)[1])
        if m:
            return m.group(1).strip(" .-")
    fb = (fallback or "").strip()
    return fb if fb and not _COORD.match(fb) and fb.lower() != "unknown location" else None


def headline(signals, fallback_place: str = "") -> str | None:
    """'Sanctioned vessel MIDEA amid GPS jamming — North Sea', or None."""
    sanctioned, military, gps, other = [], [], 0, []
    for sig in signals:
        rule, text = _split(sig)
        low = (rule + " " + text).lower()
        m = _SANCTIONED.search(text)
        if m:
            name = m.group(1).strip()
            if name not in sanctioned:
                sanctioned.append(name)
            continue
        m = _MILITARY.search(text)
        if m:
            if m.group(1) not in military:
                military.append(m.group(1))
            continue
        if "gps" in low or "satellite navigation" in low or "jamming" in low:
            gps += 1
            continue
        lead = re.split(r" — | in | over | near ", text, 1)[0].strip()
        if lead and lead not in other:
            other.append(lead)

    parts = []
    if sanctioned:
        parts.append(f"Sanctioned vessel {sanctioned[0]}" if len(sanctioned) == 1
                     else f"{len(sanctioned)} sanctioned vessels")
    if military:
        parts.append(f"military aircraft {military[0]}" if len(military) == 1
                     else f"{len(military)} military aircraft")
    parts.extend(other[:1])
    if gps:
        parts.append("GPS jamming")
    if not parts:
        return None
    lead = parts[0][0].upper() + parts[0][1:]
    rest = parts[1:3]
    title = lead + (f" amid {' and '.join(rest)}" if rest else "")
    place = place_from(signals, fallback_place)
    return f"{title} — {place}" if place else title


def is_template(title: str | None) -> bool:
    return bool(title) and str(title).strip().endswith("Intelligence Event")
