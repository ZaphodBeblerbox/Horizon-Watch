"""
frontlines.py — territorial control, from the one free source that has it.

WHY THIS IS HARD TO SOURCE AND WHY THE ANSWER IS UKRAINE-ONLY. Control of
terrain is expensive to maintain and almost never published openly:
LiveUAMap and Janes are paid, ISW publishes assessments as images rather
than geodata, and ACLED — confirmed with them directly — is not free.
DeepStateMap is a Ukrainian OSINT project that serves its full control
layer as GeoJSON with no key and no rate limit, updated several times a
day.

SO THIS LAYER COVERS ONE WAR. That is a real limit and it is stated in the
response rather than left for a reader to infer from an empty map over
Sudan. A "frontlines" layer that silently shows nothing outside Ukraine
would imply those conflicts have no front line.

WHAT THE POLYGONS MEAN. DeepStateMap encodes status in a tri-lingual name
string ending in a token:

    geoJSON.status.occupied          Russian-controlled
    geoJSON.status.dismissed         retaken or withdrawn from
    geoJSON.status.unknown           contested, the grey zone
    geoJSON.status.attack_direction  an axis of attack (points)

The grey zone is the interesting one and the most easily misread: it is
where DeepStateMap declines to call it, not where nothing is happening.

ATTRIBUTION IS A CONDITION OF USE, not a courtesy, so every response
carries the source and its page.
"""
from __future__ import annotations

import json
import re
import time
import urllib.request

_UA = "HorizonWatch/2.0 (+https://github.com/ZaphodBeblerbox/Horizon-Watch)"
_BASE = "https://deepstatemap.live/api"
_TIMEOUT = 45
_CACHE: dict = {}
_CACHE_TTL = 30 * 60          # it updates a few times a day; 30m is generous

SOURCE = "DeepStateMap"
SOURCE_URL = "https://deepstatemap.live/"
THEATRE = "Ukraine"

# Only these are worth drawing as territory. attack_direction is a point
# layer and the rest are place labels.
DRAWABLE_STATUS = ("occupied", "dismissed", "unknown")

STATUS_MEANING = {
    "occupied": "Russian-controlled",
    "dismissed": "retaken or withdrawn from",
    "unknown": "contested — DeepStateMap declines to call it",
}


# ── the theatres, and why most of them are empty ─────────────────────────
#
# Asked directly which other conflicts have frontlines available. Checked,
# rather than assumed: Sudan War Monitor publishes no API, UN OCHA's oPt
# ArcGIS host does not resolve, LiveUAMap requires a paid key in every
# theatre, and ISW publishes control-of-terrain as images rather than
# geodata. Ukraine is the only war with an open, machine-readable control
# layer, and that is a fact about the world rather than a gap in this app.
#
# The unavailable theatres are LISTED ANYWAY, each with its reason. A
# frontlines toggle that offers only Ukraine implies the others have no
# front line; one that offers four and explains three tells the truth and
# costs one line to fill in when a source appears.
THEATRES: list[dict] = [
    {"key": "ukraine", "label": "Ukraine", "available": True,
     "source": SOURCE, "source_url": SOURCE_URL},
    {"key": "sudan", "label": "Sudan", "available": False,
     "reason": "no open control-polygon feed — Sudan War Monitor publishes "
               "maps, not geodata"},
    {"key": "gaza", "label": "Gaza", "available": False,
     "reason": "no open control-polygon feed — OCHA publishes access and "
               "damage layers, not lines of control"},
    {"key": "yemen", "label": "Yemen", "available": False,
     "reason": "no open control-polygon feed — front lines are reported in "
               "prose by ACLED and Janes, both paid"},
]


def theatres() -> list[dict]:
    return [dict(t) for t in THEATRES]


def _get(url: str, timeout: int = _TIMEOUT):
    req = urllib.request.Request(url, headers={"User-Agent": _UA,
                                               "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def _status_of(feature: dict) -> str | None:
    name = ((feature.get("properties") or {}).get("name")) or ""
    m = re.search(r"geoJSON\.status\.(\w+)", name)
    return m.group(1) if m else None


def _english_name(feature: dict) -> str | None:
    """DeepStateMap names are 'Ukrainian /// English /// token'."""
    name = ((feature.get("properties") or {}).get("name")) or ""
    parts = [p.strip() for p in name.split("///")]
    return parts[1] if len(parts) > 2 and parts[1] else (parts[0] or None)


def latest_snapshot_id(timeout: int = _TIMEOUT) -> tuple[int | None, str | None]:
    """The newest published snapshot, and when it was drawn."""
    hist = _get(f"{_BASE}/history/public", timeout=timeout)
    if not isinstance(hist, list) or not hist:
        return None, None
    newest = max(hist, key=lambda h: h.get("id", 0))
    return newest.get("id"), (newest.get("updatedAt") or newest.get("datetime"))


def fetch(force: bool = False) -> dict:
    """Current control polygons. Never raises."""
    hit = _CACHE.get("latest")
    if hit and not force and time.time() - hit["ts"] < _CACHE_TTL:
        return hit["data"]

    try:
        snap_id, drawn_at = latest_snapshot_id()
        if snap_id is None:
            raise RuntimeError("no snapshots listed")
        raw = _get(f"{_BASE}/history/{snap_id}/geojson")
    except Exception as e:                                  # noqa: BLE001
        stale = hit["data"] if hit else None
        if stale:
            # A dropped fetch is not a peace settlement. Serving the last
            # known map, clearly marked, beats erasing the front line.
            return {**stale, "stale": True,
                    "error": f"{type(e).__name__}: {e}"}
        return {"available": False, "error": f"{type(e).__name__}: {e}",
                "theatre": THEATRE, "features": [], "source": SOURCE,
                "source_url": SOURCE_URL}

    # Returned as a FeatureCollection, not a bag of geometries, because the
    # client draws it with Cesium's GeoJsonDataSource and clampToGround —
    # the only path in this app that reliably drapes a polygon on the globe.
    # Hand-built PolygonGraphics entities created fine and drew nothing:
    # measured, 94 of 94 rings valid, 0 changed pixels over Donetsk.
    features, axes = [], []
    for f in raw.get("features") or []:
        st = _status_of(f)
        geom = (f.get("geometry") or {}).get("type")
        if geom == "Polygon" and st in DRAWABLE_STATUS:
            features.append({
                "type": "Feature",
                "geometry": f.get("geometry"),
                "properties": {"status": st, "meaning": STATUS_MEANING.get(st)},
            })
        elif geom == "Point" and st == "attack_direction":
            axes.append({"geometry": f.get("geometry"),
                         "name": _english_name(f)})
    areas = [{"status": ft["properties"]["status"]} for ft in features]

    data = {
        "available": bool(areas),
        "theatre": THEATRE,
        "theatre_key": "ukraine",
        "snapshot_id": snap_id,
        "drawn_at": drawn_at,
        "geojson": {"type": "FeatureCollection", "features": features},
        "areas": areas,
        "attack_axes": axes,
        "counts": {s: sum(1 for a in areas if a["status"] == s)
                   for s in DRAWABLE_STATUS},
        "source": SOURCE,
        "source_url": SOURCE_URL,
        # Said in the payload so no caller has to remember it.
        "theatres": theatres(),
        "coverage_note": ("Ukraine only. Checked: no open source publishes "
                          "control polygons for Sudan, Gaza or Yemen, so an "
                          "empty map elsewhere means unmapped, not quiet."),
        "stale": False,
        "error": None,
    }
    _CACHE["latest"] = {"ts": time.time(), "data": data}
    return data
