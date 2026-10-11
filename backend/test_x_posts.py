"""x_posts: three public sources normalised to one post; cached; failures fall through; no email in our headers."""
import io
import json
import threading
import urllib.error

import pytest

import x_posts as xp

PID = "2109331790498279887"

FX = {"code": 200, "tweet": {
    "id": PID, "text": "A Shahed struck a highrise in Dnipro. https://t.co/abc", "created_timestamp": 1791738863,
    "possibly_sensitive": False, "lang": "en",
    "author": {"name": "PJ", "screen_name": "giK1893", "avatar_url": "https://pbs.twimg.com/profile_images/1/a_200x200.jpg"},
    "media": {"all": [
        {"type": "video", "url": "https://video.twimg.com/v/1080.mp4", "thumbnail_url": "https://pbs.twimg.com/thumb/1.jpg", "duration": 31.1,
         "variants": [{"url": "https://video.twimg.com/v/pl.m3u8", "content_type": "application/x-mpegURL", "bitrate": 0},
                      {"url": "https://video.twimg.com/v/480.mp4", "content_type": "video/mp4", "bitrate": 950000},
                      {"url": "https://video.twimg.com/v/1080.mp4", "content_type": "video/mp4", "bitrate": 10368000}]},
        {"type": "photo", "url": "https://pbs.twimg.com/media/A.jpg"},
    ]}}}

SYND = {"__typename": "Tweet", "text": "Strike on a depot https://t.co/x", "created_at": "2026-10-11T17:14:23.000Z",
        "user": {"name": "GeoConfirmed", "screen_name": "GeoConfirmed", "profile_image_url_https": "https://pbs.twimg.com/p.jpg"},
        "mediaDetails": [{"type": "photo", "media_url_https": "https://pbs.twimg.com/media/B.jpg"}], "possibly_sensitive": True}

VX = {"text": "vx text", "date_epoch": 1791738863, "user_name": "V", "user_screen_name": "vx", "user_profile_image_url": "https://pbs.twimg.com/v.jpg",
      "media_extended": [{"type": "image", "url": "https://pbs.twimg.com/media/C.jpg"},
                         {"type": "video", "url": "https://video.twimg.com/v/c.mp4", "thumbnail_url": "https://pbs.twimg.com/t.jpg", "duration_millis": 18901}]}


@pytest.fixture(autouse=True)
def _clean():
    xp._CACHE.clear()
    xp._INFLIGHT.clear()
    yield
    xp._CACHE.clear()


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _serve(monkeypatch, answers):
    """answers: host fragment -> dict (JSON) or an exception to raise. Records each request."""
    calls = []

    def fake(req, timeout=None):
        calls.append(req)
        for frag, ans in answers.items():
            if frag in req.full_url:
                if isinstance(ans, Exception):
                    raise ans
                return _Resp(json.dumps(ans).encode())
        raise urllib.error.HTTPError(req.full_url, 404, "nf", {}, None)
    monkeypatch.setattr(xp.urllib.request, "urlopen", fake)
    return calls


def test_fxtwitter_normalised(monkeypatch):
    calls = _serve(monkeypatch, {"fxtwitter": FX})
    p = xp.fetch(PID)
    assert p["via"] == "fxtwitter"
    assert p["author"] == "PJ" and p["handle"] == "giK1893" and p["avatar"].startswith("https://pbs.twimg.com/")
    assert p["text"] == "A Shahed struck a highrise in Dnipro."                     # the trailing t.co is the media link
    assert p["photos"] == ["https://pbs.twimg.com/media/A.jpg"]
    assert p["videos"][0]["mp4"] == "https://video.twimg.com/v/480.mp4"              # plays at once, not the 10 Mbit/s one
    assert p["videos"][0]["poster"] == "https://pbs.twimg.com/thumb/1.jpg"
    assert p["created_at"] == "2026-10-11T17:14:23Z"
    assert p["url"] == f"https://x.com/giK1893/status/{PID}"
    assert len(calls) == 1


def test_falls_back_to_syndication_then_vx(monkeypatch):
    _serve(monkeypatch, {"fxtwitter": urllib.error.URLError("down"), "syndication": SYND})
    p = xp.fetch(PID)
    assert p["via"] == "syndication" and p["photos"] == ["https://pbs.twimg.com/media/B.jpg"] and p["sensitive"] is True
    xp._CACHE.clear()
    _serve(monkeypatch, {"fxtwitter": TimeoutError("slow"), "syndication": {"__typename": "TweetTombstone"}, "vxtwitter": VX})
    p = xp.fetch(PID)
    assert p["via"] == "vxtwitter" and p["photos"] == ["https://pbs.twimg.com/media/C.jpg"]
    assert p["videos"][0] == {"poster": "https://pbs.twimg.com/t.jpg", "mp4": "https://video.twimg.com/v/c.mp4", "gif": False, "duration_s": 19}


def test_cached_and_negative_cached(monkeypatch):
    calls = _serve(monkeypatch, {"fxtwitter": FX})
    assert xp.fetch(PID) and xp.fetch(PID)
    assert len(calls) == 1                                                            # a day's cache
    calls = _serve(monkeypatch, {})                                                   # every source: 404
    assert xp.fetch("1234567") is None and xp.fetch("1234567") is None
    assert len(calls) == 3                                                            # three sources once, then the miss is cached
    t0, _ = xp._CACHE["1234567"]
    xp._CACHE["1234567"] = (t0 - xp.TTL_FAIL - 1, None)                              # an hour later it is asked again
    xp.fetch("1234567")
    assert len(calls) == 6


def test_bad_id_never_fetched(monkeypatch):
    calls = _serve(monkeypatch, {"fxtwitter": FX})
    assert xp.fetch("../etc") is None and xp.fetch("") is None and xp.fetch("12") is None
    assert calls == []


def test_one_fetch_per_id_at_once(monkeypatch):
    gate = threading.Event()
    calls = []

    def slow(req, timeout=None):
        calls.append(req)
        gate.wait(2)
        return _Resp(json.dumps(FX).encode())
    monkeypatch.setattr(xp.urllib.request, "urlopen", slow)
    out = []
    ts = [threading.Thread(target=lambda: out.append(xp.fetch(PID))) for _ in range(5)]
    for t in ts:
        t.start()
    gate.set()
    for t in ts:
        t.join(5)
    assert len(calls) == 1 and len(out) == 5 and all(o and o["handle"] == "giK1893" for o in out)


def test_headers_name_the_app_never_an_email(monkeypatch):
    calls = _serve(monkeypatch, {"fxtwitter": urllib.error.URLError("x"), "syndication": urllib.error.URLError("x"), "vxtwitter": VX})
    xp.fetch(PID)
    assert len(calls) == 3
    for req in calls:
        hdrs = " ".join(f"{k}: {v}" for k, v in req.header_items())
        assert "@" not in hdrs
        assert "HorizonWatch" in req.get_header("User-agent")
    assert "@" not in xp.USER_AGENT
