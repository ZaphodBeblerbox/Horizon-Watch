"""
country_registry.py — the one real canonical Country registry every real
ingestion path resolves to, keyed on real ISO-3166-1 alpha-2 codes.

Built from REAL, currently-observed data, not a speculative full ISO-3166
table: every one of GeoConfirmed's real `plus_code` values in the live DB
was pulled and its real trailing country-name segment extracted (93 real
distinct strings, 2026-09 audit). 10 of those 93 are NOT real countries —
they're localities or a postal-code fragment that a naive "take the last
comma segment" parse mistook for a country (this was the real, confirmed
root cause of the live "duplicate/wrong country" bug — see
geoconfirmed.py's `_plus_code_country()`, which now validates through
`canonical_country()` below instead of trusting the raw segment blindly).
The other 83 are genuine, unambiguous real countries — mapped here to
their real ISO alpha-2 codes.

This is deliberately NOT a full 249-entry ISO-3166 table: every entry here
is grounded in real, currently-observed GeoConfirmed data rather than
hand-typed from memory (which risks a wrong/hallucinated code for a country
that never actually appears in this app's real data). `canonical_country()`
returns None for anything not recognized — an honest abstention (this
app's established "abstain rather than guess" rule, see geoconfirmed.py's
day-precision handling), not a silently-created wrong or duplicate node. If
a genuinely new real country name shows up in future GeoConfirmed data
(a new theatre opening, say), it will be logged clearly rather than
silently dropped OR silently turned into a bogus node — see
geoconfirmed.py's `sync_ontology_from_geoconfirmed()` — so a developer can
add the real entry here.
"""
from __future__ import annotations

# Real, observed-in-this-app's-data locality/postal-code strings that a
# naive last-comma-segment parse of a GeoConfirmed plusCode mistook for a
# country. NOT a country under any real definition — confirmed by direct
# audit of each one's actual geography (Gaza-strip localities, Crimean
# cities, one raw Moscow postal code). Never given a country node.
KNOWN_NON_COUNTRY_LOCALITIES: frozenset[str] = frozenset({
    "142137",            # a Moscow postal-code fragment, not a country
    "deir al balah", "gaza", "jabalia", "khan yunis", "maghazi", "nuseirat camp",
    "feodosia", "kerch", "yalta",
})

# Real name (lowercased, whitespace-normalized) -> real ISO-3166-1 alpha-2
# code. Includes the exact strings GeoConfirmed's own plusCode geocoding
# produces PLUS common real-world aliases for the same country (so a
# differently-worded future ingestion path — an upload, a claim — resolves
# to the SAME real node rather than creating a disjoint duplicate).
_NAME_TO_ISO: dict[str, str] = {
    "afghanistan": "AF", "angola": "AO", "armenia": "AM", "australia": "AU",
    "bahrain": "BH", "bangladesh": "BD", "belarus": "BY", "belgium": "BE",
    "bolivia": "BO", "brazil": "BR",
    "british indian ocean territory": "IO",
    "bulgaria": "BG", "burkina faso": "BF", "canada": "CA", "chad": "TD",
    "chile": "CL", "china": "CN", "colombia": "CO", "cyprus": "CY",
    "democratic republic of the congo": "CD", "dr congo": "CD", "drc": "CD",
    "congo-kinshasa": "CD",
    "dominican republic": "DO", "ecuador": "EC", "egypt": "EG", "ethiopia": "ET",
    "france": "FR", "georgia": "GE", "germany": "DE", "greece": "GR",
    "greenland": "GL", "guinea": "GN", "haiti": "HT", "honduras": "HN",
    "hungary": "HU", "iceland": "IS", "india": "IN", "indonesia": "ID",
    "iran": "IR", "iraq": "IQ", "israel": "IL", "japan": "JP", "jordan": "JO",
    "kazakhstan": "KZ", "kuwait": "KW", "latvia": "LV", "lebanon": "LB",
    "libya": "LY", "lithuania": "LT", "mauritius": "MU", "mexico": "MX",
    "moldova": "MD", "montenegro": "ME", "mozambique": "MZ",
    "myanmar (burma)": "MM", "myanmar": "MM", "burma": "MM",
    "nepal": "NP", "new caledonia": "NC",
    "north korea": "KP", "dprk": "KP",
    "oman": "OM", "pakistan": "PK", "papua new guinea": "PG", "poland": "PL",
    "portugal": "PT", "qatar": "QA", "romania": "RO",
    "russia": "RU", "russian federation": "RU",
    "slovakia": "SK", "somalia": "SO", "south africa": "ZA",
    "south korea": "KR", "republic of korea": "KR",
    "spain": "ES", "sweden": "SE", "switzerland": "CH", "syria": "SY",
    "tajikistan": "TJ", "trinidad and tobago": "TT",
    "turks and caicos islands": "TC",
    "türkiye": "TR", "turkiye": "TR", "turkey": "TR",
    "uk": "GB", "united kingdom": "GB", "great britain": "GB",
    "usa": "US", "united states": "US", "united states of america": "US", "america": "US",
    "ukraine": "UA", "uruguay": "UY", "uzbekistan": "UZ",
    "venezuela": "VE", "yemen": "YE",
    # Real theatre-adjacent countries GeoConfirmed's ORBAT/faction data
    # references even where no live plus_code sample was pulled (e.g.
    # "Palestine" as a real distinct polity from "Gaza" the locality).
    "palestine": "PS", "state of palestine": "PS",
}

# Canonical real display name per ISO code — a clean, standard English
# short name, used as the node's real label regardless of which alias
# string a given ingestion path resolved from.
_ISO_TO_NAME: dict[str, str] = {
    "AF": "Afghanistan", "AO": "Angola", "AM": "Armenia", "AU": "Australia",
    "BH": "Bahrain", "BD": "Bangladesh", "BY": "Belarus", "BE": "Belgium",
    "BO": "Bolivia", "BR": "Brazil", "IO": "British Indian Ocean Territory",
    "BG": "Bulgaria", "BF": "Burkina Faso", "CA": "Canada", "TD": "Chad",
    "CL": "Chile", "CN": "China", "CO": "Colombia", "CY": "Cyprus",
    "CD": "Democratic Republic of the Congo", "DO": "Dominican Republic",
    "EC": "Ecuador", "EG": "Egypt", "ET": "Ethiopia", "FR": "France",
    "GE": "Georgia", "DE": "Germany", "GR": "Greece", "GL": "Greenland",
    "GN": "Guinea", "HT": "Haiti", "HN": "Honduras", "HU": "Hungary",
    "IS": "Iceland", "IN": "India", "ID": "Indonesia", "IR": "Iran",
    "IQ": "Iraq", "IL": "Israel", "JP": "Japan", "JO": "Jordan",
    "KZ": "Kazakhstan", "KW": "Kuwait", "LV": "Latvia", "LB": "Lebanon",
    "LY": "Libya", "LT": "Lithuania", "MU": "Mauritius", "MX": "Mexico",
    "MD": "Moldova", "ME": "Montenegro", "MZ": "Mozambique", "MM": "Myanmar",
    "NP": "Nepal", "NC": "New Caledonia", "KP": "North Korea", "OM": "Oman",
    "PK": "Pakistan", "PG": "Papua New Guinea", "PL": "Poland", "PT": "Portugal",
    "QA": "Qatar", "RO": "Romania", "RU": "Russia", "SK": "Slovakia",
    "SO": "Somalia", "ZA": "South Africa", "KR": "South Korea", "ES": "Spain",
    "SE": "Sweden", "CH": "Switzerland", "SY": "Syria", "TJ": "Tajikistan",
    "TT": "Trinidad and Tobago", "TC": "Turks and Caicos Islands", "TR": "Türkiye",
    "GB": "United Kingdom", "US": "United States", "UA": "Ukraine",
    "UY": "Uruguay", "UZ": "Uzbekistan", "VE": "Venezuela", "YE": "Yemen",
    "PS": "Palestine",
}


def _normalize(raw: str) -> str:
    return " ".join((raw or "").strip().lower().split())


def canonical_country(raw_name: str | None) -> tuple[str, str] | None:
    """Resolve any real name string to (iso_code, canonical_display_name),
    or None if it's not a recognized real country (including every known
    non-country locality/postal-code string). Never a substring match —
    exact normalized match only, the same word-boundary-safety discipline
    entity_linker.py already established elsewhere in this app."""
    key = _normalize(raw_name)
    if not key:
        return None
    iso = _NAME_TO_ISO.get(key)
    if not iso:
        return None
    return iso, _ISO_TO_NAME[iso]


def is_known_non_country(raw_name: str | None) -> bool:
    return _normalize(raw_name) in KNOWN_NON_COUNTRY_LOCALITIES
