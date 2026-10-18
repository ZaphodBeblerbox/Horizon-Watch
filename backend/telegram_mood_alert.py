"""
telegram_mood_alert.py — a signal when people on Telegram call more and
more for armed conflict about a country.

The owner (2026-10-11): "When the Telegram sentiment for a country that is
in relation to one of our assets or our theatres says that people are
calling increasingly for tension or armed conflict, that also needs to be a
signal, and that needs to be indicated."

WHAT IS COUNTED. Nothing new is asked of a model: every post is already
rated once by telegram_sentiment.py (tension 0–3, mobilise 0–3, the country
it is about). A post is a CALL FOR CONFLICT when, in its own voice, it
  - calls to confront, attack, riot or take up arms, or praises violence
    as the way (mobilise 3), or
  - speaks in rage, dehumanising language or threats (tension 3), or
  - is hostile or calls to act (tension 2 or mobilise 2) AND uses the
    vocabulary of war, retaliation, revenge, jihad or military
    mobilisation (CONFLICT_WORDS, in EN/AR/RU/UK/FR, matched on the
    English summary and the original text).
A protest call (mobilise 2 without that vocabulary) is not one.

THE INDICATOR, per country (mood_country):
  rate_24h   calls / rated posts in the last 24 h
  base_rate  calls / rated posts over the 14 days before that, floored at
             RATE_FLOOR (a quiet baseline must not turn 1 call into ∞×)
  ratio      rate_24h / base_rate
  z          binomial z of the 24 h calls against the base rate
Copies of one post (a forward across channels) count once, so one viral
post cannot make a rise.

THE SIGNAL, at most one per country per COOLDOWN_H, re-raised only if it
climbs a further RERAISE_FACTOR× (or turns critical):
  high      ≥ MIN_CALLS distinct calls from ≥ MIN_CHANNELS channels, no
            channel more than MAX_CHANNEL_SHARE of them, ≥ MIN_BASE_POSTS
            in the baseline, ratio ≥ MIN_RATIO and z ≥ MIN_Z
  critical  also ratio ≥ 4, ≥ 20 calls from ≥ 6 channels, and the 24 h
            before were already ≥ 2× (sustained, not one bad evening)

WHOM IT REACHES. The alert is written for every country with a rise (the
record, the map, the General desk). A notification goes only to the people
it concerns — an asset in that country, a theater over it, or the country
among their interests — and says which (concern_reason); a critical one
reaches everyone, like every critical.
"""
from __future__ import annotations

import datetime as _dt
import json
import math
import re
import threading
import time
from collections import Counter

ALERT_TYPE = "Telegram mood: calls for conflict rising"
SOURCE = "telegram"

RECENT_H = 24
BASE_DAYS = 14
RATE_FLOOR = 0.02
MIN_CALLS = 8
MIN_CHANNELS = 3
MAX_CHANNEL_SHARE = 0.6
MIN_BASE_POSTS = 20
MIN_RATIO = 2.0
MIN_Z = 2.5
CRIT_RATIO = 4.0
CRIT_CALLS = 20
CRIT_CHANNELS = 6
COOLDOWN_H = 24
RERAISE_FACTOR = 1.5

CONFLICT_WORDS = re.compile(
    r"retaliat|reveng|aveng|take up arms|to arms\b|declare[sd]? war|holy war|jihad|"
    r"wipe (?:them|it|\w+) (?:out|off)|annihilat|exterminat|death to\b|strike back|hit back|"
    r"must (?:strike|attack|destroy|respond militarily)|all-out war|full-scale war|go to war|"
    r"(?:general|military) mobili[sz]ation|mobili[sz]e (?:the )?(?:army|troops|reserv)|"
    # Arabic
    r"ثأر|انتقام|جهاد|النفير|حمل السلاح|إعلان الحرب|الموت ل|"
    # Russian
    r"отомст|возмезд|месть|к оружию|мобилизац|объявить войну|священн\w* войн|смерть\s|ответный удар|"
    # Ukrainian
    r"помст|відплат|до зброї|мобіліз|оголосити війну|удар у відповідь|"
    # French
    r"vengeance|venger|représailles|aux armes|prendre les armes|mobilisation générale|"
    r"déclarer la guerre|guerre sainte|mort aux?\s|"
    # Spanish (Venezuela)
    r"venganza|vengar|a las armas|tomar las armas|declarar la guerra|muerte a\s|guerra total",
    re.IGNORECASE)


def is_conflict_call(row) -> bool:
    m = _int(row["mood_mobilise"])
    t = _int(row["mood_tension"])
    if m >= 3 or t >= 3:
        return True
    if m >= 2 or t >= 2:
        text = f"{_get(row, 'summary_en') or ''} {_get(row, 'text') or ''}"
        return bool(CONFLICT_WORDS.search(text))
    return False


def _int(v) -> int:
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        return 0


def _get(row, k):
    try:
        return row[k]
    except (KeyError, IndexError):
        return None


def _key(row) -> str:
    """Copies of one post read alike: the first 100 letters of what it says."""
    s = str(_get(row, "summary_en") or _get(row, "text") or "").lower()
    return re.sub(r"\W+", "", s)[:100] or f"{row['channel']}/{row['msg_id']}"


def _utc(s) -> _dt.datetime | None:
    try:
        d = _dt.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=_dt.timezone.utc)


# ── the indicator ──────────────────────────────────────────────────────────

def _window(rows) -> dict:
    n, calls, chans, seen = 0, [], Counter(), set()
    for r in rows:
        n += 1
        if not is_conflict_call(r):
            continue
        k = _key(r)
        chans[r["channel_title"] or r["channel"]] += 0      # every channel that carried one
        if k in seen:
            continue
        seen.add(k)
        calls.append(r)
        chans[r["channel_title"] or r["channel"]] += 1
    return {"n": n, "calls": calls, "channels": chans}


def indicator(cc: str, rows: list, now: _dt.datetime | None = None) -> dict:
    """The calls-for-conflict reading for one country, from its rated posts
    (each a mapping with channel, msg_id, channel_title, posted_at, text,
    summary_en, mood_tension, mood_mobilise)."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    t24 = now - _dt.timedelta(hours=RECENT_H)
    t48 = now - _dt.timedelta(hours=2 * RECENT_H)
    t0 = t24 - _dt.timedelta(days=BASE_DAYS)
    recent, prev, base = [], [], []
    days = {(now - _dt.timedelta(days=BASE_DAYS - 1 - i)).strftime("%Y-%m-%d"): [] for i in range(BASE_DAYS)}
    for r in rows:
        at = _utc(r["posted_at"])
        if at is None or at > now:
            continue
        if at >= t24:
            recent.append(r)
        elif at >= t0:
            base.append(r)
            if at >= t48:
                prev.append(r)
        d = at.strftime("%Y-%m-%d")
        if d in days:
            days[d].append(r)
    w, b, p = _window(recent), _window(base), _window(prev)
    calls = len(w["calls"])
    rate = calls / w["n"] if w["n"] else 0.0
    base_raw = len(b["calls"]) / b["n"] if b["n"] else None
    base_rate = max(base_raw or 0.0, RATE_FLOOR)
    ratio = rate / base_rate if w["n"] else 0.0
    z = ((calls - w["n"] * base_rate) / math.sqrt(w["n"] * base_rate * (1 - base_rate))) if w["n"] else 0.0
    prev_rate = len(p["calls"]) / p["n"] if p["n"] else 0.0
    by_chan = Counter({k: v for k, v in w["channels"].items() if v})
    top_share = (by_chan.most_common(1)[0][1] / calls) if calls else 0.0
    n_channels = len(w["channels"])

    checks = {
        "volume": calls >= MIN_CALLS,
        "channels": n_channels >= MIN_CHANNELS and top_share <= MAX_CHANNEL_SHARE,
        "baseline": b["n"] >= MIN_BASE_POSTS,
        "ratio": ratio >= MIN_RATIO,
        "z": z >= MIN_Z,
    }
    rising = all(checks.values())
    critical = (rising and ratio >= CRIT_RATIO and calls >= CRIT_CALLS and n_channels >= CRIT_CHANNELS
                and p["n"] > 0 and prev_rate / base_rate >= MIN_RATIO)
    series = []
    for d, rs in days.items():
        ww = _window(rs)
        series.append({"date": d, "n": ww["n"], "calls": len(ww["calls"]),
                       "rate": round(len(ww["calls"]) / ww["n"], 3) if ww["n"] else None})
    examples = sorted(w["calls"], key=lambda r: str(r["posted_at"]), reverse=True)
    picked, used = [], set()
    for r in examples:                                   # three, from different channels first
        ch = r["channel_title"] or r["channel"]
        if ch in used and len({x["channel_title"] or x["channel"] for x in examples}) > len(used):
            continue
        used.add(ch)
        picked.append(r)
        if len(picked) == 3:
            break
    return {
        "country": cc.lower(),
        "n_24h": w["n"], "calls_24h": calls, "rate_24h": round(rate, 3),
        "channels_24h": n_channels, "top_channel_share": round(top_share, 2),
        "n_base": b["n"], "calls_base": len(b["calls"]),
        "base_rate": round(base_raw, 3) if base_raw is not None else None, "base_rate_used": round(base_rate, 3),
        "ratio": round(ratio, 1), "z": round(z, 1),
        "prev_24h": {"n": p["n"], "calls": len(p["calls"]), "ratio": round(prev_rate / base_rate, 1) if p["n"] else None},
        "checks": checks, "rising": rising, "severity": ("critical" if critical else "high") if rising else None,
        "series": series,
        "top_channels": [{"channel": c, "calls": k} for c, k in by_chan.most_common(5)],
        "examples": [{"id": f"{r['channel']}/{r['msg_id']}", "channel": r["channel_title"] or r["channel"],
                      "posted_at": str(r["posted_at"]),
                      "text": str(_get(r, "summary_en") or _get(r, "text") or "")[:240],
                      "url": None if str(r["channel"]).startswith("c/") else f"https://t.me/{r['channel']}/{r['msg_id']}"}
                     for r in picked],
    }


def _rows_since(since: _dt.datetime) -> list:
    import sqlite3
    import telegram_sentiment as ts
    con = ts._con()
    con.row_factory = sqlite3.Row
    try:
        return con.execute(
            "SELECT channel, msg_id, channel_title, posted_at, text, summary_en, mood_country, mood_tension,"
            " mood_mobilise FROM telegram_posts WHERE mood_checked=1 AND mood_country IS NOT NULL AND posted_at >= ?",
            (since.strftime("%Y-%m-%d"),)).fetchall()
    finally:
        con.close()


_eval_cache: dict = {"at": 0.0, "data": None}
_eval_lock = threading.Lock()
EVAL_TTL_S = 300


def evaluate(now: _dt.datetime | None = None, rows=None) -> dict:
    """{country: indicator} for every country with a rated post in the last
    24 h or the two weeks before. Cached five minutes when read live."""
    live = now is None and rows is None
    if live:
        with _eval_lock:
            if _eval_cache["data"] is not None and time.time() - _eval_cache["at"] < EVAL_TTL_S:
                return _eval_cache["data"]
    now = now or _dt.datetime.now(_dt.timezone.utc)
    if rows is None:
        rows = _rows_since(now - _dt.timedelta(hours=RECENT_H, days=BASE_DAYS + 1))
    by: dict[str, list] = {}
    for r in rows:
        cc = str(r["mood_country"] or "").lower()
        if len(cc) == 2:
            by.setdefault(cc, []).append(r)
    out = {cc: indicator(cc, rs, now) for cc, rs in by.items()}
    if live:
        with _eval_lock:
            _eval_cache.update(at=time.time(), data=out)
    return out


def summary(ind: dict | None) -> dict | None:
    """What the mood list carries per country: the reading and a small series."""
    if not ind:
        return None
    return {k: ind[k] for k in ("rising", "severity", "ratio", "z", "calls_24h", "n_24h", "rate_24h",
                                "channels_24h", "base_rate", "n_base")} | {
        "series": [{"date": d["date"], "calls": d["calls"], "rate": d["rate"]} for d in ind["series"]],
        "examples": ind["examples"], "top_channels": ind["top_channels"][:3]}


# ── where a country is ────────────────────────────────────────────────────

_GEO: dict | None = None
_GEO_LOCK = threading.Lock()
_FIX = {"France": "fr", "Norway": "no", "Kosovo": "xk", "Taiwan": "tw", "Somaliland": "so", "Northern Cyprus": "cy"}


def _geo() -> dict:
    """{iso2: (geometry, (lat, lon))} from the country polygons the globe
    draws (world-countries.json)."""
    global _GEO
    with _GEO_LOCK:
        if _GEO is None:
            out = {}
            try:
                from shapely.geometry import shape
                from paths import shared_data
                with open(shared_data("world-countries.json"), encoding="utf-8") as fh:
                    feats = json.load(fh).get("features", [])
                for f in feats:
                    p = f.get("properties") or {}
                    cc = _FIX.get(p.get("n")) or (p.get("a2") or "").lower()
                    if len(cc) != 2 or not cc.isalpha() or cc in out:
                        continue
                    g = shape(f["geometry"])
                    main = max(getattr(g, "geoms", [g]), key=lambda x: x.area)
                    pt = main.representative_point()
                    out[cc] = (g, (round(pt.y, 4), round(pt.x, 4)))
            except Exception as e:                           # noqa: BLE001
                print(f"[tg-mood] error: country polygons unreadable: {type(e).__name__}: {e}", flush=True)
            _GEO = out
    return _GEO


def centroid(cc: str) -> tuple[float, float] | None:
    hit = _geo().get((cc or "").lower())
    return hit[1] if hit else None


_at_cache: dict = {}


def country_code_at(lat, lon) -> str | None:
    try:
        key = (round(float(lat), 3), round(float(lon), 3))
    except (TypeError, ValueError):
        return None
    if key in _at_cache:
        return _at_cache[key]
    found = None
    try:
        from shapely.geometry import Point
        p = Point(key[1], key[0])
        for cc, (g, _c) in _geo().items():
            if g.bounds[0] <= p.x <= g.bounds[2] and g.bounds[1] <= p.y <= g.bounds[3] and g.contains(p):
                found = cc
                break
    except Exception:                                      # noqa: BLE001
        found = None
    if len(_at_cache) > 5000:
        _at_cache.clear()
    _at_cache[key] = found
    return found


def country_name(cc: str) -> str:
    try:
        from location_extract import country_name_from_code
        return country_name_from_code(cc) or cc.upper()
    except Exception:                                      # noqa: BLE001
        return cc.upper()


# ── whom it concerns ──────────────────────────────────────────────────────

def concern_reason(cc: str, c: dict) -> str | None:
    """Why a rise in this country concerns the user whose event_watch
    concern_of() this is — their asset in it, their theater over it, or the
    country among their interests — or None."""
    cc = (cc or "").lower()
    name = country_name(cc)
    mine = []
    for a in c.get("assets") or []:
        if country_code_at(a["lat"], a["lon"]) == cc:
            mine.append(a)
    if mine:
        if any(a.get("me") for a in mine):
            return f"you are in {name}"
        if len(mine) == 1:
            a = mine[0]
            return f"your {a['label'] + ' ' if a.get('label') else ''}{a['name']} is in {name}"
        names = [a["name"] for a in mine]
        listed = ", ".join(names[:-1]) + f" and {names[-1]}" if len(names) <= 4 else f"{', '.join(names[:3])} and {len(names) - 3} more"
        return f"your assets {listed} are in {name}"
    ctr = centroid(cc)
    for t in c.get("theaters") or []:
        if country_code_at(t["lat"], t["lon"]) == cc:
            return f"in your theater {t['name']}"
        if ctr:
            import event_watch as ew
            if ew.km(t["lat"], t["lon"], ctr[0], ctr[1]) <= t["reach"]:
                return f"in your theater {t['name']}"
    if name.lower() in (c.get("countries") or set()):
        return f"{name} — a country you watch"
    return None


# ── the signal ────────────────────────────────────────────────────────────

def _pct(x) -> str:
    return f"{round(100 * x)}%" if x is not None else "—"


def build_alert(ind: dict, now: _dt.datetime, concerned_users: int | None = None) -> dict:
    cc = ind["country"]
    name = country_name(cc)
    where = centroid(cc)
    title = (f"Calls for armed conflict rising on Telegram in {name} — {ind['ratio']:g}× the two-week level, "
             f"{ind['channels_24h']} channels")
    ex = "; ".join(f"«{e['text'][:120]}» ({e['channel']})" for e in ind["examples"])
    base = (f"{_pct(ind['base_rate'])} over the {BASE_DAYS} days before ({ind['n_base']} posts)")
    message = (f"{ind['calls_24h']} of {ind['n_24h']} rated posts about {name} in the last 24 h "
               f"({_pct(ind['rate_24h'])}) call for armed action, retaliation or war, or threaten violence, "
               f"against {base} — {ind['ratio']:g}× (z {ind['z']:g}), from {ind['channels_24h']} channels."
               + (f" Examples: {ex}." if ex else ""))
    reason = (f"calls for conflict about {name} on Telegram at {ind['ratio']:g}× the two-week level, "
              f"{ind['calls_24h']} posts from {ind['channels_24h']} channels")
    return {
        "id": f"TGM-{cc.upper()}-{now.strftime('%Y%m%d%H%M')}",
        "source": SOURCE,
        "alert_type": ALERT_TYPE,
        "title": title,
        "severity": ind["severity"] or "high",
        "lat": where[0] if where else None, "lon": where[1] if where else None,
        "region": name,
        "country_code": cc.upper(),
        "entity_type": "country", "entity_id": cc, "entity_name": name,
        "confidence": 0.7,
        "message": message,
        "reason": reason,
        "raw": {
            "rule": "telegram_calls_for_conflict_rising",
            "definition": ("a rated post that calls to confront, attack or take up arms (mobilise 3), speaks in "
                           "rage or threats (tension 3), or is hostile/calls to act with the vocabulary of war, "
                           "retaliation or mobilisation; copies count once"),
            "thresholds": {"min_calls": MIN_CALLS, "min_channels": MIN_CHANNELS, "max_channel_share": MAX_CHANNEL_SHARE,
                           "min_base_posts": MIN_BASE_POSTS, "min_ratio": MIN_RATIO, "min_z": MIN_Z,
                           "rate_floor": RATE_FLOOR, "base_days": BASE_DAYS},
            **{k: ind[k] for k in ("ratio", "z", "calls_24h", "n_24h", "rate_24h", "channels_24h", "top_channel_share",
                                   "n_base", "calls_base", "base_rate", "base_rate_used", "prev_24h",
                                   "series", "top_channels", "examples")},
            "reason": reason,
            "concerns": ("notified to the users with an asset in, a theater over, or an interest in "
                         f"{name}" + (f" ({concerned_users} now)" if concerned_users is not None else "")),
        },
    }


def due(ind: dict, previous: list[dict]) -> bool:
    """Cooldown: one per country per COOLDOWN_H; inside it, again only if
    the ratio has climbed RERAISE_FACTOR× above the last raise, or it has
    turned critical. `previous`: [{ratio, severity}] raised in the window."""
    if not ind.get("rising"):
        return False
    if not previous:
        return True
    top = max(float(p.get("ratio") or 0) for p in previous)
    if ind["ratio"] >= top * RERAISE_FACTOR:
        return True
    return ind["severity"] == "critical" and not any(p.get("severity") == "critical" for p in previous)


def previous_from_db(cc: str, now: _dt.datetime) -> list[dict]:
    from database import Alert, get_db
    since = (now - _dt.timedelta(hours=COOLDOWN_H)).astimezone(_dt.timezone.utc).replace(tzinfo=None)
    out = []
    with get_db() as db:
        for a in (db.query(Alert).filter(Alert.alert_type == ALERT_TYPE, Alert.entity_id == cc.lower(),
                                         Alert.created_at >= since).all()):
            try:
                raw = json.loads(a.raw_json or "{}")
                ratio = (raw.get("raw") or raw).get("ratio")
            except ValueError:
                ratio = None
            out.append({"ratio": ratio, "severity": a.severity})
    return out


def concerned_count(cc: str) -> int | None:
    """How many users this would reach, for the record (not who)."""
    try:
        import event_watch as ew
        from database import User, get_db
        with get_db() as db:
            uids = [str(r[0]) for r in db.query(User.id).all()]
        return sum(1 for u in uids if concern_reason(cc, ew.concern_of(u)))
    except Exception as e:                                 # noqa: BLE001
        print(f"[tg-mood] error: counting concerned users: {type(e).__name__}: {e}", flush=True)
        return None


def detect(now: _dt.datetime | None = None, readings: dict | None = None, previous=previous_from_db,
           count=concerned_count) -> list[dict]:
    """New alert dicts for every country whose calls for conflict are rising
    and not on cooldown. Synchronous: run it off the event loop."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    readings = readings if readings is not None else evaluate(now)
    out = []
    for cc, ind in sorted(readings.items()):
        if not ind.get("rising"):
            continue
        if not due(ind, previous(cc, now)):
            continue
        out.append(build_alert(ind, now, count(cc) if count else None))
    return out


# ── the cards for one user (event_watch.cards_for) ────────────────────────

_alerts_cache: dict = {"at": 0.0, "rows": []}
ALERTS_TTL_S = 60
CARD_HOURS = 24


def recent_alerts() -> list[dict]:
    with _eval_lock:
        if time.time() - _alerts_cache["at"] < ALERTS_TTL_S:
            return _alerts_cache["rows"]
    from database import Alert, get_db
    since = _dt.datetime.now(_dt.timezone.utc).replace(tzinfo=None) - _dt.timedelta(hours=CARD_HOURS)
    with get_db() as db:
        rows = [{"id": a.alert_id, "title": a.title, "sev": a.severity, "cc": (a.entity_id or a.country_code or "").lower(),
                 "lat": a.lat, "lon": a.lon, "region": a.region, "alert_type": a.alert_type,
                 "created_at": a.created_at.isoformat() if a.created_at else None}
                for a in db.query(Alert).filter(Alert.alert_type.like("Telegram mood%"), Alert.status == "active",
                                                Alert.created_at >= since).all()]
    with _eval_lock:
        _alerts_cache.update(at=time.time(), rows=rows)
    return rows


def cards_for(c: dict, alerts: list[dict] | None = None) -> list[dict]:
    """The rises that concern this user, as notification cards. Same id,
    title and time as the alert row, so the tray shows one card — this one,
    with the reason that names their asset, theater or country."""
    out = []
    for a in (alerts if alerts is not None else recent_alerts()):
        why = concern_reason(a["cc"], c)
        if not why:
            continue
        out.append({"id": a["id"], "title": a["title"], "kind": "signal", "alert_type": a["alert_type"],
                    "sev": a["sev"] if a["sev"] in ("critical", "high") else "high", "reason": why,
                    "lat": a["lat"], "lon": a["lon"], "region": a["region"], "source": SOURCE,
                    "notify": True, "created_at": a["created_at"]})
    return out


# ── one call, one signal (owner, 2026-10-18) ──────────────────────────────
# "If we notice … calls to action, calls to violence, only one specific
# call, citations and everything, that has to become a signal: on the desk,
# a notification, and on the map." The rise above needs eight calls from
# three channels; this raises the single post that itself calls to confront,
# attack or take up arms (rated mobilise 3, or rage plus the vocabulary of
# war), with the words quoted, the channel and the link. Copies of the same
# post across channels are one signal that names every channel; three or
# more channels make it critical.

CALL_TYPE = "Telegram mood: call to violence"
CALL_WINDOW_H = 3


# The model's rating alone is not enough for one post: on real data a
# notice about Kyiv's water supply came back rated "call to confront". A
# single-post signal also needs the words of violence in the post itself.
VIOLENT_ACT = re.compile(
    r"\b(attack|attaqu|storm|assault|kill|tuer|burn|br[uû]l|torch|smash|cass(?:er|ons|ez)|destroy|d[ée]trui|"
    r"lynch|shoot|tirer sur|fight|combat|bomb|arm(?:e|es|s)\b|weapons?|fusil|molotov|incendi|pend(?:re|ez)|"
    r"exterminat|annihilat|massacr|égorg|behead|riot|émeute|insurrection|revolt|révolte|prendre d'assaut|"
    # Spanish (Venezuela)
    r"ata(?:car|quemos|camos)|quem(?:ar|emos|amos)|matar|linch|asalt(?:ar|emos|o)|tomar por asalto|incendi(?:ar|emos)|"
    r"armas|plomo|candela)", re.IGNORECASE)


def is_violence_call(row) -> bool:
    m = _int(_get(row, "mood_mobilise"))
    t = _int(_get(row, "mood_tension"))
    text = f"{_get(row, 'summary_en') or ''} {_get(row, 'text') or ''}"
    if m >= 3:
        return bool(VIOLENT_ACT.search(text) or CONFLICT_WORDS.search(text))
    return t >= 3 and bool(CONFLICT_WORDS.search(text))


def _call_rows(since: _dt.datetime) -> list:
    import sqlite3
    import telegram_sentiment as ts
    con = ts._con()
    con.row_factory = sqlite3.Row
    try:
        return con.execute(
            "SELECT channel, msg_id, channel_title, posted_at, text, summary_en, headline, place, lat, lon,"
            " mood_country, mood_tension, mood_mobilise, mood_target, mood_topic"
            " FROM telegram_posts WHERE mood_checked=1 AND (mood_mobilise >= 3 OR mood_tension >= 3) AND posted_at >= ?",
            (since.strftime("%Y-%m-%dT%H:%M:%S"),)).fetchall()
    finally:
        con.close()


def _post_url(r) -> str | None:
    ch = str(r["channel"] or "")
    return None if ch.startswith("c/") else f"https://t.me/{ch}/{r['msg_id']}"


def build_call_alerts(rows, now: _dt.datetime) -> list[dict]:
    """One alert dict per distinct call (copies merged), newest first. Pure."""
    groups: dict[str, list] = {}
    for r in rows:
        if is_violence_call(r):
            groups.setdefault(_key(r), []).append(r)
    out = []
    for key, rs in groups.items():
        rs = sorted(rs, key=lambda r: str(r["posted_at"]))
        first = rs[0]
        chans = list(dict.fromkeys(str(r["channel_title"] or r["channel"]) for r in rs))
        cc = str(first["mood_country"] or "").lower()
        name = country_name(cc) if len(cc) == 2 else (first["place"] or "an unnamed place")
        lat, lon = first["lat"], first["lon"]
        precise = lat is not None and lon is not None
        if not precise and len(cc) == 2:
            ctr = centroid(cc)
            lat, lon = (ctr[0], ctr[1]) if ctr else (None, None)
        said = str(first["summary_en"] or first["headline"] or first["text"] or "").strip().replace("\n", " ")
        quote = said[:140] + ("…" if len(said) > 140 else "")
        target = first["mood_target"]
        title = (f"Call to violence on Telegram{f' against {target}' if target else ''} — {name}: «{quote}» "
                 f"({chans[0]}{f' and {len(chans) - 1} more' if len(chans) > 1 else ''})")
        cites = [{"channel": str(r["channel_title"] or r["channel"]), "url": _post_url(r), "posted_at": str(r["posted_at"]),
                  "text": str(r["text"] or "")[:400]} for r in rs[:8]]
        out.append({
            "id": f"TGC-{str(first['channel']).replace('/', '_')}-{first['msg_id']}",
            "source": SOURCE, "alert_type": CALL_TYPE, "title": title,
            "severity": "critical" if len(chans) >= 3 else "high",
            "lat": lat, "lon": lon, "region": first["place"] or name,
            "country_code": cc.upper() or None,
            "entity_type": "country" if len(cc) == 2 else None, "entity_id": cc or None, "entity_name": name,
            "confidence": 0.6,
            "message": (f"A post {'repeated in ' + str(len(chans)) + ' channels ' if len(chans) > 1 else ''}calls to "
                        f"confront, attack or take up arms{f' against {target}' if target else ''}: «{said[:400]}». "
                        f"First posted {str(first['posted_at'])[:16].replace('T', ' ')} UTC by {chans[0]}. Unverified: "
                        "one channel's words, rated by a model; read the post."),
            "reason": f"a call to violence about {name} on Telegram",
            "raw": {"rule": "telegram_call_to_violence", "channels": chans, "citations": cites, "target": target,
                    "topic": first["mood_topic"], "placed": "post" if precise else "country centre",
                    "url": cites[0]["url"]},
        })
    out.sort(key=lambda a: a["raw"]["citations"][0]["posted_at"], reverse=True)
    return out


def detect_calls(now: _dt.datetime | None = None, rows=None, existing=None) -> list[dict]:
    """New call-to-violence alerts from the last few hours, not raised before.
    Synchronous: run it off the event loop."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    rows = rows if rows is not None else _call_rows(now - _dt.timedelta(hours=CALL_WINDOW_H))
    alerts = build_call_alerts(rows, now)
    if existing is None:
        from database import Alert, get_db
        ids = [a["id"] for a in alerts]
        with get_db() as db:
            existing = {x[0] for x in db.query(Alert.alert_id).filter(Alert.alert_id.in_(ids)).all()} if ids else set()
    return [a for a in alerts if a["id"] not in existing]
