"""
geo_land.py — which country a point is in, or None at sea.

The waters gazetteer is a set of boxes, and a box around the South Atlantic
also covers Chad: a fusion at 10°N 20°E was named "South Atlantic". Before
naming a point by its waters, ask whether it is on land; on land, name the
country. Natural Earth country polygons, already shipped for the frontend
(public/data/world-countries.json), indexed once.
"""
from __future__ import annotations

import json
import os
import threading

_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "data", "world-countries.json")
_LOCK = threading.Lock()
_INDEX = None


def _index():
    global _INDEX
    with _LOCK:
        if _INDEX is None:
            from shapely.geometry import shape
            from shapely.strtree import STRtree
            geoms, names = [], []
            try:
                with open(_PATH, encoding="utf-8") as fh:
                    for f in json.load(fh).get("features", []):
                        try:
                            geoms.append(shape(f["geometry"]))
                            names.append((f.get("properties") or {}).get("n"))
                        except Exception:                    # noqa: BLE001
                            continue
            except OSError:
                pass
            _INDEX = (STRtree(geoms) if geoms else None, geoms, names)
    return _INDEX


def country_at(lat, lon) -> str | None:
    """The country containing the point, or None (sea, or unknown)."""
    try:
        from shapely.geometry import Point
        p = Point(float(lon), float(lat))
    except (TypeError, ValueError, ImportError):
        return None
    tree, geoms, names = _index()
    if tree is None:
        return None
    for i in tree.query(p):
        if geoms[i].contains(p):
            return names[i]
    return None
