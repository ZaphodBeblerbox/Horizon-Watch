"""
telegram_unrest.py — from the mood on Telegram to two readings per country
(and per city or region where posts are located): is the TENSION rising,
and how LIKELY are demonstrations in the next 48 hours.

The owner (2026-10-17): "We can make way more use of the Telegram sentiment.
For example, I've ingested a bunch of Iran groups. I want to be able to see
tensions rising, likelihood of demonstrations increasing, whatever."

Nothing new is asked of a model. Every post is already rated once by
telegram_sentiment.py (tension 0–3, mobilise 0–3, target, topic, the
country it is about); announced gatherings come from telegram_events.py
(telegram_announcements); protests reported on the ground are posts the
classifier filed as event_type 'unrest', located in the country.

Copies of one post (a forward across channels) count once everywhere here
(telegram_mood_alert._key), and channel diversity is counted over distinct
posts — one viral post is one voice.

TENSION TREND. A post is HOSTILE at tension 2 or more. The share of hostile
posts in the last 24 h (daily) and the last 6 h (intraday) is set against
the share over the 14 days before (floored at RATE_FLOOR so a quiet baseline
cannot turn one post into ∞×), with a binomial z for significance. A share,
not a count: newly joined channels (the owner's Iran groups) raise volume,
not tension. Rising at ≥ 1.5× and z ≥ 2, falling at ≤ 1/1.5× and z ≤ −2,
otherwise steady — and "unclear" (never rising) unless the window has
MIN_POSTS posts from MIN_CHANNELS channels and the baseline MIN_BASE posts.
SHARP (the notification) needs ≥ 2.5×, z ≥ 3, ≥ 6 hostile posts from ≥ 3
channels, none carrying more than 60 % of them.

DEMONSTRATION LIKELIHOOD, next 48 h. Points, each with its sentence:
  calls to gather, strike or block (mobilise ≥ 2), last 24 h
      ≥ 3 from ≥ 2 channels                         +1
      ≥ 8 from ≥ 4 channels, none > 60 %           +2 (instead)
  their share ≥ 2× the two-week share               +1
  ≥ 3 of them in the last 6 h, ≥ 2 channels         +1   (recency)
  dated gatherings announced for the next 48 h      +2, +3 at ≥ 2 places
  tension rising (daily)                            +1
  ≥ 3 posts on grievances (prices, wages, fuel,
      arrests, executions …) from ≥ 2 channels     +1
  ≥ 2 protest reports located there in 24 h         +1   (already on the street)
Low 0–1 · Elevated 2–3 · High ≥ 4. Guards: High needs a broad call (≥ 8
from ≥ 4 channels) or an announced date; Elevated needs at least some call,
an announcement or protests already reported — tension and grievance alone
never lift a country above Low.

A reading above Low is stated as something that can be wrong (the owner's
rule for forecasts: actor, place, act, cited, a criterion, a date): who
called (the channels or organisers), where, what, by when, the posts it
rests on, and what would falsify it. It is never a category base rate.

CALIBRATION. backtest() replays the stored posts every 6 h and asks, for
each reading, whether a protest was reported in that country in the 48 h
after it. The hit rate per level is shown next to the level as it is, with
its n and the rate for any reading, and with the naive rule "protests were
reported in the 24 h before" for comparison. Readings 6 h apart overlap, so
the n flatters it; with few readings it says so rather than a percentage.
"""
from __future__ import annotations

import bisect
import datetime as _dt
import math
import re
import threading
import time
from collections import Counter

ALERT_LIKELY = "Telegram mood: demonstrations likely"
ALERT_TENSION = "Telegram mood: tension rising sharply"
SOURCE = "telegram"

BASE_DAYS = 14
HORIZON_H = 48
RATE_FLOOR = 0.03
MIN_POSTS = {24: 12, 6: 6}
MIN_CHANNELS = 3
MIN_BASE = 30
RISE, FALL_Z, RISE_Z = 1.5, -2.0, 2.0
SHARP_RATIO, SHARP_Z, SHARP_HOSTILE = 2.5, 3.0, 6
MAX_SHARE = 0.6
COOLDOWN_H = 24
RERAISE_FACTOR = 1.5

GRIEVANCE = re.compile(
    r"price|inflation|wage|salar|pension|fuel|petrol|gasoline|diesel|bread|water short|drought|electric|blackout|"
    r"power cut|outage|unemploy|layoff|currency|rial|devaluat|cost of living|corruption|execution|death sentence|"
    r"arrest|detain|prisoner|hijab|women's rights|student|election|fraud|tax|subsid|teacher|retiree|worker|"
    r"farmer|trucker|bazaar|crackdown|repression|censorship|internet shutdown",
    re.IGNORECASE)

# The classifier files air-raid alerts and arrests under 'unrest' too (seen
# 2026-10-17 on Kyiv: "an air raid alert has been announced"), so a protest
# report must also say it is one.
PROTEST = re.compile(
    r"protest|demonstrat|rall(?:y|ies)\b|march(?:ed|ers|es|ing)?\b|riot|sit-in|blockade|blocked (?:the )?road|"
    r"general strike|on strike|strike by|strikers|walkout|walk-out|tear gas|clash(?:ed|es)? with (?:the )?police|"
    r"vigil|chant|crowds? gathered|took to the streets|manifestation|manif\b|grève|تظاهر|احتجاج|اعتصام|"
    r"تجمع|اعتراض|راهپیمایی|اعتصاب|протест|митинг|забастов",
    re.IGNORECASE)

_GENERIC = {"region", "none", "unknown", "district", "province", "oblast", "state", "governorate", "county"}

_PLACE_KINDS = {"city", "town", "district", "neighborhood", "region", "province", "village", "governorate",
                "county", "state", "oblast", "street", "site", "campus", "university", "square", "area"}


# ── small helpers ─────────────────────────────────────────────────────────

def _get(r, k):
    try:
        return r[k]
    except (KeyError, IndexError):
        return None


def _int(v) -> int:
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        return 0


def _utc(s) -> _dt.datetime | None:
    if not s:
        return None
    try:
        d = _dt.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        try:
            d = _dt.datetime.fromisoformat(str(s)[:10])
        except ValueError:
            return None
    return d if d.tzinfo else d.replace(tzinfo=_dt.timezone.utc)


def _key(r) -> str:
    s = str(_get(r, "summary_en") or _get(r, "text") or "").lower()
    return re.sub(r"\W+", "", s)[:100] or f"{_get(r, 'channel')}/{_get(r, 'msg_id')}"


def _chan(r) -> str:
    return _get(r, "channel_title") or _get(r, "channel") or "?"


def city_of(place: str | None) -> str | None:
    """'Obolon, Kyiv, Ukraine' → 'Kyiv'; 'Place de la Bastille, Paris, France'
    → 'Paris': the last part before the country."""
    parts = [p.strip() for p in str(place or "").split(",") if p.strip() and p.strip().lower() not in _GENERIC]
    if len(parts) >= 2:
        return parts[-2]
    return None


def post_city(r) -> str | None:
    """Where a rated post is located, if inside the country it is about."""
    cc = str(_get(r, "country_code") or "").lower()
    if not cc or cc != str(_get(r, "mood_country") or "").lower():
        return None
    if str(_get(r, "precision") or "").lower() not in _PLACE_KINDS:
        return None
    return city_of(_get(r, "place"))


def is_protest_report(u) -> bool:
    return bool(PROTEST.search(f"{_get(u, 'summary_en') or ''} {_get(u, 'text') or ''}"))


def _s(n: int, word: str, plural: str | None = None) -> str:
    return f"{n} {word if n == 1 else (plural or word + 's')}"


def _dedupe(rows) -> list:
    """One per distinct text, the earliest carrier kept."""
    seen, out = set(), []
    for r in sorted(rows, key=lambda x: str(_get(x, "posted_at"))):
        k = _key(r)
        if k in seen:
            continue
        seen.add(k)
        out.append(r)
    return out


def _times(x: float) -> str:
    return f"{x:.1f}×" if x < 10 else f"{round(x)}×"


def _listing(names: list[str]) -> str:
    names = [n for n in names if n]
    if len(names) <= 1:
        return "".join(names)
    if len(names) <= 3:
        return ", ".join(names[:-1]) + f" and {names[-1]}"
    return f"{', '.join(names[:2])} and {len(names) - 2} more"


def _day_word(day: str, now: _dt.datetime) -> str:
    try:
        d = _dt.date.fromisoformat(day[:10])
    except ValueError:
        return day
    delta = (d - now.date()).days
    if delta == 0:
        return "today"
    if delta == 1:
        return "tomorrow"
    if 0 < delta < 7:
        return d.strftime("%A")
    return d.strftime("%-d %b")


# ── the tension trend ─────────────────────────────────────────────────────

def trend(rows: list, now: _dt.datetime, hours: int = 24) -> dict:
    """Share of hostile posts (tension ≥ 2) in the last `hours` against the
    14 days before. `rows`: rated posts, deduped or not."""
    rows = _dedupe(rows)
    t_recent = now - _dt.timedelta(hours=hours)
    t_base0 = now - _dt.timedelta(hours=24, days=BASE_DAYS)
    t_base1 = now - _dt.timedelta(hours=24) if hours <= 24 else t_recent
    rec, base = [], []
    for r in rows:
        at = _utc(_get(r, "posted_at"))
        if at is None or at > now:
            continue
        if at >= t_recent:
            rec.append(r)
        if t_base0 <= at < t_base1:
            base.append(r)
    hostile = [r for r in rec if _int(_get(r, "mood_tension")) >= 2]
    n, h = len(rec), len(hostile)
    chans = {_chan(r) for r in rec}
    hchans = Counter(_chan(r) for r in hostile)
    rate = h / n if n else 0.0
    base_h = sum(1 for r in base if _int(_get(r, "mood_tension")) >= 2)
    base_raw = base_h / len(base) if base else None
    p = max(base_raw or 0.0, RATE_FLOOR)
    ratio = rate / p if n else 0.0
    z = (h - n * p) / math.sqrt(n * p * (1 - p)) if n else 0.0
    mean = lambda rs: round(sum(_int(_get(r, "mood_tension")) for r in rs) / len(rs), 2) if rs else None  # noqa: E731
    need = MIN_POSTS.get(hours, MIN_POSTS[24])
    why_not = None
    if n < need or len(chans) < MIN_CHANNELS:
        why_not = f"only {n} post{'s' if n != 1 else ''} from {len(chans)} channel{'s' if len(chans) != 1 else ''} in the last {hours} h (needs {need} from {MIN_CHANNELS})"
    elif len(base) < MIN_BASE:
        why_not = f"only {len(base)} posts in the two weeks before to compare with (needs {MIN_BASE})"
    enough = why_not is None
    if not enough:
        direction = "unclear"
    elif ratio >= RISE and z >= RISE_Z:
        direction = "rising"
    elif ratio <= 1 / RISE and z <= FALL_Z:
        direction = "falling"
    else:
        direction = "steady"
    top_share = hchans.most_common(1)[0][1] / h if h else 0.0
    sharp = (direction == "rising" and ratio >= SHARP_RATIO and z >= SHARP_Z and h >= SHARP_HOSTILE
             and len(hchans) >= MIN_CHANNELS and top_share <= MAX_SHARE)
    if enough:
        label = (f"{direction} · hostile posts {round(100 * rate)}% of {n} in {hours} h against "
                 f"{round(100 * (base_raw or 0))}% over two weeks ({_times(ratio)}, z {z:.1f})")
    else:
        label = f"too little to read: {why_not}"
    return {"hours": hours, "n": n, "channels": len(chans), "hostile": h, "hostile_channels": len(hchans),
            "rate": round(rate, 3), "n_base": len(base), "base_rate": round(base_raw, 3) if base_raw is not None else None,
            "ratio": round(ratio, 2), "z": round(z, 1), "mean_tension": mean(rec), "base_mean_tension": mean(base),
            "direction": direction, "enough": enough, "why_not": why_not, "sharp": sharp, "label": label}


# ── announced gatherings ──────────────────────────────────────────────────

def upcoming(ann: list, now: _dt.datetime, hours: int = HORIZON_H) -> list[dict]:
    """Gatherings announced by `now` for the next `hours`, one per what,
    city and day."""
    end = now + _dt.timedelta(hours=hours)
    out, seen = [], set()
    for a in ann:
        posted = _utc(_get(a, "posted_at"))
        if posted is None or posted > now:
            continue
        starts_at = str(_get(a, "starts_at") or "")
        su = _utc(_get(a, "starts_utc")) if _get(a, "starts_utc") else None
        if su is not None:
            if not (now <= su <= end):
                continue
        else:
            day = starts_at[:10]
            if not (now.strftime("%Y-%m-%d") <= day <= end.strftime("%Y-%m-%d")):
                continue
            # An hour without its zone: taken as UTC with three hours' slack
            # (the widest offset among the places read), so this morning's
            # march is not still "announced" tonight.
            if "T" in starts_at:
                lt = _utc(starts_at)
                if lt is not None and lt < now - _dt.timedelta(hours=3):
                    continue
        try:
            import telegram_events as te
            if not te.is_future(starts_at, _get(a, "starts_utc"), str(_get(a, "posted_at") or ""), _get(a, "what")):
                continue
        except Exception:                                      # noqa: BLE001
            pass
        city = city_of(_get(a, "place")) or (_get(a, "place") or "").split(",")[0].strip() or None
        k = (str(_get(a, "what") or "").lower(), city, starts_at[:10])
        if k in seen:
            continue
        seen.add(k)
        out.append({"what": _get(a, "what") or "gathering", "city": city, "place": _get(a, "place"),
                    "starts_at": starts_at, "day": _day_word(starts_at, now), "organiser": _get(a, "organiser") or "",
                    "channel": _chan(a),
                    "url": None if str(_get(a, "channel") or "").startswith("c/") else
                    f"https://t.me/{_get(a, 'channel')}/{_get(a, 'msg_id')}"})
    out.sort(key=lambda x: x["starts_at"])
    return out


# ── the demonstration likelihood ──────────────────────────────────────────

def likelihood(rows: list, ann: list, unrest: list, now: _dt.datetime, name: str,
               daily: dict | None = None) -> dict:
    """Low / Elevated / High for the next 48 h with the points that make it.
    rows: rated posts about the place; ann: its announcements; unrest: its
    protest reports (posts filed as 'unrest' located there)."""
    rows = _dedupe([r for r in rows if (_utc(_get(r, "posted_at")) or now) <= now])
    t24, t6 = now - _dt.timedelta(hours=24), now - _dt.timedelta(hours=6)
    t0 = t24 - _dt.timedelta(days=BASE_DAYS)
    rec = [r for r in rows if (_utc(_get(r, "posted_at")) or t0) >= t24]
    base = [r for r in rows if t0 <= (_utc(_get(r, "posted_at")) or t0) < t24]
    calls = [r for r in rec if _int(_get(r, "mood_mobilise")) >= 2]
    violent = [r for r in calls if _int(_get(r, "mood_mobilise")) >= 3]
    calls6 = [r for r in calls if (_utc(_get(r, "posted_at")) or t0) >= t6]
    cch = Counter(_chan(r) for r in calls)
    top_share = cch.most_common(1)[0][1] / len(calls) if calls else 0.0
    share = len(calls) / len(rec) if rec else 0.0
    base_calls = sum(1 for r in base if _int(_get(r, "mood_mobilise")) >= 2)
    base_share = base_calls / len(base) if base else None
    call_ratio = share / max(base_share or 0.0, RATE_FLOOR) if rec and len(base) >= MIN_BASE else None
    upc = upcoming(ann, now)
    up_places = sorted({u["city"] or u["place"] for u in upc if (u["city"] or u["place"])})
    griev = [r for r in rec if GRIEVANCE.search(f"{_get(r, 'mood_topic') or ''} {_get(r, 'mood_target') or ''}")]
    gch = {_chan(r) for r in griev}
    street = [u for u in unrest if t24 <= (_utc(_get(u, "posted_at")) or t0) <= now and is_protest_report(u)]
    street = _dedupe(street)
    daily = daily or trend(rows, now, 24)

    pts = []
    kind = "calls to gather, strike or block" if not violent else (
        "calls to gather, strike, block or confront" if len(violent) < len(calls) else "calls to confront")
    broad = len(calls) >= 8 and len(cch) >= 4 and top_share <= MAX_SHARE
    if broad:
        pts.append(("calls", 2))
    elif len(calls) >= 3 and len(cch) >= 2:
        pts.append(("calls", 1))
    if call_ratio is not None and call_ratio >= 2 and len(calls) >= 3:
        pts.append(("calls_rising", 1))
    if len(calls6) >= 3 and len({_chan(r) for r in calls6}) >= 2:
        pts.append(("recent", 1))
    if upc:
        pts.append(("announced", 3 if len(up_places) >= 2 else 2))
    if daily.get("direction") == "rising":
        pts.append(("tension", 1))
    if len(griev) >= 3 and len(gch) >= 2:
        pts.append(("grievance", 1))
    if len(street) >= 2:
        pts.append(("street", 1))
    score = sum(p for _, p in pts)
    level = "High" if score >= 4 else "Elevated" if score >= 2 else "Low"
    capped = None
    if level == "High" and not (broad or upc):
        level, capped = "Elevated", "High needs a broad call (8 from 4 channels) or an announced date"
    if level == "Elevated" and not (len(calls) >= 3 or upc or len(street) >= 2):
        level, capped = "Low", "no call to act, announced date or protest report behind it"

    # the sentences
    texts = {}
    if calls:
        rate_part = ""
        if call_ratio is not None:
            rate_part = f", {_times(call_ratio)} the two-week rate"
        elif len(base) < MIN_BASE:
            rate_part = ", no two weeks before to compare with"
        texts["calls"] = f"{_s(len(calls), kind.replace('calls', 'call', 1), kind)} in {_s(len(cch), 'channel')} in 24 h{rate_part}"
    if call_ratio is not None:
        texts["calls_rising"] = (f"calls are {round(100 * share)}% of posts against "
                                 f"{round(100 * (base_share or 0))}% over two weeks")
    if calls6:
        texts["recent"] = f"{len(calls6)} of them in the last 6 h"
    if upc:
        days = sorted({u["day"] for u in upc}, key=lambda d: ["today", "tomorrow"].index(d) if d in ("today", "tomorrow") else 2)
        texts["announced"] = (f"{len(upc)} dated gathering{'s' if len(upc) != 1 else ''} announced for "
                              f"{_listing(days)} in {_listing(up_places) or name}")
    texts["tension"] = f"tension {daily.get('label')}" if daily.get("enough") else None
    if griev:
        tops = [t for t, _ in Counter(str(_get(r, "mood_topic") or "").lower() for r in griev if _get(r, "mood_topic")).most_common(3)]
        texts["grievance"] = f"{_s(len(griev), 'post')} on grievances ({_listing(tops)}) from {_s(len(gch), 'channel')}"
    if street:
        texts["street"] = f"{_s(len(street), 'protest report')} located in {name} in the last 24 h"
    scored = {k for k, _ in pts}
    reasons = [texts[k] for k, _ in pts if texts.get(k)]
    context = [t for k, t in texts.items() if t and k not in scored]

    cites = sorted(calls, key=lambda r: str(_get(r, "posted_at")), reverse=True)[:4]
    citations = [{"channel": _chan(r), "posted_at": str(_get(r, "posted_at")),
                  "text": str(_get(r, "summary_en") or _get(r, "text") or "")[:200],
                  "url": None if str(_get(r, "channel") or "").startswith("c/") else
                  f"https://t.me/{_get(r, 'channel')}/{_get(r, 'msg_id')}"} for r in cites]
    citations += [{"channel": u["channel"], "posted_at": None, "text": f"{u['what']} — {u['place']}, {u['starts_at']}",
                   "url": u["url"]} for u in upc[:3]]
    forecast = None
    if level != "Low":
        by = now + _dt.timedelta(hours=HORIZON_H)
        named = [u["organiser"] for u in upc if u["organiser"]] + [u["channel"] for u in upc] + [c for c, _ in cch.most_common(3)]
        actors, seen = [], set()
        for a in named:
            a = " ".join(str(a).split())[:40].strip()
            a = f"“{a}”" if a else a
            if a and a.casefold() not in seen:
                seen.add(a.casefold())
                actors.append(a)
        actors = actors[:3]
        where = _listing(up_places) if up_places else name
        forecast = {
            "statement": (f"Gatherings, strikes or blockades in {where} by {by.strftime('%a %-d %b %H:%M')} UTC"
                          + (f", as called or relayed by {_listing(actors)}" if actors else "")),
            "criterion": (f"Wrong if no protest, strike or blockade located in {name} is reported in the ingested "
                          f"channels by {by.strftime('%Y-%m-%d %H:%M')} UTC"),
            "by": by.isoformat(),
        }
    return {"level": level, "score": score, "points": [{"key": k, "points": p, "text": texts.get(k)} for k, p in pts],
            "reasons": reasons, "context": context, "capped": capped,
            "n_24h": len(rec), "calls_24h": len(calls), "violent_calls_24h": len(violent), "calls_6h": len(calls6),
            "call_channels": len(cch), "call_share": round(share, 3),
            "base_call_share": round(base_share, 3) if base_share is not None else None,
            "call_ratio": round(call_ratio, 2) if call_ratio is not None else None,
            "announced": upc[:6], "grievance_posts": len(griev), "protest_reports_24h": len(street),
            "forecast": forecast, "citations": citations, "horizon_h": HORIZON_H}


def summary_line(name: str, lk: dict) -> str:
    """'High: 14 calls to gather … ; 2 dated gatherings …'"""
    return f"{lk['level']} in {name}: " + "; ".join(lk["reasons"]) if lk["reasons"] else f"{lk['level']} in {name}"


# ── one country ───────────────────────────────────────────────────────────

def reading(cc: str, rows: list, ann: list, unrest: list, now: _dt.datetime, name: str | None = None,
            places: bool = True) -> dict:
    """Both readings for one country and, where posts are located, its
    cities or regions."""
    name = name or cc.upper()
    daily = trend(rows, now, 24)
    intra = trend(rows, now, 6)
    lk = likelihood(rows, ann, unrest, now, name, daily)
    out = {"country": cc, "name": name, "trend": {"daily": daily, "intraday": intra}, "likelihood": lk}
    if places:
        t24 = now - _dt.timedelta(hours=24)
        by_city: dict[str, list] = {}
        for r in rows:
            c = post_city(r)
            if c:
                by_city.setdefault(c, []).append(r)
        ann_city: dict[str, list] = {}
        for a in ann:
            c = city_of(_get(a, "place"))
            if c:
                ann_city.setdefault(c, []).append(a)
        un_city: dict[str, list] = {}
        for u in unrest:
            c = city_of(_get(u, "place"))
            if c:
                un_city.setdefault(c, []).append(u)
        pl = []
        for c in set(by_city) | set(ann_city):
            rs = by_city.get(c, [])
            recent = [r for r in rs if (_utc(_get(r, "posted_at")) or t24) > t24]
            up = upcoming(ann_city.get(c, []), now)
            if not recent and not up:
                continue
            d = trend(rs, now, 24)
            l2 = likelihood(rs, ann_city.get(c, []), un_city.get(c, []), now, c, d)
            pl.append({"place": c, "n_24h": l2["n_24h"], "calls_24h": l2["calls_24h"], "announced": len(up),
                       "trend": d["direction"], "trend_label": d["label"], "level": l2["level"], "reasons": l2["reasons"]})
        rank = {"High": 0, "Elevated": 1, "Low": 2}
        pl.sort(key=lambda p: (rank[p["level"]], -p["calls_24h"], -p["announced"], -p["n_24h"]))
        out["places"] = pl[:6]
    return out


def compact(rd: dict) -> dict:
    """What the country list carries."""
    d, i, lk = rd["trend"]["daily"], rd["trend"]["intraday"], rd["likelihood"]
    return {"trend": {"daily": {k: d[k] for k in ("direction", "ratio", "z", "n", "enough", "sharp", "label")},
                      "intraday": {k: i[k] for k in ("direction", "ratio", "z", "n", "enough", "label")}},
            "likelihood": {"level": lk["level"], "score": lk["score"], "reasons": lk["reasons"],
                           "forecast": lk["forecast"]}}


# ── the data ──────────────────────────────────────────────────────────────

def _load(since: _dt.datetime) -> tuple[dict, dict, dict]:
    """({cc: rated posts}, {cc: announcements}, {cc: protest reports})."""
    import sqlite3
    import telegram_sentiment as ts
    con = ts._con()
    con.row_factory = sqlite3.Row
    s = since.strftime("%Y-%m-%d")
    try:
        rows = con.execute(
            "SELECT channel, msg_id, channel_title, posted_at, substr(text,1,400) AS text, summary_en, role,"
            " mood_country, mood_tension, mood_mobilise, mood_target, mood_topic, place, precision, country_code"
            " FROM telegram_posts WHERE mood_checked=1 AND mood_country IS NOT NULL AND posted_at >= ?", (s,)).fetchall()
        unrest = con.execute(
            "SELECT channel, msg_id, channel_title, posted_at, summary_en, substr(text,1,200) AS text, place, country_code"
            " FROM telegram_posts WHERE event_type='unrest' AND country_code IS NOT NULL AND country_code != ''"
            " AND posted_at >= ?", (s,)).fetchall()
        try:
            ann = con.execute(
                "SELECT a.channel, a.msg_id, a.posted_at, a.what, a.organiser, a.starts_at, a.starts_utc, a.place,"
                " a.country, p.channel_title FROM telegram_announcements a LEFT JOIN telegram_posts p"
                " ON p.channel=a.channel AND p.msg_id=a.msg_id WHERE a.posted_at >= ?", (s,)).fetchall()
        except sqlite3.OperationalError:                       # the table is made by telegram_events
            ann = []
    finally:
        con.close()
    by, an, un = {}, {}, {}
    for r in rows:
        by.setdefault(str(r["mood_country"]).lower(), []).append(r)
    for a in ann:
        if a["country"]:
            an.setdefault(str(a["country"]).lower(), []).append(a)
    for u in unrest:
        un.setdefault(str(u["country_code"]).lower(), []).append(u)
    return by, an, un


def _name(cc: str) -> str:
    try:
        from location_extract import country_name_from_code
        return country_name_from_code(cc) or cc.upper()
    except Exception:                                          # noqa: BLE001
        return cc.upper()


_cache: dict = {"at": 0.0, "data": None}
_lock = threading.Lock()
TTL_S = 300


def evaluate(now: _dt.datetime | None = None, data=None) -> dict:
    """{country: reading} for every country with a rated post in the last
    24 h or a gathering announced for the next 48 h. Cached five minutes
    when read live."""
    live = now is None and data is None
    if live:
        with _lock:
            if _cache["data"] is not None and time.time() - _cache["at"] < TTL_S:
                return _cache["data"]
    now = now or _dt.datetime.now(_dt.timezone.utc)
    by, an, un = data if data is not None else _load(now - _dt.timedelta(days=BASE_DAYS + 2))
    t24 = now - _dt.timedelta(hours=24)
    out = {}
    for cc in set(by) | set(an):
        rows = by.get(cc, [])
        if not any((_utc(_get(r, "posted_at")) or t24) > t24 for r in rows) and not upcoming(an.get(cc, []), now):
            continue
        out[cc] = reading(cc, rows, an.get(cc, []), un.get(cc, []), now, _name(cc))
    if live:
        with _lock:
            _cache.update(at=time.time(), data=out)
    return out


# ── calibration against the stored posts ─────────────────────────────────

def backtest(by: dict, an: dict, un: dict, start: _dt.datetime, end: _dt.datetime,
             step_h: int = 6, horizon_h: int = HORIZON_H) -> dict:
    """Replay every `step_h` from start to end − horizon: the reading per
    country from what was posted by then, and whether a protest was
    reported located in that country in the `horizon_h` after."""
    levels = {k: {"n": 0, "hit": 0} for k in ("Low", "Elevated", "High")}
    persist = {"n": 0, "hit": 0}
    countries = set()
    un = {cc: [u for u in us if is_protest_report(u)] for cc, us in un.items()}
    un_t = {cc: sorted(t for t in (_utc(_get(u, "posted_at")) for u in us) if t) for cc, us in un.items()}
    by_sorted = {cc: sorted(rs, key=lambda r: str(_get(r, "posted_at"))) for cc, rs in by.items()}
    by_t = {cc: [_utc(_get(r, "posted_at")) for r in rs] for cc, rs in by_sorted.items()}
    t = start
    last = end - _dt.timedelta(hours=horizon_h)
    while t <= last:
        for cc, rs in by_sorted.items():
            ts_ = by_t[cc]
            lo = bisect.bisect_left(ts_, t - _dt.timedelta(hours=24, days=BASE_DAYS))
            hi = bisect.bisect_right(ts_, t)
            if not any(x > t - _dt.timedelta(hours=24) for x in ts_[lo:hi]):
                continue                                     # nothing said about it that day: no reading
            window = rs[lo:hi]
            ut = un_t.get(cc, [])
            past = [u for u in un.get(cc, []) if (_utc(_get(u, "posted_at")) or t) <= t]
            lk = likelihood(window, an.get(cc, []), past, t, cc.upper())
            hit = bisect.bisect_right(ut, t + _dt.timedelta(hours=horizon_h)) - bisect.bisect_right(ut, t) > 0
            levels[lk["level"]]["n"] += 1
            levels[lk["level"]]["hit"] += int(hit)
            countries.add(cc)
            before = bisect.bisect_right(ut, t) - bisect.bisect_right(ut, t - _dt.timedelta(hours=24)) > 0
            if before:
                persist["n"] += 1
                persist["hit"] += int(hit)
        t += _dt.timedelta(hours=step_h)
    n = sum(v["n"] for v in levels.values())
    hits = sum(v["hit"] for v in levels.values())

    def rate(v):
        return round(v["hit"] / v["n"], 2) if v["n"] else None
    return {
        "levels": {k: v | {"rate": rate(v)} for k, v in levels.items()},
        "any_reading": {"n": n, "hit": hits, "rate": round(hits / n, 2) if n else None},
        "after_protests_reported": persist | {"rate": rate(persist)},
        "from": start.isoformat(), "to": end.isoformat(), "step_h": step_h, "horizon_h": horizon_h,
        "countries": len(countries),
        "outcome": "a post filed as unrest, located in the country, that says it is a protest, strike, blockade or riot",
        "note": ("readings 6 h apart overlap, so n flatters the evidence; an outcome counts only if the channels "
                 "ingested reported it, so a miss can be a protest nobody here posted about"),
        "enough": levels["High"]["n"] + levels["Elevated"]["n"] >= 20,
    }


def calibration_line(cal: dict | None, level: str) -> str | None:
    """'In the stored posts, 7 of 11 High readings were followed by protest
    reports within 48 h (any reading: 23%).'"""
    if not cal:
        return None
    v = cal["levels"].get(level) or {}
    if not v.get("n"):
        return f"No {level} readings in the stored posts yet to check it against."
    base = cal["any_reading"]
    line = (f"In the stored posts, {v['hit']} of {v['n']} {level} readings were followed by protest reports in the "
            f"country within {cal['horizon_h']} h (any reading: {round(100 * (base['rate'] or 0))}% of {base['n']})")
    if v["n"] < 10:
        line += " — too few to call it calibrated"
    return line + "."


_cal: dict = {"at": 0.0, "data": None}
CAL_TTL_S = 6 * 3600
CAL_DAYS = 45


def refresh_calibration(now: _dt.datetime | None = None) -> dict | None:
    """Run in the background loop, never in a request (it replays weeks)."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    by, an, un = _load(now - _dt.timedelta(days=CAL_DAYS))
    first = min((_utc(_get(r, "posted_at")) for rs in by.values() for r in rs), default=None)
    if first is None:
        return None
    start = (first + _dt.timedelta(hours=24)).replace(minute=0, second=0, microsecond=0)
    out = backtest(by, an, un, start, now)
    with _lock:
        _cal.update(at=time.time(), data=out)
    return out


def calibration() -> dict | None:
    with _lock:
        return _cal["data"]


def calibration_due() -> bool:
    with _lock:
        return _cal["data"] is None or time.time() - _cal["at"] > CAL_TTL_S


# ── the signal ────────────────────────────────────────────────────────────

def build_alert(rd: dict, kind: str, now: _dt.datetime) -> dict:
    import telegram_mood_alert as tma
    cc, name = rd["country"], rd["name"]
    lk, d = rd["likelihood"], rd["trend"]["daily"]
    where = tma.centroid(cc)
    if kind == "likely":
        up = lk["announced"]
        places = _listing(sorted({u["city"] or u["place"] for u in up if u["city"] or u["place"]}))
        bits = []
        if lk["calls_24h"]:
            bits.append(f"{_s(lk['calls_24h'], 'call')} to act in {_s(lk['call_channels'], 'channel')} in 24 h")
        if up:
            bits.append(f"{len(up)} dated gathering{'s' if len(up) != 1 else ''}" + (f" in {places}" if places else ""))
        title = f"Demonstrations likely in {name} in the next 48 h — " + ", ".join(bits or lk["reasons"][:1])
        alert_type, rule = ALERT_LIKELY, "telegram_demonstrations_likely"
        reason = f"demonstrations likely in {name}: " + "; ".join(lk["reasons"])
        message = (reason + "." + (f" {lk['forecast']['statement']}. {lk['forecast']['criterion']}." if lk["forecast"] else "")
                   + (f" {calibration_line(calibration(), 'High')}" if calibration() else ""))
        metric = lk["score"]
    else:
        title = (f"Tension rising sharply on Telegram about {name} — hostile posts {_times(d['ratio'])} the "
                 f"two-week share, {d['hostile']} from {d['hostile_channels']} channels in 24 h")
        alert_type, rule = ALERT_TENSION, "telegram_tension_rising_sharply"
        reason = f"tension about {name} on Telegram {d['label']}"
        message = reason + "."
        metric = d["ratio"]
    return {
        "id": f"TGU-{'L' if kind == 'likely' else 'T'}-{cc.upper()}-{now.strftime('%Y%m%d%H%M')}",
        "source": SOURCE, "alert_type": alert_type, "title": title, "severity": "high",
        "lat": where[0] if where else None, "lon": where[1] if where else None,
        "region": name, "country_code": cc.upper(), "entity_type": "country", "entity_id": cc, "entity_name": name,
        "confidence": 0.6, "message": message, "reason": reason,
        "raw": {"rule": rule, "metric": metric, "reason": reason,
                "likelihood": {k: lk[k] for k in ("level", "score", "points", "reasons", "forecast", "citations",
                                                  "calls_24h", "call_channels", "call_ratio", "announced")},
                "trend": rd["trend"], "places": rd.get("places", []),
                "concerns": f"notified to the users with an asset in, a theater over, or an interest in {name}"},
    }


def due(metric: float, previous: list[float]) -> bool:
    """One per country and kind per COOLDOWN_H; inside it, again only if the
    metric has climbed RERAISE_FACTOR× above the last raise."""
    if not previous:
        return True
    return metric >= max(previous) * RERAISE_FACTOR


def previous_from_db(alert_type: str, cc: str, now: _dt.datetime) -> list[float]:
    import json
    from database import Alert, get_db
    since = (now - _dt.timedelta(hours=COOLDOWN_H)).astimezone(_dt.timezone.utc).replace(tzinfo=None)
    out = []
    with get_db() as db:
        for a in db.query(Alert).filter(Alert.alert_type == alert_type, Alert.entity_id == cc.lower(),
                                        Alert.created_at >= since).all():
            try:
                raw = json.loads(a.raw_json or "{}")
                out.append(float((raw.get("raw") or raw).get("metric") or 0))
            except (ValueError, TypeError):
                out.append(0.0)
    return out


def detect(now: _dt.datetime | None = None, readings: dict | None = None, previous=previous_from_db) -> list[dict]:
    """New alerts: a country that crossed into High, or whose tension is
    rising sharply, not on cooldown. Synchronous: run it off the loop."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    readings = readings if readings is not None else evaluate()
    out = []
    for cc, rd in sorted(readings.items()):
        if rd["likelihood"]["level"] == "High" and due(rd["likelihood"]["score"], previous(ALERT_LIKELY, cc, now)):
            out.append(build_alert(rd, "likely", now))
        d = rd["trend"]["daily"]
        if d["sharp"] and due(d["ratio"], previous(ALERT_TENSION, cc, now)):
            out.append(build_alert(rd, "tension", now))
    return out
