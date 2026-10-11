"""
finding_boxes.py — WHERE ON THE GROUND each automatic finding is, as a box.

WHY (owner, 2026-10-12): "for all detections we don't have bounding boxes
for the automatically generated watch areas … when we get a notification
like 'Possible tent or vehicle group detected' I want what was detected to
be shown." The optical detector already traced an outline for every object
(sentinel_detections.geo_geometry). The two radar paths did not:

  radar change  (pwtt.py → _persist_change_scan) kept each region's pixel
                extent only as a fraction of the scene ("bbox": [x, y, w, h])
                and never the scene's bounds, so it could not be drawn on a
                map;
  border sweep  (overwatch.evaluate_sweep_result) clustered regions into a
                finding and kept only the cluster's centroid and areas.

Every finding now carries `box` = [west, south, east, north] in degrees and
the polygon of it. Where the real pixel extent is known it is used
(box_source "pixel_extent"); for findings stored before that, the extent
is rebuilt from the regions still in the database ("regions"), and only
when nothing is left is a square of the finding's own area drawn around
its centre ("area_estimate") — said as such, so nobody reads a guess as a
measurement.

Pure functions only (tested in test_finding_boxes.py); zone_findings.py
does the database reads.
"""
from __future__ import annotations

import math

M_PER_DEG_LAT = 110_574.0


def _m_per_deg_lon(lat: float) -> float:
    return 111_320.0 * max(0.05, math.cos(math.radians(lat)))


def as_bounds(b) -> tuple | None:
    """(west, south, east, north) from any of the shapes this app uses:
    {west,south,east,north}, a zone bbox {min_lon,min_lat,max_lon,max_lat},
    or a [w, s, e, n] list. None when it is not one."""
    if b is None:
        return None
    try:
        if isinstance(b, dict):
            if "west" in b:
                w, s, e, n = b["west"], b["south"], b["east"], b["north"]
            else:
                w, s, e, n = b["min_lon"], b["min_lat"], b["max_lon"], b["max_lat"]
        else:
            w, s, e, n = b
        w, s, e, n = float(w), float(s), float(e), float(n)
    except (KeyError, TypeError, ValueError):
        return None
    if not (e > w and n > s):
        return None
    return (w, s, e, n)


def frac_to_geo(frac, bounds) -> list | None:
    """A box given as fractions of the scene [x, y, w, h] (y down from the
    north edge, which is how every image in this app is laid out) → degrees."""
    bb = as_bounds(bounds)
    if bb is None or not frac or len(frac) != 4:
        return None
    try:
        x, y, fw, fh = (float(v) for v in frac)
    except (TypeError, ValueError):
        return None
    w, s, e, n = bb
    dx, dy = e - w, n - s
    return [round(w + x * dx, 6), round(n - (y + fh) * dy, 6), round(w + (x + fw) * dx, 6), round(n - y * dy, 6)]


def geo_to_frac(box, bounds) -> list | None:
    """The inverse: degrees → [x, y, w, h] as fractions of the frame (may run
    outside 0..1 when the box is partly off the frame)."""
    bb, gb = as_bounds(bounds), as_bounds(box)
    if bb is None or gb is None:
        return None
    w, s, e, n = bb
    dx, dy = e - w, n - s
    return [round((gb[0] - w) / dx, 6), round((n - gb[3]) / dy, 6),
            round((gb[2] - gb[0]) / dx, 6), round((gb[3] - gb[1]) / dy, 6)]


def area_box(lat: float, lon: float, area_m2: float | None, min_side_m: float = 60.0) -> list:
    """A square of the given area centred on the point — the honest fallback
    when the real extent is gone."""
    side = max(min_side_m, math.sqrt(max(0.0, float(area_m2 or 0.0))))
    dlat = side / 2 / M_PER_DEG_LAT
    dlon = side / 2 / _m_per_deg_lon(lat)
    return [round(lon - dlon, 6), round(lat - dlat, 6), round(lon + dlon, 6), round(lat + dlat, 6)]


def union(boxes) -> list | None:
    bs = [as_bounds(b) for b in boxes or []]
    bs = [b for b in bs if b]
    if not bs:
        return None
    return [min(b[0] for b in bs), min(b[1] for b in bs), max(b[2] for b in bs), max(b[3] for b in bs)]


def polygon(box) -> dict | None:
    bb = as_bounds(box)
    if bb is None:
        return None
    w, s, e, n = bb
    return {"type": "Polygon", "coordinates": [[[w, s], [e, s], [e, n], [w, n], [w, s]]]}


def box_from_geometry(geom) -> list | None:
    """[w, s, e, n] around a GeoJSON Polygon/MultiPolygon (lon, lat order)."""
    if not isinstance(geom, dict):
        return None
    coords = geom.get("coordinates")
    pts = []

    def walk(c):
        if isinstance(c, (list, tuple)) and len(c) >= 2 and all(isinstance(v, (int, float)) for v in c[:2]):
            pts.append((float(c[0]), float(c[1])))
        elif isinstance(c, (list, tuple)):
            for x in c:
                walk(x)
    walk(coords)
    if not pts:
        return None
    lons, lats = [p[0] for p in pts], [p[1] for p in pts]
    if max(lons) <= min(lons) or max(lats) <= min(lats):
        return None
    return [min(lons), min(lats), max(lons), max(lats)]


def box_size_m(box) -> tuple[float, float] | None:
    """(width, height) in metres."""
    bb = as_bounds(box)
    if bb is None:
        return None
    w, s, e, n = bb
    lat = (s + n) / 2
    return ((e - w) * _m_per_deg_lon(lat), (n - s) * M_PER_DEG_LAT)


def size_text(area_m2: float | None) -> str | None:
    if not area_m2:
        return None
    a = float(area_m2)
    if a >= 10_000:
        ha = a / 10_000
        return f"{ha:.1f} ha" if ha < 10 else f"{ha:.0f} ha"
    return f"{a:,.0f} m²"


def crop_window(box, frame_bounds, img_w: int, img_h: int, pad: float = 1.0, min_px: int = 96) -> dict | None:
    """The pixel window of a scene to cut out around a finding, and where the
    finding sits inside it.

    The window is the box grown by `pad` times its own size on every side,
    at least `min_px` square, clamped to the image. Returns
    {x0, y0, x1, y1, box: [x, y, w, h] as fractions of the window} or None
    when the box does not touch the frame."""
    f = geo_to_frac(box, frame_bounds)
    if f is None or img_w <= 0 or img_h <= 0:
        return None
    bx0, by0 = f[0] * img_w, f[1] * img_h
    bx1, by1 = (f[0] + f[2]) * img_w, (f[1] + f[3]) * img_h
    if bx1 < 0 or by1 < 0 or bx0 > img_w or by0 > img_h:
        return None
    bw, bh = max(1.0, bx1 - bx0), max(1.0, by1 - by0)
    cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
    half = max(min_px / 2, max(bw, bh) * (0.5 + pad))
    x0, x1 = max(0, int(math.floor(cx - half))), min(img_w, int(math.ceil(cx + half)))
    y0, y1 = max(0, int(math.floor(cy - half))), min(img_h, int(math.ceil(cy + half)))
    if x1 - x0 < 2 or y1 - y0 < 2:
        return None
    ww, hh = x1 - x0, y1 - y0
    return {"x0": x0, "y0": y0, "x1": x1, "y1": y1,
            "box": [round((bx0 - x0) / ww, 5), round((by0 - y0) / hh, 5), round(bw / ww, 5), round(bh / hh, 5)]}


# ── one shape for every kind of finding ──────────────────────────────────

SWEEP_LABEL = {"new tent/vehicle cluster": "Possible tent or vehicle group",
               "new cleared/disturbed ground": "Cleared or disturbed ground"}


def _day(v) -> str | None:
    if not v:
        return None
    s = v.isoformat() if hasattr(v, "isoformat") else str(v)
    return s[:10]


def finding(*, fid: str, kind: str, label: str, lat: float, lon: float, box, box_source: str,
            area_m2: float | None = None, tone: str = "amber", date=None, scan_id=None, zone_id=None,
            **extra) -> dict:
    bb = as_bounds(box) or as_bounds(area_box(lat, lon, area_m2))
    box_l = [round(v, 6) for v in bb]
    return {"id": fid, "kind": kind, "label": label, "lat": round(float(lat), 6), "lon": round(float(lon), 6),
            "area_m2": round(float(area_m2)) if area_m2 else None, "size": size_text(area_m2),
            "box": box_l, "polygon": polygon(box_l), "box_source": box_source, "tone": tone,
            "date": _day(date), "scan_id": scan_id, "zone_id": zone_id, **extra}


def region_box(region: dict, bounds=None) -> tuple[list | None, str]:
    """A radar change region's box and how it was obtained.

    region: a pwtt detection ({bbox, centroid_lat, …}) or a stored change
    detection's attributes merged with its centroid ({geo_box?, bbox?, …})."""
    gb = as_bounds(region.get("geo_box"))
    if gb:
        return list(gb), "pixel_extent"
    if region.get("bbox") and bounds is not None:
        b = frac_to_geo(region["bbox"], bounds)
        if b:
            return b, "pixel_extent"
    lat, lon = region.get("centroid_lat", region.get("lat")), region.get("centroid_lon", region.get("lon"))
    if lat is None or lon is None:
        return None, "none"
    return area_box(float(lat), float(lon), region.get("area_m2")), "area_estimate"


def radar_label(direction: str | None) -> tuple[str, str]:
    if direction == "removed":
        return "Radar change — returns gone (darker)", "amber"
    return "Radar change — new bright returns", "red"


def radar_change_finding(region: dict, bounds=None, *, scan_id=None, zone_id=None, date=None,
                         new: bool = True) -> dict | None:
    lat, lon = region.get("centroid_lat", region.get("lat")), region.get("centroid_lon", region.get("lon"))
    if lat is None or lon is None:
        return None
    box, src = region_box(region, bounds)
    label, tone = radar_label(region.get("change_direction") or region.get("direction"))
    rid = region.get("detection_id") or f"{float(lat):.5f},{float(lon):.5f}"
    return finding(fid=f"chg:{rid}", kind="radar_change", label=label, lat=lat, lon=lon, box=box, box_source=src,
                   area_m2=region.get("area_m2"), tone=tone if new else "amber", date=date, scan_id=scan_id,
                   zone_id=zone_id, direction=region.get("change_direction") or region.get("direction"),
                   t_peak=region.get("t_peak"), new=new, sensor="Sentinel-1 radar")


def sweep_finding(f: dict, i: int, *, zone_id=None, scan_id=None, date=None, regions_box=None) -> dict | None:
    """One border-sweep finding (overwatch.evaluate_sweep_result) as a box.
    `regions_box` is the extent rebuilt from the stored regions, for a
    finding written before the sweep kept its own."""
    if f.get("lat") is None or f.get("lon") is None:
        return None
    area = float(f.get("appeared_m2") or 0) + float(f.get("cleared_m2") or 0)
    if as_bounds(f.get("box")):
        box, src = list(as_bounds(f["box"])), f.get("box_source") or "pixel_extent"
    elif as_bounds(regions_box):
        box, src = list(as_bounds(regions_box)), "regions"
    else:
        box, src = area_box(f["lat"], f["lon"], area), "area_estimate"
    kind = f.get("kind") or ""
    return finding(fid=f"sweep:{zone_id or 'x'}:{i}", kind="sweep_find", label=SWEEP_LABEL.get(kind, kind or "Sweep finding"),
                   lat=f["lat"], lon=f["lon"], box=box, box_source=src, area_m2=area or None,
                   tone="red" if kind == "new tent/vehicle cluster" else "amber", date=date, scan_id=scan_id,
                   zone_id=zone_id, regions=f.get("regions"), t_peak=f.get("t_peak"), landcover=f.get("landcover"),
                   sensor="Sentinel-1 radar")


def object_finding(det: dict, *, zone_id=None, date=None) -> dict | None:
    """An optical/SAR object the detector outlined (sentinel_detections row as
    a dict, geo_geometry parsed)."""
    lat, lon = det.get("centroid_lat"), det.get("centroid_lon")
    if lat is None or lon is None:
        return None
    box = box_from_geometry(det.get("geo_geometry"))
    src = "detector_outline" if box else "area_estimate"
    if not box:
        box = area_box(lat, lon, det.get("area_m2") or 900)
    what = str(det.get("object_type") or "object").replace("_", " ")
    ct = (det.get("attributes") or {}).get("change_type") if isinstance(det.get("attributes"), dict) else None
    return finding(fid=f"det:{det.get('detection_id')}", kind="object",
                   label=f"New {what}" if ct == "new" else what.capitalize(),
                   lat=lat, lon=lon, box=box, box_source=src, area_m2=det.get("area_m2"),
                   tone="red" if ct == "new" else "amber", date=date, scan_id=det.get("scan_id"), zone_id=zone_id,
                   confidence=det.get("confidence"), change_type=ct,
                   sensor="Sentinel-1 radar" if (det.get("instrument") == "SAR") else "Sentinel-2 optical")


def cluster_extent(regions: list[dict], bounds=None) -> tuple[list | None, str]:
    """The extent of a cluster of change regions: the union of their boxes,
    and "pixel_extent" only when every member's box was real."""
    boxes, srcs = [], set()
    for r in regions or []:
        b, s = region_box(r, bounds)
        if b:
            boxes.append(b)
            srcs.add(s)
    if not boxes:
        return None, "none"
    return union(boxes), ("pixel_extent" if srcs == {"pixel_extent"} else "area_estimate")
