"""
chokepoint_images.py — Satellite / aerial imagery for strategic chokepoints.

Uses a curated fallback list of known-good Wikimedia Commons URLs.
All images are public domain or freely licensed.
"""
from __future__ import annotations
from typing import Optional

# Known-good Wikimedia satellite/aerial images indexed by chokepoint name
FALLBACK_IMAGES: dict[str, tuple[str, str]] = {
    "Strait of Hormuz": (
        "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b4/Hormuz_Strait_landsat.jpg/1280px-Hormuz_Strait_landsat.jpg",
        "Landsat satellite image of the Strait of Hormuz (NASA)",
    ),
    "Suez Canal": (
        "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/SuezCanal-EO.JPG/1280px-SuezCanal-EO.JPG",
        "NASA Earth Observatory image of the Suez Canal",
    ),
    "Strait of Malacca": (
        "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8b/Malacca_strait.jpg/1280px-Malacca_strait.jpg",
        "Satellite view of the Strait of Malacca",
    ),
    "Bab el-Mandeb": (
        "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/Bab-el-Mandeb_ISS.jpg/1280px-Bab-el-Mandeb_ISS.jpg",
        "ISS photograph of the Bab el-Mandeb strait",
    ),
    "Panama Canal": (
        "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/Panama_Canal_Gatun_Locks.jpg/1280px-Panama_Canal_Gatun_Locks.jpg",
        "Aerial view of the Panama Canal Gatun Locks",
    ),
    "Strait of Gibraltar": (
        "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2d/Strait_of_Gibraltar_-_NASA.jpg/1280px-Strait_of_Gibraltar_-_NASA.jpg",
        "NASA satellite image of the Strait of Gibraltar",
    ),
    "Bosphorus": (
        "https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/Bosphorus_from_ISS.jpg/1280px-Bosphorus_from_ISS.jpg",
        "ISS image of the Bosphorus strait, Istanbul",
    ),
    "Turkish Straits": (
        "https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/Bosphorus_from_ISS.jpg/1280px-Bosphorus_from_ISS.jpg",
        "ISS image of the Bosphorus strait, Istanbul",
    ),
    "Taiwan Strait": (
        "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Taiwan_ISS007E10807.jpg/1280px-Taiwan_ISS007E10807.jpg",
        "ISS photograph of Taiwan and the Taiwan Strait",
    ),
    "Korean Strait": (
        "https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/Korea_Strait_NASA.jpg/1280px-Korea_Strait_NASA.jpg",
        "NASA satellite view of the Korean Strait",
    ),
    "Lombok Strait": (
        "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9a/Lombok_strait_ISS.jpg/1280px-Lombok_strait_ISS.jpg",
        "ISS photograph of the Lombok Strait, Indonesia",
    ),
    "Sunda Strait": (
        "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8c/Sunda_Strait_Landsat.jpg/1280px-Sunda_Strait_Landsat.jpg",
        "Landsat image of the Sunda Strait between Java and Sumatra",
    ),
    "Danish Straits": (
        "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b4/Oresund_ISS.jpg/1280px-Oresund_ISS.jpg",
        "ISS photograph of the Oresund Strait, Denmark-Sweden",
    ),
    "Mozambique Channel": (
        "https://upload.wikimedia.org/wikipedia/commons/thumb/6/62/Mozambique_Channel_NASA.jpg/1280px-Mozambique_Channel_NASA.jpg",
        "NASA satellite image of the Mozambique Channel",
    ),
    "Cape of Good Hope": (
        "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2a/Cape_Peninsula_NASA.jpg/1280px-Cape_Peninsula_NASA.jpg",
        "NASA satellite view of the Cape Peninsula and Cape of Good Hope",
    ),
    "Drake Passage": (
        "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d6/Drake_Passage_NASA.jpg/1280px-Drake_Passage_NASA.jpg",
        "NASA satellite image of the Drake Passage",
    ),
}

_image_cache: dict[str, tuple[Optional[str], Optional[str]]] = {}


def get_chokepoint_image(name: str) -> tuple[Optional[str], Optional[str]]:
    """
    Return (image_url, caption) for a chokepoint.
    Uses fuzzy name matching against the fallback dict.
    """
    if name in _image_cache:
        return _image_cache[name]

    # Exact match
    if name in FALLBACK_IMAGES:
        result = FALLBACK_IMAGES[name]
        _image_cache[name] = result
        return result

    # Partial match — e.g. "Hormuz" matches "Strait of Hormuz"
    name_lower = name.lower()
    for key, val in FALLBACK_IMAGES.items():
        if name_lower in key.lower() or key.lower() in name_lower:
            _image_cache[name] = val
            return val

    _image_cache[name] = (None, None)
    return None, None
