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


# The status token is a LATER INVENTION. Snapshots from 2022 carry no
# geoJSON.status.* at all — their status lives in the fill colour, with
# the name in prose ("Звільнено /// Taken back"). Reading only the token
# meant every historical snapshot parsed as zero occupied territory, so a
# reader scrubbing the slider back to mid-2022 would have been shown an
# empty map and could only conclude Russia held nothing. The palette has
# not changed across the eras, so it is the reliable signal.
_FILL_STATUS = {
    "#a52714": "occupied",
    "#0f9d58": "dismissed",
    "#bcaaa4": "unknown",
}


def _status_of(feature: dict) -> str | None:
    props = feature.get("properties") or {}
    m = re.search(r"geoJSON\.status\.(\w+)", props.get("name") or "")
    if m:
        return m.group(1)
    return _FILL_STATUS.get(str(props.get("fill") or "").lower())


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


def fetch(force: bool = False, at: str | None = None) -> dict:
    """Control polygons, now or at a past date. Never raises.

    `at` is an ISO date. DeepStateMap keeps every snapshot it has ever
    published — 1,763 of them — so asking what the front looked like on a
    given day is a lookup, not an interpolation. That is what makes a
    time slider honest here: every position on it is a map somebody
    actually drew, never a blend of two.
    """
    key = f"at:{at}" if at else "latest"
    hit = _CACHE.get(key)
    if hit and not force and time.time() - hit["ts"] < _CACHE_TTL:
        return hit["data"]

    try:
        if at:
            import datetime as _dtp
            target = _dtp.datetime.fromisoformat(str(at)[:10]).replace(
                tzinfo=_dtp.timezone.utc).timestamp()
            snap_id, drawn_at = _snapshot_nearest(target)
        else:
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
    # Bearings are derived below, once the occupied areas are known.
    areas = [{"status": ft["properties"]["status"]} for ft in features]

    axes = _bearings_for(axes, features)

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
    _CACHE[key] = {"ts": time.time(), "data": data}
    return data


def timeline(limit: int = 400) -> dict:
    """The dates a slider may stop on.

    Only dates DeepStateMap actually published, so every slider position
    is a real map. Thinned to at most `limit` evenly-spaced points
    because 1,763 handles is not a control a person can use, and the
    oldest and newest are always kept so the ends mean what they say.
    """
    hit = _CACHE.get(f"timeline:{limit}")
    if hit and time.time() - hit["ts"] < _CACHE_TTL:
        return hit["data"]
    try:
        hist = _get(f"{_BASE}/history/public")
        rows = []
        for h in hist or []:
            raw = h.get("updatedAt") or ""
            if h.get("id") and raw:
                rows.append({"id": h["id"], "at": raw})
        rows.sort(key=lambda r: r["at"])
    except Exception as e:                                  # noqa: BLE001
        return {"available": False, "error": f"{type(e).__name__}: {e}",
                "snapshots": []}

    if len(rows) > limit:
        step = len(rows) / float(limit)
        thinned = [rows[int(i * step)] for i in range(limit)]
        if thinned[-1] is not rows[-1]:
            thinned[-1] = rows[-1]
        rows = thinned

    data = {"available": bool(rows), "snapshots": rows, "count": len(rows),
            "theatre": THEATRE, "source": SOURCE, "source_url": SOURCE_URL,
            "note": "every position is a published snapshot, never an interpolation"}
    _CACHE[f"timeline:{limit}"] = {"ts": time.time(), "data": data}
    return data


# ── ground that changed hands ────────────────────────────────────────────
#
# DeepStateMap keeps every snapshot it has ever published — 1,763 of them
# at the time of writing — so territorial change is not something to
# estimate. It can be MEASURED: take the occupied polygons as they were N
# days ago, take them as they are now, and subtract.
#
# That is strictly better than drawing arrows from the attack_direction
# points. An arrow is an assertion about intent; a polygon difference is
# the ground itself, and it comes with an area in square kilometres.

def _snapshot_nearest(target_epoch: float, timeout: int = _TIMEOUT):
    """(id, datetime) of the published snapshot closest to a moment."""
    hist = _get(f"{_BASE}/history/public", timeout=timeout)
    if not isinstance(hist, list) or not hist:
        return None, None
    import datetime as _dt

    def when(h):
        raw = h.get("updatedAt") or ""
        try:
            return _dt.datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()
        except Exception:                                   # noqa: BLE001
            return None

    dated = [(h, when(h)) for h in hist]
    dated = [(h, t) for h, t in dated if t is not None]
    if not dated:
        return None, None
    best = min(dated, key=lambda p: abs(p[1] - target_epoch))
    return best[0].get("id"), best[0].get("updatedAt")


def _occupied_union(snapshot_id: int):
    """One geometry for everything Russian-controlled in a snapshot."""
    from shapely.geometry import shape
    from shapely.ops import unary_union
    raw = _get(f"{_BASE}/history/{snapshot_id}/geojson")
    polys = []
    for f in raw.get("features") or []:
        if _status_of(f) != "occupied":
            continue
        if (f.get("geometry") or {}).get("type") != "Polygon":
            continue
        try:
            g = shape(f["geometry"])
            if g.is_valid and not g.is_empty:
                polys.append(g)
        except Exception:                                   # noqa: BLE001
            continue
    return unary_union(polys) if polys else None


def changes(days: int = 30) -> dict:
    """Territory gained and lost over a window. Never raises."""
    import time as _t
    days = max(1, min(int(days), 365))
    key = f"changes:{days}"
    hit = _CACHE.get(key)
    if hit and _t.time() - hit["ts"] < _CACHE_TTL:
        return hit["data"]

    try:
        now_id, now_at = latest_snapshot_id()
        then_id, then_at = _snapshot_nearest(_t.time() - days * 86400)
        if now_id is None or then_id is None or now_id == then_id:
            raise RuntimeError("no comparable snapshot in that window")
        now_g = _occupied_union(now_id)
        then_g = _occupied_union(then_id)
        if now_g is None or then_g is None:
            raise RuntimeError("a snapshot carried no occupied territory")

        from shapely.geometry import mapping
        gained = now_g.difference(then_g)      # newly occupied
        lost = then_g.difference(now_g)        # given up or retaken
    except Exception as e:                                  # noqa: BLE001
        stale = hit["data"] if hit else None
        if stale:
            return {**stale, "stale": True, "error": f"{type(e).__name__}: {e}"}
        return {"available": False, "error": f"{type(e).__name__}: {e}",
                "theatre": THEATRE, "features": []}

    # Degrees square to km square, at this latitude. Approximate and
    # labelled as such — the point is the order of magnitude, not a
    # cadastral figure.
    import math
    KM2_PER_DEG2 = 111.32 * 111.32 * math.cos(math.radians(48.0))

    features = []
    for geom, kind, meaning in (
        (gained, "gained", "occupied since the earlier snapshot"),
        (lost, "lost", "no longer occupied — retaken or withdrawn from"),
    ):
        if geom.is_empty:
            continue
        features.append({
            "type": "Feature",
            "geometry": mapping(geom.simplify(0.005, preserve_topology=True)),
            "properties": {"change": kind, "meaning": meaning,
                           "area_km2": round(geom.area * KM2_PER_DEG2, 1)},
        })

    data = {
        "available": bool(features),
        "theatre": THEATRE,
        "window_days": days,
        "from_snapshot": {"id": then_id, "at": then_at},
        "to_snapshot": {"id": now_id, "at": now_at},
        "geojson": {"type": "FeatureCollection", "features": features},
        "gained_km2": next((f["properties"]["area_km2"] for f in features
                            if f["properties"]["change"] == "gained"), 0.0),
        "lost_km2": next((f["properties"]["area_km2"] for f in features
                          if f["properties"]["change"] == "lost"), 0.0),
        "source": SOURCE,
        "source_url": SOURCE_URL,
        "caveat": ("measured between two published snapshots — it is the "
                   "difference between two maps, so it inherits whatever "
                   "either map got wrong"),
        "stale": False,
        "error": None,
    }
    _CACHE[key] = {"ts": _t.time(), "data": data}
    return data


# ── which way an attack axis points ──────────────────────────────────────
#
# DeepStateMap marks 61 axes of attack. In THEIR map each is a rotated
# arrow icon; the GeoJSON export carries only a Point and a style hash,
# so the bearing an editor drew does not survive the export. There is no
# direction in the data.
#
# The direction is therefore DERIVED, and every axis says so. An attack
# advances out of held ground, so the bearing is taken from the nearest
# occupied area's centroid through the marker and onward. That is a
# reasonable reading of a real arrangement of facts and it is not what
# any editor asserted, which is exactly what "illustrative" has to mean
# here — the position is theirs, the arrow is ours.

def _centroid(ring: list) -> tuple | None:
    pts = [p for p in ring if isinstance(p, (list, tuple)) and len(p) >= 2]
    if not pts:
        return None
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def _bearings_for(axes: list, features: list) -> list:
    """Give each attack marker a derived bearing, or leave it without one."""
    import math

    occupied = []
    for f in features:
        if (f.get("properties") or {}).get("status") != "occupied":
            continue
        try:
            c = _centroid((f.get("geometry") or {}).get("coordinates", [[]])[0])
        except Exception:                                   # noqa: BLE001
            c = None
        if c:
            occupied.append(c)

    out = []
    for a in axes:
        coords = (a.get("geometry") or {}).get("coordinates") or []
        if len(coords) < 2:
            continue
        lon, lat = float(coords[0]), float(coords[1])
        nearest, best = None, None
        for (olon, olat) in occupied:
            d = (olon - lon) ** 2 + (olat - lat) ** 2
            if best is None or d < best:
                nearest, best = (olon, olat), d
        entry = {**a, "lat": lat, "lon": lon,
                 "bearing_deg": None, "bearing_basis": None}
        if nearest and best and best > 1e-9:
            # Forward bearing FROM held ground THROUGH the marker.
            dlon = math.radians(lon - nearest[0])
            la1, la2 = math.radians(nearest[1]), math.radians(lat)
            y = math.sin(dlon) * math.cos(la2)
            x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dlon)
            entry["bearing_deg"] = round((math.degrees(math.atan2(y, x)) + 360) % 360, 1)
            entry["bearing_basis"] = (
                "ILLUSTRATIVE — derived from the nearest occupied area, not "
                "published. DeepStateMap draws the arrow as a rotated icon "
                "and the GeoJSON export carries no bearing.")
        out.append(entry)
    return out
