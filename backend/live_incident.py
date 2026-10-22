"""
live_incident.py — the strict extractor that decides whether a Telegram post
becomes a LIVE pinned signal (owner, 2026-10-22: "make our signals actually
live and perfectly geolocalized").

WHAT WENT WRONG BEFORE (production, 2026-10-22, see HANDOFF.md):
  * the post's own time was the event's time: a recap ("557 arrests after the
    riots of 17 and 18 October"), an announcement ("Acte II on 24 October")
    and a statistic were pinned as if they were happening now;
  * the place was the model's, in English, with the country it chose from its
    own knowledge ("Israeli media: Western Galilee" pinned in Ukraine,
    "Ghalibaf did it again" pinned in Hadatha, Lebanon) and the geocoder took
    the first of three homonyms ("Dnipro" in Chernihiv oblast);
  * air-raid warnings and all-clears ("Загроза застосування БПЛА",
    "Відбій тривоги") were pinned as unrest.

THE DIVISION OF LABOUR (memory: model extracts, code resolves).
  THE MODEL reads the text with the strict prompt below (SPEC, kept as the
  owner wrote it) and answers a fixed JSON schema: is it live, what, when,
  where, and the two verbatim quotes that prove time and place.
  THE CODE decides, and every pin can be audited:
    (a) both quotes occur verbatim in the text (whitespace and case aside);
    (b) the place as written, and every context word, occur in the text;
    (c) event_time is not after published_at, at most LIVE_WINDOW_MIN before
        it, and the post is still inside that window when it is read;
    (d) only the quoted place plus the context the text itself quotes goes to
        the geocoder — never the channel's country or city — and a result is
        accepted only at the level the text stated; homonyms the text does
        not tell apart are rejected, not resolved to the famous one.
  "Live" is DERIVED ON READ from event_time and now (memory: derive on read,
  don't store); what is stored is the model's whole answer and the code's
  verdict (telegram_posts.live_json, live_verdict) plus event_time.

THE MODEL IS OUT (credit pause, budget, no key): classify_by_rules keeps the
rule path but under the same discipline as far as code can: a place named in
the text, a present-tense cue, no past-time cue, a post no older than the
window (rule_live below). Otherwise it is read, not pinned.

COST. Only posts that pass the cheap prefilter, identical texts once, capped
per hour and per day (env), on a pool of its own (main._live_incident_loop).
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import math
import os
import re
import sqlite3
import threading
import unicodedata

LIVE_WINDOW_MIN = 60
SKEW_S = 90                           # a post's time is stamped by Telegram, the event's by the writer

MODEL = (os.getenv("LIVE_INCIDENT_MODEL") or "gpt-4.1-mini").strip()
ENABLED = os.getenv("LIVE_INCIDENT_ENABLED", "1").strip() != "0"
PER_HOUR = int(os.getenv("LIVE_INCIDENT_PER_HOUR", "200") or 200)
PER_DAY = int(os.getenv("LIVE_INCIDENT_PER_DAY", "2000") or 2000)
PER_PASS = int(os.getenv("LIVE_INCIDENT_PER_PASS", "24") or 24)
GEOCODES_PER_PASS = int(os.getenv("LIVE_INCIDENT_GEOCODES_PER_PASS", "12") or 12)
AMBIGUITY_KM = 25.0                   # two city-level answers further apart than this are two places

# THE OWNER'S VOCABULARY (2026-10-22): the only things that are drawn as a signal.
# "other" is not one of them: an item that fits none is not live.
ACTS = ("arrest", "shots_fired", "explosion", "strike", "missile_launch", "missile_impact", "crowd_movement",
        "troops_sighted", "police_intervention")
EVENT_TYPES = ACTS                    # what the model may answer in `event_type`
# the posts table's own event_type column (the rest of the app reads it), by act
ACT_EVENT_TYPE = {"arrest": "unrest", "shots_fired": "attack", "explosion": "explosion", "strike": "strike",
                  "missile_launch": "strike", "missile_impact": "strike", "crowd_movement": "unrest",
                  "troops_sighted": "movement", "police_intervention": "unrest"}
# acts whose wrong pin does harm: shown muted until corroborated (live_signals.py)
HIGH_IMPACT = {"arrest", "shots_fired", "explosion", "strike", "missile_launch", "missile_impact"}
# why the model refused, as a class (the owner's list of what is NOT a signal)
REJECT_CLASSES = ("opinion", "statement", "recap", "past_story", "planned", "footage_only", "news", "air_raid",
                  "not_on_the_ground", "no_place", "other")
LEVELS = ("venue", "street", "neighborhood", "city", "region", "country")
# the levels that are a point on the map (telegram_ingest.PRECISE words)
PIN_LEVELS = {"venue": "site", "street": "street", "neighborhood": "district", "city": "city"}

SPEC = """You are an incident extraction engine for a real-time situational awareness map.
Your job is to decide whether a text describes a security-relevant incident that is happening RIGHT NOW (or started within the last 60 minutes), and to extract exactly where it happens. A wrong signal is far worse than a missing signal. When in doubt, reject.

Input: text; published_at (ISO UTC); source_name, source_region (context only, NOT evidence of the event location).

RULES
1. LIVENESS
- Determine event_time from the text, resolved against published_at ("this morning", "earlier today", "two days ago", "yesterday" must be resolved).
- is_live = true ONLY IF all hold: a) the event is ongoing or began within 60 minutes before published_at, b) the text uses present or immediate past tense about the incident itself ("are arresting", "police are responding", "just happened"), c) it is not a recap, analysis, opinion, anniversary, follow-up on an older event, or a report of a past event ("was arrested on Tuesday").
- If the event time cannot be established from the text, is_live = false. Never assume the event happened at publication time.
2. LOCATION
- Extract only locations explicitly stated in the text. Never infer a location from the source's region, the language, the author's usual coverage area, or your own knowledge of what usually happens somewhere.
- Return the most precise level stated: venue, intersection/street, neighborhood/district, city, region, country. Copy each place name exactly as written in the text.
- If the text mentions several places, choose the place where the incident itself is happening, not where it was reported from or where people are reacting.
- If the place is ambiguous (e.g. "Springfield", "Georgetown", "Châtelet" without country/city context), fill ambiguity_note and use only the disambiguating context stated in the text. Do not choose the most famous match.
- If no incident location is stated, set location to null and is_live to false.
3. EVIDENCE
- evidence_quote_time: the shortest exact quote from the text that establishes timing. evidence_quote_place: the shortest exact quote that establishes the place. If you cannot quote evidence for both, is_live = false.
4. CLASSIFICATION
- event_type must be one of the allowed values. If none fits, is_live = false. Rumors, unverified claims, speculation: certainty = "unverified"; do not upgrade them.
5. OUTPUT
- Return only JSON matching the schema. In reject_reason, state in one short sentence why the item was rejected when is_live = false."""

VOCABULARY = """
WHAT A SIGNAL IS (the owner's whole vocabulary, 2026-10-22; event_type is exactly one of these, nothing else is a signal):
- arrest: person(s) arrested or detained, at a place.
- shots_fired: gunfire at a place.
- explosion: an explosion at a place.
- strike: an air, artillery or drone strike that hit a place.
- missile_launch: a missile or drone seen launched from a place.
- missile_impact: a missile or drone that landed at a place.
- crowd_movement: a protest, rally or march that is ON THE GROUND NOW at a place (set `direction` when the text says where it moves).
- troops_sighted: troops, armed forces or military vehicles seen at a place.
- police_intervention: police acting at a place: tear gas, a charge, LBD or rubber bullets, a kettle, an eviction under way.
POLICE IS NOT THE MILITARY: police_intervention is law enforcement in a civil or protest setting (police, gendarmerie, CRS,
BAC, BRAV-M, riot police, Polizei, carabinieri, Guardia Civil). Army, troops, soldiers, armoured vehicles, columns, brigades,
artillery, ZSU/VSU, Russian or Ukrainian forces, the IDF, any war front: troops_sighted (or strike), never police_intervention.
NOT SIGNALS (is_live = false, and say which in reject_class): opinion (a view, a comment, an insult, politics talk, a
slogan, an editorial, an analysis; even when it uses violent words), statement (what an official or a party says or
threatens), recap (a summary of past days, a toll, statistics), past_story (a story told in the past tense by a
witness: "samedi j'etais ..." / "yesterday I saw ..." / "cette nuit" is NOT live even if the post is recent), planned
(a protest or event announced for later), footage_only (a photo or video with no act and no place named by the words),
news (generic news, a court case, a press review), air_raid (a warning or an all-clear), not_on_the_ground (no one says
they are there or sees it), no_place (the text names no place for the act).
TIME TRAPS: a time at the very start of a message that follows a channel or city name ("Ile de France 17:41", "Paris 18:20")
is the forwarded message's header, the time it was posted: it is NOT the time of the event. A clock time alone proves nothing.
The post's own time is not the event's time. A witness telling what happened on another day is not live.
PLACE TRAPS: a name that appears only in a channel's signature, footer, "subscribe" line, hashtag or @handle ("Вибух  SUMY GO • ...") is not a place stated by the post; copy the place exactly as written; a bare word for a kind of place ("la place", "rue", "the square", "downtown",
"the city") is NOT a place. If the text names only such a word, location is null and is_live is false.
EVIDENCE: evidence_quote_act is the shortest exact quote that names the act itself ("tir de LBD", "ils arretent", "tear gas").
first_hand: true only when the writer says they are there or see it themselves ("je vois", "on est a", "sous mes yeux", "I can see").
"""

SCHEMA_NOTES = f"""{VOCABULARY}
ALLOWED event_type VALUES: {", ".join(EVENT_TYPES)}.
ALLOWED location.level VALUES: {", ".join(LEVELS)}.
ALLOWED reject_class VALUES: {", ".join(REJECT_CLASSES)} (null when is_live is true).
SCHEMA FIELDS: is_live; event_type; event_time (ISO 8601 UTC, or null); certainty ("verified" or "unverified");
location {{name_as_written, name_for_geocoder, level, context_as_written}} or null; other_places_mentioned (names as written);
ambiguity_note; evidence_quote_time; evidence_quote_place; evidence_quote_act; first_hand; reject_class; reject_reason;
direction {{as_written, toward_place}} or null (crowd_movement only: the words that say where it moves, and the place as written they name).
location.name_as_written is the place copied exactly from the text. location.context_as_written lists, copied
exactly from the text, the words that say which place that is (the city, region or country the text itself gives
for it); empty when the text gives none. Never put a city or country there that the text does not contain.
location.name_for_geocoder is only the proper name of that same place, without qualifiers ("central Kharkiv" ->
"Kharkiv", "ville de Nabatieh" -> "Nabatieh", "port of Odesa" -> "Odesa"), in its dictionary form when the text inflects it
("Харкові" -> "Харків"); null when name_as_written already is that. It adds no place the text does not name.
A rumor or an unverified claim that otherwise meets every rule above is is_live = true with certainty "unverified"
(never "verified"); it is not a reason to reject.
Fields that do not apply are null (or [] for lists)."""

SYSTEM_PROMPT = SPEC + "\n" + SCHEMA_NOTES


def _nullable(t, **kw):
    return {"type": [t, "null"], **kw}


SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["is_live", "event_type", "event_time", "certainty", "location", "other_places_mentioned",
                 "ambiguity_note", "evidence_quote_time", "evidence_quote_place", "evidence_quote_act", "first_hand",
                 "reject_class", "reject_reason", "direction"],
    "properties": {
        "is_live": {"type": "boolean"},
        "event_type": {"type": ["string", "null"], "enum": list(EVENT_TYPES) + [None]},
        "event_time": _nullable("string"),
        "certainty": {"type": ["string", "null"], "enum": ["verified", "unverified", None]},
        "location": {
            "type": ["object", "null"],
            "additionalProperties": False,
            "required": ["name_as_written", "name_for_geocoder", "level", "context_as_written"],
            "properties": {
                "name_as_written": {"type": "string"},
                "name_for_geocoder": {"type": ["string", "null"]},
                "level": {"type": "string", "enum": list(LEVELS)},
                "context_as_written": {"type": "array", "items": {"type": "string"}},
            },
        },
        "other_places_mentioned": {"type": "array", "items": {"type": "string"}},
        "ambiguity_note": _nullable("string"),
        "evidence_quote_time": _nullable("string"),
        "evidence_quote_place": _nullable("string"),
        "evidence_quote_act": _nullable("string"),
        "first_hand": {"type": ["boolean", "null"]},
        "reject_class": {"type": ["string", "null"], "enum": list(REJECT_CLASSES) + [None]},
        "reject_reason": _nullable("string"),
        "direction": {
            "type": ["object", "null"],
            "additionalProperties": False,
            "required": ["as_written", "toward_place"],
            "properties": {"as_written": {"type": "string"}, "toward_place": {"type": ["string", "null"]}},
        },
    },
}

# What the app has seen of it since start (counts for /api/telegram/status).
STATUS = {"passes": 0, "extracted": 0, "live": 0, "rejected": 0, "unplaced": 0, "reused": 0, "skipped_prefilter": 0,
          "model_calls": 0, "skipped_not_watched": 0, "focus_first": 0,
          "capped": 0, "model_out_passes": 0, "failed_calls": 0, "failed_passes": 0, "last_error": None,
          "last_live": None, "last_pass_at": None, "rejections": {}}
_STATUS_LOCK = threading.Lock()


def _bump(key: str, n: int = 1) -> None:
    with _STATUS_LOCK:
        STATUS[key] = STATUS.get(key, 0) + n


def _reject_count(reason: str) -> None:
    key = re.sub(r"[\d.:'\"“”].*$", "", reason or "").strip()[:60] or "rejected"
    with _STATUS_LOCK:
        STATUS["rejections"][key] = STATUS["rejections"].get(key, 0) + 1


# ── text helpers ────────────────────────────────────────────────────────────

def norm(s: str | None) -> str:
    """Whitespace and case only — the one tolerance the quote check allows
    (NFKC so a no-break space or a presentation form is not a difference)."""
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", s or "")).strip().casefold()


def in_text(quote: str | None, text: str | None) -> bool:
    q = norm(quote)
    return len(q) >= 2 and q in norm(text)


def fold(s: str | None) -> str:
    """Lowercase, Latin accents removed (other scripts kept as written)."""
    out = []
    for c in unicodedata.normalize("NFKC", s or ""):
        base = "".join(x for x in unicodedata.normalize("NFKD", c) if not unicodedata.combining(x))
        out.append(base if base and "LATIN" in unicodedata.name(c, "") else c)
    return "".join(out).casefold()


def text_hash(text: str | None) -> str:
    return hashlib.sha1(norm(text).encode("utf-8")).hexdigest()[:16]


def parse_utc(v) -> _dt.datetime | None:
    if isinstance(v, _dt.datetime):
        return v if v.tzinfo else v.replace(tzinfo=_dt.timezone.utc)
    if not v or not isinstance(v, str):
        return None
    try:
        d = _dt.datetime.fromisoformat(v.strip().replace("Z", "+00:00").replace(" ", "T", 1))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=_dt.timezone.utc)


def iso(d: _dt.datetime) -> str:
    return d.astimezone(_dt.timezone.utc).isoformat()


# ── cues shared with the rule path ──────────────────────────────────────────
# A time words that put an event in the past (or in no particular hour).
_MONTHS = (r"january|february|march|april|june|july|august|september|october|november|december|janvier|fevrier|mars|avril|"
           r"juin|juillet|aout|septembre|octobre|novembre|decembre|enero|febrero|abril|mayo|junio|julio|agosto|septiembre|"
           r"octubre|noviembre|diciembre")
_DAYS = (r"monday|tuesday|wednesday|thursday|friday|saturday|sunday|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|"
         r"lunes|martes|miercoles|jueves|viernes|sabado|domingo")
PAST_CUES = re.compile(
    r"\b(?:yesterday|last (?:night|week|month|year)|the day before|earlier (?:today|this \w+)|this (?:morning|afternoon)|"
    r"(?:on )?(?:" + _DAYS + r")|\d+\s*(?:hours?|days?|weeks?|months?|mins?|minutes?) ago|an? (?:hour|day|week|month|year) ago|"
    r"anniversary|"
    r"hier|avant-hier|la veille|cette nuit|ce matin|cet apres-midi|il y a \d+|dernier|derniere|"
    r"ayer|anoche|anteayer|hace \d+|esta manana|"
    r"\d{1,2}(?:er)?\s+(?:" + _MONTHS + r")|(?:" + _MONTHS + r")\s+\d{1,2}\b|\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b)\b"
    r"|вчера|вчора|позавчера|позавчора|сегодня утром|сьогодні вранці|вранці|утром|ночью|назад\b|на днях|"
    r"\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря|січня|лютого|березня|квітня|"
    r"травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)|"
    r"\d{1,2}\s+(?:يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر|تشرين|كانون)|"
    r"أمس|البارحة|الليلة الماضية|صباح اليوم|قبل \d+|قبل (?:ساعة|ساعات|يوم|أيام)|"
    r"אתמול|לפני", re.I)
PRESENT_CUES = re.compile(
    r"\b(?:breaking|urgent|just now|right now|currently|ongoing|in progress|at this moment|happening now|"
    r"en ce moment|a l'instant|en cours|maintenant|alerte|en direct|"
    r"ahora|en este momento|en curso|urgente|ahora mismo)\b"
    r"|\bnow\b|срочно|сейчас|только что|терміново|зараз|щойно|"
    r"عاجل|الآن|الان|للتو|حاليا|حالياً|جارٍ|דחוף|עכשיו|⚡|🚨", re.I)


def past_cue(text: str | None) -> str | None:
    m = PAST_CUES.search(fold(text))
    return m.group(0) if m else None


def _f(text: str | None) -> str:
    return fold((text or "").replace("’", "'").replace("`", "'"))


# A story told in the past by someone who was there ("samedi j'étais sur Paris et j'ai assisté au pillage")
# is not live, however recent the post (owner, 2026-10-22, the rue de Rivoli post).
STORY_CUES = re.compile(
    r"\bj'(?:etais|avais|ai (?:assiste|vu|entendu|ete|filme|recu|croise|pris|fui|du|insulte|decouvert|reussi))\b|"
    r"\bje (?:suis (?:passe|alle|reste|rentre|sorti)|me suis|l'ai (?:vu|insulte|decouvert))\b|\bnous (?:etions|avons (?:vu|assiste))\b|"
    r"\bon (?:etait|a (?:vu|assiste|ete))\b|\bi (?:was|saw|heard|witnessed|watched|filmed|got|had)\b|\bwe (?:were|saw|went)\b|"
    r"\byo (?:estaba|vi|estuve|fui)\b|\bestuvimos\b|\bvimos\b|"
    r"я (?:был|была|видел|видела)\b|ми (?:були|бачили)\b|я бачив\b|я бачила\b|رأيت|كنت\b|شاهدت")
# another day than today, named
OTHER_DAY_CUES = re.compile(
    r"\b(?:yesterday|last night|the day before|day before yesterday|hier|avant-hier|hier soir|la veille|cette nuit|"
    r"ayer|anoche|anteayer|(?:on |last )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|"
    r"(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)(?: dernier| soir| matin)?|"
    r"(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo))\b|вчера|вчора|позавчера|أمس|البارحة", re.I)
# the words that say it is now, in a quote or in a text
NOW_WORDS = re.compile(
    r"\b(?:maintenant|en ce moment|a l'instant|en cours|now|right now|just now|currently|ongoing|in progress|ahora|"
    r"ahora mismo|en este momento|en directo|en direct|actuellement|il y a [1-9]\d?\s*min|\d{1,2}\s*min(?:ute)?s? ago|"
    r"on voit|on est|je vois|i can see|we are)\b|сейчас|зараз|только что|щойно|الآن|للتو", re.I)
# opinion, politics talk, insult, slogan: never a signal (owner, 2026-10-22)
OPINION_CUES = re.compile(
    r"\b(?:nique|encule\w*|fdp|ntm|va te faire|putain de|merde|vive le|vive la|a mort|honte|scandale|"
    r"je pense que|je crois que|selon moi|a mon avis|il faut (?:les |tous )?(?:combattre|battre|virer|degager)|"
    r"i think|in my opinion|imo|fuck|should be|must be stopped|opinion|editorial|tribune|analyse|analysis|"
    r"co-?fonde|fondateurs?|founders?)\b", re.I)


def story_cue(text: str | None) -> str | None:
    """Why the text is a story from another time, or None. A present-tense
    marker (NOW_WORDS, PRESENT_CUES) anywhere in the text is what lets a
    witness's account of an hour ago stand; without one it is a story."""
    t = _f(text)
    m = STORY_CUES.search(t) or OTHER_DAY_CUES.search(t)
    if not m:
        return None
    if NOW_WORDS.search(t) or PRESENT_CUES.search(t):
        return None
    return m.group(0)


def opinion_cue(text: str | None) -> str | None:
    m = OPINION_CUES.search(_f(text))
    return m.group(0) if m else None


# The act, by words (the rule path, and a check on the model's answer). Gravest first.
_MISSILE = r"(?:missiles?|drones?|rockets?|roquettes?|uavs?|шахед\w*|бпла|дрон\w*|ракет\w*|مسيرة|مسيّرة|صاروخ|صواريخ)"
ACT_WORDS: list[tuple[str, re.Pattern]] = [(a, re.compile(p, re.I)) for a, p in [
    ("shots_fired", r"coups? de feu|\btirs? (?:de|a)\b|\btirs\b|fusillade|shots? fired|gunfire|opened fire|ouvr\w+ le feu|disparos|"
                    r"tiroteo|balacera|стрельб\w*|стріляни\w*|إطلاق نار|اطلاق نار"),
    ("missile_impact", rf"{_MISSILE}.{{0,40}}(?:landed|impact\w*|hit\b|struck|tombe\w*|s'est ecras\w*|atterri\w*|прилет\w*|приліт\w*|سقط\w*)|"
                       rf"(?:landed|impact of|hit by|tombe\w*|прилет\w*|приліт\w*).{{0,40}}{_MISSILE}"),
    ("missile_launch", rf"{_MISSILE}.{{0,40}}(?:launched|fired|lances?\b|lancee?s?\b|tires?\b|запущ\w*|пуск\w*|إطلاق|اطلاق)|"
                       rf"(?:launch(?:ed|es)?|lancement|tir de|fired|запуск\w*|пуск\w*).{{0,40}}{_MISSILE}"),
    ("explosion", r"\bexplosions?\b|\bblasts?\b|\bexploded\b|вибух\w*|взрыв\w*|انفجار|انفجارات|\bdetonation"),
    ("strike", r"\bair ?strikes?\b|\bfrappes? (?:aerienne|israelienne|russe|americaine)s?\b|\bbombard\w*|\bshelling\b|\bshelled\b|"
               r"\bobus\b|غارة|غارات|قصف|авіаудар\w*|\bудар по\b|обстріл\w*|обстрел\w*"),
    ("arrest", r"\binterpell\w*|\barrestations?\b|\bmenotte\w*|\bgarde a vue\b|\bunder arrest\b|\barrest(?:ed|s|ing)?\b|"
               r"\bdetain(?:ed|s|ing)\b|\bdetenid\w*|\barrestad\w*|задерж\w*|затрим\w*|اعتقال|اعتقلت|يعتقل|\bembarqu\w*"),
    ("police_intervention", r"\blacrymo\w*|\btear ?gas\b|\blbd\b|\bflashball\b|grenades? (?:de desencerclement|assourdissantes?)|"
                            r"\bcharge(?:nt|r|s)? (?:de |des |sur |policiere)|\bpolice charge\b|\bnasse\b|\bkettl\w*|\bcanons? a eau\b|"
                            r"\bwater cannons?\b|\bles crs?\b|\bca gaze\b|\bgazent\b|\bgazes\b|\bgaze\b|"
                            r"مسيل للدموع|сльозогінн\w*|слезоточив\w*"),
    ("crowd_movement", r"\bcortege\b|\bmanifestants?\b|\bmanifestantes\b|\bfoule\b|\bcrowd\b|\bmarchent\b|\bmarching\b|\bprotesters?\b|"
                       r"\bdemonstrators?\b|\bmanifestation\b|\bmanifestacion\b|متظاهر\w*|مظاهرة|мітинг\w*|митинг\w*|протестуюч\w*"),
    ("troops_sighted", r"\bsoldats?\b|\btroops?\b|\bmilitary convoy\b|\bconvoi militaire\b|\btanks?\b|\bchars? d'assaut\b|\bblindes?\b|"
                       r"\barmored vehicles?\b|\bmilitary vehicles?\b|\btropas\b|\bejercito\b|\bвойск\w*|\bтанк\w*|\bколон\w* техніки|جنود|دبابات|آليات عسكرية"),
]]


def act_by_words(text: str | None) -> tuple[str, str] | None:
    """(act, the words) for the gravest act the text's words name, or None."""
    t = _f(text)
    for act, rx in ACT_WORDS:
        m = rx.search(t)
        if m:
            return act, m.group(0)
    return None


def rule_decide(text: str | None, posted_at: str | None, now: _dt.datetime | None = None) -> dict:
    """The rule path's whole judgement (the model is out): {ok, act, quote, why}.
    The same discipline as the extractor, as far as code can: an act of the owner's
    vocabulary named by words; not an opinion; not a story from another day or told in
    the past; the text says it is happening now (a present-tense cue); the post itself
    is inside the window. When unsure, no pin."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    out = {"ok": False, "act": None, "quote": None, "why": None}
    p = parse_utc(posted_at)
    if p is None:
        out["why"] = "no post time"
        return out
    age = (now - p).total_seconds() / 60
    if age > LIVE_WINDOW_MIN:
        out["why"] = f"post is {int(age)} min old (live window {LIVE_WINDOW_MIN})"
        return out
    if age < -SKEW_S / 60:
        out["why"] = "post time is in the future"
        return out
    from textclean import strip_emoji
    body = strip_emoji(text)
    oc = opinion_cue(body)
    if oc:
        out["why"] = f"opinion, not a report ('{oc}')"
        return out
    pc = past_cue(body)
    if pc:
        out["why"] = f"the text points to an earlier time ('{pc}')"
        return out
    sc = story_cue(body)
    if sc:
        out["why"] = f"a story from another time ('{sc}')"
        return out
    if not PRESENT_CUES.search(_f(body)) and not NOW_WORDS.search(_f(body)):
        out["why"] = "no present-tense cue (breaking, now, عاجل, срочно ...)"
        return out
    hit = act_by_words(body)
    if not hit:
        out["why"] = "no act of the vocabulary named by words"
        return out
    if hit[0] == "police_intervention":
        import force_context
        if force_context.is_military(body):
            out["why"] = "police words in war reporting: troops, not police (force_context)"
            return out
    out.update(ok=True, act=hit[0], quote=hit[1], why="act named, present-tense cue, no earlier time, recent post")
    return out


def rule_live(text: str | None, posted_at: str | None, now: _dt.datetime | None = None) -> tuple[bool, str]:
    """(live, why): rule_decide's verdict, kept for callers that want the pair."""
    d = rule_decide(text, posted_at, now)
    return d["ok"], d["why"]


# ── prefilter (cost control) ────────────────────────────────────────────────
DRONE_CUES = re.compile(r"бпла|шахед|дрон\w*|ракет\w*|\bdrones?\b|\buavs?\b|\bmissiles?\b|\brockets?\b|مسيرة|مسيّرة|صاروخ|صواريخ", re.I)


# more of what an incident is called than telegram_rules reads (it was written for strikes and unrest)
INCIDENT_WORDS = re.compile(
    r"gunm[ae]n|shooter|shots? fired|gunfire|\bfir(?:ing|ed) (?:on|at)\b|stabb\w*|hostage\w*|\bbomb\w*|\bstriking\b|\bstrikes?\b|"
    r"\braid\w*|\barrest\w*|\bdetain\w*|\bevacuat\w*|\bblock(?:ing|ade)\w*|\bclash\w*|\bfire\b|\bblaze\b|"
    r"\btirs?\b|coups? de feu|fusillade|prise d.otages?|interpell\w*|arrestation\w*|incendie|"
    r"\bbalacera|disparos|balazos|detenid\w*|incendio|"
    r"задерж\w*|арест\w*|перестрел\w*|стрельб\w*|обстрел\w*|пожар\w*|стріляни\w*|пожеж\w*|"
    r"اعتقال|اشتباك|حريق|إطلاق نار|تفجير|اقتحام|محاصر\w*|ضربة|ضربات|يعتقل", re.I)


def prefilter(text: str | None) -> tuple[bool, bool]:
    """(worth a model call, drone/missile track only). The same cheap cues the
    rest of the pipeline uses: an event word in any of the channels' languages,
    unrest words, street words. An air-raid warning is not an incident and
    never reaches the model."""
    t = (text or "").strip()
    if len(t) < 20:
        return False, False
    import telegram_rules
    ft = telegram_rules.fold(t)
    if telegram_rules.ALERT_ONLY.search(ft) and not telegram_rules.HARD_HIT.search(ft) and not INCIDENT_WORDS.search(t):
        return False, False
    kind, _m = telegram_rules.event_of(t)
    if kind or INCIDENT_WORDS.search(t) or act_by_words(t):
        return True, False
    if len(t) >= 40 and PRESENT_CUES.search(t) and not telegram_rules.ALERT_ONLY.search(ft):
        return True, False                       # it says it is happening now: let the model read the rest
    try:
        import telegram_ingest as ti
        if ti.UNREST_WORDS.search(t) or ti.EVENT_CUES_ES_MY.search(t) or ti.street_cue(t):
            return True, False
    except Exception:                                          # noqa: BLE001
        pass
    if DRONE_CUES.search(t):
        return True, True
    return False, False


# ── the model call ──────────────────────────────────────────────────────────

def extract(text: str, published_at: str, source_name: str | None, source_region: str | None, *,
            client=None, model: str | None = None) -> tuple[dict | None, float]:
    """One post → (the model's JSON answer, cost in USD). (None, 0) when the
    gate says no model (credit pause, budget, key): the caller takes the rule
    path. Raises on a failed call; the caller counts it and notes the error."""
    import openai_gate
    client = client or openai_gate.get_client(openai_gate.LIVE_INCIDENT)
    if client is None:
        return None, 0.0
    model = model or MODEL
    user = json.dumps({"text": (text or "")[:1800], "published_at": published_at, "source_name": source_name or "",
                       "source_region": source_region or ""}, ensure_ascii=False)
    resp = client.chat.completions.create(
        model=model, temperature=0, max_tokens=500,
        response_format={"type": "json_schema", "json_schema": {"name": "live_incident", "strict": True, "schema": SCHEMA}},
        messages=[{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user}])
    cost = 0.0
    u = getattr(resp, "usage", None)
    if u:
        pin, pout = openai_gate.price_for(model)
        cost = u.prompt_tokens * pin + u.completion_tokens * pout
        try:
            import usage_tracker
            usage_tracker.record_call(input_tokens=u.prompt_tokens, output_tokens=u.completion_tokens,
                                      call_type="live_incident", model=model, headline="live incident")
        except Exception:                                      # noqa: BLE001
            pass
    out = json.loads(resp.choices[0].message.content or "{}")
    return (out if isinstance(out, dict) else {}), cost


# ── the code's verdict (pure) ───────────────────────────────────────────────

_CLOCK = re.compile(r"\b(\d{1,2})\s*(?:[:hH])\s*(\d{2})\b")


def header_clock(text: str | None) -> str | None:
    """The forwarded message's header time: a clock right after a channel or
    city name at the very start of the text ("Île de France 17:41. Bonjour ..."),
    which is when it was posted and never when the event happened."""
    t = (text or "").lstrip()
    t = re.sub(r"^[^\w\d]+", "", t)                 # a leading flag or bolt is not a word
    m = re.match(r"^[^\d\n]{1,45}?\s(\d{1,2}\s*[:hH]\s*\d{2})\b", t)
    if not m:
        return None
    # "At 01:31 local time" is the writer's own time, not a channel's header: a header is a NAME then a clock
    if re.match(r"(?i)^(?:at|on|in|around|about|since|from|until|à|vers|depuis|dès|a las|a|en|в|о|на|у)\b", t):
        return None
    mm = _CLOCK.search(m.group(1))
    return f"{int(mm.group(1)):02d}:{mm.group(2)}" if mm else None


def _clocks(s: str | None) -> set[str]:
    return {f"{int(a):02d}:{b}" for a, b in _CLOCK.findall(s or "")}


def verify(raw: dict | None, text: str, published_at: str, now: _dt.datetime | None = None) -> dict:
    """What the code makes of the model's answer, before any geocoding.
    {ok, reasons, event_time, age_min, level, name, context, event_type, act,
     certainty, first_hand, direction}. `ok` only when every check holds;
    `reasons` says which failed."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    v = {"ok": False, "reasons": [], "event_time": None, "level": None, "name": None, "context": [],
         "event_type": None, "act": None, "certainty": None, "geocoder_name": None, "first_hand": False,
         "direction": None, "reject_class": None}
    if not isinstance(raw, dict):
        v["reasons"].append("no answer from the model")
        return v
    if not raw.get("is_live"):
        rc = raw.get("reject_class") if raw.get("reject_class") in REJECT_CLASSES else None
        v["reject_class"] = rc
        v["reasons"].append("model: " + (f"[{rc}] " if rc else "") + (str(raw.get("reject_reason") or "not live")[:160]))
        return v
    bad = v["reasons"]
    if raw.get("reject_class"):
        bad.append(f"model says it is not a signal ({raw.get('reject_class')})")
        v["reject_class"] = raw.get("reject_class")
    et = raw.get("event_type")
    if et not in ACTS:
        bad.append(f"event type '{et}' is not one of the signal acts")
    # POLICE IS NOT THE MILITARY (owner, 2026-10-23; force_context.py): a police act read out of war
    # reporting is troops, never police — the model's word is checked against the text
    if et == "police_intervention":
        import force_context
        if force_context.is_military(text):
            et = "troops_sighted"
    cert = raw.get("certainty")
    if cert not in ("verified", "unverified"):
        bad.append("certainty missing")
    # (a) the three quotes, verbatim: when, where, what
    tq, pq, aq = raw.get("evidence_quote_time"), raw.get("evidence_quote_place"), raw.get("evidence_quote_act")
    if not in_text(tq, text):
        bad.append("time quote is not in the text")
    if not in_text(pq, text):
        bad.append("place quote is not in the text")
    if not in_text(aq, text):
        bad.append("act quote is not in the text")
    # (b) the place, as written, and every word of context
    loc = raw.get("location")
    name = (loc or {}).get("name_as_written") if isinstance(loc, dict) else None
    level = (loc or {}).get("level") if isinstance(loc, dict) else None
    ctx = [c for c in ((loc or {}).get("context_as_written") or []) if isinstance(c, str) and c.strip()] if isinstance(loc, dict) else []
    if not isinstance(loc, dict) or not name:
        bad.append("no location stated")
    else:
        if not in_text(name, text):
            bad.append("place as written is not in the text")
        if level not in LEVELS:
            bad.append(f"level '{level}' is not an allowed level")
        from textclean import is_generic_place
        if is_generic_place(name):
            bad.append(f"'{name}' is a kind of place, not a place")
        for c in ctx:
            if not in_text(c, text):
                bad.append(f"context '{c[:30]}' is not in the text")
                break
    # (c) the event's time
    ev = parse_utc(raw.get("event_time"))
    pub = parse_utc(published_at)
    age = None
    if ev is None:
        bad.append("event time missing or unreadable")
    elif pub is None:
        bad.append("post time unreadable")
    else:
        age = (pub - ev).total_seconds() / 60
        if age < -SKEW_S / 60:
            bad.append(f"event time is {abs(int(age))} min after the post")
        elif age > LIVE_WINDOW_MIN:
            bad.append(f"event time is {int(age)} min before the post (window {LIVE_WINDOW_MIN})")
        if (now - ev).total_seconds() / 60 > LIVE_WINDOW_MIN:
            bad.append("the live window has passed")
    pc = past_cue(tq) if tq else None
    if pc:
        bad.append(f"the time quote points to an earlier time ('{pc}')")
    # (c2) the traps the owner found (2026-10-22): a forwarded header's clock is not the event's time;
    # a story told in the past is not live; an opinion is not an event
    hc = header_clock(text)
    if hc and tq and _clocks(tq) and _clocks(tq) <= {hc} and not NOW_WORDS.search(_f(tq)):
        bad.append(f"the only time quoted ({hc}) is the forwarded message's header, not the event's")
    sc = story_cue(text)
    if sc:
        bad.append(f"a story from another time ('{sc}')")
    oc = opinion_cue(text)
    if oc and not act_by_words(text):
        bad.append(f"opinion, not a report ('{oc}')")
    gname = (loc or {}).get("name_for_geocoder") if isinstance(loc, dict) else None
    # a crowd's direction: the words that say it must be in the text
    direction = None
    d = raw.get("direction")
    if et == "crowd_movement" and isinstance(d, dict) and in_text(d.get("as_written"), text):
        tp = d.get("toward_place")
        direction = {"as_written": d.get("as_written"), "toward_place": tp if isinstance(tp, str) and in_text(tp, text) else None}
    v.update(event_time=iso(min(ev, pub)) if ev and pub else (iso(ev) if ev else None), level=level, name=name,
             context=ctx, event_type=et, act=et if et in ACTS else None, certainty=cert,
             age_min=None if age is None else round(age, 1),
             geocoder_name=gname if isinstance(gname, str) else None, first_hand=bool(raw.get("first_hand")),
             direction=direction)
    v["ok"] = not bad
    return v


# ── geocoding the quoted place only ─────────────────────────────────────────
_PLACE_TYPES = {"city", "town", "village", "municipality", "hamlet", "island", "isolated_dwelling", "locality"}
_HOOD_TYPES = {"suburb", "neighbourhood", "neighborhood", "quarter", "borough", "city_district", "district",
               "residential", "city_block", "subdivision"}
_REGION_TYPES = {"state", "region", "province", "county", "state_district", "department", "governorate", "territory"}
_VENUE_CLASSES = {"amenity", "building", "shop", "tourism", "historic", "leisure", "office", "aeroway", "railway",
                  "man_made", "military", "power", "industrial", "craft", "healthcare", "emergency",
                  "public_transport", "landuse", "natural", "waterway", "barrier"}


_ADDR_LEVELS = (("neighborhood", ("suburb", "city_district", "neighbourhood", "quarter", "borough", "city_block")),
                ("city", ("city", "town", "village", "municipality", "hamlet")),
                ("region", ("county", "state_district", "state", "province", "region")))


def hit_level(h: dict) -> str | None:
    """What a geocoder answer IS, as one of LEVELS (or None when unclear).
    Class and type first; for an administrative boundary the finest address
    part it carries says what it is (Tbilisi and Berlin are city-states at
    rank 7-8 with a 'city' part; Kharkiv oblast has only a 'state');
    place_rank (Nominatim: 4 country, 8 state, 16 city, ~20 suburb, 26
    street, 30 a venue) when nothing else is known."""
    cls, typ = (h.get("class") or "").lower(), (h.get("type") or "").lower()
    rank = h.get("place_rank")
    try:
        rank = int(rank) if rank is not None else None
    except (TypeError, ValueError):
        rank = None
    if typ == "country" or (cls == "boundary" and rank is not None and rank <= 4):
        return "country"
    if cls == "highway" or (cls == "place" and typ in ("square", "road", "street")):
        return "street"
    if cls == "place" and typ in _HOOD_TYPES:
        return "neighborhood"
    if cls == "place" and typ in _REGION_TYPES:
        return "region"
    if cls == "place" and typ in _PLACE_TYPES:
        return "city"
    if cls == "boundary" and typ == "administrative":
        addr = h.get("address") or {}
        for level, keys in _ADDR_LEVELS:
            if any(k in addr for k in keys):
                return level
        if rank is not None:
            return "region" if rank <= 12 else ("city" if rank <= 17 else "neighborhood" if rank <= 24 else None)
        return "city"
    if cls in _VENUE_CLASSES or (cls == "place" and typ in ("house", "building")) or (rank is not None and rank >= 28):
        return "venue"
    return None


def level_matches(hit: dict, stated: str) -> bool:
    """The answer must be the kind of thing the text said — not a coarser
    place standing in for a finer one, not a venue standing in for a city."""
    return hit_level(hit) == stated


def _km(a: dict, b: dict) -> float:
    r = 6371.0
    p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
    dphi = p2 - p1
    dl = math.radians(b["lon"] - a["lon"])
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _name_tokens(name: str) -> list[str]:
    return [t for t in re.split(r"[^\w]+", fold(name)) if len(t) >= 4 and not t.isdigit()]


def _script(s: str) -> str:
    for c in s or "":
        if c.isalpha():
            n = unicodedata.name(c, "")
            for k in ("LATIN", "CYRILLIC", "ARABIC", "HEBREW", "GEORGIAN", "ARMENIAN", "GREEK"):
                if n.startswith(k):
                    return k
            return "OTHER"
    return ""


def _name_consistent(name: str, hit: dict) -> bool:
    """A Latin-script name must show in the answer's display name; other
    scripts are not compared (the answer is in the local language there)."""
    disp = hit.get("display_name") or ""
    if _script(name) != "LATIN" or _script(disp) != "LATIN":
        return True
    toks = _name_tokens(name)
    if not toks:
        return True
    hay = fold(" ".join([disp] + [str(v) for k, v in (hit.get("address") or {}).items() if "ISO" not in k and k != "country_code"]))
    return any(t in hay for t in toks)


NEAR_CONTEXT_KM = 40.0


def _near_context(hit: dict, context_cores: list[str], geocode, budget: list | None) -> tuple[bool, str | None]:
    """A street, a venue or a neighbourhood is small and its name is common
    (every town has a main avenue): it must lie near the city the text puts it
    in. The context is geocoded as a city (cached); when none of it resolves
    to a city there is nothing to compare and the geocoder's own reading of
    the query stands. (ok, why)."""
    centres = []
    for c in context_cores:
        if budget is not None:
            if budget[0] <= 0:
                break
            budget[0] -= 1
        try:
            hits = geocode(c) or []
        except Exception:                                      # noqa: BLE001
            hits = []
        cc = [h for h in hits if hit_level(h) == "city" and _name_consistent(c, h)]
        if cc:
            centres.append((c, cc[0]))
    if not centres:
        return True, None
    for c, ch in centres:
        if _km(hit, ch) <= NEAR_CONTEXT_KM:
            return True, None
    return False, f"the answer lies {int(min(_km(hit, ch) for _c, ch in centres))} km from {centres[0][0]}, the place the text puts it in"


def local_hits(name: str, text: str) -> list[dict]:
    """The local gazetteer (street_reports' squares and sites), used only when
    the TEXT names the city it is in: 'Châtelet' alone is not Paris."""
    try:
        import street_reports
        p = street_reports.place_in(name)
    except Exception:                                          # noqa: BLE001
        return []
    if not p or fold(p["city"]) not in fold(text):
        return []
    return [{"lat": p["lat"], "lon": p["lon"], "display_name": f"{p['name']}, {p['city']}", "class": "local",
             "type": p["kind"], "local": True}]


# The words that say which way or what kind, not which place ("dans le sud du
# Liban", "جنوب لبنان", "the port of", "ville de"): dropped from the QUERY only,
# never from what is stored or checked against the text.
_QUALIFIERS = {
    "dans", "le", "la", "les", "du", "de", "des", "au", "aux", "sud", "nord", "est", "ouest", "centre", "ville", "village", "port", "commune",
    "the", "of", "in", "south", "north", "east", "west", "southern", "northern", "eastern", "western", "central", "city", "town", "near", "outskirts",
    "جنوب", "شمال", "شرق", "غرب", "وسط", "جنوبي", "شمالي", "شرقي", "غربي", "في", "مدينة", "بلدة", "قرية", "مخيم", "حي", "منطقة", "ضاحية",
    "en", "el", "los", "las", "del", "ciudad", "pueblo", "sur", "norte", "oeste",
    "в", "у", "на", "місто", "город", "село", "селище", "область", "обл",
}


def core_words(s: str | None) -> str:
    toks = [t for t in re.split(r"[\s,;()]+", (s or "").strip()) if t]
    keep = [t for t in toks if fold(t).strip(".") not in _QUALIFIERS]
    return " ".join(keep) or (s or "").strip()


def stem_of_text(candidate: str | None, text: str | None) -> bool:
    """Is `candidate` (the model's dictionary form of the place) the place the
    text names? Yes when it occurs in the text, or shares a long stem with a
    word of it (Харкові → Харків, Белгороде → Белгород). A name the text does
    not support is ignored, so the model cannot smuggle a place in."""
    c = fold(candidate or "").strip()
    if len(c) < 3:
        return False
    t = fold(text)
    if c in t:
        return True
    for w in re.split(r"[^\w]+", t):
        n = min(len(w), len(c))
        if n < 4:
            continue
        common = 0
        for a, b in zip(w, c):
            if a != b:
                break
            common += 1
        if common >= 4 and common >= 0.6 * n and abs(len(w) - len(c)) <= 3:
            return True
    return False


def query_plan(name: str, geocoder_name: str | None, context: list[str], text: str = "") -> list[str]:
    """The questions put to the geocoder, in order, made only of the place the
    text names (its dictionary form when the text supports it) and the
    context the text itself quotes. Never the channel's city or country, and
    never the bare name once the text gave context for it."""
    # the model may give the place's bare / dictionary form only if it is a part of the place AS WRITTEN
    # ("central Kharkiv" -> "Kharkiv", "Харкові" -> "Харків"), never another place the text happens to name
    base = geocoder_name if stem_of_text(geocoder_name, name) else core_words(name)
    base = (base or name).strip()
    ctx = []
    for c in context or []:
        cc = core_words(c)
        if cc and norm(cc) not in {norm(x) for x in ctx} and norm(cc) != norm(base):
            ctx.append(cc)
    plan = []
    if ctx:
        plan.append(", ".join([base] + ctx))
        for c in reversed(ctx):                      # the country comes last in a text: try it first
            q = f"{base}, {c}"
            if q not in plan:
                plan.append(q)
    else:
        plan.append(base)
    return plan[:3]


DOMINANCE_GAP = float(os.getenv("LIVE_INCIDENT_DOMINANCE_GAP", "0.25") or 0.25)
# Off by default (the spec: "accept a result only if its precision matches the
# stated level"). On, a street or venue the geocoder cannot find falls back to
# the place the text says it is IN, at that place's own (coarser) level.
COARSER_FALLBACK = os.getenv("LIVE_INCIDENT_COARSER_FALLBACK", "0").strip() == "1"


def _pick(fit: list[dict], name: str) -> tuple[dict | None, str | None, str | None]:
    """(hit, None, note) | (None, why, None). One answer — or several that are
    the same place — or a clear leader by Nominatim's importance; otherwise the
    name is ambiguous and the text does not say which: rejected, never the
    famous one by default."""
    distinct = [fit[0]]
    for h in fit[1:]:
        if all(_km(h, d) > AMBIGUITY_KM for d in distinct):
            distinct.append(h)
    if len(distinct) == 1:
        return fit[0], None, None
    imp = sorted(((float(h.get("importance") or 0), i) for i, h in enumerate(distinct)), reverse=True)
    if imp[0][0] > 0 and imp[0][0] - imp[1][0] >= DOMINANCE_GAP:
        top = distinct[imp[0][1]]
        return top, None, f"clear leader among {len(distinct)} places called '{name}' (importance {imp[0][0]:.2f} vs {imp[1][0]:.2f})"
    return None, f"{len(distinct)} different places called '{name}', and the text does not say which", None


def resolve_place(name: str, level: str, context: list[str], text: str, *, geocode=None,
                  budget: list | None = None, geocoder_name: str | None = None) -> tuple[dict | None, str | None, dict]:
    """(hit, None, info) or (None, why, info). Geocodes the quoted place and
    the context the text itself quotes, nothing else. `info` is the audit:
    the questions asked, the candidates, the ambiguity note."""
    info = {"queries": [], "query": None, "candidates": []}
    if level not in PIN_LEVELS:
        return None, f"stated level '{level}' is too coarse to pin", info
    local = local_hits(name, text) if level in ("venue", "street", "neighborhood") else []
    if local:
        info["query"] = name
        info["candidates"] = [{"name": local[0]["display_name"], "lat": local[0]["lat"], "lon": local[0]["lon"], "level": level}]
        return local[0], None, info
    if geocode is None:
        from geocode_utils import geocode_place as geocode
    last_why = "did not resolve"
    for query in query_plan(name, geocoder_name, context, text):
        if budget is not None:
            if budget[0] <= 0:
                return None, "geocoder budget spent this pass", info
            budget[0] -= 1
        info["queries"].append(query)
        info["query"] = query
        hits = geocode(query) or []
        info["candidates"] = [{"name": (h.get("display_name") or "")[:90], "lat": h.get("lat"), "lon": h.get("lon"),
                               "class": h.get("class"), "type": h.get("type"), "level": hit_level(h),
                               "importance": h.get("importance")} for h in hits]
        if not hits:
            last_why = f"'{query}' did not resolve"
            continue
        fit = [h for h in hits if level_matches(h, level) and _name_consistent(query.split(",")[0], h)]
        if not fit:
            got = ", ".join(sorted({hit_level(h) or "?" for h in hits}))
            last_why = f"geocoder answered at another level ({got}), the text stated {level}"
            continue
        hit, why, note = _pick(fit, name)
        if hit is None:
            info["ambiguity_note"] = why
            return None, why, info
        if level in ("venue", "street", "neighborhood"):
            near, far = _near_context(hit, [x.strip() for x in query.split(",")[1:] if x.strip()], geocode, budget)
            if not near:
                info["context_check"] = far
                last_why = far
                continue
        if note:
            info["dominance"] = note
        return hit, None, info
    if COARSER_FALLBACK and context and level in ("venue", "street", "neighborhood"):
        # the incident is IN a place the text names: pin that place, at its own level
        inner = [geocoder_name] if geocoder_name and stem_of_text(geocoder_name, name) and norm(geocoder_name) != norm(name) else []
        for c in inner + list(reversed([core_words(x) for x in context if core_words(x)])):
            if budget is not None:
                if budget[0] <= 0:
                    break
                budget[0] -= 1
            hits = geocode(c) or []
            fit = [h for h in hits if hit_level(h) == "city" and _name_consistent(c, h)]
            if fit:
                hit, why, note = _pick(fit, c)
                if hit is not None:
                    info["fallback"] = f"'{name}' not found at {level} level: pinned at {c} (city level), which the text names"
                    info["query"] = c
                    info["fallback_level"] = "city"
                    return hit, None, info
    return None, last_why, info


# ── the post's row ──────────────────────────────────────────────────────────
LIVE_COLUMNS = {"live_checked": "INTEGER", "live_at": "TEXT", "live_json": "TEXT", "live_verdict": "TEXT",
                "live_hash": "TEXT", "live_cost": "REAL", "event_time": "TEXT"}


def decide(raw: dict | None, text: str, published_at: str, now: _dt.datetime | None = None, *,
           geocode=None, budget: list | None = None) -> dict:
    """The whole decision for one model answer: {verdict, ok, pin (hit or
    None), level, event_time, event_type, certainty, name, why, audit}. Pure
    but for the geocoder passed in."""
    v = verify(raw, text, published_at, now)
    audit = {"model": raw, "verify": {k: v[k] for k in ("ok", "reasons", "event_time", "level", "name", "context", "geocoder_name",
                                                         "act", "first_hand", "direction", "reject_class")}}
    out = {"ok": False, "pin": None, "audit": audit, "verdict": None, "event_time": None, "why": None,
           "event_type": v["event_type"], "act": v["act"], "certainty": v["certainty"], "name": v["name"],
           "level": v["level"], "first_hand": v["first_hand"], "direction": None}
    if not v["ok"]:
        out["why"] = "; ".join(v["reasons"])[:300]
        out["verdict"] = "rejected: " + out["why"]
        return out
    out["ok"] = True
    out["event_time"] = v["event_time"]
    hit, why, info = resolve_place(v["name"], v["level"], v["context"], text, geocode=geocode, budget=budget,
                                   geocoder_name=v.get("geocoder_name"))
    audit["geocode"] = info
    if info.get("fallback_level"):
        out["level"] = info["fallback_level"]
    if hit is None:
        # the incident is live and its place is stated, but cannot be pinned
        # with confidence: live, unplaced — and rejected where ambiguous
        amb = info.get("ambiguity_note")
        out["why"] = why
        out["verdict"] = ("rejected: " + why) if amb else f"live, unplaced: {why}"
        out["ok"] = not amb
        if amb:
            out["event_time"] = None
        return out
    out["pin"] = hit
    out["verdict"] = "live"
    # a crowd's heading: the place its words name, found near the crowd (the same 40 km rule as a street)
    d = v.get("direction")
    if d and d.get("toward_place"):
        try:
            h2, _why2, _i2 = resolve_place(d["toward_place"], "neighborhood", v["context"], text, geocode=geocode,
                                           budget=budget)
            if h2 is not None and _km(hit, h2) <= NEAR_CONTEXT_KM and _km(hit, h2) > 0.03:
                d = {**d, "lat": h2["lat"], "lon": h2["lon"]}
        except Exception:                                      # noqa: BLE001
            pass
    out["direction"] = d
    audit["direction_resolved"] = d
    return out


def ensure_columns(con) -> None:
    have = {r[1] for r in con.execute("PRAGMA table_info(telegram_posts)")}
    for col, typ in LIVE_COLUMNS.items():
        if col not in have:
            con.execute(f"ALTER TABLE telegram_posts ADD COLUMN {col} {typ}")


ACT_LABEL = {"arrest": "Arrest", "shots_fired": "Shots fired", "explosion": "Explosion", "strike": "Strike",
             "missile_launch": "Missile launch", "missile_impact": "Missile impact", "crowd_movement": "Crowd",
             "troops_sighted": "Troops sighted", "police_intervention": "Police intervention"}
_POLICE_KINDS = [(re.compile(r"lacrymo|tear ?gas|gaze|gazent|مسيل للدموع|сльозогінн|слезоточив", re.I), "Tear gas"),
                 (re.compile(r"\blbd\b|flashball|rubber bullet|balles? en caoutchouc", re.I), "Rubber bullets"),
                 (re.compile(r"nasse|kettl|encercl", re.I), "Kettle"),
                 (re.compile(r"canons? a eau|water cannon", re.I), "Water cannon"),
                 (re.compile(r"charge", re.I), "Police charge")]


def act_label(act: str | None, quote: str | None = None) -> str:
    """The card's name for the act ('Tear gas', 'Police charge', 'Arrest')."""
    if act == "police_intervention" and quote:
        q = fold(quote)
        for rx, label in _POLICE_KINDS:
            if rx.search(q):
                return label
    return ACT_LABEL.get(act or "", "Incident")


def card_headline(act: str | None, quote: str | None, name: str | None, context=None, direction=None) -> str:
    """'Arrest at rue de Rivoli, Paris' — the act, the place as written, the city the text gives. No emoji."""
    from textclean import strip_emoji
    place = strip_emoji(name or "")
    ctx = [strip_emoji(c) for c in (context or []) if isinstance(c, str)]
    ctx = [c for c in ctx if c and fold(c) not in fold(place)]
    where = ", ".join([place] + ctx[:1]) if place else ""
    head = f"{act_label(act, quote)} at {where}" if where else act_label(act, quote)
    to = (direction or {}).get("toward_place") if isinstance(direction, dict) else None
    if act == "crowd_movement" and to:
        head = f"Crowd at {where}, moving toward {strip_emoji(to)}" if where else f"Crowd moving toward {strip_emoji(to)}"
    return head


def is_live_now(row: dict, now: _dt.datetime | None = None) -> bool:
    """LIVE IS DERIVED ON READ: a pinned incident the extractor (or, with the
    model out, the rule) judged live, and its event is still within the
    window of `now`. No 'live' flag is stored; a signal leaves the live set
    LIVE_WINDOW_MIN after its event_time."""
    if not row or (row.get("live_verdict") or "") not in ("live", "rule-live"):
        return False
    ev = parse_utc(row.get("event_time"))
    if ev is None:
        return False
    now = now or _dt.datetime.now(_dt.timezone.utc)
    return -SKEW_S <= (now - ev).total_seconds() <= LIVE_WINDOW_MIN * 60


def live_fields(row, now: _dt.datetime | None = None) -> dict:
    """What a post carries to its readers about its time: event_time (only
    when a reading established one), live (derived now), live_state:
    live | past (was live, the window has passed) | not_live (judged, and
    it is not) | unchecked (not judged yet), and who judged (model | rule)."""
    r = row if isinstance(row, dict) else dict(row)
    verdict = r.get("live_verdict") or ""
    if verdict in ("live", "rule-live"):
        live = is_live_now(r, now)
        state, ev = ("live" if live else "past"), r.get("event_time")
    elif verdict:
        live, state, ev = False, "not_live", (r.get("event_time") if verdict.startswith("live,") else None)
    else:
        live, state, ev = False, "unchecked", None
    return {"event_time": ev, "live": live, "live_state": state,
            "live_basis": "rule" if verdict == "rule-live" else ("model" if verdict else None)}


# ── caps ────────────────────────────────────────────────────────────────────

def spent_counts(con, now: _dt.datetime) -> dict:
    h = con.execute("SELECT COUNT(*) FROM telegram_posts WHERE live_cost > 0 AND live_at >= ?",
                    (iso(now - _dt.timedelta(hours=1)),)).fetchone()[0]
    d = con.execute("SELECT COUNT(*), COALESCE(SUM(live_cost), 0) FROM telegram_posts WHERE live_cost > 0 AND live_at >= ?",
                    (iso(now - _dt.timedelta(hours=24)),)).fetchone()
    return {"hour": h, "day": d[0], "usd_day": round(d[1], 5)}


def budget(con, now: _dt.datetime | None = None) -> dict:
    now = now or _dt.datetime.now(_dt.timezone.utc)
    c = spent_counts(con, now)
    return {**c, "per_hour": PER_HOUR, "per_day": PER_DAY,
            "left": max(0, min(PER_HOUR - c["hour"], PER_DAY - c["day"]))}


# ── the pass ────────────────────────────────────────────────────────────────

def _chat_context(chan: str) -> tuple[str, str]:
    """(source_name, source_region): given to the model as context ONLY."""
    try:
        import telegram_signals
        c = telegram_signals.chat_context(chan)
        return chan, ", ".join(x for x in (c.get("region"), c.get("country")) if x)
    except Exception:                                          # noqa: BLE001
        return chan, ""


def _chat_cc(chan: str) -> str | None:
    try:
        import telegram_signals
        return telegram_signals.chat_context(chan).get("country")
    except Exception:                                          # noqa: BLE001
        return None


def _write(con, row: dict, d: dict, raw: dict | None, cost: float, now: _dt.datetime, model: str) -> None:
    audit = dict(d["audit"])
    audit["model_name"] = model
    audit["decided_at"] = iso(now)
    sets = {"live_checked": 1, "live_at": iso(now), "live_json": json.dumps(audit, ensure_ascii=False)[:8000],
            "live_verdict": d["verdict"][:300], "live_cost": round(cost, 6)}
    if d["ok"]:
        sets["event_time"] = d["event_time"]
    pin = d["pin"]
    if pin is not None:
        prec = PIN_LEVELS.get(d["level"], "city")
        if d["level"] == "city":
            t = (pin.get("type") or "")
            prec = t if t in ("village", "town") else "city"
        sets.update({"relevant": 1, "event_type": ACT_EVENT_TYPE.get(d["act"], d["event_type"]), "place": d["name"],
                     "precision": prec, "country_code": ((pin.get("country_code") or "") or None),
                     "lat": pin["lat"], "lon": pin["lon"],
                     "geocoded_as": (pin.get("display_name") or "")[:300], "unpublished_reason": None,
                     # the card's words, short and plain (owner, 2026-10-22): no emoji, no 'report', no channel
                     "headline": card_headline(d["act"], (raw or {}).get("evidence_quote_act"), d["name"],
                                               (d["audit"].get("verify") or {}).get("context"), d.get("direction"))[:200]})
    elif d["ok"]:
        sets["unpublished_reason"] = f"live, not pinned: {d['why']}"[:300]
    elif (row.get("live_verdict") or "") == "rule-live" or (row.get("read_by") == "rule" and row.get("lat") is not None):
        # a rule's pin the strict reading does not stand behind
        sets.update({"lat": None, "lon": None, "geocoded_as": None, "unpublished_reason": d["verdict"][:300]})
    keys = list(sets)
    con.execute(f"UPDATE telegram_posts SET {', '.join(k + '=?' for k in keys)} WHERE channel=? AND msg_id=?",
                [sets[k] for k in keys] + [row["channel"], row["msg_id"]])


def candidates(con, now: _dt.datetime, limit: int = 400) -> list[dict]:
    """Posts inside the window not yet judged. Newest first."""
    since = iso(now - _dt.timedelta(minutes=LIVE_WINDOW_MIN))
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute(
            "SELECT channel, msg_id, channel_title, posted_at, text, role, chat_kind, read_by, lat, lon, country_code, claim, headline,"
            " live_verdict FROM telegram_posts WHERE live_checked IS NULL AND posted_at >= ? AND text IS NOT NULL"
            " AND COALESCE(role,'') != 'ignore' ORDER BY posted_at DESC LIMIT ?", (since, limit)).fetchall()
    finally:
        con.row_factory = None
    return [dict(r) for r in rows]


def gate_reason() -> str | None:
    """Why the model is not available to this module, or None when it is.
    HW_OPENAI_PURPOSES in production is an explicit list: a purpose missing
    from it is off, and a feature that is off in silence is a defect."""
    import openai_gate
    if not openai_gate.is_enabled(openai_gate.LIVE_INCIDENT):
        return "purpose 'live_incident' is not in HW_OPENAI_PURPOSES"
    if not os.getenv("OPENAI_API_KEY"):
        return "no OPENAI_API_KEY"
    if openai_gate.quota_paused():
        return "OpenAI credit exhausted (all model passes paused)"
    if openai_gate.over_budget():
        return "monthly OpenAI budget spent (OPENAI_BUDGET_USD)"
    return None


_GATE_LOG = {"at": 0.0}


def _note_gate_closed() -> None:
    """Said loudly, at most every 30 minutes, with the reason."""
    import time as _t
    why = gate_reason() or "model gate closed"
    with _STATUS_LOCK:
        STATUS["gate_reason"] = why
    if _t.time() - _GATE_LOG["at"] > 1800:
        _GATE_LOG["at"] = _t.time()
        print(f"[live-incident] NOT RUNNING — no model: {why}. Posts are read by rule (telegram_rules) meanwhile.", flush=True)


WATCH_GATE = os.getenv("LIVE_INCIDENT_WATCH_GATE", "1").strip() != "0"


def run_once(con=None, now: _dt.datetime | None = None, *, extract_fn=None, geocode=None, gate_ok=None,
             watch=None) -> dict:
    """One pass over the posts of the last LIVE_WINDOW_MIN. `extract_fn(text,
    published_at, source_name, source_region)` → (raw, cost) | (None, 0) when
    no model; default is `extract`. Failures are counted and logged loudly."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    own = con is None
    if own:
        import telegram_ingest
        con = telegram_ingest._con()
    out = {"considered": 0, "live": 0, "rejected": 0, "unplaced": 0, "reused": 0, "skipped": 0, "capped": 0,
           "failed": 0, "model_out": False, "not_watched": 0, "focus": 0}
    try:
        ensure_columns(con)
        with _STATUS_LOCK:
            STATUS["passes"] += 1
            STATUS["last_pass_at"] = iso(now)
        if not ENABLED:
            return {**out, "disabled": True}
        import openai_gate
        if gate_ok is None:
            gate_ok = (openai_gate.get_client(openai_gate.LIVE_INCIDENT) is not None) if extract_fn is None else True
        rows = candidates(con, now)
        todo, seen_hash = [], {}
        for r in rows:
            ok, drone = prefilter(r["text"])
            if not ok:
                out["skipped"] += 1
                _bump("skipped_prefilter")
                con.execute("UPDATE telegram_posts SET live_checked=1, live_at=?, live_verdict=? WHERE channel=? AND msg_id=?",
                            (iso(now), "skipped: no incident words (prefilter)", r["channel"], r["msg_id"]))
                continue
            # no model call for what the code would reject anyway (verify() holds the same two checks)
            why_not = None
            sc = story_cue(r["text"])
            if sc:
                why_not = f"a story from another time ('{sc}')"
            elif opinion_cue(r["text"]) and not act_by_words(r["text"]):
                why_not = "opinion, not a report"
            if why_not:
                out["rejected"] += 1
                _bump("rejected")
                _reject_count(why_not)
                con.execute("UPDATE telegram_posts SET live_checked=1, live_at=?, live_verdict=? WHERE channel=? AND msg_id=?",
                            (iso(now), f"rejected: {why_not} (before the model)", r["channel"], r["msg_id"]))
                continue
            r["_drone"] = drone
            r["_hash"] = text_hash(r["text"])
            # ONLY WHAT SOMEONE WATCHES (owner, 2026-10-23, watch_gate.py): a post outside every user's profile
            # gets no model call; the rule reading (telegram_ingest, rule_decide) is all it gets
            r["_focus"] = False
            if watch is not None or (WATCH_GATE and extract_fn is None):
                import watch_gate
                try:
                    w_ok, focus, w_why = watch_gate.judge(r, watch, _chat_cc(r["channel"]))
                except Exception as e:                                  # noqa: BLE001
                    print(f"[live-incident] error: watch gate: {type(e).__name__}: {e}", flush=True)
                    w_ok, focus, w_why = True, False, "gate error: open"
                if not w_ok:
                    out["not_watched"] += 1
                    _bump("skipped_not_watched")
                    watch_gate.STATUS["not_watched"] += 1
                    con.execute("UPDATE telegram_posts SET live_checked=1, live_at=?, live_verdict=? WHERE channel=? AND msg_id=?",
                                (iso(now), f"skipped: not watched by any user ({w_why}); rule path only"[:300], r["channel"], r["msg_id"]))
                    continue
                watch_gate.STATUS["watched"] += 1
                if focus:
                    watch_gate.STATUS["focus"] += 1
                    out["focus"] += 1
                r["_focus"] = focus
            todo.append(r)
        con.commit()
        if not todo:
            return out
        if not gate_ok:
            # NO MODEL: nothing is judged; the rule path (telegram_rules, with
            # rule_live) is what places posts meanwhile, and the extractor
            # judges them when the model is back, while still in the window
            out["model_out"] = True
            _bump("model_out_passes")
            _note_gate_closed()
            return out
        # stable: a focus area first (a city-scale theater, a position: Paris on Saturday), then strong event words,
        # newest first within
        todo.sort(key=lambda r: (not r.get("_focus"), r["_drone"]))
        left = budget(con, now)["left"]
        extract_fn = extract_fn or (lambda t, p, n, rg: extract(t, p, n, rg))
        geo_budget = [GEOCODES_PER_PASS]
        # identical texts once: another post carrying the same words in the
        # last hours lends its answer (verified again against this post's time)
        prior = {}
        for r in todo:
            hit = con.execute("SELECT live_json, posted_at FROM telegram_posts WHERE live_hash=? AND live_json IS NOT NULL"
                              " AND posted_at >= ? ORDER BY posted_at DESC LIMIT 1",
                              (r["_hash"], iso(now - _dt.timedelta(hours=3)))).fetchone()
            if hit:
                try:
                    prior[r["_hash"]] = json.loads(hit[0]).get("model")
                except Exception:                                      # noqa: BLE001
                    pass
        fresh, reuse = [], []
        for r in todo:
            if r["_hash"] in prior and prior[r["_hash"]] is not None:
                reuse.append(r)
            elif r["_hash"] in seen_hash:
                reuse.append(r)               # twin in this pass: answered below, from the first
            else:
                seen_hash[r["_hash"]] = r
                fresh.append(r)
        fresh = fresh[:PER_PASS]
        if len(fresh) > left:
            out["capped"] = len(fresh) - left
            _bump("capped", out["capped"])
            if left <= 0 or STATUS.get("capped", 0) % 50 == 1:
                print(f"[live-incident] CAP reached ({budget(con, now)}): {out['capped']} posts wait for the next window", flush=True)
            fresh = fresh[:max(left, 0)]
        from concurrent.futures import ThreadPoolExecutor

        def call(r):
            try:
                src, region = _chat_context(r["channel"])
                src = r.get("channel_title") or src
                return extract_fn(r["text"], r["posted_at"], src, region)
            except Exception as e:                                     # noqa: BLE001
                openai_gate.note_error(e)
                _bump("failed_calls")
                with _STATUS_LOCK:
                    STATUS["last_error"] = f"{type(e).__name__}: {str(e)[:200]}"
                print(f"[live-incident] error: model call {r['channel']}/{r['msg_id']}: {type(e).__name__}: {e}", flush=True)
                return "failed"
        with ThreadPoolExecutor(max_workers=4, thread_name_prefix="live-incident-call") as pool:
            answers = list(pool.map(call, fresh))
        _bump("model_calls", len(fresh))
        _bump("focus_first", sum(1 for r in fresh if r.get("_focus")))
        raw_by_hash = {}
        for r, ans in zip(fresh, answers):
            out["considered"] += 1
            if ans == "failed":
                out["failed"] += 1
                continue                                              # stays unchecked: retried while in the window
            raw, cost = ans
            if raw is None:
                out["model_out"] = True
                continue
            raw_by_hash[r["_hash"]] = raw
            _apply(con, r, raw, cost, now, geocode, geo_budget, out)
        for r in reuse:
            raw = raw_by_hash.get(r["_hash"], prior.get(r["_hash"]))
            if raw is None:
                continue
            out["reused"] += 1
            _bump("reused")
            _apply(con, r, raw, 0.0, now, geocode, geo_budget, out)
        con.commit()
        if out["failed"]:
            print(f"[live-incident] {out['failed']} of {len(fresh)} model calls failed this pass", flush=True)
        return out
    finally:
        if own:
            con.close()


def _apply(con, r: dict, raw: dict, cost: float, now: _dt.datetime, geocode, geo_budget: list, out: dict) -> None:
    d = decide(raw, r["text"], r["posted_at"], now, geocode=geocode, budget=geo_budget)
    con.execute("UPDATE telegram_posts SET live_hash=? WHERE channel=? AND msg_id=?", (r["_hash"], r["channel"], r["msg_id"]))
    _write(con, r, d, raw, cost, now, MODEL)
    _bump("extracted")
    if d["verdict"] == "live":
        out["live"] += 1
        _bump("live")
        with _STATUS_LOCK:
            STATUS["last_live"] = {"post": f"{r['channel']}/{r['msg_id']}", "place": d["name"], "at": iso(now)}
    elif d["ok"]:
        out["unplaced"] += 1
        _bump("unplaced")
    else:
        out["rejected"] += 1
        _bump("rejected")
        _reject_count(d["why"] or "rejected")


def status() -> dict:
    with _STATUS_LOCK:
        out = {k: (dict(v) if isinstance(v, dict) else v) for k, v in STATUS.items()}
    out.update({"enabled": ENABLED, "model": MODEL, "window_min": LIVE_WINDOW_MIN, "per_hour": PER_HOUR,
                "per_day": PER_DAY, "watch_gate_on": WATCH_GATE})
    try:
        import watch_gate
        out["watch_gate"] = watch_gate.status()            # model calls only for what a user watches
    except Exception as e:                                   # noqa: BLE001
        out["watch_gate"] = {"error": f"{type(e).__name__}: {e}"}
    try:
        out["gate_closed_because"] = gate_reason()          # None: the model is available
    except Exception as e:                                   # noqa: BLE001
        out["gate_closed_because"] = f"{type(e).__name__}: {e}"
    try:
        import telegram_ingest
        con = telegram_ingest._con()
        try:
            ensure_columns(con)
            out["budget"] = budget(con)
            since = iso(_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(hours=24))
            out["read_24h"] = dict(con.execute(
                "SELECT CASE WHEN live_verdict='live' THEN 'live' WHEN live_verdict LIKE 'live,%' THEN 'live_unplaced'"
                " WHEN live_verdict LIKE 'rejected%' THEN 'rejected' WHEN live_verdict LIKE 'skipped%' THEN 'skipped'"
                " ELSE 'other' END, COUNT(*) FROM telegram_posts WHERE live_at >= ? GROUP BY 1", (since,)).fetchall())
        finally:
            con.close()
    except Exception as e:                                         # noqa: BLE001
        out["budget_error"] = f"{type(e).__name__}: {e}"
    return out
