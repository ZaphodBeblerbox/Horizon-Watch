"""
event_cluster.py — one event, one signal.

The owner's example (2026-10-11): one Houthi attack on a Saudi airport
arrived as "12 people killed in Saudi airport attack", "Houthis claim
responsibility", "Houthis attack Saudi airport" and "Riyadh airport
attack" — four cards for one thing. This groups items that are the same
event and keeps one headline, with the others attached as "also reported"
(count + sources), so nothing is lost and nothing is said four times.

Used by the General desk (general_feed.feed) and the notification feed
(main._notification_feed). Pure and cheap: a token heuristic over a few
hundred items already in memory — no embeddings, no I/O, no table scans.

SAME EVENT means all of:
  * close in time — within WINDOW_H of the cluster's first report;
  * the same place — both located and within RADIUS_KM (PRECISE_RADIUS_KM
    when both points are precise, e.g. two GeoConfirmed pins: a front line
    has dozens of separate verified strikes within 40 km in a day), or, when
    a side has no coordinates, the same country (or unknown) AND shared
    names with none of its own the other lacks;
  * the same thing happened — the headlines share an act (attack/strike/hit
    are one act; heat/smoke/fire are one; see _ACTS), and enough of the
    smaller report is contained in the other; an unplaced report may join on
    names alone when it adds nothing new ("Houthis claim responsibility").
Each newcomer is compared with every report already in the event, never
with the event's pooled words, which would grow until they swallowed a city.
And never: two located items further apart than the radius, two countries,
two different named places with none in common, or two different tracked
entities (two sanctioned ships in the same strait are two signals).
"""
from __future__ import annotations

import math
import re
from datetime import datetime, timezone

WINDOW_H = 12.0
RADIUS_KM = 40.0
PRECISE_RADIUS_KM = 3.0

_SEV_RANK = {"critical": 5, "high": 4, "significant": 4, "elevated": 3, "moderate": 2, "medium": 2, "low": 1, "info": 0}

# WHAT HAPPENED, as concepts: "attack", "strike" and "hits" are one act, and
# "heat", "smoke plume" and "fire" are one. Two reports of one event share an
# act; sharing only a city ("Kyiv") or a target word ("power") is not enough —
# measured on real Telegram, that chained an air-raid alert, a robbery arrest
# and power cuts across a night into one card.
_ACTS = {
    "attack": ("attack", "attacks", "attacked", "attacking", "strike", "strikes", "struck", "striking", "airstrike",
               "airstrikes", "hit", "hits", "bomb", "bombs", "bombed", "bombing", "shelling", "shelled", "shell",
               "raid", "raids", "assault", "target", "targeted", "targets", "targeting"),
    "drone": ("drone", "drones", "uav", "uavs", "shahed", "shaheds", "geran", "fpv"),
    "missile": ("missile", "missiles", "rocket", "rockets", "ballistic", "cruise"),
    "explosion": ("explosion", "explosions", "blast", "blasts", "explode", "exploded", "detonation"),
    "fire": ("fire", "fires", "heat", "smoke", "plume", "blaze", "burn", "burning", "burned"),
    "casualty": ("kill", "kills", "killed", "killing", "dead", "death", "deaths", "die", "died", "casualty",
                 "casualties", "wound", "wounded", "injure", "injured", "injuries", "injures"),
    "shooting": ("shoot", "shooting", "shot", "gunfire", "gunmen"),
    "clash": ("clash", "clashes", "fighting", "battle"),
    "downing": ("intercept", "intercepted", "downed", "shot down", "crash", "crashed"),
    "seizure": ("seize", "seized", "hijack", "hijacked", "capture", "captured", "expel", "expelled", "retake", "liberation"),
    "sinking": ("sink", "sank", "sunk", "capsize", "capsized"),
    "loiter": ("loiter", "loitering"),
    "sanction": ("sanction", "sanctioned", "sanctions"),
    "protest": ("protest", "protests", "riot", "riots"),
    "arrest": ("arrest", "arrests", "arrested", "detained"),
    "evacuation": ("evacuate", "evacuated", "evacuation"),
}
_ACT_OF = {w: c for c, ws in _ACTS.items() for w in ws}
EVENT_WORDS = set(_ACTS)
# Words that say nothing about WHICH event: dropped before comparing.
_STOP = {
    "the", "a", "an", "of", "in", "on", "at", "to", "for", "by", "with", "from", "and", "or", "as", "is", "are", "was",
    "were", "be", "been", "has", "have", "had", "it", "its", "this", "that", "these", "those", "after", "before",
    "over", "near", "into", "about", "against", "amid", "says", "said", "say", "report", "reported", "reportedly",
    "claim", "claims", "claimed", "responsibility", "official", "officials", "according", "new", "latest", "update",
    "breaking", "people", "least", "more", "than", "his", "her", "their", "they", "he", "she", "we", "you", "not",
    "no", "but", "who", "what", "which", "where", "when", "how", "also", "just", "now", "today", "yesterday",
    "point", "view", "direction", "since", "last", "pass", "km", "h", "via", "per", "up", "out", "off",
}
_ALIAS = {"airports": "airport", "ports": "port", "bases": "base", "ships": "ship", "tankers": "tanker",
          "vessels": "vessel", "houthi": "houthis"}
_WORD = re.compile(r"[^\W\d_][\w'’-]*", re.U)


def _norm(w: str) -> str:
    w = w.lower().strip("'’-")
    return _ACT_OF.get(w) or _ALIAS.get(w, w)


def tokens(text: str) -> tuple[set, set]:
    """(names, words): capitalised words that are not sentence-initial-only
    function words are names (actors and places); the rest are content."""
    names, words = set(), set()
    for m in _WORD.finditer(str(text or "")):
        raw = m.group(0)
        w = _norm(raw)
        if len(w) < 3 or w in _STOP:
            continue
        if raw[:1].isupper() and w not in EVENT_WORDS:
            names.add(w)
        else:
            words.add(w)
    return names, words


def _ts(v) -> float | None:
    if v in (None, ""):
        return None
    if isinstance(v, datetime):
        d = v
    else:
        try:
            d = datetime.fromisoformat(str(v).replace("Z", "+00:00").replace(" ", "T"))
        except ValueError:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.timestamp()


def _num(v):
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _km(a, b) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371.0 * math.asin(min(1.0, math.sqrt(h)))


def _cc(v) -> str:
    return str(v or "").strip().lower()[:3]


class _Item:
    __slots__ = ("d", "t", "pt", "precise", "cc", "names", "words", "acts", "places", "entity", "sev", "info")

    def __init__(self, d: dict, f: dict):
        self.d = d
        self.t = _ts(d.get(f["at"]))
        la, lo = _num(d.get("lat")), _num(d.get("lon"))
        self.pt = (la, lo) if la is not None and lo is not None and not (la == 0 and lo == 0) else None
        self.precise = bool(d.get("precise"))
        self.cc = _cc(d.get("country_code"))
        text = " ".join(str(d.get(k) or "") for k in f["text"])
        self.names, self.words = tokens(text)
        # the act is read from the headline only: a summary's "after
        # attacking him" must not make a robbery one more report of a strike
        self.acts = tokens(d.get(f["text"][0]))[1] & EVENT_WORDS
        place = str(d.get("place") or d.get("region") or "")
        self.places = {_norm(w) for w in _WORD.findall(place) if len(w) >= 3} - _STOP
        self.names |= self.places
        self.entity = str(d.get("entity_id") or "").strip() or None
        self.sev = _SEV_RANK.get(str(d.get(f["sev"]) or "").lower(), 1)
        # informative: names and content words, and a number (a casualty count)
        self.info = len(self.names) * 2 + len(self.words) + (2 if re.search(r"\d", str(d.get(f["text"][0]) or "")) else 0)


class _Cluster:
    def __init__(self, it: _Item):
        self.items = [it]
        self.t0 = it.t
        self.pts = [it.pt] if it.pt else []
        self.names = set(it.names)
        self.words = set(it.words)
        self.ccs = {it.cc} if it.cc else set()
        self.entities = {it.entity} if it.entity else set()

    def add(self, it: _Item):
        self.items.append(it)
        if it.pt:
            self.pts.append(it.pt)
        self.names |= it.names
        self.words |= it.words
        if it.cc:
            self.ccs.add(it.cc)
        if it.entity:
            self.entities.add(it.entity)


def _pair(a: _Item, b: _Item, lim: float) -> float:
    """How strongly `a` reads as another report of `b`'s event; 0 = not."""
    shared_names = a.names & b.names
    shared_words = a.words & b.words
    shared_acts = a.acts & b.acts
    wa, wb = len(a.names) * 2 + len(a.words), len(b.names) * 2 + len(b.words)
    if not wa or not wb:
        return 0.0
    contain = (len(shared_names) * 2 + len(shared_words)) / min(wa, wb)
    if a.pt and b.pt:
        if _km(a.pt, b.pt) > lim:
            return 0.0
        if a.entity and a.entity == b.entity:
            return 1.0 + contain                   # the same ship, the same aircraft
        # the same place is not enough: the same thing must have happened —
        # except two pinned points a few km apart that describe the same
        # site (two views of one burning data centre: "a glow and a smoke
        # plume", "an explosion")
        if a.precise and b.precise and contain >= 0.4:
            return contain
        return contain if shared_acts and contain >= 0.3 else 0.0
    # One side unplaced: it must name something the other names, and name
    # nothing the other does not (or the reverse) — "drone attack on
    # Kharkiv" and "drone attack on Odesa" share every word but the place.
    if not shared_names or not (a.names <= b.names or b.names <= a.names):
        return 0.0
    return contain if contain >= 0.5 or (shared_acts and contain >= 0.34) else 0.0


def _match(c: _Cluster, it: _Item, window_h: float, radius_km: float, precise_km: float) -> float:
    """Against each report already in the event, not the event's pooled
    words: a pooled bag grows with every report and swallows the night."""
    if it.t is None or c.t0 is None or abs(it.t - c.t0) > window_h * 3600:
        return 0.0
    if it.entity and c.entities and it.entity not in c.entities:
        return 0.0                                 # two ships, two aircraft: two signals
    if it.cc and c.ccs and it.cc not in c.ccs:
        return 0.0
    lim = precise_km if it.precise and all(x.precise for x in c.items if x.pt) else radius_km
    if it.pt and c.pts and min(_km(it.pt, p) for p in c.pts) > lim:
        return 0.0                                 # never across places
    return max(_pair(it, m, lim) for m in c.items)


def cluster(items: list[dict], *, at: str = "at", text=("headline", "text"), sev: str = "severity",
            prefer: str = "informative", window_h: float = WINDOW_H, radius_km: float = RADIUS_KM,
            precise_km: float = PRECISE_RADIUS_KM, source_of=None, key: str = "id") -> list[dict]:
    """Group `items` (dicts) into events. Returns one dict per event — the
    headline item, copied, with `also` (the other reports: id, headline,
    source, at, kind) and `also_count`, `also_sources` set when it absorbed any.

    prefer="informative": headline is the most severe, then most informative.
    prefer="first": the most severe, then the earliest — a stable choice, for
    notifications, whose id must not change as later reports arrive.
    Order: as given, by each event's position of its headline.
    """
    f = {"at": at, "text": tuple(text) if not isinstance(text, str) else (text,), "sev": sev}
    src = source_of or (lambda d: d.get("source") or d.get("kind") or "")
    wrapped = [_Item(d, f) for d in items if isinstance(d, dict)]
    order = sorted(range(len(wrapped)), key=lambda i: wrapped[i].t if wrapped[i].t is not None else float("inf"))
    clusters: list[_Cluster] = []
    for i in order:
        it = wrapped[i]
        best, best_score = None, 0.0
        if it.t is not None:
            for c in clusters:
                score = _match(c, it, window_h, radius_km, precise_km)
                if score > best_score:
                    best, best_score = c, score
        if best is not None:
            best.add(it)
        else:
            clusters.append(_Cluster(it))

    pos = {id(w): n for n, w in enumerate(wrapped)}
    out = []
    for c in clusters:
        if prefer == "first":
            head = max(c.items, key=lambda x: (x.sev, -(x.t or 0)))
        else:
            head = max(c.items, key=lambda x: (x.sev, x.info, x.t or 0))
        row = dict(head.d)
        rest = [x for x in c.items if x is not head]
        if rest:
            rest.sort(key=lambda x: x.t or 0, reverse=True)
            row["also"] = [{"id": x.d.get(key), "headline": x.d.get(f["text"][0]), "source": src(x.d),
                            "at": x.d.get(at), "kind": x.d.get("kind"),
                            **({"at_precision": x.d["at_precision"]} if x.d.get("at_precision") else {})} for x in rest]
            row["also_count"] = len(rest)
            sources = []
            for x in rest:
                s = src(x.d)
                if s and s not in sources:
                    sources.append(s)
            row["also_sources"] = sources
        out.append((pos[id(head)], row))
    out.sort(key=lambda p: p[0])
    return [r for _, r in out]


def also_line(row: dict, limit: int = 3) -> str:
    """'+3 more reports (Telegram, GeoConfirmed)' — for a notification body."""
    n = row.get("also_count") or 0
    if not n:
        return ""
    srcs = [s for s in (row.get("also_sources") or []) if s][:limit]
    word = "report" if n == 1 else "reports"
    return f"+{n} more {word}" + (f" ({', '.join(srcs)})" if srcs else "")
