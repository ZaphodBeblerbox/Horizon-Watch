"""Aggregate raw AIS / ADS-B positions into hourly grid-cell density rows.

Replaces unbounded raw track history with a bounded summary table:
- Grid: 0.1° lat/lon (~11 km) cells
- Time: truncated to the hour
- One row per (cell, hour, domain) — upserted on each polling cycle
"""

from __future__ import annotations

import datetime
from collections import defaultdict
from typing import Iterable, Mapping

from sqlalchemy import update

from database import TrackDensity, get_db


def _truncate_to_hour(dt: datetime.datetime) -> datetime.datetime:
    return dt.replace(minute=0, second=0, microsecond=0)


def _lat_field(track: Mapping) -> float | None:
    v = track.get("lat") if "lat" in track else track.get("latitude")
    if v is None: return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if -90 <= f <= 90 else None


def _lon_field(track: Mapping) -> float | None:
    v = track.get("lon") if "lon" in track else track.get("longitude")
    if v is None: return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if -180 <= f <= 180 else None


def _speed_field(track: Mapping) -> float | None:
    for k in ("sog", "speed", "velocity", "gs", "ground_speed"):
        if k in track and track[k] is not None:
            try:
                v = float(track[k])
                if v > 0: return v
            except (TypeError, ValueError):
                pass
    return None


def _type_field(track: Mapping, domain: str) -> str:
    if domain == "ais":
        t = track.get("ship_type") or track.get("ship_type_text") or track.get("type")
    else:
        t = track.get("aircraft_type") or track.get("type") or track.get("category") or track.get("t")
    return str(t).lower().strip() if t else "unknown"


def aggregate_tracks(tracks: Iterable[Mapping], domain: str) -> int:
    """Upsert grid-cell density counts for a batch of tracks.

    Returns the number of cells written/updated. Safe to call from any thread —
    each call opens its own session.
    """
    if domain not in ("ais", "adsb"):
        raise ValueError(f"domain must be 'ais' or 'adsb', got {domain!r}")

    hour = _truncate_to_hour(datetime.datetime.utcnow())

    cells: dict[tuple[float, float], dict] = defaultdict(
        lambda: {"count": 0, "types": {}, "speeds": []}
    )

    for t in tracks:
        lat = _lat_field(t)
        lon = _lon_field(t)
        if lat is None or lon is None:
            continue
        # Round to 0.1°. round() handles negatives correctly.
        key = (round(lat, 1), round(lon, 1))
        cell = cells[key]
        cell["count"] += 1
        ttype = _type_field(t, domain)
        cell["types"][ttype] = cell["types"].get(ttype, 0) + 1
        spd = _speed_field(t)
        if spd is not None:
            cell["speeds"].append(spd)

    if not cells:
        return 0

    written = 0
    try:
        with get_db() as db:
            for (glat, glon), data in cells.items():
                avg_speed = (sum(data["speeds"]) / len(data["speeds"])
                             if data["speeds"] else None)

                row = (db.query(TrackDensity)
                       .filter_by(grid_lat=glat, grid_lon=glon,
                                  hour=hour, domain=domain)
                       .first())

                if row is None:
                    db.add(TrackDensity(
                        grid_lat=glat, grid_lon=glon, hour=hour, domain=domain,
                        count=data["count"],
                        vessel_types=data["types"],
                        avg_speed=avg_speed,
                    ))
                else:
                    row.count = (row.count or 0) + data["count"]
                    merged = dict(row.vessel_types or {})
                    for k, v in data["types"].items():
                        merged[k] = merged.get(k, 0) + v
                    row.vessel_types = merged
                    if avg_speed is not None:
                        # running mean weighted by counts
                        total = (row.count or 1)
                        prior = row.avg_speed or 0.0
                        row.avg_speed = (
                            (prior * (total - data["count"]) + avg_speed * data["count"])
                            / total if total else avg_speed
                        )
                written += 1
            db.commit()
    except Exception as e:
        print(f"[track-density] write error ({domain}): {e}")
        return 0

    return written
