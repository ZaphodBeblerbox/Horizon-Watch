#!/usr/bin/env python3
"""
reevaluate_smoke_detections.py — DRY RUN: what the smoke classifier would make
of the smoke plumes production has already published.

Nothing is written to production. The prod database is opened read-only
(sqlite `mode=ro`) over `railway ssh`, and the only output is local: a JSON of
per-detection features and classes (numbers, no imagery) and a report.

    # 1. export prod's smoke detections (read-only) with the FIRMS points
    #    around each pass
    python tools/reevaluate_smoke_detections.py pull --out /tmp/x/prod_smoke.json

    # 2. re-fetch each pass's Sentinel-2 bands (now + the same baseline passes
    #    smoke.py used), measure every published plume and classify it.
    #    --crops writes before/now PNGs for eyeballing (temp dir; delete after)
    python tools/reevaluate_smoke_detections.py measure --in /tmp/x/prod_smoke.json \
        --out /tmp/x/measured.json [--crops /tmp/x/crops] [--scans 5]

    # 3. the report: how many would be reclassified, by class, with examples
    python tools/reevaluate_smoke_detections.py report --in /tmp/x/measured.json

Needs COPERNICUS_CLIENT_ID / COPERNICUS_CLIENT_SECRET (backend/.env) for the
bands; WorldCover and Overpass are public.
"""
from __future__ import annotations

import argparse
import base64
import collections
import concurrent.futures as cf
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(os.path.dirname(HERE), "backend")
sys.path.insert(0, BACKEND)

EXPORT = r'''
import os, sqlite3, json, sys
c = sqlite3.connect(f"file:{os.environ['DATA_DIR']}/akili.db?mode=ro", uri=True)
c.row_factory = sqlite3.Row
rows = c.execute("""select d.detection_id, d.scan_id, d.zone_id, d.object_type, d.centroid_lat, d.centroid_lon,
  d.area_m2, d.geo_geometry, d.attributes, d.created_at, d.reviewed_status, s.image_timestamp_utc,
  s.cloud_cover_percent, z.system_id, z.name, z.bbox_min_lon, z.bbox_min_lat, z.bbox_max_lon, z.bbox_max_lat, z.aoi_class
  from sentinel_detections d join sentinel_scans s on s.scan_id=d.scan_id join watch_zones z on z.id=d.zone_id
  where d.object_type='smoke_plume'""").fetchall()
out, firms = [], {}
for r in rows:
    d = dict(r)
    key = d["scan_id"]
    if key not in firms and d["image_timestamp_utc"]:
        day = d["image_timestamp_utc"][:10]
        firms[key] = [list(x) for x in c.execute(
            "select lat, lon, frp, acquired_at from fire_detections where lat between ? and ? and lon between ? and ? "
            "and date(acquired_at) between date(?, '-1 day') and date(?, '+1 day')",
            (d["bbox_min_lat"] - .02, d["bbox_max_lat"] + .02, d["bbox_min_lon"] - .03, d["bbox_max_lon"] + .03, day, day))]
    out.append(d)
sys.stdout.write("JSONSTART" + json.dumps({"detections": out, "firms": firms}) + "JSONEND\n")
'''


def pull(out_path: str) -> None:
    """Read-only export from production."""
    b64 = base64.b64encode(EXPORT.encode()).decode()
    p = subprocess.run(["railway", "ssh", "-s", "Horizon-Watch", "--", f"cd /app && echo {b64} | base64 -d | python -"],
                       capture_output=True, text=True, timeout=600)
    t = p.stdout + p.stderr
    a, b = t.find("JSONSTART"), t.find("JSONEND")
    if a < 0 or b < 0:
        sys.exit(f"export failed:\n{t[-2000:]}")
    data = json.loads(t[a + 9:b])
    with open(out_path, "w") as fh:
        json.dump(data, fh)
    print(f"{len(data['detections'])} smoke detections from {len(data['firms'])} passes -> {out_path}")


def _env() -> None:
    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(BACKEND, ".env"))
    except ImportError:
        pass


def _crop_png(path, now, base, comp, ys, xs) -> None:
    import numpy as np
    from PIL import Image, ImageDraw

    def rgb(a):
        x = np.stack([a[2], a[1], a[0]], -1)[ys, xs]
        return (np.clip(x / 0.3, 0, 1) ** 0.8 * 255).astype(np.uint8)

    import cv2
    c = comp[ys, xs].astype(np.uint8)
    cnts, _ = cv2.findContours(c, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    panels = []
    for img in (rgb(base), rgb(now)):
        im = Image.fromarray(img).resize((img.shape[1] * 2, img.shape[0] * 2), Image.NEAREST)
        d = ImageDraw.Draw(im)
        for k in cnts:
            pts = [(int(p[0][0]) * 2, int(p[0][1]) * 2) for p in k]
            if len(pts) > 1:
                d.line(pts + [pts[0]], fill=(255, 0, 255), width=1)
        panels.append(im)
    w = sum(p.width for p in panels) + 6
    out = Image.new("RGB", (w, panels[0].height), (0, 0, 0))
    out.paste(panels[0], (0, 0))
    out.paste(panels[1], (panels[0].width + 6, 0))
    out.save(path)


def _scl_hist(now, comp):
    import numpy as np
    v = now[6][comp].astype(int)
    return {int(k): round(float(n) / max(1, v.size), 3) for k, n in zip(*np.unique(v, return_counts=True))}


def measure_scan(dets: list, firms_pts: list, crops: str | None, arrays=None) -> list:
    import numpy as np
    import land_water
    import s2_bands
    import smoke
    import smoke_classify as sc
    d0 = dets[0]
    W, S, E, N = d0["bbox_min_lon"], d0["bbox_min_lat"], d0["bbox_max_lon"], d0["bbox_max_lat"]
    bounds = {"west": W, "south": S, "east": E, "north": N}
    day = d0["image_timestamp_utc"][:10]
    past = (json.loads(d0["attributes"] or "{}").get("baseline_passes") or [])
    w, h = s2_bands.size_at(W, S, E, N, 20)
    if arrays is not None:
        now, hist = arrays
    else:
        with cf.ThreadPoolExecutor(3) as ex:
            arrs = list(ex.map(lambda dt: s2_bands.fetch(W, S, E, N, dt, w, h), [day] + past))
        now, hist = arrs[0], np.stack(arrs[1:])
    ctx = {}
    try:
        wc = land_water.worldcover_classes(W, S, E, N, w, h)
        if wc is not None:
            ctx["worldcover"] = wc
    except Exception as e:                                           # noqa: BLE001
        print(f"  worldcover: {type(e).__name__}: {e}", flush=True)
    ctx.update(sc.osm_context(bounds, (h, w)))
    # smoke.py's own baseline (plain median) for its fire mask, as in the scanner
    _d, _b, fire, _rv = smoke.masks(now, np.median(hist, axis=0))
    ctx["fire"] = fire
    base = sc.baseline(hist)
    pts = [(p[0], p[1]) for p in firms_pts]
    out = []
    for d in dets:
        geom = json.loads(d["geo_geometry"])
        comp = sc.polygon_mask(geom, bounds, (h, w))
        row = {k: d[k] for k in ("detection_id", "scan_id", "system_id", "name", "aoi_class", "centroid_lat",
                                 "centroid_lon", "area_m2", "image_timestamp_utc", "created_at")}
        row["smoke_py"] = {k: v for k, v in json.loads(d["attributes"] or "{}").items()
                           if k in ("kind", "fire_px", "density", "description", "baseline_passes")}
        if not comp.any():
            row["error"] = "empty mask"
            out.append(row)
            continue
        v = sc.assess(now, hist, comp, bounds, ctx, base=base, firms_points=pts)
        row.update({"class": v["class"], "confidence": v["confidence"], "classifier": v["classifier"],
                    "smoke_score": v["smoke_score"], "reasons": [r["text"] for r in v["reasons"]],
                    "features": v["features"], "scl_now": _scl_hist(now, comp),
                    "scl_past": [_scl_hist(p, comp) for p in hist]})
        if crops:
            ys, xs = sc._window(comp, sc.pixel_m(bounds, comp.shape))
            _crop_png(os.path.join(crops, f"{d['detection_id']}.png"), now, base, comp, ys, xs)
        out.append(row)
    return out


def scene(lat: float, lon: float, date: str, km: float, out_path: str, crops: str | None, tag: str) -> list:
    """Run smoke.py + the classifier on one place and day, the way the scanner
    does (baseline = up to 5 earlier passes with <= 20% cloud in 60 days).
    For building the labelled set from known events (FIRMS fires, strikes)."""
    import math
    import numpy as np
    import s2_bands
    import smoke
    _env()
    dlat = km / 2 / 110.574
    dlon = km / 2 / (111.320 * math.cos(math.radians(lat)))
    W, S, E, N = lon - dlon, lat - dlat, lon + dlon, lat + dlat
    bounds = {"west": W, "south": S, "east": E, "north": N}
    past = [p["date"] for p in s2_bands.passes(W, S, E, N, 60, 20, date) if p["date"] != date][:5]
    if len(past) < 3:
        print(f"  {tag}: only {len(past)} clear earlier passes — no baseline")
        return []
    w, h = s2_bands.size_at(W, S, E, N, 20)
    with cf.ThreadPoolExecutor(3) as ex:
        arrs = list(ex.map(lambda dt: s2_bands.fetch(W, S, E, N, dt, w, h), [date] + past))
    now, hist = arrs[0], np.stack(arrs[1:])
    found, _fires = smoke.plumes(now, np.median(hist, axis=0), bounds)
    print(f"  {tag}: {len(found)} smoke.py candidate(s)")
    dets = [{"detection_id": f"SCENE-{tag}-{i}", "scan_id": f"scene-{tag}", "system_id": None, "name": tag,
             "aoi_class": "scene", "centroid_lat": p["source_lat"], "centroid_lon": p["source_lon"],
             "area_m2": p["area_km2"] * 1e6, "image_timestamp_utc": date + "T00:00:00", "created_at": None,
             "geo_geometry": json.dumps(p["geometry"]),
             "attributes": json.dumps({**{k: v for k, v in p.items() if k != "geometry"}, "description": smoke.describe(p),
                                       "baseline_passes": past}),
             "bbox_min_lon": W, "bbox_min_lat": S, "bbox_max_lon": E, "bbox_max_lat": N} for i, p in enumerate(found)]
    if not dets:
        return []
    if crops:
        os.makedirs(crops, exist_ok=True)
    rows = measure_scan(dets, _firms_live(W, S, E, N, date), crops, arrays=(now, hist))
    old = json.load(open(out_path)) if os.path.exists(out_path) else []
    keep = {r["detection_id"]: r for r in old}
    keep.update({r["detection_id"]: r for r in rows})
    with open(out_path, "w") as fh:
        json.dump(list(keep.values()), fh)
    return rows


def _firms_live(W, S, E, N, date: str) -> list:
    """FIRMS VIIRS points around the day (the day before to the day after), from NASA's area API."""
    import datetime as dt
    import urllib.request
    key = os.getenv("FIRMS_MAP_KEY")
    if not key:
        return []
    d0 = (dt.date.fromisoformat(date) - dt.timedelta(days=1)).isoformat()
    pts = []
    for src in ("VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_SNPP_SP"):
        try:
            t = urllib.request.urlopen(f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{src}/"
                                       f"{W:.4f},{S:.4f},{E:.4f},{N:.4f}/3/{d0}", timeout=60).read().decode()
        except Exception:                                            # noqa: BLE001
            continue
        lines = t.strip().splitlines()
        if len(lines) < 2 or "latitude" not in lines[0]:
            continue
        hdr = lines[0].split(",")
        for ln in lines[1:]:
            v = dict(zip(hdr, ln.split(",")))
            pts.append([float(v["latitude"]), float(v["longitude"]), float(v.get("frp") or 0), v.get("acq_date")])
    return pts


def measure(in_path: str, out_path: str, crops: str | None, scans: int | None, only: set | None) -> None:
    _env()
    data = json.load(open(in_path))
    by_scan = collections.defaultdict(list)
    for d in data["detections"]:
        if d.get("image_timestamp_utc") and (not only or d["detection_id"] in only):
            by_scan[d["scan_id"]].append(d)
    if crops:
        os.makedirs(crops, exist_ok=True)
    done = {}
    if os.path.exists(out_path):
        for r in json.load(open(out_path)):
            done[r["detection_id"]] = r
    keys = [k for k in by_scan if not all(d["detection_id"] in done for d in by_scan[k])]
    if scans:
        keys = keys[:scans]
    for i, k in enumerate(keys):
        print(f"[{i + 1}/{len(keys)}] {k[:8]} {by_scan[k][0]['name'][:60]} — {len(by_scan[k])} plumes", flush=True)
        try:
            for r in measure_scan(by_scan[k], data["firms"].get(k) or [], crops):
                done[r["detection_id"]] = r
        except Exception as e:                                       # noqa: BLE001
            print(f"  failed: {type(e).__name__}: {e}", flush=True)
        with open(out_path, "w") as fh:
            json.dump(list(done.values()), fh)
    print(f"{len(done)} measured -> {out_path}")


def report(in_path: str, examples: int = 3) -> dict:
    import smoke_classify as sc
    rows = [r for r in json.load(open(in_path)) if r.get("features")]
    # Re-classify from the stored features so the report follows the current rules/model.
    for r in rows:
        v = sc.classify(r["features"])
        r["class"], r["confidence"], r["reasons"] = v["class"], v["confidence"], [x["text"] for x in v["reasons"]]
    n = len(rows)
    by = collections.Counter(r["class"] for r in rows)
    kept = sum(by[c] for c in sc.FINDING_CLASSES)
    print(f"DRY RUN — {n} published smoke plumes re-measured (nothing written anywhere).")
    print(f"  would stay published: {kept} ({by.get('smoke_plume', 0)} smoke plume, {by.get('burn_scar', 0)} burn scar)")
    print(f"  would be reclassified and withdrawn: {n - kept} ({round(100 * (n - kept) / max(n, 1))}%)")
    for c, k in by.most_common():
        print(f"    {c:20s} {k}")
    print()
    for c, _ in by.most_common():
        ex = [r for r in rows if r["class"] == c][:examples]
        print(f"— {c}:")
        for r in ex:
            print(f"   {r['detection_id']}  {r['image_timestamp_utc'][:10]}  {r['centroid_lat']:.4f},{r['centroid_lon']:.4f}  "
                  f"{r['name'][:48]}")
            for t in r["reasons"][:3]:
                print(f"        · {t}")
    return {"n": n, "by_class": dict(by), "kept": kept}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("pull"); p.add_argument("--out", required=True)
    m = sub.add_parser("measure"); m.add_argument("--in", dest="inp", required=True); m.add_argument("--out", required=True)
    m.add_argument("--crops"); m.add_argument("--scans", type=int); m.add_argument("--only", help="comma-separated detection ids")
    sc_ = sub.add_parser("scene"); sc_.add_argument("--lat", type=float, required=True); sc_.add_argument("--lon", type=float, required=True)
    sc_.add_argument("--date", required=True); sc_.add_argument("--km", type=float, default=20); sc_.add_argument("--out", required=True)
    sc_.add_argument("--crops"); sc_.add_argument("--tag", required=True)
    r = sub.add_parser("report"); r.add_argument("--in", dest="inp", required=True); r.add_argument("--examples", type=int, default=3)
    a = ap.parse_args(argv)
    if a.cmd == "pull":
        pull(a.out)
    elif a.cmd == "measure":
        measure(a.inp, a.out, a.crops, a.scans, set(a.only.split(",")) if a.only else None)
    elif a.cmd == "scene":
        scene(a.lat, a.lon, a.date, a.km, a.out, a.crops, a.tag)
    else:
        report(a.inp, a.examples)


if __name__ == "__main__":
    main()
