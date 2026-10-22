"""
textclean.py — words that go on a signal's card (owner, 2026-10-22).

  * no emoji anywhere in a signal's text (headline, place, quote, notification):
    every Unicode emoji and pictograph, the variation selectors and the
    zero-width joiner that glue them, and the regional-indicator pairs that
    draw a flag. The clients strip again as a guard (src/lib/liveSignals.js,
    which must stay the same as EMOJI_RE here).
  * a place that is only a word for a place ("place", "rue", "boulevard", "the
    square") is not a place: nothing can be pinned to it.
"""
from __future__ import annotations

import re
import unicodedata

# Pictographs, emoticons, transport, supplemental symbols, flags (regional
# indicators), dingbats, misc symbols, enclosed alphanumerics supplement,
# keycaps, variation selectors, ZWJ, tag characters, skin-tone modifiers.
EMOJI_RE = re.compile(
    "["
    "\U0001F000-\U0001FAFF"      # mahjong .. symbols and pictographs extended-A
    "\U0001F1E6-\U0001F1FF"      # regional indicators (flags)
    "\U00002600-\U000027BF"      # misc symbols, dingbats
    "\U00002B00-\U00002BFF"      # arrows, stars, squares
    "\U00002190-\U000021FF"      # arrows (the emoji ones are in here too)
    "\U0000FE00-\U0000FE0F"      # variation selectors
    "\U0000200D\U000020E3"       # zero-width joiner, keycap
    "\U000E0020-\U000E007F"      # tags
    "\U00002300-\U000023FF"      # misc technical (watch, hourglass, play buttons)
    "\U00002934\U00002935\U00003030\U0000303D\U00003297\U00003299\U000000A9\U000000AE\U00002122"
    "]+")


def strip_emoji(s: str | None) -> str:
    """The text without emoji, spaces tidied. None gives ''."""
    if not s:
        return ""
    out = EMOJI_RE.sub(" ", str(s))
    out = re.sub(r"[ \t]{2,}", " ", out)
    out = re.sub(r"\s+([,.;:!?])", r"\1", out)
    return out.strip(" \t-–—·|")


def has_emoji(s: str | None) -> bool:
    return bool(s and EMOJI_RE.search(s))


# A word that names a KIND of place, not a place. Folded (accents removed).
GENERIC_PLACE = {
    "place", "la place", "une place", "cette place", "rue", "la rue", "une rue", "boulevard", "le boulevard", "bd", "avenue",
    "l'avenue", "av", "quai", "le quai", "pont", "le pont", "carrefour", "le carrefour", "gare", "la gare", "mairie",
    "la mairie", "centre", "centre ville", "centre-ville", "le centre", "ville", "la ville", "quartier", "le quartier",
    "route", "la route", "square", "the square", "square", "street", "the street", "main street", "road", "the road",
    "avenue", "the avenue", "downtown", "the city", "city", "town", "the town", "village", "the village", "the area",
    "area", "here", "there", "ici", "la", "plaza", "la plaza", "calle", "la calle", "plaza mayor", "el centro",
    "centro", "площадь", "улица", "площа", "вулиця", "центр", "город", "місто", "ساحة", "شارع", "المدينة", "מרכז",
}


def _fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s or ""))
    return "".join(c for c in s if not unicodedata.combining(c)).casefold().replace("’", "'")


def is_generic_place(name: str | None) -> bool:
    """True for a bare kind-of-place word: 'place', 'rue', 'the square'. A
    named one ('place de la République', 'rue de Rivoli') is not generic."""
    n = re.sub(r"[\s ]+", " ", _fold(name).strip(" .,;:!?\"'«»()"))
    return not n or n in GENERIC_PLACE
