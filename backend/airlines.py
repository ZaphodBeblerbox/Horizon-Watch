"""
airlines.py — the operator hiding in every airline callsign.

An aircraft on the map is an ICAO24 hex code and a callsign. The callsign
is not a label: its first three letters are the ICAO airline designator,
issued and unique. "UAE231" is Emirates, "BAW15" is British Airways,
"RYR4TG" is Ryanair. 58.6% of the aircraft-days in this system carry one,
and NOTHING READ IT — so clicking an aircraft gave a hex code and a flight
number, and the chain "this aircraft → this airline → this country" could
not be walked at all.

This is a lookup, not a model. The designator is in the data already.

WHAT IS AND IS NOT IN THE TABLE. Only designators whose attribution is
certain. There are roughly 1,600 distinct designators in this system's own
traffic and this table does not cover them all — an aircraft wrongly
attributed to an airline is worse than one left unattributed, because the
first is a false connection that a person will reason from and the second
is an obvious gap. `operator_for_callsign` returns None for anything it
does not know, and the caller shows the callsign as it arrived.

Each entry is (name, country, hub) — the hub being the airline's principal
base, which is what makes "Emirates → Dubai" the second hop of the chain.
"""
from __future__ import annotations

import re

# ICAO three-letter designator -> (airline, country, principal hub)
AIRLINES: dict[str, tuple[str, str, str | None]] = {
    # ── Gulf and Middle East ──
    "UAE": ("Emirates", "United Arab Emirates", "Dubai"),
    "ETD": ("Etihad Airways", "United Arab Emirates", "Abu Dhabi"),
    "QTR": ("Qatar Airways", "Qatar", "Doha"),
    "ABY": ("Air Arabia", "United Arab Emirates", "Sharjah"),
    "FDB": ("flydubai", "United Arab Emirates", "Dubai"),
    "SVA": ("Saudia", "Saudi Arabia", "Jeddah"),
    "KAC": ("Kuwait Airways", "Kuwait", "Kuwait City"),
    "GFA": ("Gulf Air", "Bahrain", "Manama"),
    "OMA": ("Oman Air", "Oman", "Muscat"),
    "RJA": ("Royal Jordanian", "Jordan", "Amman"),
    "MEA": ("Middle East Airlines", "Lebanon", "Beirut"),
    "ELY": ("El Al", "Israel", "Tel Aviv"),
    "IRA": ("Iran Air", "Iran", "Tehran"),
    "THY": ("Turkish Airlines", "Turkey", "Istanbul"),
    "PGT": ("Pegasus Airlines", "Turkey", "Istanbul"),
    "MSR": ("EgyptAir", "Egypt", "Cairo"),

    # ── North America ──
    "UAL": ("United Airlines", "United States of America", "Chicago"),
    "DAL": ("Delta Air Lines", "United States of America", "Atlanta"),
    "AAL": ("American Airlines", "United States of America", "Dallas/Fort Worth"),
    "SWA": ("Southwest Airlines", "United States of America", "Dallas"),
    "ASA": ("Alaska Airlines", "United States of America", "Seattle"),
    "JBU": ("JetBlue Airways", "United States of America", "New York"),
    "NKS": ("Spirit Airlines", "United States of America", "Fort Lauderdale"),
    "FFT": ("Frontier Airlines", "United States of America", "Denver"),
    "SKW": ("SkyWest Airlines", "United States of America", "St. George"),
    "HAL": ("Hawaiian Airlines", "United States of America", "Honolulu"),
    "FDX": ("FedEx Express", "United States of America", "Memphis"),
    "UPS": ("UPS Airlines", "United States of America", "Louisville"),
    "ACA": ("Air Canada", "Canada", "Toronto"),
    "WJA": ("WestJet", "Canada", "Calgary"),
    "AMX": ("Aeroméxico", "Mexico", "Mexico City"),
    "VOI": ("Volaris", "Mexico", "Mexico City"),

    # ── Europe ──
    "BAW": ("British Airways", "United Kingdom", "London"),
    "EZY": ("easyJet", "United Kingdom", "London"),
    "RYR": ("Ryanair", "Ireland", "Dublin"),
    "EIN": ("Aer Lingus", "Ireland", "Dublin"),
    "DLH": ("Lufthansa", "Germany", "Frankfurt"),
    "EWG": ("Eurowings", "Germany", "Düsseldorf"),
    "CFG": ("Condor", "Germany", "Frankfurt"),
    "AFR": ("Air France", "France", "Paris"),
    "TVF": ("Transavia France", "France", "Paris"),
    "KLM": ("KLM", "Netherlands", "Amsterdam"),
    "TRA": ("Transavia", "Netherlands", "Amsterdam"),
    "IBE": ("Iberia", "Spain", "Madrid"),
    "VLG": ("Vueling", "Spain", "Barcelona"),
    "ANE": ("Air Nostrum", "Spain", "Valencia"),
    "VOE": ("Volotea", "Spain", "Barcelona"),
    "AEA": ("Air Europa", "Spain", "Madrid"),
    "ITY": ("ITA Airways", "Italy", "Rome"),
    "SWR": ("Swiss International Air Lines", "Switzerland", "Zurich"),
    "AUA": ("Austrian Airlines", "Austria", "Vienna"),
    "BEL": ("Brussels Airlines", "Belgium", "Brussels"),
    "TAP": ("TAP Air Portugal", "Portugal", "Lisbon"),
    "SAS": ("SAS", "Sweden", "Stockholm"),
    "NAX": ("Norwegian Air Shuttle", "Norway", "Oslo"),
    "FIN": ("Finnair", "Finland", "Helsinki"),
    "ICE": ("Icelandair", "Iceland", "Reykjavík"),
    "LOT": ("LOT Polish Airlines", "Poland", "Warsaw"),
    "CSA": ("Czech Airlines", "Czechia", "Prague"),
    "WZZ": ("Wizz Air", "Hungary", "Budapest"),
    "AEE": ("Aegean Airlines", "Greece", "Athens"),
    "TAR": ("Tunisair", "Tunisia", "Tunis"),
    "AFL": ("Aeroflot", "Russia", "Moscow"),
    "SBI": ("S7 Airlines", "Russia", "Moscow"),
    "UTA": ("UTair", "Russia", "Moscow"),
    "AUI": ("Ukraine International Airlines", "Ukraine", "Kyiv"),

    # ── Asia-Pacific ──
    "CCA": ("Air China", "China", "Beijing"),
    "CES": ("China Eastern Airlines", "China", "Shanghai"),
    "CSN": ("China Southern Airlines", "China", "Guangzhou"),
    "CHH": ("Hainan Airlines", "China", "Haikou"),
    "CXA": ("XiamenAir", "China", "Xiamen"),
    "CPA": ("Cathay Pacific", "China", "Hong Kong"),
    "HDA": ("Cathay Dragon", "China", "Hong Kong"),
    "SIA": ("Singapore Airlines", "Singapore", "Singapore"),
    "SLK": ("Scoot", "Singapore", "Singapore"),
    "MAS": ("Malaysia Airlines", "Malaysia", "Kuala Lumpur"),
    "AXM": ("AirAsia", "Malaysia", "Kuala Lumpur"),
    "THA": ("Thai Airways", "Thailand", "Bangkok"),
    "GIA": ("Garuda Indonesia", "Indonesia", "Jakarta"),
    "LNI": ("Lion Air", "Indonesia", "Jakarta"),
    "PAL": ("Philippine Airlines", "Philippines", "Manila"),
    "CEB": ("Cebu Pacific", "Philippines", "Manila"),
    "ANA": ("All Nippon Airways", "Japan", "Tokyo"),
    "JAL": ("Japan Airlines", "Japan", "Tokyo"),
    "KAL": ("Korean Air", "South Korea", "Seoul"),
    "AAR": ("Asiana Airlines", "South Korea", "Seoul"),
    "CAL": ("China Airlines", "Taiwan", "Taipei"),
    "EVA": ("EVA Air", "Taiwan", "Taipei"),
    "AIC": ("Air India", "India", "Delhi"),
    "IGO": ("IndiGo", "India", "Delhi"),
    "VTI": ("Vistara", "India", "Delhi"),
    "PIA": ("Pakistan International Airlines", "Pakistan", "Karachi"),
    "BBC": ("Biman Bangladesh Airlines", "Bangladesh", "Dhaka"),
    "UAL_AU": ("", "", None),   # placeholder guard, never matched
    "QFA": ("Qantas", "Australia", "Sydney"),
    "JST": ("Jetstar", "Australia", "Melbourne"),
    "VOZ": ("Virgin Australia", "Australia", "Brisbane"),
    "ANZ": ("Air New Zealand", "New Zealand", "Auckland"),

    # ── Africa and South America ──
    "ETH": ("Ethiopian Airlines", "Ethiopia", "Addis Ababa"),
    "KQA": ("Kenya Airways", "Kenya", "Nairobi"),
    "SAA": ("South African Airways", "South Africa", "Johannesburg"),
    "RAM": ("Royal Air Maroc", "Morocco", "Casablanca"),
    "DAH": ("Air Algérie", "Algeria", "Algiers"),
    "TAM": ("LATAM Brasil", "Brazil", "São Paulo"),
    "GLO": ("Gol Linhas Aéreas", "Brazil", "São Paulo"),
    "AZU": ("Azul Brazilian Airlines", "Brazil", "Campinas"),
    "ARG": ("Aerolíneas Argentinas", "Argentina", "Buenos Aires"),
    "AVA": ("Avianca", "Colombia", "Bogotá"),
    "LAN": ("LATAM Chile", "Chile", "Santiago"),
    "CMP": ("Copa Airlines", "Panama", "Panama City"),

    # ── US regionals and fractional operators ──
    # These carry a large share of the traffic in this feed and none of
    # them were resolving: EJA alone was 600 aircraft-days.
    "EJA": ("NetJets", "United States of America", "Columbus"),
    "LXJ": ("Flexjet", "United States of America", "Cleveland"),
    "RPA": ("Republic Airways", "United States of America", "Indianapolis"),
    "ENY": ("Envoy Air", "United States of America", "Fort Worth"),
    "EDV": ("Endeavor Air", "United States of America", "Minneapolis"),
    "JIA": ("PSA Airlines", "United States of America", "Dayton"),
    "ASH": ("Mesa Airlines", "United States of America", "Phoenix"),
    "QXE": ("Horizon Air", "United States of America", "Seattle"),
    "GJS": ("GoJet Airlines", "United States of America", "St. Louis"),
    "AWI": ("Air Wisconsin", "United States of America", "Appleton"),

    # ── further Chinese and Asian carriers ──
    "CSZ": ("Shenzhen Airlines", "China", "Shenzhen"),
    "CSC": ("Sichuan Airlines", "China", "Chengdu"),
    "CQH": ("Spring Airlines", "China", "Shanghai"),
    "DKH": ("Juneyao Air", "China", "Shanghai"),
    "CDG": ("Shandong Airlines", "China", "Jinan"),
    "HVN": ("Vietnam Airlines", "Vietnam", "Hanoi"),
    "VJC": ("VietJet Air", "Vietnam", "Ho Chi Minh City"),
    "BKP": ("Bangkok Airways", "Thailand", "Bangkok"),
    "SEJ": ("SpiceJet", "India", "Delhi"),

    # ── further European and other carriers ──
    "EXS": ("Jet2.com", "United Kingdom", "Leeds"),
    "VIR": ("Virgin Atlantic", "United Kingdom", "London"),
    "TOM": ("TUI Airways", "United Kingdom", "Luton"),
    "JZA": ("Jazz Aviation", "Canada", "Halifax"),
    "TSC": ("Air Transat", "Canada", "Montreal"),
    "ROU": ("Air Canada Rouge", "Canada", "Toronto"),
    "LGL": ("Luxair", "Luxembourg", "Luxembourg"),
    "BTI": ("airBaltic", "Latvia", "Riga"),
    "KZR": ("Air Astana", "Kazakhstan", "Almaty"),
    "UZB": ("Uzbekistan Airways", "Uzbekistan", "Tashkent"),
    "RWD": ("RwandAir", "Rwanda", "Kigali"),
    "MAU": ("Air Mauritius", "Mauritius", "Port Louis"),

    # ── freight ──
    # Cargo operators are the ones worth naming on a trade-flow map.
    "GTI": ("Atlas Air", "United States of America", "Cincinnati"),
    "CKS": ("Kalitta Air", "United States of America", "Oscoda"),
    "CLX": ("Cargolux", "Luxembourg", "Luxembourg"),
    "GEC": ("Lufthansa Cargo", "Germany", "Frankfurt"),
    "ABW": ("AirBridgeCargo", "Russia", "Moscow"),
    "AZG": ("Silk Way West Airlines", "Azerbaijan", "Baku"),
}
AIRLINES.pop("UAL_AU", None)

# An airline callsign is three letters then a flight identifier: UAE231,
# RYR4TG, BAW15. A registration — N12345, D-ABCD, G-EUPT — is not one, and
# must not be read as a designator.
_CALLSIGN = re.compile(r"^([A-Z]{3})(\d[A-Z0-9]*)$")


def designator_for_callsign(callsign: str) -> str | None:
    """The ICAO airline designator in a callsign, or None.

    None for a tail number, a blank, or anything else that is not three
    letters followed by a flight identifier.
    """
    m = _CALLSIGN.match(str(callsign or "").strip().upper())
    return m.group(1) if m else None


def operator_for_callsign(callsign: str) -> dict | None:
    """Who operates this flight, or None if it cannot be said.

    Returns {designator, name, country, hub}. None covers both "this is not
    an airline callsign" and "this designator is not in the table" — the
    caller shows the raw callsign in either case, which is the honest
    result and the one that does not invent a connection.
    """
    code = designator_for_callsign(callsign)
    if not code:
        return None
    hit = AIRLINES.get(code)
    if not hit:
        return None
    name, country, hub = hit
    return {"designator": code, "name": name, "country": country, "hub": hub}
