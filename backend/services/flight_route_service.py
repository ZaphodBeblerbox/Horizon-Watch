"""Flight route + aircraft info via hexdb.io (free, no auth required).

hexdb.io endpoints used:
  GET https://hexdb.io/hex-route?hex={icao24}   → plain text "OMDB-EGLL" or ""
  GET https://hexdb.io/hex-type?hex={icao24}    → plain text type code e.g. "A388"
  GET https://hexdb.io/hex-airline?hex={icao24} → plain text airline name
  GET https://hexdb.io/hex-reg?hex={icao24}     → plain text registration

All four requests are fired in parallel (threads). Results cached 30 min per ICAO24.
"""
import logging
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

logger = logging.getLogger(__name__)

_ROUTE_CACHE: dict = {}   # icao24.lower() → {"ts": float, "data": dict}
_CACHE_TTL = 30 * 60      # 30 minutes

# Static lookup for top airports by ICAO code
_AIRPORT_NAMES: dict[str, str] = {
    # Middle East / Gulf
    "OMDB": "Dubai Intl",          "OMAA": "Abu Dhabi Intl",
    "OMSJ": "Sharjah Intl",        "OKBK": "Kuwait Intl",
    "OERK": "Riyadh King Khalid",  "OEJN": "Jeddah King Abdulaziz",
    "OEDF": "Dammam King Fahd",    "ORBI": "Baghdad Intl",
    "ORNI": "Erbil Intl",          "OJAM": "Amman Queen Alia",
    "OLBA": "Beirut Rafic Hariri", "LLBG": "Tel Aviv Ben Gurion",
    "OTHH": "Doha Hamad Intl",     "OBBI": "Bahrain Intl",
    # Europe
    "EGLL": "London Heathrow",     "EGKK": "London Gatwick",
    "EGCC": "Manchester",          "EGPH": "Edinburgh",
    "EGSS": "London Stansted",     "EGGW": "London Luton",
    "EHAM": "Amsterdam Schiphol",  "LFPG": "Paris CDG",
    "LFPO": "Paris Orly",          "EDDF": "Frankfurt",
    "EDDM": "Munich",              "EDDL": "Düsseldorf",
    "EDDB": "Berlin Brandenburg",  "LEMD": "Madrid Barajas",
    "LEBL": "Barcelona El Prat",   "LIRF": "Rome Fiumicino",
    "LIMC": "Milan Malpensa",      "LSZH": "Zurich",
    "LSGG": "Geneva",              "LOWW": "Vienna Schwechat",
    "EPWA": "Warsaw Chopin",       "EKCH": "Copenhagen Kastrup",
    "ENGM": "Oslo Gardermoen",     "ESSA": "Stockholm Arlanda",
    "EFHK": "Helsinki Vantaa",     "LROP": "Bucharest Henri Coandă",
    "LGAV": "Athens Eleftherios Venizelos",
    "LCLK": "Larnaca Intl",        "LPPT": "Lisbon Humberto Delgado",
    "EIDW": "Dublin Intl",         "LTFM": "Istanbul New",
    "LTBA": "Istanbul Atatürk",    "UUEE": "Moscow Sheremetyevo",
    "UUDD": "Moscow Domodedovo",
    # Asia-Pacific
    "VHHH": "Hong Kong Intl",      "WSSS": "Singapore Changi",
    "WMKK": "Kuala Lumpur KLIA",   "VTBS": "Bangkok Suvarnabhumi",
    "VTBD": "Bangkok Don Mueang",  "RJTT": "Tokyo Haneda",
    "RJAA": "Tokyo Narita",        "RKSI": "Seoul Incheon",
    "ZBAA": "Beijing Capital",     "ZBAD": "Beijing Daxing",
    "ZSPD": "Shanghai Pudong",     "ZSSS": "Shanghai Hongqiao",
    "ZGGG": "Guangzhou Baiyun",    "ZGSZ": "Shenzhen Bao'an",
    "VABB": "Mumbai Chhatrapati Shivaji",
    "VIDP": "Delhi Indira Gandhi", "VOCI": "Kochi Intl",
    "VCBI": "Colombo Bandaranaike","YSSY": "Sydney Kingsford Smith",
    "YMML": "Melbourne",           "YBBN": "Brisbane",
    "YPPH": "Perth",               "NZAA": "Auckland",
    "RCTP": "Taipei Taoyuan",      "RPLL": "Manila Ninoy Aquino",
    "WIII": "Jakarta Soekarno-Hatta",
    # Africa
    "FAOR": "Johannesburg OR Tambo",
    "FALE": "Durban King Shaka",   "FACT": "Cape Town Intl",
    "HAAB": "Addis Ababa Bole",    "HKJK": "Nairobi JKIA",
    "DNMM": "Lagos Murtala Muhammed",
    "DTTA": "Tunis-Carthage",      "GMME": "Rabat-Salé",
    "GMMN": "Casablanca Mohamed V","DAAG": "Algiers Houari Boumediene",
    "HECA": "Cairo Intl",          "HSSS": "Khartoum Intl",
    # Americas
    "KJFK": "New York JFK",        "KLGA": "New York LaGuardia",
    "KEWR": "New York Newark",     "KBOS": "Boston Logan",
    "KPHL": "Philadelphia Intl",   "KATL": "Atlanta Hartsfield",
    "KMIA": "Miami Intl",          "KMCO": "Orlando Intl",
    "KORD": "Chicago O'Hare",      "KMDW": "Chicago Midway",
    "KDFW": "Dallas/Fort Worth",   "KIAH": "Houston George Bush",
    "KDEN": "Denver Intl",         "KPHX": "Phoenix Sky Harbor",
    "KLAX": "Los Angeles Intl",    "KSFO": "San Francisco Intl",
    "KSEA": "Seattle-Tacoma",      "KLAS": "Las Vegas Harry Reid",
    "KCLT": "Charlotte Douglas",   "KDTW": "Detroit Metro",
    "CYYZ": "Toronto Pearson",     "CYVR": "Vancouver Intl",
    "CYUL": "Montréal Trudeau",    "MMMX": "Mexico City NAICM",
    "SBGR": "São Paulo Guarulhos", "SBBR": "Brasília Intl",
    "SAEZ": "Buenos Aires Ezeiza", "SKBO": "Bogotá El Dorado",
    "SEQM": "Quito Mariscal Sucre","MPTO": "Panama City Tocumen",
}


def _airport_name(icao: Optional[str]) -> Optional[str]:
    if not icao:
        return None
    return _AIRPORT_NAMES.get(icao.upper())


def _hexdb_get(endpoint: str, icao: str) -> str:
    """Fetch a single hexdb.io plain-text endpoint. Returns stripped text or ""."""
    url = f"https://hexdb.io/{endpoint}?hex={icao}"
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent": "HorizonWatch/1.0"}
        )
        with urllib.request.urlopen(req, timeout=6) as resp:
            status = resp.status
            body   = resp.read().decode("utf-8", errors="replace").strip()
            print(f"[hexdb/{endpoint}] {icao} → HTTP {status}  text={body!r}")
            return body if status == 200 else ""
    except urllib.error.HTTPError as exc:
        logger.exception("flight_route_service._hexdb_get: HTTP error from hexdb.io")
        print(f"[hexdb/{endpoint}] {icao} → HTTP {exc.code}")
        return ""
    except Exception as exc:
        logger.exception("flight_route_service._hexdb_get: request failed")
        print(f"[hexdb/{endpoint}] {icao} → error: {exc}")
        return ""


def get_route(icao24: str, callsign: Optional[str] = None) -> dict:
    """Return route + aircraft info for the given ICAO24 from hexdb.io.

    Args:
        icao24:   Hex mode-S transponder address (e.g. "A6EDD6")
        callsign: Accepted for backward compat but not used (hexdb is ICAO-based)

    Returns:
        {
            "departure":        "OMDB" | None,
            "destination":      "EGLL" | None,
            "departure_name":   "Dubai Intl" | None,
            "destination_name": "London Heathrow" | None,
            "aircraft_type":    "A388" | None,
            "airline":          "Emirates" | None,
            "registration":     "A6-EOA" | None,
        }
    """
    key = icao24.lower().strip()
    print(f"[route] get_route: icao24={key!r} callsign={callsign!r}")
    if not key:
        return _empty_route()

    # Cache check
    cached = _ROUTE_CACHE.get(key)
    if cached and (time.time() - cached["ts"]) < _CACHE_TTL:
        print(f"[route] cache HIT for {key}")
        return cached["data"]
    print(f"[route] cache MISS for {key} — querying hexdb.io")

    # Fire all four hexdb requests in parallel
    endpoints = ["hex-route", "hex-type", "hex-airline", "hex-reg"]
    results = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(_hexdb_get, ep, key): ep for ep in endpoints}
        for future in as_completed(futures):
            ep = futures[future]
            try:
                results[ep] = future.result()
            except Exception as exc:
                print(f"[route] future error for {ep}: {exc}")
                results[ep] = ""

    # Parse route: "OMDB-EGLL" → dep, dst
    route_text   = results.get("hex-route", "")
    # hex-type returns e.g. "A319 112" — take first token as the ICAO type code
    _type_raw    = results.get("hex-type", "").strip()
    type_text    = _type_raw.split()[0] if _type_raw else None
    airline_text = results.get("hex-airline", "").strip() or None
    reg_text     = results.get("hex-reg",     "").strip() or None

    dep = dst = None
    if route_text and "-" in route_text:
        parts = route_text.split("-", 1)
        dep   = parts[0].strip().upper() or None
        dst   = parts[1].strip().upper() or None

    result = {
        "departure":        dep,
        "destination":      dst,
        "departure_name":   _airport_name(dep),
        "destination_name": _airport_name(dst),
        "aircraft_type":    type_text,
        "airline":          airline_text,
        "registration":     reg_text,
    }
    print(f"[route] FINAL for {key}: dep={dep} dst={dst} type={type_text} airline={airline_text} reg={reg_text}")
    _ROUTE_CACHE[key] = {"ts": time.time(), "data": result}
    return result


def _empty_route() -> dict:
    return {
        "departure": None, "destination": None,
        "departure_name": None, "destination_name": None,
        "aircraft_type": None, "airline": None, "registration": None,
    }
