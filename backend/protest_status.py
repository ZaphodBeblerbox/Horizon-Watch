"""
protest_status.py — where an announced protest stands NOW, derived on read.

THE OWNER (2026-10-18): "If a protest was announced yesterday at République
for a specific time, I don't want to read 'announced 14 hours ago', I want
to read e.g. 'Currently ongoing', and be able to ingest the photos and
videos that go with it, with crowd estimations etc. — for any demo: France,
Albania, Italy, Argentina and so on."

AN ANNOUNCED PROTEST is a place and a stated start, from any of:
  · the announcement pass (telegram_announcements: the model's reading,
    geocoded by the pins' rule) — kept here from KEEP_PAST_H ago, so one
    that started this morning is still there to say "Ongoing" or "Ended";
  · the rule-read calls with a time (telegram_intents via telegram_signals:
    "rendez-vous Concorde 16h", "tous à l'Élysée demain 14h");
  · this module's own multilingual rule reader (read_announcement): Spanish,
    Italian, Albanian, French and English — "concentración en Plaza de Mayo
    mañana a las 17", "manifestazione domani alle 15 in piazza del Popolo",
    "protestë nesër në orën 18:00 para Kryeministrisë" — places from a small
    gazetteer of the squares crowds use in Tirana, Rome, Milan, Buenos Aires
    and others (PLACES), French ones through demo_situation.resolve_place.
    It needs no model: production's OpenAI credit ran out on 2026-10-18.
Two readings of the same gathering (≤ SAME_M apart, starts ≤ SAME_START_MIN
apart) are one protest that lists every post behind it.

ITS STATUS (status_of; nothing stored — a better rule applies to everything):
  planned     "Planned · starts in 3 h"           the clock, before the start
  starting    "Starting now · 14:00"              ± STARTING_MIN around the start,
                                                  or people already there before it
  ongoing     "Ongoing · since 14:00 (reports 3 min ago)"
              ONLY when the stated window holds now, or fresh on-the-ground
              evidence (≤ FRESH_MIN) is near the place: street reports
              (street_reports.signals), located crowd reports and live
              developments (demonstrations.read_reports), self-reported
              positions (telegram_intents kind 'at'), footage, and posts that
              name the place and say there is a crowd.
  dispersing  "Dispersing · reports 40 min ago"   dispersal words, or past the
                                                  window with reports 30–75 min old
  ended       "Ended · 14:00–17:20"
  no_show     "No sign it happened · planned 14:00"  the window passed with nothing
The window: the stated start + the stated end, or DEFAULT_DURATION_MIN for
its kind (a march 3 h, a rally 2 h 30, a strike 8 h …). Evidence extends it
(fresh reports after the planned end keep it "Ongoing") and shortens it
(dispersal reported: "Dispersing", then "Ended").

CROWD SIZE (crowd_figures, crowd_estimate): numbers stated in posts — "on est
2000", "des milliers", "decenas de miles", "mijëra", "migliaia", "10,000
according to organisers" — attributed to who gave them (organisers, police,
press, people there) and shown apart ("organisers 10,000 · police 2,300"),
with the vision model's estimate on the best photos (protest_media.py) as one
more basis. Always a range with its basis ("est. 1,500–3,000 · from 3 photos
+ 2 reports"), never a bare number.

Pure functions first; the reads at the bottom (blocking SQLite: call from a
thread). GET /api/routes/demonstrations carries the result as `protests`.
"""
from __future__ import annotations

import datetime as _dt
import math
import re
import sqlite3
import threading
import time
import unicodedata

KEEP_PAST_H = 30             # a protest that started this long ago is still listed (Ended / No sign it happened)
KEEP_AHEAD_D = 14
STARTING_MIN = 15            # "Starting now" this close to the start
FRESH_MIN = 30               # evidence this fresh: it is happening
DISPERSE_MIN = 45            # "Dispersing" this long after dispersal is reported, then "Ended"
TAIL_MIN = 75                # past the window, reports this old still read "Dispersing"
EARLY_MIN = 60               # evidence counts from this long before the start
SAME_M = 500
SAME_START_MIN = 90
RADIUS_M = {"march": 1500, "block": 800}
RADIUS_DEFAULT_M = 600
DEFAULT_DURATION_MIN = {"march": 180, "gather": 150, "vigil": 90, "strike": 480, "block": 360, "occupy": 720,
                        "attack": 120, "other": 150}
KIND_WORD = {"march": "a march", "gather": "a rally", "vigil": "a vigil", "strike": "a strike", "block": "a blockade",
             "occupy": "an occupation", "attack": "an action", "other": "a gathering"}
MEMO_S = 30
NOTE = "Status from the clock and from reports near the place — unverified Telegram reports, read by rule"

LABEL = {"planned": "Planned", "starting": "Starting now", "ongoing": "Ongoing", "dispersing": "Dispersing",
         "ended": "Ended", "no_show": "No sign it happened"}


# ── words ───────────────────────────────────────────────────────────────────

def fold(text) -> str:
    t = unicodedata.normalize("NFKD", str(text or ""))
    return "".join(c for c in t if not unicodedata.combining(c)).lower().replace("’", "'")


def _utc(v) -> _dt.datetime | None:
    if v in (None, ""):
        return None
    if isinstance(v, _dt.datetime):
        return v if v.tzinfo else v.replace(tzinfo=_dt.timezone.utc)
    try:
        t = _dt.datetime.fromisoformat(str(v).replace("Z", "+00:00").replace(" ", "T"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=_dt.timezone.utc)


def iso(d: _dt.datetime | None) -> str | None:
    return d.astimezone(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if d else None


def metres(a_lat, a_lon, b_lat, b_lon) -> float:
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    h = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b_lon - a_lon) / 2) ** 2)
    return 12_742_000.0 * math.asin(min(1.0, math.sqrt(h)))


_KIND_RX = [
    ("vigil", re.compile(r"vigil|veillee|veglia|fiaccolata|vigilia|homenaje")),
    ("strike", re.compile(r"strike|greve|grev[ae]\b|huelga|paro\b|paro general|sciopero|walkout")),
    ("block", re.compile(r"block|blocage|bloqu|bloqueo|blocco|bllokim|corte de (?:ruta|calle)|piquete|barrage|escargot")),
    ("occupy", re.compile(r"occup|ocupa|okupim|sit-in|acampe")),
    ("march", re.compile(r"march|marche|cortege|procession|defile|manif\b|manifestation|corteo|marshim|movilizacion|"
                         r"demonstration|parade")),
    ("gather", re.compile(r"rally|rassemblement|gathering|concentracion|presidio|tubim|protest|manifestazione|"
                          r"manifestacion|cacerolazo|demo\b|kundgebung")),
]


def kind_of(what: str | None = None, act: str | None = None) -> str:
    """"protest march" → march; "student strike" → strike; an intent's act
    (gather / march / block / occupy / attack / strike) when it has one."""
    if act in DEFAULT_DURATION_MIN and act not in ("other",):
        return act
    f = fold(what)
    for k, rx in _KIND_RX:
        if rx.search(f):
            return k
    return "gather" if f else "other"


def radius_for(kind: str) -> int:
    return RADIUS_M.get(kind, RADIUS_DEFAULT_M)


# ── clock words ─────────────────────────────────────────────────────────────

def zone_name(zone) -> str | None:
    return getattr(zone, "key", None) or (str(zone) if zone else None)


def hhmm(t: _dt.datetime | None, zone=None) -> str:
    if not t:
        return ""
    return t.astimezone(zone).strftime("%H:%M") if zone else t.strftime("%H:%M UTC")


def span(minutes: float) -> str:
    """12 → "12 min"; 200 → "3 h 20"; 1500 → "1 day"."""
    m = max(0, int(round(minutes)))
    if m < 60:
        return f"{m} min"
    if m < 24 * 60:
        h, r = divmod(m, 60)
        return f"{h} h" if r == 0 else f"{h} h {r:02d}"
    d = round(m / 1440)
    return f"{d} day{'s' if d != 1 else ''}"


def ago(minutes: float) -> str:
    return "just now" if minutes < 1 else f"{span(minutes)} ago"


def day_label(t: _dt.datetime, now: _dt.datetime, zone=None) -> str:
    """"today", "tomorrow", "Sat 18 Oct" (in the place's zone)."""
    z = zone or _dt.timezone.utc
    d, n = t.astimezone(z).date(), now.astimezone(z).date()
    if d == n:
        return "today"
    if d == n + _dt.timedelta(days=1):
        return "tomorrow"
    if d == n - _dt.timedelta(days=1):
        return "yesterday"
    return t.astimezone(z).strftime("%a %-d %b")


# ── the lifecycle ───────────────────────────────────────────────────────────

DISPERSE_WORDS = re.compile(
    r"\b(dispers\w*|se disperse\w*|fin de (?:la )?manif\w*|la manif est finie|c'est fini|tout le monde rentre|"
    r"dispersing|dispersed|disperse|crowd (?:has )?(?:thinned|left)|over now|"
    r"se dispers\w*|desconcentr\w*|termin[oó] la marcha|se desconcentr\w*|"
    r"si (?:e |è )?(?:sciolt\w*|disperso)|sciolto il corteo|finita la manifestazione|"
    r"u shpernda\w*|shperndah\w*|perfundoi protesta)\b")


def window(p: dict) -> tuple[_dt.datetime | None, _dt.datetime | None, bool]:
    """(start, planned end, start approximate). A date without an hour starts
    at noon there and is approximate: the clock alone never makes it ongoing."""
    start = _utc(p.get("starts_utc"))
    approx = bool(p.get("start_approx"))
    if not start:
        return None, None, True
    end = _utc(p.get("ends_utc"))
    if not end or end <= start:
        end = start + _dt.timedelta(minutes=DEFAULT_DURATION_MIN.get(p.get("kind") or "other", 150))
    return start, end, approx


def near_evidence(p: dict, evidence: list[dict], now: _dt.datetime) -> list[dict]:
    """The evidence near the protest's place and inside its time (from
    EARLY_MIN before the start to now), newest last, each with its distance."""
    start, _end, approx = window(p)
    lo = (start - _dt.timedelta(minutes=EARLY_MIN)) if start and not approx else None
    if approx and start:
        z = p.get("_zone") or _dt.timezone.utc
        d = start.astimezone(z).date()
        lo = _dt.datetime(d.year, d.month, d.day, 6, 0, tzinfo=z)
    r = p.get("radius_m") or radius_for(p.get("kind") or "other")
    out = []
    for e in evidence:
        t = _utc(e.get("at"))
        if not t or t > now + _dt.timedelta(minutes=2) or (lo and t < lo):
            continue
        if e.get("lat") is None or p.get("lat") is None:
            continue
        d = metres(p["lat"], p["lon"], e["lat"], e["lon"])
        if d > r:
            continue
        out.append({**e, "distance_m": round(d), "_t": t})
    out.sort(key=lambda e: e["_t"])
    return out


def status_of(p: dict, evidence: list[dict], now: _dt.datetime, zone=None) -> dict:
    """The protest's status from the clock and the evidence near it (see the
    module's docstring). → {key, label, since, until, last_report_at,
    last_report_min, n_reports, basis, ...}."""
    start, end, approx = window(p)
    ev = near_evidence({**p, "_zone": zone}, evidence, now)
    first = ev[0]["_t"] if ev else None
    last = ev[-1]["_t"] if ev else None
    disp = [e for e in ev if e.get("dispersal")]
    last_disp = disp[-1]["_t"] if disp else None
    last_other = max((e["_t"] for e in ev if not e.get("dispersal")), default=None)
    last_min = (now - last).total_seconds() / 60 if last else None
    fresh = last is not None and last_min <= FRESH_MIN
    out = {"n_reports": len(ev), "last_report_at": iso(last), "last_report_min": round(last_min, 1) if last_min is not None else None,
           "first_report_at": iso(first), "starts_utc": iso(start), "planned_end_utc": iso(end), "start_approx": approx,
           "tz": zone_name(zone)}

    def done(key, basis, since=None, until=None):
        out.update(key=key, basis=basis, since=iso(since), until=iso(until))
        out["label"] = status_label(out, now, zone)
        return out

    if start is None:
        return done("planned", "clock")
    early = start - _dt.timedelta(minutes=EARLY_MIN)
    # shortened: dispersal reported after the last report of a crowd
    if last_disp and (last_other is None or last_disp >= last_other) and last_disp >= early:
        since = min(first, start) if first and not approx else (first or start)
        if (now - last_disp).total_seconds() / 60 <= DISPERSE_MIN:
            return done("dispersing", "evidence", since)
        return done("ended", "evidence", since, last_disp)
    if fresh and now >= early:
        if now < start - _dt.timedelta(minutes=STARTING_MIN) and not approx:
            return done("starting", "evidence", first)
        since = start if (approx or first is None or first >= start) else first
        if approx:
            since = first
        return done("ongoing", "evidence", since)
    if approx:
        z = zone or _dt.timezone.utc
        d = start.astimezone(z).date()
        day_end = _dt.datetime(d.year, d.month, d.day, 23, 0, tzinfo=z)
        if now < day_end:
            if last is not None and last_min <= TAIL_MIN:
                return done("dispersing", "evidence", first)
            return done("planned", "clock")
        if ev:
            return done("ended", "evidence", first, last)
        return done("no_show", "clock")
    if now < start - _dt.timedelta(minutes=STARTING_MIN):
        return done("planned", "clock")
    if now < start + _dt.timedelta(minutes=STARTING_MIN):
        return done("starting", "clock", start)
    if now < end:
        return done("ongoing", "clock", start)
    # past the planned end, nothing fresh
    if ev and last >= start - _dt.timedelta(minutes=EARLY_MIN):
        if last_min <= TAIL_MIN:
            return done("dispersing", "evidence", min(first, start))
        return done("ended", "evidence", min(first, start), max(last, min(end, last + _dt.timedelta(minutes=FRESH_MIN))))
    return done("no_show", "clock")


def status_label(s: dict, now: _dt.datetime, zone=None) -> str:
    """The words for a status (also rebuilt in the browser between polls,
    src/globe/protests.js statusLabel — keep the two the same)."""
    key = s.get("key")
    start, since, until = _utc(s.get("starts_utc")), _utc(s.get("since")), _utc(s.get("until"))
    last_min = s.get("last_report_min")
    last = _utc(s.get("last_report_at"))
    if last is not None:
        last_min = (now - last).total_seconds() / 60
    reports = f"reports {ago(last_min)}" if last_min is not None else None
    if key == "planned":
        if not start:
            return "Planned"
        if s.get("start_approx"):
            return f"Planned · {day_label(start, now, zone)} (no time given)"
        mins = (start - now).total_seconds() / 60
        if mins < 12 * 60:
            return f"Planned · starts in {span(mins)}"
        return f"Planned · {day_label(start, now, zone)} {hhmm(start, zone)}"
    if key == "starting":
        if since and start and since < start - _dt.timedelta(minutes=STARTING_MIN):
            return f"Starting · people already there ({reports or 'reported'})"
        return f"Starting now · {hhmm(start, zone)}" + (f" ({reports})" if reports and last_min <= FRESH_MIN else "")
    if key == "ongoing":
        head = f"Ongoing · since {hhmm(since or start, zone)}"
        if reports:
            return f"{head} ({reports})"
        return f"{head} (no reports from there yet)"
    if key == "dispersing":
        return f"Dispersing · {reports}" if reports else "Dispersing"
    if key == "ended":
        a, b = since or start, until
        if a and b:
            return f"Ended · {hhmm(a, zone)}–{hhmm(b, zone)}"
        return "Ended"
    if key == "no_show":
        return f"No sign it happened · planned {hhmm(start, zone)}" if start and not s.get("start_approx") else "No sign it happened"
    return LABEL.get(key or "", "Announced")


# ── crowd figures stated in posts ───────────────────────────────────────────

_MULT = {"k": 1_000, "mil": 1_000, "mille": 1_000, "milles": 1_000, "mila": 1_000, "mije": 1_000,
         "million": 1_000_000, "millions": 1_000_000, "millones": 1_000_000, "millon": 1_000_000,
         "milioni": 1_000_000, "milione": 1_000_000, "milion": 1_000_000}
_NUM = (r"(?P<n>\d{1,3}(?:[ .,  ]\d{3})+|\d+(?:[.,]\d+)?)\s*"
        r"(?P<m>k\b|mil\b|milles?\b|mila\b|mije\b|millions?\b|millones\b|millon\b|milioni\b|milione\b|milion\b)?")
_NOUN = (r"(?:personnes?|manifestant\w*|gens|participant\w*|people|persons|protest[eo]rs?|demonstrators?|marchers|"
         r"greviste\w*|militant\w*|manifestantes?|personas|persone|manifestanti|partecipanti|njerez\w*|protestues\w*|"
         r"qytetare\w*|demonstrues\w*|pjesemarres\w*|vecinos|trabajadores|lavoratori|studenti|estudiantes|etudiants|"
         r"lyceens|gilets jaunes|ciudadanos|cittadini)")
_APPROX = (r"(?:(?:plus de|pres de|environ|au moins|quelque|un peu plus de|mas de|unos|unas|cerca de|al menos|"
           r"oltre|circa|almeno|piu di|mbi|rreth|te pakten|over|about|around|at least|more than|nearly|some|approximately)\s+)?")
_STATED = re.compile(r"(?<![\w.,:])" + _APPROX + _NUM + r"\s+(?:(?:de|di|d'|of|te|e)\s+)?(?:\w+\s+)?" + _NOUN)
_SELF = re.compile(r"\b(?:on est|on etait|nous sommes|nous etions|somos|eramos|siamo|eravamo|jemi|ishim|we are|we're|"
                   r"we were|ils sont|ils etaient|they are|they were|son|sono|jane)\s+" + _APPROX + _NUM + r"(?![\d:h])")
# vague amounts: (folded words, low, high), longest first
_VAGUE = [
    (r"(?:des |plusieurs )?centaines de milliers|cientos de miles|centenares de miles|centinaia di migliaia|"
     r"qindra mijera|hundreds of thousands", 100_000, 500_000),
    (r"(?:des |plusieurs )?dizaines de milliers|decenas de miles|decine di migliaia|dhjetera mijera|tens of thousands", 10_000, 50_000),
    (r"(?:des |plusieurs )?milliers|miles de|\bmiles\b|migliaia|mijera|thousands", 2_000, 9_000),
    (r"(?:des |plusieurs )?centaines|cientos|centenares|centinaia|qindra|hundreds", 200, 900),
    (r"(?:des |quelques )?dizaines|decenas|decine|dhjetera|dozens", 20, 90),
]
_VAGUE_RX = [(re.compile(rf"\b(?:{w})\b"), lo, hi) for w, lo, hi in _VAGUE]
CROWD_ANY = re.compile(
    r"\b(manif\w*|rassembl\w*|cortege|foule|protest\w*|demonstrat\w*|march\w*|rally|crowd|manifestaci\w*|marcha|"
    r"concentraci\w*|movilizaci\w*|corteo|presidio|manifestazion\w*|piazza|tubim\w*|protest[aeë]\w*|marshim\w*|"
    r"shesh\w*|en la calle|in piazza|dans la rue|in the streets|ne rruge|greve|huelga|sciopero)\b")
_ORG = re.compile(r"(organisat\w*|organizador\w*|organizzator\w*|organizator\w*|organi[sz]er\w*|intersyndicale|"
                  r"\bcgt\b|syndicats?|sindicat\w*|sindacat\w*|convocante\w*|promotor\w*|revendique\w*)")
_POLICE = re.compile(r"(police|policia|polizia|policis\w*|prefecture|ministere de l'interieur|beauvau|questura|"
                     r"carabinieri|gendarmerie|fuentes policiales|policia federal|ministerio de seguridad|"
                     r"ministria e brendshme|interior ministry)")
_PRESS = re.compile(r"\b(afp|reuters|associated press|\bap\b|bfm\w*|le monde|le parisien|franceinfo|ansa|corriere|"
                    r"repubblica|clarin|la nacion|infobae|pagina ?12|top channel|klan|euronews|bbc|cnn|selon les medias|"
                    r"according to (?:the )?media|segun medios|secondo i media|press)\b")
_NOUN_RX = re.compile(r"\b" + _NOUN)
_YEAR_BEFORE = re.compile(r"\b(?:en|in|nel|del|de|since|depuis|desde|dal|year|anno|ano|vitin|ne|le|el)\s+$")
WHO_LABEL = {"organisers": "organisers", "police": "police", "press": "press", "people": "people there", "reports": "reports"}


def _num(n: str, mult: str | None) -> float | None:
    s = n.replace(" ", " ").replace(" ", " ")
    if mult:
        try:
            return float(s.replace(" ", "").replace(",", ".")) * _MULT[mult.strip()]
        except (ValueError, KeyError):
            return None
    if re.fullmatch(r"\d{1,3}(?:[ .,]\d{3})+", s):
        return float(re.sub(r"[ .,]", "", s))
    try:
        return float(s.replace(",", "."))
    except ValueError:
        return None


def _who(f: str, a: int, b: int, role: str | None, self_count: bool) -> str:
    """Who gave a figure: the words around it (the sentence), else the channel's role."""
    lo = max(f.rfind(".", 0, a), f.rfind("\n", 0, a), f.rfind("!", 0, a), f.rfind("?", 0, a), a - 90)
    ends = [i for i in (f.find(".", b), f.find("\n", b)) if i >= 0]
    hi = min(ends + [b + 90])
    ctx = f[max(0, lo):hi]
    po, og = _POLICE.search(ctx), _ORG.search(ctx)
    if po and og:
        # "10,000 according to organisers, 2,300 according to the police": the nearer one
        dp = min(abs(po.start() - (a - max(0, lo))), abs(po.start() - (b - max(0, lo))))
        do = min(abs(og.start() - (a - max(0, lo))), abs(og.start() - (b - max(0, lo))))
        return "police" if dp < do else "organisers"
    if po:
        return "police"
    if og:
        return "organisers"
    if _PRESS.search(ctx):
        return "press"
    if self_count:
        return "people"
    if role in ("outlet", "official"):
        return "press"
    if role in ("group", "local"):
        return "people"
    return "reports"


def crowd_figures(text: str | None, role: str | None = None) -> list[dict]:
    """Crowd sizes a post states: [{low, high, value, who, words}]. "on est
    2000" (people there), "2 300 selon la police" (police), "des milliers de
    manifestants", "decenas de miles", "mijëra qytetarë", "migliaia in
    piazza" (a range for a vague word). Numbers that are times, dates,
    years or prices are not crowds: a number counts only next to a crowd
    noun or after "we are"."""
    f = fold(text)[:3000]
    out, taken = [], []

    def free(a, b):
        return all(b <= x or a >= y for x, y in taken)

    for rx, self_count in ((_SELF, True), (_STATED, False)):
        for m in rx.finditer(f):
            if not free(m.start(), m.end()):
                continue
            v = _num(m.group("n"), m.group("m"))
            if v is None or v < 10 or v > 5_000_000:
                continue
            if (not self_count and not m.group("m") and 1900 <= v <= 2100 and not re.search(r"\d[ .,]\d", m.group("n"))
                    and _YEAR_BEFORE.search(f[max(0, m.start() - 8):m.start()])):
                continue                                       # "en 2019 des manifestants": a year
            taken.append((m.start(), m.end()))
            who = _who(f, m.start(), m.end(), role, self_count)
            out.append({"low": v, "high": v, "value": v, "who": who, "words": m.group(0).strip()[:80]})
    if CROWD_ANY.search(f) or re.search(_NOUN, f):
        for rx, lo, hi in _VAGUE_RX:
            for m in rx.finditer(f):
                if not free(m.start(), m.end()):
                    continue
                taken.append((m.start(), m.end()))
                who = _who(f, m.start(), m.end(), role, False)
                out.append({"low": lo, "high": hi, "value": None, "who": who, "words": m.group(0).strip()[:80]})
    return out


def round2(v: float) -> int:
    """Two significant figures: 2347 → 2300; 87 → 87; 12_600 → 13_000."""
    v = float(v)
    if v < 100:
        return int(round(v))
    p = 10 ** (int(math.log10(v)) - 1)
    return int(round(v / p) * p)


def fmt_n(v: float) -> str:
    return f"{round2(v):,}"


def _median(xs: list[float]) -> float:
    xs = sorted(xs)
    n = len(xs)
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2


def crowd_estimate(figures: list[dict], vision: dict | None = None) -> dict | None:
    """Figures stated in posts ({low, high, value, who, post…}) and the
    vision estimate ({photos, low, high}) → {label, low, high, basis,
    by_source: [{who, label, low, high, n}], by_source_label}. None when
    nothing says how many — never a bare number."""
    groups: dict[str, list] = {}
    for f in figures:
        groups.setdefault(f["who"], []).append(f)
    by = []
    for who in ("organisers", "police", "press", "people", "reports"):
        fs = groups.get(who)
        if not fs:
            continue
        lo, hi = _median([f["low"] for f in fs]), _median([f["high"] for f in fs])
        exact = [f["value"] for f in fs if f.get("value")]
        by.append({"who": who, "label": WHO_LABEL[who], "low": lo, "high": hi, "n": len(fs),
                   "value": _median(exact) if exact else None})
    cands = [(b["low"], b["high"]) for b in by]
    photos = int((vision or {}).get("photos") or 0)
    if photos and (vision or {}).get("high"):
        cands.append((float(vision["low"]), float(vision["high"])))
    if not cands:
        return None
    lo, hi = min(c[0] for c in cands), max(c[1] for c in cands)
    if lo == hi:                                               # one figure: say how rough it is
        lo, hi = lo * 0.75, hi * 1.25
    n_posts = len({f.get("post") or id(f) for f in figures})
    basis = []
    if photos:
        basis.append(f"{photos} photo{'s' if photos != 1 else ''}")
    if n_posts:
        basis.append(f"{n_posts} report{'s' if n_posts != 1 else ''}")
    by_label = " · ".join(f"{b['label']} {fmt_n(b['value'])}" if b["value"] else
                          f"{b['label']} {fmt_n(b['low'])}–{fmt_n(b['high'])}" for b in by)
    return {"low": round2(lo), "high": round2(hi), "basis": " + ".join(basis),
            "label": f"est. {fmt_n(lo)}–{fmt_n(hi)} · from {' + '.join(basis)}",
            "by_source": by, "by_source_label": by_label or None}


# ── places beyond France ────────────────────────────────────────────────────
# (name, city, country, lat, lon, aliases — folded; an alias matches the
# start of a word, so Albanian and Italian endings still match:
# "kryeministri" → "Kryeministrisë", "kuvend" → "Kuvendit").
# French places come from demo_situation.resolve_place; a shared
# backend/cities.py (being written by another pass) can replace this table.
PLACES = [
    ("Sheshi Skënderbej", "Tirana", "al", 41.3275, 19.8187, ["sheshi skenderbej", "skenderbej square", "skenderbeg square"]),
    ("Kryeministria (Prime Minister's Office)", "Tirana", "al", 41.3226, 19.8209, ["kryeministri", "prime minister's office in tirana"]),
    ("Kuvendi (Parliament)", "Tirana", "al", 41.3247, 19.8226, ["kuvend", "parlamenti i shqiperise", "albanian parliament"]),
    ("Bulevardi Dëshmorët e Kombit", "Tirana", "al", 41.3200, 19.8210, ["deshmoret e kombit"]),
    ("Sheshi Nënë Tereza", "Tirana", "al", 41.3178, 19.8215, ["sheshi nene tereza"]),
    ("Piazza del Popolo", "Rome", "it", 41.9107, 12.4764, ["piazza del popolo"]),
    ("Piazza San Giovanni", "Rome", "it", 41.8859, 12.5057, ["piazza san giovanni", "san giovanni in laterano"]),
    ("Piazza Venezia", "Rome", "it", 41.8960, 12.4823, ["piazza venezia"]),
    ("Montecitorio (Parliament)", "Rome", "it", 41.9009, 12.4787, ["montecitorio"]),
    ("Palazzo Chigi", "Rome", "it", 41.9012, 12.4800, ["palazzo chigi"]),
    ("Circo Massimo", "Rome", "it", 41.8861, 12.4853, ["circo massimo"]),
    ("Piazza della Repubblica", "Rome", "it", 41.9028, 12.4964, ["piazza della repubblica", "piazza esedra"]),
    ("Piazza Barberini", "Rome", "it", 41.9038, 12.4886, ["piazza barberini"]),
    ("Roma Termini", "Rome", "it", 41.9010, 12.5016, ["stazione termini", "roma termini", "piazza dei cinquecento"]),
    ("Piramide", "Rome", "it", 41.8766, 12.4808, ["piramide cestia", "piazzale ostiense"]),
    ("Piazza del Duomo", "Milan", "it", 45.4642, 9.1900, ["piazza duomo", "piazza del duomo", "duomo di milano"]),
    ("Piazza della Scala", "Milan", "it", 45.4674, 9.1897, ["piazza della scala", "piazza scala", "palazzo marino"]),
    ("Largo Cairoli", "Milan", "it", 45.4685, 9.1830, ["largo cairoli"]),
    ("Piazza Cadorna", "Milan", "it", 45.4680, 9.1760, ["piazza cadorna", "cadorna"]),
    ("Porta Venezia", "Milan", "it", 45.4746, 9.2050, ["porta venezia"]),
    ("Milano Centrale", "Milan", "it", 45.4861, 9.2044, ["stazione centrale", "milano centrale", "piazza duca d'aosta"]),
    ("Piazza XXIV Maggio", "Milan", "it", 45.4527, 9.1803, ["piazza xxiv maggio", "piazza 24 maggio"]),
    ("Plaza de Mayo", "Buenos Aires", "ar", -34.6083, -58.3712, ["plaza de mayo", "casa rosada"]),
    ("Congreso de la Nación", "Buenos Aires", "ar", -34.6097, -58.3926, ["congreso de la nacion", "plaza del congreso",
                                                                         "plaza de los dos congresos", "frente al congreso",
                                                                         "al congreso", "el congreso"]),
    ("Obelisco", "Buenos Aires", "ar", -34.6037, -58.3816, ["obelisco"]),
    ("Avenida de Mayo", "Buenos Aires", "ar", -34.6088, -58.3800, ["avenida de mayo", "av. de mayo"]),
    ("Puente Pueyrredón", "Buenos Aires", "ar", -34.6650, -58.3720, ["puente pueyrredon"]),
    ("Puerta del Sol", "Madrid", "es", 40.4169, -3.7035, ["puerta del sol"]),
    ("Plaça de Catalunya", "Barcelona", "es", 41.3870, 2.1700, ["placa de catalunya", "plaza de cataluna", "plaza catalunya"]),
    ("Syntagma Square", "Athens", "gr", 37.9755, 23.7348, ["syntagma", "plateia syntagmatos"]),
    ("Plaza Italia (Baquedano)", "Santiago", "cl", -33.4372, -70.6345, ["plaza italia", "plaza baquedano", "plaza dignidad"]),
    ("Plaza Venezuela", "Caracas", "ve", 10.4996, -66.8833, ["plaza venezuela"]),
    ("Plaza Altamira", "Caracas", "ve", 10.4961, -66.8496, ["plaza altamira", "altamira"]),
]
_PL = [{"name": n, "city": c, "cc": cc, "lat": la, "lon": lo, "id": f"pl:{fold(c)}:{fold(n)}", "plain": al,
        "rx": [re.compile(r"(?<![\w-])" + re.escape(a) + r"[\w-]*") for a in al]}
       for n, c, cc, la, lo, al in PLACES]
CITY_NAMES = {"tirana": "al", "tirane": "al", "tiranes": "al", "roma": "it", "rome": "it", "milano": "it", "milan": "it",
              "buenos aires": "ar", "caba": "ar", "madrid": "es", "barcelona": "es", "athens": "gr", "atenas": "gr",
              "santiago": "cl", "caracas": "ve"}


_ANY_FR: list = []
_PLACE_MEMO: dict = {}


def _any_fr():
    """Every free-text alias of demo_situation's gazetteer, as plain words: a
    text none of them occurs in resolves to nothing there (strict aliases
    never match free text), so most posts skip the per-place search."""
    if not _ANY_FR:
        try:
            import demo_situation as ds
            _ANY_FR.append(tuple(a for g in ds._GAZ for a, strict, _rx in g["aliases"] if not strict))
        except Exception:                                      # noqa: BLE001
            _ANY_FR.append(None)
    return _ANY_FR[0]


def place_in(text: str | None, folded: bool = False) -> dict | None:
    """The gazetteer place a text names (the longest alias that occurs), else
    a French place (demo_situation's gazetteer, no street lookups), else None.
    → {id, name, city, cc, lat, lon}. A post does not change: memoised."""
    f = text if folded else fold(text)
    key = hash(f)
    if key in _PLACE_MEMO:
        return _PLACE_MEMO[key]
    if len(_PLACE_MEMO) > 50_000:
        _PLACE_MEMO.clear()
    _PLACE_MEMO[key] = out = _place_in(f)
    return out


def _place_in(f: str) -> dict | None:
    best = None
    for g in _PL:
        if not any(a in f for a in g["plain"]):
            continue
        for rx in g["rx"]:
            m = rx.search(f)
            if m and (best is None or len(m.group(0)) > best[0]):
                best = (len(m.group(0)), g)
    if best:
        g = best[1]
        return {"id": g["id"], "name": g["name"], "city": g["city"], "cc": g["cc"], "lat": g["lat"], "lon": g["lon"]}
    fr = _any_fr()
    if fr is None or any(a in f for a in fr):
        try:
            import demo_situation as ds
            pl = ds.resolve_place(f, None, None, None, strict_ok=False, streets=False)
        except Exception:                                      # noqa: BLE001
            pl = None
        if pl:
            return {"id": pl["id"], "name": pl["name"], "city": str(pl.get("city") or "").title(), "cc": "fr",
                    "lat": pl["lat"], "lon": pl["lon"]}
    # the street reports' gazetteer: places as people write them ("Répu",
    # "Bastoche", "Plaza Venezuela"), read through its own function only
    try:
        import street_reports as srp
        sp = srp.place_in(f)
    except Exception:                                          # noqa: BLE001
        sp = None
    if sp and sp.get("lat") is not None and not isinstance(sp.get("lat"), list):
        return {"id": f"sr:{sp.get('id')}", "name": sp.get("name"), "city": sp.get("city"),
                "cc": (sp.get("country") or "").lower() or None, "lat": float(sp["lat"]), "lon": float(sp["lon"])}
    return None


# ── announcements read by rule, in five languages ──────────────────────────

GATHER = re.compile(
    r"\b(manifestation|manif|rassemblement|marche|greve|blocage|protest\w*|rally|march|demonstration|strike|vigil|"
    r"concentracion|marcha|movilizacion|manifestacion|paro|huelga|cacerolazo|piquete|ruidazo|"
    r"manifestazione|corteo|presidio|sciopero|fiaccolata|protesta|proteste|"
    r"protest[eë]s?|tubim\w*|marshim\w*|grev[eë]|bllokim\w*|sit-in)\b")
_TODAY = re.compile(r"\b(hoy|esta (?:tarde|noche)|oggi|stasera|stamattina|sot|sonte|aujourd'hui|ce soir|today|tonight)\b")
_TOMORROW = re.compile(r"\b(manana|domani|neser|demain|tomorrow)\b")
_WEEKDAY = {w: i for i, ws in enumerate([
    ("lunes", "lunedi", "e hene", "lundi", "monday"), ("martes", "martedi", "e marte", "mardi", "tuesday"),
    ("miercoles", "mercoledi", "e merkure", "mercredi", "wednesday"), ("jueves", "giovedi", "e enjte", "jeudi", "thursday"),
    ("viernes", "venerdi", "e premte", "vendredi", "friday"), ("sabado", "sabato", "e shtune", "samedi", "saturday"),
    ("domingo", "domenica", "e diel", "dimanche", "sunday")]) for w in ws}
_WD = re.compile(r"\b(" + "|".join(sorted(map(re.escape, _WEEKDAY), key=len, reverse=True)) + r")\b")
_MONTHS = {m: i + 1 for i, ms in enumerate([
    ("enero", "gennaio", "janar", "janvier", "january"), ("febrero", "febbraio", "shkurt", "fevrier", "february"),
    ("marzo", "mars", "march"), ("abril", "aprile", "prill", "avril", "april"), ("mayo", "maggio", "maj", "mai", "may"),
    ("junio", "giugno", "qershor", "juin", "june"), ("julio", "luglio", "korrik", "juillet", "july"),
    ("agosto", "gusht", "aout", "august"), ("septiembre", "settembre", "shtator", "septembre", "september"),
    ("octubre", "ottobre", "tetor", "octobre", "october"), ("noviembre", "novembre", "nentor", "november"),
    ("diciembre", "dicembre", "dhjetor", "decembre", "december")]) for m in ms}
_DATE = re.compile(r"\b([0-3]?\d)(?:er|st|nd|rd|th)?\s+(?:de\s+)?(" + "|".join(sorted(_MONTHS, key=len, reverse=True)) + r")\b")
_CLOCK = re.compile(
    r"(?:\b(?:a las|alle(?: ore)?|ore|ora|ne oren|neoren|en ora|at|a|des|from|desde las|dalle)\s+)"
    r"(?P<h>[01]?\d|2[0-3])(?:[:.h](?P<m>[0-5]\d))?\s*(?P<pm>pm|p\.m\.|am|a\.m\.)?(?:\s*(?:hs|h|hrs|horas|uhr))?\b"
    r"|\b(?P<h2>[01]?\d|2[0-3])(?:[:h](?P<m2>[0-5]\d)|\s*hs\b|h\b)")


def _clock(f: str) -> tuple[int, int] | None:
    for m in _CLOCK.finditer(f):
        if m.group("h") is not None:
            h, mi = int(m.group("h")), int(m.group("m") or 0)
            pm = m.group("pm")
            if pm and pm.startswith("p") and h < 12:
                h += 12
            # "a 3" alone is not an hour; "a las 17" is
            if not (m.group("m") or pm or re.search(r"a las|alle|ore|ora|oren|hs|h\b|uhr", m.group(0))):
                continue
            return h, mi
        if m.group("h2") is not None:
            return int(m.group("h2")), int(m.group("m2") or 0)
    return None


def _day(f: str, local: _dt.datetime) -> _dt.date | None:
    m = _DATE.search(f)
    if m:
        try:
            d = _dt.date(local.year, _MONTHS[m.group(2)], int(m.group(1)))
            if (local.date() - d).days > 200:
                d = d.replace(year=local.year + 1)
            return d
        except ValueError:
            pass
    if _TOMORROW.search(f):
        return local.date() + _dt.timedelta(days=1)
    m = _WD.search(f)
    if m:
        ahead = (_WEEKDAY[m.group(1)] - local.weekday()) % 7
        return local.date() + _dt.timedelta(days=ahead)
    if _TODAY.search(f):
        return local.date()
    return None


def read_announcement(text: str | None, posted_at, zone_of=None) -> dict | None:
    """A post announcing a gathering at a known place and time, by rule:
    {what, kind, place, starts_utc, start_approx} or None. Needs a
    gathering word, a place the gazetteer knows, and a day or an hour; the
    start must come after the post (an announcement is of something to come)."""
    f = fold(text)[:2000]
    g = GATHER.search(f)
    if not g:
        return None
    posted = _utc(posted_at)
    if not posted:
        return None
    pl = place_in(f, folded=True)
    if not pl:
        return None
    zone = zone_of(pl.get("cc")) if zone_of else None
    z = zone or _dt.timezone.utc
    local = posted.astimezone(z)
    day = _day(f, local)
    ck = _clock(f)
    if not day and not ck:
        return None
    day = day or local.date()
    if ck:
        try:
            start = _dt.datetime(day.year, day.month, day.day, ck[0], ck[1], tzinfo=z)
        except ValueError:
            return None
        approx = False
    else:
        start = _dt.datetime(day.year, day.month, day.day, 12, 0, tzinfo=z)
        approx = True
    if ck and start <= posted - _dt.timedelta(minutes=15):
        return None                                            # already begun when written: a report, not an announcement
    if approx and day <= local.date():
        return None
    what = g.group(1)
    return {"what": what, "kind": kind_of(what), "place": pl, "starts_utc": iso(start.astimezone(_dt.timezone.utc)),
            "start_approx": approx}


# ── protests from their sources (pure) ─────────────────────────────────────

def _src(r: dict, how: str) -> dict:
    ch = str(r.get("channel") or "")
    return {"channel": ch, "channel_title": r.get("channel_title") or ch, "msg_id": r.get("msg_id"),
            "posted_at": r.get("posted_at"), "how": how, "text": (r.get("text") or "")[:300],
            "url": None if ch.startswith("c/") or not ch else f"https://t.me/{ch}/{r.get('msg_id')}"}


def merge_protests(cands: list[dict]) -> list[dict]:
    """One protest per place and start: candidates ≤ SAME_M apart starting
    ≤ SAME_START_MIN apart are one; the first (best-sourced) keeps its
    fields, the others add their posts. cands: {id, what, kind, place,
    city, cc, lat, lon, starts_utc, start_approx, tz?, sources, rank}."""
    out: list[dict] = []
    for c in sorted(cands, key=lambda c: (c.get("rank", 9), c.get("starts_utc") or "")):
        s = _utc(c.get("starts_utc"))
        hit = None
        for p in out:
            ps = _utc(p.get("starts_utc"))
            if not s or not ps:
                continue
            if abs((s - ps).total_seconds()) / 60 > SAME_START_MIN:
                continue
            if metres(p["lat"], p["lon"], c["lat"], c["lon"]) > SAME_M:
                continue
            hit = p
            break
        if hit:
            seen = {(x["channel"], x["msg_id"]) for x in hit["sources"]}
            hit["sources"] += [x for x in c["sources"] if (x["channel"], x["msg_id"]) not in seen]
            if hit.get("start_approx") and not c.get("start_approx"):
                hit["starts_utc"], hit["start_approx"] = c["starts_utc"], False
            continue
        out.append({**c, "sources": list(c["sources"])})
    return out


def _title(p: dict) -> str:
    what = (p.get("what") or "").strip() or KIND_WORD.get(p.get("kind") or "other", "a gathering")
    what = re.sub(r"^(?:a|an|the)\s+", "", what, flags=re.I)
    return f"{what[:1].upper()}{what[1:]} at {str(p.get('place') or '').split(',')[0]}"


def evidence_from_posts(posts: list[dict], announced: set) -> list[dict]:
    """Posts that say there is a crowd at a place the gazetteer knows (no
    model, no coordinates needed): "Plaza de Mayo llena", "on est 2000 à
    Répu", "mijëra para Kryeministrisë". Announcement posts are not
    evidence of anything having happened."""
    out = []
    for r in posts:
        k = (r.get("channel"), r.get("msg_id"))
        if k in announced:
            continue
        text = " ".join(x for x in (r.get("text"), r.get("summary_en")) if x)
        f = fold(text)[:2000]
        if not CROWD_ANY.search(f) and not DISPERSE_WORDS.search(f) and not _NOUN_RX.search(f):
            continue
        lat, lon = r.get("lat"), r.get("lon")
        pl = None
        if lat is None or (r.get("precision") or "") not in ("site", "street", "district"):
            pl = place_in(f, folded=True)
            if not pl:
                continue
            lat, lon = pl["lat"], pl["lon"]
        out.append({"at": r.get("posted_at"), "lat": lat, "lon": lon, "kind": "post",
                    "dispersal": bool(DISPERSE_WORDS.search(f)), "text": text[:600], "role": r.get("role"),
                    "title": r.get("headline") or text[:120], "post": f"{r.get('channel')}/{r.get('msg_id')}",
                    "url": None if str(r.get("channel")).startswith("c/") else f"https://t.me/{r.get('channel')}/{r.get('msg_id')}",
                    "source": f"Telegram · {r.get('channel_title') or r.get('channel')}"})
    return out


HUB_KEYS = {"starting", "ongoing", "dispersing"}


def hub_tracks(p: dict, st: dict, ev: list[dict], now: _dt.datetime, zone=None) -> dict:
    """While it goes on, the protest's card is the hub (owner, 2026-10-19:
    "while it's going on we want full coverage: videos, photos, messages,
    tracking, police movement, protester movement"): the crowd's movement
    linked from the reports near it (demonstrations.link_tracks), and the
    police's — from police_tracks.py when that module is deployed (another
    pass is writing it; its function is looked up, never assumed)."""
    out = {"crowd": [], "police": [], "police_note": None}
    if st.get("key") not in HUB_KEYS:
        return out
    try:
        import demonstrations as dm
        reps = [{"id": f"ev{i}-{e.get('post') or ''}", "lat": e["lat"], "lon": e["lon"], "at": e.get("at"),
                 "place": e.get("place") or "", "text": e.get("text") or e.get("title") or "", "title": e.get("title"),
                 "url": e.get("url"), "source": e.get("source"), "country": p.get("cc") or ""}
                for i, e in enumerate(ev) if not e.get("dispersal")]
        for t in dm.link_tracks(reps, now, lambda _cc: zone, min_nodes=2)[:4]:
            out["crowd"].append({"id": t["id"], "points": [{"lat": x["lat"], "lon": x["lon"], "at": x["at"]} for x in t["points"]],
                                 "last_at": t["last_at"], "hhmm": t["last"]["hhmm"], "n_reports": t["n_reports"],
                                 "heading_deg": t.get("heading_deg"), "distance_m": sum(s["distance_m"] for s in t["segments"])})
    except Exception as e:                                     # noqa: BLE001
        print(f"[protest-status] error: crowd tracks: {type(e).__name__}: {e}", flush=True)
    try:
        import importlib
        pt = importlib.import_module("police_tracks")
    except ImportError:
        out["police_note"] = "Police movement: not available here yet"
        return out
    fn = next((getattr(pt, n) for n in ("tracks_near", "near", "for_place") if callable(getattr(pt, n, None))), None)
    if fn is None:
        out["police_note"] = "Police movement: no tracks_near() in police_tracks"
        return out
    try:
        since = _utc(p.get("starts_utc")) - _dt.timedelta(minutes=EARLY_MIN) if p.get("starts_utc") else None
        got = fn(p["lat"], p["lon"], (p.get("radius_m") or RADIUS_DEFAULT_M) * 2, since) or []
        out["police"] = [t for t in got if isinstance(t, dict)][:6]
    except Exception as e:                                     # noqa: BLE001
        print(f"[protest-status] error: police tracks: {type(e).__name__}: {e}", flush=True)
    return out


def build(cands: list[dict], evidence: list[dict], now: _dt.datetime, zone_of=None,
          media_of=None, vision_of=None) -> list[dict]:
    """Candidates → protests with their status, crowd and media (pure but for
    the hooks: media_of(protest, now) → [media]; vision_of(protest, media) →
    {photos, low, high, pending}). Newest-relevant first: ongoing and
    starting, then planned soonest, then the ended ones."""
    out = []
    lo, hi = now - _dt.timedelta(hours=KEEP_PAST_H), now + _dt.timedelta(days=KEEP_AHEAD_D)
    for p in merge_protests(cands):
        s = _utc(p.get("starts_utc"))
        if not s or not (lo <= s <= hi):
            continue
        p = dict(p)
        p["radius_m"] = radius_for(p.get("kind") or "other")
        zone = None
        if zone_of:
            try:
                zone = zone_of(p.get("cc"), p.get("tz"))
            except Exception:                                  # noqa: BLE001
                zone = None
        st = status_of(p, evidence, now, zone)
        ev = near_evidence({**p, "_zone": zone}, evidence, now)
        figs = []
        for e in ev:
            for fg in crowd_figures(e.get("text"), e.get("role")):
                figs.append({**fg, "post": e.get("post"), "url": e.get("url"), "source": e.get("source"), "at": e.get("at")})
        media = media_of(p, st, now) if media_of else []
        hub = hub_tracks(p, st, ev, now, zone)
        vis = vision_of({**p, "status": st}, media) if vision_of else None
        crowd = crowd_estimate(figs, vis)
        start, end, approx = window(p)
        out.append({
            "id": p["id"], "kind": "protest", "what": p.get("what"), "act": p.get("kind"), "title": _title(p),
            "place": p.get("place"), "city": p.get("city"), "country_code": p.get("cc"),
            "lat": p["lat"], "lon": p["lon"], "radius_m": p["radius_m"], "tz": zone_name(zone),
            "starts_utc": iso(start), "start_approx": approx, "planned_end_utc": iso(end),
            "duration_basis": "stated" if p.get("ends_utc") else f"default for {KIND_WORD.get(p.get('kind') or 'other')}",
            "starts_label": (f"{day_label(start, now, zone)} {hhmm(start, zone)}" if not approx
                             else f"{day_label(start, now, zone)} (no time given)") if start else None,
            "status": st, "status_label": st["label"],
            "announced_at": min((x["posted_at"] for x in p["sources"] if x.get("posted_at")), default=None),
            "sources": p["sources"][:12], "n_sources": len(p["sources"]),
            "evidence": [{k: e.get(k) for k in ("at", "kind", "title", "url", "source", "distance_m", "dispersal")}
                         for e in reversed(ev)][:12],
            "media": media, "crowd": crowd, "crowd_tracks": hub["crowd"], "police_tracks": hub["police"],
            "police_note": hub["police_note"],
            "crowd_figures": [{k: f.get(k) for k in ("who", "low", "high", "value", "words", "url", "source", "at")} for f in figs][:12],
            "vision": vis, "note": NOTE,
        })
    order = {"ongoing": 0, "starting": 1, "dispersing": 2, "planned": 3, "ended": 4, "no_show": 5}
    out.sort(key=lambda x: (order.get(x["status"]["key"], 9),
                            x["starts_utc"] if x["status"]["key"] == "planned" else "",
                            "" if x["status"]["key"] == "planned" else str(-(_utc(x["starts_utc"]).timestamp()))))
    return out


# ── reads (blocking) ───────────────────────────────────────────────────────

def zone_of(cc: str | None, tz: str | None = None):
    try:
        import telegram_events as te
        return te.zone_for(tz, cc)
    except Exception:                                          # noqa: BLE001
        return None


def _zone_cc(cc):
    return zone_of(cc, None)


_READ_CACHE: dict = {}
ACT_WHAT = {"gather": "gathering", "march": "march", "block": "blockade", "occupy": "occupation", "attack": "action",
            "strike": "strike"}


def read_candidates(con, now: _dt.datetime, posts: list[dict]) -> list[dict]:
    """Announced protests from the announcement pass, the rule-read calls
    with a time, and this module's own rule reader."""
    out = []
    lo = (now - _dt.timedelta(hours=KEEP_PAST_H)).strftime("%Y-%m-%d")
    hi = (now + _dt.timedelta(days=KEEP_AHEAD_D)).strftime("%Y-%m-%d")
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute(
            "SELECT a.*, p.channel_title, p.text FROM telegram_announcements a"
            " JOIN telegram_posts p ON p.channel=a.channel AND p.msg_id=a.msg_id"
            " WHERE substr(a.starts_at,1,10) >= ? AND substr(a.starts_at,1,10) <= ? AND a.lat IS NOT NULL", (lo, hi)).fetchall()
    except sqlite3.OperationalError:
        rows = []
    for r in rows:
        r = dict(r)
        try:
            import telegram_events as te
            if not te.is_future(r["starts_at"], r["starts_utc"], r["posted_at"] or "", r["what"]):
                continue
        except Exception:                                      # noqa: BLE001
            pass
        start, approx = r.get("starts_utc"), False
        if not start:
            # a day without an hour: noon there, approximate
            z = zone_of(r.get("country"), r.get("tz")) or _dt.timezone.utc
            try:
                d = _dt.date.fromisoformat(str(r["starts_at"])[:10])
            except ValueError:
                continue
            start, approx = iso(_dt.datetime(d.year, d.month, d.day, 12, tzinfo=z)), True
        out.append({"id": f"pr-tga-{r['channel']}-{r['msg_id']}-{r['idx']}", "what": r.get("what"), "kind": kind_of(r.get("what")),
                    "place": r.get("place"), "city": (str(r.get("place") or "").split(",")[1].strip()
                                                      if len(str(r.get("place") or "").split(",")) >= 3 else None),
                    "cc": (r.get("country") or "").lower() or None, "tz": r.get("tz"),
                    "lat": r["lat"], "lon": r["lon"], "starts_utc": start, "start_approx": approx,
                    "sources": [_src(r, "announcement (model reading)")], "rank": 0})
    # calls with a time, read by rule at collection (telegram_signals)
    try:
        import telegram_signals as tsg
        for sig in tsg.signals_from(con, hours=KEEP_PAST_H + 24):
            it = sig.get("intent") or {}
            if sig.get("kind") != "intent" or not it.get("starts_utc"):
                continue
            if it.get("when_kind") == "now" and sig.get("n_messages", 0) < 2:
                continue                                       # one "go now" is a call, not an announced gathering
            lat, lon, place = sig.get("lat"), sig.get("lon"), sig.get("place")
            cc = sig.get("country_code")
            if lat is None:
                pl = place_in(sig.get("target") or place)
                if not pl:
                    continue
                lat, lon, place, cc = pl["lat"], pl["lon"], f"{pl['name']}, {pl['city']}", pl["cc"]
            out.append({"id": f"pr-{sig['id']}", "what": ACT_WHAT.get(it.get("act"), "gathering"),
                        "kind": kind_of(None, it.get("act")), "place": place, "city": None, "cc": cc,
                        "lat": lat, "lon": lon, "starts_utc": it["starts_utc"], "start_approx": it.get("when_kind") == "date",
                        "sources": [{"channel": s["channel"], "channel_title": s.get("channel_title"), "msg_id": s["msg_id"],
                                     "posted_at": s["posted_at"], "how": "call with a time (rule)", "text": s.get("text"),
                                     "url": s.get("url")} for s in sig.get("sources") or []][:12], "rank": 1})
    except Exception as e:                                     # noqa: BLE001
        print(f"[protest-status] error: intents: {type(e).__name__}: {e}", flush=True)
    # the multilingual rule reader, over the posts already read
    for r in posts:
        k = (r.get("channel"), r.get("msg_id"), len(r.get("text") or ""))
        hit = _READ_CACHE.get(k)
        if hit is None:
            hit = _READ_CACHE[k] = read_announcement(r.get("text"), r.get("posted_at"), _zone_cc) or False
            if len(_READ_CACHE) > 50_000:
                _READ_CACHE.clear()
        if not hit:
            continue
        pl = hit["place"]
        out.append({"id": f"pr-rule-{r['channel']}-{r['msg_id']}", "what": hit["what"], "kind": hit["kind"],
                    "place": f"{pl['name']}, {pl['city']}", "city": pl["city"], "cc": pl["cc"],
                    "lat": pl["lat"], "lon": pl["lon"], "starts_utc": hit["starts_utc"], "start_approx": hit["start_approx"],
                    "sources": [_src(r, "announcement (rule)")], "rank": 2})
    return out


def read_evidence(con, now: _dt.datetime, posts: list[dict], announced: set) -> list[dict]:
    """Everything that says people are (or were) on the ground, located."""
    ev = []
    ann_posts = {f"{a}/{b}" for a, b in announced}
    # street reports, fresh (they leave the map after their validity)
    try:
        import street_reports as srp
        for s in srp.signals(min(24.0, KEEP_PAST_H)):
            if s.get("lat") is None:
                continue
            ev.append({"at": s.get("at"), "lat": s["lat"], "lon": s["lon"], "kind": "street_report",
                       "dispersal": bool(DISPERSE_WORDS.search(fold(s.get("summary")))),
                       "title": s.get("title"), "url": s.get("url"), "source": "Street report · " + ", ".join(s.get("chats") or [])[:80],
                       "text": " ".join(x.get("text") or "" for x in s.get("sources") or [])[:1200],
                       "post": f"{s['sources'][-1]['channel']}/{s['sources'][-1]['msg_id']}" if s.get("sources") else None})
    except Exception as e:                                     # noqa: BLE001
        print(f"[protest-status] error: street reports: {type(e).__name__}: {e}", flush=True)
    # located crowd reports and live developments
    try:
        import demonstrations as dm
        for r in dm.read_reports(now, KEEP_PAST_H):
            if r.get("post") in ann_posts:
                continue
            ev.append({"at": r["at"], "lat": r["lat"], "lon": r["lon"], "kind": "crowd_report",
                       "dispersal": bool(DISPERSE_WORDS.search(fold(r.get("text")))), "title": r.get("title"),
                       "url": r.get("url"), "source": r.get("source"), "text": r.get("text"), "post": r.get("post")})
    except Exception as e:                                     # noqa: BLE001
        print(f"[protest-status] error: crowd reports: {type(e).__name__}: {e}", flush=True)
    # self-reported positions ("on est à Concorde")
    try:
        cutoff = (now - _dt.timedelta(hours=KEEP_PAST_H)).isoformat()
        for r in con.execute("SELECT i.channel, i.msg_id, i.lat, i.lon, i.place, i.at_time, i.posted_at, p.text, p.channel_title"
                             " FROM telegram_intents i JOIN telegram_posts p ON p.channel=i.channel AND p.msg_id=i.msg_id"
                             " WHERE i.kind='at' AND i.lat IS NOT NULL AND i.posted_at >= ?", (cutoff,)):
            r = dict(r)
            ev.append({"at": r.get("at_time") or r["posted_at"], "lat": r["lat"], "lon": r["lon"], "kind": "position",
                       "dispersal": False, "title": f"People there say they are at {str(r.get('place') or '').split(',')[0]}",
                       "url": None if str(r["channel"]).startswith("c/") else f"https://t.me/{r['channel']}/{r['msg_id']}",
                       "source": f"Telegram · {r.get('channel_title') or r['channel']}", "text": r.get("text"),
                       "post": f"{r['channel']}/{r['msg_id']}", "role": "group"})
    except sqlite3.OperationalError:
        pass
    # posts that name the place and say there is a crowd (any language, no model)
    ev += evidence_from_posts(posts, announced)
    return ev


def read_posts(con, now: _dt.datetime) -> list[dict]:
    cutoff = (now - _dt.timedelta(hours=KEEP_PAST_H + 24)).isoformat()
    cols = {r[1] for r in con.execute("PRAGMA table_info(telegram_posts)")}
    want = ["channel", "msg_id", "channel_title", "posted_at", "text", "summary_en", "headline", "media", "thumb",
            "lat", "lon", "place", "precision", "country_code", "role"]
    sel = ", ".join(c if c in cols else f"NULL AS {c}" for c in want)
    prev = con.row_factory
    con.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in con.execute(
            f"SELECT {sel} FROM telegram_posts WHERE posted_at >= ? AND COALESCE(role,'') != 'ignore'"
            " ORDER BY posted_at LIMIT 20000", (cutoff,))]
    finally:
        con.row_factory = prev


_memo: dict = {}
_memo_lock = threading.Lock()


def in_windows(posts: list[dict], cands: list[dict], now: _dt.datetime) -> list[dict]:
    """The posts written while some protest could have been happening (from
    6 h before its start to 18 h after): only they can be its evidence or
    its footage, and most posts are not."""
    wins = []
    for c in cands:
        s = _utc(c.get("starts_utc"))
        if s and s - _dt.timedelta(hours=6) <= now:
            wins.append((s - _dt.timedelta(hours=6), s + _dt.timedelta(hours=18)))
    if not wins:
        return []
    out = []
    for r in posts:
        t = _utc(r.get("posted_at"))
        if t and any(a <= t <= b for a, b in wins):
            out.append(r)
    return out


def compute(now: _dt.datetime) -> dict:
    import protest_media as pm
    import telegram_events as te
    con = te._con()
    try:
        posts = read_posts(con, now)
        cands = read_candidates(con, now, posts)
        announced = {(x["channel"], x["msg_id"]) for c in cands for x in c["sources"]}
        near = in_windows(posts, cands, now)
        ev = read_evidence(con, now, near, announced)
    finally:
        con.close()
    media_pool = pm.media_pool(near, now)
    protests = build(cands, ev, now, zone_of,
                     media_of=lambda p, st, t: pm.link_media(p, st, media_pool, t),
                     vision_of=pm.vision_for)
    return {"generated_at": iso(now), "protests": protests, "note": NOTE,
            "params": {"fresh_min": FRESH_MIN, "starting_min": STARTING_MIN, "keep_past_h": KEEP_PAST_H,
                       "default_duration_min": DEFAULT_DURATION_MIN}}


def snapshot(now: _dt.datetime | None = None) -> dict:
    """Every announced protest of the last KEEP_PAST_H hours and the next
    KEEP_AHEAD_D days with its status, media and crowd; memoised MEMO_S."""
    if now is None:
        with _memo_lock:
            hit = _memo.get("v")
            if hit and time.time() - hit[0] < MEMO_S:
                return hit[1]
    out = compute(now or _dt.datetime.now(_dt.timezone.utc))
    if now is None:
        with _memo_lock:
            _memo["v"] = (time.time(), out)
    return out


def by_post() -> dict:
    """{(channel, msg_id): protest} for every post behind a protest — for a
    feed item or a notification to carry the protest's status."""
    try:
        snap = snapshot()
    except Exception as e:                                     # noqa: BLE001
        print(f"[protest-status] error: snapshot: {type(e).__name__}: {e}", flush=True)
        return {}
    out = {}
    for p in snap["protests"]:
        for s in p["sources"]:
            out.setdefault((s["channel"], s["msg_id"]), p)
    return out


# ── calls to gather expire with their protest ──────────────────────────────
# Owner, 2026-10-19: "Why am I still getting signals on the map about calls
# to gather at places that already passed? Once the demonstration is over we
# don't want the signal anymore." Every layer and feed fed by a call (the
# unified Telegram calls, the city situation's targets and routes, the
# announced hazards, the notifications) asks call_live() on read: a call
# that belongs to a protest lives as long as the protest is not Ended / No
# sign it happened; one that belongs to none lives until its own clock runs
# out (call_end). Nothing is deleted: the posts stay, the signal goes.

CALL_NO_TIME_H = 12          # a call that says no time: 12 h after it was posted
CALL_GRACE_MIN = 60          # a timed call: its default length, and an hour
POSITION_H = 6               # "on est à Concorde" says nothing about tomorrow
OVER = {"ended", "no_show"}
LIVE = {"starting", "ongoing", "dispersing"}


def call_end(starts_utc=None, when_kind: str | None = None, posted_at=None, act: str | None = None,
             zone=None) -> _dt.datetime | None:
    """When a call stops being news by the clock alone: a day without an hour
    at the end of that day there; a time (or "now", "in 30 min") after the
    gathering's default length and an hour; no time at all, CALL_NO_TIME_H
    after it was posted."""
    start, posted = _utc(starts_utc), _utc(posted_at)
    if start and when_kind == "date":
        z = zone or _dt.timezone.utc
        d = start.astimezone(z).date()
        return _dt.datetime(d.year, d.month, d.day, 23, 59, tzinfo=z)
    if start:
        return start + _dt.timedelta(minutes=DEFAULT_DURATION_MIN.get(kind_of(None, act), 150) + CALL_GRACE_MIN)
    if posted:
        return posted + _dt.timedelta(hours=CALL_NO_TIME_H)
    return None


def protest_of_call(keys: set, lat, lon, protests: list[dict]) -> dict | None:
    """The protest a call stands for: one of its posts is behind the protest;
    else a protest under way at the same place (the call is part of it)."""
    for p in protests:
        if any((s.get("channel"), s.get("msg_id")) in keys for s in p.get("sources") or []):
            return p
    if lat is not None:
        for p in protests:
            if (p.get("status") or {}).get("key") in LIVE and metres(p["lat"], p["lon"], lat, lon) <= SAME_M:
                return p
    return None


def call_live(*, keys: set = frozenset(), lat=None, lon=None, starts_utc=None, when_kind=None, posted_at=None,
              act=None, cc=None, now: _dt.datetime | None = None, protests: list[dict] | None = None) -> tuple[bool, dict | None]:
    """(still news?, its protest or None)."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    p = protest_of_call(set(keys), lat, lon, protests or [])
    if p is not None:
        return (p.get("status") or {}).get("key") not in OVER, p
    end = call_end(starts_utc, when_kind, posted_at, act, zone_of(cc) if when_kind == "date" else None)
    return (end is None or now <= end), None


def live_signals(sigs: list[dict], now: _dt.datetime | None = None, protests: list[dict] | None = None) -> list[dict]:
    """telegram_signals' unified signals still worth showing: calls by
    call_live (each matched one carries its protest's status), positions
    for POSITION_H."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    if not sigs:
        return []
    if protests is None:
        protests = _protests()
    out = []
    for s in sigs:
        if s.get("kind") == "at":
            last = _utc(s.get("last_at"))
            if last and (now - last).total_seconds() <= POSITION_H * 3600:
                out.append(s)
            continue
        it = s.get("intent") or {}
        keys = {(x.get("channel"), x.get("msg_id")) for x in s.get("sources") or []}
        live, p = call_live(keys=keys, lat=s.get("lat"), lon=s.get("lon"), starts_utc=it.get("starts_utc"),
                            when_kind=it.get("when_kind"), posted_at=it.get("posted_at") or s.get("last_at"),
                            act=it.get("act"), cc=s.get("country_code"), now=now, protests=protests)
        if not live:
            continue
        if p is not None:
            s = {**s, "protest_status": status_brief(p)}
        out.append(s)
    return out


def _protests() -> list[dict]:
    try:
        return snapshot()["protests"]
    except Exception as e:                                     # noqa: BLE001
        print(f"[protest-status] error: snapshot for calls: {type(e).__name__}: {e}", flush=True)
        return []


def status_brief(p: dict) -> dict:
    """What a feed item or a card carries of a protest."""
    return {"id": p["id"], "key": p["status"]["key"], "label": p["status_label"], "since": p["status"].get("since"),
            "until": p["status"].get("until"), "starts_utc": p.get("starts_utc"), "start_approx": p.get("start_approx"),
            "last_report_at": p["status"].get("last_report_at"), "tz": p.get("tz"),
            "crowd": (p.get("crowd") or {}).get("label"), "n_media": len(p.get("media") or [])}


def annotate(items: list[dict]) -> list[dict]:
    """Adds `protest_status` to items (announcements, feed posts) that stand
    for an announced protest: the status replaces "announced 14 h ago"."""
    try:
        idx = by_post()
    except Exception:                                          # noqa: BLE001
        return items
    if not idx:
        return items
    for it in items:
        k = (it.get("channel"), it.get("msg_id"))
        p = idx.get(k)
        if p:
            it["protest_status"] = status_brief(p)
    return items
