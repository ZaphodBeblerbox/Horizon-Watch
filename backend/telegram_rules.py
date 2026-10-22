"""
telegram_rules.py — reading a Telegram post without a model.

WHY (2026-10-19). On 2026-10-18 the OpenAI credit ran out. Every Telegram
reading was a model call, so from that moment no post became relevant, none
was placed, none reached the map, the Desk or a notification: 0 of ~9,500
posts in two days, while the channels carried "عاجل | طيران الاحتلال يشن
غارتين على أطراف بلدة برعشيت" (two airstrikes on Bar'ashit, south Lebanon),
"Artillery shelling targets the town of Mansouri, southern Lebanon",
"КАБ на Тишки" (a glide bomb on Tyshky, Kharkiv). Signals that matter must
not depend on a paid model being up.

WHAT IT DOES. The words of events in the languages the channels write in
(English, French, Spanish, Arabic, Ukrainian, Russian, Hebrew): which event
it is, and the place the post names after a place word ("the town of X",
"بلدة X", "на X", "in X"). The place becomes coordinates only through the
same publish rule as the model's reading (telegram_ingest.locate: a
settlement inside the country the post or the chat is about). It is
conservative on purpose: no event word, no reading; a place it is not sure
of is left unplaced (the post still reaches the feed, not the map).

AUDITABLE. Each reading says it was read by rule (telegram_posts.read_by =
'rule'), with the words that matched in unpublished_reason or the headline,
and the model re-reads it when the credit is back (telegram_ingest.classify).

Pure functions, no I/O except `resolve` (the geocoder, via locate).
"""
from __future__ import annotations

import re
import unicodedata

# ── event words ────────────────────────────────────────────────────────────
# Order is priority: the first kind that matches names the event.
EVENTS: list[tuple[str, str]] = [
    ("explosion", r"\bexplosions?\b|\bblasts?\b|\bexploded\b|\bdetonat\w*|\bexplosion\b|\bexplosi[oó]n\w*|"
                  r"انفجار|انفجارات|دوي انفجار|вибух\w*|взрыв\w*|פיצוץ"),
    ("strike", r"\bair ?strikes?\b|\bair ?raids?\b|\bstrikes? (?:on|against|hit|targeted)\b|\bstruck\b|\bshelling\b|\bshelled\b|"
               r"\bartillery\b|\bbombard\w*|\bbombing\b|\bglide bombs?\b|\bmissile (?:strike|attack|hit)s?\b|\bdrone strikes?\b|\btargeted by\b|\bwere targeted\b|"
               r"\bfrappes?\b|\bbombardement\w*|\bobus\b|\bbombardeo\w*|\bataque a[eé]reo\b|"
               r"غارة|غارات|غارت\w*|قصف|يقصف|تقصف|استهداف|يستهدف|تستهدف|استهدفت|صاروخ|صواريخ|"
               r"\bкаб\b|авіаудар\w*|удар\w* по\b|обстріл\w*|обстрел\w*|приліт\w*|прилет\w*|влучан\w*|ракетн\w* удар\w*|"
               r"תקיפ\w*|הפצצ\w*"),
    ("attack", r"\bgunmen\b|\bshooting\b|\bshot dead\b|\bopened fire\b|\bstabbing\b|\bambush\w*|\bterror(?:ist)? attack\b|"
               r"\battack(?:ed|s)? (?:on|in|at|against)\b|\bfusillade\b|\bpris pour cible\b|\btiroteo\b|\bbalacera\b|\bemboscada\b|"
               r"هجوم|إطلاق نار|اطلاق نار|стрілян\w*|стрельб\w*|стріл(?:ок|ка|ець|ця)\w*|стрелок|стрелка|поранено|ранены|\bdeath toll\b|\bwounded in\b|напад\w*|פיגוע|ירי"),
    ("clash", r"\bclash(?:es|ed)?\b|\bfirefights?\b|\bheavy fighting\b|\baffrontements?\b|\bheurts\b|\benfrentamientos?\b|"
              r"اشتباك\w*|مواجهات|бо[їй]\b|бої за|зіткнен\w*|столкновен\w*|עימות\w*"),
    ("interception", r"\bintercept(?:ed|ion|s)\b|\bshot down\b|\bair defen[cs]es? (?:active|engaged|intercepted)\b|\binterception\b|"
                     r"اعتراض|التصدي|أسقطت|اسقاط|збит\w*|збили|сбит\w*|сбили|יירוט"),
    ("movement", r"\braid(?:ed|s)?\b|\bincursion\b|\bstormed\b|\btanks? (?:entered|advanced|moved)\b|\btroops (?:entered|advanced)\b|"
                 r"\bbulldoz\w*|\bmilitary convoy\b|"
                 r"تقتحم|يقتحم|اقتحام|اقتحمت|توغل|تتوغل|توغلت|انتشار عسكري|штурм\w*|колон\w* техніки"),
    ("unrest", r"\bprotest(?:s|ers|ors)?\b|\bdemonstrat(?:ion|ors|ions)\b|\briots?\b|\btear ?gas\b|\bwater cannons?\b|"
               r"\bpolice (?:charged|fired|clashed|dispersed|attacked|beat)\b|\bkettl\w*|\briot police\b|"
               r"\bmanifestation\w*|\bmanifestants?\b|\bemeute\w*|\blacrymo\w*|\bcanons? a eau\b|\bcharge (?:de police|des crs|policiere)\b|"
               r"\bfrapp\w* par (?:la )?police\b|\bviolences? policieres?\b|"
               r"\bprotesta\w*|\bmanifestaci[oó]n\w*|\blacrim[oó]gen\w*|\brepresi[oó]n\b|"
               r"احتجاج\w*|مظاهر\w*|متظاهر\w*|مسيل للدموع|مسيلة للدموع|قنابل الغاز|"
               r"протест\w*|мітинг\w*|митинг\w*|сльозогінн\w*|слезоточив\w*|הפגנ\w*|מפגינ\w*"),
    ("infrastructure_damage", r"\bpower outages?\b|\bblackouts?\b|\bsubstation\b|\brefinery (?:fire|hit|ablaze)\b|"
                              r"\bfire (?:at|broke out at) (?:the )?(?:refinery|plant|depot|port|substation)\b|"
                              r"انقطاع (?:الكهرباء|التيار)|حريق في|знеструмлен\w*|блекаут\w*|пожеж\w*|пожар\w* на\b"),
]
_EVENTS = [(k, re.compile(p, re.I)) for k, p in EVENTS]

# Warnings of a threat are not events: Ukraine's air-raid channels post one
# for every district every few minutes ("Загроза застосування БПЛА.
# Перейдіть в укриття!", "Відбій тривоги"). A warning that also names a hit
# ("вибух", "приліт") still reads as the hit.
ALERT_ONLY = re.compile(r"тривог\w*|загроз\w*|відбій|укритт\w*|тревог\w*|угроз\w*|укрыти\w*|"
                        r"\balert status\b|\bair raid (?:alert|siren)s?\b|\bsirens? (?:sounded|in)\b|"
                        r"صفارات الإنذار|אזעק\w*|\bwarning\b", re.I)
HARD_HIT = re.compile(r"вибух\w*|взрыв\w*|приліт\w*|прилет\w*|влучан\w*|\bexplosion|\bimpact\b|\bhit\b", re.I)

def is_warning_only(text: str | None) -> bool:
    """An air-raid alert, an all-clear, a threat warning: it names no hit.
    Ukraine's alert channels post one per district every few minutes, and the
    model reads them as 'unrest' with a place (2026-10-22), so the model's
    reading is screened by the same words."""
    t = fold(text)
    return bool(t.strip()) and bool(ALERT_ONLY.search(t)) and not HARD_HIT.search(t)


# Talk about an event is not one: a statement, a threat, an analysis.
TALK = re.compile(r"\b(?:says?|said|stated|warns?|threaten\w*|vows?|could|may|might|would|will)\b|"
                  r"\bstatement\b|\bspokes(?:man|person)\b|\binterview\b|\banalysis\b", re.I)

# ── places ─────────────────────────────────────────────────────────────────
# A capitalised name after a place word. Kept narrow: "in Riyadh", "the town
# of Mansouri", "بلدة برعشيت", "на Тишки". Several candidates per post; the
# geocoder decides which (if any) is a settlement in the right country.
_CAP = r"[A-Z][\w'’\-]+(?:[\s\-](?:al-|el-|Al-|El-)?[A-Z][\w'’\-]+){0,2}"
PLACE_PATTERNS = [
    # "the town of Mansouri", "village of Kfar Kila", "outskirts of Khan Younis"
    re.compile(rf"\b(?:town|village|city|area|outskirts|camp|district|neighbou?rhood|suburb|port) of ({_CAP})"),
    # "the Saudi capital, Riyadh"
    re.compile(rf"\bcapital,? ({_CAP})"),
    # "in Riyadh", "near Pokrovsk", "targets Mansouri", "on Kharkiv"
    re.compile(rf"\b(?:in|near|at|on|outside|targets?|targeting|hit|struck|stormed|entered|raided|into) (?:the )?({_CAP})"),
    # French and Spanish
    re.compile(rf"(?:\bà|\bau|\bprès de|\bdevant|\bvers|\bcerca de|\bfrente a|\ben) ({_CAP})"),
    # Arabic: a place word, then one or two words
    re.compile(r"(?:بلدة|بلدتي|مدينة|قرية|مخيم|حي|منطقة|ضاحية|أطراف|محيط|مدينتي)\s+([^\s،,.\-|:؛()«»\"]+(?:\s+(?!و)[^\s،,.\-|:؛()«»\"]+)?)"),
    # Ukrainian/Russian: "на Тишки", "у Харкові", "біля Покровська", "по Дніпру"
    re.compile(r"(?:^|\s)(?:на|в|у|біля|поблизу|повз|по|возле|под)\s+([А-ЯІЇЄҐ][а-яіїєґ'’\-]+(?:[\s\-][А-ЯІЇЄҐ][а-яіїєґ'’\-]+)?)"),
]

# Capitalised words that are not places (or not precise ones).
NOT_PLACE = {
    "the", "a", "an", "this", "today", "yesterday", "monday", "tuesday", "wednesday", "thursday", "friday",
    "saturday", "sunday", "january", "february", "march", "april", "may", "june", "july", "august",
    "september", "october", "november", "december", "breaking", "urgent", "update", "video", "photo",
    "telegram", "idf", "irgc", "hamas", "hezbollah", "russia", "ukraine", "israel", "iran", "lebanon",
    "yemen", "syria", "iraq", "gaza", "west bank", "saudi arabia", "sudan", "france", "venezuela", "myanmar",
    "burkina faso", "burkina", "mali", "niger", "congo", "kenya", "somalia", "ethiopia", "libya", "tunisia",
    "algeria", "morocco", "gaza strip", "sinai", "europe", "middle east", "the us", "us", "usa", "uk", "eu", "nato", "un", "red sea", "gulf",
    "трамп", "росія", "україна", "россия", "украина",
    "saudi", "yemeni", "lebanese", "israeli", "iranian", "russian", "ukrainian", "syrian", "iraqi", "palestinian",
    "french", "american", "sudanese", "venezuelan", "british", "european", "arab", "houthi", "zionist",
    "jordan", "egypt", "turkey", "qatar", "uae", "united states", "china", "india", "pakistan", "afghanistan",
    "south", "north", "east", "west", "southern", "northern", "eastern", "western", "central",
}
PEOPLES = {"saudi", "yemeni", "lebanese", "israeli", "iranian", "russian", "ukrainian", "syrian", "iraqi", "palestinian",
           "french", "american", "sudanese", "venezuelan", "british", "european", "arab", "houthi", "zionist",
           "southern", "northern", "eastern", "western", "central"}
AR_TRAIL = {"شمال", "جنوب", "شرق", "غرب", "وسط", "شمالي", "جنوبي", "شرقي", "غربي", "في", "قرب", "من", "على",
            "نحو", "بعد", "خلال", "منذ"}
PLACE_WORD_AR = re.compile(r"^(?:(?:بلدة|بلدتي|مدينة|قرية|مخيم|حي|منطقة)\s+)+")

# Countries a post names (English, French, Spanish, Arabic, Ukrainian,
# Russian), and capitals and regions that say the country on their own.
COUNTRY_WORDS: list[tuple[str, str]] = [
    ("lb", r"\bjabal[ _]?amel\b|\bsouth(?:ern)? lebanon\b|جبل عامل|\blebanon\b|\blebanese\b|\bliban\b|\bl[ií]bano\b|لبنان|اللبناني|ліван\w*|ливан\w*"),
    ("ps", r"\boccupied[ _]palestine\b|\bgaza\b|\bwest bank\b|\bcisjordanie\b|\bjenin\b|\bnablus\b|\btubas\b|\bhebron\b|\bramallah\b|\btulkarm\b|"
           r"غزة|الضفة|جنين|نابلس|طوباس|الخليل|رام الله|طولكرم|خان يونس|رفح|جباليا|بيت لاهيا|قلقيلية|سلفيت|أريحا|بيت لحم|القدس"),
    ("ye", r"\byemen\w*\b|\bsanaa\b|\bhodeidah\b|\bmarib\b|\bshabwa\w*\b|اليمن|اليمني\w*|صنعاء|الحديدة|مأرب|شبوة|تعز|عدن"),
    ("sa", r"\bsaudi\b|\briyadh\b|\bjeddah\b|\bdammam\b|السعودية|السعودي|الرياض|جدة|الدمام|جازان|نجران|أبها|ينبع"),
    ("sy", r"\bsyria\w*\b|\bdamascus\b|\baleppo\b|\bidlib\b|سوريا|السوري\w*|دمشق|حلب|إدلب|درعا|السويداء"),
    ("iq", r"\biraq\w*\b|\bbaghdad\b|\berbil\b|العراق|العراقي\w*|بغداد|أربيل|البصرة"),
    ("ir", r"\biran\w*\b|\btehran\b|إيران|الإيراني\w*|طهران|ایران|تهران"),
    ("il", r"\btel aviv\b|\bhaifa\b|\beilat\b|תל אביב|חיפה|אילת|تل أبيب|حيفا|إيلات"),
    ("ua", r"\bukrain\w*\b|\bkharkiv\b|\bkyiv\b|\bodesa\b|\bdnipro\b|\bzaporizh\w*|україн\w*|харків\w*|київ\w*|одес\w*|дніпр\w*|"
           r"запоріж\w*|\bобл\.|област\w*|район\b"),
    ("ru", r"\brussia\w*\b|\bmoscow\b|\bbelgorod\b|\bkursk\b|росі[їя]|россия|росси[ия]|москв\w*|бєлгород\w*|белгород\w*|курськ\w*|курск\w*"),
    ("sd", r"\bsudan\w*\b|\bkhartoum\b|\bel fasher\b|\bdarfur\b|السودان|الخرطوم|الفاشر|دارفور"),
    ("fr", r"\bfrance\b|\bparis\b|\blyon\b|\bmarseille\b|\bbordeaux\b|\bnantes\b|\btoulouse\b|\blille\b|\brennes\b"),
    ("ve", r"\bvenezuela\w*\b|\bcaracas\b|\bmaracaibo\b|\bvalencia, ve"),
    ("mm", r"\bmyanmar\b|\bburma\b|\byangon\b|\bmandalay\b|မြန်မာ"),
    ("cd", r"\brdc\b|\bdrc\b|\bcongo\b|\bgoma\b|\bkinshasa\b|\bbukavu\b"),
    ("ml", r"\bmali\b|\bbamako\b"), ("bf", r"\bburkina\b|\bouagadougou\b"), ("ne", r"\bniger\b|\bniamey\b"),
]
_COUNTRIES = [(cc, re.compile(p, re.I)) for cc, p in COUNTRY_WORDS]
COUNTRY_NAME = {"lb": "Lebanon", "ps": "Palestine", "ye": "Yemen", "sa": "Saudi Arabia", "sy": "Syria", "iq": "Iraq",
                "ir": "Iran", "il": "Israel", "ua": "Ukraine", "ru": "Russia", "sd": "Sudan", "fr": "France",
                "ve": "Venezuela", "mm": "Myanmar", "cd": "DR Congo", "ml": "Mali", "bf": "Burkina Faso", "ne": "Niger"}

UKRAINIAN_LETTERS = re.compile(r"[іїєґІЇЄҐ]")

LABEL = {"explosion": "Explosion", "strike": "Strike", "attack": "Attack", "clash": "Clashes",
         "interception": "Interception", "movement": "Military raid or incursion", "unrest": "Protest or police action",
         "infrastructure_damage": "Infrastructure damage"}


def fold(s: str | None) -> str:
    """Lowercase, Latin accents removed (Arabic and Cyrillic kept as written)."""
    out = []
    for c in (s or ""):
        d = unicodedata.normalize("NFKD", c)
        base = "".join(x for x in d if not unicodedata.combining(x))
        out.append(base if base and "LATIN" in unicodedata.name(c, "") else c)
    return "".join(out).lower()


def event_of(text: str | None) -> tuple[str | None, str | None]:
    """(event kind, the words that said so) or (None, None)."""
    t = fold(text)
    if not t.strip():
        return None, None
    for kind, rx in _EVENTS:
        m = rx.search(t)
        if m:
            if ALERT_ONLY.search(t) and not HARD_HIT.search(t) and kind in ("strike", "interception", "movement"):
                return None, None              # an air-raid warning, not a hit
            return kind, m.group(0)
    return None, None


def countries_of(text: str | None, chat_cc: str | None = None) -> list[str]:
    """Countries a post is about, in the order it names them, the chat's
    own country last. Ukrainian letters say Ukraine when nothing else does."""
    t = fold(text)
    hits = []
    for cc, rx in _COUNTRIES:
        m = rx.search(t)
        if m:
            hits.append((m.start(), cc))
    out = [cc for _, cc in sorted(hits)]
    if not out and UKRAINIAN_LETTERS.search(text or ""):
        out.append("ua")
    if chat_cc and chat_cc.lower() not in out:
        out.append(chat_cc.lower())
    return out


def places_of(text: str | None) -> list[str]:
    """Candidate place names, most specific pattern first, deduplicated."""
    t = text or ""
    out: list[str] = []
    for rx in PLACE_PATTERNS:
        for m in rx.finditer(t):
            name = m.group(1).strip(" '’-.,")
            if len(name) < 3 or name.lower() in NOT_PLACE or fold(name) in NOT_PLACE:
                continue
            name = PLACE_WORD_AR.sub("", name).strip()
            words = name.split()
            if len(words) > 1 and (words[-1] in AR_TRAIL or words[-1].startswith(("بم", "بل", "لل"))):
                name = words[0]                # "تلفيت جنوب" (south of), "كنارك بمحافظة" (in the province)
            if len(name) < 3 or fold(name) in NOT_PLACE or fold(name.split()[0]) in PEOPLES:
                continue                       # a country or a people is no pin ("in Lebanon", "the Saudi")
            if name not in out:
                out.append(name)
    return out[:4]


def read(text: str | None, chat_cc: str | None = None, role: str | None = None) -> dict:
    """The rule reading of one post. Pure. Always a dict:
      relevant, event_type, matched, places (candidates), countries,
      talk (a statement or threat, not a report), headline (English)."""
    kind, matched = event_of(text)
    if not kind:
        return {"relevant": False, "event_type": None, "matched": None, "places": [], "countries": [],
                "talk": False, "headline": None}
    talk = bool(TALK.search(fold(text)))
    places = places_of(text)
    ccs = countries_of(text, chat_cc)
    # the countries the TEXT names: the only ones a pin may be placed in. The
    # chat's own country (ccs, last) is context for the record, not evidence
    # of where the post's place is ("Châtelet" in a French channel is not Paris).
    in_text = countries_of(text, None)
    where = places[0] if places else (COUNTRY_NAME.get(ccs[0]) if ccs else None)
    headline = f"{LABEL.get(kind, kind)} reported{f' — {where}' if where else ''}"
    return {"relevant": not talk or role == "official", "event_type": kind, "matched": matched, "places": places,
            "countries": ccs, "countries_in_text": in_text, "talk": talk, "headline": headline}


def resolve(reading: dict, budget: list | None = None) -> tuple[dict | None, str | None, str | None, str | None]:
    """(geocoder hit, place as written, country, None) or (None, None, None,
    why). Tries each candidate in each country the post names, through
    telegram_ingest.locate (a settlement inside that country); `budget` is a
    one-item list of geocoder calls still allowed this pass."""
    import telegram_ingest
    if not reading.get("places"):
        return None, None, None, "no place named after a place word (read by rule)"
    countries = reading.get("countries_in_text") if "countries_in_text" in reading else reading.get("countries")
    if not countries:
        return None, None, None, "the post names no country for its place (the channel's country is not evidence) (read by rule)"
    for name in reading["places"]:
        for cc in countries[:2]:
            if budget is not None:
                if budget[0] <= 0:
                    return None, None, None, "geocoder budget spent this pass (read by rule)"
                budget[0] -= 1
            place = f"{name}, {COUNTRY_NAME.get(cc, cc.upper())}"
            hit, _why = telegram_ingest.locate(place, "town", cc)
            if hit and _settlement(hit):
                return hit, place, cc, None
    return None, None, None, f"'{reading['places'][0]}' did not resolve to a settlement (read by rule)"


def _settlement(hit: dict) -> bool:
    """A rule-read place must be a settlement or part of one: a province or
    a river of the same name would put the pin in the wrong place."""
    from geocode_utils import SETTLEMENT_TYPES
    cls, typ = hit.get("class"), hit.get("type")
    if cls is None and typ is None:
        return True                      # a geocoder answer without types (cache, tests): trust locate()
    return (cls == "place" and typ in SETTLEMENT_TYPES) or typ in SETTLEMENT_TYPES
