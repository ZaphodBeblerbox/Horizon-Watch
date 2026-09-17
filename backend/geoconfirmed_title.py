"""
geoconfirmed_title.py — PARALLAX spec addendum §A3: compose the title at
ingest, from context, never from the date.

WHY
---
GeoConfirmed names a placemark by its publication date, because the archive is
organised chronologically. `17 SEP 2026` is a filing reference. As an alert
title it is useless, and a queue of forty of them is unreadable. In this
database, 74,675 of 74,675 active placemarks carry a name of that shape while
the real prose sits unread in `description`:

    name        "17 SEP 2026"
    description "Ukrainian 'Korfu' residential building hit by Russian
                 reported S8000 Banderol cruise missile."
    plus_code   "9F28XPR8+3C Bergheim, Germany"

Everything needed for a sentence is already on the record. This module writes
that sentence ONCE, at ingest, so that search, the briefing and the
notification all quote the same string — §A3's "server-side note". Composing
it at render time in three places is how three surfaces end up disagreeing
about what an event was called.

THE FALLBACK IS A NOUN, NOT A GUESS  ← deviation from the spec, deliberate
-------------------------------------------------------------------------
§A3 falls back to a rotating vocabulary pool when the description cannot
supply a subject — `pool[salt % pool.length]`, choosing between 'Strike',
'Shelling', 'Explosion' and 'Armed clash' by arithmetic on a sequence number.
That is fabrication: it asserts to an analyst that shelling happened when the
record says only that something in the `conflict` category happened, and
nothing downstream can tell the invented verb from a sourced one.

It is also unnecessary here. 74,564 of 74,675 active placemarks (99.85%) carry
real prose, so the pool would be deciding the wording of 111 records — and for
those 111 the honest sentence is available anyway: the category noun alone.
So the fallback is the flat, checkable "Maritime incident in Bab el-Mandeb"
rather than a coin-flip between four verbs. Everything else in §A3 — compose
from context, demote the date to `dateLabel`, never let a call site pass a
pre-baked title — is implemented as written.

CATEGORY
--------
§A3 assumes each record carries a `cat`. GeoConfirmed does not supply one:
its `faction` field is a belligerent ("Russia", "IDF", "Hamas") and its
`icon_url` a template number whose meaning is not published. So the category
is derived from the description — real text the source wrote — by keyword,
and is `None` when nothing matches rather than defaulted to `conflict`. A
surge is computed per category (§A5), so a category guessed wrong does not
merely mislabel one pin, it invents a trend.
"""
from __future__ import annotations

import re
from typing import Optional

# ── Category vocabulary ───────────────────────────────────────────────────
# A category is a pair: the SUBJECT nouns that put a record in it, and —
# where the noun alone is not enough — the VERBS that must appear with them.
#
# The two-part test exists because the naive one-regex version mislabels the
# two most common shapes in this archive:
#
#   "Artillery shelling from the 57th Motorized Brigade"  → equipment, wrong.
#       The artillery is FIRING, not lost. §A3's equipment subjects are all
#       losses: 'Vehicle destroyed', 'Launcher struck', 'Equipment abandoned'.
#   "A Russian checkpoint is hit with a drone"            → air, wrong.
#       The drone is the WEAPON. §A3's air subjects are all about air assets
#       and airspace as the thing acted on: 'Aircraft downed', 'Drone
#       intercepted', 'Airfield struck'.
#
# In a Ukraine-weighted archive the word "drone" appears in a third of all
# descriptions as the delivery method, so treating it as a subject noun put
# 29.8% of the corpus in `air`. Categories feed per-category surge baselines
# (§A5), where a systematic mislabel does not merely misname a pin — it
# manufactures a trend that nobody reported.
#
# Ordered by what happened to the world, not by what delivered it: a
# residential building struck by a missile is a civil harm event, not an air
# event.

# Verbs that mean the subject was the thing acted on, not the thing acting.
_LOSS = (r"destroy(?:ed|s)?|hit|struck|strikes?|damag(?:ed|e)|abandon(?:ed)?|"
         r"captur(?:ed|e)|knocked\s*out|burn(?:ed|t|ing)|wreck(?:ed|age)|"
         r"disabled|lost|attacked|shelled|bombed|blown\s*up")

# Deliberately excludes "hit" and "struck": in this corpus those almost
# always describe what the drone or missile DID to a ground target, so
# including them made "A Russian checkpoint is hit with a drone" an air
# event. The verbs kept here can only describe something happening TO an
# air asset.
_AIR_EVENT = (r"down(?:ed)?|shot\s*down|intercept(?:ed)?|crash(?:ed)?|"
              r"launch(?:ed|es)?|scrambl(?:ed)?|destroyed|"
              r"tak(?:ing|es|e)\s*off|took\s*off|take-?off|landing|lands|"
              r"starts\s*from|returning|sortie")

# (category, subject-noun pattern, required-verb pattern or None)
_CATEGORY_PATTERNS: list[tuple[str, str, Optional[str]]] = [
    ("maritime",
     r"\b(vessel|ship|tanker|frigate|corvette|warship|boat|ferry|port|harbou?r|"
     r"naval|navy|maritime|minefield|anchorage|quay|dock|shipyard)\b", None),

    ("infrastructure",
     r"\b(substation|power\s*(?:plant|station|line|grid)|pipeline|"
     r"refiner(?:y|ies)|bridge|rail(?:way|\s*line)?|transformer|"
     r"pumping\s*station|water\s*treatment|fuel\s*(?:tank|depot|storage)|"
     r"oil\s*(?:tank|depot|terminal|refinery)|electric(?:al)?\s*(?:substation|station)|"
     r"energy\s*facility|infrastructure)\b", None),

    ("civil",
     r"\b(protest|demonstration|blockade|riot|civil\s*unrest|evacuat(?:ion|ed)|"
     r"displaced|refugee|earthquake|flood(?:ing)?|wildfire|mass\s*grave|"
     r"residential|apartment|hospital|clinic|school|mosque|church|market|"
     r"civilian)\b", None),

    # Equipment ONLY when the equipment was the thing lost.
    ("equipment",
     r"\b(tank|armou?red\s*\w+|apc|ifv|bmp|btr|artiller(?:y|ies)|howitzer|"
     r"mlrs|launcher|radar|vehicle|truck|car|convoy|equipment|"
     r"air\s*defen[cs]e\s*system|sam\s*(?:site|system))\b", _LOSS),

    # An air facility is an air event whatever happened there — there is no
    # reading of "airfield struck" that is not about aviation.
    ("air", r"\b(airfield|airbase|air\s*base|airport|airspace|air\s*defen[cs]e)\b", None),

    # Otherwise air ONLY when the air asset was the thing acted on.
    ("air",
     r"\b(aircraft|helicopter|"
     r"jet|fighter|bomber|uav|drone|missile|loitering\s*munition|plane|"
     r"su-\d+|mig-\d+|tu-\d+|il-\d+|ka-\d+|mi-\d+|f-\d+|a-\d+)\b", _AIR_EVENT),

    # Orbat ONLY when the formation was the thing OBSERVED. §A3's orbat
    # subjects are all sightings: 'Formation observed', 'Convoy identified',
    # 'Unit redeployed', 'Position occupied'. Ungated, this fires on every
    # description that merely credits a unit for an action — and GeoConfirmed
    # credits a unit in most of them, so "Artillery shelling from the 57th
    # Motorized Brigade" came back as an order-of-battle sighting rather than
    # the shelling it describes.
    # A fortification or trench is itself an observation — there is no event
    # to report, the structure being there IS the report — so these need no
    # verb. "Russian fortifications, Pidlisne" is an order-of-battle sighting
    # and nothing else.
    ("orbat", r"\b(fortifications?|trench(?:es|\s*complex)?|military\s*movements?|"
              r"defensive\s*lines?|dragon'?s\s*teeth)\b", None),

    ("orbat",
     r"\b(brigade|battalion|regiment|division|formation|convoy|unit|"
     r"command\s*post|headquarters|fortification|position)\b",
     r"\b(observed|identified|spotted|seen|visible|located|redeploy(?:ed|ing|ment)?|"
     r"occupied|dug\s*in|constructed|massing|assembl(?:ed|ing)|"
     r"reconnaissance|geolocated)\b"),

    # The catch-all action category — an event happened, we can say that much.
    ("conflict",
     r"\b(strikes?|struck|shell(?:s|ing|ed)?|air\s*strikes?|airstrikes?|"
     r"explosion|blast|impact(?:s|ed)?|clash(?:es)?|offensive|assault|"
     r"attack(?:ed|s|ing)?|hit|fighting|combat|ambush|killed|"
     r"casualt(?:y|ies)|wounded|remains|gunfire|gunshots|sniper|"
     r"bomb(?:ed|ing)?|detonat(?:ed|ion))\b", None),
]

_CATEGORY_RE = [
    (cat, re.compile(subj, re.IGNORECASE),
     re.compile(verb, re.IGNORECASE) if verb else None)
    for cat, subj, verb in _CATEGORY_PATTERNS
]

# The noun each category contributes when the record has no prose to quote.
# Deliberately flat: "incident" claims only that something in this category
# was confirmed here, which is exactly what the record supports.
_CATEGORY_NOUN = {
    "maritime":       "Maritime incident",
    "infrastructure": "Infrastructure incident",
    "air":            "Air incident",
    "equipment":      "Equipment loss",
    "civil":          "Civil incident",
    "orbat":          "Formation observed",
    "conflict":       "Confirmed incident",
}

#: Categories a surge may be computed over (§A5 groups by cell AND category).
CATEGORIES = tuple(c for c, _, _ in _CATEGORY_PATTERNS)


def derive_category(description: Optional[str], name: Optional[str] = None) -> Optional[str]:
    """The record's category, from the source's own words, or None.

    None is a real answer and is stored as one: an uncategorised placemark
    still plots, still searches and still counts toward a fusion point — it
    is only excluded from per-category surge baselines, where a wrong label
    would manufacture a trend that nobody reported.
    """
    import notification_context as _nc

    # The citation is not evidence of a category: a description that is only
    # "https://twitter.com/..." must not be categorised by whatever words
    # happen to sit in the URL path.
    text = " ".join(_nc.strip_citation(t) for t in (description, name) if t)
    if not text.strip():
        return None
    for cat, subj_rx, verb_rx in _CATEGORY_RE:
        if not subj_rx.search(text):
            continue
        if verb_rx is not None and not verb_rx.search(text):
            continue   # the noun is present but as the actor, not the subject
        return cat
    return None


def category_noun(category: Optional[str]) -> str:
    """The fallback subject — a noun that names the category, never a verb
    that invents an event. See the module docstring."""
    return _CATEGORY_NOUN.get(category or "", "Confirmed incident")


def compose_title(
    *,
    name: Optional[str] = None,
    description: Optional[str] = None,
    location: Optional[str] = None,
    country: Optional[str] = None,
    theatre_slug: Optional[str] = None,
    category: Optional[str] = None,
) -> str:
    """`{subject} {action} in {place}` — built from the record's own fields.

    The prose path is `notification_context.geoconfirmed_headline`, which
    already strips the video timecodes GeoConfirmed prefixes to descriptions
    ("0:27-0:29 - Artillery shelling…") and refuses to repeat the town twice.
    This wrapper adds only §A3's category fallback, for the handful of records
    with no usable prose at all.
    """
    import notification_context as _nc

    head = _nc.geoconfirmed_headline(
        name=name, description=description, location=location,
        country=country, theatre_slug=theatre_slug,
    )

    # geoconfirmed_headline's own last resort is the literal "Confirmed
    # incident"; where we know the category we can say more than that without
    # claiming more than that.
    generic = head.split(" — ")[0].strip().lower() == "confirmed incident"
    if generic and category:
        noun = category_noun(category)
        place = (head.split(" — ", 1)[1].strip() if " — " in head else "")
        return f"{noun} — {place}" if place else noun
    return head


def date_label(dt) -> Optional[str]:
    """The date, demoted to metadata where it belongs (§A3)."""
    try:
        return dt.date().isoformat()
    except AttributeError:
        return None
