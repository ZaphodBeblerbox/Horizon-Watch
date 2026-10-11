"""
general_feed.py — what is generally happening: one chronological feed.

The Desk's "General" tab (desktop and phone) and the phone's replacement
for the footage screen (owner, 2026-10-10): OUR OWN ALERTS ONLY (owner,
2026-10-11: "the news should exclusively be used for when I click on a
country ... never in the general desk") — imagery signals, heat, sanctioned
vessels confirmed by identifier, loitering, emergencies, fusion of our own
sensors — plus GeoConfirmed's verified events (with the X post each cites,
shown as the post) and the Telegram posts we publish, newest first, one
list, read like a timeline. Paged by time: `before` is the last item's time.

ONE EVENT, ONE CARD: the page is grouped by event_cluster before it is
cut, so four reports of one attack are one card with "+3 reports".

Each source is read with its own indexed range and a limit, then merged;
nothing scans a whole table.
"""
from __future__ import annotations

import json
import re
import sqlite3

import event_cluster

KINDS = ("signal", "geoconfirmed", "telegram")
# OUR OWN DETECTORS' EVENTS — never news. Not here, on purpose:
#   surge_* (a burst of news ARTICLES, surge_engine.py), imminence and
#   forecast_escalation (a model's rate, not an event), GPS degradation,
#   position jumps, dark ships and dual anomalies (thousands of detector
#   readings a day, titled by bare MMSI), military_aircraft (a track),
#   "Sanctioned Vessel (Possible)" (unconfirmed by definition).
EVENT_TYPES = (
    "Imagery signal", "Imagery change", "Heat",                          # satellite: imagery, FIRMS
    "Sanctioned Vessel",                                                  # identifier-confirmed only, see _sanction_ok
    "Russia-linked vessel loitering", "AIS_CHOKEPOINT_ACTIVITY",          # loitering
    "AIS_LOITERING_NEAR_INFRA", "AIS_LOITERING_NEAR_CABLE",
    "ADSB_LOITERING_NEAR_AIRPORT", "ADSB_LOITERING_NEAR_CHOKEPOINT",
    "Ship-to-Ship Transfer",
    "Multi-source agreement",                                             # our sensors agreeing, never with news
    "emergency_squawk",
    # public calls to block named places, from monitored public maps (endangered_places.py)
    "Endangered places: calls to act", "Endangered place: blockade called", "Endangered places: action day",
)
# A sentiment escalation alert from our Telegram reading (another module):
# any alert_type that starts with this is ours.
OWN_TYPE_PREFIXES = ("Telegram mood",)
_NEWS = re.compile(r"\b(gdelt|rss|news)\b", re.I)
_X = re.compile(r"https?://(?:www\.|mobile\.)?(?:x|twitter)\.com/[^/\s]+/status/\d+", re.I)
_URL = re.compile(r"https?://[^\s,]+")
# What a surface-pool / notification source is called when it is our own.
OWN_SOURCES = ("geoconfirmed", "firms", "sat-task", "imagery", "ais", "adsb", "corroborated", "fusion", "telegram",
               "deepstate", "frontline", "overwatch", "public-calls")


def is_news(source=None, alert_type=None, source_type=None) -> bool:
    """True for anything that came from the news (GDELT, RSS, articles)."""
    s = " ".join(str(x or "") for x in (source, source_type)).lower()
    if _NEWS.search(s.replace("_", " ")) or "news" in s:
        return True
    return str(alert_type or "").lower().startswith("surge_")            # article-volume surges


def is_own_source(source=None, source_type=None) -> bool:
    """Our own system's sources (sensors, verified feeds, Telegram) — the
    only ones that reach the General desk and notifications."""
    s = str(source or "").strip().lower()
    if not s or is_news(source, None, None):
        return False
    return any(s.startswith(o) or s == o for o in OWN_SOURCES)


def is_own_alert_type(alert_type) -> bool:
    t = str(alert_type or "")
    return t in EVENT_TYPES or t.startswith(OWN_TYPE_PREFIXES)


def _con(db_path: str):
    con = sqlite3.connect(db_path, timeout=30)
    con.row_factory = sqlite3.Row
    try:
        con.execute("CREATE INDEX IF NOT EXISTS ix_telegram_posts_posted ON telegram_posts (posted_at)")
        con.execute("CREATE INDEX IF NOT EXISTS ix_gc_placemarks_ingested ON geoconfirmed_placemarks (ingested_at)")
    except sqlite3.OperationalError:
        pass
    return con


def _iso(v) -> str:
    """ISO without a zone, to the microsecond when the source has it: a
    GeoConfirmed sync stamps many rows in one second, and a cursor cut to the
    second skipped every one after the first on the next page."""
    s = str(v or "").replace(" ", "T")
    if not s:
        return ""
    return s[:19] + (s[19:26] if s[19:20] == "." else "")


def _sanction_ok(raw_json) -> bool:
    """A sanctioned-vessel alert reaches the desk only when the ship was
    matched by its MMSI or IMO — a name is not an identity (67% of these
    were namesakes before 2026-10-06). New alerts say how they matched
    (payload.match); older ones are checked against the loaded list."""
    try:
        raw = json.loads(raw_json or "{}")
    except (TypeError, ValueError):
        return False
    pay = raw.get("payload") or {}
    match = pay.get("match") or raw.get("match")
    if match:
        return match in ("mmsi", "imo")
    if pay.get("sanctions_confirmed") is False:
        return False
    mmsi = str(raw.get("mmsi") or pay.get("mmsi") or "").strip()
    try:
        from sanctions_loader import sanctions_loader as _sl
        by_mmsi = getattr(_sl, "_sanctions_by_mmsi", None)
    except Exception:                                       # noqa: BLE001
        by_mmsi = None
    if by_mmsi:                                             # the list is loaded in this process
        return bool(mmsi) and mmsi in by_mmsi
    return bool(mmsi)


def _signals(con, before: str, limit: int) -> list[dict]:
    # ONE INDEXED RANGE PER TYPE, newest rowid first. One query with an IN
    # list walked the created_at index backwards through every GPS and
    # dark-ship reading to find a few dozen events: 4.6 s warm on the
    # laptop. Rowid order is creation order (re-sorted below), so the
    # alert_type index answers each type without sorting it.
    cut = before.replace("T", " ")
    cols = "alert_id, alert_type, title, severity, lat, lon, region, country_code, source, created_at, entity_id, raw_json, status"
    rows = []
    try:
        moods = [r[0] for r in con.execute(
            "SELECT DISTINCT alert_type FROM alerts WHERE alert_type >= ? AND alert_type < ?",
            (OWN_TYPE_PREFIXES[0], OWN_TYPE_PREFIXES[0] + "\uffff")).fetchall()]
        for t in (*EVENT_TYPES, *moods):
            rows += con.execute(
                f"SELECT {cols} FROM alerts WHERE alert_type = ? AND created_at < ?"
                " AND title IS NOT NULL AND title != '' ORDER BY id DESC LIMIT ?", (t, cut, limit * 4)).fetchall()
    except sqlite3.OperationalError:
        return []
    rows = [r for r in rows if (r["status"] or "active") == "active"]
    rows.sort(key=lambda r: str(r["created_at"]), reverse=True)
    out, seen = [], set()
    for r in rows:
        sev = (r["severity"] or "").lower()
        mood = str(r["alert_type"]).startswith(OWN_TYPE_PREFIXES)
        if not mood and sev not in ("critical", "high", "significant"):
            continue
        if is_news(r["source"], r["alert_type"]):
            continue
        if r["alert_type"] == "Sanctioned Vessel" and not _sanction_ok(r["raw_json"]):
            continue
        if r["alert_type"] == "Multi-source agreement" and "news" in (r["title"] or "").lower():
            continue                                   # agreement that leans on news is not ours
        key = (r["title"] or "").strip().lower()
        if key in seen:
            continue                                   # one line per story, not per detector run
        seen.add(key)
        out.append({"id": f"sig:{r['alert_id']}", "kind": "signal", "at": _iso(r["created_at"]), "headline": r["title"],
                    "severity": sev, "lat": r["lat"], "lon": r["lon"], "alert_type": r["alert_type"],
                    "place": r["region"], "country_code": r["country_code"], "source": r["source"] or r["alert_type"],
                    "alert_id": r["alert_id"], "entity_id": r["entity_id"],
                    "precise": r["alert_type"] in ("Heat", "Imagery signal", "Imagery change")})
        if len(out) >= limit:
            break
    return out


def _geoconfirmed(con, before: str, limit: int) -> list[dict]:
    try:
        rows = con.execute(
            # by when it was PUBLISHED (ingested), not the event's day: a day
            # carries no time, so every verified event sorted at midnight,
            # beneath everything else that day, and never reached the top
            "SELECT id, title, name, description, date, latitude, longitude, faction, original_source, theatre_slug, ingested_at"
            " FROM geoconfirmed_placemarks WHERE ingested_at < ? AND coalesce(status, 'active') = 'active'"
            " ORDER BY ingested_at DESC LIMIT ?", (before.replace("T", " "), limit)).fetchall()
    except sqlite3.OperationalError:
        return []
    out = []
    for r in rows:
        src = r["original_source"] or ""
        x = _X.search(src)
        text = re.sub(r"\s+", " ", (r["description"] or "")).strip()
        head = (r["title"] or "").strip() or text[:140] or r["name"]
        out.append({"id": f"gc:{r['id']}", "kind": "geoconfirmed", "at": _iso(r["ingested_at"] or r["date"]), "event_date": str(r["date"] or "")[:10], "headline": head,
                    "text": text if text != head else "", "lat": r["latitude"], "lon": r["longitude"],
                    "source": "GeoConfirmed", "faction": r["faction"], "theatre": r["theatre_slug"], "precise": True,
                    "x_url": x.group(0) if x else None,
                    "url": x.group(0) if x else (_URL.search(src).group(0) if _URL.search(src) else None)})
    return out


def _telegram(con, before: str, limit: int) -> list[dict]:
    try:
        rows = con.execute(
            "SELECT channel, msg_id, channel_title, posted_at, headline, summary_en, text, media, thumb, place, country_code, lat, lon,"
            " event_type, role, graphic FROM telegram_posts WHERE posted_at < ? AND relevant = 1 AND headline IS NOT NULL"
            " AND coalesce(unpublished_reason, '') = '' ORDER BY posted_at DESC LIMIT ?", (before, limit)).fetchall()
    except sqlite3.OperationalError:
        return []
    out = []
    for r in rows:
        chan = r["channel"]
        out.append({"id": f"{chan}/{r['msg_id']}", "kind": "telegram", "at": _iso(r["posted_at"]), "headline": r["headline"],
                    "text": r["summary_en"] or "", "channel": chan, "msg_id": r["msg_id"], "channel_title": r["channel_title"] or chan,
                    "media": r["media"], "thumb_url": f"/api/telegram/media/{r['thumb']}" if r["thumb"] else None,
                    "place": r["place"], "country_code": r["country_code"], "lat": r["lat"], "lon": r["lon"],
                    "event_type": r["event_type"], "role": r["role"], "graphic": bool(r["graphic"]),
                    "url": f"https://t.me/{chan}/{r['msg_id']}" if not chan.startswith("c/") else None})
    return out


def feed(db_path: str, before: str | None = None, limit: int = 40, kinds: tuple = KINDS) -> dict:
    """Newest first across the sources, one card per event; `next` is the
    cursor for the page after."""
    limit = max(5, min(100, int(limit or 40)))
    cursor = _iso(before) if before else "9999-12-31T23:59:59"
    con = _con(db_path)
    try:
        fetched = []                                   # (items, was the source's page full?)
        if "signal" in kinds:
            got = _signals(con, cursor, limit)
            fetched.append((got, len(got) >= limit))
        if "geoconfirmed" in kinds:
            got = _geoconfirmed(con, cursor, limit)
            fetched.append((got, len(got) >= limit))
        if "telegram" in kinds:
            got = _telegram(con, cursor, limit)
            fetched.append((got, len(got) >= limit))
    finally:
        con.close()
    # Complete only down to the oldest item of the source that filled its
    # page: below that, that source may have more we did not read.
    floor = max((min(i["at"] for i in got) for got, full in fetched if full and got), default="")
    items = [i for got, _ in fetched for i in got if i["at"] >= floor]
    more = any(full for _, full in fetched)
    events = event_cluster.cluster(items, source_of=_source_label)
    for e in events:
        if e.get("also"):
            e["at"] = max([e["at"], *(a["at"] or "" for a in e["also"])])    # sorted by the latest report
    events.sort(key=lambda x: x["at"], reverse=True)
    page = events[:limit]
    for e in page:
        e.pop("precise", None)
    nxt = page[-1]["at"] if page and (len(events) > limit or more) else None
    return {"items": page, "next": nxt}


def _source_label(d: dict) -> str:
    if d.get("kind") == "telegram":
        return d.get("channel_title") or d.get("channel") or "Telegram"
    if d.get("kind") == "geoconfirmed":
        return "GeoConfirmed"
    return str(d.get("alert_type") or d.get("source") or "Alert")
