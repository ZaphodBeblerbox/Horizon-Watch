"""
rss_pulse.py — what the news says about each country, for the risk index.

The owner (2026-10-18): the country risk index "needs to become a
cross-reference of GDELT, RSS, Telegram and GeoConfirmed", and Latin America
is covered too thinly.

Measured that day: RSS had stopped reaching the database on 2026-09-11, when
the article pipeline (Haiku per article, Nominatim per article) was retired,
so no country had any RSS reading at all. And that pipeline only ever read
English, French and German (its language gate dropped every Spanish and
Portuguese article before anything else looked at it), with English-only
keyword gates.

This is deliberately much cheaper than what was retired, and it does one
thing: per country, how much is being written, and how much of it is about
violence or unrest.

  - no model, no geocoder: an article belongs to the countries its title
    names (or, failing that, its summary), in English, Spanish, Portuguese or
    French (names, capitals, demonyms), else to the outlet's home country
    when the outlet is national (rss_feeds.NATIONAL_FEEDS)
  - violence and unrest are read from the same four languages by keyword,
    accents folded, sport and lottery headlines excluded, accidents and
    weather not counted as violence
  - every new article with a country is counted (rss_country_day) so the
    index can use a SHARE — a country with many outlets is not riskier for
    having them; only security articles are kept (rss_items), for 35 days
  - feeds rotate, FEEDS_PER_CYCLE a pass; a failing feed backs off

It writes SQLite only, so it runs in the worker (process_role.WORKER_ONLY),
from its own executor; nothing here may run on the event loop.
"""
from __future__ import annotations

import concurrent.futures as _cf
import datetime as _dt
import hashlib
import html
import os
import re
import sqlite3
import threading
import time
import unicodedata
import urllib.request

UA = "HorizonWatch/1.0 (+https://github.com/ZaphodBeblerbox/Horizon-Watch)"
FEEDS_PER_CYCLE = int(os.getenv("RSS_PULSE_FEEDS_PER_CYCLE", "70"))
FETCH_WORKERS = 8
FETCH_TIMEOUT_S = 15
MAX_BYTES = 3_000_000
ENTRIES_PER_FEED = 80
MAX_AGE_DAYS = 7
KEEP_DAYS = 35
SEEN_DAYS = 10
MAX_COUNTRIES_PER_ITEM = 3

DDL = [
    """CREATE TABLE IF NOT EXISTS rss_items (
        url TEXT NOT NULL, country TEXT NOT NULL, source TEXT, lang TEXT, title TEXT,
        published TEXT, ingested_at TEXT, conflict INTEGER, unrest INTEGER,
        home INTEGER,        -- filed under the outlet's home country (it named none)
        domestic INTEGER,    -- the outlet is this country's own press
        PRIMARY KEY (url, country))""",
    "CREATE INDEX IF NOT EXISTS ix_rss_items_country_pub ON rss_items (country, published)",
    "CREATE INDEX IF NOT EXISTS ix_rss_items_pub ON rss_items (published)",
    """CREATE TABLE IF NOT EXISTS rss_country_day (
        country TEXT NOT NULL, day TEXT NOT NULL, total INTEGER NOT NULL DEFAULT 0,
        domestic INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (country, day))""",
    "CREATE TABLE IF NOT EXISTS rss_seen (key TEXT PRIMARY KEY, day TEXT)",
]


# ── words ──────────────────────────────────────────────────────────────────

def fold(s: str | None) -> str:
    """Lowercase, accents removed, curly quotes straightened."""
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.replace("’", "'").replace("‘", "'").lower()


def _rx(words: list[str]) -> re.Pattern:
    return re.compile(r"(?<![a-z0-9])(?:" + "|".join(words) + r")(?![a-z0-9])")


# Violence: words that mean force was used, in EN / ES / PT / FR (folded).
STRONG_VIOLENCE = _rx([
    # en
    r"attack(?:s|ed|ers?)?", r"murder(?:s|ed)?", r"massacres?", r"shootings?", r"gunm[ae]n", r"gunfire",
    r"bomb(?:s|ing|ings|ed)?", r"explosions?", r"blasts?", r"air ?strikes?", r"drone strikes?", r"missiles?",
    r"rockets?", r"shelling", r"clash(?:es|ed)", r"armed groups?", r"militias?", r"rebels?", r"guerrillas?",
    r"cartels?", r"gangs?", r"kidnap(?:ped|ping|pings|s)?", r"hostages?", r"assassinat\w*", r"ambush(?:ed)?",
    r"insurgents?", r"terroris[mt]s?", r"jihadists?", r"lynch\w*", r"beheaded",
    # es
    r"ataques?", r"atac(?:an|aron|ado|ada|ados|adas)", r"tiros?", r"atentados?", r"asesinat\w*", r"asesin[oa]s?", r"asesinad[oa]s?", r"asesinan", r"asesino",
    r"masacres?", r"homicidios?", r"balaceras?", r"tiroteos?", r"disparos?", r"balead[oa]s?", r"explosivos?",
    r"bombas?", r"drones?", r"misiles?", r"enfrentamientos?", r"combates?", r"grupos? armados?", r"guerrillas?",
    r"disidencias?", r"eln", r"farc", r"clan del golfo", r"carteles?", r"pandillas?", r"pandilleros?",
    r"bandas? criminal(?:es)?", r"crimen organizado", r"secuestr\w*", r"rehenes", r"emboscadas?", r"sicari\w*",
    r"narcotrafic\w*", r"desaparecid[oa]s?", r"feminicidios?", r"extorsion(?:es)?", r"mataron", r"matan",
    r"ejecutad[oa]s?", r"fosas? clandestinas?", r"colectivos? armados?",
    # pt
    r"assassinat\w*", r"assassin[oa]s?", r"chacinas?", r"tiroteios?", r"explosao", r"confrontos?", r"faccao",
    r"faccoes", r"milicias?", r"milicianos?", r"sequestr\w*", r"refens", r"operacao policial", r"crime organizado",
    r"trafico de drogas", r"baleado", r"mortos a tiros",
    # fr
    r"attaques?", r"attentats?", r"assassinats?", r"fusillades?", r"enlevements?", r"otages?", r"affrontements?",
    r"groupes? armes?", r"bandits?", r"viv ansanm", r"kraze barye", r"tirs",
])
# Deaths and injuries: violence only when not an accident or a disaster.
WEAK_VIOLENCE = _rx([
    r"killed", r"kills?", r"killing", r"dead", r"deaths?", r"wounded", r"injured",
    r"muert[oa]s", r"heridos?", r"mortos", r"mortas", r"feridos?",
    r"tue(?:s|e|es)?", r"morts?", r"blesses?", r"soldiers?", r"troops", r"militares", r"ejercito", r"exercito",
    r"armee",
])
ACCIDENT = _rx([
    r"accidents?", r"crash(?:es|ed)?", r"collision", r"accidente", r"transito", r"naufragio",
    r"derrumbe", r"sismo", r"terremoto", r"lluvias", r"inundac\w*", r"incendio forestal", r"acidente",
    r"enchentes?", r"desabamento", r"caida", r"queda", r"incendios? forestal(?:es)?", r"queimadas?", r"incendios florestais", r"deslizamiento", r"huracan", r"furacao", r"tormenta", r"seisme",
    r"inondations?", r"earthquake", r"floods?", r"hurricane", r"storm",
])
UNREST = _rx([
    # en
    r"protests?", r"protesters?", r"protested", r"demonstrat\w*", r"riots?", r"rioters?", r"unrest", r"curfew",
    r"state of emergency", r"coup", r"military coup", r"crackdown", r"arrested", r"detained", r"blockades?", r"roadblocks?",
    r"general strike", r"on strike", r"uprising", r"looting", r"martial law",
    # es
    r"protestas?", r"manifestacion(?:es)?", r"manifestantes", r"disturbios", r"saqueos?",
    r"paro (?:nacional|armado|general|indefinido|civico)", r"huelgas?", r"bloqueos?", r"toque de queda",
    r"estado de (?:excepcion|emergencia|sitio)", r"golpe de estado", r"represion", r"detenid[oa]s",
    r"arrestad[oa]s", r"presos? politicos?", r"cacerolazos?", r"estallido social", r"inseguridad",
    # pt
    r"protestos?", r"manifestac(?:ao|oes)", r"manifestantes", r"greves?", r"bloqueios?", r"tumultos?",
    r"toque de recolher", r"inseguranca", r"estado de sitio", r"golpe (?:de estado|militar)", r"repressao", r"detid[oa]s",
    # fr
    r"manifestations?", r"emeutes?", r"greves?", r"barricades?", r"couvre-feu", r"etat d'urgence",
    r"coup d'etat", r"repression", r"pillages?", r"peyi lok", r"insecurite",
])
NOT_NEWS = _rx([
    r"futbol", r"futebol", r"football", r"soccer", r"liga (?:mx|profesional|betplay|1)", r"copa (?:america|libertadores|sudamericana|do brasil|del rey|mundial)", r"goles?", r"golazo", r"mundial de futbol",
    r"champions", r"premier league", r"nba", r"nfl", r"mlb", r"tenis", r"tennis", r"formula 1", r"f1",
    r"loteria", r"sorteo", r"horoscopo", r"recetas?", r"telenovela", r"beisbol",
    r"baseball", r"boxeo", r"ufc", r"premios oscar", r"grammy", r"netflix", r"selecao", r"hinchas?",
    r"torcida", r"clasico", r"partidazo", r"dia de (?:los )?muertos", r"extra ?innings?", r"jonron(?:es)?",
    r"lvbp", r"temporada regular", r"playoffs?", r"estreno", r"pelicula", r"serie de netflix",
])


def classify(text: str) -> dict:
    """{'conflict': bool, 'unrest': bool, 'sport': bool} for a title plus summary."""
    t = fold(text)
    sport = bool(NOT_NEWS.search(t))
    strong = bool(STRONG_VIOLENCE.search(t))
    weak = bool(WEAK_VIOLENCE.search(t)) and not ACCIDENT.search(t)
    conflict = (strong or weak) and not sport
    unrest = bool(UNREST.search(t)) and not sport
    return {"conflict": conflict, "unrest": unrest and not conflict, "sport": sport}


# ── countries ─────────────────────────────────────────────────────────────

#: Names in the languages the feeds are written in, capitals and demonyms,
#: added to the English names of every country (location_extract._iso_names).
ALIASES = {
    "ve": ["venezuela", "venezolan[oa]s?", "caracas", "maracaibo", "zulia", "tachira", "chavismo", "chavista"],
    "co": ["colombia", "colombian[oa]s?", "colombie", "colombia", "bogota", "medellin", "cali", "catatumbo",
           "cauca", "antioquia"],
    "mx": ["mexico", "mejico", "mexican[oa]s?", "mexique", "ciudad de mexico", "cdmx", "sinaloa", "culiacan",
           "michoacan", "tamaulipas", "jalisco", "chihuahua", "ciudad juarez", "tijuana"],
    "br": ["brasil", "brazil", "bresil", "brasileir[oa]s?", "brasilen[oa]s?", "brasilia", "sao paulo",
           "rio de janeiro"],
    "ec": ["ecuador", "equador", "ecuatorian[oa]s?", "equatorien", "quito", "guayaquil"],
    "pe": ["peru", "perou", "peruan[oa]s?", "peruvian"],
    "bo": ["bolivia", "bolivie", "bolivian[oa]s?", "cochabamba", "santa cruz de la sierra"],
    "ar": ["argentina", "argentine", "argentin[oa]s?", "buenos aires"],
    "cl": ["chile", "chilien", "chilen[oa]s?", "santiago de chile"],
    "ht": ["haiti", "haitian[oa]s?", "haitien(?:ne)?s?", "ayiti", "port-au-prince", "port au prince"],
    "gt": ["guatemala", "guatemaltec[oa]s?"],
    "hn": ["honduras", "hondurenn?[oa]s?", "tegucigalpa", "san pedro sula"],
    "sv": ["el salvador", "salvadorenn?[oa]s?", "san salvador"],
    "ni": ["nicaragua", "nicaraguense", "nicaraguenses", "managua"],
    "cr": ["costa rica", "costarricenses?"],
    "pa": ["panama", "panamenn?[oa]s?"],
    "cu": ["cuba", "cuban[oa]s?", "la habana", "havana", "habana"],
    "do": ["republica dominicana", "dominican republic", "republique dominicaine", "dominican[oa]s?",
           "santo domingo"],
    "py": ["paraguay", "paraguai", "paraguay[oa]s?", "asuncion"],
    "uy": ["uruguay", "uruguai", "uruguay[oa]s?", "montevideo"],
    "jm": ["jamaica", "jamaique"],
    "tt": ["trinidad y tobago", "trinidad and tobago", "trinite-et-tobago"],
    "gy": ["guyana", "guiana"],
    "sr": ["surinam", "suriname"],
    "pr": ["puerto rico", "porto rico"],
    "bz": ["belice", "belize"],
    "us": ["united states", "estados unidos", "eeuu", "ee\\.uu\\.", "ee uu", "eua", "etats-unis",
           "washington", "casa blanca", "white house", "pentagon", "pentagono"],
    "ca": ["canada", "canadienses?"],
    "fr": ["francia", "franca", "france", "frances(?:es)?", "francais", "paris"],
    "es": ["espana", "espanha", "spain", "espagne", "madrid"],
    "pt": ["portugal", "lisboa", "lisbon"],
    "it": ["italia", "italy", "italie"],
    "de": ["alemania", "alemanha", "germany", "allemagne", "berlin"],
    "gb": ["reino unido", "united kingdom", "royaume-uni", "britain", "londres", "london"],
    "ua": ["ucrania", "ucrania", "ukraine", "ucranian[oa]s?", "ukrainian", "kiev", "kyiv", "kiiv", "jarkov",
           "kharkiv", "odesa", "odessa"],
    "ru": ["rusia", "russia", "russie", "rus[oa]s?", "russian", "moscu", "moscou", "moscow", "kremlin"],
    "by": ["bielorrusia", "belarus", "bielorrussia", "minsk"],
    "ir": ["iran", "irani(?:an)?[oa]?s?", "teheran", "tehran", "teera"],
    "iq": ["irak", "iraque", "iraq", "bagdad", "baghdad"],
    "sy": ["siria", "syria", "syrie", "damasco", "damascus"],
    "lb": ["libano", "lebanon", "liban", "beirut", "beyrouth", "hezbollah", "hizbula"],
    "il": ["israel", "israeli(?:es)?", "israelenses?", "tel aviv", "jerusalen", "jerusalem"],
    "ps": ["palestina", "palestine", "gaza", "cisjordania", "west bank", "cisjordanie", "hamas"],
    "ye": ["yemen", "iemen", "houthis?", "hutis?"],
    "sa": ["arabia saudita", "arabia saudi", "saudi arabia", "arabie saoudite"],
    "tr": ["turquia", "turkey", "turkiye", "turquie", "ankara", "estambul", "istanbul"],
    "eg": ["egipto", "egito", "egypt", "egypte", "el cairo", "cairo"],
    "ly": ["libia", "libya", "libye", "tripoli"],
    "sd": ["sudan", "sudao", "soudan", "jartum", "khartoum"],
    "ss": ["sudan del sur", "south sudan", "soudan du sud"],
    "et": ["etiopia", "ethiopia", "ethiopie"],
    "so": ["somalia", "somalie", "mogadiscio", "mogadishu"],
    "ng": ["nigeria"],
    "ml": ["mali"],
    "bf": ["burkina faso"],
    "ne": ["niger"],
    "cd": ["republica democratica del congo", "rd congo", "rdc", "drc", "democratic republic of the congo",
           "kinshasa", "goma", "m23"],
    "af": ["afganistan", "afeganistao", "afghanistan", "kabul", "talibanes", "taliban"],
    "pk": ["pakistan", "paquistao", "islamabad"],
    "in": ["india", "inde", "nueva delhi", "new delhi"],
    "cn": ["china", "chine", "pekin", "beijing", "pequim"],
    "tw": ["taiwan", "taiwan", "taipei"],
    "kp": ["corea del norte", "coreia do norte", "north korea", "coree du nord", "pyongyang"],
    "kr": ["corea del sur", "coreia do sul", "south korea", "coree du sud", "seul", "seoul"],
    "jp": ["japon", "japao", "japan", "tokio", "tokyo"],
    "mm": ["myanmar", "birmania", "birmania", "birmanie", "burma", "burmese", "yangon", "rangun", "naypyidaw",
           "naypyitaw", "mandalay", "sagaing", "rakhine", "arakan", "kachin", "shan state", "karenni",
           "tatmadaw", "junta militar birmana"],
    "th": ["tailandia", "thailand", "thailande", "bangkok"],
    "ph": ["filipinas", "philippines", "manila"],
    "id": ["indonesia", "indonesie", "yakarta", "jakarta"],
    "bd": ["bangladesh", "dhaka"],
    "ge": ["tbilisi"],
}

#: Phrases that contain a country name but are not about it.
NOT_COUNTRY = _rx([
    r"new mexico", r"nuevo mexico", r"british columbia", r"district of columbia", r"golfo de mexico",
    r"gulf of mexico", r"mexico city fc", r"chile con carne", r"chili", r"guinea pigs?", r"turkey day",
    r"panama papers", r"canal de panama", r"panama canal", r"santa cruz de tenerife", r"real madrid",
    r"paris saint-germain", r"psg", r"atletico de madrid", r"rio de la plata", r"jordan peterson",
    r"michael jordan", r"chad smith", r"niger delta",
])

_NAME_SKIP = {"georgia", "jordan", "chad", "guinea", "dominica", "niger", "panama"}  # handled with care
_MATCHER: tuple[re.Pattern, dict] | None = None
_MATCHER_LOCK = threading.Lock()


def _matcher() -> tuple[re.Pattern, dict]:
    global _MATCHER
    if _MATCHER is not None:
        return _MATCHER
    with _MATCHER_LOCK:
        if _MATCHER is not None:
            return _MATCHER
        pats: dict[str, str] = {}
        try:
            import location_extract as le
            for code, name in le._iso_names().items():
                if len(code) != 2 or not name:
                    continue
                n = fold(name)
                if n in _NAME_SKIP or len(n) < 4:
                    continue
                pats[re.escape(n)] = code
        except Exception:                                      # noqa: BLE001
            pass
        for code, words in ALIASES.items():
            for w in words:
                pats[w] = code
        pats["panama"] = "pa"            # the country, once "canal de panama" and "panama papers" are removed
        pats["niger"] = "ne"
        # Longest first, so "sudan del sur" wins over "sudan", "republica
        # dominicana" over "dominicana".
        order = sorted(pats, key=lambda p: -len(p.replace("\\", "")))
        rx = re.compile(r"(?<![a-z0-9])(" + "|".join(f"(?:{p})" for p in order) + r")(?![a-z0-9])")
        compiled = [(re.compile(f"^(?:{p})$"), c) for p, c in ((p, pats[p]) for p in order)]
        _MATCHER = (rx, {"compiled": compiled})
        return _MATCHER


def countries_in(text: str) -> list[str]:
    """ISO alpha-2 codes of the countries a text names, in order of first
    mention, without duplicates."""
    t = fold(text)
    if not t:
        return []
    t = NOT_COUNTRY.sub(" ", t)
    rx, meta = _matcher()
    out: list[str] = []
    for m in rx.finditer(t):
        word = m.group(1)
        for p, code in meta["compiled"]:
            if p.match(word):
                if code not in out:
                    out.append(code)
                break
    return out


def item_countries(title: str, summary: str, home: str | None) -> tuple[list[str], bool]:
    """(countries, filed under the outlet's home country)."""
    cs = countries_in(title)
    if not cs:
        cs = countries_in(summary[:400])
    if cs:
        return cs[:MAX_COUNTRIES_PER_ITEM], False
    return ([home], True) if home else ([], False)


# ── feeds ─────────────────────────────────────────────────────────────────

def feed_list() -> list[dict]:
    """National outlets first, then the global registry; one entry per URL."""
    import rss_feeds as rf
    out, seen = [], set()
    for name, url, cc, lang in rf.NATIONAL_FEEDS:
        if url not in seen:
            seen.add(url)
            out.append({"name": name, "url": url, "home": cc, "lang": lang})
    meta = getattr(rf, "RSS_FEED_META", {})
    for entry in rf.ADDITIONAL_SCAN_FEEDS:
        if not isinstance(entry, tuple) or len(entry) != 2:
            continue
        name, url = entry
        if not url or url in seen or (meta.get(url) or {}).get("region") == "space":
            continue
        seen.add(url)
        out.append({"name": name, "url": url, "home": None, "lang": None})
    return out


_STATE = {"cursor": 0}
_BACKOFF: dict[str, tuple[int, float]] = {}      # url -> (consecutive failures, retry after)


def _due(feeds: list[dict], now: float) -> list[dict]:
    live = [f for f in feeds if _BACKOFF.get(f["url"], (0, 0.0))[1] <= now]
    if not live:
        return []
    start = _STATE["cursor"] % len(live)
    pick = (live[start:] + live[:start])[:FEEDS_PER_CYCLE]
    _STATE["cursor"] = start + len(pick)
    return pick


def _fetch(feed: dict):
    import feedparser
    req = urllib.request.Request(feed["url"], headers={
        "User-Agent": UA, "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"})
    with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT_S) as r:
        raw = r.read(MAX_BYTES)
    return feedparser.parse(raw)


_TAG = re.compile(r"<[^>]+>")


def _clean(s) -> str:
    return re.sub(r"\s+", " ", html.unescape(_TAG.sub(" ", str(s or "")))).strip()


def _published(e) -> _dt.datetime | None:
    pp = e.get("published_parsed") or e.get("updated_parsed")
    if not pp:
        return None
    try:
        return _dt.datetime(*pp[:6], tzinfo=_dt.timezone.utc)
    except Exception:                                          # noqa: BLE001
        return None


def read_entries(feed: dict, entries, now: _dt.datetime) -> list[dict]:
    """The usable entries of one parsed feed: fresh, with a link, read for
    countries and for violence/unrest. Pure: no database."""
    out = []
    for e in list(entries)[:ENTRIES_PER_FEED]:
        url = (e.get("link") or "").strip()
        title = _clean(e.get("title"))
        if not url or not title:
            continue
        pub = _published(e) or now
        if pub > now + _dt.timedelta(hours=6):
            pub = now
        if (now - pub).days >= MAX_AGE_DAYS:
            continue
        summary = _clean(e.get("summary") or e.get("description"))[:600]
        cs, home = item_countries(title, summary, feed.get("home"))
        sec = classify(f"{title} {summary[:300]}")
        out.append({"url": url, "title": title[:300], "published": pub, "countries": cs, "home": home,
                    "conflict": sec["conflict"], "unrest": sec["unrest"], "source": feed["name"],
                    "lang": feed.get("lang"), "outlet_home": feed.get("home")})
    return out


# ── storage ───────────────────────────────────────────────────────────────

def _db_path() -> str:
    from paths import DATA_DIR
    return os.path.join(str(DATA_DIR), "akili.db")


def connect(path: str | None = None) -> sqlite3.Connection:
    con = sqlite3.connect(path or _db_path(), timeout=30)
    for d in DDL:
        con.execute(d)
    return con


def _key(url: str) -> str:
    return hashlib.sha1(url.encode("utf-8", "ignore")).hexdigest()[:20]


def store(con: sqlite3.Connection, items: list[dict], now: _dt.datetime) -> dict:
    """Count new items per country and day; keep the security ones. Items
    already seen (by URL) are skipped, so a feed read twice counts once."""
    if not items:
        return {"new": 0, "kept": 0}
    keys = {_key(i["url"]): i for i in items}
    seen = set()
    ks = list(keys)
    for i in range(0, len(ks), 500):
        chunk = ks[i:i + 500]
        seen |= {r[0] for r in con.execute(
            f"SELECT key FROM rss_seen WHERE key IN ({','.join('?' * len(chunk))})", chunk)}
    fresh = [(k, it) for k, it in keys.items() if k not in seen]
    day_now = now.strftime("%Y-%m-%d")
    totals: dict[tuple[str, str], list[int]] = {}       # (country, day) -> [all, domestic press]
    rows = []
    for k, it in fresh:
        day = it["published"].strftime("%Y-%m-%d")
        for cc in it["countries"]:
            domestic = int(bool(it.get("outlet_home")) and it.get("outlet_home") == cc)
            t = totals.setdefault((cc, day), [0, 0])
            t[0] += 1
            t[1] += domestic
            if it["conflict"] or it["unrest"]:
                rows.append((it["url"], cc, it["source"], it["lang"], it["title"], it["published"].isoformat(),
                             now.isoformat(), int(bool(it["conflict"])), int(bool(it["unrest"])),
                             int(bool(it["home"])), domestic))
    with con:
        con.executemany("INSERT OR IGNORE INTO rss_seen (key, day) VALUES (?, ?)", [(k, day_now) for k, _ in fresh])
        con.executemany(
            "INSERT INTO rss_country_day (country, day, total, domestic) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(country, day) DO UPDATE SET total = total + excluded.total,"
            " domestic = domestic + excluded.domestic",
            [(cc, d, n, dn) for (cc, d), (n, dn) in totals.items()])
        con.executemany("INSERT OR IGNORE INTO rss_items (url, country, source, lang, title, published, ingested_at,"
                        " conflict, unrest, home, domestic) VALUES (?,?,?,?,?,?,?,?,?,?,?)", rows)
    return {"new": len(fresh), "kept": len(rows)}


def prune(con: sqlite3.Connection, now: _dt.datetime) -> None:
    keep = (now - _dt.timedelta(days=KEEP_DAYS))
    with con:
        con.execute("DELETE FROM rss_items WHERE published < ?", (keep.isoformat(),))
        con.execute("DELETE FROM rss_country_day WHERE day < ?", (keep.strftime("%Y-%m-%d"),))
        con.execute("DELETE FROM rss_seen WHERE day < ?",
                    ((now - _dt.timedelta(days=SEEN_DAYS)).strftime("%Y-%m-%d"),))


# ── one pass ──────────────────────────────────────────────────────────────

_RUN_LOCK = threading.Lock()


def run_cycle(now: _dt.datetime | None = None, db_path: str | None = None, feeds: list[dict] | None = None) -> dict:
    """Fetch the next slice of feeds and store what they say. Synchronous:
    call it from a worker thread, never the event loop."""
    if not _RUN_LOCK.acquire(blocking=False):
        return {"skipped": "already running"}
    t0 = time.monotonic()
    try:
        now = now or _dt.datetime.now(_dt.timezone.utc)
        pick = feeds if feeds is not None else _due(feed_list(), time.time())
        items, ok, failed = [], 0, 0
        with _cf.ThreadPoolExecutor(max_workers=FETCH_WORKERS, thread_name_prefix="rss-pulse") as ex:
            futs = {ex.submit(_fetch, f): f for f in pick}
            for fut in _cf.as_completed(futs):
                f = futs[fut]
                try:
                    parsed = fut.result()
                    entries = getattr(parsed, "entries", None) or []
                    if not entries:
                        raise ValueError("no entries")
                    items += read_entries(f, entries, now)
                    ok += 1
                    _BACKOFF.pop(f["url"], None)
                except Exception:                              # noqa: BLE001
                    failed += 1
                    n = _BACKOFF.get(f["url"], (0, 0.0))[0] + 1
                    # 1 h, 2 h, 4 h … at most a day: a dead feed costs a request a day
                    _BACKOFF[f["url"]] = (n, time.time() + min(86400, 3600 * 2 ** (n - 1)) if n >= 2 else 0.0)
        con = connect(db_path)
        try:
            res = store(con, items, now)
            prune(con, now)
        finally:
            con.close()
        out = {"feeds": len(pick), "ok": ok, "failed": failed, "entries": len(items), **res,
               "seconds": round(time.monotonic() - t0, 1)}
        print(f"[rss-pulse] {out}", flush=True)
        return out
    finally:
        _RUN_LOCK.release()


# ── what the index reads ──────────────────────────────────────────────────

def country_stats(days: int = 7, now: _dt.datetime | None = None, con: sqlite3.Connection | None = None) -> dict:
    """{alpha-2: {total, conflict, unrest, outlets, sources, domestic_total,
    domestic_conflict, domestic_unrest}} over the last `days`. `unrest`
    counts unrest without violence; domestic_* is the country's own press."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    since = now - _dt.timedelta(days=days)
    own = con is None
    if own:
        con = sqlite3.connect(f"file:{_db_path()}?mode=ro", uri=True, timeout=30)
    try:
        try:
            rows = con.execute(
                "SELECT country, source, SUM(conflict), SUM(unrest AND NOT conflict),"
                " SUM(conflict AND domestic), SUM(unrest AND NOT conflict AND domestic), COUNT(*) FROM rss_items"
                " WHERE published >= ? GROUP BY country, source", (since.isoformat(),)).fetchall()
            totals = con.execute(
                "SELECT country, SUM(total), SUM(domestic) FROM rss_country_day WHERE day >= ? GROUP BY country",
                (since.strftime("%Y-%m-%d"),)).fetchall()
        except sqlite3.OperationalError:                       # tables not made yet
            return {}
    finally:
        if own:
            con.close()
    out: dict[str, dict] = {}

    def blank():
        return {"total": 0, "conflict": 0, "unrest": 0, "outlets": 0, "sources": [],
                "domestic_total": 0, "domestic_conflict": 0, "domestic_unrest": 0}

    for cc, src, conflict, unrest, d_conf, d_unr, n in rows:
        d = out.setdefault(cc, blank())
        d["conflict"] += int(conflict or 0)
        d["unrest"] += int(unrest or 0)
        d["domestic_conflict"] += int(d_conf or 0)
        d["domestic_unrest"] += int(d_unr or 0)
        d["outlets"] += 1
        d["sources"].append({"source": src, "n": int(n)})
    for cc, total, dom in totals:
        d = out.setdefault(cc, blank())
        d["total"] = int(total or 0)
        d["domestic_total"] = int(dom or 0)
    for d in out.values():
        d["sources"].sort(key=lambda s: -s["n"])
        d["total"] = max(d["total"], d["conflict"] + d["unrest"])
    return out


def recent_items(cc2: str, limit: int = 8, days: int = 7, con: sqlite3.Connection | None = None) -> list[dict]:
    """The newest security articles about one country."""
    since = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=days)).isoformat()
    own = con is None
    if own:
        con = sqlite3.connect(f"file:{_db_path()}?mode=ro", uri=True, timeout=30)
    try:
        try:
            rows = con.execute(
                "SELECT url, title, source, published, conflict, unrest, lang FROM rss_items"
                " WHERE country = ? AND published >= ? ORDER BY published DESC LIMIT ?",
                (cc2.lower(), since, int(limit))).fetchall()
        except sqlite3.OperationalError:
            return []
    finally:
        if own:
            con.close()
    return [{"url": u, "title": t, "source": s, "published": p,
             "kind": "violence" if c else "unrest" if un else None, "lang": lg}
            for u, t, s, p, c, un, lg in rows]
