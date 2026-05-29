"""
geocoder.py — Nominatim-based place geocoding for article intelligence.

Free, no API key required (OpenStreetMap Nominatim).
Applies regional viewbox bias for known conflict-zone countries.
In-memory LRU cache (5000 entries) to avoid hammering Nominatim.
"""
import asyncio
import time
from typing import Optional

import httpx

_geocode_cache: dict = {}
_CACHE_MAX = 5_000
_last_request_time: float = 0.0

NOMINATIM_URL     = "https://nominatim.openstreetmap.org/search"
NOMINATIM_HEADERS = {
    "User-Agent": (
        "HorizonWatch/1.0 "
        "(intelligence platform; contact@trifectatechnologies.com)"
    )
}

# Viewbox hints for common conflict/watch zones: "min_lon,min_lat,max_lon,max_lat"
REGION_VIEWBOX: dict[str, str] = {
    "sudan":     "21.8,3.5,38.7,22.2",
    "south sudan": "24.1,3.5,35.9,12.2",
    "ukraine":   "22.1,44.4,40.2,52.4",
    "gaza":      "34.2,31.2,34.6,31.6",
    "west bank": "34.9,31.3,35.6,32.6",
    "syria":     "35.7,32.3,42.4,37.3",
    "iraq":      "38.8,29.1,48.6,37.4",
    "mali":      "-4.2,10.1,4.3,25.0",
    "myanmar":   "92.2,9.8,101.2,28.5",
    "ethiopia":  "33.0,3.4,48.0,14.9",
    "somalia":   "40.9,-1.7,51.4,12.0",
    "yemen":     "42.5,11.7,54.5,18.6",
    "lebanon":   "35.1,33.0,36.7,34.7",
    "libya":     "9.3,19.5,25.2,33.2",
    "afghanistan": "60.5,29.4,74.9,38.5",
    "haiti":     "-74.5,18.0,-71.6,20.1",
    "sahel":     "-17.6,11.0,24.0,20.0",
}


async def _rate_limited_get(client: httpx.AsyncClient, url: str, params: dict) -> list:
    """GET with Nominatim's 1 req/s rate limit enforced."""
    global _last_request_time
    now = time.monotonic()
    wait = 1.1 - (now - _last_request_time)
    if wait > 0:
        await asyncio.sleep(wait)
    _last_request_time = time.monotonic()
    r = await client.get(url, params=params, headers=NOMINATIM_HEADERS, timeout=8.0)
    r.raise_for_status()
    return r.json()


def _osm_confidence(result: dict) -> str:
    osm_class = result.get("class", "")
    osm_type  = result.get("type",  "")
    if osm_class in ("amenity", "military", "historic", "man_made", "aeroway", "harbour"):
        return "facility"
    if osm_type in ("suburb", "quarter", "neighbourhood", "island"):
        return "district"
    if osm_type in ("city", "town", "village", "hamlet"):
        return "city"
    if osm_type in ("sea", "strait", "bay", "river", "lake", "water"):
        return "region"
    if osm_class == "boundary" and osm_type == "administrative":
        addr = result.get("address", {})
        if addr.get("country") and not addr.get("city") and not addr.get("town"):
            return "country"
        return "city"
    return "city"


async def geocode_place(
    place_name: str,
    country_hint: Optional[str] = None,
    _retry_without_viewbox: bool = True,
) -> Optional[dict]:
    """
    Geocode a place name to lat/lon via Nominatim.

    Returns a dict with: lat, lon, display_name, location_confidence,
    osm_type, osm_class — or None if nothing found.
    """
    if not place_name or len(place_name.strip()) < 3:
        return None

    place_name = place_name.strip()
    cache_key  = f"{place_name.lower()}|{(country_hint or '').lower()}"
    if cache_key in _geocode_cache:
        return _geocode_cache[cache_key]

    params: dict = {
        "q":            place_name,
        "format":       "json",
        "limit":        1,
        "addressdetails": 1,
    }

    # Apply regional viewbox bias
    if country_hint:
        hint_lower = country_hint.lower()
        for key, viewbox in REGION_VIEWBOX.items():
            if key in hint_lower:
                params["viewbox"]  = viewbox
                params["bounded"]  = 0   # prefer but don't restrict
                break

    try:
        async with httpx.AsyncClient() as client:
            results = await _rate_limited_get(client, NOMINATIM_URL, params)
    except Exception as e:
        print(f"[geocoder] request failed for '{place_name}': {e}")
        return None

    if not results and _retry_without_viewbox and "viewbox" in params:
        # Try again without the regional bias
        params.pop("viewbox", None)
        params.pop("bounded", None)
        try:
            async with httpx.AsyncClient() as client:
                results = await _rate_limited_get(client, NOMINATIM_URL, params)
        except Exception:
            return None

    if not results:
        _geocode_cache[cache_key] = None
        return None

    r          = results[0]
    confidence = _osm_confidence(r)

    geocoded = {
        "lat":                  float(r["lat"]),
        "lon":                  float(r["lon"]),
        "display_name":         r.get("display_name", place_name),
        "location_confidence":  confidence,
        "osm_type":             r.get("type",  ""),
        "osm_class":            r.get("class", ""),
    }

    # Evict oldest 20% when cache is full
    if len(_geocode_cache) >= _CACHE_MAX:
        for k in list(_geocode_cache)[:1000]:
            del _geocode_cache[k]
    _geocode_cache[cache_key] = geocoded
    return geocoded
