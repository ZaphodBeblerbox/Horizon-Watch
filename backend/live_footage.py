"""live_footage.py — Home's "Live footage": the newest Telegram videos, one strip.

The owner (2026-10-18): "'Live from Telegram' and 'From the ground' should
just be replaced by one unified feed I can swipe sideways to show the latest
Telegram videos."

One list, built here once for everyone:

  * every post with a picture or a video of the last two days that passed
    relevance, plus the footage of street reports ("ça gaze à Répu" and the
    video right after it) and of self-reported positions ("on est à
    Concorde"), which the relevance screen alone would leave out — those
    carry `on_ground`;
  * the same video once: a forward keeps Telegram's own media id
    (`media_key`, telegram_ingest), and older rows without it fall back to
    the same kind of media with the same words; the first post is kept and
    the other chats are listed under `also_in`;
  * videos lead, newest first; pictures follow only while there are few
    videos (MIN_VIDEOS).

Nothing is downloaded here: the thumbnails are the ones ingest already keeps
(/api/telegram/media/…), and a video is fetched only when someone opens it
(/api/telegram/video/…, held half an hour).

MULTI-USER LOAD: Home polls this every 20 s on every phone and desktop. The
result is cached CACHE_S for all users, and one lock makes concurrent misses
wait for a single build instead of each building it (single flight). The
endpoint answers a fresh cache straight from the event loop (`cached`) and
builds only in the executor.
"""
from __future__ import annotations

import datetime as _dt
import re
import sqlite3
import threading
import time

CACHE_S = 20
HOURS = 48
MAX_ITEMS = 40
MIN_VIDEOS = 6           # fewer videos than this: pictures follow them
ROWS = 600               # newest media rows read per build

_lock = threading.Lock()
_cache: dict = {}

_URL = re.compile(r"https?://\S+|t\.me/\S+|@\w+")
_NONWORD = re.compile(r"[^\w]+", re.UNICODE)


def norm_text(text: str | None) -> str:
    """Words only, for telling a repost by its caption: links, @handles,
    punctuation and case dropped."""
    t = _URL.sub(" ", str(text or "")).lower()
    return _NONWORD.sub(" ", t).strip()[:160]


def dedup_key(it: dict) -> str | None:
    """What makes two posts the same footage: Telegram's media id when
    known, else the same kind of media under the same (long enough) words."""
    if it.get("media_key"):
        return f"m:{it['media_key']}"
    words = norm_text(it.get("text"))
    if len(words) >= 12:
        return f"t:{it.get('media')}:{words}"
    return None


def order(items: list[dict], limit: int = MAX_ITEMS) -> list[dict]:
    """Videos newest first; pictures after them only while videos are few."""
    by_time = lambda x: x.get("posted_at") or ""                       # noqa: E731
    vids = sorted((x for x in items if x.get("media") == "video"), key=by_time, reverse=True)
    pics = sorted((x for x in items if x.get("media") == "photo"), key=by_time, reverse=True)
    out = vids if len(vids) >= MIN_VIDEOS else vids + pics
    return out[:limit]


def _clean_place(p: str | None) -> str | None:
    p = str(p or "").strip()
    return None if not p or p.lower() in ("none", "null", "unknown") else p


def ground_index(street: list[dict], signals: list[dict]) -> dict:
    """(channel, msg_id) → what was said on the ground about that message:
    street reports (each source) and self-reported positions (signals of
    kind `at`)."""
    out: dict = {}
    for s in street or []:
        for src in s.get("sources") or []:
            out[(src.get("channel"), src.get("msg_id"))] = {
                "kind": "street_report", "place": s.get("place"), "lat": s.get("lat"), "lon": s.get("lon"),
                "caption": (src.get("translation") or "").strip() or s.get("headline"), "headline": s.get("headline")}
    for s in signals or []:
        if s.get("signal_kind") != "at":
            continue
        for src in s.get("sources") or []:
            out.setdefault((src.get("channel"), src.get("msg_id")), {
                "kind": "position", "place": s.get("place"), "lat": s.get("lat"), "lon": s.get("lon"),
                "caption": s.get("headline"), "headline": s.get("headline")})
    return out


def _ground_of(r: dict, ground: dict) -> dict | None:
    g = ground.get((r["channel"], r["msg_id"]))
    if g:
        return g
    # Telegram sends the words and the video as two messages: a captionless
    # picture or video just after a ground message is that message's footage.
    if not str(r.get("text") or "").strip():
        for k in (1, 2, 3):
            g = ground.get((r["channel"], r["msg_id"] - k))
            if g:
                return g
    return None


def item_of(r: dict, g: dict | None) -> dict:
    """One row (and what the ground said about it) as a card."""
    chan = r["channel"]
    place = _clean_place(r.get("place")) or (_clean_place(g.get("place")) if g else None)
    lat, lon = r.get("lat"), r.get("lon")
    if lat is None and g and g.get("lat") is not None:
        lat, lon = g["lat"], g["lon"]
    text = str(r.get("text") or "").strip()
    caption = (r.get("headline") or (g or {}).get("caption") or r.get("summary_en") or text or "").strip()
    return {
        "id": f"tg-{chan}-{r['msg_id']}", "channel": chan, "msg_id": r["msg_id"],
        "channel_title": r.get("channel_title") or chan, "posted_at": r["posted_at"],
        "media": r["media"], "media_key": r.get("media_key"), "duration": r.get("duration"),
        "thumb_url": f"/api/telegram/media/{r['thumb']}" if r.get("thumb") else None,
        "caption": caption.replace("\n", " ")[:220], "headline": r.get("headline"), "summary_en": r.get("summary_en"),
        "text": text[:400], "lang": r.get("lang"),
        "place": place, "lat": lat, "lon": lon, "country_code": r.get("country_code"),
        "graphic": bool(r.get("graphic")), "event_type": r.get("event_type"),
        "on_ground": bool(g), "ground_kind": g["kind"] if g else None,
        "url": None if str(chan).startswith("c/") else f"https://t.me/{chan}/{r['msg_id']}",
        "also_in": [],
    }


def build(rows: list[dict], ground: dict, limit: int = MAX_ITEMS) -> list[dict]:
    """Rows (telegram_posts with media and a thumbnail) → the strip. Pure."""
    kept: list[dict] = []
    by_key: dict = {}
    seen_ids: set = set()
    # oldest first, so the first post of a video is the one kept
    for r in sorted(rows, key=lambda x: x.get("posted_at") or ""):
        if r.get("media") not in ("video", "photo") or not r.get("thumb"):
            continue
        if (r.get("role") or "") == "ignore" or ((r.get("role") == "official") and r.get("claim")):
            continue
        g = _ground_of(r, ground)
        if not (r.get("relevant") == 1 or g):
            continue
        it = item_of(r, g)
        if it["id"] in seen_ids:
            continue
        seen_ids.add(it["id"])
        k = dedup_key({**it, "text": r.get("text")})
        first = by_key.get(k) if k else None
        if first:
            if it["channel_title"] != first["channel_title"] and it["channel_title"] not in first["also_in"]:
                first["also_in"].append(it["channel_title"])
            # the copy may know what the first did not
            for f in ("place", "lat", "lon", "duration"):
                if first.get(f) is None and it.get(f) is not None:
                    first[f] = it[f]
            if not first["on_ground"] and it["on_ground"]:
                first["on_ground"], first["ground_kind"] = True, it["ground_kind"]
            if first["graphic"] or it["graphic"]:
                first["graphic"] = True
            continue
        if k:
            by_key[k] = it
        kept.append(it)
    return order(kept, limit)


def _rows(hours: int) -> list[dict]:
    import telegram_ingest as tg
    cutoff = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(hours=hours)).isoformat()
    con = tg._con()
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute(
            "SELECT * FROM telegram_posts WHERE posted_at >= ? AND media IN ('video','photo') AND thumb IS NOT NULL"
            " AND COALESCE(role,'') != 'ignore' ORDER BY posted_at DESC LIMIT ?", (cutoff, ROWS)).fetchall()
    finally:
        con.close()
    out = []
    for r in rows:
        d = dict(r)
        d["graphic"] = tg._is_graphic(r)
        out.append(d)
    return out


def _ground(hours: int) -> dict:
    street, sigs = [], []
    try:
        import street_reports
        street = street_reports.posts(min(max(hours, 1), street_reports.LOOKBACK_H))
    except Exception as e:                                      # noqa: BLE001
        print(f"[live-footage] error: street reports: {type(e).__name__}: {e}", flush=True)
    try:
        import telegram_signals
        sigs = telegram_signals.posts(max(hours, 1))
    except Exception as e:                                      # noqa: BLE001
        print(f"[live-footage] error: position signals: {type(e).__name__}: {e}", flush=True)
    return ground_index(street, sigs)


def cached(hours: int = HOURS, limit: int = MAX_ITEMS) -> dict | None:
    """The answer if one younger than CACHE_S is held; else None. Cheap: safe
    on the event loop."""
    hit = _cache.get((hours, limit))
    if hit and time.time() - hit[0] < CACHE_S:
        return hit[1]
    return None


def footage(hours: int = HOURS, limit: int = MAX_ITEMS) -> dict:
    """The strip, cached CACHE_S for everyone; one build at a time."""
    got = cached(hours, limit)
    if got is not None:
        return got
    with _lock:
        got = cached(hours, limit)            # built while this one waited
        if got is not None:
            return got
        items = build(_rows(hours), _ground(hours), limit)
        out = {"items": items, "built_at": _dt.datetime.now(_dt.timezone.utc).isoformat(), "cache_s": CACHE_S}
        _cache[(hours, limit)] = (time.time(), out)
        return out
