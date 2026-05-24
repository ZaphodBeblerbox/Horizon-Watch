"""
icao_lookup.py — ICAO 24-bit hex address → military operator/allegiance.
Ranges sourced from ICAO Annex 10 military block allocations.
"""

# (hex_start, hex_end, country, service, flag_emoji)
MILITARY_ICAO_RANGES = [
    ("ADF7C7", "AFFFFF", "United States",  "US Air Force",                              "🇺🇸"),
    ("A00000", "ADF7C6", "United States",  "US Military",                               "🇺🇸"),
    ("43C000", "43CFFF", "United Kingdom", "Royal Air Force",                           "🇬🇧"),
    ("43D000", "43DFFF", "United Kingdom", "Royal Navy",                                "🇬🇧"),
    ("3A8000", "3AFFFF", "France",         "Armée de l'Air",                            "🇫🇷"),
    ("3DC000", "3DFFFF", "Germany",        "Luftwaffe",                                  "🇩🇪"),
    ("100000", "1FFFFF", "Russia",         "Russian Air Force",                         "🇷🇺"),
    ("780000", "7FFFFF", "China",          "People's Liberation Army Air Force",        "🇨🇳"),
    ("738000", "73FFFF", "Israel",         "Israeli Air Force",                         "🇮🇱"),
    ("730000", "737FFF", "Iran",           "Islamic Republic of Iran Air Force",        "🇮🇷"),
    ("44D000", "44DFFF", "Belgium",        "Belgian Air Component",                     "🇧🇪"),
    ("480000", "487FFF", "Netherlands",    "Royal Netherlands Air Force",               "🇳🇱"),
    ("470000", "477FFF", "Norway",         "Royal Norwegian Air Force",                 "🇳🇴"),
    ("49D000", "49DFFF", "Sweden",         "Swedish Air Force",                         "🇸🇪"),
    ("458000", "45FFFF", "Denmark",        "Royal Danish Air Force",                    "🇩🇰"),
    ("4B8000", "4BFFFF", "Turkey",         "Turkish Air Force",                         "🇹🇷"),
    ("800000", "83FFFF", "India",          "Indian Air Force",                          "🇮🇳"),
    ("760000", "76FFFF", "Pakistan",       "Pakistan Air Force",                        "🇵🇰"),
    ("840000", "87FFFF", "Japan",          "Japan Air Self-Defense Force",              "🇯🇵"),
    ("7C0000", "7FFFFF", "Australia",      "Royal Australian Air Force",                "🇦🇺"),
    ("C00000", "C3FFFF", "Canada",         "Royal Canadian Air Force",                  "🇨🇦"),
    ("718000", "71FFFF", "South Korea",    "Republic of Korea Air Force",               "🇰🇷"),
    ("710000", "717FFF", "Saudi Arabia",   "Royal Saudi Air Force",                     "🇸🇦"),
    ("896000", "8973FF", "UAE",            "United Arab Emirates Air Force",            "🇦🇪"),
    ("728000", "72FFFF", "North Korea",    "Korean People's Army Air Force",            "🇰🇵"),
]

_ISO2_MAP = {
    "United States":  "US", "United Kingdom": "GB",
    "France":         "FR", "Germany":        "DE",
    "Russia":         "RU", "China":          "CN",
    "Israel":         "IL", "Iran":           "IR",
    "Belgium":        "BE", "Netherlands":    "NL",
    "Norway":         "NO", "Sweden":         "SE",
    "Denmark":        "DK", "Turkey":         "TR",
    "India":          "IN", "Pakistan":       "PK",
    "Japan":          "JP", "Australia":      "AU",
    "Canada":         "CA", "South Korea":    "KR",
    "Saudi Arabia":   "SA", "UAE":            "AE",
    "North Korea":    "KP",
}


def lookup_icao_hex(icao_hex: str) -> dict:
    """Identify military aircraft from ICAO 24-bit hex code.
    Returns operator country, service branch, flag — or military=False."""
    if not icao_hex:
        return {"military": False}
    try:
        hex_int = int(icao_hex.upper().zfill(6), 16)
    except ValueError:
        return {"military": False, "icao_hex": icao_hex}

    for start, end, country, service, flag in MILITARY_ICAO_RANGES:
        if int(start, 16) <= hex_int <= int(end, 16):
            iso2 = _ISO2_MAP.get(country, "XX")
            return {
                "military":    True,
                "country":     country,
                "service":     service,
                "flag_emoji":  flag,
                "flag_iso2":   iso2,
                "flag_url":    f"https://flagcdn.com/w40/{iso2.lower()}.png",
                "icao_hex":    icao_hex,
            }
    return {
        "military":  False,
        "icao_hex":  icao_hex,
        "country":   "Unknown",
    }
