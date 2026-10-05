import re

_CONNECTORS = {
    "of", "the", "and", "de", "da", "di", "al", "el", "es", "la", "le", "bin", "ibn",
}

_STOPWORDS = {
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "january", "february", "march", "april", "may", "june", "july", "august",
    "september", "october", "november", "december",
    "government", "president", "prime", "minister", "army", "military", "police",
    "breaking", "update", "news", "world", "analysis", "report", "agency",
    "official", "officials", "state", "court", "parliament", "security",
}

_RE_IN_AT = re.compile(
    r"\b(?:in|at|near|from)\s+([A-Z][A-Za-z'`.-]*(?:\s+(?:[A-Z][A-Za-z'`.-]*|[a-z]{1,3})){0,3})"
)
_RE_CITY_COUNTRY = re.compile(
    r"\b([A-Z][A-Za-z'`.-]*(?:\s+(?:[A-Z][A-Za-z'`.-]*|[a-z]{1,3})){0,2}),\s*([A-Z][A-Za-z'`.-]*(?:\s+(?:[A-Z][A-Za-z'`.-]*|[a-z]{1,3})){0,2})"
)
_RE_DASH = re.compile(
    r"\b([A-Z][A-Za-z'`.-]*(?:\s+(?:[A-Z][A-Za-z'`.-]*|[a-z]{1,3})){0,3})\s+-"
)
_RE_CAP_SEQ = re.compile(
    r"\b([A-Z][A-Za-z'`.-]*(?:\s+(?:[A-Z][A-Za-z'`.-]*|of|the|and|de|da|di|al|el|es|la|le)){0,3})\b"
)

_COUNTRY_CODE_ALIASES = {
    "tz": ["tanzania", "united republic of tanzania"],
    "ke": ["kenya"],
    "ug": ["uganda"],
    "rw": ["rwanda"],
    "bi": ["burundi"],
    "cd": ["drc", "dr congo", "congo-kinshasa", "democratic republic of congo", "democratic republic of the congo"],
    "so": ["somalia"],
    "et": ["ethiopia"],
    "sd": ["sudan"],
    "ss": ["south sudan"],
    "mz": ["mozambique"],
    "zm": ["zambia"],
    "mw": ["malawi"],
    "zw": ["zimbabwe"],
    "za": ["south africa", "sa"],
    "cf": ["car", "central african republic"],
    "ae": ["uae", "united arab emirates"],
    "gb": ["uk", "united kingdom", "britain", "great britain"],
    "us": ["us", "u.s.", "usa", "u.s.a.", "united states", "united states of america"],
}

_COUNTRY_NAME_BY_CODE = {
    "tz": "Tanzania",
    "ke": "Kenya",
    "ug": "Uganda",
    "rw": "Rwanda",
    "bi": "Burundi",
    "cd": "Democratic Republic of the Congo",
    "so": "Somalia",
    "et": "Ethiopia",
    "sd": "Sudan",
    "ss": "South Sudan",
    "mz": "Mozambique",
    "zm": "Zambia",
    "mw": "Malawi",
    "zw": "Zimbabwe",
    "za": "South Africa",
    "cf": "Central African Republic",
    "ae": "United Arab Emirates",
    "gb": "United Kingdom",
    "us": "United States",
}

_COUNTRY_ALIAS_TO_CODE = {}
for _code, _aliases in _COUNTRY_CODE_ALIASES.items():
    for _alias in _aliases:
        _COUNTRY_ALIAS_TO_CODE[_alias.lower()] = _code


def _clean(candidate: str) -> str:
    return re.sub(r"\s+", " ", (candidate or "")).strip(" ,.-")


def _is_valid_candidate(candidate: str) -> bool:
    c = _clean(candidate)
    if not c:
        return False
    if any(ch.isdigit() for ch in c):
        return False
    tokens = c.split()
    if len(tokens) == 0 or len(tokens) > 4:
        return False

    normalized = [t.lower() for t in tokens]
    if all(t in _STOPWORDS for t in normalized):
        return False
    if normalized[0] in _STOPWORDS:
        return False

    # Require first token to look place-like (capitalized word).
    first = tokens[0]
    if not first[0].isupper():
        return False

    for t in normalized[1:]:
        if t in _CONNECTORS:
            continue
        if t in _STOPWORDS:
            return False
    return True


def extract_location_candidates(text: str) -> list[str]:
    """
    Lightweight location candidate extraction from title+summary text.
    Returns deduplicated candidates ordered by heuristic confidence.
    """
    src = re.sub(r"\s+", " ", text or "").strip()
    if not src:
        return []

    scored: list[tuple[int, str]] = []

    for m in _RE_IN_AT.finditer(src):
        scored.append((100, _clean(m.group(1))))

    for m in _RE_CITY_COUNTRY.finditer(src):
        city = _clean(m.group(1))
        country = _clean(m.group(2))
        scored.append((96, f"{city}, {country}"))
        scored.append((92, city))

    for m in _RE_DASH.finditer(src):
        scored.append((88, _clean(m.group(1))))

    for m in _RE_CAP_SEQ.finditer(src):
        scored.append((70, _clean(m.group(1))))

    # Sort by score descending while preserving first-seen order within same score.
    dedup: dict[str, tuple[int, int, str]] = {}
    for idx, (score, candidate) in enumerate(scored):
        if not _is_valid_candidate(candidate):
            continue
        key = candidate.lower()
        if key not in dedup or score > dedup[key][0]:
            dedup[key] = (score, idx, candidate)

    ordered = sorted(dedup.values(), key=lambda x: (-x[0], x[1]))
    return [c for _, _, c in ordered]


def rank_location_candidates(title: str, body: str) -> list[str]:
    """
    Extract location candidates from title + body, weighted by position.

    Weighting scheme:
      title          → weight 3  (most reliable — primary subject of article)
      first 100 words of body → weight 2
      remainder of body       → weight 1

    This prevents a passing country mention in the middle of an article from
    out-ranking the headline location, which is the root cause of "Tehran funeral
    geocoded to Kenya" misclassifications.

    Returns a deduplicated list sorted by weight descending (highest first).
    """
    body_words  = (body or "").split()
    first_100   = " ".join(body_words[:100])
    rest_body   = " ".join(body_words[100:])

    title_cands  = extract_location_candidates(title or "")
    first_cands  = extract_location_candidates(first_100) if first_100 else []
    rest_cands   = extract_location_candidates(rest_body)  if rest_body  else []

    weight_map: dict[str, int]  = {}
    canonical:  dict[str, str]  = {}

    for c in title_cands:
        key = c.lower()
        if key not in weight_map or 3 > weight_map[key]:
            weight_map[key] = 3
        if key not in canonical:
            canonical[key] = c

    for c in first_cands:
        key = c.lower()
        if key not in weight_map or 2 > weight_map[key]:
            weight_map[key] = max(weight_map.get(key, 0), 2)
        if key not in canonical:
            canonical[key] = c

    for c in rest_cands:
        key = c.lower()
        weight_map[key] = max(weight_map.get(key, 0), 1)
        if key not in canonical:
            canonical[key] = c

    sorted_keys = sorted(weight_map.keys(), key=lambda k: -weight_map[k])
    return [canonical[k] for k in sorted_keys if k in canonical]


def extract_country_mentions(text: str) -> set[str]:
    """
    Detect country mentions and return ISO2 codes.
    """
    src = (text or "").lower()
    found: set[str] = set()
    if not src:
        return found
    for alias, code in _COUNTRY_ALIAS_TO_CODE.items():
        if re.search(rf"(?<![a-z]){re.escape(alias)}(?![a-z])", src):
            found.add(code)
    return found


def country_code_from_name(name: str) -> str | None:
    return _COUNTRY_ALIAS_TO_CODE.get((name or "").strip().lower())


# The full ISO table, read once from the country outlines the globe already
# draws. _COUNTRY_NAME_BY_CODE above is a hand-written regional subset of
# nineteen entries — enough for the East Africa work it was added for, and
# silently None for everything else, so "CTY:mx" resolved to nothing and a
# fusion in Mexico was labelled "Unknown Location". One shipped file with
# 191 countries beats a second hand-maintained list that will drift from it.
_ISO_NAMES: dict[str, str] | None = None


def _iso_names() -> dict[str, str]:
    global _ISO_NAMES
    if _ISO_NAMES is not None:
        return _ISO_NAMES
    out: dict[str, str] = {}
    try:
        import json as _json
        import os as _os
        path = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))),
                             "public", "data", "world-countries.json")
        with open(path) as fh:
            for feat in (_json.load(fh).get("features") or []):
                p = feat.get("properties") or {}
                name, a2, a3 = p.get("n"), p.get("a2"), p.get("a3")
                if not name:
                    continue
                for code in (a2, a3):
                    if code:
                        out[str(code).strip().lower()] = name
    except Exception:
        pass        # the hand-written subset below still answers
    _ISO_NAMES = out
    return out


# CODES THE SHIPPED FILE CANNOT ANSWER. world-countries.json is Natural
# Earth, which files France, Norway and Kosovo under "-99" rather than their
# ISO codes, and is too coarse to hold the small states that run the
# largest ship registries — Malta, Singapore, the Marshall Islands. So
# "NOR" and "MLT" resolved to nothing everywhere a code is turned into a
# name. A fallback only: a name the file does carry is never replaced.
_CODE_GAPS = {
    "France": ("fr", "fra"), "Norway": ("no", "nor"), "Kosovo": ("xk", "xkx"),
    "Malta": ("mt", "mlt"), "Singapore": ("sg", "sgp"), "Monaco": ("mc", "mco"),
    "Marshall Islands": ("mh", "mhl"), "Cayman Islands": ("ky", "cym"),
    "Bermuda": ("bm", "bmu"), "Gibraltar": ("gi", "gib"), "Bahrain": ("bh", "bhr"),
    "Mauritius": ("mu", "mus"), "Seychelles": ("sc", "syc"), "Maldives": ("mv", "mdv"),
    "Saint Kitts and Nevis": ("kn", "kna"), "Saint Vincent and the Grenadines": ("vc", "vct"),
    "Antigua and Barbuda": ("ag", "atg"), "Barbados": ("bb", "brb"), "Tuvalu": ("tv", "tuv"),
    "Kiribati": ("ki", "kir"), "Palau": ("pw", "plw"), "Cook Islands": ("ck", "cok"),
    "Niue": ("nu", "niu"), "Tonga": ("to", "ton"), "Samoa": ("ws", "wsm"),
    "Comoros": ("km", "com"), "São Tomé and Príncipe": ("st", "stp"), "Cabo Verde": ("cv", "cpv"),
    "British Virgin Islands": ("vg", "vgb"), "Saint Lucia": ("lc", "lca"), "Grenada": ("gd", "grd"),
    "Dominica": ("dm", "dma"), "Faroe Islands": ("fo", "fro"), "Andorra": ("ad", "and"),
    "Liechtenstein": ("li", "lie"), "San Marino": ("sm", "smr"), "Vatican City": ("va", "vat"),
    "Macau": ("mo", "mac"), "Micronesia": ("fm", "fsm"), "Nauru": ("nr", "nru"),
}
_CODE_GAP_NAMES = {c: n for n, codes in _CODE_GAPS.items() for c in codes}


def country_name_from_code(code: str) -> str | None:
    key = (code or "").strip().lower()
    if not key:
        return None
    # The curated names win where they exist — they are the ones chosen for
    # how this product refers to those countries.
    return (_COUNTRY_NAME_BY_CODE.get(key) or _iso_names().get(key)
            or _CODE_GAP_NAMES.get(key))


# ── the country at the end of the location string ───────────────────────
#
# Surface signals arrive with locations like "Subukia, Rift Valley, Kenya"
# and "Ferozepur, Punjab, Pakistan". The country is the last part, every
# time, and NOTHING PARSED IT: a live pool measured 0 of 50 signals with a
# location_country set, so every count, filter and join that works by
# country was reading an empty column while the answer sat in the next one.
#
# Deterministic — a tail match against the shipped ISO names, their two-
# and three-letter codes, and the aliases below. An unrecognised tail
# returns None rather than a near miss: a signal filed under the wrong
# country is worse than one filed under none.

_COUNTRY_ALIASES = {
    "united states": "United States of America",
    "usa": "United States of America",
    "u.s.": "United States of America",
    "u.s.a.": "United States of America",
    "america": "United States of America",
    "uk": "United Kingdom",
    "britain": "United Kingdom",
    "great britain": "United Kingdom",
    "england": "United Kingdom",
    "scotland": "United Kingdom",
    "wales": "United Kingdom",
    "northern ireland": "United Kingdom",
    "russian federation": "Russia",
    "republic of korea": "South Korea",
    "democratic peoples republic of korea": "North Korea",
    "syrian arab republic": "Syria",
    "islamic republic of iran": "Iran",
    "burma": "Myanmar",
    "cote divoire": "Ivory Coast",
    "czech republic": "Czechia",
    "holland": "Netherlands",
    "the netherlands": "Netherlands",
    "tanzania": "United Republic of Tanzania",
    "drc": "Democratic Republic of the Congo",
    "dr congo": "Democratic Republic of the Congo",
    "congo kinshasa": "Democratic Republic of the Congo",
    "uae": "United Arab Emirates",
    "turkiye": "Turkey",
    "west bank": "Palestine",
    "gaza strip": "Palestine",
    "viet nam": "Vietnam",
    "lao peoples democratic republic": "Laos",
    "bolivia plurinational state of": "Bolivia",
    "venezuela bolivarian republic of": "Venezuela",
    "republic of moldova": "Moldova",
    "cabo verde": "Cape Verde",
    "swaziland": "Eswatini",
    "macedonia": "North Macedonia",
}


def _clean_place_part(part):
    """One comma-separated part, reduced to something comparable.

    Strips the "(general)" this geocoder appends — "Israel (general)" and
    "Nigeria (general)" are real values in the live feed — folds accents so
    "Turkiye" and a mojibake "T?rkiye" land together, and drops the
    punctuation that separates an alias from its spelled-out form.
    """
    import re as _re
    import unicodedata as _ud
    t = _ud.normalize("NFKD", str(part or "")).encode("ascii", "ignore").decode()
    t = _re.sub(r"\((?:general|country|region|province|state)\)", " ", t, flags=_re.I)
    t = _re.sub(r"[^a-zA-Z ]+", " ", t)
    return " ".join(t.lower().split())


def country_from_location(location):
    """The country named at the end of a location string, or None.

    Tries the last comma-separated part, then the one before it, because a
    few sources append a region after the country. Matching is exact
    against the known names, codes and aliases — never fuzzy.
    """
    loc = str(location or "").strip()
    if not loc:
        return None
    parts = [p for p in (x.strip() for x in loc.split(",")) if p]
    if not parts:
        return None

    names = _iso_names()
    for part in reversed(parts[-2:]):
        key = _clean_place_part(part)
        if not key:
            continue
        if key in _COUNTRY_ALIASES:
            return _COUNTRY_ALIASES[key]
        hit = _COUNTRY_NAME_BY_CODE.get(key) or names.get(key)
        if hit:
            return hit
        # The shipped table is keyed by code as well as by name, so a tail
        # that is already a code ("US", "DEU") resolves here.
        for cand in names.values():
            if _clean_place_part(cand) == key:
                return cand
    return None
