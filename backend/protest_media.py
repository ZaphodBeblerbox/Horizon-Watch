"""
protest_media.py — the photos and videos that go with an announced protest,
and a vision model's crowd estimate on the best of them (owner, 2026-10-18:
"be able to ingest the photos and videos that go with it, with crowd
estimations").

LINKING (link_media, pure). A Telegram post with a photo or a video belongs
to a protest when it was posted inside the protest's time (from EARLY_MIN
before the start to TAIL_MIN after its end — or now, while it goes on) and:
  · it is located (lat/lon, site/street/district) within the protest's
    radius (600 m; 1.5 km for a march, which moves); or
  · its words name the place (protest_status.place_in: the gazetteer of
    squares in Paris, Tirana, Rome, Milan, Buenos Aires …) within the radius;
  · or it is captionless footage sent right after such a post in the same
    chat (Telegram sends the words and the video as two messages: ≤ 3
    messages and ≤ 3 minutes later) — the same rule street_reports uses.
Newest first, each with its chat, link and time; at most MAX_MEDIA.

Nothing is downloaded here, and nothing is stored on this machine: a photo
is the thumbnail ingestion already keeps (data/telegram/media, on the
server), a video plays through /api/telegram/video (fetched when opened,
pruned after 30 min).

THE VISION ESTIMATE (vision_for). The best photos of a protest (photos
before video stills, the closest and newest; at most PER_PROTEST_IMAGES per
protest in any VISION_WINDOW_S, MAX_PER_HOUR in all) go to the cheap model
through openai_gate (purpose ENRICH, its monthly budget a hard stop) with
one question: how many people does this picture show, and is it a crowd at
all. The answer is cached per media id in SQLite (protest_vision): the
model's reading is the expensive input and is kept; the range shown is
derived from it on every read. Requests run on ONE background thread — a
read never waits for the model, and the next poll has the answer. A failure
is cached too (retried after RETRY_S) and the estimate falls back to the
figures stated in posts; with no key, no budget or no image, the photos are
simply not a basis ("from 2 reports").
"""
from __future__ import annotations

import base64
import collections
import datetime as _dt
import json
import os
import queue
import sqlite3
import threading
import time

import protest_status as ps

EARLY_MIN = 60
TAIL_MIN = 90
MAX_MEDIA = 24
FOOTAGE_GAP_MSGS = 3
FOOTAGE_GAP_S = 180
PER_PROTEST_IMAGES = 3
VISION_WINDOW_S = 600
MAX_PER_HOUR = 30
RETRY_S = 1800
QUEUE_MAX = 60
PRECISE = {"site", "street", "district"}


def media_id(channel, msg_id) -> str:
    return f"{channel}/{msg_id}"


def _video_url(channel: str, msg_id) -> str:
    ch = str(channel)
    seg = f"-100{ch[2:]}" if ch.startswith("c/") else ch
    return f"/api/telegram/video/{seg}/{msg_id}"


def _place_of(r: dict, text: str) -> tuple[dict | None, str | None]:
    if r.get("lat") is not None and (r.get("precision") or "") in PRECISE:
        return {"lat": r["lat"], "lon": r["lon"], "name": r.get("place")}, "located"
    if text.strip():
        pl = ps.place_in(text)
        if pl:
            return {"lat": pl["lat"], "lon": pl["lon"], "name": pl["name"]}, "names the place"
    return None, None


def media_pool(posts: list[dict], now: _dt.datetime) -> list[dict]:
    """Every post with a photo or a video, placed where it can be: its own
    coordinates when precise, the place its words name, or — captionless —
    the place of the post just before it in the same chat."""
    by_chat: dict = {}
    for r in sorted(posts, key=lambda r: (r.get("channel") or "", r.get("msg_id") or 0)):
        by_chat.setdefault(r.get("channel"), []).append(r)
    out = []
    for chan, rows in by_chat.items():
        prev = None                                            # the last post in this chat with words
        for r in rows:
            m = (r.get("media") or "none")
            text = " ".join(x for x in (r.get("text"), r.get("summary_en")) if x)
            if text.strip():
                prev = r
            if m not in ("photo", "video"):
                continue                                       # its place is read only if footage follows
            place, how = _place_of(r, text)
            if place is None and not text.strip() and prev is not None \
                    and 0 < (r.get("msg_id") or 0) - prev["msg_id"] <= FOOTAGE_GAP_MSGS:
                t0, t1 = ps._utc(prev.get("posted_at")), ps._utc(r.get("posted_at"))
                if t0 and t1 and 0 <= (t1 - t0).total_seconds() <= FOOTAGE_GAP_S:
                    pp, _how = _place_of(prev, " ".join(x for x in (prev.get("text"), prev.get("summary_en")) if x))
                    if pp is not None:
                        place, how = pp, "footage sent after a report"
            if place is None:
                continue
            thumb = r.get("thumb")
            if m == "photo" and not thumb:
                continue
            out.append({"id": media_id(chan, r.get("msg_id")), "type": m, "channel": chan, "msg_id": r.get("msg_id"),
                        "chat": r.get("channel_title") or chan, "at": r.get("posted_at"),
                        "lat": place["lat"], "lon": place["lon"], "how": how,
                        "thumb": thumb, "thumb_url": f"/api/telegram/media/{thumb}" if thumb else None,
                        "video_url": _video_url(chan, r.get("msg_id")) if m == "video" else None,
                        "url": None if str(chan).startswith("c/") else f"https://t.me/{chan}/{r.get('msg_id')}",
                        "text": (text or "")[:200]})
    return out


def link_media(p: dict, status: dict, pool: list[dict], now: _dt.datetime) -> list[dict]:
    """The media of the pool inside the protest's radius and time, newest first."""
    start, end, approx = ps.window(p)
    if not start or p.get("lat") is None:
        return []
    lo = start - _dt.timedelta(minutes=EARLY_MIN)
    if approx:
        lo = start - _dt.timedelta(hours=6)
    until = ps._utc(status.get("until")) if status else None
    last = ps._utc(status.get("last_report_at")) if status else None
    hi = max(x for x in (end, until, last, start) if x) + _dt.timedelta(minutes=TAIL_MIN)
    hi = min(hi, now + _dt.timedelta(minutes=2))
    r = p.get("radius_m") or ps.radius_for(p.get("kind") or "other")
    out, seen = [], set()
    for m in pool:
        t = ps._utc(m.get("at"))
        if not t or t < lo or t > hi or m["id"] in seen:
            continue
        d = ps.metres(p["lat"], p["lon"], m["lat"], m["lon"])
        if d > r:
            continue
        seen.add(m["id"])
        tz = ps.zone_of(p.get("cc"), p.get("tz"))
        out.append({k: v for k, v in m.items() if k not in ("thumb",)} | {"distance_m": round(d), "hhmm": ps.hhmm(t, tz)})
    out.sort(key=lambda m: m["at"], reverse=True)
    return out[:MAX_MEDIA]


# ── the vision estimate ─────────────────────────────────────────────────────

VISION_SYSTEM = """You look at one photo from a street demonstration posted on Telegram, for a
situation map. Say how many people the photo SHOWS (not the whole event), as a range.
crowd_scene is false for anything that is not people gathered outdoors: a selfie, a portrait,
a meme, a screenshot, a poster or flyer, a document, police alone, an empty street, a video
call. Count only what you can see; a dense crowd filling the frame to the horizon is large.
Return JSON {"crowd_scene": true|false, "visible_low": int, "visible_high": int,
"density": "sparse"|"moderate"|"dense"|"packed", "note": "under 12 words"}."""


def _con():
    import telegram_ingest as tg
    con = sqlite3.connect(tg._db_path(), timeout=30)
    con.execute("CREATE TABLE IF NOT EXISTS protest_vision (media_id TEXT PRIMARY KEY, at TEXT, ok INTEGER,"
                " crowd_scene INTEGER, low INTEGER, high INTEGER, density TEXT, note TEXT, model TEXT, error TEXT)")
    return con


_cache: dict = {}                    # media_id → row (dict); None while unknown
_cache_lock = threading.Lock()
_loaded = [False]
_q: queue.Queue = queue.Queue(maxsize=QUEUE_MAX)
_queued: set = set()
_sent_by_protest: dict = collections.defaultdict(collections.deque)
_sent_all: collections.deque = collections.deque()
_thread: list = [None]
STATS = {"queued": 0, "asked": 0, "ok": 0, "failed": 0, "no_model": 0, "no_image": 0}
# Tests replace this: (image_bytes, media) → {"crowd_scene", "visible_low", "visible_high", "density", "note"}
_model_call = None


def _load_cache() -> None:
    if _loaded[0]:
        return
    try:
        con = _con()
        try:
            con.row_factory = sqlite3.Row
            rows = [dict(r) for r in con.execute("SELECT * FROM protest_vision")]
        finally:
            con.close()
    except Exception as e:                                     # noqa: BLE001
        print(f"[protest-media] error: vision cache: {type(e).__name__}: {e}", flush=True)
        rows = []
    with _cache_lock:
        for r in rows:
            _cache[r["media_id"]] = r
        _loaded[0] = True


def _store(row: dict) -> None:
    with _cache_lock:
        _cache[row["media_id"]] = row
    try:
        con = _con()
        try:
            con.execute("INSERT OR REPLACE INTO protest_vision (media_id, at, ok, crowd_scene, low, high, density, note, model, error)"
                        " VALUES (:media_id, :at, :ok, :crowd_scene, :low, :high, :density, :note, :model, :error)", row)
            con.commit()
        finally:
            con.close()
    except Exception as e:                                     # noqa: BLE001
        print(f"[protest-media] error: vision store: {type(e).__name__}: {e}", flush=True)


def cached(mid: str) -> dict | None:
    with _cache_lock:
        return _cache.get(mid)


def image_path(m: dict) -> str | None:
    if not m.get("thumb"):
        return None
    try:
        import telegram_ingest as tg
        path = os.path.join(tg.MEDIA_DIR, m["thumb"])
    except Exception:                                          # noqa: BLE001
        return None
    return path if os.path.exists(path) else None


def _ask_model(img: bytes, m: dict) -> dict:
    """One photo → the model's reading. Raises when there is no model."""
    if _model_call is not None:
        return _model_call(img, m)
    import openai_gate
    client = openai_gate.get_client(openai_gate.ENRICH)
    if client is None:
        raise RuntimeError("no model (purpose off, no key, or the month's budget spent)")
    model = openai_gate.model_for(openai_gate.ENRICH)
    b64 = base64.b64encode(img).decode()
    resp = client.chat.completions.create(
        model=model, temperature=0, max_tokens=120, response_format={"type": "json_object"},
        messages=[{"role": "system", "content": VISION_SYSTEM},
                  {"role": "user", "content": [
                      {"type": "text", "text": f"Photo posted by {m.get('chat')}: {(m.get('text') or '')[:200]}"},
                      {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "low"}}]}])
    u = getattr(resp, "usage", None)
    if u:
        try:
            import usage_tracker
            usage_tracker.record_call(input_tokens=u.prompt_tokens, output_tokens=u.completion_tokens,
                                      call_type="telegram", model=model, headline="protest crowd estimate · 1 photo",
                                      item_id=m.get("id") or "")
        except Exception:                                      # noqa: BLE001
            pass
    return json.loads(resp.choices[0].message.content or "{}")


def _int(v) -> int | None:
    try:
        return max(0, int(round(float(v))))
    except (TypeError, ValueError):
        return None


def run_one(m: dict, img: bytes | None = None) -> dict:
    """Ask about one photo and cache the answer (or the failure)."""
    row = {"media_id": m["id"], "at": ps.iso(_dt.datetime.now(_dt.timezone.utc)), "ok": 0, "crowd_scene": None,
           "low": None, "high": None, "density": None, "note": None, "model": None, "error": None}
    if img is None:
        path = image_path(m)
        if not path:
            STATS["no_image"] += 1
            row["error"] = "no image on this machine"
            _store(row)
            return row
        with open(path, "rb") as fh:
            img = fh.read()
    STATS["asked"] += 1
    try:
        x = _ask_model(img, m)
        lo, hi = _int(x.get("visible_low")), _int(x.get("visible_high"))
        if lo is not None and hi is not None and hi < lo:
            lo, hi = hi, lo
        row.update(ok=1, crowd_scene=1 if x.get("crowd_scene") else 0, low=lo, high=hi,
                   density=str(x.get("density") or "")[:12] or None, note=str(x.get("note") or "")[:120] or None,
                   model="stub" if _model_call is not None else "openai")
        STATS["ok"] += 1
    except Exception as e:                                     # noqa: BLE001
        msg = f"{type(e).__name__}: {e}"[:200]
        row["error"] = msg
        if "no model" in msg:
            STATS["no_model"] += 1
        else:
            STATS["failed"] += 1
            print(f"[protest-media] error: vision {m['id']}: {msg}", flush=True)
    _store(row)
    return row


def _worker() -> None:
    while True:
        m = _q.get()
        try:
            run_one(m)
        except Exception as e:                                 # noqa: BLE001
            print(f"[protest-media] error: worker: {type(e).__name__}: {e}", flush=True)
        finally:
            _queued.discard(m["id"])


def _start_thread() -> None:
    if _thread[0] is None or not _thread[0].is_alive():
        t = threading.Thread(target=_worker, name="protest-vision", daemon=True)
        _thread[0] = t
        t.start()


def best_photos(media: list[dict], n: int = PER_PROTEST_IMAGES * 2) -> list[dict]:
    """Photos before video stills, closest first, then newest."""
    cands = [m for m in media if m.get("thumb_url")]
    cands.sort(key=lambda m: (0 if m["type"] == "photo" else 1, (m.get("distance_m") or 0) // 200, -(ps._utc(m["at"]).timestamp())))
    return cands[:n]


def _may_send(pid: str, now_s: float) -> bool:
    dq = _sent_by_protest[pid]
    while dq and now_s - dq[0] > VISION_WINDOW_S:
        dq.popleft()
    while _sent_all and now_s - _sent_all[0] > 3600:
        _sent_all.popleft()
    return len(dq) < PER_PROTEST_IMAGES and len(_sent_all) < MAX_PER_HOUR


def enqueue(pid: str, m: dict, now_s: float | None = None, start: bool = True) -> bool:
    """Queue one photo for the model (bounded per protest and per hour)."""
    now_s = now_s if now_s is not None else time.time()
    if m["id"] in _queued or not _may_send(pid, now_s):
        return False
    try:
        _q.put_nowait({**m, "thumb": m.get("thumb") or (str(m.get("thumb_url") or "").rsplit("/", 1)[-1] or None)})
    except queue.Full:
        return False
    _queued.add(m["id"])
    _sent_by_protest[pid].append(now_s)
    _sent_all.append(now_s)
    STATS["queued"] += 1
    if start:
        _start_thread()
    return True


VISION_STATUSES = ("ongoing", "starting", "dispersing", "ended")


def vision_for(p: dict, media: list[dict], start_thread: bool = True) -> dict | None:
    """The vision estimate for a protest: what the cache already knows about
    its best photos ({photos, low, high, pending, notes}), queueing the ones
    it does not (never waiting for them). Each photo shows part of the crowd:
    the crowd is at least the largest one, so photos are not added up."""
    _load_cache()
    best = best_photos(media)
    if not best:
        return None
    now_s = time.time()
    got, pending = [], 0
    for m in best:
        row = cached(m["id"])
        retry = False
        if row and not row.get("ok"):
            try:
                retry = now_s - _dt.datetime.fromisoformat(str(row["at"]).replace("Z", "+00:00")).timestamp() > RETRY_S
            except (ValueError, TypeError):
                retry = True
            if row.get("error") == "no image on this machine":
                retry = False
        if row is None or retry:
            if (p.get("status") or {}).get("key", "ongoing") in VISION_STATUSES or p.get("_vision_any"):
                if enqueue(p["id"], m, now_s, start_thread):
                    pending += 1
            continue
        if row.get("ok") and row.get("crowd_scene") and row.get("high"):
            got.append(row)
    if not got:
        return {"photos": 0, "low": None, "high": None, "pending": pending} if pending else None
    return {"photos": len(got), "low": max(r["low"] or 0 for r in got), "high": max(r["high"] for r in got),
            "pending": pending, "notes": [r.get("note") for r in got if r.get("note")][:3],
            "media_ids": [r["media_id"] for r in got]}


def reset_for_tests() -> None:
    with _cache_lock:
        _cache.clear()
        _loaded[0] = True
    _queued.clear()
    _sent_by_protest.clear()
    _sent_all.clear()
    while not _q.empty():
        try:
            _q.get_nowait()
        except queue.Empty:
            break
    for k in STATS:
        STATS[k] = 0
