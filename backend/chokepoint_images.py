"""
chokepoint_images.py — Satellite / aerial imagery for strategic chokepoints.

Fetches from Wikimedia Commons using the search API (not hardcoded URLs).
Results are cached in memory for the process lifetime.
"""
from __future__ import annotations
import asyncio
from typing import Optional
import httpx

# Search terms per chokepoint name — ordered by most likely to yield a good result
_SEARCH_TERMS: dict[str, list[str]] = {
    "Strait of Hormuz":   ["Strait of Hormuz", "Hormuz strait satellite", "Persian Gulf strait"],
    "Suez Canal":         ["Suez Canal aerial", "Suez Canal Egypt", "Suez Canal satellite"],
    "Strait of Malacca":  ["Strait of Malacca", "Malacca strait aerial", "Singapore strait"],
    "Bab el-Mandeb":      ["Bab el-Mandeb strait", "Bab al-Mandab", "Gulf of Aden strait"],
    "Panama Canal":       ["Panama Canal aerial", "Panama Canal locks", "Panama Canal satellite"],
    "Strait of Gibraltar": ["Strait of Gibraltar", "Gibraltar strait satellite", "Gibraltar aerial"],
    "Bosphorus":          ["Bosphorus strait", "Istanbul Bosphorus aerial", "Bosphorus bridge satellite"],
    "Turkish Straits":    ["Bosphorus strait", "Istanbul Bosphorus aerial", "Dardanelles strait"],
    "Danish Straits":     ["Oresund strait", "Oresund bridge aerial", "Danish straits satellite"],
    "Taiwan Strait":      ["Taiwan Strait", "Taiwan strait satellite", "Taiwan strait aerial"],
    "Korean Strait":      ["Korea Strait", "Tsushima strait", "Korean strait satellite"],
    "Lombok Strait":      ["Lombok strait Indonesia", "Lombok strait aerial", "Bali sea satellite"],
    "Sunda Strait":       ["Sunda Strait Indonesia", "Sunda strait satellite", "Krakatau island aerial"],
    "Mozambique Channel": ["Mozambique Channel", "Madagascar channel satellite", "Mozambique coast aerial"],
    "Cape of Good Hope":  ["Cape of Good Hope", "Cape Peninsula South Africa", "Cape Good Hope aerial"],
    "Drake Passage":      ["Drake Passage", "Cape Horn aerial", "Drake passage satellite"],
}

_image_cache: dict[str, tuple[Optional[str], Optional[str]]] = {}
_HEADERS = {"User-Agent": "HorizonWatch/1.0 (intelligence platform; contact@trifectatechnologies.com)"}


async def _wikimedia_search_image(
    search_term: str,
    client: httpx.AsyncClient,
) -> Optional[str]:
    """Search Wikimedia Commons for a single image URL matching the term."""
    try:
        r = await client.get(
            "https://commons.wikimedia.org/w/api.php",
            params={
                "action":       "query",
                "generator":    "search",
                "gsrnamespace": "6",
                "gsrsearch":    f"filetype:bitmap {search_term}",
                "gsrlimit":     "8",
                "prop":         "imageinfo",
                "iiprop":       "url|mime|size",
                "iiurlwidth":   "1200",
                "format":       "json",
            },
            timeout=8.0,
        )
        if r.status_code != 200:
            return None

        pages = r.json().get("query", {}).get("pages", {})
        for page in sorted(pages.values(), key=lambda p: p.get("index", 999)):
            info_list = page.get("imageinfo", [])
            if not info_list:
                continue
            info  = info_list[0]
            mime  = info.get("mime", "")
            url   = info.get("thumburl") or info.get("url", "")
            width = info.get("thumbwidth") or info.get("width", 0) or 0
            if url and ("jpeg" in mime or "png" in mime) and int(width) >= 600:
                return url
    except Exception as e:
        print(f"[chokepoint_images] search '{search_term}' failed: {e}")
    return None


async def fetch_chokepoint_image(name: str) -> tuple[Optional[str], Optional[str]]:
    """
    Return (image_url, caption) for a chokepoint by fetching from Wikimedia.
    Results cached per process. Caption is the search term used.
    """
    if name in _image_cache:
        return _image_cache[name]

    # Fuzzy name match to search terms map
    search_terms = _SEARCH_TERMS.get(name)
    if not search_terms:
        name_lower = name.lower()
        for key, terms in _SEARCH_TERMS.items():
            if name_lower in key.lower() or key.lower() in name_lower:
                search_terms = terms
                break
        if not search_terms:
            search_terms = [name, f"{name} satellite aerial", f"{name} strait"]

    url: Optional[str] = None
    caption: Optional[str] = None

    try:
        async with httpx.AsyncClient(headers=_HEADERS) as client:
            for term in search_terms:
                url = await _wikimedia_search_image(term, client)
                if url:
                    caption = f"Wikimedia Commons — {term}"
                    break
    except Exception as e:
        print(f"[chokepoint_images] fetch_chokepoint_image('{name}'): {e}")

    result = (url, caption)
    _image_cache[name] = result
    return result


def get_chokepoint_image(name: str) -> tuple[Optional[str], Optional[str]]:
    """Sync wrapper — runs async fetch in a new event loop or falls back to None."""
    if name in _image_cache:
        return _image_cache[name]
    try:
        return asyncio.run(fetch_chokepoint_image(name))
    except Exception:
        return None, None
