"""
telegram_signals.py — what Telegram members say they WILL do and where
they ARE, read as it is written, and merged into one readable signal.

THE OWNER (2026-10-17): "When people say on Telegram 'let's go attack the
Élysée Palace right now', we need the information that they're planning to
do that immediately ... a cleaned-up signal that is readable and easy to
take in", from the gilets jaunes groups and their regional and topic
subgroups, "ingested in real time and displayed in real time".

Two readings of every post, the cheap one first:

  RULES, at collection, no model. French, English and German verbs of
  collective action (attaquer, bloquer, occuper, se rassembler, storm,
  blockieren …), a call ("on va", "allez", "tous à", "let's"), the time
  ("maintenant", "tout de suite", "on y va", "go", "dans 30 min", "à 15h",
  "demain") and the target ("l'Élysée" → Palais de l'Élysée) — so an
  immediate call is known seconds after it is collected, not after a
  model batch. Self-reported positions ("on est à Concorde", "we're at
  Trafalgar Square") the same way.

  THE MODEL, in the classify pass that already runs (telegram_ingest.SYSTEM
  asks for `intent` and `at` in the same call — no extra request). It
  fills what the rules missed (a target written as a nickname, a phrasing
  no list holds). THE MODEL EXTRACTS, THE CODE RESOLVES: a place becomes
  coordinates only through LANDMARKS below or the geocoder's publish rule
  (telegram_ingest.locate); immediacy is decided by the words in the post
  or the model's "now", checked against the post's own time.

WHERE IT IS KEPT — table telegram_intents, one row per intent or position
(schema in DDL below; demonstrations.py and anything else read it with
plain SQL). Unified signals are DERIVED ON READ (signals()), never stored:
a fix to the merge rule applies to everything already collected.

ONE THING, ONE SIGNAL. Twenty members writing "on va à l'Élysée",
"go Élysée maintenant", "on est devant l'Élysée" in ten minutes are one
signal: same target (within SAME_PLACE_KM, or the same name when it could
not be placed), same act, each message within MERGE_GAP_MIN of the last.
It says how many messages and chats are behind it and links each one.
"""
from __future__ import annotations

import datetime as _dt
import json
import math
import re
import sqlite3
import time
import unicodedata

DDL = [
    # One row per intent (kind='intent') or self-reported position
    # (kind='at') read out of a post. idx numbers them within the post.
    """CREATE TABLE IF NOT EXISTS telegram_intents (
        channel TEXT NOT NULL, msg_id INTEGER NOT NULL, idx INTEGER NOT NULL,
        kind TEXT NOT NULL,          -- intent | at
        act TEXT,                    -- gather | march | block | attack | occupy | strike | sabotage | other (intent only)
        target TEXT,                 -- the place or object as named, made explicit ("Palais de l'Élysée")
        place TEXT,                  -- "Name, City, Country" as resolved, or as written when it did not resolve
        lat REAL, lon REAL,          -- NULL when the place did not resolve
        country TEXT,                -- ISO 3166-1 alpha-2, lowercase
        when_text TEXT,              -- the words that gave the time ("maintenant", "dans 30 min", "demain 15h")
        when_kind TEXT,              -- now | relative | time | date | NULL (no time said)
        starts_utc TEXT,             -- ISO UTC when the time resolves (now = the post's time)
        immediate INTEGER,           -- 1: now, or within IMMEDIATE_MIN of the post
        at_time TEXT,                -- kind='at': when they say they were there (UTC; the post's time unless stated)
        who TEXT,                    -- who is called or who calls, when said
        confidence REAL,             -- 0..1
        topic_id INTEGER, topic_title TEXT,   -- the forum topic the post was written in, if any
        posted_at TEXT,
        source TEXT,                 -- rule | model | rule+model
        PRIMARY KEY (channel, msg_id, idx))""",
    "CREATE INDEX IF NOT EXISTS ix_telegram_intents_posted ON telegram_intents (posted_at)",
]

ACTS = ("gather", "march", "block", "attack", "occupy", "strike", "sabotage", "other")
CALL_NEAR = 60             # characters: a call word this close to the act
IMMEDIATE_MIN = 60           # "dans 30 min" is as urgent as "maintenant" for someone nearby
SAME_PLACE_KM = 0.6
MERGE_GAP_MIN = 60           # a quieter thread of the same call is still the same call
SIGNAL_HOURS = 72
CACHE_S = 15


# ── words ───────────────────────────────────────────────────────────────────

def fold(s: str | None) -> str:
    """Lowercase without accents or curly apostrophes, for matching. One
    character for one, so a match's position is the original's too."""
    out = []
    for c in (s or ""):
        if c in "’`":
            out.append("'")
            continue
        d = "".join(x for x in unicodedata.normalize("NFKD", c) if not unicodedata.combining(x)).lower()
        out.append(d if len(d) == 1 else c.lower()[:1] or c)
    return "".join(out)


# Verbs and nouns of collective action, by act. Matched on folded text.
ACT_WORDS = [
    ("attack", r"attaqu(?:er|ons|ez|e)\b|(?:prendre|prenons|prenez) d'assaut|a l'assaut|defonc\w*|saccag\w*|incendi(?:er|ons|ez)\b|"
               r"brul(?:er|ons|ez)\b|storm(?:ing)?\b|attack\b|raid\b|sturmen\b|sturmt\b|angreifen\b"),
    ("occupy", r"occup(?:er|ons|ez|e|y|ying)\b|envahi(?:r|ssons|ssez)\b|(?:prendre|prenons|prenez|reprendre|reprenons) (?:la|le|les|l')\s?\w|"
               r"take over|seize\b|besetzen\b"),
    ("block", r"bloqu(?:er|ons|ez|e)\b|blocage\w*|barrage\w*|block\b|blockade|blockier(?:en|t)\b"),
    ("sabotage", r"sabot\w*"),
    ("march", r"march(?:er|ons|ez|ing|e)\b|defil\w*|cortege|monter (?:sur|a)|montons|converg\w*|march on\b|"
              r"marschier\w*"),
    ("gather", r"rassembl\w*|\brdv\b|rendez[- ]vous|rejoi(?:ndre|gnez|gnons|ns|nt)\b|retrouv(?:er|ons|ez)\b|"
               r"(?:se |nous )?reunir\b|reunissons|gather\b|meet (?:at|up)|rally\b|join us|versammel\w*|treff(?:en|punkt)\b"),
    ("strike", r"\bgreve\b|general strike|streik\w*"),
    # Spanish (Venezuela, 2026-10-18): the same acts as people there write them
    ("block", r"trancaz\w*|tranc(?:ar|amos|quemos)\b|guarimb\w*|bloque(?:ar|emos|amos)\b|cerr(?:ar|emos|amos) (?:la|el|las|los) (?:autopista|calle|via|vias|avenida)"),
    ("occupy", r"tom(?:ar|emos|amos) (?:la|el|las|los)\s\w"),
    ("march", r"march(?:ar|emos|amos)\b|marcha (?:hacia|hasta|a)\b"),
    ("gather", r"concentr(?:arnos|emonos|ense|acion)\w*|nos vemos en|punto de encuentro|convocatoria|cacerolazo\w*"),
    ("strike", r"\bparo (?:nacional|civico|general)\b|\bhuelga\b"),
]
_ACT_RE = [(a, re.compile(rf"(?<![\w])(?:{w})", re.I)) for a, w in ACT_WORDS]

# A CALL, not a report: "ils attaquent" is news; "on va attaquer" is a plan.
CALL = re.compile(
    r"\b(allons|allez|on va|on y va|venez|viens|rejoignez|tous (?:a|au|aux|devant|sur|vers|ensemble)|toutes et tous|"
    r"appel(?:le|lent|ons|ez)? a|appeles? a|il faut|faut (?:aller|qu)|go(?:[ ,!]*go)+\b|go *[!🔥⚡]|(?:^|\n|[.!?] )\W*go\b|go (?:a|au|vers|sur)\b|let'?s|come to|everyone to|join us|"
    r"kommt|lasst uns|auf zum|alle (?:zum|zur|nach)|on se retrouve|on se rejoint|rdv|rendez[- ]vous|"
    r"prenons|bloquons|occupons|attaquons|marchons|montons|rassemblons|envahissons|"
    r"on (?:bloque|attaque|occupe|prend|monte|marche|envahit|rejoint|se rejoint|se retrouve|y va|fonce)\b|"
    r"we (?:block|attack|storm|occupy|march|take)\b|wir (?:blockieren|sturmen|besetzen|gehen)|"
    r"vamos (?:a|todos|todas)\b|todos (?:a|al|a la|pa)\b|todas a\b|a la calle|salgamos|convocamos|nos vemos (?:en|a)\b|"
    r"hay que (?:ir|salir|tomar|trancar)|vengan a\b)", re.I)

NOW = re.compile(
    r"(maintenant|tout de suite|immediat\w*|de suite\b|sur le champ|des maintenant|on y va|go\s*go|\bgo\b\s*[!🔥⚡]|"
    r"la maintenant|right now|\bnow\b|immediately|\basap\b|\bjetzt\b|\bsofort\b|ce moment meme|"
    r"ahora mismo|ya mismo|\bahorita\b|en este momento)", re.I)
RELATIVE = re.compile(
    r"\b(?:dans|in)\s+(?P<n>\d{1,3}|une|un|une demi|an|a|one|half an|deux|two|trois|three|quinze|vingt|trente|"
    r"einer|zwei)\s*-?\s*(?P<u>min(?:ute)?s?|mn|h\b|heures?|hours?|hrs?|stunden?|minuten)", re.I)
CLOCK = re.compile(
    r"(?:(?:\ba|\bat|\bvers|\bdes|\bum|\bfor|\bdemain|\bce soir|\btomorrow|\bpour)\s*)?"
    r"\b(?P<h>[01]?\d|2[0-3])\s*(?:h|:|heures?\b)\s*(?P<m>[0-5]\d)?(?!\d)|"
    r"\b(?P<h2>1[0-2]|0?[1-9])(?::(?P<m2>[0-5]\d))?\s*(?P<ap>am|pm)\b|\b(?P<h3>[01]?\d|2[0-3])\s*uhr\b", re.I)
DAYWORDS = {"demain": 1, "tomorrow": 1, "morgen": 1, "ce soir": 0, "tonight": 0, "heute abend": 0, "aujourd'hui": 0,
            "today": 0, "heute": 0}
DAY_RE = re.compile(r"\b(demain|tomorrow|morgen|ce soir|tonight|heute abend|aujourd'hui|today|heute)\b", re.I)
WEEKDAYS = {d: i for i, names in enumerate([
    ("lundi", "monday", "montag"), ("mardi", "tuesday", "dienstag"), ("mercredi", "wednesday", "mittwoch"),
    ("jeudi", "thursday", "donnerstag"), ("vendredi", "friday", "freitag"), ("samedi", "saturday", "samstag"),
    ("dimanche", "sunday", "sonntag")]) for d in names}
WEEKDAY_RE = re.compile(r"\b(" + "|".join(WEEKDAYS) + r")\b", re.I)

# "on est à Concorde", "we're at Trafalgar Square", "wir sind am Alexanderplatz"
POSITION = re.compile(
    r"\b(on est|on (?:se )?trouve|nous sommes|je suis|j'suis|chui|on arrive|on est arrives?|nous voila|"
    r"we'?re|we are|we just (?:got|arrived)|wir sind|ich bin|estamos|ya estamos|nos encontramos|seguimos|llegamos)\s+"
    r"(?:actuellement\s+|deja\s+|now\s+|still\s+|bien\s+|toujours\s+|grade\s+|tous\s+|plusieurs\s+|\d+\s+|nombreux\s+|todos\s+|ya\s+)*"
    r"(?P<prep>a|au|aux|sur|devant|vers|pres de|place|rue|at|in|on|outside|near|by|am|an der|beim|vor dem|vor der|auf dem|"
    r"en|frente a|frente al)\b", re.I)

STREET = {"rue", "place", "pont", "quai", "gare", "porte", "boulevard", "bd", "avenue", "av", "cours", "parvis",
          "rond-point", "square", "esplanade", "carrefour", "allee", "impasse", "street", "st", "road", "bridge",
          "station", "platz", "strasse", "straße", "brucke", "tor",
          "plaza", "avenida", "calle", "autopista", "redoma", "distribuidor"}
PARTICLE = {"de", "du", "des", "la", "le", "les", "d'", "l'", "saint", "sainte", "st", "ste", "sur", "en", "of", "the",
            "am", "an", "der", "die", "dem", "del", "el", "los", "las"}
SKIP = {"a", "au", "aux", "sur", "devant", "vers", "pres", "de", "la", "le", "les", "l'", "d'", "at", "in", "on", "to",
        "the", "outside", "near", "by", "am", "an", "der", "die", "das", "dem", "beim", "vor", "auf", "zum", "zur"}
STOP = {"et", "avec", "mais", "il", "ils", "elle", "elles", "on", "nous", "vous", "je", "and", "with", "but", "we",
        "they", "because", "car", "pour", "qui", "que", "quand", "maintenant", "now", "demain", "ce", "soir", "go",
        "tout", "toute", "tous", "dans", "in", "a", "à", "et", "y", "en", "là", "la-bas", "ici", "here", "there",
        "jetzt", "sofort", "und", "mit", "um", "a", "pour", "contre", "against", "right", "immediately", "asap"}
NOT_A_PLACE = {"maison", "chez", "boulot", "travail", "home", "work", "fond", "bloc", "deux", "plusieurs", "combien",
               "nombreux", "pret", "prets", "ready", "hause", "arbeit", "dispo", "cote", "l'heure", "temps", "retard",
               "fin", "mode", "debut", "moment", "live", "direct", "rdv", "rendez-vous", "toi", "vous", "eux",
               "nous", "lui", "the", "a", "an", "it", "this", "that", "ce", "cette", "bout"}

WHO = re.compile(r"\b(?:les|tous les|toutes les|all|the)\s+(lyceens|etudiants|gilets jaunes|agriculteurs|routiers|"
                 r"taxis|syndicats|cheminots|students|farmers|truckers|unions|black bloc|antifas?|supporters|ultras)\b", re.I)

# ── places everyone means by one word ───────────────────────────────────────
# The usual targets of a Paris call, by the words people use for them. Fixed
# points (WGS84), so "l'Élysée" never depends on the geocoder's day. Each:
# (folded pattern, canonical place, lat, lon, country).
LANDMARKS = [
    (r"champs[- ]elysees", "Avenue des Champs-Élysées, Paris, France", 48.8698, 2.3075, "fr"),
    (r"(?<!champs[- ])(?<!champs)\b(?:palais de l')?elysee\b(?!s)", "Palais de l'Élysée, Paris, France", 48.8704, 2.3167, "fr"),
    (r"assemblee nationale|palais bourbon|\bl'assemblee\b", "Assemblée nationale, Paris, France", 48.8619, 2.3186, "fr"),
    (r"\bmatignon\b", "Hôtel de Matignon, Paris, France", 48.8546, 2.3205, "fr"),
    (r"\bsenat\b|palais du luxembourg", "Sénat (Palais du Luxembourg), Paris, France", 48.8483, 2.3371, "fr"),
    (r"\bconcorde\b", "Place de la Concorde, Paris, France", 48.8656, 2.3212, "fr"),
    (r"\bbastille\b", "Place de la Bastille, Paris, France", 48.8532, 2.3692, "fr"),
    (r"place de la republique|(?:\ba|\bau|\bvers|\bsur|\bdevant) (?:la )?(?:republique|repu)\b", "Place de la République, Paris, France", 48.8674, 2.3636, "fr"),
    (r"place de la nation|(?:\ba|\bvers|\bsur|\bdevant) (?:la )?nation\b", "Place de la Nation, Paris, France", 48.8483, 2.3959, "fr"),
    (r"arc de triomphe|place de l'etoile|charles[- ]de[- ]gaulle[- ]etoile", "Arc de Triomphe, Paris, France", 48.8738, 2.2950, "fr"),
    (r"place beauvau|\bbeauvau\b|ministere de l'interieur", "Ministère de l'Intérieur (Place Beauvau), Paris, France", 48.8722, 2.3165, "fr"),
    (r"\btrocadero\b", "Place du Trocadéro, Paris, France", 48.8616, 2.2893, "fr"),
    (r"tour eiffel|eiffel tower", "Tour Eiffel, Paris, France", 48.8584, 2.2945, "fr"),
    (r"place d'italie", "Place d'Italie, Paris, France", 48.8311, 2.3557, "fr"),
    (r"gare du nord", "Gare du Nord, Paris, France", 48.8809, 2.3553, "fr"),
    (r"gare de l'est", "Gare de l'Est, Paris, France", 48.8768, 2.3592, "fr"),
    (r"\bopera\b(?! bastille)", "Opéra Garnier, Paris, France", 48.8720, 2.3316, "fr"),
    (r"opera bastille", "Place de la Bastille, Paris, France", 48.8532, 2.3692, "fr"),
    (r"bellecour", "Place Bellecour, Lyon, France", 45.7578, 4.8320, "fr"),
    (r"vieux[- ]port", "Vieux-Port, Marseille, France", 43.2951, 5.3740, "fr"),
    (r"capitole de toulouse|place du capitole", "Place du Capitole, Toulouse, France", 43.6045, 1.4440, "fr"),
    (r"\breichstag\b|\bbundestag\b", "Reichstag, Berlin, Germany", 52.5186, 13.3762, "de"),
    (r"brandenburger tor|brandenburg gate", "Brandenburger Tor, Berlin, Germany", 52.5163, 13.3777, "de"),
    (r"kanzleramt", "Bundeskanzleramt, Berlin, Germany", 52.5202, 13.3690, "de"),
    (r"downing street", "10 Downing Street, London, United Kingdom", 51.5034, -0.1276, "gb"),
    (r"trafalgar square", "Trafalgar Square, London, United Kingdom", 51.5080, -0.1281, "gb"),
]
_LANDMARK_RE = [(re.compile(p), name, lat, lon, cc) for p, name, lat, lon, cc in LANDMARKS]


def landmark(text: str | None) -> dict | None:
    t = fold(text)
    for rx, name, lat, lon, cc in _LANDMARK_RE:
        if rx.search(t):
            return {"place": name, "lat": lat, "lon": lon, "country": cc, "name": name.split(",")[0]}
    # the places as people write them ("Bastoche", "Répu", "Plaza Altamira",
    # "Sule"): street_reports.py's gazetteer, squares and sites only
    try:
        import street_reports
        p = street_reports.place_in(text)
    except Exception:                                          # noqa: BLE001
        p = None
    if p and p["kind"] in ("square", "site"):
        country = {"fr": "France", "ve": "Venezuela", "mm": "Myanmar"}.get(p["country"], p["country"].upper())
        return {"place": f"{p['name']}, {p['city']}, {country}", "lat": p["lat"], "lon": p["lon"], "country": p["country"],
                "name": p["name"]}
    return None


# ── topic context ───────────────────────────────────────────────────────────
# A forum supergroup's topics say what a thread is for: "Pourquoi on
# manifeste" holds the why, "Région Bretagne" the where (the owner,
# 2026-10-17, on Le Grand Café's subgroups).
REGIONS = {
    "ile-de-france": "Île-de-France", "idf": "Île-de-France", "paris": "Paris", "bretagne": "Bretagne",
    "normandie": "Normandie", "hauts-de-france": "Hauts-de-France", "hdf": "Hauts-de-France", "paca": "Provence-Alpes-Côte d'Azur",
    "provence": "Provence-Alpes-Côte d'Azur", "occitanie": "Occitanie", "nouvelle-aquitaine": "Nouvelle-Aquitaine",
    "grand est": "Grand Est", "grand-est": "Grand Est", "auvergne": "Auvergne-Rhône-Alpes", "rhone-alpes": "Auvergne-Rhône-Alpes",
    "bourgogne": "Bourgogne-Franche-Comté", "franche-comte": "Bourgogne-Franche-Comté", "centre-val de loire": "Centre-Val de Loire",
    "pays de la loire": "Pays de la Loire", "corse": "Corse", "lyon": "Lyon", "marseille": "Marseille", "toulouse": "Toulouse",
    "bordeaux": "Bordeaux", "nantes": "Nantes", "lille": "Lille", "rennes": "Rennes", "strasbourg": "Strasbourg",
    "montpellier": "Montpellier", "nice": "Nice",
}
WHY_WORDS = re.compile(r"\b(pourquoi|revendication\w*|raisons?|why|demands?|nos causes?|cahier|manifeste\b|programme)", re.I)


def topic_context(title: str | None) -> dict:
    """{'region': 'Bretagne' | None, 'why': bool} from a topic's title."""
    t = fold(title)
    region = None
    for k, v in sorted(REGIONS.items(), key=lambda kv: -len(kv[0])):
        if re.search(rf"(?<![\w-]){re.escape(k)}(?![\w-])", t):
            region = v
            break
    return {"region": region, "why": bool(WHY_WORDS.search(t))}


# ── phrases ─────────────────────────────────────────────────────────────────

_TOKEN = re.compile(r"[\w'’\-\.]+|[^\w\s]", re.U)


def _phrase_after(text: str, pos: int, street_mode_ok: bool = True) -> str | None:
    """The place-like phrase that starts at `pos`: prepositions skipped, then
    a street word ("boulevard saint germain") or a capitalised name
    ("Concorde", "LA BASTILLE"), up to six words."""
    toks = _TOKEN.findall(text[pos:pos + 160].split("\n")[0])
    i = 0
    while i < len(toks) and fold(toks[i]).rstrip("'") + ("'" if toks[i].endswith(("'", "’")) else "") in SKIP | {"l'", "d'"}:
        i += 1
    # an elided article glued to the word: "l'Élysée", "d'Italie"
    words: list[str] = []
    street = False
    for j in range(i, min(len(toks), i + 8)):
        w = toks[j]
        f = fold(w)
        if not re.match(r"[\w']", f):
            break                                           # punctuation ends the phrase
        if f in STOP and words:
            break
        if not words:
            core = re.sub(r"^[ld]'", "", f)
            if f in STREET and street_mode_ok:
                street = True
            elif not (w[:1].isupper() or re.sub(r"^[ldLD]['’]", "", w)[:1].isupper()) or core in NOT_A_PLACE or core in STOP:
                return None
        elif not street and not (w[:1].isupper() or f in PARTICLE or w[:1].isdigit()):
            break
        words.append(w)
        if len(words) >= 6:
            break
    while words and fold(words[-1]) in PARTICLE:
        words.pop()
    if not words or (street and len(words) < 2):
        return None
    phrase = " ".join(words).strip(" .-")
    return phrase if len(phrase) >= 3 else None


def _clean_target(s: str) -> str:
    s = re.sub(r"^(?:l|d)['’]\s*", "", s.strip(), flags=re.I)
    s = re.sub(r"^(?:la|le|les|the)\s+", "", s, flags=re.I)
    if s.isupper():
        s = s.title()
    return s[:1].upper() + s[1:]


# ── time ────────────────────────────────────────────────────────────────────

_NUM = {"une": 1, "un": 1, "an": 1, "a": 1, "one": 1, "einer": 1, "deux": 2, "two": 2, "zwei": 2, "trois": 3, "three": 3,
        "quinze": 15, "vingt": 20, "trente": 30, "une demi": 0.5, "half an": 0.5}


def _parse_posted(posted_at: str) -> _dt.datetime:
    d = _dt.datetime.fromisoformat(str(posted_at).replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=_dt.timezone.utc)


def _iso(d: _dt.datetime) -> str:
    return d.astimezone(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _zone(country: str | None):
    try:
        import telegram_events as te
        return te.zone_for(None, country) or _dt.timezone.utc
    except Exception:                                          # noqa: BLE001
        return _dt.timezone.utc


def read_when(text: str, posted_at: str, country: str | None = "fr") -> dict:
    """{when_text, when_kind, starts_utc, immediate} from the words of a
    post, resolved against the post's own time in the place's zone."""
    t = fold(text)
    posted = _parse_posted(posted_at)
    out = {"when_text": None, "when_kind": None, "starts_utc": None, "immediate": 0}
    m = NOW.search(t)
    if m:
        return {"when_text": m.group(0).strip(), "when_kind": "now", "starts_utc": _iso(posted), "immediate": 1}
    m = RELATIVE.search(t)
    if m:
        n = m.group("n").lower()
        val = float(n) if n.isdigit() else _NUM.get(n, 1)
        mins = val * (60 if m.group("u").lower().startswith(("h", "heure", "stund")) else 1)
        start = posted + _dt.timedelta(minutes=mins)
        return {"when_text": m.group(0).strip(), "when_kind": "relative", "starts_utc": _iso(start),
                "immediate": int(mins <= IMMEDIATE_MIN)}
    zone = _zone(country)
    local = posted.astimezone(zone)
    day = local.date()
    dm = DAY_RE.search(t)
    if dm:
        day = day + _dt.timedelta(days=DAYWORDS.get(dm.group(1).lower(), 0))
    else:
        # "samedi 14h", "Saturday": the next such day (today, if it is today)
        dm = WEEKDAY_RE.search(t)
        if dm:
            day = day + _dt.timedelta(days=(WEEKDAYS[dm.group(1).lower()] - day.weekday()) % 7)
    c = CLOCK.search(t)
    if c:
        if c.group("h") is not None:
            hh, mm = int(c.group("h")), int(c.group("m") or 0)
        elif c.group("h2") is not None:
            hh, mm = int(c.group("h2")) % 12 + (12 if c.group("ap").lower() == "pm" else 0), int(c.group("m2") or 0)
        else:
            hh, mm = int(c.group("h3")), 0
        start = _dt.datetime(day.year, day.month, day.day, hh, mm, tzinfo=zone)
        if not dm and start < local - _dt.timedelta(minutes=30):
            start += _dt.timedelta(days=1)                       # "à 9h" written at 22:00 is tomorrow
        mins = (start - posted).total_seconds() / 60
        words = (dm.group(0) + " " if dm else "") + c.group(0).strip()
        return {"when_text": words.strip(), "when_kind": "time", "starts_utc": _iso(start),
                "immediate": int(-30 <= mins <= IMMEDIATE_MIN)}
    if dm:
        start = _dt.datetime(day.year, day.month, day.day, tzinfo=zone)
        return {"when_text": dm.group(0), "when_kind": "date", "starts_utc": _iso(start) if day != local.date() else None,
                "immediate": 0}
    return out


# ── the rule reading ────────────────────────────────────────────────────────

def read_intents(text: str, posted_at: str, topic_title: str | None = None, country: str | None = None) -> list[dict]:
    """Calls to act in a post, by rule. Each: {act, target, place, lat, lon,
    country, when_text, when_kind, starts_utc, immediate, who, confidence}.
    A post needs an act AND a call (or a time) to count: "ils attaquent la
    préfecture" is a report, "on va attaquer la préfecture" is a plan."""
    if not text:
        return []
    t = fold(text)
    acts = []
    for act, rx in _ACT_RE:
        m = rx.search(t)
        if m:
            acts.append((m.start(), m.end(), act))
    if not acts:
        # "go go go Matignon", "tous à l'Élysée maintenant": no verb of
        # action, but a call to converge on a named place now
        lm0 = landmark(text)
        if lm0 and CALL.search(t) and NOW.search(t + " "):
            acts = [(0, 0, "march")]
        else:
            return []
    acts.sort()
    when = read_when(text, posted_at, country or "fr")
    # A plan is a call ("on va", "tous à", "rdv", "go") next to its act, or a
    # poster's headline: "Rassemblement samedi 14h place Bellecour" starts
    # with its act. News carrying the word in passing ("face aux blocages de
    # lycées … ce soir", AlertesInfos 2026-10-07; "his attack on the army
    # … those who go", a long quote on me_observer_TG) is neither.
    call = any(CALL.search(t[max(0, p - CALL_NEAR):e + CALL_NEAR]) for p, e, _a in acts)
    headline = any(re.match(r"\W*$", t[t.rfind("\n", 0, p) + 1:p]) for p, _e, _a in acts)
    if not (call or (headline and when["when_kind"])):
        return []
    lm = landmark(text)
    # The first act that names its object: "on bloque le périph, rdv Porte
    # Maillot" is a call to Porte Maillot. "PRENDRE LA BASTILLE": the
    # article belongs to the verb's object.
    act, target_phrase = acts[0][2], None
    for _pos, end, a in acts:
        ph = _phrase_after(text, end)
        if ph:
            act, target_phrase = a, ph
            break
    if lm:
        target, place, lat, lon, cc = lm["name"], lm["place"], lm["lat"], lm["lon"], lm["country"]
    elif target_phrase:
        target, place, lat, lon, cc = _clean_target(target_phrase), None, None, None, country
    else:
        target = place = lat = lon = None
        cc = country
    if not target:
        return []           # "bloquons tout demain": no place, not a located call (a reply may still carry one)
    who = WHO.search(t)
    conf = 0.45 + 0.2 * bool(call) + 0.15 * bool(lm or target) + 0.1 * bool(when["when_kind"])
    return [{"act": act, "target": target, "place": place, "lat": lat, "lon": lon, "country": cc,
             **when, "who": text[who.start(1):who.end(1)] if who else None, "confidence": round(min(0.9, conf), 2),
             "topic_title": topic_title}]


def read_positions(text: str, posted_at: str, topic_title: str | None = None, country: str | None = None) -> list[dict]:
    """Where the writer says they are now: [{place, lat, lon, country, at_time}]."""
    if not text:
        return []
    t = fold(text)
    out = []
    for m in POSITION.finditer(t):
        start = m.start("prep")
        prep = fold(m.group("prep"))
        # "on est place de la République": the street word is the preposition
        phrase = _phrase_after(text, start if prep in STREET or prep in ("place", "rue") else m.end())
        lm = landmark(phrase) if phrase else None
        if not phrase and not lm:
            continue
        if lm:
            out.append({"place": lm["place"], "target": lm["name"], "lat": lm["lat"], "lon": lm["lon"], "country": lm["country"]})
        else:
            out.append({"place": None, "target": _clean_target(phrase), "lat": None, "lon": None, "country": country})
        out[-1].update(at_time=_iso(_parse_posted(posted_at)), topic_title=topic_title, confidence=0.6)
    seen, uniq = set(), []
    for p in out:
        k = fold(p["target"])
        if k not in seen:
            seen.add(k)
            uniq.append(p)
    return uniq[:3]


def cues(text: str | None) -> bool:
    """The cheap pre-filter: is there anything here an intent or a position
    could be read from? Group chatter without it never reaches a model."""
    t = fold(text)
    return bool(t) and (any(rx.search(t) for _a, rx in _ACT_RE) or bool(POSITION.search(t))
                        or bool(landmark(text)) or bool(NOW.search(t) and CALL.search(t)))


# ── storage ─────────────────────────────────────────────────────────────────

def ensure(con) -> None:
    for d in DDL:
        con.execute(d)


def _resolve(item: dict, region: str | None, geocode_budget: list) -> None:
    """A named target without coordinates → the geocoder, by the pins' rule,
    in the topic's region (or the chat's) when known. Bounded per pass: the
    geocoder takes one request a second."""
    if item.get("lat") is not None or not item.get("target") or geocode_budget[0] <= 0:
        return
    cc = (item.get("country") or "").lower()
    if not cc:
        return
    try:
        from location_extract import country_name_from_code
        cname = country_name_from_code(cc) or cc.upper()
    except Exception:                                          # noqa: BLE001
        cname = cc.upper()
    geocode_budget[0] -= 1
    try:
        import telegram_ingest as tg
        q = ", ".join(x for x in (item["target"], region, cname) if x)
        hit, _why = tg.locate(q, "site", cc)
    except Exception:                                          # noqa: BLE001
        hit = None
    if hit:
        item.update(lat=hit["lat"], lon=hit["lon"], place=q)


def store(con, chan: str, msg_id: int, posted_at: str, items: list[dict], *, topic_id=None, topic_title=None,
          source: str = "rule") -> int:
    """Replace this post's rows with `items` (intents first, then positions)."""
    ensure(con)
    con.execute("DELETE FROM telegram_intents WHERE channel=? AND msg_id=?", (chan, msg_id))
    for i, x in enumerate(items):
        con.execute(
            "INSERT INTO telegram_intents (channel, msg_id, idx, kind, act, target, place, lat, lon, country, when_text,"
            " when_kind, starts_utc, immediate, at_time, who, confidence, topic_id, topic_title, posted_at, source)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (chan, msg_id, i, x["kind"], x.get("act"), x.get("target"), x.get("place") or x.get("target"),
             x.get("lat"), x.get("lon"), (x.get("country") or "").lower() or None, x.get("when_text"), x.get("when_kind"),
             x.get("starts_utc"), int(bool(x.get("immediate"))), x.get("at_time"), x.get("who"), x.get("confidence"),
             topic_id, topic_title, posted_at, x.get("source") or source))
    return len(items)


def chat_context(chan: str) -> dict:
    """The registry's country and region for a chat (telegram_channels.json)."""
    try:
        import telegram_ingest as tg
        with open(tg.CHANNELS_FILE) as fh:
            info = (json.load(fh).get(chan) or {})
    except Exception:                                          # noqa: BLE001
        info = {}
    lang = info.get("lang")
    cc = info.get("country") or {"fr": "fr", "de": "de"}.get(lang or "") or chat_country(chan)
    return {"country": cc, "region": info.get("region")}


_CHAT_CC: dict = {}
CHAT_CC_TTL_S = 3600


def dominant_country(codes: list) -> str | None:
    """The country a chat writes about: the model's country for at least 60 %
    of 5 or more of its recent posts. Pure."""
    codes = [str(c).lower() for c in codes if c and len(str(c)) == 2]
    if len(codes) < 5:
        return None
    top = max(set(codes), key=codes.count)
    return top if codes.count(top) >= 0.6 * len(codes) else None


def chat_country(chan: str) -> str | None:
    """A chat that is not in telegram_channels.json (the Venezuelan and
    Burmese chats the account joined, 2026-10-18) had no country, so its
    calls and positions were never geocoded (_resolve needs one) and every
    position was dropped. Derived on read from what the model said of its
    posts, cached an hour."""
    hit = _CHAT_CC.get(chan)
    if hit and time.time() - hit[0] < CHAT_CC_TTL_S:
        return hit[1]
    cc = None
    try:
        import telegram_ingest as tg
        con = tg._con()
        try:
            cutoff = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=7)).isoformat()
            codes = [r[0] for r in con.execute(
                "SELECT country_code FROM telegram_posts WHERE channel=? AND posted_at >= ? AND relevant=1"
                " AND country_code IS NOT NULL AND country_code != '' ORDER BY posted_at DESC LIMIT 200", (chan, cutoff))]
        finally:
            con.close()
        cc = dominant_country(codes)
    except Exception:                                          # noqa: BLE001
        cc = None
    _CHAT_CC[chan] = (time.time(), cc)
    return cc


def read_post(chan: str, msg_id: int, text: str, posted_at: str, topic_title: str | None = None,
              ctx: dict | None = None) -> list[dict]:
    """Every intent and position the rules read in one post (unresolved
    targets keep lat/lon None)."""
    ctx = ctx or chat_context(chan)
    tctx = topic_context(topic_title)
    cc = ctx.get("country")
    items = [{"kind": "intent", **x} for x in read_intents(text, posted_at, topic_title, cc)]
    items += [{"kind": "at", **x} for x in read_positions(text, posted_at, topic_title, cc)]
    for x in items:
        x["_region"] = tctx["region"] or ctx.get("region")
    return items


def answer_to_call(con, chan: str, reply_to: int, text: str, posted_at: str) -> list[dict]:
    """"go maintenant !" in answer to "on attaque l'Élysée ?": the reply
    carries the call's act and target, with its own time. Only a reply that
    says when counts — "+1" is not a plan."""
    when = read_when(text, posted_at)
    if not when["when_kind"]:
        return []
    parent = con.execute("SELECT act, target, place, lat, lon, country, who FROM telegram_intents"
                         " WHERE channel=? AND msg_id=? AND kind='intent' ORDER BY idx LIMIT 1", (chan, reply_to)).fetchone()
    if not parent:
        return []
    act, target, place, lat, lon, cc, who = parent
    return [{"kind": "intent", "act": act, "target": target, "place": place, "lat": lat, "lon": lon, "country": cc,
             **when, "who": who, "confidence": 0.55}]


def read_pending(limit: int = 400, geocode: int = 20) -> dict:
    """Posts not yet read for intents: by rule, at once, no model. Run right
    after every collection so an immediate call is a signal within seconds."""
    import telegram_ingest as tg
    con = tg._con()
    ensure(con)
    rows = con.execute("SELECT channel, msg_id, text, posted_at, topic_id, topic_title, reply_to FROM telegram_posts"
                       " WHERE intent_checked IS NULL AND text IS NOT NULL ORDER BY posted_at DESC LIMIT ?",
                       (limit,)).fetchall()[::-1]           # oldest first: a call is read before the replies to it
    budget = [geocode]
    n_int = n_at = 0
    ctxs: dict = {}
    for chan, mid, text, posted, topic_id, topic_title, reply_to in rows:
        ctx = ctxs.setdefault(chan, chat_context(chan))
        items = read_post(chan, mid, text, posted, topic_title, ctx) if cues(text) else []
        if not items and reply_to:
            items = answer_to_call(con, chan, reply_to, text, posted)
        for x in items:
            _resolve(x, x.pop("_region", None), budget)
        # a position is a point or nothing: "I'm in the Defense Ministry"
        # with no place found is not where a crowd is
        items = [x for x in items if x["kind"] == "intent" or x.get("lat") is not None]
        if items:
            store(con, chan, mid, posted, items, topic_id=topic_id, topic_title=topic_title)
            n_int += sum(1 for x in items if x["kind"] == "intent")
            n_at += sum(1 for x in items if x["kind"] == "at")
        con.execute("UPDATE telegram_posts SET intent_checked=1 WHERE channel=? AND msg_id=?", (chan, mid))
    con.commit()
    con.close()
    if n_int or n_at:
        invalidate()
    return {"intents_read": len(rows), "intents": n_int, "positions": n_at}


def merge_model(con, chan: str, msg_id: int, posted_at: str, x: dict, topic_id=None, topic_title=None,
                geocode_budget: list | None = None) -> int:
    """The classify pass's `intent` and `at` for one post, merged with what
    the rules read: the rules' immediacy and landmark stand; the model adds
    a target or an act the rules missed, or a whole intent they could not
    see. The model never gives coordinates."""
    ensure(con)
    budget = geocode_budget if geocode_budget is not None else [3]
    have = [dict(zip([c[0] for c in cur.description], r)) for cur in
            [con.execute("SELECT * FROM telegram_intents WHERE channel=? AND msg_id=? ORDER BY idx", (chan, msg_id))]
            for r in cur.fetchall()]
    ctx = chat_context(chan)
    region = topic_context(topic_title)["region"] or ctx.get("region")
    mi = x.get("intent") if isinstance(x.get("intent"), dict) else None
    at = str(x.get("at") or "").strip()
    cc = (x.get("country_code") or ctx.get("country") or "").lower() or None
    changed = False
    items = [{k: v for k, v in h.items() if k not in ("channel", "msg_id", "idx")} for h in have]
    if mi and str(mi.get("act") or "").lower() in ACTS:
        act = str(mi["act"]).lower()
        mtarget = str(mi.get("target") or "").strip()[:120] or None
        mwhen = str(mi.get("when") or "").strip()[:60]
        mine = next((h for h in items if h["kind"] == "intent"), None)
        lm = landmark(mtarget) if mtarget else None
        if mine:
            if not mine.get("target") and mtarget:
                mine.update(target=(lm or {}).get("name") or mtarget.split(",")[0].strip(), place=(lm or {}).get("place") or mtarget,
                            lat=(lm or {}).get("lat"), lon=(lm or {}).get("lon"))
            if not mine.get("who") and mi.get("who"):
                mine["who"] = str(mi["who"])[:60]
            mine["confidence"] = round(min(0.95, (mine.get("confidence") or 0.5) + 0.1), 2)
            mine["source"] = "rule+model"
            changed = True
        elif mtarget or fold(mwhen) in ("now", "immediately", "maintenant"):
            when = read_when(mwhen if fold(mwhen) not in ("now", "immediately") else "maintenant", posted_at, cc or "fr") \
                if mwhen else {"when_text": None, "when_kind": None, "starts_utc": None, "immediate": 0}
            items.insert(0, {"kind": "intent", "act": act, "target": (lm or {}).get("name") or (mtarget or "").split(",")[0].strip() or None,
                             "place": (lm or {}).get("place") or mtarget, "lat": (lm or {}).get("lat"), "lon": (lm or {}).get("lon"),
                             "country": (lm or {}).get("country") or cc, **when, "who": (str(mi.get("who") or "")[:60] or None),
                             "confidence": 0.55, "source": "model"})
            if not lm and mtarget:
                _resolve(items[0], region, budget)
                if items[0]["lat"] is None:
                    items[0]["place"] = mtarget
            changed = True
    if at and not any(h["kind"] == "at" for h in items):
        lm = landmark(at)
        item = {"kind": "at", "target": (lm or {}).get("name") or at.split(",")[0].strip(), "place": (lm or {}).get("place") or at,
                "lat": (lm or {}).get("lat"), "lon": (lm or {}).get("lon"), "country": (lm or {}).get("country") or cc,
                "at_time": _iso(_parse_posted(posted_at)), "confidence": 0.5, "source": "model"}
        if not lm:
            try:
                import telegram_ingest as tg
                hit, _w = tg.locate(at, "site", cc or "") if budget[0] > 0 and cc else (None, None)
                budget[0] -= 1
            except Exception:                                  # noqa: BLE001
                hit = None
            if hit:
                item.update(lat=hit["lat"], lon=hit["lon"])
        if item["lat"] is not None:                         # a position is a point or nothing
            items.append(item)
            changed = True
    if changed:
        items.sort(key=lambda h: 0 if h["kind"] == "intent" else 1)
        store(con, chan, msg_id, posted_at, items, topic_id=topic_id, topic_title=topic_title)
        invalidate()
    return int(changed)


# ── unified signals (derived on read) ───────────────────────────────────────

ACT_PHRASE = {"attack": "attack {t}", "occupy": "occupy {t}", "block": "block {t}", "march": "march on {t}",
              "gather": "gather at {t}", "strike": "strike at {t}", "sabotage": "sabotage {t}", "other": "act at {t}"}
ACT_NOUN = {"attack": "an attack on", "occupy": "an occupation of", "block": "a blockade of", "march": "a march on",
            "gather": "a gathering at", "strike": "a strike at", "sabotage": "sabotage at", "other": "action at"}
HARD_ACTS = {"attack", "occupy", "sabotage"}
# The act a merged signal is named by: the gravest any message proposes.
ACT_RANK = {"attack": 7, "occupy": 6, "sabotage": 5, "block": 4, "march": 3, "gather": 2, "strike": 1, "other": 0}


def km(a_lat, a_lon, b_lat, b_lon) -> float:
    r = math.radians
    h = (math.sin(r(b_lat - a_lat) / 2) ** 2
         + math.cos(r(a_lat)) * math.cos(r(b_lat)) * math.sin(r(b_lon - a_lon) / 2) ** 2)
    return 12742 * math.asin(math.sqrt(min(1.0, h)))


def _same_place(a: dict, b: dict) -> bool:
    if a.get("lat") is not None and b.get("lat") is not None:
        return km(a["lat"], a["lon"], b["lat"], b["lon"]) <= SAME_PLACE_KM
    return bool(a.get("target")) and fold(a.get("target")) == fold(b.get("target"))


def _when_phrase(it: dict, country: str | None) -> str:
    k = it.get("when_kind")
    if k == "now":
        return "now"
    if k in ("relative", "time") and it.get("starts_utc"):
        d = _parse_posted(it["starts_utc"]).astimezone(_zone(country))
        posted = _parse_posted(it["posted_at"]).astimezone(d.tzinfo)
        if k == "relative":
            mins = round((_parse_posted(it["starts_utc"]) - _parse_posted(it["posted_at"])).total_seconds() / 60)
            return f"in {mins} min" if mins < 90 else f"at {d.strftime('%H:%M')}"
        day = "" if d.date() == posted.date() else (" tomorrow" if d.date() == posted.date() + _dt.timedelta(days=1)
                                                    else d.strftime(" on %a %-d %b"))
        return f"at {d.strftime('%H:%M')}{day}"
    if k == "date" and it.get("starts_utc"):
        d = _parse_posted(it["starts_utc"]).astimezone(_zone(country))
        posted = _parse_posted(it["posted_at"]).astimezone(d.tzinfo)
        return "tomorrow" if d.date() == posted.date() + _dt.timedelta(days=1) else d.strftime("on %a %-d %b")
    return ""


def _hhmm(iso: str, country: str | None) -> str:
    return _parse_posted(iso).astimezone(_zone(country)).strftime("%H:%M")


def severity(sig: dict) -> str:
    """An immediate call to attack or occupy a named place is HIGH at least
    (the owner's Élysée example), critical once several messages or chats
    carry it; an immediate block or march is high; a timed call or a
    position report is moderate, high when many report it."""
    it = sig["intent"] or {}
    if sig["kind"] == "intent":
        named = bool(it.get("target"))
        if it.get("immediate") and it.get("act") in HARD_ACTS and named:
            return "critical" if sig["n_messages"] >= 3 or sig["n_channels"] >= 2 else "high"
        if it.get("immediate") and named:
            return "high"
        return "moderate"
    return "high" if sig["n_messages"] >= 5 else "moderate"


def _headline(sig: dict) -> str:
    it = sig["intent"] or {}
    t = sig.get("target") or "an unnamed place"
    if sig["kind"] == "at":
        n = sig["n_messages"]
        return f"{'Members report' if n > 1 else 'A member reports'} being at {t}"
    when = _when_phrase(it, sig.get("country_code"))
    act = ACT_PHRASE.get(it.get("act") or "other", ACT_PHRASE["other"]).format(t=t)
    who = f" {it['who']}" if it.get("who") else ""
    lead = "Immediate call" if it.get("immediate") else "Call"
    return f"{lead}{(' for' + who) if who else ''} to {act}{(' ' + when) if when and when != 'now' else (' now' if when == 'now' else '')}"


def _summary(sig: dict) -> str:
    it = sig["intent"] or {}
    where = sig["chats"][0] + (f" › {sig['topic_title']}" if sig.get("topic_title") else "")
    first, last = _hhmm(sig["first_at"], sig.get("country_code")), _hhmm(sig["last_at"], sig.get("country_code"))
    span = f"at {first}" if first == last else f"between {first} and {last}"
    n, c = sig["n_messages"], sig["n_channels"]
    count = f"{n} message{'s' if n != 1 else ''}" + (f" in {c} chats" if c > 1 else f" in {where}")
    if sig["kind"] == "at":
        s1 = f"Members of {where} say they are at {sig.get('target')}."
    else:
        when = _when_phrase(it, sig.get("country_code"))
        noun = ACT_NOUN.get(it.get("act") or "other", ACT_NOUN["other"])
        tail = {"now": ", immediately", "": ""}.get(when, f", {when}")
        s1 = f"Members of {where} call for {noun} {sig.get('target') or 'a place they do not name'}{tail}."
    npos = sig.get("n_positions") or 0
    extra = (" One says they are already there." if npos == 1 else f" {npos} say they are already there.") if npos else ""
    why = f" Why, in their words: {sig['why']}." if sig.get("why") else ""
    return f"{s1} {count} {span} local time; unverified.{extra}{why}"


def build(rows: list[dict]) -> list[dict]:
    """Rows of telegram_intents joined with their posts (dicts with at
    least the table's columns plus channel_title, text, summary_en, role) →
    unified signals, newest first. Pure; tested without a database."""
    rows = sorted(rows, key=lambda r: r["posted_at"])
    groups: list[dict] = []
    for r in rows:
        t = r.get("at_time") or r["posted_at"] if r["kind"] == "at" else r["posted_at"]
        best = None
        for g in reversed(groups):
            # same place, close in time: one thing, whatever verb each
            # message used ("go Matignon", "on attaque Matignon")
            if g["kind"] != r["kind"]:
                continue
            gap = (_parse_posted(t) - _parse_posted(g["last_at"])).total_seconds() / 60
            if gap > MERGE_GAP_MIN:
                continue
            if _same_place(g["anchor"], r):
                best = g
                break
        if best is None:
            best = {"kind": r["kind"], "act": r.get("act"), "anchor": dict(r), "rows": [], "last_at": t}
            groups.append(best)
        best["rows"].append(r)
        best["last_at"] = max(best["last_at"], t)
        if best["anchor"].get("lat") is None and r.get("lat") is not None:
            best["anchor"] = dict(r)
    # People saying they are AT the place a call names, in its window, are
    # part of that call's signal ("2 say they are already there"), not a
    # card of their own.
    intents = [g for g in groups if g["kind"] == "intent"]
    absorbed = set()
    for gi, g in enumerate(groups):
        if g["kind"] != "at":
            continue
        for i in intents:
            gap = abs((_parse_posted(g["rows"][0]["posted_at"]) - _parse_posted(i["last_at"])).total_seconds()) / 60
            if gap <= MERGE_GAP_MIN * 2 and _same_place(i["anchor"], g["anchor"]):
                i.setdefault("positions", []).extend(g["rows"])
                absorbed.add(gi)
                break
    out = []
    for gi, g in enumerate(groups):
        if gi in absorbed:
            continue
        calls = g["rows"]
        rs = sorted(calls + (g.get("positions") or []), key=lambda r: r["posted_at"])
        a = g["anchor"]
        lead = max(calls, key=lambda r: (int(bool(r.get("immediate"))), ACT_RANK.get(r.get("act"), 0),
                                         r.get("confidence") or 0, r.get("lat") is not None))
        chans, titles = [], []
        for r in rs:
            if r["channel"] not in chans:
                chans.append(r["channel"])
                titles.append(r.get("channel_title") or r["channel"])
        topics = [r.get("topic_title") for r in rs if r.get("topic_title")]
        whys = [r.get("why") for r in rs if r.get("why")]
        first = rs[0]
        sources = [{"channel": r["channel"], "msg_id": r["msg_id"], "posted_at": r["posted_at"],
                    "channel_title": r.get("channel_title") or r["channel"], "topic_title": r.get("topic_title"),
                    "text": (r.get("text") or "")[:280],
                    "url": None if str(r["channel"]).startswith(("c/", "u/", "g/")) else f"https://t.me/{r['channel']}/{r['msg_id']}"}
                   for r in rs]
        sig = {
            "id": f"tgu-{first['channel']}-{first['msg_id']}-{first.get('idx', 0)}", "unified": True, "kind": g["kind"],
            "target": a.get("target"), "place": a.get("place") or a.get("target"),
            "lat": a.get("lat"), "lon": a.get("lon"), "country_code": a.get("country"),
            "intent": None if g["kind"] == "at" else {
                "act": max((r.get("act") or "other" for r in calls), key=lambda x: ACT_RANK.get(x, 0)),
                "target": a.get("target"), "when": lead.get("when_text"),
                "when_kind": lead.get("when_kind"), "starts_utc": lead.get("starts_utc"),
                "immediate": any(bool(r.get("immediate")) for r in calls), "who": next((r["who"] for r in calls if r.get("who")), None),
                "confidence": round(max(r.get("confidence") or 0 for r in calls), 2)},
            "first_at": rs[0]["posted_at"], "last_at": rs[-1]["posted_at"],
            "n_messages": len({(r["channel"], r["msg_id"]) for r in rs}), "n_channels": len(chans),
            "chats": titles, "channels": chans, "topic_title": topics[-1] if topics else None,
            "why": whys[-1] if whys else None, "n_positions": len(g.get("positions") or []),
            "sources": sources, "role": first.get("role") or "group",
        }
        if sig["intent"]:
            sig["intent"]["posted_at"] = lead["posted_at"]       # the time "now" and "in 30 min" count from
        sig["severity_tier"] = severity(sig)
        sig["headline"] = _headline(sig)
        sig["summary"] = _summary(sig)
        out.append(sig)
    out.sort(key=lambda s: s["last_at"], reverse=True)
    return out


# one read serves every caller at once (shared_cache): this is asked by the
# same feeds, layers and per-user passes as street_reports.signals
from shared_cache import SharedCache  # noqa: E402
_SIGNALS = SharedCache("telegram-signals", ttl=CACHE_S, max_stale=120)


def invalidate() -> None:
    _SIGNALS.clear()


def _why_of(con, chan: str, topic_title: str | None) -> str | None:
    """The newest reason given in the chat's own "why" topic (if it has
    one), as the model rendered it — the owner's 'why they demonstrate'."""
    try:
        r = con.execute("SELECT COALESCE(NULLIF(announce_cause,''), NULLIF(mood_topic,''), headline) FROM telegram_posts"
                        " WHERE channel=? AND topic_title IS NOT NULL AND headline IS NOT NULL AND headline != ''"
                        " AND (lower(topic_title) LIKE '%pourquoi%' OR lower(topic_title) LIKE '%revendic%'"
                        " OR lower(topic_title) LIKE '%why%' OR lower(topic_title) LIKE '%raison%')"
                        " ORDER BY posted_at DESC LIMIT 1", (chan,)).fetchone()
    except sqlite3.OperationalError:
        return None
    return (r[0] or "").strip().rstrip(".")[:140] if r and r[0] else None


def signals_from(con, hours: int = SIGNAL_HOURS) -> list[dict]:
    """Unified signals read through an open connection (uncached)."""
    cutoff = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(hours=hours)).isoformat()
    prev = con.row_factory
    con.row_factory = sqlite3.Row
    try:
        ensure(con)
        cols = {r[1] for r in con.execute("PRAGMA table_info(telegram_posts)")}
        extra = ", p.announce_cause, p.mood_topic" if {"announce_cause", "mood_topic"} <= cols else ""
        rows = [dict(r) for r in con.execute(
            "SELECT i.*, p.channel_title, p.text, p.summary_en, p.role" + extra +
            " FROM telegram_intents i JOIN telegram_posts p ON p.channel=i.channel AND p.msg_id=i.msg_id"
            " WHERE i.posted_at >= ? AND COALESCE(p.role,'') != 'ignore' ORDER BY i.posted_at LIMIT 5000", (cutoff,))]
        whys: dict = {}
        for r in rows:
            if r["channel"] not in whys:
                whys[r["channel"]] = _why_of(con, r["channel"], r.get("topic_title"))
            r["why"] = r.get("why") or whys[r["channel"]]
    except sqlite3.OperationalError:
        rows = []
    finally:
        con.row_factory = prev
    return build(rows)


def signals(hours: int = SIGNAL_HOURS, db_path: str | None = None) -> list[dict]:
    """Unified signals of the last `hours`, newest first; cached CACHE_S."""
    def _build():
        import telegram_ingest as tg
        con = sqlite3.connect(db_path, timeout=30) if db_path else tg._con()
        try:
            out = signals_from(con, hours)
        finally:
            con.close()
        # a call whose gathering is over (or whose own time ran out) is no longer
        # a signal anywhere — map, Desk, notifications (protest_status.call_live,
        # owner 2026-10-19); signals_from stays whole for the protests' own reading
        try:
            import protest_status
            out = protest_status.live_signals(out)
        except Exception as e:                                     # noqa: BLE001
            print(f"[telegram-signals] error: expiry: {type(e).__name__}: {e}", flush=True)
        return out
    return _SIGNALS.get((hours, db_path), _build)


def source_keys(sigs: list[dict]) -> set:
    """(channel, msg_id) of every message a signal stands for."""
    return {(s["channel"], s["msg_id"]) for sig in sigs for s in sig["sources"]}


TIER = {"critical": "critical", "high": "significant", "moderate": "elevated"}


def posts(hours: int = SIGNAL_HOURS, db_path: str | None = None) -> list[dict]:
    """Every unified signal of the last `hours` as a post, newest first."""
    return [as_post(s) for s in signals(hours, db_path)]


def as_post(sig: dict) -> dict:
    """A signal in the shape of a telegram_ingest post (feed/published), so
    the phone Desk, Home, the map and the desktop read it unchanged."""
    import telegram_ingest as tg
    first = sig["sources"][0]
    latest = sig["sources"][-1]
    via = ", ".join(sig["chats"][:3]) + (f" and {len(sig['chats']) - 3} more" if len(sig["chats"]) > 3 else "")
    return {
        "id": sig["id"], "unified": True, "headline": sig["headline"], "summary_en": sig["summary"],
        "text": latest["text"], "lang": None,
        "channel": first["channel"], "channel_title": via, "posted_at": sig["last_at"], "first_at": sig["first_at"],
        "event_type": "unrest", "category": "unrest", "place": sig["place"], "precision": "site",
        "country_code": sig["country_code"], "lat": sig["lat"], "lon": sig["lon"], "geocoded_as": sig["place"],
        "media": "none", "thumb_url": None, "url": latest["url"] or first["url"],
        "also_reported_by": sig["chats"][1:], "views": None, "role": sig.get("role") or "group", "party": None,
        # the app's tiers (critical | significant | elevated); the
        # notification severity (critical | high | moderate) as `signal_severity`
        "claim": False, "first_hand": True, "msg_id": first["msg_id"],
        "severity_tier": TIER.get(sig["severity_tier"], "elevated"), "signal_severity": sig["severity_tier"],
        "graphic": False, "on_map": sig["lat"] is not None,
        "intent": sig["intent"], "signal_kind": sig["kind"], "target": sig["target"], "topic_title": sig["topic_title"],
        "n_messages": sig["n_messages"], "n_channels": sig["n_channels"], "sources": sig["sources"],
        "verification": f"{sig['n_messages']} Telegram message{'s' if sig['n_messages'] != 1 else ''} — "
                        + tg.ROLE_LABEL.get(sig.get("role") or "group", tg.ROLE_LABEL.get("group", "unverified")),
    }
