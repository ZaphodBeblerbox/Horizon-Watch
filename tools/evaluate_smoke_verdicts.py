#!/usr/bin/env python3
"""
evaluate_smoke_verdicts.py — before/after for the smoke and fire rules, on
what is already stored. READ-ONLY: the database is opened with sqlite
`mode=ro`; no Copernicus request is made.

Two parts:

  1. The stored detections. Every smoke_plume / burn_scar / active_fire row
     is judged by imagery_verdict.judge exactly as the read paths judge it
     (FIRMS counted from fire_detections around the pass). Before = what the
     map showed (every row); after = what it shows now, with the reason for
     each withdrawal.

  2. The labelled set (backend/data/smoke_labelled_set.json — features
     measured on real Sentinel-2 bands, labelled by eye). The rules at a
     git revision (default HEAD, i.e. before this change when run on an
     uncommitted tree) against the working tree's.

    python tools/evaluate_smoke_verdicts.py [--db PATH] [--before-rev HEAD] [--json OUT]
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import importlib.util
import json
import os
import sqlite3
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BACKEND = os.path.join(ROOT, "backend")
sys.path.insert(0, BACKEND)


def stored(db_path: str) -> dict:
    import imagery_verdict as iv
    c = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    c.row_factory = sqlite3.Row
    rows = c.execute("""select d.detection_id, d.object_type, d.centroid_lat, d.centroid_lon, d.attributes,
                               d.created_at, s.image_timestamp_utc, s.cloud_cover_percent, z.name
                        from sentinel_detections d join sentinel_scans s on s.scan_id = d.scan_id
                        left join watch_zones z on z.id = d.zone_id
                        where d.object_type in ('smoke_plume', 'burn_scar', 'active_fire')
                        order by d.created_at""").fetchall()
    out = []
    for r in rows:
        when = r["image_timestamp_utc"] or r["created_at"]
        d0 = dt.datetime.fromisoformat(str(when)[:10])
        pts = c.execute("select lat, lon from fire_detections where lat between ? and ? and lon between ? and ? "
                        "and acquired_at >= ? and acquired_at < ?",
                        (r["centroid_lat"] - 0.05, r["centroid_lat"] + 0.05, r["centroid_lon"] - 0.08,
                         r["centroid_lon"] + 0.08, str(d0 - dt.timedelta(days=1)), str(d0 + dt.timedelta(days=2)))).fetchall()
        a = json.loads(r["attributes"] or "{}")
        lat = a.get("source_lat", r["centroid_lat"]) if r["object_type"] != "active_fire" else r["centroid_lat"]
        lon = a.get("source_lon", r["centroid_lon"]) if r["object_type"] != "active_fire" else r["centroid_lon"]
        v = iv.judge(r["object_type"], a, float(lat), float(lon), [tuple(p) for p in pts])
        out.append({"detection_id": r["detection_id"], "type": r["object_type"], "place": r["name"],
                    "pass": str(when)[:16], "cloud_pct": round(r["cloud_cover_percent"] or 0, 1),
                    "description": a.get("description"), "shown": v["shown"], "class": v["class"],
                    "decided_by": v["decided_by"]})
    return {"rows": out}


def _module_at(rev: str, name: str):
    src = subprocess.run(["git", "-C", ROOT, "show", f"{rev}:backend/{name}.py"], capture_output=True, text=True, check=True).stdout
    d = tempfile.mkdtemp()
    p = os.path.join(d, f"{name}_{rev.replace('/', '_')}.py")
    with open(p, "w") as fh:
        fh.write(src)
    spec = importlib.util.spec_from_file_location(f"{name}_before", p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    m.MODEL_PATH = "/nonexistent"
    return m, d


def labelled(rev: str) -> dict:
    import shutil
    import smoke_classify as after
    after.MODEL_PATH = "/nonexistent"
    before, tmp = _module_at(rev, "smoke_classify")
    data = json.load(open(os.path.join(BACKEND, "data", "smoke_labelled_set.json")))
    res = {}
    for name, mod in (("before", before), ("after", after)):
        cm = collections.Counter()
        for it in data["items"]:
            if it["label"] == "unsure":
                continue
            cls = mod.classify(it["features"])["class"]
            cm[(it["label"], cls)] += 1
        pub = {k: n for k, n in cm.items() if k[1] in ("smoke_plume", "burn_scar")}
        tp = sum(n for (lab, _), n in pub.items() if lab == "smoke_plume")
        fp = sum(n for (lab, _), n in pub.items() if lab != "smoke_plume")
        pos = sum(n for (lab, _), n in cm.items() if lab == "smoke_plume")
        res[name] = {"published": tp + fp, "true_smoke_published": tp, "false_published": fp,
                     "smoke_in_set": pos, "confusion": {f"{a}->{b}": n for (a, b), n in sorted(cm.items())}}
    shutil.rmtree(tmp, ignore_errors=True)
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=os.path.join(BACKEND, "data", "akili.db"))
    ap.add_argument("--before-rev", default="HEAD")
    ap.add_argument("--json")
    a = ap.parse_args()
    s = stored(a.db)
    rows = s["rows"]
    print(f"STORED DETECTIONS ({a.db}, read-only)")
    for t in ("smoke_plume", "burn_scar", "active_fire"):
        rs = [r for r in rows if r["type"] == t]
        if not rs:
            continue
        kept = [r for r in rs if r["shown"]]
        print(f"  {t}: before {len(rs)} shown, after {len(kept)} shown, {len(rs) - len(kept)} withdrawn")
        why = collections.Counter((r["class"], r["place"]) for r in rs if not r["shown"])
        for (cls, place), n in why.most_common():
            print(f"     withdrawn as {cls} at {place}: {n}")
    for r in rows:
        print(f"    {'KEEP' if r['shown'] else 'DROP'} {r['type']:<12} {r['place'] or '':<22} {r['pass']} "
              f"cloud {r['cloud_pct']:>5}%  {r['decided_by']}")
    lab = labelled(a.before_rev)
    print(f"\nLABELLED SET (rules at {a.before_rev} vs working tree)")
    for k, v in lab.items():
        print(f"  {k}: published {v['published']} (true smoke {v['true_smoke_published']} of {v['smoke_in_set']}, "
              f"false {v['false_published']})")
        print(f"     {v['confusion']}")
    if a.json:
        with open(a.json, "w") as fh:
            json.dump({"stored": rows, "labelled": lab}, fh, indent=1)


if __name__ == "__main__":
    main()
