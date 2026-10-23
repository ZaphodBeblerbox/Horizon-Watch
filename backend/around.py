"""
around.py — everything relevant around a point someone clicked (owner, 2026-10-23: "clicking a point must show
everything relevant around it ... right now it feels empty").

For a point (a live signal, an event, a post) at a place and a time: the other reports of the same event (its
members), then the related items near it in space and time from every domain we hold — live signals, Telegram
posts, news, fires, imagery, fusion points, alerts, vessels and aircraft there now — ranked and deduplicated.

THE RANK (pure, derived on read): closeness in space x closeness in time x the domain's weight, with a bonus for
what is graver (critical / high) and for a different domain than the clicked one (one modality corroborating
another, Dataminr's logic). Each row says why it is there: "1.2 km away · 14 min before".
DEDUPLICATED: one row per thing (the same headline at the same place is one row, the newest kept).
"""
from __future__ import annotations

import datetime as _dt
import math
import re

DEFAULT_KM = 5.0
DEFAULT_HOURS = 6.0
LIMIT = 30
# how much a domain says about an incident on the ground, at equal distance and time
WEIGHT = {"live_signal": 1.0, "telegram": 0.8, "fire": 0.9, "imagery": 0.8, "fusion": 0.9, "alert": 0.7, "news": 0.7,
          "vessel": 0.4, "aircraft": 0.4}
DOMAIN_LABEL = {"live_signal": "Live signal", "telegram": "Telegram", "fire": "Satellite fire detection", "imagery": "Imagery",
                "fusion": "Fusion point", "alert": "Alert", "news": "News", "vessel": "Vessel", "aircraft": "Aircraft"}
SEV_BONUS = {"critical": 0.3, "high": 0.15}


def km(a_lat, a_lon, b_lat, b_lon) -> float:
    r = math.radians
    h = (math.sin(r(b_lat - a_lat) / 2) ** 2 + math.cos(r(a_lat)) * math.cos(r(b_lat)) * math.sin(r(b_lon - a_lon) / 2) ** 2)
    return 12742 * math.asin(math.sqrt(min(1.0, h)))


def _utc(v) -> _dt.datetime | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        try:
            return _dt.datetime.fromtimestamp(float(v), _dt.timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    if isinstance(v, _dt.datetime):
        return v if v.tzinfo else v.replace(tzinfo=_dt.timezone.utc)
    try:
        t = _dt.datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=_dt.timezone.utc)


def _norm(s: str | None) -> str:
    import unicodedata
    t = unicodedata.normalize("NFKD", s or "")
    t = "".join(c for c in t if not unicodedata.combining(c)).lower()
    return re.sub(r"[^\w]+", " ", t).strip()


def _gap(t: _dt.datetime | None, t0: _dt.datetime) -> str:
    if not t:
        return "time unknown"
    m = (t - t0).total_seconds() / 60
    if abs(m) < 1:
        return "same minute"
    a = abs(m)
    word = f"{int(round(a))} min" if a < 90 else f"{a / 60:.1f} h"
    return f"{word} {'after' if m > 0 else 'before'}"


def rank(center: dict, items: list[dict], now: _dt.datetime | None = None, radius_km: float = DEFAULT_KM,
         hours: float = DEFAULT_HOURS, exclude_refs=(), limit: int = LIMIT) -> list[dict]:
    """items: [{id, domain, title, lat, lon, at, url?, source?, sev?, ref?}] → the ranked rows within radius_km and
    `hours` of the centre (centre: {lat, lon, at, domain})."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    t0 = _utc(center.get("at")) or now
    lat0, lon0 = float(center["lat"]), float(center["lon"])
    excl = set(exclude_refs or ())
    rows = []
    for it in items:
        if it.get("lat") is None or it.get("lon") is None or not it.get("title"):
            continue
        if it.get("ref") in excl or it.get("id") in excl:
            continue
        try:
            d = km(lat0, lon0, float(it["lat"]), float(it["lon"]))
        except (TypeError, ValueError):
            continue
        if d > radius_km:
            continue
        t = _utc(it.get("at"))
        moving = it["domain"] in ("vessel", "aircraft")         # traffic is "there now", not "at that time"
        dt_h = abs((t - t0).total_seconds()) / 3600 if t else hours / 2
        if not moving and dt_h > hours:
            continue
        space = 1 - d / radius_km
        time = 1 - min(dt_h, hours) / hours if not moving else 0.5
        s = WEIGHT.get(it["domain"], 0.5) * (0.35 + 0.65 * space) * (0.35 + 0.65 * time)
        s += SEV_BONUS.get(str(it.get("sev") or "").lower(), 0.0)
        if it["domain"] != center.get("domain"):
            s += 0.1
        dist = "under 100 m" if d < 0.1 else (f"{int(round(d * 1000, -1))} m" if d < 1 else f"{d:.1f} km")
        rows.append({**it, "km": round(d, 2), "score": round(s, 4), "domain_label": DOMAIN_LABEL.get(it["domain"], it["domain"]),
                     "why": f"{dist} away · {_gap(t, t0) if not moving else 'there now'}"})
    rows.sort(key=lambda r: -r["score"])
    out, seen = [], []
    for r in rows:
        key = _norm(r["title"])[:80]
        if any(key == k and abs(r["km"] - kk) < 0.5 for k, kk in seen):
            continue
        seen.append((key, r["km"]))
        out.append(r)
        if len(out) >= limit:
            break
    return out


# ── adapters: what each domain looks like as a row ─────────────────────────

def from_signal(s: dict) -> dict:
    return {"id": s.get("id"), "domain": "live_signal", "title": s.get("title"), "lat": s.get("lat"), "lon": s.get("lon"),
            "at": s.get("event_time"), "url": ((s.get("sources") or [{}])[0] or {}).get("url"), "source": (s.get("corroboration") or {}).get("line"),
            "sev": "high" if s.get("high_impact") and not s.get("muted") else None, "event_id": s.get("event_id"),
            "refs": s.get("refs")}


def from_post(p: dict) -> dict:
    return {"id": f"tg-{p.get('channel')}-{p.get('msg_id')}", "ref": f"tg:{p.get('channel')}:{p.get('msg_id')}", "domain": "telegram",
            "title": p.get("headline") or (p.get("summary_en") or p.get("text") or "")[:140], "lat": p.get("lat"), "lon": p.get("lon"),
            "at": p.get("event_time") or p.get("posted_at"), "url": p.get("url") or (f"https://t.me/{p['channel']}/{p['msg_id']}"
                                                                                      if p.get("channel") and p.get("msg_id") else None),
            "source": p.get("channel_title")}


def from_surface(it: dict) -> dict:
    st = str(it.get("source_type") or it.get("type") or "").lower()
    dom = "fusion" if "fusion" in st else ("fire" if "firms" in st or "heat" in st else "news")
    return {"id": it.get("id"), "domain": dom, "title": it.get("headline") or it.get("title"), "lat": it.get("lat"),
            "lon": it.get("lon") if it.get("lon") is not None else it.get("lng"),
            "at": it.get("published_at") or it.get("timestamp") or it.get("created_at"), "url": it.get("url") or it.get("link"),
            "source": it.get("source") or it.get("source_name"), "sev": it.get("severity_tier") or it.get("severity")}


ALERT_DOMAIN = {"Heat": "fire", "Imagery signal": "imagery", "Imagery change": "imagery", "Multi-source agreement": "fusion"}


def from_alert(a: dict) -> dict:
    return {"id": a.get("alert_id"), "domain": ALERT_DOMAIN.get(a.get("alert_type"), "alert"), "title": a.get("title"),
            "lat": a.get("lat"), "lon": a.get("lon"), "at": a.get("created_at"), "source": a.get("alert_type"),
            "sev": a.get("severity")}


def from_vessel(v: dict) -> dict:
    name = v.get("name") or v.get("shipname") or f"MMSI {v.get('mmsi')}"
    kind = v.get("ship_type_label") or v.get("ship_type") or v.get("type") or "vessel"
    return {"id": f"ais-{v.get('mmsi')}", "domain": "vessel", "title": f"{name} ({kind})", "lat": v.get("lat"), "lon": v.get("lon"),
            "at": v.get("ts") or v.get("last_seen") or v.get("timestamp"), "source": "AIS", "mmsi": v.get("mmsi")}


def from_aircraft(a: dict) -> dict:
    cs = (a.get("flight") or a.get("callsign") or a.get("icao") or a.get("hex") or "").strip()
    kind = "military aircraft" if a.get("military") or a.get("is_military") else (a.get("t") or a.get("type") or "aircraft")
    return {"id": f"adsb-{a.get('icao') or a.get('hex')}", "domain": "aircraft", "title": f"{cs or 'Aircraft'} ({kind})",
            "lat": a.get("lat"), "lon": a.get("lon"), "at": a.get("seen_at") or a.get("ts"), "source": "ADS-B",
            "sev": "high" if a.get("military") or a.get("is_military") else None}
