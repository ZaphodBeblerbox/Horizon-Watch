"""
general_feed.py — what is generally happening: one chronological feed.

The Desk's "General" tab (desktop and phone) and the phone's replacement
for the footage screen (owner, 2026-10-10): the system's serious signals,
GeoConfirmed's verified events (with the X post each cites, shown as the
post), and the Telegram posts we publish — newest first, one list, read
like a timeline. Paged by time: `before` is the last item's time.

Each source is read with its own indexed range and a limit, then merged;
nothing scans a whole table.
"""
from __future__ import annotations

import re
import sqlite3

KINDS = ("signal", "geoconfirmed", "telegram")
# Events, not detector readings: GPS degradation, position jumps and
# chokepoint counts are thousands a day and would bury everything else.
EVENT_TYPES = ("Multi-source agreement", "imminence", "Heat", "Imagery signal", "surge_velocity_spike", "surge_volume_surge",
               "Sanctioned Vessel", "emergency_squawk", "military_aircraft")
_X = re.compile(r"https?://(?:www\.|mobile\.)?(?:x|twitter)\.com/[^/\s]+/status/\d+", re.I)
_URL = re.compile(r"https?://[^\s,]+")


def _con(db_path: str):
    con = sqlite3.connect(db_path, timeout=30)
    con.row_factory = sqlite3.Row
    try:
        con.execute("CREATE INDEX IF NOT EXISTS ix_telegram_posts_posted ON telegram_posts (posted_at)")
    except sqlite3.OperationalError:
        pass
    return con


def _iso(v) -> str:
    s = str(v or "").replace(" ", "T")
    return s[:19] if s else ""


def _signals(con, before: str, limit: int) -> list[dict]:
    try:
        rows = con.execute(
            "SELECT alert_id, alert_type, title, severity, lat, lon, region, country_code, source, created_at FROM alerts"
            f" WHERE created_at < ? AND lower(coalesce(severity,'')) IN ('critical','high','significant')"
            f" AND alert_type IN ({','.join('?' * len(EVENT_TYPES))})"
            " AND title IS NOT NULL AND title != '' ORDER BY created_at DESC LIMIT ?",
            (before.replace("T", " "), *EVENT_TYPES, limit * 3)).fetchall()
    except sqlite3.OperationalError:
        return []
    out, seen = [], set()
    for r in rows:
        key = (r["title"] or "").strip().lower()
        if key in seen:
            continue                                   # one line per story, not per detector run
        seen.add(key)
        out.append({"id": f"sig:{r['alert_id']}", "kind": "signal", "at": _iso(r["created_at"]), "headline": r["title"],
                    "severity": (r["severity"] or "").lower(), "lat": r["lat"], "lon": r["lon"],
                    "place": r["region"], "source": r["source"] or r["alert_type"], "alert_id": r["alert_id"]})
        if len(out) >= limit:
            break
    return out


def _geoconfirmed(con, before: str, limit: int) -> list[dict]:
    try:
        rows = con.execute(
            "SELECT id, title, name, description, date, latitude, longitude, faction, original_source, theatre_slug, ingested_at"
            " FROM geoconfirmed_placemarks WHERE date < ? ORDER BY date DESC, ingested_at DESC LIMIT ?", (before.replace("T", " "), limit)).fetchall()
    except sqlite3.OperationalError:
        return []
    out = []
    for r in rows:
        src = r["original_source"] or ""
        x = _X.search(src)
        text = re.sub(r"\s+", " ", (r["description"] or "")).strip()
        head = (r["title"] or "").strip() or text[:140] or r["name"]
        out.append({"id": f"gc:{r['id']}", "kind": "geoconfirmed", "at": _iso(r["date"]), "headline": head,
                    "text": text if text != head else "", "lat": r["latitude"], "lon": r["longitude"],
                    "source": "GeoConfirmed", "faction": r["faction"], "theatre": r["theatre_slug"],
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
    """Newest first across the sources; `next` is the cursor for the page after."""
    limit = max(5, min(100, int(limit or 40)))
    cursor = _iso(before) if before else "9999-12-31T23:59:59"
    con = _con(db_path)
    try:
        items = []
        if "signal" in kinds:
            items += _signals(con, cursor, limit)
        if "geoconfirmed" in kinds:
            items += _geoconfirmed(con, cursor, limit)
        if "telegram" in kinds:
            items += _telegram(con, cursor, limit)
    finally:
        con.close()
    items.sort(key=lambda x: x["at"], reverse=True)
    page = items[:limit]
    return {"items": page, "next": page[-1]["at"] if len(page) == limit else None}
