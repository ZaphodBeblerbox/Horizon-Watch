import threading
import time

import httpx

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_HEADERS = {"User-Agent": "AkiliDashboard/1.0 (contact: dev@local)"}

_cache: dict[tuple, list[dict]] = {}
_cache_lock = threading.Lock()
_rate_lock = threading.Lock()
_last_request_ts = 0.0

_http_calls = 0
_cache_hits = 0


def _normalize_bounds(bounds: tuple[float, float, float, float] | None) -> tuple[float, float, float, float] | None:
    if not bounds or len(bounds) != 4:
        return None
    return (float(bounds[0]), float(bounds[1]), float(bounds[2]), float(bounds[3]))


def _make_cache_key(
    query: str,
    expected_country_codes: list[str] | None,
    region_bias: str | None,
    bounds: tuple[float, float, float, float] | None,
) -> tuple:
    codes = tuple(sorted({c.strip().lower() for c in (expected_country_codes or []) if c}))
    b = _normalize_bounds(bounds)
    return (query.strip().lower(), codes, (region_bias or "").strip().lower(), b)


def geocode_place(
    query: str,
    expected_country_codes: list[str] | None = None,
    region_bias: str | None = None,
    bounds: tuple[float, float, float, float] | None = None,
) -> list[dict]:
    """
    Geocode a place via Nominatim with:
    - in-memory caching (including misses)
    - global rate limit: max 1 external request / second
    - fail-safe behavior (never raises)
    Returns up to 3 candidate results (possibly empty list).
    """
    global _last_request_ts, _http_calls, _cache_hits

    q = (query or "").strip()
    if not q:
        return []
    key = _make_cache_key(q, expected_country_codes, region_bias, bounds)

    with _cache_lock:
        if key in _cache:
            _cache_hits += 1
            return _cache[key]

    results: list[dict] = []

    try:
        codes = sorted({c.strip().lower() for c in (expected_country_codes or []) if c})
        bias = (region_bias or "").strip().lower()
        normalized_bounds = _normalize_bounds(bounds)
        # East Africa default viewbox: minLon,minLat,maxLon,maxLat
        if normalized_bounds is None and bias == "east_africa":
            normalized_bounds = (28.0, -13.0, 42.0, 6.0)

        params: dict[str, str] = {
            "format": "json",
            "q": q,
            "limit": "3",
            "addressdetails": "1",
        }
        if codes:
            params["countrycodes"] = ",".join(codes)

        # bounded=1 only when country restriction is present or feed/article is Africa/East Africa biased
        if normalized_bounds is not None and (codes or bias == "east_africa"):
            min_lon, min_lat, max_lon, max_lat = normalized_bounds
            params["viewbox"] = f"{min_lon},{min_lat},{max_lon},{max_lat}"
            params["bounded"] = "1"

        with _rate_lock:
            now = time.monotonic()
            wait = 1.0 - (now - _last_request_ts)
            if wait > 0:
                time.sleep(wait)

            with httpx.Client(timeout=10.0, headers=NOMINATIM_HEADERS) as client_h:
                resp = client_h.get(
                    NOMINATIM_URL,
                    params=params,
                )
                _last_request_ts = time.monotonic()
                _http_calls += 1
                resp.raise_for_status()
                data = resp.json()

        if isinstance(data, list):
            for item in data[:3]:
                try:
                    lat = float(item.get("lat"))
                    lon = float(item.get("lon"))
                except (TypeError, ValueError):
                    continue
                address = item.get("address", {}) if isinstance(item.get("address"), dict) else {}
                country_code = (address.get("country_code") or "").lower()
                results.append({
                    "lat": lat,
                    "lon": lon,
                    "display_name": item.get("display_name", ""),
                    "type": item.get("type", ""),
                    "class": item.get("class", ""),
                    "boundingbox": item.get("boundingbox", []),
                    "address": address,
                    "country_code": country_code,
                    "country": address.get("country", ""),
                })
    except Exception:
        results = []

    with _cache_lock:
        _cache[key] = results
    return results


def get_geocode_stats() -> dict:
    with _cache_lock:
        return {
            "cache_size": len(_cache),
            "http_calls": _http_calls,
            "cache_hits": _cache_hits,
        }


def is_geocode_cached(
    query: str,
    expected_country_codes: list[str] | None = None,
    region_bias: str | None = None,
    bounds: tuple[float, float, float, float] | None = None,
) -> bool:
    if not (query or "").strip():
        return False
    key = _make_cache_key(query, expected_country_codes, region_bias, bounds)
    with _cache_lock:
        return key in _cache
