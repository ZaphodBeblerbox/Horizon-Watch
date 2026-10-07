"""
x_posts.py — an X (Twitter) post's words, pictures and video, for showing in
our own frame.

GeoConfirmed cites X posts for nearly every placemark. A post page cannot be
framed, and X's embed iframe is X's interface, not ours. The data the embed
itself is built from is public, per post, without a key: X's syndication
endpoint (cdn.syndication.twimg.com/tweet-result), which takes the post id
and a token derived from it. From it we keep the author, the text, the
photos, and each video's poster and best MP4 — so the inspector shows the
footage the way it shows Telegram's (TelegramMedia.jsx): autoplaying, muted,
in our frame.

Cached in memory: a post for a day, a failure for half an hour (a deleted or
protected post answers with nothing, and asking again every time someone
opens the placemark helps nobody).
"""
from __future__ import annotations

import json
import math
import re
import threading
import time
import urllib.error
import urllib.request

_CACHE: dict[str, tuple[float, dict | None]] = {}
_LOCK = threading.Lock()
TTL_OK = 24 * 3600
TTL_FAIL = 30 * 60
MAX_CACHE = 2000
STATUS = re.compile(r"(?:x|twitter)\.com/([^/?#]+)/status(?:es)?/(\d+)", re.I)


def ids_in(text: str) -> list[str]:
    """Post ids in a block of text (GeoConfirmed's original_source)."""
    return list(dict.fromkeys(m.group(2) for m in STATUS.finditer(text or "")))


def _token(post_id: str) -> str:
    """The token X's embed uses: (id / 1e15 · π) in base 36, zeros and point removed."""
    x = int(post_id) / 1e15 * math.pi
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    ip, fp, s = int(x), x - int(x), ""
    while True:
        s = digits[ip % 36] + s
        ip //= 36
        if ip == 0:
            break
    f = ""
    for _ in range(12):
        fp *= 36
        d = int(fp)
        f += digits[d]
        fp -= d
        if fp == 0:
            break
    return re.sub(r"(0+|\.)", "", s + ("." + f if f else ""))


def _best_mp4(variants: list[dict]) -> str | None:
    mp4 = [v for v in variants or [] if v.get("content_type") == "video/mp4" and v.get("url")]
    if not mp4:
        return None
    # the best that is not huge: ≤ 1.5 Mbit/s plays at once on a normal line
    ok = [v for v in mp4 if (v.get("bitrate") or 0) <= 1_500_000] or mp4
    return max(ok, key=lambda v: v.get("bitrate") or 0)["url"]


def normalise(d: dict, post_id: str) -> dict:
    user = d.get("user") or {}
    photos, videos = [], []
    for m in d.get("mediaDetails") or []:
        if m.get("type") == "photo" and m.get("media_url_https"):
            photos.append(m["media_url_https"])
        elif m.get("type") in ("video", "animated_gif"):
            url = _best_mp4((m.get("video_info") or {}).get("variants") or [])
            if url:
                videos.append({"poster": m.get("media_url_https"), "mp4": url, "gif": m.get("type") == "animated_gif",
                               "duration_s": round(((m.get("video_info") or {}).get("duration_millis") or 0) / 1000)})
    if not photos and not videos:
        photos = [p.get("url") for p in d.get("photos") or [] if p.get("url")]
    text = re.sub(r"\s*https://t\.co/\w+\s*$", "", d.get("text") or "").strip()
    handle = user.get("screen_name") or ""
    return {"id": post_id, "author": user.get("name") or handle, "handle": handle,
            "avatar": user.get("profile_image_url_https"), "verified": bool(user.get("is_blue_verified") or user.get("verified")),
            "text": text, "created_at": d.get("created_at"), "lang": d.get("lang"),
            "photos": photos[:4], "videos": videos[:2],
            # X's own flag; the console puts such media behind its warning
            "sensitive": bool(d.get("possibly_sensitive")),
            "url": f"https://x.com/{handle or 'i'}/status/{post_id}"}


def fetch(post_id: str) -> dict | None:
    """The post, or None if X will not give it (deleted, protected, an id that is not one)."""
    if not re.fullmatch(r"\d{5,25}", post_id or ""):
        return None
    now = time.time()
    with _LOCK:
        hit = _CACHE.get(post_id)
    if hit and now - hit[0] < (TTL_OK if hit[1] else TTL_FAIL):
        return hit[1]
    url = f"https://cdn.syndication.twimg.com/tweet-result?id={post_id}&token={_token(post_id)}&lang=en"
    out = None
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Parallax)"})
        with urllib.request.urlopen(req, timeout=15) as r:
            d = json.loads(r.read() or b"{}")
        if d and d.get("__typename") in (None, "Tweet") and (d.get("text") or d.get("mediaDetails")):
            out = normalise(d, post_id)
    except (urllib.error.URLError, ValueError, TimeoutError) as e:
        print(f"[x] {post_id}: {type(e).__name__}: {e}")
    with _LOCK:
        if len(_CACHE) > MAX_CACHE:
            for k in sorted(_CACHE, key=lambda k: _CACHE[k][0])[: MAX_CACHE // 4]:
                _CACHE.pop(k, None)
        _CACHE[post_id] = (now, out)
    return out
