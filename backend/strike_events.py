"""
strike_events.py — "Saudi planes target Y in Yemen", "Houthis claim missile
attack on Riyadh", "coalition forces take control of Z" — as map events.

The owner (2026-10-12): strikes, bombings and control changes deserve their
own markers, persisting long enough to see an air campaign build up. This
module turns what the app already ingests into one normalised list of
ACTS OF FORCE, each with who did it, where it landed and who reported it.

SOURCES (read, never written — except the GDELT archive below):
  * GeoConfirmed placemarks (human-geolocated; precise points; category
    conflict/air/equipment/maritime/uncategorised);
  * Telegram posts the classifier marked attack/strike/interception/
    explosion/clash/seizure (pinned by the post's own place + precision);
  * GDELT kinetic codings as JUDGED by gdelt_judge (the cheap model already
    read each article and pinned it where it happened, not where the coder
    put it — "Riyadh airport struck" was coded at Sanaa). No new model call
    is made here: unjudged stories are simply not drawn yet;
  * alerts with a location from sources that are not tracks (news-derived,
    corroborations, …) — on the MAP news is fine;
  * UCDP candidate events (state-based violence → ground fighting).

RULES FIRST. The act and the actor are read from the text by rules; the
source's own fields (Telegram event_type, the judge's act, the CAMEO code,
the GeoConfirmed faction, the GDELT actor country) are used only when the
text says nothing. Model → words, code → decisions (reference memo).

PRECISION. A point is only as good as its geocoding: "precise" (a site, a
village, a GeoConfirmed area grid), "city", or "region" (an oblast, a
governorate, a GeoConfirmed point-of-view camera position) which the map
draws hollow. A point that is only a COUNTRY (Telegram precision country /
none, GDELT geo type 1, or a point sitting on a country's centroid) is
dropped: a bomb icon in the middle of Saudi Arabia is not a target.

MERGE. Reports of the same act at the same place within 24 h are one event
with several sources: event_cluster.cluster() run per act over a merge text
of act + place + actor, 15 km apart at most (3 km when both are precise —
a front line has dozens of separate strikes a day).

PERSISTENCE. An event stays on the map for WINDOW_DAYS by act (strikes 14
days, control changes 30) and fades with age (`age_days` / `window_days`).
GDELT keeps only ~2 days in its rolling cache, so judged GDELT points that
classify as an act are archived in the `strike_gdelt_archive` table (raw
inputs only — the classification is re-derived on every read, so a rule fix
reaches old events too).

CAMPAIGNS. Consecutive events by the same known actor in the same country
(gaps of at most CAMPAIGN_GAP_DAYS) with at least CAMPAIGN_MIN events are a
campaign: count, first/last date, acts, bbox, event ids.

PUBLIC API (also used by the frontline / trajectory work):

    events(since, bbox=None, acts=None, actors=None) -> list[dict]
        since: datetime | ISO string | hours-ago number. bbox: (w, s, e, n).
        acts:  iterable of ACTS. actors: iterable of canonical actor names.
        Each dict:
          id           stable id ("stk-<hash>")
          act          one of ACTS
          act_label    "Airstrike / bombing", …
          weapon_stated False when the text said only "strike"/"attack"
          actor        canonical actor ("Saudi-led coalition", "Houthis",
                       "Russia", …) or None
          actor_side   the bloc the actor fights in ("Saudi-led coalition"
                       for Saudi Arabia, the UAE and Yemeni government
                       forces), or None
          actor_home   where that actor launches from by default ("Yemen"
                       for the Houthis) — a default, not a statement
          target_name  the place hit / taken, as the source names it
          lat, lon     the target point
          precision    "precise" | "city" | "region"
          country      country of the target point (Natural Earth name)
          time         ISO UTC of the earliest report
          last_time    ISO UTC of the latest report
          title        headline of the most informative report
          sources      [{source, title, url, time}] (all merged reports)
          casualties   {"killed": n, "injured": n} or None
          unit_type    "airborne" | "armoured" | "air force" | "naval" |
                       "drones" | "infantry" | "marines" | "artillery" |
                       None — only when the text names a unit
          origin_hint  drone/missile acts: the STATED launch area ("from
                       Yemen", "launched from Kursk Oblast"), else None
          window_days, age_days   persistence window and current age
          campaign_id  set by campaigns() when the event belongs to one

    campaigns(since=None, …) -> list[dict]

Pure helpers (classify_act, find_actor, normalise_actor, unit_type,
origin_hint, casualties, merge, build_campaigns) are tested without a DB
in test_strike_events.py.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone

import event_cluster

# ── acts ─────────────────────────────────────────────────────────────────────
ACTS = ("airstrike", "missile", "drone", "shelling", "naval", "assault", "control", "interception")
ACT_LABEL = {
    "airstrike": "Airstrike / bombing", "missile": "Missile strike", "drone": "Drone strike",
    "shelling": "Shelling / artillery", "naval": "Naval strike", "assault": "Ground assault",
    "control": "Territory taken", "interception": "Interception",
}
# How long an event stays on the map. Overridable per act:
# STRIKE_WINDOW_DAYS_CONTROL=45 etc.
_DEFAULT_WINDOW = {a: 14 for a in ACTS} | {"control": 30}
WINDOW_DAYS = {a: int(os.getenv(f"STRIKE_WINDOW_DAYS_{a.upper()}", d)) for a, d in _DEFAULT_WINDOW.items()}
MAX_WINDOW_DAYS = max(WINDOW_DAYS.values())

CAMPAIGN_GAP_DAYS = 3.0
CAMPAIGN_MIN = 3
CACHE_TTL_S = 180

_I = re.IGNORECASE
_INTERCEPT = re.compile(r"intercept|shot down|shoots? down|downed|air defen[cs]es? (?:destroy|repel|down|engag|activ)"
                        r"|repell?ed (?:a |an |the )?(?:drone|missile|attack)", _I)
_SHIP = re.compile(r"\b(?:ships?|vessels?|tankers?|warships?|frigates?|destroyers?|corvettes?|carriers?|bulk carrier"
                   r"|merchant|boats?|usvs?|sea drones?|naval drones?|anti-ship|mt|mv|submarine)\b", _I)
_NAVAL_ACT = re.compile(r"attack|strike|struck|hit|target|missile|drone|torpedo|seiz|board|hijack|sank|sunk|sink"
                        r"|fire|explosion|blast", _I)
_CONTROL = re.compile(
    r"(?:take|takes|took|taken|seiz\w*|gain\w*|establish\w*|assum\w*|wrest\w*|regain\w*) (?:full |complete |total )?control"
    r"|liberat\w*|recaptur\w*|\bretak\w*|\bretook\b|(?:fell|falls|fallen) to\b|withdr\w* from"
    r"|(?:enter|entered|enters|storm\w*) (?:the )?(?:city|town|village|settlement)"
    r"|rais\w* (?:the |their |a )?flag|advanc\w* into"
    r"|captur\w* (?:the )?(?:city|town|village|settlement|district|airport|base|hill)"
    r"|occup(?:y|ied|ies) (?:the )?(?:city|town|village)", _I)
_CONTROL_NAMED = re.compile(r"\b(?:captur(?:e|es|ed|ing)|takes?|took|seiz(?:e|es|ed)) (?:the )?[A-Z][a-z]")
_MISSILE = re.compile(r"missile|ballistic|\bcruise\b|iskander|kinzhal|kalibr|\bkh-\d+|storm shadow|\bscalp\b|atacms"
                      r"|tomahawk|neptune|zircon|oreshnik|(?<!multiple )\brockets?\b(?! artillery)", _I)
_DRONE = re.compile(r"drone|\buavs?\b|shahed|geran|\bfpv\b|loitering munition|kamikaze|lancet|unmanned", _I)
_AIR = re.compile(r"air ?strikes?|air raids?|warplanes?|war planes?|fighter jets?|\bjets?\b|bomb(?:s|ed|ing|ings|ardment|ers?)?\b"
                  r"|glide bombs?|\bkabs?\b|\bfab-?\d|aerial (?:bombardment|attack|strike)|planes? (?:target|strike|struck|hit|bomb)"
                  r"|helicopter gunship|\bsu-\d+|\bf-1[56]\b|\bf-35\b|air force (?:struck|strike|hit|target)", _I)
_SHELL = re.compile(r"\bshell(?:s|ed|ing)?\b|artillery|mortars?\b|howitzers?|\bmlrs\b|\bgrad\b|multiple rocket|tank fire"
                    r"|rocket artillery", _I)
_ASSAULT = re.compile(r"assault|offensive|ground (?:attack|operation|incursion)|\bstorm(?:ed|s|ing)\b|clash(?:es|ed)?\b"
                      r"|\braid(?:s|ed)?\b|incursion|\bbattles?\b|fighting|ambush|firefight|gunfight"
                      r"|attack(?:ed|s)? (?:on |against )?(?:\w+ )?(?:positions?|troops|soldiers|forces|infantry)", _I)
_GENERIC = re.compile(r"\bstrikes?\b|\bstruck\b|\battack(?:s|ed)?\b|\bhits?\b|\btarget(?:s|ed|ing)?\b|explosions?|blasts?", _I)
# A statement about force is not force: a warning, a threat, a plan, a drill.
_STATEMENT = re.compile(r"\b(?:warns?|threat(?:en)?s?|vows?|condemn\w*|denies|deny|plans?|could|would|might|calls? for"
                        r"|urges?|anniversary|exercises?|drills?|training|ready to|prepar\w*|retaliation against"
                        r"|will (?:strike|attack|respond)|funerals?|condolences?|attends?|visits?|war crimes?|accus\w*|blames?"
                        r"|satellite images?)\b", _I)
_HURT = re.compile(r"kill|dead|death|injur|wound|casualt|destroy|damag", _I)

# Source-field hints, used only when the text names no act.
_HINT = {
    # telegram event_type / gdelt_judge act
    "interception": "interception", "clash": "assault", "seizure": "control",
    # CAMEO
    "195": "airstrike", "1951": "airstrike", "1952": "airstrike", "194": "shelling", "193": "assault",
}
_GENERIC_HINT = {"strike", "attack", "explosion", "190", "infrastructure_damage"}


def classify_act(text: str, hint: str | None = None) -> tuple[str | None, bool]:
    """(act, weapon_stated) for a headline, or (None, False).

    Order matters: an interception mentions a missile, a strike on a ship a
    missile or a drone, a captured town an assault — the most specific act
    the text supports wins."""
    t = str(text or "")
    if not t.strip():
        return None, False
    if _STATEMENT.search(t) and not _HURT.search(t):
        return None, False
    if _INTERCEPT.search(t):
        return "interception", True
    if _SHIP.search(t) and _NAVAL_ACT.search(t):
        return "naval", True
    if _CONTROL.search(t) or _CONTROL_NAMED.search(t):
        return "control", True
    for act, rx in (("missile", _MISSILE), ("drone", _DRONE), ("airstrike", _AIR), ("shelling", _SHELL),
                    ("assault", _ASSAULT)):
        if rx.search(t):
            return act, True
    h = str(hint or "").strip().lower()
    if h in _HINT:
        return _HINT[h], h not in ("193",)
    if _GENERIC.search(t) or h in _GENERIC_HINT:
        # "A Russian strike hit the polyclinic": a strike, weapon unstated.
        # Drawn as a strike (the bomb), its card says the weapon is unstated.
        return "airstrike", False
    return None, False


# ── actors ───────────────────────────────────────────────────────────────────
# (pattern, canonical, side/bloc, home). Case-insensitive unless the
# pattern carries (?-i:) for the two-letter abbreviations.
_COALITION = "Saudi-led coalition"
_ACTORS = [
    (r"saudi(?:-led)?(?: arabia)?|\bksa\b|arab coalition|coalition (?:forces|jets|warplanes|aircraft|air ?strikes?|planes)",
     _COALITION, _COALITION, "Saudi Arabia"),
    (r"emirati|\buae\b|united arab emirates", "UAE", _COALITION, "UAE"),
    (r"yemeni (?:government|army|govt)|government forces in yemen|presidential leadership council|southern transitional"
     r"|\bstc\b|giants brigades|regular army", "Yemeni government forces", _COALITION, "Yemen"),
    (r"houthis?|ansar ?allah|ansarullah|sanaa(?:-based)? (?:forces|authorities)|yemeni armed forces",
     "Houthis", "Houthis", "Yemen"),
    (r"israel(?:i)?s?|\bidf\b|(?-i:IAF)", "Israel", "Israel", "Israel"),
    (r"hezbollah", "Hezbollah", "Hezbollah", "Southern Lebanon"),
    (r"hamas|al-qassam|qassam brigades", "Hamas", "Hamas", "Gaza"),
    (r"islamic jihad|al-quds brigades|saraya al-quds", "Palestinian Islamic Jihad", "Hamas", "Gaza"),
    (r"iran(?:ian)?s?\b|\birgc\b|revolutionary guards?", "Iran", "Iran", "Iran"),
    (r"(?-i:U\.S\.|US)(?= |-|$)|\bamerican\b|united states|centcom|pentagon", "United States", "United States", "United States"),
    (r"\bbritish\b|royal navy|\braf\b|(?-i:UK)(?= )", "United Kingdom", "United States", "United Kingdom"),
    (r"russian?s?\b|\bkremlin\b|(?-i:RU)\b|russian federation|africa corps|wagner", "Russia", "Russia", "Russia"),
    (r"ukrain(?:e|ian)s?|(?-i:UA)\b|\bafu\b|\bzsu\b|\bsbu\b|\bgur\b", "Ukraine", "Ukraine", "Ukraine"),
    (r"rapid support forces|\brsf\b", "RSF", "RSF", "Sudan"),
    (r"sudanese (?:army|armed forces|air force)|\bsaf\b", "Sudanese Armed Forces", "Sudanese Armed Forces", "Sudan"),
    (r"islamic state|\bisis\b|\bisil\b|daesh|iswap", "Islamic State", "Islamic State", None),
    (r"al-shabaab|al shabaab|shabaab", "al-Shabaab", "al-Shabaab", "Somalia"),
    (r"\bjnim\b", "JNIM", "JNIM", "Sahel"),
    (r"turkish|turkey|türkiye", "Turkey", "Turkey", "Turkey"),
    (r"pakistani?|\bpaf\b", "Pakistan", "Pakistan", "Pakistan"),
    (r"\bindian?\b(?! ocean)", "India", "India", "India"),
    (r"myanmar (?:army|military|junta)|tatmadaw|\bjunta\b", "Myanmar military", "Myanmar military", "Myanmar"),
    (r"\bm23\b", "M23", "M23", "DR Congo"),
    (r"syrian (?:army|government|forces)", "Syrian government", "Syrian government", "Syria"),
]
_ACTOR_RX = [(re.compile(p, _I), c, s, h) for p, c, s, h in _ACTORS]
ACTOR_SIDE = {c: s for _, c, s, _ in _ACTORS}
ACTOR_HOME = {c: h for _, c, _, h in _ACTORS}
_COALITION_CONTEXT = re.compile(r"yemen|houthi|saudi|sanaa|sana'a|hodeidah|marib|saada", _I)
_BARE_COALITION = re.compile(r"\bcoalition\b", _I)
_PASSIVE = re.compile(r"\b(?:by|from)\s+(?:the\s+|a\s+|an\s+)?(?:\w+[- ])?$", _I)
_TARGET_PREP = re.compile(r"\b(?:on|against|at|in|into|targeting|targets|over|toward|towards|of|near|across)\s+(?:the\s+|a\s+)?$", _I)
_AGENT_NEXT = re.compile(r"^[\s-]*(?:-led\s+)?(?:\w+\s+){0,2}?(?:air ?strikes?|strikes?|struck|attacks?|attacked|missiles?|drones?|forces"
                         r"|jets?|warplanes?|planes?|troops|army|military|navy|shelling|artillery|bombard\w*|shell\w*"
                         r"|launch\w*|fired?|hit|target\w*|captur\w*|tak\w*|seiz\w*|raid\w*|assault\w*|aviation|air force"
                         r"|units?|brigade|battalion|regiment|fighters|militants|claim\w*|intercept\w*|shot)\b", _I)


def normalise_actor(name: str | None) -> str | None:
    """'KSA', 'Saudi Arabia', 'the Saudi-led coalition' → 'Saudi-led coalition';
    'Ansar Allah' → 'Houthis'; a faction label GeoConfirmed uses for a side."""
    s = str(name or "").strip()
    if not s or s.lower() in ("neutral", "unknown", "other", "civil", "civilian"):
        return None
    for rx, canon, _, _ in _ACTOR_RX:
        if rx.search(s):
            return canon
    if _BARE_COALITION.search(s):
        return _COALITION
    return None


_REPORTER = re.compile(r"^(.*?)\b(?:says?|said|claims?|claimed|reports?|reported|accuses?|accused|announces?|announced"
                       r"|confirms?|confirmed)\b(?:\s+that)?\s+(.*)$", _I)
_SELF = re.compile(r"^(?:they|it|its|their|we|our)\b", _I)


def find_actor(text: str, strict: bool = False) -> str | None:
    """See _find_actor. A reporting clause is peeled first: in "Houthi
    forces claim Saudi airstrikes killed six" the Houthis report, the
    Saudis strike; in "Houthi forces say they struck…" the reporter is the
    agent."""
    t = str(text or "")
    m = _REPORTER.match(t)
    if m and not _SELF.match(m.group(2)):
        inner = _find_actor(m.group(2), strict)
        if inner:
            return inner
    return _find_actor(t, strict)


def _find_actor(text: str, strict: bool = False) -> str | None:
    """The actor who DID the act, from a headline.

    "X killed in Houthi missile attack" — the adjective before the act;
    "targeted by drones from Yemeni government forces" — the passive agent;
    "Houthis claim missile attack on Saudi airports" — the subject, not the
    place after "on". First of: a passive agent, an actor immediately
    followed by an act/force word, the first actor not after a target
    preposition."""
    t = str(text or "")
    hits = []
    for rx, canon, _, _ in _ACTOR_RX:
        for m in rx.finditer(t):
            hits.append((m.start(), m.end(), canon))
    if _BARE_COALITION.search(t) and _COALITION_CONTEXT.search(t):
        for m in _BARE_COALITION.finditer(t):
            hits.append((m.start(), m.end(), _COALITION))
    if not hits:
        return None
    hits.sort()
    passive = [c for s, e, c in hits if _PASSIVE.search(t[max(0, s - 30):s])]
    if passive:
        return passive[0]
    agent = [c for s, e, c in hits if _AGENT_NEXT.match(t[e:e + 40])]
    if agent:
        return agent[0]
    if strict:
        return None
    free = [c for s, e, c in hits if not _TARGET_PREP.search(t[max(0, s - 20):s])]
    return free[0] if free else None


# GDELT actor country codes (CAMEO alpha-3) for the fallback.
_CAMEO_ACTOR = {"SAU": _COALITION, "ARE": "UAE", "ISR": "Israel", "RUS": "Russia", "UKR": "Ukraine",
                "IRN": "Iran", "USA": "United States", "GBR": "United Kingdom", "TUR": "Turkey", "PAK": "Pakistan",
                "IND": "India"}

# ── unit, origin, casualties ────────────────────────────────────────────────
_UNIT_NOUN = r"(?:brigades?|regiments?|battalions?|divisions?|corps|compan(?:y|ies)|units?|troops|forces|fleet|squadrons?|operators)"
_UNITS = [
    ("marines", re.compile(r"marines?\b|naval infantry", _I)),
    ("airborne", re.compile(r"airborne|paratroop\w*|air assault|\bvdv\b|air-?mobile", _I)),
    ("armoured", re.compile(rf"armou?red|tank {_UNIT_NOUN}|mechani[sz]ed|tank (?:crew|column)s?", _I)),
    ("artillery", re.compile(rf"artillery {_UNIT_NOUN}|(?:rocket|missile) artillery|artillery(?:men| crews?)|\bmlrs {_UNIT_NOUN}", _I)),
    ("drones", re.compile(rf"unmanned systems|drone {_UNIT_NOUN}|uav {_UNIT_NOUN}|drone operators|fpv {_UNIT_NOUN}", _I)),
    ("air force", re.compile(r"air force|aerospace forces|\bvks\b|aviation (?:regiment|brigade|squadron)|bomber (?:regiment|squadron)", _I)),
    ("naval", re.compile(r"\bnavy\b|naval (?:forces|units?)|black sea fleet|\bfleet\b", _I)),
    ("infantry", re.compile(rf"infantry|motori[sz]ed rifle|rifle {_UNIT_NOUN}|assault {_UNIT_NOUN}|territorial defen[cs]e|ground forces", _I)),
]


def unit_type(text: str) -> str | None:
    """The kind of unit the text NAMES ("65th Mechanized Brigade" →
    armoured), or None. Not inferred from the act: an airstrike does not
    name an air force unit."""
    t = str(text or "")
    for kind, rx in _UNITS:
        if rx.search(t):
            return kind
    return None


_ORIGIN = re.compile(
    r"\b(?:launched|fired|flying|flew|coming|came|arriving|incoming)?\s*from\s+(?:the\s+)?"
    r"((?:[A-Z][\w'’-]+)(?:[ -](?:[A-Z][\w'’-]+|of|al|el))*(?:\s+(?:region|oblast|governorate|province|direction|area|coast|sea))?)")
_ORIGIN_SKIP = {"Telegram", "Reuters", "AP", "AFP", "The", "Sources", "Officials", "Monday", "Tuesday", "Wednesday",
                "Thursday", "Friday", "Saturday", "Sunday"}


def origin_hint(text: str, act: str | None) -> str | None:
    """For drones and missiles: where the text says they came from
    ("drones launched from Kursk Oblast" → "Kursk Oblast"), else None."""
    if act not in ("drone", "missile"):
        return None
    for m in _ORIGIN.finditer(str(text or "")):
        place = m.group(1).strip()
        if place.split()[0] in _ORIGIN_SKIP:
            continue
        # the actor named as an agent is not a place: "from Yemeni government forces"
        if re.search(r"\b(?:forces|army|government|brigades?|regiment)\b", place, _I):
            continue
        return place
    return None


_NUMWORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
             "ten": 10, "eleven": 11, "twelve": 12, "a dozen": 12, "dozens": 24, "scores": 40, "hundreds": 200}
_NUM = r"(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a dozen|dozens|scores|hundreds)"
_KILLED = [re.compile(rf"{_NUM}\s+(?:\w+\s+){{0,2}}(?:killed|dead|died)", _I),
           re.compile(rf"(?:kills?|killing|killed)\s+(?:at least\s+)?{_NUM}", _I)]
_INJURED = [re.compile(rf"{_NUM}\s+(?:\w+\s+){{0,2}}(?:injured|wounded|hurt)", _I),
            re.compile(rf"(?:injur(?:es|ing)|wound(?:s|ing))\s+(?:at least\s+)?{_NUM}", _I)]


def _n(s: str) -> int:
    s = s.lower()
    return int(s) if s.isdigit() else _NUMWORDS.get(s, 0)


def casualties(text: str) -> dict | None:
    t = str(text or "")
    k = max((_n(m.group(1)) for rx in _KILLED for m in rx.finditer(t)), default=0)
    i = max((_n(m.group(1)) for rx in _INJURED for m in rx.finditer(t)), default=0)
    if not k and re.search(r"\b(?:woman|man|child|person|civilian|soldier)\b (?:\w+ )?killed|one dead", t, _I):
        k = 1
    return {"killed": k, "injured": i} if (k or i) else None


# ── precision and places ────────────────────────────────────────────────────
_PRECISE = {"site", "street", "village", "neighborhood", "neighbourhood", "airport", "port", "bridge", "base", "camp",
            "checkpoint", "junction", "hospital", "settlement", "field", "crossing", "border crossing", "building",
            "facility", "refugee camp", "island", "mountain", "valley", "strait"}
_CITY = {"city", "town", "district", "area", "county"}
_REGION = {"region", "province", "governorate", "oblast", "state", "border", "other", "adm1"}
_DROP = {"country", "none", "", "unknown"}


def precision_from(label: str | None) -> str | None:
    """A source's place-precision label → precise / city / region, or None
    (only a country: not drawn)."""
    p = str(label or "").strip().lower()
    if p in _DROP:
        return None
    if p in _PRECISE:
        return "precise"
    if p in _CITY:
        return "city"
    return "region"


_CENTROIDS: list | None = None
_CENTROID_LOCK = threading.Lock()


def _centroids() -> list:
    global _CENTROIDS
    with _CENTROID_LOCK:
        if _CENTROIDS is None:
            out = []
            try:
                import geo_land
                _, geoms, _ = geo_land._index()
                for g in geoms or []:
                    parts = list(getattr(g, "geoms", [g]))
                    big = max(parts, key=lambda q: q.area)
                    for c in (g.centroid, big.centroid, g.representative_point()):
                        out.append((c.y, c.x))
            except Exception:                                  # noqa: BLE001
                out = []
            _CENTROIDS = out
    return _CENTROIDS


def is_country_centroid(lat, lon, km: float = 12.0) -> bool:
    """A point within `km` of a country's centroid: a geocoder that only
    knew the country. Not a target."""
    try:
        la, lo = float(lat), float(lon)
    except (TypeError, ValueError):
        return True
    for cla, clo in _centroids():
        if abs(cla - la) < 0.3 and abs(clo - lo) < 0.4 and event_cluster._km((la, lo), (cla, clo)) <= km:
            return True
    return False


def _country(lat, lon) -> str | None:
    try:
        import geo_land
        return geo_land.country_at(lat, lon)
    except Exception:                                          # noqa: BLE001
        return None


# ── time helpers ─────────────────────────────────────────────────────────────
def _iso(v) -> str | None:
    ts = float(v) if isinstance(v, (int, float)) else event_cluster._ts(v)
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if ts is not None else None


def _since_dt(since) -> datetime:
    now = datetime.now(timezone.utc)
    if since is None:
        return now - timedelta(days=MAX_WINDOW_DAYS)
    if isinstance(since, (int, float)):
        return now - timedelta(hours=float(since))
    if isinstance(since, datetime):
        return since if since.tzinfo else since.replace(tzinfo=timezone.utc)
    s = str(since).strip()
    m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*([hd])", s)
    if m:
        n = float(m.group(1))
        return now - (timedelta(hours=n) if m.group(2) == "h" else timedelta(days=n))
    ts = event_cluster._ts(s)
    return datetime.fromtimestamp(ts, timezone.utc) if ts is not None else now - timedelta(days=MAX_WINDOW_DAYS)


# ── normalise one report ────────────────────────────────────────────────────
def to_report(raw: dict) -> dict | None:
    """A raw source row (see _collect_*) → a classified single report, or
    None when it is not an act of force or cannot be placed."""
    title = str(raw.get("title") or "").strip()
    text = " ".join(x for x in (title, str(raw.get("text") or "")) if x)
    act, stated = classify_act(title, raw.get("hint"))
    if act is None and raw.get("text"):
        act, stated = classify_act(text, raw.get("hint"))
    if act is None:
        return None
    try:
        lat, lon = float(raw["lat"]), float(raw["lon"])
    except (KeyError, TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0):
        return None
    prec = raw.get("precision")
    if prec is None:
        return None
    if prec != "precise" and is_country_centroid(lat, lon):
        return None
    ts = event_cluster._ts(raw.get("time"))
    if ts is None:
        return None
    # the summary only names the agent outright ("by", "Saudi jets"): its
    # first actor is as often the government reporting it
    actor = find_actor(title) or find_actor(raw.get("text") or "", strict=True)
    actor_from = "text" if actor else None
    if not actor:
        actor = normalise_actor(raw.get("actor_field"))
        actor_from = "source" if actor else None
    cas = casualties(text) or raw.get("casualties")
    return {
        "rid": raw["rid"], "source": raw["source"], "title": title, "url": raw.get("url"),
        "act": act, "weapon_stated": stated, "actor": actor, "actor_from": actor_from,
        "target_name": raw.get("place") or "", "lat": lat, "lon": lon, "precision": prec,
        "ts": ts, "casualties": cas, "unit_type": unit_type(text), "origin_hint": origin_hint(text, act),
        "country": raw.get("country"),
    }


_PREC_RANK = {"precise": 3, "city": 2, "region": 1}


def _merge_text(r: dict) -> str:
    place = (r.get("target_name") or "").split(",")[0]
    return f"Attack {place.title()} {r.get('actor') or ''}".strip()


def merge(reports: list[dict], now: float | None = None) -> list[dict]:
    """Same act + same place within 24 h → one event (event_cluster per act)."""
    now = now or time.time()
    by_act: dict[str, list[dict]] = {}
    for r in reports:
        by_act.setdefault(r["act"], []).append(r)
    out = []
    for act, rs in by_act.items():
        items = [{"id": r["rid"], "at": r["ts"] and datetime.fromtimestamp(r["ts"], timezone.utc).isoformat(),
                  "headline": _merge_text(r), "lat": r["lat"], "lon": r["lon"],
                  "precise": r["precision"] == "precise", "place": (r.get("target_name") or "").split(",")[0],
                  "source": r["source"], "_r": r} for r in rs]
        clusters = event_cluster.cluster(items, at="at", text=("headline",), window_h=24.0,
                                         radius_km=15.0, precise_km=3.0, key="id")
        by_id = {i["id"]: i["_r"] for i in items}
        for c in clusters:
            members = [c["_r"]] + [by_id[a["id"]] for a in (c.get("also") or []) if a.get("id") in by_id]
            out.append(_event_from(act, members, now))
    out.sort(key=lambda e: e["time"], reverse=True)
    return out


def _event_from(act: str, members: list[dict], now: float) -> dict:
    # the point: the most precise report; the words: the longest title
    best = max(members, key=lambda r: (_PREC_RANK.get(r["precision"], 0), r["source"] == "GeoConfirmed"))
    head = max(members, key=lambda r: (bool(r["actor"]), r["weapon_stated"], len(r["title"])))
    actors = [r["actor"] for r in members if r["actor"] and r["actor_from"] == "text"] or \
             [r["actor"] for r in members if r["actor"]]
    actor = max(set(actors), key=actors.count) if actors else None
    t0 = min(r["ts"] for r in members)
    t1 = max(r["ts"] for r in members)
    killed = max(((r["casualties"] or {}).get("killed") or 0) for r in members)
    injured = max(((r["casualties"] or {}).get("injured") or 0) for r in members)
    window = WINDOW_DAYS.get(act, 14)
    ids = sorted(r["rid"] for r in members)
    srcs = sorted(members, key=lambda r: r["ts"])
    return {
        "id": "stk-" + hashlib.sha1(ids[0].encode()).hexdigest()[:12],
        "act": act, "act_label": ACT_LABEL[act],
        "weapon_stated": any(r["weapon_stated"] for r in members),
        "actor": actor, "actor_side": ACTOR_SIDE.get(actor), "actor_home": ACTOR_HOME.get(actor),
        "target_name": best["target_name"], "lat": best["lat"], "lon": best["lon"],
        "precision": best["precision"], "country": best.get("country"),
        "time": _iso(t0), "last_time": _iso(t1), "title": head["title"],
        "sources": [{"source": r["source"], "title": r["title"], "url": r["url"], "time": _iso(r["ts"])} for r in srcs][:12],
        "source_count": len(members),
        "casualties": {"killed": killed, "injured": injured} if (killed or injured) else None,
        "unit_type": next((r["unit_type"] for r in members if r["unit_type"]), None),
        "origin_hint": next((r["origin_hint"] for r in members if r["origin_hint"]), None),
        "window_days": window, "age_days": round(max(0.0, (now - t0) / 86400.0), 2),
        "campaign_id": None,
    }


def build_campaigns(evts: list[dict]) -> list[dict]:
    """Same known actor, same target country, gaps ≤ CAMPAIGN_GAP_DAYS,
    at least CAMPAIGN_MIN events. Interceptions are a defence, not part of
    the attacker's campaign. Sets campaign_id on member events."""
    groups: dict[tuple, list[dict]] = {}
    for e in evts:
        if e["act"] == "interception" or not e.get("actor") or not e.get("country"):
            continue
        groups.setdefault((e["actor"], e["country"]), []).append(e)
    out = []
    for (actor, country), es in groups.items():
        es.sort(key=lambda e: e["time"])
        run: list[dict] = []
        runs = []
        for e in es:
            if run and (event_cluster._ts(e["time"]) - event_cluster._ts(run[-1]["time"])) > CAMPAIGN_GAP_DAYS * 86400:
                runs.append(run)
                run = []
            run.append(e)
        if run:
            runs.append(run)
        for r in runs:
            if len(r) < CAMPAIGN_MIN:
                continue
            cid = "cmp-" + hashlib.sha1(f"{actor}|{country}|{r[0]['id']}".encode()).hexdigest()[:10]
            acts: dict[str, int] = {}
            for e in r:
                acts[e["act"]] = acts.get(e["act"], 0) + 1
                e["campaign_id"] = cid
            lats, lons = [e["lat"] for e in r], [e["lon"] for e in r]
            out.append({
                "id": cid, "actor": actor, "actor_side": ACTOR_SIDE.get(actor), "country": country,
                "title": f"{actor} in {country}", "count": len(r), "first": r[0]["time"], "last": r[-1]["time"],
                "acts": acts, "bbox": [min(lons), min(lats), max(lons), max(lats)],
                "center": [sum(lats) / len(lats), sum(lons) / len(lons)],
                "killed": sum(((e.get("casualties") or {}).get("killed") or 0) for e in r),
                "event_ids": [e["id"] for e in r],
            })
    out.sort(key=lambda c: (-c["count"], c["last"]))
    return out


# ── collection (sync; called in a worker thread) ────────────────────────────
def _db_path() -> str:
    from paths import DB_PATH
    return str(DB_PATH)


def _con(readonly: bool = True) -> sqlite3.Connection:
    p = _db_path()
    con = sqlite3.connect(f"file:{p}?mode=ro" if readonly else p, uri=readonly, timeout=10)
    con.row_factory = sqlite3.Row
    return con


def _first_url(s) -> str | None:
    m = re.search(r"https?://\S+", str(s or ""))
    return m.group(0).rstrip(").,;]") if m else None


def _collect_geoconfirmed(con, since: datetime) -> list[dict]:
    out = []
    rows = con.execute(
        "SELECT id, theatre_slug, title, description, date, latitude, longitude, faction, original_source, "
        "geolocation_source, category FROM geoconfirmed_placemarks WHERE status='active' AND date >= ? "
        "AND (category IS NULL OR category IN ('conflict','air','equipment','maritime','infrastructure'))",
        (since.strftime("%Y-%m-%d %H:%M:%S"),)).fetchall()
    for r in rows:
        title = (r["title"] or "").split(" — ")[0]
        place = (r["title"] or "").split(" — ")[-1] if " — " in (r["title"] or "") else ""
        desc = r["description"] or ""
        # a point-of-view placemark is where the CAMERA stood, not the target
        pov = bool(re.match(r"\s*(?:[\d:&\-/ ]+)?point of view", desc or title, _I))
        out.append({"rid": f"gc:{r['id']}", "source": "GeoConfirmed", "title": title, "text": desc[:400],
                    "lat": r["latitude"], "lon": r["longitude"], "time": r["date"], "place": place,
                    "precision": "region" if pov else "precise", "actor_field": r["faction"],
                    "url": _first_url(r["original_source"]) or _first_url(r["geolocation_source"])
                    or f"https://geoconfirmed.org/{r['theatre_slug']}/{r['id']}"})
    return out


_TG_TYPES = ("attack", "strike", "interception", "explosion", "clash", "seizure", "infrastructure_damage", "maritime")


def _collect_telegram(con, since: datetime) -> list[dict]:
    out = []
    q = ("SELECT channel, msg_id, channel_title, posted_at, headline, summary_en, event_type, place, precision, "
         "lat, lon FROM telegram_posts WHERE posted_at >= ? AND lat IS NOT NULL AND event_type IN (%s)"
         % ",".join("?" * len(_TG_TYPES)))
    for r in con.execute(q, (since.strftime("%Y-%m-%dT%H:%M:%S"), *_TG_TYPES)).fetchall():
        out.append({"rid": f"tg:{r['channel']}:{r['msg_id']}", "source": f"Telegram · {r['channel_title'] or r['channel']}",
                    "title": r["headline"] or "", "text": (r["summary_en"] or "")[:400], "lat": r["lat"], "lon": r["lon"],
                    "time": r["posted_at"], "place": r["place"] or "", "precision": precision_from(r["precision"]),
                    "hint": r["event_type"], "url": f"https://t.me/{r['channel']}/{r['msg_id']}"})
    return out


_ALERT_SKIP = ("gps", "ais", "AIS", "adsb", "ADSB", "geoconfirmed", "public-calls", "forecast", "surge", "SAT-TASK", "FIRMS")


def _collect_alerts(con, since: datetime) -> list[dict]:
    out = []
    q = ("SELECT alert_id, source, alert_type, title, lat, lon, region, created_at FROM alerts WHERE created_at >= ? "
         "AND lat IS NOT NULL AND source NOT IN (%s)" % ",".join("?" * len(_ALERT_SKIP)))
    for r in con.execute(q, (since.strftime("%Y-%m-%d %H:%M:%S"), *_ALERT_SKIP)).fetchall():
        out.append({"rid": f"al:{r['alert_id']}", "source": f"Alert · {r['source']}", "title": r["title"] or "",
                    "lat": r["lat"], "lon": r["lon"], "time": r["created_at"], "place": r["region"] or "",
                    "precision": "city", "url": None})
    return out


def _collect_ucdp(con, since: datetime) -> list[dict]:
    out = []
    try:
        rows = con.execute("SELECT event_id, date, country, adm1, lat, lon, violence, deaths FROM ucdp_candidate "
                           "WHERE date >= ? AND violence LIKE 'state%' AND lat IS NOT NULL",
                           (since.strftime("%Y-%m-%d"),)).fetchall()
    except sqlite3.Error:
        return out
    for r in rows:
        out.append({"rid": f"ucdp:{r['event_id']}", "source": "UCDP (candidate)",
                    "title": f"Armed clash, {r['deaths']} killed — {r['adm1'] or r['country']}",
                    "lat": r["lat"], "lon": r["lon"], "time": f"{r['date']}T12:00:00Z",
                    "place": ", ".join(x for x in (r["adm1"], r["country"]) if x), "precision": "region",
                    "hint": "clash", "casualties": {"killed": r["deaths"] or 0, "injured": 0} if r["deaths"] else None,
                    "url": f"https://ucdp.uu.se/event/{r['event_id']}"})
    return out


_ARCHIVE_DDL = ("CREATE TABLE IF NOT EXISTS strike_gdelt_archive (rid TEXT PRIMARY KEY, ts TEXT NOT NULL, "
                "data TEXT NOT NULL)")


def _gdelt_raw(p: dict) -> dict:
    t = p.get("first_seen_at") or p.get("date")
    cameo = str(p.get("event_code") or "")
    actor_cc = str(p.get("actor1_country") or "")
    return {"rid": f"gd:{p.get('source_url') or p.get('id')}", "source": "GDELT (judged)",
            "title": p.get("title") or "", "text": p.get("original_title") or "", "lat": p.get("lat"),
            "lon": p.get("lon"), "time": t, "place": p.get("judged_where") or p.get("location_name") or "",
            "precision": "city", "hint": p.get("judge_act") or cameo or None,
            "actor_field": _CAMEO_ACTOR.get(actor_cc[:3]), "url": p.get("source_url"),
            "casualties": {"killed": p["judge_casualties"], "injured": 0} if p.get("judge_casualties") else None}


def _collect_gdelt(since: datetime) -> list[dict]:
    """Judged GDELT points now in the cache (archived), plus the archive."""
    fresh: list[dict] = []
    try:
        import gdelt_events as g
        import gdelt_judge as gj
        events = g.EVENTS_CACHE.get("events", []) or []
        if not events:
            g._load_persisted_cache()
            events = g.EVENTS_CACHE.get("events", []) or []
        codes = {str(e.get("id") or e.get("event_id")): e for e in events}
        pts = g.map_points(events)
        kept, _ = gj.filter_points(pts)
        cache = gj._load()
        for p in kept:
            ev = codes.get(str(p.get("id"))) or {}
            j = cache.get(p.get("source_url")) or {}
            p = dict(p, event_code=ev.get("event_code"), actor1_country=ev.get("actor1_country"),
                     judge_act=j.get("act") if j.get("act") in ("interception", "clash", "seizure") else None,
                     judge_casualties=j.get("casualties") if isinstance(j.get("casualties"), int) else None)
            raw = _gdelt_raw(p)
            if to_report(dict(raw)) is not None:
                fresh.append(raw)
    except Exception as ex:                                     # noqa: BLE001
        print(f"[strikes] gdelt collect error: {type(ex).__name__}: {ex}")
    out = {r["rid"]: r for r in fresh}
    try:
        con = sqlite3.connect(_db_path(), timeout=10)
        try:
            con.execute(_ARCHIVE_DDL)
            if fresh:
                con.executemany("INSERT OR REPLACE INTO strike_gdelt_archive (rid, ts, data) VALUES (?,?,?)",
                                [(r["rid"], _iso(r["time"]) or "", json.dumps(r)) for r in fresh])
            # keep the archive bounded: the longest window, plus slack
            cut = (datetime.now(timezone.utc) - timedelta(days=MAX_WINDOW_DAYS + 7)).strftime("%Y-%m-%dT%H:%M:%SZ")
            con.execute("DELETE FROM strike_gdelt_archive WHERE ts < ?", (cut,))
            con.commit()
            for (data,) in con.execute("SELECT data FROM strike_gdelt_archive WHERE ts >= ?",
                                       (since.strftime("%Y-%m-%dT%H:%M:%SZ"),)):
                r = json.loads(data)
                out.setdefault(r["rid"], r)
        finally:
            con.close()
    except sqlite3.Error as ex:
        print(f"[strikes] gdelt archive error: {ex}")
    return list(out.values())


def collect(since: datetime) -> list[dict]:
    """Every raw candidate since `since`, from every source. Blocking — call
    in a thread. A failing source is logged and skipped, never fatal."""
    raws: list[dict] = []
    try:
        con = _con()
        try:
            for fn in (_collect_geoconfirmed, _collect_telegram, _collect_alerts, _collect_ucdp):
                try:
                    raws.extend(fn(con, since))
                except sqlite3.Error as ex:
                    print(f"[strikes] {fn.__name__} error: {ex}")
        finally:
            con.close()
    except sqlite3.Error as ex:
        print(f"[strikes] db open error: {ex}")
    raws.extend(_collect_gdelt(since))
    return raws


def build(raws: list[dict], now: float | None = None) -> list[dict]:
    """Raw rows → merged, windowed events (each act kept for its window)."""
    now = now or time.time()
    reps = []
    for raw in raws:
        r = to_report(raw)
        if r is None:
            continue
        if (now - r["ts"]) > WINDOW_DAYS.get(r["act"], 14) * 86400:
            continue
        if not r.get("country"):
            r["country"] = _country(r["lat"], r["lon"])
        reps.append(r)
    return merge(reps, now)


# ── cached public API ───────────────────────────────────────────────────────
_CACHE: dict = {"at": 0.0, "events": [], "campaigns": []}
_BUILD_LOCK = threading.Lock()


def refresh(force: bool = False) -> dict:
    """The full window, rebuilt at most every CACHE_TTL_S. Blocking: the
    router calls it via asyncio.to_thread. One builder at a time; others
    get the previous result rather than queueing behind it."""
    if not force and time.time() - _CACHE["at"] < CACHE_TTL_S and _CACHE["at"]:
        return _CACHE
    if not _BUILD_LOCK.acquire(blocking=not _CACHE["at"]):
        return _CACHE
    try:
        if not force and time.time() - _CACHE["at"] < CACHE_TTL_S and _CACHE["at"]:
            return _CACHE
        since = datetime.now(timezone.utc) - timedelta(days=MAX_WINDOW_DAYS)
        evts = build(collect(since))
        camps = build_campaigns(evts)
        _CACHE.update(at=time.time(), events=evts, campaigns=camps)
        return _CACHE
    finally:
        _BUILD_LOCK.release()


def _in_bbox(e: dict, bbox) -> bool:
    if not bbox:
        return True
    w, s, east, n = bbox
    if not (s <= e["lat"] <= n):
        return False
    return (w <= e["lon"] <= east) if w <= east else (e["lon"] >= w or e["lon"] <= east)


def filter_events(evts: list[dict], since=None, bbox=None, acts=None, actors=None) -> list[dict]:
    t0 = _since_dt(since).timestamp() if since is not None else None
    acts = set(acts) if acts else None
    actors = {normalise_actor(a) or a for a in actors} if actors else None
    now = time.time()
    out = []
    for e in evts:
        if acts and e["act"] not in acts:
            continue
        if actors and e.get("actor") not in actors and e.get("actor_side") not in actors:
            continue
        ts = event_cluster._ts(e["time"])
        if t0 is not None and ts < t0:
            continue
        if not _in_bbox(e, bbox):
            continue
        out.append(dict(e, age_days=round(max(0.0, (now - ts) / 86400.0), 2)))
    return out


def events(since=None, bbox=None, acts=None, actors=None) -> list[dict]:
    """Normalised strike/control events (see module docstring). Blocking."""
    return filter_events(refresh()["events"], since=since, bbox=bbox, acts=acts, actors=actors)


def campaigns(since=None, bbox=None, actors=None) -> list[dict]:
    cs = refresh()["campaigns"]
    t0 = _since_dt(since).timestamp() if since is not None else None
    out = []
    for c in cs:
        if t0 is not None and event_cluster._ts(c["last"]) < t0:
            continue
        if actors and c["actor"] not in actors and c.get("actor_side") not in actors:
            continue
        if bbox:
            w, s, e, n = bbox
            if c["bbox"][2] < w or c["bbox"][0] > e or c["bbox"][3] < s or c["bbox"][1] > n:
                continue
        out.append(c)
    return out
