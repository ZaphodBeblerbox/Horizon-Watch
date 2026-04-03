"""Aircraft photo lookup via Planespotters.net public API.

Fetches real photos for a specific aircraft by ICAO24 hex code.
Results are cached in-memory with a 6-hour TTL.
"""
import time
import json
import urllib.request

_PHOTO_CACHE: dict = {}   # icao24.lower() → {"ts": float, "data": dict}
_CACHE_TTL = 6 * 3600     # 6 hours


def get_photo(icao24: str) -> dict:
    """Return photo data for the given ICAO24.

    Returns:
        {
            "photo_url":     "https://..." | None,
            "thumbnail_url": "https://..." | None,
            "photographer":  "John Doe"   | None,
        }
    """
    key = icao24.lower().strip()
    if not key:
        return _empty_photo()

    cached = _PHOTO_CACHE.get(key)
    if cached and (time.time() - cached["ts"]) < _CACHE_TTL:
        print(f"[photo] cache HIT  {key}")
        return cached["data"]

    print(f"[photo] cache MISS {key} — querying Planespotters")
    result = _empty_photo()
    try:
        url = f"https://api.planespotters.net/pub/photos/hex/{key}"
        req = urllib.request.Request(
            url, headers={"User-Agent": "HorizonWatch/1.0 (+https://horizon.watch)"}
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read())

        photos = data.get("photos") or []
        if photos:
            first = photos[0]
            thumb_large = (first.get("thumbnail_large") or {}).get("src")
            thumb_small = (first.get("thumbnail") or {}).get("src")
            result = {
                "photo_url":     first.get("link") or None,
                "thumbnail_url": thumb_large or thumb_small or None,
                "photographer":  first.get("photographer") or None,
            }
            print(f"[photo] {key} → {result['thumbnail_url']}")
        else:
            print(f"[photo] {key} → no photos found")

    except Exception as exc:
        print(f"[photo] Planespotters error for {key}: {exc}")

    _PHOTO_CACHE[key] = {"ts": time.time(), "data": result}
    return result


def _empty_photo() -> dict:
    return {"photo_url": None, "thumbnail_url": None, "photographer": None}
