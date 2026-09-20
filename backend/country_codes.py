"""
country_codes.py — one canonical country code, because GDELT ships three.

THE BUG THIS EXISTS TO END. The risk index treated every country code it
saw as interchangeable, and GDELT emits two different systems in two
different fields while GeoConfirmed supplies a third:

    ActionGeo_CountryCode   FIPS 10-4, two letters    RS = Russia
    Actor1/2CountryCode     CAMEO, three letters      RUS = Russia
    GeoConfirmed            ISO-3166 alpha-2          RU = Russia

So Russia was scored three times, under RS, RU and RUS, each with a third
of its evidence. Worse, the map then resolved those codes as ISO: FIPS RS
is ISO Serbia, FIPS IS is ISO Iceland, FIPS CH is ISO Switzerland, FIPS TU
is ISO Tuvalu. Measured on live data, the choropleth was painting Israel's
75.2 onto Iceland, Turkey's 69.8 onto Tuvalu, Russia's 65.5 onto Serbia
and China's 24.7 onto Switzerland — while Ireland and Spain, the two
highest-scoring countries at 78.6, resolved to nothing and did not render
at all.

WHICH SYSTEM A CODE IS IN IS KNOWN FROM ITS FIELD, never guessed from the
string. That is the whole reason this is fixable: "IS" is unambiguous once
you know it came from ActionGeo. Callers say which field they have.

ABSTAINS RATHER THAN GUESSES, the same rule country_registry.py follows: an
unrecognised code returns None and is reported, never mapped to a
plausible-looking neighbour. A wrong country on a risk map is worse than a
missing one, because it is actionable and confident.
"""
from __future__ import annotations

# FIPS 10-4 (GDELT ActionGeo_CountryCode) -> ISO 3166-1 alpha-3.
# Every entry where FIPS and ISO alpha-2 DISAGREE is the reason this table
# exists; the agreeing ones are listed too so callers need no special case.
FIPS_TO_ISO3: dict[str, str] = {
    # observed in this app's live GDELT data
    "BR": "BRA", "CH": "CHN", "EI": "IRL", "FR": "FRA", "GR": "GRC",
    "ID": "IDN", "IR": "IRN", "IS": "ISR", "IZ": "IRQ", "KE": "KEN",
    "KN": "PRK", "NI": "NGA", "RS": "RUS", "SA": "SAU", "SP": "ESP",
    "TU": "TUR", "UK": "GBR", "UP": "UKR", "US": "USA", "WE": "PSE",
    # the rest of the codes this app's theatres will produce
    "AF": "AFG", "AG": "DZA", "AJ": "AZE", "AM": "ARM", "AR": "ARG",
    "AS": "AUS", "AU": "AUT", "BA": "BHR", "BG": "BGD", "BK": "BIH",
    "BM": "MMR", "BO": "BLR", "BU": "BGR", "BY": "BDI", "CA": "CAN",
    "CB": "KHM", "CD": "TCD", "CE": "LKA", "CF": "COG", "CG": "COD",
    "CI": "CHL", "CO": "COL", "CS": "CRI", "CU": "CUB", "DA": "DNK",
    "DJ": "DJI", "DR": "DOM", "EC": "ECU", "EG": "EGY", "EN": "EST",
    "ER": "ERI", "ET": "ETH", "EZ": "CZE", "FI": "FIN", "GB": "GAB",
    "GG": "GEO", "GM": "DEU", "GZ": "PSE", "HO": "HND", "HR": "HRV",
    "HU": "HUN", "IC": "ISL", "IN": "IND", "IT": "ITA", "IV": "CIV",
    "JA": "JPN", "JO": "JOR", "KG": "KGZ", "KS": "KOR", "KU": "KWT",
    "KZ": "KAZ", "LE": "LBN", "LG": "LVA", "LH": "LTU", "LO": "SVK",
    "LY": "LBY", "MD": "MDA", "MG": "MNG", "ML": "MLI", "MO": "MAR",
    "MU": "OMN", "MX": "MEX", "MY": "MYS", "MZ": "MOZ", "NG": "NER",
    "NL": "NLD", "NO": "NOR", "NZ": "NZL", "OD": "SSD", "PE": "PER",
    "PK": "PAK", "PL": "POL", "PO": "PRT", "QA": "QAT", "RO": "ROU",
    "RP": "PHL", "RQ": "PRI", "SF": "ZAF", "SG": "SEN", "SI": "SVN",
    "SN": "SGP", "SO": "SOM", "SU": "SDN", "SW": "SWE", "SY": "SYR",
    "SZ": "CHE", "TH": "THA", "TI": "TJK", "TS": "TUN", "TW": "TWN",
    "TX": "TKM", "TZ": "TZA", "UG": "UGA", "UV": "BFA", "UZ": "UZB",
    "VE": "VEN", "VM": "VNM", "YM": "YEM", "ZA": "ZMB", "ZI": "ZWE",
}

# ISO 3166-1 alpha-2 -> alpha-3, for the codes this app's other feeds use.
ISO2_TO_ISO3: dict[str, str] = {
    "AE": "ARE", "AF": "AFG", "AM": "ARM", "AR": "ARG", "AT": "AUT",
    "AU": "AUS", "AZ": "AZE", "BD": "BGD", "BE": "BEL", "BF": "BFA",
    "BG": "BGR", "BH": "BHR", "BR": "BRA", "BY": "BLR", "CA": "CAN",
    "CD": "COD", "CF": "CAF", "CH": "CHE", "CI": "CIV", "CL": "CHL",
    "CM": "CMR", "CN": "CHN", "CO": "COL", "CZ": "CZE", "DE": "DEU",
    "DK": "DNK", "DZ": "DZA", "EC": "ECU", "EE": "EST", "EG": "EGY",
    "ER": "ERI", "ES": "ESP", "ET": "ETH", "FI": "FIN", "FR": "FRA",
    "GB": "GBR", "GE": "GEO", "GH": "GHA", "GR": "GRC", "HR": "HRV",
    "HU": "HUN", "ID": "IDN", "IE": "IRL", "IL": "ISR", "IN": "IND",
    "IQ": "IRQ", "IR": "IRN", "IS": "ISL", "IT": "ITA", "JO": "JOR",
    "JP": "JPN", "KE": "KEN", "KG": "KGZ", "KP": "PRK", "KR": "KOR",
    "KW": "KWT", "KZ": "KAZ", "LB": "LBN", "LK": "LKA", "LT": "LTU",
    "LV": "LVA", "LY": "LBY", "MA": "MAR", "MD": "MDA", "ML": "MLI",
    "MM": "MMR", "MN": "MNG", "MX": "MEX", "MY": "MYS", "MZ": "MOZ",
    "NE": "NER", "NG": "NGA", "NL": "NLD", "NO": "NOR", "NP": "NPL",
    "NZ": "NZL", "OM": "OMN", "PE": "PER", "PH": "PHL", "PK": "PAK",
    "PL": "POL", "PS": "PSE", "PT": "PRT", "QA": "QAT", "RO": "ROU",
    "RS": "SRB", "RU": "RUS", "SA": "SAU", "SD": "SDN", "SE": "SWE",
    "SG": "SGP", "SI": "SVN", "SK": "SVK", "SO": "SOM", "SS": "SSD",
    "SY": "SYR", "TD": "TCD", "TH": "THA", "TJ": "TJK", "TM": "TKM",
    "TN": "TUN", "TR": "TUR", "TW": "TWN", "TZ": "TZA", "UA": "UKR",
    "UG": "UGA", "US": "USA", "UZ": "UZB", "VE": "VEN", "VN": "VNM",
    "YE": "YEM", "ZA": "ZAF", "ZM": "ZMB", "ZW": "ZWE",
}

ISO3_TO_ISO2 = {v: k for k, v in ISO2_TO_ISO3.items()}

# CAMEO actor country codes that are NOT states, so they are not countries
# and must never become a row on a country risk map.
CAMEO_NON_STATE: frozenset[str] = frozenset({
    "IGO", "NGO", "UNO", "EEC", "NAT", "ARL", "WSB", "MNC", "IMG", "BUS",
})


def from_fips(code: str | None) -> str | None:
    """A GDELT ActionGeo_CountryCode as ISO alpha-3."""
    c = (code or "").strip().upper()
    return FIPS_TO_ISO3.get(c)


def from_cameo(code: str | None) -> str | None:
    """A GDELT actor country code as ISO alpha-3.

    CAMEO uses ISO alpha-3 for states, so this is mostly a passthrough —
    but it filters the non-state actor codes, which look exactly like
    country codes and are not countries.
    """
    c = (code or "").strip().upper()
    if len(c) != 3 or c in CAMEO_NON_STATE:
        return None
    return c if c in ISO3_TO_ISO2 else None


def from_iso2(code: str | None) -> str | None:
    c = (code or "").strip().upper()
    return ISO2_TO_ISO3.get(c)


def event_iso3s(event: dict) -> set[str]:
    """Every country an event touches, canonically, from the right field.

    The field decides the coding system. Reading the value and guessing is
    what produced Russia-as-Serbia, because "RS" is a valid code in both
    systems and means a different country in each.
    """
    out = set()
    geo = from_fips(event.get("country_code"))
    if geo:
        out.add(geo)
    for k in ("actor1_country", "actor2_country"):
        a = from_cameo(event.get(k))
        if a:
            out.add(a)
    return out
