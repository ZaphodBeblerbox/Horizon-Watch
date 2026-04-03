"""Vessel photo lookup via MarineTraffic/VesselFinder photo CDN.

The endpoint https://photos.marinetraffic.com/ais/showphoto.aspx?mmsi={mmsi}
redirects to an actual vessel photo when one exists, or returns 404/302-to-noimage
when it doesn't.

Strategy:
  - Send a HEAD request (or GET with stream) to the thumbnail URL.
  - If the final resolved URL still points to a real image (content-type image/*
    and not a known "no photo" placeholder path), mark as available.
  - We never download the image bytes — we just confirm availability and return
    the URL for the frontend to display directly.
  - Cache 6 hours per MMSI (photos rarely change).
"""
import time
import urllib.request
import urllib.error
from typing import Optional

_PHOTO_CACHE: dict = {}   # str(mmsi) → {"ts": float, "data": dict}
_CACHE_TTL = 6 * 3600     # 6 hours

# Paths that indicate "no photo available" on MarineTraffic's CDN
_NO_PHOTO_INDICATORS = (
    "nophoto",
    "no_photo",
    "noimage",
    "no_image",
    "default",
    "placeholder",
)

_BASE = "https://photos.marinetraffic.com/ais/showphoto.aspx"


def _thumb_url(mmsi: str) -> str:
    return f"{_BASE}?mmsi={mmsi}&size=thumb"


def _full_url(mmsi: str) -> str:
    return f"{_BASE}?mmsi={mmsi}&size=full"


def _photo_available(mmsi: str) -> bool:
    """Return True if MarineTraffic has a real photo for this MMSI."""
    url = _thumb_url(mmsi)
    try:
        req = urllib.request.Request(
            url,
            method="HEAD",
            headers={"User-Agent": "HorizonWatch/1.0 (+https://horizon.watch)"},
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            final_url  = resp.url or url
            ct         = resp.headers.get("Content-Type", "")
            status     = resp.status

            # Must be a 2xx with an image content-type
            if status < 200 or status >= 300:
                return False
            if not ct.startswith("image/"):
                return False
            # Reject known placeholder URLs
            lower_url = final_url.lower()
            if any(ind in lower_url for ind in _NO_PHOTO_INDICATORS):
                return False
            return True
    except urllib.error.HTTPError as exc:
        # 404 = no photo; other errors treated as unavailable
        if exc.code != 404:
            print(f"[vessel_photo] HTTP {exc.code} for MMSI {mmsi}")
        return False
    except Exception as exc:
        print(f"[vessel_photo] error for MMSI {mmsi}: {exc}")
        return False


def get_photo(mmsi: str) -> dict:
    """Return photo availability and URLs for a vessel MMSI.

    Returns:
        {
            "available":     True | False,
            "thumbnail_url": "https://..." | None,
            "full_url":      "https://..." | None,
        }
    """
    key = str(mmsi).strip()
    if not key or not key.isdigit():
        return _empty_photo()

    cached = _PHOTO_CACHE.get(key)
    if cached and (time.time() - cached["ts"]) < _CACHE_TTL:
        print(f"[vessel_photo] cache HIT  MMSI {key}")
        return cached["data"]

    print(f"[vessel_photo] cache MISS MMSI {key} — probing MarineTraffic")
    available = _photo_available(key)
    result = {
        "available":     available,
        "thumbnail_url": _thumb_url(key) if available else None,
        "full_url":      _full_url(key)  if available else None,
    }
    print(f"[vessel_photo] MMSI {key} → available={available}")
    _PHOTO_CACHE[key] = {"ts": time.time(), "data": result}
    return result


def _empty_photo() -> dict:
    return {"available": False, "thumbnail_url": None, "full_url": None}
