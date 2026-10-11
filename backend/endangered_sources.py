"""
endangered_sources.py — endangered places OUTSIDE France: the same layer as
endangered_places.py (the gilets jaunes' map and the Framacarte arms map),
fed from public sources in other countries. Research, verified endpoints and
privacy notes: docs/research/endangered_places_sources.md (2026-10-11).

Each source is an adapter that turns one public endpoint into places of the
same shape as the French ones — {name, kind, country, lat, lon, calls:
[{kind, label_en, level, date, time, source_url, ...}], source, credit} —
the status and colour derived on read by endangered_places.annotate.

SOURCES, in the order they were built (all read only, plain GET):
  1  Polizei Berlin — notified assemblies (JSON; addresses geocoded)    hourly
  2  Italy MIT — proclaimed transport strikes (RSS; province/region)   hourly
  3  uMap / Framacarte target maps (any instance) + weekly discovery    daily
  4  CAAT "Who arms Israel" (UK; JSON inside the page)                  daily
  5  Dresden — notified assemblies (JSON; places geocoded)              hourly
  6  Extinction Rebellion UK events map (JSONP; actions only)           3 h
  7  Demosphere (Brussels, Liège, Frankfurt, Würzburg; .ics) and
     Gancio (Madrid, Barcelona, Catalonia, Bonn, Rhein-Main, Bologna;
     /api/events) — actions only, by keywords in their language        3 h
NOT INGESTED: Palestine Action material (proscribed in the UK), ACLED
(licence), Mobilize (US) and GDELT (not now).

LEVELS: an official notice (notified assembly, proclaimed strike) is
"announced" — medium; high only for a blockade, or a rail / port / freight /
road / general strike (supply). An activist calendar's call is "called" —
medium, high for an explicit blockade, low for a vigil. A target list (uMap,
CAAT) is "listed": no call, grey, "listed by <map> as a target for action".

PRIVACY (hard rule): fields are WHITELISTED, never blacklisted. Not kept:
organiser names (Dresden Veranstalter, XR `who`, uMap owners/editors, Gancio
ap_user), emails, phones (uMap "Numero di telefono"), registration links (XR
custom.registration_link), descriptions and notes, tags. The free text that
is kept (a topic, a title) goes through scrub(): no e-mail, phone, URL or
@handle, no "Herr/Frau/Mr/Mme … Name".

POLITENESS: each source on its own cadence, conditional GETs, one second
between requests to the same host, a User-Agent with a contact URL (never a
person's address). A source that fails, disappears or comes back empty never
replaces the last good copy (snapshots in DATA_DIR/endangered_places/).
Geocoding: Nominatim, one request a second shared with geocode_utils, cached
on disk (misses too, retried after 14 days), a budget per run.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import html as _html
import json
import os
import re
import threading
import time
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

import endangered_places as ep

USER_AGENT = ep.USER_AGENT
NOMINATIM = "https://nominatim.openstreetmap.org/search"
GEOCODE_BUDGET = int(os.getenv("ENDANGERED_GEOCODE_BUDGET", "120") or 120)
GEOCODE_MISS_RETRY_S = 14 * 86400
HORIZON_DAYS = 45            # dated calls further out than this are not kept
KEEP_PAST_DAYS = 1           # a call is kept a day after it ended ("past")
HOST_GAP_S = 1.0             # between two requests to the same host

# ── countries ────────────────────────────────────────────────────────────

COUNTRY_NAMES = {
    "FR": "France", "DE": "Germany", "IT": "Italy", "GB": "United Kingdom", "BE": "Belgium", "ES": "Spain",
    "NL": "Netherlands", "CH": "Switzerland", "AT": "Austria", "PL": "Poland", "PT": "Portugal", "IE": "Ireland",
    "LU": "Luxembourg", "DK": "Denmark", "SE": "Sweden", "NO": "Norway", "FI": "Finland", "CZ": "Czechia",
    "SI": "Slovenia", "HR": "Croatia", "GR": "Greece", "US": "United States", "CA": "Canada",
}


def country_name(cc: str | None) -> str | None:
    if not cc:
        return None
    cc = cc.upper()
    if cc in COUNTRY_NAMES:
        return COUNTRY_NAMES[cc]
    try:
        from location_extract import country_name_from_code
        return country_name_from_code(cc) or cc
    except Exception:                                          # noqa: BLE001
        return cc


def country_of_point(lat: float, lon: float) -> str | None:
    """ISO2 of the country holding the point (Natural Earth polygons)."""
    try:
        import geo_land
        from location_extract import country_code_from_name
        n = geo_land.country_at(lat, lon)
        if not n:
            return None
        by_name = {v.lower(): k for k, v in COUNTRY_NAMES.items()}
        if n.lower() in by_name:
            return by_name[n.lower()]
        code = country_code_from_name(n)
        if not code:
            from location_extract import _iso_names
            code = next((k for k, v in _iso_names().items() if str(v).lower() == n.lower() and len(k) == 2), None)
        return code.upper() if code else None
    except Exception:                                          # noqa: BLE001
        return None


# ── privacy: whitelisted, scrubbed text ──────────────────────────────────

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_URL = re.compile(r"(?:https?://|www\.)\S+", re.I)
_HANDLE = re.compile(r"(?<![\w.])@\w{2,}")
_PHONE = re.compile(r"(?<!\d)(?:\+|00)?\d[\d \-./()]{7,}\d(?!\d)")
_TITLE_NAME = re.compile(
    r"\b(?:Herr|Frau|Hr\.|Fr\.|Mr\.?|Mrs\.?|Ms\.?|Mme\.?|Mlle\.?|M\.|Sig\.(?:ra)?|Sr\.|Sra\.|Dr\.|Prof\.)"
    r"\s+(?:[A-ZÄÖÜÀ-Ý][\w'’\-]+\.?\s*){1,3}")


def scrub(text, cap: int = 180) -> str | None:
    """Free text safe to keep: no e-mail, URL, @handle or phone number, no
    "Herr Max Mustermann"-style name; whitespace folded; capped."""
    s = _html.unescape(str(text or ""))
    s = re.sub(r"<[^>]+>", " ", s)
    s = _EMAIL.sub("", s)
    s = _URL.sub("", s)
    s = _HANDLE.sub("", s)
    s = _PHONE.sub(lambda m: "" if len(re.sub(r"\D", "", m.group(0))) >= 9 else m.group(0), s)
    s = _TITLE_NAME.sub("", s)
    s = re.sub(r"\(\s*[,;:]?\s*\)", "", s)
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"\s+([,;:.!?])", r"\1", s)
    s = re.sub(r"([,;:])(?:\s*[,;:])+", r"\1", s).strip(" ,;:-–")
    if len(s) > cap:
        s = s[:cap - 1].rsplit(" ", 1)[0] + "…"
    return s or None


def _fold(text) -> str:
    """Lowercase, accents off, fancy letters (𝐒𝐚𝐥𝐚) to plain — for keywords."""
    s = unicodedata.normalize("NFKC", str(text or ""))
    s = unicodedata.normalize("NFKD", s)
    return "".join(ch for ch in s if not unicodedata.combining(ch)).lower()


# ── what a call is, from words in its own language ──────────────────────

def _rx(words: str) -> re.Pattern:
    return re.compile(r"(?<![a-z])(?:" + words + r")(?![a-z])")


KW_BLOCK = _rx(r"blockade\w*|blockier\w*|sitzblockade\w*|blocage\w*|bloquons|bloquer|bloqueo\w*|bloquea\w*|"
               r"blocco|blocchi\w*|bloqueig\w*|bloquegem|shut\s?(?:it\s)?down|lock[- ]on|swarm\w*|"
               r"blocchiamo\s+tutto|tanquem")
KW_STRIKE = _rx(r"streik\w*|warnstreik\w*|greve\w*|huelga\w*|sciopero|scioperi|vaga general|"
                r"piquete\w*|picchett\w*|piquet\w*")
KW_STRIKE_EN = _rx(r"strike\w*|walk-?out|picket\w*")     # English only where English is spoken ("Strike" is a play in Frankfurt)
KW_OCCUPY = _rx(r"besetz\w*|occupation\w*|occupazione|okupa\w*|ocupacio\w*|acampada|campement")
KW_MARCH = _rx(r"demo|demos|demonstration\w*|manifestation\w*|manif|manifestacion\w*|mani|manifestazione|"
               r"manifestacio|corteo|marche|marcha|marxa|march|marches|aufzug|umzug|velodemo|fahrraddemo")
KW_RALLY = _rx(r"kundgebung\w*|rassemblement\w*|concentracion\w*|concentracio|presidio|rally|protest\w*|protesta|"
               r"mobilitazione|mobilisation|mobilizacion|cacerolada|die-in|chaine humaine|menschenkette|human chain|"
               r"aktionstag|journee d.action|giornata di lotta")
KW_VIGIL = _rx(r"mahnwache\w*|vigil\w*|veglia|veillee|vigilia")
KW_NOT_ACTION = _rx(r"vortrag|lesung|buchvorstellung|film\w*|kino|konzert\w*|concert\w*|party|soliparty|workshop\w*|"
                    r"atelier\w*|taller\w*|charla|conferenc\w*|conferenza|presentazione|presentacion|rencontre\w*|"
                    r"meeting\w*|cafe|stammtisch|spieleabend|karaoke|yoga|cine|cinema|cineforum|festa|fiesta|fete|"
                    r"expo|exposition|exposicio|mostra|quiz|brunch|dinner|cena|pranzo|repas|kufa|voku|practice|"
                    r"rehearsal|training|formation|plenum|assemblea\w*|asamblea\w*|assemblee|arpentage|clases?|"
                    r"curs|corso|kurs|lecture|talk|drumm\w*|samba|dj|open mic|book|libro|livre|reading|bildung|"
                    r"diskussion|podium\w*|seminar\w*|webinar|theater|theatre|teatro|produktionshaus")
# what makes a site matter for supply (a high call there notifies by itself)
KW_SUPPLY = _rx(r"hafen|port|porto|puerto|harbou?r|docks?|terminal|raffinerie\w*|refiner\w*|raffineria|refineria|"
                r"depot|tanklager|deposito|oil|ol|petrol\w*|carburant\w*|treibstoff|bahn\w*|rail\w*|ferrovi\w*|"
                r"gare de triage|ferrocarril|autobahn|autostrada|motorway|highway|logisti\w*|interporto|"
                r"rheinmetall|leonardo|elbit|thales|safran|kndt?|knds|hensoldt|mbda|bae systems|airbus defence|"
                r"rwm|diehl|heckler|fincantieri|navantia|indra")

ACTION_LABEL = {
    "blockade": ("Blockade", "high"),
    "strike": ("Strike action", "medium"),
    "occupation": ("Occupation", "medium"),
    "march": ("March / demonstration", "medium"),
    "rally": ("Rally", "medium"),
    "vigil": ("Vigil", "low"),
    "action": ("Action (unspecified)", "medium"),
}


def classify_action(title: str, extra: str = "", default: str | None = None, lang: str = "") -> str | None:
    """The kind of a calendar event if it is an action (blockade, strike,
    occupation, march, rally, vigil), else None (a talk, a film, a meeting).
    `default` is the kind when nothing matches but the source already says
    it is an action (XR's action sub-calendars)."""
    t = _fold(title)
    blob = t + " " + _fold(extra)
    if KW_BLOCK.search(blob):
        return "blockade"
    strong = None
    rules = (("strike", KW_STRIKE), ("strike", KW_STRIKE_EN if lang == "en" else None),
             ("occupation", KW_OCCUPY), ("march", KW_MARCH))
    for kind, rx in rules:
        if rx is not None and rx.search(blob):
            strong = kind
            break
    if KW_NOT_ACTION.search(blob) and not (strong and rx.search(t)):
        return None
    if strong:
        return strong
    if KW_RALLY.search(blob):
        return "rally"
    if KW_VIGIL.search(blob):
        return "vigil"
    return default


# German compounds: Westhafen, Güterbahnhof, Rüstungswerk
KW_SUPPLY_DE = re.compile(r"hafen|raffinerie|tanklager|bahnhof|guterbahn|rustungs\w*|waffenfabrik|munitionsfabrik")


def is_supply(text: str) -> bool:
    t = _fold(text)
    return bool(KW_SUPPLY.search(t) or KW_SUPPLY_DE.search(t))


# ── calls ────────────────────────────────────────────────────────────────

def mk_call(kind: str, label: str, level: str, date: str, *, time_=None, end_date=None, end_time=None,
            verb: str = "called", basis: str = "called", source_url: str | None = None, tz: str | None = None,
            topic: str | None = None, supply: bool = False, **extra) -> dict:
    c = {"kind": kind, "label_en": label, "level": level, "basis": basis, "verb": verb, "date": date,
         "time": time_ if time_ and re.fullmatch(r"\d{2}:\d{2}", time_) and time_ != "00:00" else None,
        "source_url": source_url}
    if end_date and end_date != date:
        c["end_date"] = end_date
    if end_time and re.fullmatch(r"\d{2}:\d{2}", end_time) and end_time not in ("00:00", "23:59", c["time"]):
        c["end_time"] = end_time
    if tz and tz != ep.TZ:
        c["tz"] = tz
    if topic:
        c["topic"] = topic
    if supply:
        c["supply"] = True
    for k, v in extra.items():
        if v not in (None, "", [], {}):
            c[k] = v
    return c


def _hhmm(s) -> str | None:
    m = re.search(r"(\d{1,2})[.:h](\d{2})", str(s or ""))
    if not m:
        return None
    h, mi = int(m.group(1)), int(m.group(2))
    return f"{h:02d}:{mi:02d}" if h < 24 and mi < 60 else None


def _local(ts_utc: _dt.datetime, tz: str) -> tuple[str, str]:
    from zoneinfo import ZoneInfo
    d = ts_utc.astimezone(ZoneInfo(tz))
    return d.date().isoformat(), d.strftime("%H:%M")


def _sid(*parts) -> str:
    return hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()[:12]


def _norm_key(s) -> str:
    return re.sub(r"[^a-z0-9]+", " ", _fold(s)).strip()


# ── 1. Polizei Berlin — notified assemblies ─────────────────────────────

BERLIN_URL = ("https://www.berlin.de/polizei/service/versammlungsbehoerde/versammlungen-aufzuege/"
              "index.php/index/all.json?q=")
BERLIN_PAGE = "https://www.berlin.de/polizei/service/versammlungsbehoerde/versammlungen-aufzuege/"
BERLIN_BOX = (13.08, 52.33, 13.77, 52.68)           # min lon, min lat, max lon, max lat
BERLIN_CENTRE = (52.52, 13.405)


def parse_berlin(body: bytes) -> list[dict]:
    """{index: [{id, datum "DD.MM.YYYY", von, bis, thema, plz, strasse_nr,
    aufzugsstrecke}]} → one place per address, one call per assembly.
    Only datum, von, bis, a scrubbed thema, plz, strasse_nr and the route's
    street list are read."""
    d = json.loads(body.decode("utf-8"))
    rows = d.get("index") if isinstance(d, dict) else None
    if not isinstance(rows, list):
        raise ValueError("no index list")
    places: dict[str, dict] = {}
    for r in rows:
        if not isinstance(r, dict):
            continue
        try:
            day = _dt.datetime.strptime(str(r.get("datum") or ""), "%d.%m.%Y").date().isoformat()
        except ValueError:
            continue
        street = re.sub(r"\s+", " ", str(r.get("strasse_nr") or "")).strip()
        plz = re.sub(r"\D", "", str(r.get("plz") or ""))[:5]
        if not street and not plz:
            continue
        topic_raw = re.sub(r"\(\s*vom\b[^)]*\)", "", str(r.get("thema") or ""), flags=re.I)
        topic = scrub(topic_raw, 160)
        route = scrub(r.get("aufzugsstrecke"), 220)
        blob = f"{topic or ''} {route or ''}"
        if KW_BLOCK.search(_fold(topic or "")):
            kind, label, level = "blockade", "Blockade (notified assembly)", "high"
        elif route:
            kind, label, level = "march", "Notified march", "medium"
        else:
            kind, label, level = "assembly", "Notified assembly", "medium"
        pkey = f"{plz}|{_norm_key(street)}"
        p = places.get(pkey)
        if p is None:
            name = street or f"PLZ {plz}"
            p = places[pkey] = {
                "sid": _sid(pkey), "name": f"{name}, Berlin", "kind": "assembly", "city": "Berlin", "postcode": plz or None,
                "address": f"{street}, {plz} Berlin".strip(", "), "country": "DE", "near_km": 5.0,
                "geo": {"qs": [f"{street}, {plz} Berlin", f"{street}, Berlin"] if street else [f"{plz} Berlin"],
                        "cc": "de", "box": BERLIN_BOX},
                "calls": [],
            }
        p["calls"].append(mk_call(
            kind, label, level, day, time_=None if r.get("von") in ("00:00", None) else _hhmm(r.get("von")),
            end_time=_hhmm(r.get("bis")), verb="notified", basis="announced", source_url=BERLIN_PAGE,
            topic=topic, route=route, supply=(level == "high" and is_supply(blob))))
    return list(places.values())


# ── 2. Italy, MIT — proclaimed transport strikes ────────────────────────

MIT_URL = "https://scioperi.mit.gov.it/mit2/public/scioperi/rss"
MIT_PAGE = "https://scioperi.mit.gov.it/mit2/public/scioperi"
IT_REGIONS = {
    "abruzzo": (42.23, 13.85), "basilicata": (40.64, 16.08), "calabria": (39.06, 16.52), "campania": (40.86, 14.84),
    "emilia romagna": (44.53, 11.03), "friuli venezia giulia": (46.07, 13.08), "lazio": (41.98, 12.77),
    "liguria": (44.32, 8.70), "lombardia": (45.62, 9.77), "marche": (43.35, 13.14), "molise": (41.67, 14.55),
    "piemonte": (45.07, 7.92), "puglia": (40.98, 16.62), "sardegna": (40.06, 9.03), "sicilia": (37.58, 14.15),
    "toscana": (43.45, 11.13), "trentino alto adige": (46.43, 11.17), "umbria": (42.96, 12.49),
    "valle d aosta": (45.74, 7.32), "veneto": (45.66, 11.85),
}
ITALY = (42.5, 12.6)
# sector → (label, level). High: a strike that stops goods moving.
MIT_SECTORS = {
    "ferroviario": ("Rail strike", "high"),
    "trasporto merci": ("Freight transport strike", "high"),
    "autotrasporto merci": ("Road haulage strike", "high"),
    "marittimo": ("Maritime and port strike", "high"),
    "porti": ("Port strike", "high"),
    "portuale": ("Port strike", "high"),
    "circolazione e sicurezza stradale": ("Road network staff strike", "high"),
    "autostrade": ("Motorway staff strike", "high"),
    "generale": ("General strike", "high"),
    "plurisettoriale": ("Multi-sector transport strike", "medium"),
    "trasporto pubblico locale": ("Local public transport strike", "medium"),
    "aereo": ("Air transport strike", "medium"),
}
_MIT_SUPPLY_WORDS = re.compile(r"\bferrov|\bmerci\b|\bport(?:o|i|uale|uali)\b|marittim|autostrad|logistic", re.I)


def _it_region(name: str) -> tuple[str, tuple] | None:
    k = _norm_key(name).replace("-", " ")
    k = {"valle daosta": "valle d aosta", "trentino alto adige sudtirol": "trentino alto adige"}.get(k, k)
    return (k, IT_REGIONS[k]) if k in IT_REGIONS else None


def parse_mit(body: bytes) -> list[dict]:
    """RSS items: title "Data inizio: … - Settore: … - Rilevanza: … - Regione:
    … - Provincia: …", description lines (modalità, Data fine, Settore,
    Rilevanza, Regione, Provincia, Sindacati, Categoria interessata, Data
    proclamazione). One place per province, region or "Italy (nationwide)"."""
    root = ET.fromstring(body)
    places: dict[str, dict] = {}
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        desc = it.findtext("description") or ""
        guid = (it.findtext("guid") or "").strip()
        f = {}
        for line in re.split(r"<br\s*/?>", desc):
            if ":" in line:
                k, v = line.split(":", 1)
                f[_norm_key(k)] = re.sub(r"\s+", " ", _html.unescape(v)).strip()
        m = re.search(r"Data inizio:\s*(\d{2}/\d{2}/\d{4})", title)
        if not m:
            continue
        start = _dt.datetime.strptime(m.group(1), "%d/%m/%Y").date().isoformat()
        try:
            end = _dt.datetime.strptime(f.get("data fine", ""), "%d/%m/%Y").date().isoformat()
        except ValueError:
            end = start
        sector = f.get("settore") or (re.search(r"Settore:\s*([^-]+)", title) or [None, ""])[1].strip()
        scope = f.get("rilevanza") or ""
        region = (f.get("regione") or "").strip()
        prov = (f.get("provincia") or "").strip()
        mode = f.get("modalita") or ""
        affected = scrub(f.get("categoria interessata"), 140)
        unions = scrub(f.get("sindacati"), 120)
        label, level = MIT_SECTORS.get(_norm_key(sector), (f"{sector.capitalize()} strike" if sector else "Strike", "medium"))
        if level != "high" and _norm_key(sector) not in ("trasporto pubblico locale", "aereo") \
                and _MIT_SUPPLY_WORDS.search(f"{mode} {affected or ''}"):
            level = "high"
        reg = _it_region(region)
        national = reg is None
        if prov and prov.lower() != "tutte" and reg:
            pkey, name, reach = f"prov:{_norm_key(prov)}", f"{prov} (province)", 35.0
            geo = {"qs": [f"{prov}, {region}, Italia"], "cc": "it", "fallback": list(reg[1])}
        elif reg:
            pkey, name, reach = f"reg:{reg[0]}", f"{region} (region)", 140.0
            geo = None
        else:
            pkey, name, reach = "IT", "Italy (nationwide)", 650.0
            geo = None
        p = places.get(pkey)
        if p is None:
            lat, lon = (reg[1] if (reg and pkey.startswith("reg:")) else ITALY) if geo is None else (None, None)
            p = places[pkey] = {
                "sid": pkey, "name": name, "kind": "strike", "city": None if pkey == "IT" else (prov or region),
                "region": None if pkey == "IT" else region, "country": "IT", "lat": lat, "lon": lon,
                "reach_km": reach, "near_km": reach, "calls": [],
            }
            if geo:
                p["geo"] = geo
        hours = scrub(mode.lower(), 160)
        p["calls"].append(mk_call(
            "strike_" + (_norm_key(sector).replace(" ", "_") or "other"), label, level, start, time_=_hhmm(mode),
            end_date=end, verb="proclaimed", basis="announced",
            source_url=MIT_PAGE + (f"#{guid.rsplit('/', 1)[-1]}" if guid else ""),
            topic=affected, supply=(level == "high"), hours=hours, unions=unions,
            scope=("nationwide" if national else scope.lower() or None), sector=sector or None))
    return list(places.values())


# ── 3. uMap / Framacarte target maps ────────────────────────────────────

# Seeds: the maps named in the research (the French 213599 has its own
# adapter in endangered_places.py and is not read twice).
UMAP_SEEDS = [
    {"host": "framacarte.org", "id": 173229, "country": "FR", "kind": "arms_company"},
    {"host": "umap.openstreetmap.fr", "id": 1263116, "country": "BE", "kind": "lobby_office"},
    {"host": "umap.openstreetmap.fr", "id": 1096412, "country": "IT", "kind": "arms_company"},
    {"host": "umap.openstreetmap.fr", "id": 1418035, "country": "IT", "kind": "arms_company"},
]
UMAP_HOSTS = ("umap.openstreetmap.fr", "framacarte.org", "umap.openstreetmap.de")
UMAP_SKIP = {("framacarte.org", ep.FC_MAP_ID)}
UMAP_MAX_FEATURES = 3000
UMAP_MAX_DISCOVERED = 25
# Only these properties are ever read from a uMap feature.
UMAP_NAME_KEYS = ("name", "Name", "NAME", "nom", "Nom", "NOM", "Nome", "nome", "Nome dell'azienda", "Azienda",
                  "azienda", "Entreprise", "entreprise", "Firma", "firma", "Unternehmen", "company", "Company",
                  "titre", "title", "Titel")
UMAP_OPERATOR_KEYS = ("Entreprise", "entreprise", "Groupe", "Gruppo", "Konzern", "operator")
UMAP_ADDR_KEYS = ("address", "Address", "adresse", "Adresse", "ADRESSE", "Indirizzo", "indirizzo", "Anschrift",
                  "direccion", "Dirección")
UMAP_CITY_KEYS = ("city", "City", "Comune", "comune", "Ville", "ville", "commune", "Commune", "Stadt", "Ort",
                  "ciudad", "Ciudad")
UMAP_PC_KEYS = ("postcode", "Postcode", "CAP", "cap", "PLZ", "plz", "code_postal", "cp")

DISCOVERY_TERMS = ("armement", "industrie d'armement", "Stop Arming Israel", "Rüstung", "Rüstungsindustrie",
                   "armi", "fabbrica della guerra", "industria bellica", "guerra", "arms industry", "arms trade",
                   "Israel", "complici", "blocage", "blocchiamo", "Blockade", "embargo")
# a map's title must say it is a list of arms / war-economy sites or a call to block
_D_ARMS = re.compile(r"\b[dl]?arm(?:es|ement|ements|i|s|ing)\b|rustung|ruestung|waffen|weapon|militar|bellic|guerra|war\b|"
                     r"drone|defen[cs]e|difesa|defensa|munition", re.I)
_D_SITES = re.compile(r"industr|fabbrica|filiera|aziend|entreprise|firm|compan|lobby|complic|suppl|site|usine|"
                      r"fabrik|werk|standort|empresa|fabric", re.I)
_D_CALL = re.compile(r"stop.?arming|who.?arms|embargo|complici|blocchiamo|blocage|bloquons|blockade|disarm|"
                     r"entwaffn|rheinmetall", re.I)
_D_EXCLUDE = re.compile(r"mondial|world.?war|ww[12i]|wwii|19[0-4]\d|cimiter|cemeter|friedhof|museum|museo|musee|"
                        r"itinerar|tour\b|forti?\b|forts?\b|bunker|histor|storia|ancient|antic|stand.?de.?tir|"
                        r"chasse|hunting|rfn|ferre|voies|peloponn|prigionier|esodo|caccia|tiro|schiess", re.I)


CALL_MAP_FRESH_DAYS = 60        # a blockade / embargo map not edited since: an old event
LIST_MAP_FRESH_DAYS = 3 * 365   # an arms-site list ages slowly


def classify_map(title: str, year: int | None = None) -> tuple[bool, str]:
    """Is a discovered map a list of targets (arms / war-economy sites, or a
    call to block)? Strict on purpose — "guerra" finds war cemeteries, and
    "blocage" finds the 2018 gilets jaunes' maps."""
    t = _fold(title).replace("-", " ")
    if _D_EXCLUDE.search(t):
        return False, "historical / unrelated"
    year = year or _dt.date.today().year
    if any(2000 <= int(y) < year for y in re.findall(r"(20[0-4]\d)", t)):
        return False, "a past year in its title"
    if _D_CALL.search(t):
        return True, "a call in its title"
    if _D_ARMS.search(t) and _D_SITES.search(t):
        return True, "arms / war-economy sites in its title"
    return False, "not a target list"


def parse_umap_search(body: bytes, host: str) -> list[tuple[int, str]]:
    """(map id, slug) for each map a uMap search page links to."""
    s = body.decode("utf-8", "replace")
    out, seen = [], set()
    for m in re.finditer(r'/map/([a-z0-9-]+)_(\d+)', s):
        mid = int(m.group(2))
        if mid not in seen:
            seen.add(mid)
            out.append((mid, m.group(1)))
    return out


def umap_layers(meta_body: bytes) -> tuple[str, list[tuple[str, str]], dict]:
    """(map name, [(layer id, layer name)], {licence}) from /map/<id>/geojson/.
    Owner and editor names in `permissions` are never read."""
    m = json.loads(meta_body.decode("utf-8"))
    props = m.get("properties") or {}
    name = scrub(props.get("name"), 120) or "uMap map"
    layers = []
    for dl in props.get("datalayers") or []:
        pk = dl.get("id") or (dl.get("properties") or {}).get("id")
        lname = scrub((dl.get("properties") or {}).get("name") or dl.get("name"), 80) or "Layer"
        if pk:
            layers.append((str(pk), lname))
    lic = props.get("licence")
    lic = {"name": scrub(lic.get("name"), 60), "url": lic.get("url")} if isinstance(lic, dict) and lic.get("name") else {}
    if isinstance(props.get("modified_at"), str):
        lic["modified_at"] = props["modified_at"][:10]
    return name, layers, lic


def _first(p: dict, keys) -> str | None:
    for k in keys:
        v = p.get(k)
        if isinstance(v, (str, int, float)) and str(v).strip():
            return str(v)
    return None


def parse_umap_layer(body: bytes, layer_name: str) -> list[dict]:
    """Point features → whitelisted {name, operator, address, city, postcode,
    lat, lon}. Phones, descriptions, editors, styles: never read."""
    d = json.loads(body.decode("utf-8"))
    out = []
    for f in (d.get("features") or [])[:UMAP_MAX_FEATURES]:
        g = f.get("geometry") or {}
        if g.get("type") != "Point":
            continue
        try:
            lon, lat = float(g["coordinates"][0]), float(g["coordinates"][1])
        except (KeyError, IndexError, TypeError, ValueError):
            continue
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        p = f.get("properties") or {}
        name = scrub(_first(p, UMAP_NAME_KEYS), 120)
        if not name:
            continue
        addr = _first(p, UMAP_ADDR_KEYS)
        if not addr and p.get("street"):
            addr = f"{p.get('street')} {p.get('housenumber') or ''}".strip()
        city = scrub(_first(p, UMAP_CITY_KEYS), 60)
        op = scrub(_first(p, UMAP_OPERATOR_KEYS), 60)
        out.append({"name": name, "operator": op if op and _norm_key(op) != _norm_key(name) else None,
                    "address": scrub(addr, 140), "city": city, "postcode": scrub(_first(p, UMAP_PC_KEYS), 12),
                    "lat": round(lat, 5), "lon": round(lon, 5), "layer": layer_name})
    return out


def umap_places(features: list[dict], cfg: dict, map_name: str, url: str) -> list[dict]:
    kind = cfg.get("kind") or "arms_company"
    seen: dict[tuple, dict] = {}
    for x in features:
        key = (_norm_key(x["name"]), round(x["lat"], 3), round(x["lon"], 3))
        if key in seen:
            if x["layer"] not in seen[key]["lists"]:
                seen[key]["lists"].append(x["layer"])
            continue
        seen[key] = {
            "sid": _sid(*key), "name": x["name"], "kind": kind, "operator": x.get("operator"),
            "address": x.get("address"), "city": x.get("city"), "postcode": x.get("postcode"),
            "country": cfg.get("country"), "lat": x["lat"], "lon": x["lon"], "lists": [map_name],
            "note": f"Listed by the map “{map_name}” as a target for action — no dated call", "calls": [],
        }
    return list(seen.values())


# ── 4. CAAT — "Who arms Israel" (UK) ────────────────────────────────────

CAAT_URL = ("https://caat.org.uk/data/countries/israel/"
            "mapped-all-the-uk-companies-manufacturing-components-for-israels-f35-combat-aircraft/")


def _inline_json(page: str, var: str):
    i = page.find(f"cma.{var}")
    if i < 0:
        return None
    j = page.find("=", i)
    try:
        v, _ = json.JSONDecoder().raw_decode(page[j + 1:].lstrip())
        return v
    except ValueError:
        return None


def parse_caat(body: bytes) -> list[dict]:
    """cma.ukF35 (companies with site addresses and lat/lon) and
    cma.ukLicensee (export-licence holders, registered office lat/lon).
    Only company name, site title, address and coordinates are kept — the
    licence lines are counted, not copied; CAAT's prose is not mirrored."""
    page = body.decode("utf-8", "replace")
    f35, lic = _inline_json(page, "ukF35"), _inline_json(page, "ukLicensee")
    if not isinstance(f35, list) and not isinstance(lic, list):
        raise ValueError("no cma.ukF35 / cma.ukLicensee in the page")
    out: dict[tuple, dict] = {}

    def cname(v):
        return scrub(" / ".join(str(x) for x in v) if isinstance(v, list) else v, 100)

    def add(company, site, addr, lat, lon, lst, note):
        try:
            la, lo = float(lat), float(lon)
        except (TypeError, ValueError):
            return
        key = (_norm_key(company), round(la, 3), round(lo, 3))
        if key in out:
            if lst not in out[key]["lists"]:
                out[key]["lists"].append(lst)
            return
        out[key] = {"sid": _sid(*key), "name": f"{company} — {site}" if site else company, "kind": "arms_company",
                    "operator": company, "address": scrub(addr, 160), "country": "GB", "lat": round(la, 5),
                    "lon": round(lo, 5), "lists": [lst], "note": note, "calls": []}
    for c in f35 or []:
        if not isinstance(c, dict) or c.get("hide"):
            continue
        name = cname(c.get("name"))
        for a in c.get("address") or []:
            if isinstance(a, dict) and name:
                add(name, scrub(a.get("title"), 60), a.get("address"), a.get("lat"), a.get("lon"),
                    "F-35 supply chain",
                    "Listed by CAAT (“Who arms Israel”) as a UK site in the F-35 supply chain — a research list "
                    "activists use to plan actions; no dated call")
    for c in lic or []:
        if not isinstance(c, dict) or c.get("hide"):
            continue
        name = cname(c.get("name"))
        ll = c.get("registeredAddressLatLon") or []
        if name and len(ll) == 2:
            n = len([x for x in (c.get("licence") or []) if isinstance(x, dict) and x.get("status")])
            add(name, "registered office", c.get("registeredAddress"), ll[0], ll[1], "Israel export licences",
                f"Listed by CAAT (“Who arms Israel”) as a holder of {ep._n(n, 'export licence', 'export licences') if n else 'export licences'} "
                "to Israel (registered office, not necessarily a works) — no dated call")
    return list(out.values())


# ── 5. Dresden — notified assemblies ────────────────────────────────────

DRESDEN_URL = "https://www.dresden.de/data_ext/versammlungsuebersicht/Versammlungen.json"
DRESDEN_PAGE = "https://www.dresden.de/de/rathaus/dienstleistungen/versammlungen.php"
DRESDEN_BOX = (13.57, 50.97, 14.0, 51.18)
DRESDEN_CENTRE = (51.0504, 13.7373)


def parse_dresden(body: bytes) -> list[dict]:
    """{Versammlungen: [{Datum, Zeit, Thema, Ort, Startpunkt, Teilnehmer,
    Veranstalter, Status}]}. Veranstalter (the organiser) is never read."""
    d = json.loads(body.decode("utf-8-sig"))
    rows = d.get("Versammlungen") if isinstance(d, dict) else None
    if not isinstance(rows, list):
        raise ValueError("no Versammlungen list")
    places: dict[str, dict] = {}
    for r in rows:
        if not isinstance(r, dict):
            continue
        try:
            day = _dt.date.fromisoformat(str(r.get("Datum") or "")[:10]).isoformat()
        except ValueError:
            continue
        ort, start = scrub(r.get("Ort"), 80), scrub(r.get("Startpunkt"), 80)
        where = ort or start
        if not where:
            continue
        times = re.findall(r"\d{1,2}[.:]\d{2}", str(r.get("Zeit") or ""))
        topic = scrub(r.get("Thema"), 160)
        moving = bool(start) and not ort
        if KW_BLOCK.search(_fold(topic or "")):
            kind, label, level = "blockade", "Blockade (notified assembly)", "high"
        elif moving:
            kind, label, level = "march", "Notified march", "medium"
        else:
            kind, label, level = "assembly", "Notified assembly", "medium"
        n = re.search(r"\d[\d.]*", str(r.get("Teilnehmer") or ""))
        expected = int(n.group(0).replace(".", "")) if n else None
        status = {"angemeldet": "notified", "beschieden": "decision issued"}.get(str(r.get("Status") or "").strip().lower())
        pkey = _norm_key(where)
        p = places.get(pkey)
        if p is None:
            p = places[pkey] = {
                "sid": _sid(pkey), "name": f"{where}, Dresden", "kind": "assembly", "city": "Dresden", "country": "DE",
                "near_km": 5.0, "geo": {"qs": [f"{where}, Dresden"], "cc": "de", "box": DRESDEN_BOX}, "calls": [],
            }
        p["calls"].append(mk_call(
            kind, label, level, day, time_=_hhmm(times[0]) if times else None,
            end_time=_hhmm(times[1]) if len(times) > 1 else None, verb="notified", basis="announced",
            source_url=DRESDEN_PAGE, topic=topic, expected=expected, notice=status,
            supply=(level == "high" and is_supply(topic or ""))))
    return list(places.values())


# ── 6. Extinction Rebellion UK — events map ─────────────────────────────

XR_URL = "https://mapdata.extinctionrebellion.uk/uk-events-map-cache/events.php"
XR_PAGE = "https://eventmap.extinctionrebellion.uk/"
# Teamup sub-calendars that hold actions (categories.json: xractionuk,
# xraction, nonxraction); the others are meetings, cafés, drumming practice.
XR_ACTION_CALENDARS = {12240450, 12286041, 12245496}


def parse_xr(body: bytes) -> list[dict]:
    """xrevents({address: {geometry.location{lat,lng}, events: [[{title,
    start_dt, end_dt, subcalendar_ids, ...}]]}}). Only title, start, end and
    the geocoded location are read: `who`, `notes` and
    `custom.registration_link` (personal e-mails and phones) never are."""
    s = body.decode("utf-8", "replace")
    a, b = s.find("("), s.rfind(")")
    d = json.loads(s[a + 1:b] if a >= 0 and b > a else s)
    if not isinstance(d, dict):
        raise ValueError("not an address map")
    places = []
    for loc, v in d.items():
        try:
            g = v["geometry"]["location"]
            lat, lon = float(g["lat"]), float(g["lng"])
        except (KeyError, TypeError, ValueError):
            continue
        calls = []
        for grp in v.get("events") or []:
            for e in grp if isinstance(grp, list) else [grp]:
                if not isinstance(e, dict):
                    continue
                cals = set(e.get("subcalendar_ids") or [e.get("subcalendar_id")])
                if not (cals & XR_ACTION_CALENDARS):
                    continue
                title = scrub(re.sub(r"[^\w\s,.'’:;!?&()/–-]", " ", str(e.get("title") or "")), 120)
                kind = classify_action(title or "", default="action", lang="en")
                if not kind or not title:
                    continue
                try:
                    st = _dt.datetime.fromisoformat(str(e["start_dt"]))
                    en = _dt.datetime.fromisoformat(str(e.get("end_dt") or e["start_dt"]))
                except (KeyError, ValueError):
                    continue
                d0, t0 = _local(st, "Europe/London")
                d1, t1 = _local(en, "Europe/London")
                label, level = ACTION_LABEL[kind]
                calls.append(mk_call(kind, label, level, d0, time_=None if e.get("all_day") else t0, end_date=d1,
                                     end_time=None if e.get("all_day") else t1, tz="Europe/London",
                                     source_url=XR_PAGE, topic=title,
                                     supply=(level == "high" and is_supply(title))))
        if calls:
            name = scrub(loc, 100) or "XR action"
            places.append({"sid": _sid(round(lat, 4), round(lon, 4)), "name": name, "kind": "action",
                           "address": name, "country": "GB", "lat": round(lat, 5), "lon": round(lon, 5),
                           "near_km": 5.0, "calls": calls})
    return places


# ── 7a. Demosphere calendars (.ics) ─────────────────────────────────────

DEMOSPHERE = {
    "bxl": {"city": "Bruxelles", "country": "BE", "cc": "be", "tz": "Europe/Brussels", "centre": (50.8467, 4.3525),
            "box": (4.24, 50.76, 4.49, 50.92)},
    "liege": {"city": "Liège", "country": "BE", "cc": "be", "tz": "Europe/Brussels", "centre": (50.6326, 5.5797),
              "box": (5.45, 50.55, 5.70, 50.70)},
    "ffm": {"city": "Frankfurt am Main", "country": "DE", "cc": "de", "tz": "Europe/Berlin", "centre": (50.1109, 8.6821),
            "box": (8.47, 50.01, 8.80, 50.23)},
    "wuerzburg": {"city": "Würzburg", "country": "DE", "cc": "de", "tz": "Europe/Berlin", "centre": (49.7913, 9.9534),
                  "box": (9.85, 49.71, 10.05, 49.86)},
}


def _ics_events(text: str) -> list[dict]:
    t = text.replace("\r\n", "\n").replace("\n ", "").replace("\n\t", "")
    out = []
    for blk in re.findall(r"BEGIN:VEVENT\n(.*?)\nEND:VEVENT", t, re.S):
        e = {}
        for line in blk.split("\n"):
            if ":" not in line:
                continue
            k, v = line.split(":", 1)
            k = k.split(";", 1)[0].upper()
            e[k] = v.replace("\\n", "\n").replace("\\N", "\n").replace("\\,", ",").replace("\\;", ";")
        out.append(e)
    return out


def _ics_dt(v: str, tz: str) -> tuple[str, str | None] | None:
    v = (v or "").strip()
    try:
        if re.fullmatch(r"\d{8}", v):
            return _dt.datetime.strptime(v, "%Y%m%d").date().isoformat(), None
        if v.endswith("Z"):
            return _local(_dt.datetime.strptime(v, "%Y%m%dT%H%M%SZ").replace(tzinfo=_dt.timezone.utc), tz)
        d = _dt.datetime.strptime(v[:15], "%Y%m%dT%H%M%S")
        return d.date().isoformat(), d.strftime("%H:%M")
    except ValueError:
        return None


def parse_demosphere(body: bytes, site: str) -> list[dict]:
    """VEVENTs with SUMMARY "Type : title", LOCATION "postcode commune,\\n
    venue\\nstreet", DTSTART/DTEND, URL. DESCRIPTION is never read (it can
    carry organisers' e-mails)."""
    cfg = DEMOSPHERE[site]
    places: dict[str, dict] = {}
    for e in _ics_events(body.decode("utf-8", "replace")):
        summary = re.sub(r"\s+", " ", e.get("SUMMARY") or "").strip()
        head, _, rest = summary.partition(" : ") if " : " in summary else ("", "", summary)
        kind = classify_action(summary)
        if head and KW_NOT_ACTION.search(_fold(head)) and kind not in ("blockade", "strike", "march"):
            kind = None
        if not kind:
            continue
        s = _ics_dt(e.get("DTSTART"), cfg["tz"])
        if not s:
            continue
        en = _ics_dt(e.get("DTEND"), cfg["tz"]) or s
        lines = [x.strip(" ,") for x in (e.get("LOCATION") or "").split("\n") if x.strip(" ,")]
        commune = lines[0] if lines else cfg["city"]
        rest_l = [x for x in lines[1:] if not re.search(r"infos? à venir|à préciser|tba|tbc|wird bekannt", x, re.I)]
        venue = rest_l[0] if rest_l else None
        street = next((x for x in reversed(rest_l) if re.search(r"\d", x)), None)
        qs = []
        if street:
            qs.append(f"{street}, {re.sub(r'^[0-9]{4,5} ', '', commune)}")
        if venue:
            qs.append(f"{venue}, {cfg['city']}")
        name = scrub(venue or commune, 80) or cfg["city"]
        pkey = _norm_key(" ".join(lines)) or _norm_key(cfg["city"])
        p = places.get(pkey)
        if p is None:
            p = places[pkey] = {
                "sid": _sid(site, pkey), "name": name if cfg["city"].lower() in name.lower() else f"{name}, {cfg['city']}",
                "kind": "action", "city": cfg["city"], "address": scrub(", ".join(rest_l[1:] or rest_l), 120),
                "country": cfg["country"], "near_km": 5.0,
                "geo": {"qs": qs, "cc": cfg["cc"], "box": cfg["box"], "fallback": list(cfg["centre"])}, "calls": [],
            }
        label, level = ACTION_LABEL[kind]
        title = scrub(rest or summary, 140)
        p["calls"].append(mk_call(kind, label, level, s[0], time_=s[1], end_date=en[0], end_time=en[1],
                                  tz=cfg["tz"], source_url=(e.get("URL") or "").strip() or f"https://{site}.demosphere.net/",
                                  topic=title, supply=(level == "high" and is_supply(summary))))
    return list(places.values())


# ── 7b. Gancio calendars (/api/events) ──────────────────────────────────

GANCIO = {
    "mad.convoca.la": {"city": "Madrid", "country": "ES", "cc": "es", "tz": "Europe/Madrid", "centre": (40.4168, -3.7038)},
    "bcn.convoca.la": {"city": "Barcelona", "country": "ES", "cc": "es", "tz": "Europe/Madrid", "centre": (41.3874, 2.1686)},
    "calendari.cc": {"city": None, "country": "ES", "cc": "es", "tz": "Europe/Madrid", "centre": None},
    "bonn.jetzt": {"city": "Bonn", "country": "DE", "cc": "de", "tz": "Europe/Berlin", "centre": (50.7374, 7.0982)},
    "events.rheinmain.social": {"city": None, "country": "DE", "cc": "de", "tz": "Europe/Berlin", "centre": None},
    "balotta.org": {"city": "Bologna", "country": "IT", "cc": "it", "tz": "Europe/Rome", "centre": (44.4949, 11.3426)},
}


def parse_gancio(body: bytes, host: str) -> list[dict]:
    """[{id, title, slug, start_datetime, end_datetime, tags, place{name,
    address, latitude, longitude}}]. Tags are read to judge, never kept
    (they name performers and speakers); ap_user and media are never read."""
    cfg = GANCIO[host]
    rows = json.loads(body.decode("utf-8"))
    if not isinstance(rows, list):
        raise ValueError("not an event list")
    places: dict[str, dict] = {}
    for e in rows:
        if not isinstance(e, dict):
            continue
        tags = " ".join(str(t) for t in (e.get("tags") or []) if isinstance(t, str))
        kind = classify_action(str(e.get("title") or ""), tags)
        if not kind:
            continue
        try:
            st = _dt.datetime.fromtimestamp(int(e["start_datetime"]), _dt.timezone.utc)
            en = _dt.datetime.fromtimestamp(int(e.get("end_datetime") or e["start_datetime"]), _dt.timezone.utc)
        except (KeyError, TypeError, ValueError, OSError):
            continue
        pl = e.get("place") or {}
        pname = scrub(pl.get("name"), 80)
        addr = scrub(pl.get("address"), 120)
        try:
            lat, lon = float(pl["latitude"]), float(pl["longitude"])
            geo = None
        except (KeyError, TypeError, ValueError):
            lat = lon = None
            qs = [q for q in (f"{addr}, {cfg['city']}" if addr and cfg["city"] else addr,
                              f"{pname}, {cfg['city']}" if pname and cfg["city"] else None) if q]
            if not qs and not cfg["centre"]:
                continue
            geo = {"qs": qs, "cc": cfg["cc"], "fallback": list(cfg["centre"]) if cfg["centre"] else None}
        if pname and re.search(r"online|virtual|jitsi|zoom", pname, re.I):
            continue
        pkey = f"{pl.get('id') or _norm_key(pname or addr or '')}"
        p = places.get(pkey)
        if p is None:
            p = places[pkey] = {
                "sid": _sid(host, pkey),
                "name": (f"{pname}, {cfg['city']}" if pname and cfg["city"] and cfg["city"].lower() not in pname.lower()
                         else (pname or addr or cfg["city"] or host)),
                "kind": "action", "city": cfg["city"], "address": addr, "country": cfg["country"], "near_km": 5.0,
                "lat": round(lat, 5) if lat is not None else None, "lon": round(lon, 5) if lon is not None else None,
                "calls": [],
            }
            if geo:
                p["geo"] = geo
        d0, t0 = _local(st, cfg["tz"])
        d1, t1 = _local(en, cfg["tz"])
        label, level = ACTION_LABEL[kind]
        title = scrub(e.get("title"), 140)
        p["calls"].append(mk_call(kind, label, level, d0, time_=t0, end_date=d1, end_time=t1, tz=cfg["tz"],
                                  source_url=f"https://{host}/event/{e.get('slug') or e.get('id')}", topic=title,
                                  supply=(level == "high" and is_supply(f"{title} {tags}"))))
    return list(places.values())


# ── the source registry ──────────────────────────────────────────────────

H, D = 3600, 86400


def _src(key, label, country, url, page, every, fmt, parse, credit, note, kind_hint):
    return {"key": key, "label": label, "country": country, "url": url, "page": page, "every": every, "fmt": fmt,
            "parse": parse, "credit": credit, "note": note, "kind": kind_hint}


def sources() -> list[dict]:
    out = [
        _src("de_berlin", "Polizei Berlin — notified assemblies", "DE", BERLIN_URL, BERLIN_PAGE, H, "json",
             parse_berlin, "Polizei Berlin, Versammlungsbehörde — official list of notified assemblies "
             "(§ 12 VersFG BE); public authority information, no licence stated; facts cited",
             "Every assembly notified to the Berlin police; addresses geocoded with OpenStreetMap Nominatim",
             "official"),
        _src("it_mit", "MIT — proclaimed transport strikes (Italy)", "IT", MIT_URL, MIT_PAGE, H, "xml", parse_mit,
             "Ministero delle Infrastrutture e dei Trasporti, Osservatorio sui conflitti sindacali — "
             "\"Scioperi in programma\"; licence not stated; facts cited",
             "Every proclaimed transport strike and general strike affecting transport; shown at the province, "
             "region or country", "official"),
    ]
    for s in UMAP_SEEDS:
        out.append(_umap_src(s))
    out += [
        _src("uk_caat", "CAAT — Who arms Israel (UK)", "GB", CAAT_URL, CAAT_URL, D, "html", parse_caat,
             "Campaign Against Arms Trade (CAAT), “Who arms Israel” — © CAAT; facts cited, prose not reproduced",
             "UK companies in the F-35 supply chain and holders of Israel export licences", "list"),
        _src("de_dresden", "Dresden — notified assemblies", "DE", DRESDEN_URL, DRESDEN_PAGE, H, "json",
             parse_dresden, "Landeshauptstadt Dresden, Versammlungsbehörde — Versammlungsübersicht; public "
             "authority information, no licence stated; facts cited",
             "Assemblies notified in Dresden for the next three months; places geocoded with Nominatim", "official"),
        _src("uk_xr", "Extinction Rebellion UK — events map (actions)", "GB", XR_URL, XR_PAGE, 3 * H, "jsonp",
             parse_xr, "Extinction Rebellion UK events map (Teamup) — public listing; facts cited",
             "XR UK's action calendars only (not meetings, cafés or practices)", "calendar"),
    ]
    for site, cfg in DEMOSPHERE.items():
        out.append(_src(f"demosphere:{site}", f"Demosphere {cfg['city']}", cfg["country"],
                        f"https://{site}.demosphere.net/events.ics", f"https://{site}.demosphere.net/", 3 * H, "ics",
                        (lambda b, s=site: parse_demosphere(b, s)),
                        f"demosphere {cfg['city']} — volunteer activist calendar; facts cited",
                        "Rallies, marches, strikes and blockades from the calendar (talks and meetings left out)",
                        "calendar"))
    for host, cfg in GANCIO.items():
        out.append(_src(f"gancio:{host}", f"Gancio {cfg['city'] or host}", cfg["country"], f"https://{host}/api/events",
                        f"https://{host}/", 3 * H, "json", (lambda b, h=host: parse_gancio(b, h)),
                        f"{host} (Gancio community calendar) — facts cited",
                        "Rallies, marches, strikes and blockades from the calendar (culture and talks left out)",
                        "calendar"))
    return out


def _umap_src(s: dict, title: str | None = None) -> dict:
    host, mid = s["host"], int(s["id"])
    return _src(f"umap:{host}:{mid}", title or f"uMap map {mid}", s.get("country"),
                f"https://{host}/en/map/{mid}/geojson/", f"https://{host}/m/{mid}/", D, "umap", None,
                f"uMap map on {host} — map data © its authors", "A map activists publish as a list of targets",
                "list") | {"umap": s}


# ── storage, fetch, politeness ───────────────────────────────────────────

_geo_lock = threading.Lock()


def _snap_name(key: str) -> str:
    return "src_" + re.sub(r"[^a-zA-Z0-9_.-]+", "_", key) + ".json"


def load_snapshot(key: str) -> dict | None:
    return ep._read_json(_snap_name(key))


_last_host: dict[str, float] = {}


def _get(url: str, cond: dict | None = None, max_bytes: int = 12_000_000):
    """ep._fetch with a pause between two requests to the same host."""
    host = urllib.parse.urlsplit(url).netloc
    gap = HOST_GAP_S - (time.monotonic() - _last_host.get(host, 0))
    if gap > 0:
        time.sleep(gap)
    out = ep._fetch(url, cond, 40, max_bytes)
    _last_host[host] = time.monotonic()
    return out


def _due(meta: dict, key: str, every: int, now_ts: float, force: bool) -> bool:
    if force:
        return True
    last = (meta.get("http") or {}).get(key, {}).get("checked_at") or 0
    return now_ts - last >= every - 60


def _keep_or_replace(meta, key, places, now_ts, errors, fetched_at) -> bool:
    """Write the snapshot unless it is empty while the last one was not."""
    prev = load_snapshot(key)
    if not places and prev and len(prev.get("places") or []) >= 3:
        msg = "empty answer"
        ep._record(meta, key, now_ts, False, error=msg)
        errors.append(f"{key}: {msg}")
        print(f"[endangered] error: {key}: {msg} — keeping the {len(prev['places'])} places we have", flush=True)
        return False
    ep._write_json(_snap_name(key), {"fetched_at": fetched_at, "key": key, "places": places})
    return True


def pull(meta: dict, src: dict, now: _dt.datetime, errors: list) -> bool:
    """Fetch one source and save its normalised snapshot. True when it changed."""
    key, now_ts = src["key"], now.timestamp()
    if src["fmt"] == "umap":
        return pull_umap(meta, src, now, errors)
    have = load_snapshot(key) is not None
    try:
        body, hdr = _get(src["url"], (meta.get("http") or {}).get(key) if have else None)
    except ep.NotModified:
        ep._record(meta, key, now_ts, True)
        return False
    except Exception as e:                                     # noqa: BLE001
        msg = f"{type(e).__name__}: {e}"
        ep._record(meta, key, now_ts, False, error=msg)
        errors.append(f"{key}: {msg}")
        print(f"[endangered] error: fetch {key} ({src['url']}): {msg} — keeping the copy we have", flush=True)
        return False
    try:
        places = src["parse"](body)
    except Exception as e:                                     # noqa: BLE001
        msg = f"unreadable answer ({type(e).__name__}: {e})"
        ep._record(meta, key, now_ts, False, error=msg)
        errors.append(f"{key}: {msg}")
        print(f"[endangered] error: {key}: {msg} — keeping the copy we have", flush=True)
        return False
    if not _keep_or_replace(meta, key, places, now_ts, errors, now.strftime("%Y-%m-%dT%H:%M:%SZ")):
        return False
    ep._record(meta, key, now_ts, True, hdr)
    return True


def pull_umap(meta: dict, src: dict, now: _dt.datetime, errors: list) -> bool:
    key, now_ts, cfg = src["key"], now.timestamp(), src["umap"]
    host, mid = cfg["host"], int(cfg["id"])
    try:
        body, _h = _get(src["url"])
        name, layers, lic = umap_layers(body)
        modified = lic.pop("modified_at", None)
        if cfg.get("discovered"):
            # A discovered map is followed while it is current: a call map
            # edited in the last 60 days, an arms-site list in three years.
            fresh = CALL_MAP_FRESH_DAYS if cfg.get("call") else LIST_MAP_FRESH_DAYS
            if modified and (now.date() - _dt.date.fromisoformat(modified)).days > fresh:
                d = (meta.get("umap_discovered") or {}).get(f"{host}:{mid}")
                if d is not None:
                    d.update(accepted=False, why=f"last edited {modified} — an old map, not followed")
                ep._record(meta, key, now_ts, True)
                try:
                    (ep._dir() / _snap_name(key)).unlink()
                except FileNotFoundError:
                    pass
                print(f"[endangered] uMap {host}:{mid} “{name}” last edited {modified}: not followed", flush=True)
                return True
        feats = []
        for pk, lname in layers[:12]:
            lb, _h2 = _get(f"https://{host}/en/datalayer/{mid}/{pk}/")
            feats += parse_umap_layer(lb, lname)
    except Exception as e:                                     # noqa: BLE001
        msg = f"{type(e).__name__}: {e}"
        ep._record(meta, key, now_ts, False, error=msg)
        errors.append(f"{key}: {msg}")
        print(f"[endangered] error: fetch {key}: {msg} — keeping the copy we have", flush=True)
        return False
    country = cfg.get("country")
    if not country and feats:
        votes: dict[str, int] = {}
        for x in feats[:: max(1, len(feats) // 20)][:20]:
            c = country_of_point(x["lat"], x["lon"])
            if c:
                votes[c] = votes.get(c, 0) + 1
        country = max(votes, key=votes.get) if votes else None
    places = umap_places(feats, {**cfg, "country": country}, name, src["page"])
    if not country:
        for p in places:
            p["country"] = country_of_point(p["lat"], p["lon"])
    ms = meta.setdefault("umap_maps", {})
    ms[key] = {"name": name, "licence": lic, "country": country, "features": len(places), "modified_at": modified}
    if not _keep_or_replace(meta, key, places, now_ts, errors, now.strftime("%Y-%m-%dT%H:%M:%SZ")):
        return False
    ep._record(meta, key, now_ts, True)
    return True


def discover(meta: dict, now: _dt.datetime, errors: list) -> dict:
    """Weekly: search each uMap instance for target maps by keyword; a map
    whose title says it lists arms / war-economy sites or calls for a
    blockade is followed from then on (at most UMAP_MAX_DISCOVERED), the
    others are remembered as seen so they are not judged again."""
    found = meta.setdefault("umap_discovered", {})
    seeds = {(s["host"], int(s["id"])) for s in UMAP_SEEDS} | UMAP_SKIP
    for v in found.values():                                  # the rules may have changed since
        if "last edited" in (v.get("why") or ""):
            continue                                          # judged on its date, by pull_umap
        ok, why = classify_map(v.get("title") or "", now.year)
        v.update(accepted=ok, why=why)
    new = ok_hosts = 0
    for host in UMAP_HOSTS:
        host_ok = False
        for term in DISCOVERY_TERMS:
            url = f"https://{host}/en/search/?q={urllib.parse.quote(term)}"
            try:
                body, _h = _get(url, max_bytes=3_000_000)
            except Exception as e:                             # noqa: BLE001
                msg = f"{type(e).__name__}: {e}"
                errors.append(f"discovery {host}: {msg}")
                print(f"[endangered] error: discovery {host} ({term}): {msg}", flush=True)
                break                                         # this host is down or refusing: next host
            host_ok = True
            for mid, slug in parse_umap_search(body, host):
                k = f"{host}:{mid}"
                if (host, mid) in seeds or k in found:
                    continue
                ok, why = classify_map(slug.replace("-", " "), now.year)
                found[k] = {"host": host, "id": mid, "title": slug.replace("-", " "), "accepted": ok, "why": why,
                            "term": term, "first_seen": now.strftime("%Y-%m-%d")}
                new += ok
        ok_hosts += host_ok
    if ok_hosts:                                              # all down: try again next run, not in a week
        ep._record(meta, "discovery", now.timestamp(), True)
    acc = [v for v in found.values() if v.get("accepted")]
    return {"accepted": len(acc), "new": new, "seen": len(found)}


def all_sources(meta: dict) -> list[dict]:
    out = sources()
    acc = [v for v in (meta.get("umap_discovered") or {}).values() if v.get("accepted")]
    acc.sort(key=lambda v: v.get("first_seen") or "")
    for v in acc[:UMAP_MAX_DISCOVERED]:
        out.append(_umap_src({"host": v["host"], "id": v["id"], "country": None,
                              "kind": "arms_company" if "arms" in (v.get("why") or "") else "listed_site",
                              "discovered": True, "call": "call" in (v.get("why") or "")},
                             title=f"uMap: {v.get('title')}"))
    for s in out:
        if s["fmt"] == "umap":
            m = (meta.get("umap_maps") or {}).get(s["key"]) or {}
            if m.get("name"):
                s["label"] = f"uMap: {m['name']}" if s["umap"]["host"] != "framacarte.org" else f"Framacarte: {m['name']}"
            lic = (m.get("licence") or {}).get("name")
            s["credit"] = (f"“{m.get('name') or s['label']}” on {s['umap']['host']} — map data © its authors"
                           + (f", licence {lic}" if lic else ", licence not stated") + "; facts cited")
    return out


EVERY_DISCOVERY = 7 * D


def refresh_all(meta: dict, now: _dt.datetime, force: bool, errors: list) -> bool:
    """Every source that is due, then geocoding within budget. Synchronous;
    called from endangered_places.refresh inside its lock."""
    changed = False
    now_ts = now.timestamp()
    if _due(meta, "discovery", EVERY_DISCOVERY, now_ts, False):
        try:
            r = discover(meta, now, errors)
            print(f"[endangered] discovery: {r['accepted']} target maps followed ({r['new']} new), "
                  f"{r['seen']} maps judged", flush=True)
        except Exception as e:                                 # noqa: BLE001
            errors.append(f"discovery: {type(e).__name__}: {e}")
            print(f"[endangered] error: discovery: {type(e).__name__}: {e}", flush=True)
    for src in all_sources(meta):
        if _due(meta, src["key"], src["every"], now_ts, force):
            try:
                changed |= pull(meta, src, now, errors)
            except Exception as e:                             # noqa: BLE001
                errors.append(f"{src['key']}: {type(e).__name__}: {e}")
                print(f"[endangered] error: {src['key']}: {type(e).__name__}: {e}", flush=True)
    try:
        n = geocode_pending(meta, now)
        changed |= n > 0
    except Exception as e:                                     # noqa: BLE001
        errors.append(f"geocode: {type(e).__name__}: {e}")
        print(f"[endangered] error: geocode: {type(e).__name__}: {e}", flush=True)
    return changed


# ── geocoding (Nominatim, polite, cached) ────────────────────────────────

def _gkey(q: str, cc: str | None) -> str:
    return f"{(cc or '').lower()}|{_fold(q).strip()}"


def _geo_cache() -> dict:
    return ep._read_json("geocode.json", {}) or {}


def geocode_one(q: str, cc: str | None, box=None) -> tuple[float, float] | None:
    """One Nominatim lookup, at most one a second across the app (the lock
    and clock of geocode_utils). Raises on a network failure."""
    params = {"format": "jsonv2", "q": q, "limit": "1"}
    if cc:
        params["countrycodes"] = cc
    if box:
        params["viewbox"] = ",".join(str(x) for x in box)
        params["bounded"] = "1"
    url = f"{NOMINATIM}?{urllib.parse.urlencode(params)}"
    import geocode_utils as gu
    with gu._rate_lock:
        wait = 1.05 - (time.monotonic() - gu._last_request_ts)
        if wait > 0:
            time.sleep(wait)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Language": "en"})
            with urllib.request.urlopen(req, timeout=15) as r:
                data = json.loads(r.read(2_000_000).decode("utf-8"))
        finally:
            gu._last_request_ts = time.monotonic()
    if isinstance(data, list) and data:
        try:
            return float(data[0]["lat"]), float(data[0]["lon"])
        except (KeyError, TypeError, ValueError):
            return None
    return None


def _cached(cache: dict, q: str, cc: str | None, now_ts: float):
    """(lat, lon) | None (a known miss) | "ask" (not known, or a stale miss)."""
    v = cache.get(_gkey(q, cc))
    if not v:
        return "ask"
    if v[0] is None:
        return "ask" if now_ts - (v[2] or 0) > GEOCODE_MISS_RETRY_S else None
    return float(v[0]), float(v[1])


def geocode_pending(meta: dict, now: _dt.datetime, budget: int | None = None) -> int:
    """Look up the places that have none yet, soonest call first, within the
    budget. Returns how many lookups found a position."""
    budget = GEOCODE_BUDGET if budget is None else budget
    now_ts = now.timestamp()
    with _geo_lock:
        cache = _geo_cache()
        todo = []
        for src in all_sources(meta):
            snap = load_snapshot(src["key"]) or {}
            for p in snap.get("places") or []:
                if p.get("lat") is not None or not p.get("geo"):
                    continue
                g = p["geo"]
                if any(isinstance(_cached(cache, q, g.get("cc"), now_ts), tuple) for q in g.get("qs") or []):
                    continue
                soon = min((c["date"] for c in p.get("calls") or []), default="9999")
                if soon < (now.date() - _dt.timedelta(days=KEEP_PAST_DAYS)).isoformat():
                    continue
                for q in g.get("qs") or []:
                    if _cached(cache, q, g.get("cc"), now_ts) == "ask":
                        todo.append((soon, q, g.get("cc"), tuple(g["box"]) if g.get("box") else None))
                        break
        todo.sort()
        found = asked = 0
        seen = set()
        for _soon, q, cc, box in todo:
            if asked >= budget:
                break
            k = _gkey(q, cc)
            if k in seen:
                continue
            seen.add(k)
            asked += 1
            try:
                hit = geocode_one(q, cc, box)
            except Exception as e:                             # noqa: BLE001
                print(f"[endangered] error: geocode “{q}”: {type(e).__name__}: {e}", flush=True)
                break                                          # Nominatim refusing: stop for this run
            cache[k] = [hit[0], hit[1], now_ts] if hit else [None, None, now_ts]
            found += bool(hit)
        if asked:
            ep._write_json("geocode.json", cache)
            print(f"[endangered] geocoded {found}/{asked} ({len(todo) - asked} still to do)", flush=True)
        return found


def resolve(p: dict, cache: dict, now_ts: float) -> tuple[float, float, str | None] | None:
    """(lat, lon, approx) for a snapshot place, from its own coordinates or
    the cache; the fallback (a city or region centre) marked approximate."""
    if p.get("lat") is not None and p.get("lon") is not None:
        return float(p["lat"]), float(p["lon"]), None
    g = p.get("geo") or {}
    for i, q in enumerate(g.get("qs") or []):
        hit = _cached(cache, q, g.get("cc"), now_ts)
        if isinstance(hit, tuple):
            return hit[0], hit[1], (None if i == 0 else "street not found; nearest match")
    fb = g.get("fallback")
    if fb:
        return float(fb[0]), float(fb[1]), "approximate (centre of the city or area)"
    return None


# ── building the places ──────────────────────────────────────────────────

KIND_LABEL = {
    "listed_site": "Site on an activist map",
    "assembly": "Notified assembly", "strike": "Strike", "action": "Called action",
    "arms_company": "Arms-industry company", "lobby_office": "Arms-lobby office / EU body",
}


def _merge_series(calls: list[dict]) -> list[dict]:
    """A vigil notified every day for weeks is one call over several dates,
    not thirty: same kind, topic and hours → one call with its dates."""
    groups: dict[tuple, list] = {}
    order = []
    for c in calls:
        k = (c["kind"], c.get("topic"), c.get("time"), c.get("end_time"), c.get("route"))
        if k not in groups:
            groups[k] = []
            order.append(k)
        groups[k].append(c)
    out = []
    for k in order:
        g = sorted(groups[k], key=lambda c: c["date"])
        if len(g) == 1 or any(c.get("end_date") for c in g):
            out += g
            continue
        dates = sorted({c["date"] for c in g})
        first = dict(g[0])
        if len(dates) > 1:
            first["dates"] = dates
            first["end_date"] = dates[-1]
        out.append(first)
    return out


def build_places(meta: dict, now: _dt.datetime) -> tuple[list[dict], dict]:
    """The places from every snapshot. Pure apart from reading the files:
    no network. Calls past (more than a day) or beyond the horizon are
    dropped; a place left with no call is dropped unless it is listed."""
    today = now.date()
    lo = (today - _dt.timedelta(days=KEEP_PAST_DAYS)).isoformat()
    hi = (today + _dt.timedelta(days=HORIZON_DAYS)).isoformat()
    now_ts = now.timestamp()
    cache = _geo_cache()
    out: list[dict] = []
    unplaced = 0
    for src in all_sources(meta):
        snap = load_snapshot(src["key"])
        if not snap:
            continue
        for p in snap.get("places") or []:
            listed = not p.get("calls")
            calls = []
            for c in p.get("calls") or []:
                end = c.get("end_date") or c["date"]
                if end < lo:
                    continue
                if c["date"] > hi and src["key"] != "it_mit":
                    continue
                if c.get("dates"):
                    keep = [d for d in c["dates"] if d >= lo and d <= hi]
                    if not keep:
                        continue
                    c = {**c, "dates": keep, "date": keep[0], "end_date": keep[-1]}
                    if len(keep) == 1:
                        c.pop("dates"), c.pop("end_date")
                calls.append(c)
            if not listed and not calls:
                continue
            pos = resolve(p, cache, now_ts)
            if pos is None:
                unplaced += len(calls) or 1
                continue
            calls = _merge_series(calls)
            pid = f"{src['key']}:{p['sid']}"
            for c in calls:
                c["key"] = f"{pid}|{c['kind']}|{c.get('time') or '-'}|{c['date']}|{_sid(c.get('topic'))}"
                c["source_url"] = c.get("source_url") or src["page"]
            cc = (p.get("country") or src.get("country") or "").upper() or country_of_point(pos[0], pos[1])
            q = {k: v for k, v in p.items() if k not in ("sid", "geo", "near_km", "calls")}
            q.update({
                "id": pid, "source": src["label"], "source_key": src["key"], "source_url": src["page"],
                "credit": src["credit"], "kind_label": KIND_LABEL.get(p["kind"], p["kind"].replace("_", " ").capitalize()),
                "country": cc, "country_name": country_name(cc), "lat": round(pos[0], 5), "lon": round(pos[1], 5),
                "calls": calls, "near_km": p.get("near_km"),
            })
            if pos[2]:
                q["approx"] = pos[2]
            lv = sorted((c["level"] for c in calls), key=lambda x: ep.LEVEL_RANK.get(x, 9))
            q["level"] = lv[0] if lv else None
            out.append({k: v for k, v in q.items() if v is not None})
    out = _dedupe_listed(out)
    return out, {"unplaced": unplaced}


def _dedupe_listed(places: list[dict]) -> list[dict]:
    """The same company at the same spot on two lists: one place, both lists."""
    seen: dict[tuple, dict] = {}
    out = []
    for p in places:
        if p.get("calls"):
            out.append(p)
            continue
        key = (_norm_key(p["name"]), round(p["lat"], 3), round(p["lon"], 3))
        if key in seen:
            for x in p.get("lists") or []:
                if x not in seen[key].setdefault("lists", []):
                    seen[key]["lists"].append(x)
            continue
        seen[key] = p
        out.append(p)
    return out


def merge_with_france(fr: list[dict], other: list[dict]) -> list[dict]:
    """A site already on the French anti-militarist map (213599) and on
    another list is one place: the other list is added to its lists."""
    ix = {}
    for p in fr:
        if p.get("kind") == "arms_company":
            ix[(_norm_key(p["name"]), round(p["lat"], 2), round(p["lon"], 2))] = p
    out = []
    for p in other:
        k = (_norm_key(p["name"]), round(p["lat"], 2), round(p["lon"], 2))
        if not p.get("calls") and k in ix:
            for x in p.get("lists") or []:
                if x not in ix[k]["lists"]:
                    ix[k]["lists"].append(x)
            continue
        out.append(p)
    return out


def status_rows(meta: dict) -> list[dict]:
    h = meta.get("http") or {}

    def iso(ts):
        return _dt.datetime.fromtimestamp(ts, _dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if ts else None
    rows = []
    for s in all_sources(meta):
        x = h.get(s["key"]) or {}
        rows.append({"name": s["label"], "key": s["key"], "url": s["page"], "country": s["country"],
                     "ok_at": iso(x.get("ok_at")), "error": x.get("error"), "note": s["note"], "credit": s["credit"],
                     "every_s": s["every"]})
    return rows


# ── alerts outside France (no flood) ─────────────────────────────────────

TYPE_COUNTRY = ep.TYPE_COUNTRY
TYPE_SUPPLY = ep.TYPE_SUPPLY
ALERT_TYPES = (TYPE_COUNTRY, TYPE_SUPPLY)
ALERT_LEAD_DAYS = 4          # a call is notified when it is this close


covers = ep.covers


def _where(p: dict) -> str:
    if p["kind"] == "strike":
        return p["name"].replace(" (nationwide)", " nationwide")
    return p["name"]


def country_alerts(places: list[dict], now: _dt.datetime) -> list[dict]:
    """One per country per day with at least one HIGH call (a blockade, a
    supply strike), from today to ALERT_LEAD_DAYS ahead; updated in place
    when the high calls change. France's gilets jaunes have their own."""
    today = now.astimezone(ep._zone()).date()
    out = []
    by_country: dict[str, list] = {}
    for p in places:
        if p.get("source") == ep.GJ_LABEL or not p.get("country") or not p.get("calls"):
            continue
        by_country.setdefault(p["country"], []).append(p)
    for cc, ps in by_country.items():
        for i in range(ALERT_LEAD_DAYS + 1):
            day = (today + _dt.timedelta(days=i)).isoformat()
            on = [(p, c) for p in ps for c in p["calls"] if covers(c, day)]
            high = [(p, c) for p, c in on if c["level"] == "high"]
            if not high:
                continue
            name = country_name(cc)
            kinds: dict[str, int] = {}
            for _p, c in high:
                kinds[c["label_en"]] = kinds.get(c["label_en"], 0) + 1
            what = ", ".join(f"{v} × {k.lower()}" if v > 1 else k.lower() for k, v in
                             sorted(kinds.items(), key=lambda x: -x[1]))
            places_hi = sorted({_where(p) for p, _c in high})
            title = (f"{name}: {ep._n(len(high), 'high-disruption call', 'high-disruption calls')} for "
                     f"{ep._day_label(day)} — {what} ({', '.join(places_hi[:3])}{' and more' if len(places_hi) > 3 else ''})"
                     + (f"; {ep._n(len(on) - len(high), 'other announced action', 'other announced actions')}"
                        if len(on) > len(high) else ""))
            srcs = sorted({p["source"] for p, _c in high})
            reason = f"blockades or supply strikes announced in {name} (sources: {', '.join(srcs)})"
            message = "; ".join(ep.call_line(c, p["source"]) + f" — at {p['name']}" for p, c in high[:8]) + "."
            out.append({
                "id": f"EPL-C-{cc}-{day.replace('-', '')}", "source": ep.SOURCE, "alert_type": TYPE_COUNTRY,
                "title": title, "severity": "high", "lat": high[0][0]["lat"], "lon": high[0][0]["lon"],
                "region": name, "country_code": cc, "entity_type": "campaign", "entity_id": f"epl-{cc}-{day}",
                "entity_name": f"Endangered places, {name}", "confidence": 0.75, "message": message, "reason": reason,
                "expires_at": ep._expires(day),
                "raw": {"rule": "endangered_places_country_day", "date": day, "country": cc, "high_calls": len(high),
                        "calls": len(on), "by_call": kinds, "reason": reason, "sources": srcs,
                        "source_url": high[0][1].get("source_url") or high[0][0]["source_url"]},
                "_sig": sorted(c["key"] for _p, c in high),
            })
    return out


def supply_alerts(places: list[dict], now: _dt.datetime) -> list[dict]:
    """One per place with a HIGH call at a critical supply site — a rail,
    port, freight or road strike; a blockade named at a port, refinery,
    depot, rail hub or arms works — starting within ALERT_LEAD_DAYS."""
    today = now.astimezone(ep._zone()).date().isoformat()
    last = (now.astimezone(ep._zone()).date() + _dt.timedelta(days=ALERT_LEAD_DAYS)).isoformat()
    out = []
    for p in places:
        if p.get("source") == ep.GJ_LABEL:
            continue
        hits = [c for c in p.get("calls") or [] if c["level"] == "high" and c.get("supply")
                and (c.get("end_date") or c["date"]) >= today and c["date"] <= last]
        if p["kind"] == "arms_company":
            hits += [c for c in p.get("calls") or [] if c["kind"] == "blockade" and c not in hits
                     and (c.get("end_date") or c["date"]) >= today and c["date"] <= last]
        for c in hits:
            name = country_name(p.get("country")) or ""
            extra = f" ({c['topic']})" if c.get("topic") and p["kind"] == "strike" else ""
            title = (f"{name}: {c['label_en']} {c.get('verb') or 'called'} — {_where(p)}{extra} — {ep.when_label(c)}"
                     if p["kind"] == "strike" else
                     f"{name}: {c['label_en']} {c.get('verb') or 'called'} at {p['name']} — {ep.when_label(c)}")
            reason = ((f"a {c['label_en'].lower()} {c.get('verb') or 'called'} — goods may not move by rail, sea "
                       f"or road in the area (source: {p['source']})") if p["kind"] == "strike" else
                      f"a blockade called at a site that matters for supply (source: {p['source']})")
            out.append({
                "id": f"EPL-S-{_sid(p['id'], c['key'])}", "source": ep.SOURCE, "alert_type": TYPE_SUPPLY,
                "title": title, "severity": "high", "lat": p["lat"], "lon": p["lon"],
                "region": p.get("region") or p.get("city") or name, "country_code": p.get("country"),
                "entity_type": "place", "entity_id": p["id"], "entity_name": p["name"], "confidence": 0.75,
                "message": ep.call_line(c, p["source"]) + ".", "reason": reason,
                "expires_at": ep._expires(c.get("end_date") or c["date"]),
                "raw": {"rule": "endangered_place_supply_call", "place_id": p["id"], "kind": p["kind"],
                        "country": p.get("country"), "call": {k: c.get(k) for k in
                                                              ("kind", "label_en", "level", "date", "end_date", "time", "topic")},
                        "reason": reason, "source_url": c.get("source_url") or p["source_url"]},
                "_sig": [c["key"]],
            })
    return out


def plan(places: list[dict], sent: dict, now: _dt.datetime) -> dict:
    new, upd = [], []
    for a in country_alerts(places, now) + supply_alerts(places, now):
        if a["id"] not in sent:
            new.append(a)
        elif sent[a["id"]] != a["_sig"]:
            upd.append(a)
    return {"new": new, "update": upd}
