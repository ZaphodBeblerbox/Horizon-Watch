"""
track_view.py — an asset's or a person's movements over a time range, for
the map (owner, 2026-10-12: "I want a track to be displayable for the
movements of the asset").

    view(points, range) -> {points, stops, start, end, raw_count, kept, distance_m}

THINNING. Thirty days of a phone walking around is tens of thousands of
rows (one per 10 m moved or per minute); the map needs a few hundred.
Douglas-Peucker (in metres, on a local flat projection) with the tolerance
searched so the line keeps at most `max_points`, and every stop's arrival
and departure always kept — a stop is a fact, not a wiggle to smooth away.

STOPS. A stay of at least STOP_MIN_S within STOP_RADIUS_M (or the fixes'
own accuracy, up to 150 m) of where it began: arrival = the first position
there, departure = the last, its centre the mean. The history writes a row
at least every minute while someone stands still, so a ten-minute stay is
about ten rows in one place.
"""
from __future__ import annotations

import datetime as _dt
import math

RANGES = {"1h": 1, "6h": 6, "24h": 24, "7d": 24 * 7, "30d": 24 * 30}
STOP_MIN_S = 10 * 60
STOP_RADIUS_M = 50
MAX_POINTS = 500


def _m(a_lat, a_lon, b_lat, b_lon) -> float:
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b_lon - a_lon) / 2) ** 2
    return 12_742_000.0 * math.asin(min(1.0, math.sqrt(h)))


def _t(v) -> _dt.datetime | None:
    try:
        t = _dt.datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return t if t.tzinfo else t.replace(tzinfo=_dt.timezone.utc)


def hours_of(rng: str | None) -> int:
    return RANGES.get(str(rng or "24h").lower(), 24)


def stops(points: list[dict], min_s: int = STOP_MIN_S, radius_m: float = STOP_RADIUS_M) -> list[dict]:
    """[{lat, lon, arrived, departed, minutes, i0, i1, count}] in time order."""
    out = []
    i, n = 0, len(points)
    while i < n:
        a = points[i]
        r = max(radius_m, min(150.0, float(a.get("accuracy_m") or 0)))
        j = i
        while j + 1 < n and _m(a["lat"], a["lon"], points[j + 1]["lat"], points[j + 1]["lon"]) <= r:
            j += 1
        t0, t1 = _t(a["at"]), _t(points[j]["at"])
        if t0 and t1 and j > i and (t1 - t0).total_seconds() >= min_s:
            seg = points[i:j + 1]
            out.append({"lat": round(sum(p["lat"] for p in seg) / len(seg), 6),
                        "lon": round(sum(p["lon"] for p in seg) / len(seg), 6),
                        "arrived": a["at"], "departed": points[j]["at"],
                        "minutes": round((t1 - t0).total_seconds() / 60), "i0": i, "i1": j, "count": len(seg)})
            i = j + 1
        else:
            i += 1
    return out


def _xy(points: list[dict]) -> list[tuple[float, float]]:
    if not points:
        return []
    lat0 = sum(p["lat"] for p in points) / len(points)
    kx = 111_320.0 * math.cos(math.radians(lat0))
    return [(p["lon"] * kx, p["lat"] * 110_574.0) for p in points]


def _seg_dist(p, a, b) -> float:
    (x, y), (x1, y1), (x2, y2) = p, a, b
    dx, dy = x2 - x1, y2 - y1
    if dx == dy == 0:
        return math.hypot(x - x1, y - y1)
    t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))


def douglas_peucker(xy: list[tuple[float, float]], eps: float, keep: set[int] | None = None) -> list[int]:
    """Indices kept (iterative; `keep` are always kept and split the line)."""
    n = len(xy)
    if n <= 2:
        return list(range(n))
    anchors = sorted({0, n - 1} | {k for k in (keep or set()) if 0 <= k < n})
    kept = set(anchors)
    stack = list(zip(anchors, anchors[1:]))
    while stack:
        s, e = stack.pop()
        if e - s < 2:
            continue
        best, bi = -1.0, -1
        for k in range(s + 1, e):
            d = _seg_dist(xy[k], xy[s], xy[e])
            if d > best:
                best, bi = d, k
        if best > eps:
            kept.add(bi)
            stack += [(s, bi), (bi, e)]
    return sorted(kept)


def thin(points: list[dict], max_points: int = MAX_POINTS, keep: set[int] | None = None) -> list[int]:
    """Indices: the smallest tolerance (1 m … 5 km, by bisection) whose line has ≤ max_points."""
    n = len(points)
    if n <= max_points:
        return list(range(n))
    xy_all = _xy(points)
    # a long range: first drop fixes within 8 m of the last one kept (someone
    # standing still writes one a minute), so the search below stays cheap
    base = list(range(n))
    if n > 4 * max_points:
        base, last = [0], xy_all[0]
        for k in range(1, n - 1):
            if (keep and k in keep) or math.hypot(xy_all[k][0] - last[0], xy_all[k][1] - last[1]) >= 8:
                base.append(k)
                last = xy_all[k]
        base.append(n - 1)
    xy = [xy_all[k] for k in base]
    pos = {k: j for j, k in enumerate(base)}
    keep = {pos[k] for k in (keep or set()) if k in pos}
    lo, hi = 0.5, 5000.0
    best = douglas_peucker(xy, hi, keep)
    for _ in range(18):
        mid = math.sqrt(lo * hi)
        idx = douglas_peucker(xy, mid, keep)
        if len(idx) <= max_points:
            best, hi = idx, mid
        else:
            lo = mid
        if hi / lo < 1.05:
            break
    return [base[j] for j in best]


def view(points: list[dict], rng: str = "24h", max_points: int = MAX_POINTS) -> dict:
    """points: [{at, lat, lon, accuracy_m?, source?}] oldest first."""
    pts = [p for p in points if p.get("lat") is not None and p.get("lon") is not None]
    st = stops(pts)
    keep = {s["i0"] for s in st} | {s["i1"] for s in st}
    idx = thin(pts, max(10, min(5000, int(max_points))), keep)
    out = [{"at": pts[i]["at"], "lat": round(pts[i]["lat"], 6), "lon": round(pts[i]["lon"], 6),
            **({"accuracy_m": pts[i]["accuracy_m"]} if pts[i].get("accuracy_m") is not None else {}),
            **({"source": pts[i]["source"]} if pts[i].get("source") else {})} for i in idx]
    dist = sum(_m(a["lat"], a["lon"], b["lat"], b["lon"]) for a, b in zip(pts, pts[1:]))
    return {"range": rng, "hours": hours_of(rng), "points": out,
            "stops": [{k: v for k, v in s.items() if k not in ("i0", "i1")} for s in st],
            "start": out[0] if out else None, "end": out[-1] if out else None,
            "raw_count": len(pts), "kept": len(out), "distance_m": round(dist)}
