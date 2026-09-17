"""
coverage_map.py — PARALLAX §13, the server side.

Which modalities actually reach each 10° cell, computed from the tables this
system really holds. Nothing here asserts coverage: a modality appears for a
cell only because a row with a position exists in the window.

The class gate is the point. §13: "Only A and B count toward instrumented
coverage — a cell reached solely by class-D reporting is not covered, it is
rumoured." So `press` is computed and returned like any other modality, and
is excluded from the instrument count by the classifier rather than being
quietly dropped here — a caller that wants to show why a cell is press-only
needs to see the press strength.

WHAT IS HONESTLY ABSENT
-----------------------
§13 lists eight modalities. This system has real feeds for five: opt and sar
(sentinel_detections, by instrument), ais, adsb, and press. There is no
thermal, atmospheric or network feed deployed, so those three are reported as
unavailable rather than as zero — "we have no thermal sensor" and "the
thermal sensor saw nothing" are different statements, and only the second is
a fact about the world.
"""
from __future__ import annotations

import datetime
from collections import defaultdict

CELL_DEG = 10

#: Modalities this deployment can actually answer for. The rest of §13's
#: table is real, but nothing here feeds it.
AVAILABLE = ("opt", "sar", "ais", "adsb", "press")
UNAVAILABLE = ("therm", "atmo", "net")


def cell_key(lat: float, lon: float) -> str:
    return f"{int(lat // CELL_DEG) * CELL_DEG}:{int(lon // CELL_DEG) * CELL_DEG}"


def _bump(cells: dict, lat, lon, mod: str) -> None:
    if lat is None or lon is None:
        return
    try:
        lat = float(lat); lon = float(lon)
    except (TypeError, ValueError):
        return
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return
    cells[cell_key(lat, lon)][mod] += 1


def compute_cells(db, *, window_days: int = 30) -> dict:
    """Per-cell modality counts, plus which cells carry a standing task.

    Counts are converted to a 0-1 strength by the caller-facing layer below;
    the raw count travels too, because "one AIS position" and "forty thousand"
    are the same strength once clamped and an analyst should be able to tell
    them apart.
    """
    from database import (
        SentinelDetection, NewsArticle, WatchZone, Alert,
    )

    since = datetime.datetime.utcnow() - datetime.timedelta(days=window_days)
    cells: dict = defaultdict(lambda: defaultdict(int))

    # Imagery — split by the instrument that actually produced it.
    for r in db.query(SentinelDetection).filter(
        SentinelDetection.centroid_lat.isnot(None),
        SentinelDetection.created_at >= since,
    ).all():
        mod = "sar" if (r.instrument or "").upper().startswith("SAR") else "opt"
        _bump(cells, r.centroid_lat, r.centroid_lon, mod)

    # Press — class D, counted so it can be excluded knowingly.
    for r in db.query(NewsArticle).filter(NewsArticle.lat.isnot(None)).all():
        _bump(cells, r.lat, r.lon, "press")

    # AIS and ADS-B, via the alert families that carry positions for them.
    for r in db.query(Alert).filter(
        Alert.status == "active", Alert.lat.isnot(None),
        Alert.created_at >= since,
    ).limit(50000).all():
        t = (r.alert_type or "").lower()
        if "aircraft" in t or "adsb" in t:
            _bump(cells, r.lat, r.lon, "adsb")
        elif "vessel" in t or "ais" in t:
            _bump(cells, r.lat, r.lon, "ais")

    # A standing task is what separates "instrumented" from "archive": two
    # feeds nobody has pointed at anything are an archive.
    tasked: set[str] = set()
    for z in db.query(WatchZone).filter(WatchZone.status == "active").all():
        lat = getattr(z, "center_lat", None)
        lon = getattr(z, "center_lon", None)
        if lat is None or lon is None:
            b = getattr(z, "bbox_min_lat", None)
            if b is not None:
                lat = (z.bbox_min_lat + z.bbox_max_lat) / 2
                lon = (z.bbox_min_lon + z.bbox_max_lon) / 2
        if lat is not None and lon is not None:
            tasked.add(cell_key(float(lat), float(lon)))

    return {"cells": cells, "tasked": tasked}


def to_payload(computed: dict, *, window_days: int) -> dict:
    """Shape for the client: a strength per modality, the raw counts, and the
    honest list of modalities this deployment cannot answer for at all."""
    cells = computed["cells"]
    tasked = computed["tasked"]
    out = []
    for key, mods in cells.items():
        south, west = (int(x) for x in key.split(":"))
        # Strength is a presence measure, deliberately saturating early: the
        # question §13 asks is "does anything reach this cell", not "how busy
        # is it". Five positions in a month is reach; five hundred is the same
        # reach with more traffic behind it.
        strength = {m: min(1.0, mods.get(m, 0) / 5.0) for m in AVAILABLE if mods.get(m)}
        out.append({
            "cell": key,
            "bounds": {"south": south, "west": west, "north": south + CELL_DEG, "east": west + CELL_DEG},
            "mods": strength,
            "counts": {m: mods.get(m, 0) for m in AVAILABLE if mods.get(m)},
            "tasked": key in tasked,
        })
    out.sort(key=lambda c: c["cell"])
    return {
        "window_days": window_days,
        "cell_degrees": CELL_DEG,
        "cells": out,
        # Not zero — absent. "We have no thermal sensor" and "the thermal
        # sensor saw nothing" are different statements.
        "modalities_unavailable": list(UNAVAILABLE),
        "modalities_available": list(AVAILABLE),
    }
