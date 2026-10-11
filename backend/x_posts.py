"""
x_posts.py — an X (Twitter) post's words, pictures and video, for showing in
our own frame.

GeoConfirmed cites X posts for nearly every placemark. A post page cannot be
framed, and X's embed iframe is X's interface, not ours (and renders nothing
when X's script is blocked: the DMG's webview, Safari's tracking prevention,
the iOS home-screen app). So the server reads the post's public data and the
client draws it with our own components (XPost.jsx).

THREE PUBLIC SOURCES, NO KEY, tried in order until one answers:
  1. FxTwitter's API   api.fxtwitter.com/i/status/<id>   (tweet.author, tweet.media.all)
  2. X's syndication   cdn.syndication.twimg.com/tweet-result?id=<id>&token=<t>
                       (what X's own embed is built from; may refuse cloud IPs)
  3. vxTwitter's API   api.vxtwitter.com/i/status/<id>   (media_extended)
Each answer is normalised to one shape (author, handle, avatar, text, date,
photos, videos with poster and an MP4 that plays at once, X's sensitive flag).

Cached in memory: a post for a day, a failure for an hour (a deleted or
protected post answers with nothing, and asking again every time someone
opens the placemark helps nobody). At most MAX_INFLIGHT fetches run at once
and one id is fetched once even when twenty cards ask for it together.
The User-Agent names the app and its public page — never a person's email.
"""
from __future__ import annotations

import json
import math
import re
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

_CACHE: dict[str, tuple[float, dict | None]] = {}
_LOCK = threading.Lock()
_INFLIGHT: dict[str, threading.Event] = {}
MAX_INFLIGHT = 4
_SEM = threading.BoundedSemaphore(MAX_INFLIGHT)
TTL_OK = 24 * 3600
TTL_FAIL = 3600
MAX_CACHE = 4000
TIMEOUT_S = 10
USER_AGENT = "HorizonWatch/1.0 (+https://github.com/ZaphodBeblerbox/Horizon-Watch)"
STATUS = re.compile(r"(?:x|twitter)\.com/([^/?#]+)/status(?:es)?/(\d+)", re.I)
_TCO_TAIL = re.compile(r"\s*https://t\.co/\w+\s*$")


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
    mp4 = [v for v in variants or [] if (v.get("content_type") or v.get("format") or "").endswith("mp4")
           or v.get("container") == "mp4"]
    mp4 = [v for v in mp4 if v.get("url")]
    if not mp4:
        return None
    # the best that is not huge: ≤ 1.5 Mbit/s plays at once on a normal line
    ok = [v for v in mp4 if (v.get("bitrate") or 0) <= 1_500_000] or mp4
    return max(ok, key=lambda v: v.get("bitrate") or 0)["url"]


def _iso(created_at) -> str | None:
    """X's "Sun Oct 11 17:14:23 +0000 2026", an epoch, or ISO → ISO UTC."""
    if created_at in (None, ""):
        return None
    if isinstance(created_at, (int, float)):
        return datetime.fromtimestamp(created_at, timezone.utc).isoformat().replace("+00:00", "Z")
    s = str(created_at)
    try:
        return datetime.strptime(s, "%a %b %d %H:%M:%S %z %Y").astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except ValueError:
        return s


def _post(post_id, *, author, handle, avatar, text, created_at, photos, videos, sensitive=False, lang=None, verified=False):
    handle = handle or ""
    return {"id": post_id, "author": author or handle, "handle": handle, "avatar": avatar or None, "verified": bool(verified),
            "text": _TCO_TAIL.sub("", text or "").strip(), "created_at": _iso(created_at), "lang": lang,
            "photos": [p for p in photos if p][:4], "videos": videos[:2],
            # X's own flag; the console puts such media behind its warning
            "sensitive": bool(sensitive),
            "url": f"https://x.com/{handle or 'i'}/status/{post_id}"}


def normalise(d: dict, post_id: str) -> dict:
    """X's syndication answer (tweet-result)."""
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
    return _post(post_id, author=user.get("name"), handle=user.get("screen_name"), avatar=user.get("profile_image_url_https"),
                 text=d.get("text"), created_at=d.get("created_at"), photos=photos, videos=videos,
                 sensitive=d.get("possibly_sensitive"), lang=d.get("lang"),
                 verified=user.get("is_blue_verified") or user.get("verified"))


def normalise_fx(d: dict, post_id: str) -> dict | None:
    """FxTwitter's answer ({"code": 200, "tweet": {...}})."""
    t = d.get("tweet") or {}
    if not t or not (t.get("text") or t.get("media")):
        return None
    a = t.get("author") or {}
    media = t.get("media") or {}
    photos, videos = [], []
    for m in media.get("all") or [*(media.get("photos") or []), *(media.get("videos") or [])]:
        typ = m.get("type")
        if typ == "photo" and m.get("url"):
            photos.append(m["url"])
        elif typ in ("video", "gif"):
            url = _best_mp4(m.get("variants") or m.get("formats") or []) or m.get("url")
            if url:
                videos.append({"poster": m.get("thumbnail_url"), "mp4": url, "gif": typ == "gif",
                               "duration_s": round(m.get("duration") or 0)})
    return _post(post_id, author=a.get("name"), handle=a.get("screen_name"), avatar=a.get("avatar_url"),
                 text=t.get("text"), created_at=t.get("created_timestamp") or t.get("created_at"), photos=photos, videos=videos,
                 sensitive=t.get("possibly_sensitive"), lang=t.get("lang"))


def normalise_vx(d: dict, post_id: str) -> dict | None:
    """vxTwitter's answer (flat: user_name, media_extended)."""
    if not d or not (d.get("text") or d.get("media_extended")):
        return None
    photos, videos = [], []
    for m in d.get("media_extended") or []:
        if m.get("type") == "image" and m.get("url"):
            photos.append(m["url"])
        elif m.get("type") in ("video", "gif") and m.get("url"):
            videos.append({"poster": m.get("thumbnail_url"), "mp4": m["url"], "gif": m.get("type") == "gif",
                           "duration_s": round((m.get("duration_millis") or 0) / 1000)})
    return _post(post_id, author=d.get("user_name"), handle=d.get("user_screen_name"), avatar=d.get("user_profile_image_url"),
                 text=d.get("text"), created_at=d.get("date_epoch") or d.get("date"), photos=photos, videos=videos,
                 sensitive=d.get("possibly_sensitive"), lang=d.get("lang"))


def _syndication(d: dict, post_id: str) -> dict | None:
    if d and d.get("__typename") in (None, "Tweet") and (d.get("text") or d.get("mediaDetails")):
        return normalise(d, post_id)
    return None


SOURCES = (
    ("fxtwitter", lambda i: f"https://api.fxtwitter.com/i/status/{i}", normalise_fx),
    ("syndication", lambda i: f"https://cdn.syndication.twimg.com/tweet-result?id={i}&token={_token(i)}&lang=en", _syndication),
    ("vxtwitter", lambda i: f"https://api.vxtwitter.com/i/status/{i}", normalise_vx),
)


def _get_json(url: str) -> dict | None:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
        body = r.read() or b"{}"
    d = json.loads(body)
    return d if isinstance(d, dict) else None


def _fetch_uncached(post_id: str) -> dict | None:
    for name, url_of, norm in SOURCES:
        try:
            d = _get_json(url_of(post_id))
            out = norm(d or {}, post_id)
            if out:
                out["via"] = name
                return out
        except urllib.error.HTTPError as e:
            if e.code not in (404, 401, 403):           # a missing post is not worth a log line per source
                print(f"[x] {post_id} via {name}: HTTP {e.code}", flush=True)
        except (urllib.error.URLError, ValueError, TimeoutError, OSError) as e:
            print(f"[x] {post_id} via {name}: {type(e).__name__}: {e}", flush=True)
    return None


def _cached(post_id: str, now: float):
    hit = _CACHE.get(post_id)
    if hit and now - hit[0] < (TTL_OK if hit[1] else TTL_FAIL):
        return True, hit[1]
    return False, None


def fetch(post_id: str) -> dict | None:
    """The post, or None if no source will give it (deleted, protected, an id
    that is not one). Blocking: call it off the event loop."""
    post_id = str(post_id or "")
    if not re.fullmatch(r"\d{5,25}", post_id):
        return None
    with _LOCK:
        ok, val = _cached(post_id, time.time())
        if ok:
            return val
        ev = _INFLIGHT.get(post_id)
        owner = ev is None
        if owner:
            ev = _INFLIGHT[post_id] = threading.Event()
    if not owner:                                       # someone is already fetching this one
        ev.wait(TIMEOUT_S * len(SOURCES) + 5)
        with _LOCK:
            return _cached(post_id, time.time())[1]
    try:
        with _SEM:
            out = _fetch_uncached(post_id)
        with _LOCK:
            if len(_CACHE) > MAX_CACHE:
                for k in sorted(_CACHE, key=lambda k: _CACHE[k][0])[: MAX_CACHE // 4]:
                    _CACHE.pop(k, None)
            _CACHE[post_id] = (time.time(), out)
        return out
    finally:
        with _LOCK:
            _INFLIGHT.pop(post_id, None)
        ev.set()
