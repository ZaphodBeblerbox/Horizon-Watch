"""
radar_images.py — the radar images a change comparison was made from.

WHY (owner, 2026-10-12): "For the radar sweep I can't actually see the tent
concentrations, or the image for that matter, that was detected." A radar
change pass (pwtt.py) fetched two stacks of Sentinel-1 frames, compared
them pixel by pixel and kept only the regions — the pictures it looked at
were thrown away. A finding could be boxed on the ground but never shown
on the image it was found in.

Each comparison now keeps three display images over the scene's own
bounds (the zone's bbox for a zone pass, the ~20 km tile for a sweep):

  before.png   the mean of the "before" stack, in decibels, grey
  after.png    the mean of the "after" stack, on the SAME grey scale as
               before (one stretch for both, so a swipe between them shows
               a real difference, not two independent contrast stretches)
  change.png   the log-ratio after/before (dB), less the scene-wide shift
               (its median), over a dimmed After: red = brighter now, blue =
               darker now

and meta.json with the bounds [west, south, east, north] — the
georeference: the frames are fetched on an EPSG:4326 grid over exactly
that box, so pixel (x, y) of a W×H image is lon = west + (x+0.5)/W·Δlon,
lat = north − (y+0.5)/H·Δlat, and a finding's box is put on the image with
finding_boxes.geo_to_frac(box, bounds).

STORAGE. Files under DATA_DIR/radar_images/<scan_id>/, linked to the scan
by its id. On the server they are kept (long-term media belongs there).
On the laptop only the newest KEEP_LOCAL sets are kept — the owner's rule
after the disk filled with Telegram videos (2026-10-06): no unbounded
media store on the laptop.

OLDER COMPARISONS have no images. Their scan row still says which dates
were compared and over which box, so the same frames can be fetched again
on request (regenerate) — one Sentinel Hub request per date, which is why
it is a button with its cost on it, never automatic.

Pure rendering + file I/O here; the fetch function is passed in by the
caller (main._fetch_sentinel1_raw_bands_geotiff), so this module imports
nothing from main and its tests need no network.
"""
from __future__ import annotations

import asyncio
import base64
import datetime as _dt
import io
import json
import math
import os
import re
import shutil
import time
from pathlib import Path

import finding_boxes as fb

KEEP_LOCAL = max(4, int(os.getenv("RADAR_IMAGES_KEEP_LOCAL", "40")))
# Change shown from this many dB (weaker is speckle at these stack depths)
# to full colour at CHANGE_FULL_DB.
CHANGE_FROM_DB = 2.0
CHANGE_FULL_DB = 6.0
NAMES = ("before", "after", "change")
_KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,80}$")

_root_override: Path | None = None          # tests point this at a tmp dir


def root() -> Path:
    if _root_override is not None:
        return _root_override
    import paths
    return paths.DATA_DIR / "radar_images"


def on_server(env=os.environ) -> bool:
    return bool(env.get("RAILWAY_ENVIRONMENT_ID") or env.get("RAILWAY_ENVIRONMENT_NAME")
                or env.get("RAILWAY_ENVIRONMENT") or env.get("RADAR_IMAGES_KEEP_ALL") == "1")


def _dir(key: str) -> Path | None:
    if not isinstance(key, str) or not _KEY_RE.match(key):
        return None
    return root() / key


# ── rendering ─────────────────────────────────────────────────────────────

def _to_db(x):
    import numpy as np
    return 10.0 * np.log10(np.maximum(np.asarray(x, dtype=np.float64), 1e-6))


def _smooth3(a):
    """3×3 mean (edges replicated) — enough to calm speckle in the ratio."""
    import numpy as np
    p = np.pad(a, 1, mode="edge")
    h, w = a.shape
    return sum(p[dy:dy + h, dx:dx + w] for dy in range(3) for dx in range(3)) / 9.0


def _significant(b, a, h: int, w: int):
    """1.0 where pwtt's test calls a pixel changed, 0.0 elsewhere; all 1.0
    when either side is a single frame or too shallow to test."""
    import numpy as np
    import pwtt
    ones = np.ones((h, w))
    if b.ndim != 3 or a.ndim != 3:
        return ones
    try:
        t = pwtt.normalise_scene_shift(pwtt.welch_t(b[:, :h, :w], a[:, :h, :w]))
        return pwtt.open_mask(pwtt.change_mask(t)).astype(np.float64)
    except (pwtt.NotEnoughData, ValueError):
        return ones


def render(before, after) -> dict:
    """Two amplitude stacks (n, h, w) — or two single frames (h, w) — →
    {before, after, change} as PNG bytes, plus the numbers used to draw
    them. Before and after share one grey stretch."""
    import numpy as np
    from PIL import Image

    b = np.asarray(before, dtype=np.float64)
    a = np.asarray(after, dtype=np.float64)
    mb = b.mean(axis=0) if b.ndim == 3 else b
    ma = a.mean(axis=0) if a.ndim == 3 else a
    h, w = min(mb.shape[0], ma.shape[0]), min(mb.shape[1], ma.shape[1])
    mb, ma = mb[:h, :w], ma[:h, :w]
    db_b, db_a = _to_db(mb), _to_db(ma)
    both = np.concatenate([db_b[np.isfinite(db_b)], db_a[np.isfinite(db_a)]])
    lo, hi = (np.percentile(both, [2, 99.5]) if both.size else (0.0, 1.0))
    if not hi > lo:
        hi = lo + 1.0

    def grey(d):
        g = np.clip((d - lo) / (hi - lo), 0, 1)
        return (np.nan_to_num(g) * 255).astype(np.uint8)

    g_b, g_a = grey(db_b), grey(db_a)
    lr = _smooth3(np.nan_to_num(db_a - db_b))
    # Less the scene-wide shift, as the detector does (pwtt.normalise_scene_
    # shift): summer leaves against autumn fields, a wet week, darken or
    # brighten the whole scene together; what is left moved DIFFERENTLY from
    # its surroundings. Without this a July-vs-October pair painted 71% of a
    # power station blue.
    shift = float(np.median(lr))
    lr = lr - shift
    # ONLY WHERE THE DETECTOR WOULD CALL IT CHANGE. A per-pixel ratio of two
    # means is speckle-noisy (measured on Vuhlehirska: a quarter of the
    # scene, open water included, past 2 dB). With stacks on both sides the
    # same test as pwtt is applied — Welch t less its median, |t| ≥ 1.63,
    # opened so one-pixel-wide speckle goes — and colour is drawn only there.
    sig = _significant(b, a, h, w)
    span = CHANGE_FULL_DB - CHANGE_FROM_DB
    up = np.clip((lr - CHANGE_FROM_DB) / span, 0, 1) * sig
    dn = np.clip((-lr - CHANGE_FROM_DB) / span, 0, 1) * sig
    base = g_a.astype(np.float64) * 0.42 + 18
    red, blue = (255, 59, 48), (64, 150, 255)
    rgb = np.empty((h, w, 3), dtype=np.float64)
    for i in range(3):
        c = base * (1 - up - dn) + red[i] * up + blue[i] * dn
        rgb[..., i] = c
    rgb = np.clip(rgb, 0, 255).astype(np.uint8)

    def png(arr, mode):
        buf = io.BytesIO()
        Image.fromarray(arr, mode).save(buf, format="PNG", optimize=True)
        return buf.getvalue()

    return {
        "before": png(g_b, "L"), "after": png(g_a, "L"), "change": png(rgb, "RGB"),
        "width": int(w), "height": int(h),
        "stretch_db": [round(float(lo), 2), round(float(hi), 2)],
        "change_db": [CHANGE_FROM_DB, CHANGE_FULL_DB],
        "scene_shift_db": round(shift, 2),
        "brighter_fraction": round(float(((lr >= CHANGE_FROM_DB) & (sig > 0)).mean()), 5),
        "darker_fraction": round(float(((lr <= -CHANGE_FROM_DB) & (sig > 0)).mean()), 5),
    }


# ── storage ───────────────────────────────────────────────────────────────

def save(key: str, rendered: dict, bounds, meta: dict | None = None) -> dict | None:
    """Write the three PNGs and meta.json for a scan; prune on the laptop."""
    d = _dir(key)
    bb = fb.as_bounds(bounds)
    if d is None or bb is None:
        return None
    tmp = d.with_name(d.name + ".tmp")
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True, exist_ok=True)
    for n in NAMES:
        (tmp / f"{n}.png").write_bytes(rendered[n])
    m = {**(meta or {}), "scan_id": key, "bounds": [round(v, 6) for v in bb],
         "width": rendered["width"], "height": rendered["height"],
         "stretch_db": rendered.get("stretch_db"), "change_db": rendered.get("change_db"),
         "scene_shift_db": rendered.get("scene_shift_db"),
         "brighter_fraction": rendered.get("brighter_fraction"),
         "darker_fraction": rendered.get("darker_fraction"),
         "saved_at": _dt.datetime.utcnow().isoformat(timespec="seconds")}
    (tmp / "meta.json").write_text(json.dumps(m))
    shutil.rmtree(d, ignore_errors=True)
    tmp.rename(d)
    if not on_server():
        prune(KEEP_LOCAL)
    return m


def save_from_stacks(key: str, before, after, bounds, meta: dict | None = None) -> dict | None:
    return save(key, render(before, after), bounds, meta)


def has(key: str | None) -> bool:
    d = _dir(key) if key else None
    return bool(d and (d / "meta.json").is_file() and all((d / f"{n}.png").is_file() for n in NAMES))


def meta(key: str) -> dict | None:
    if not has(key):
        return None
    try:
        return json.loads((_dir(key) / "meta.json").read_text())
    except (OSError, ValueError):
        return None


def load(key: str, which=NAMES) -> dict | None:
    """meta + the PNGs asked for as base64."""
    m = meta(key)
    if m is None:
        return None
    d = _dir(key)
    out = dict(m)
    for n in which:
        if n in NAMES:
            out[f"{n}_b64"] = base64.b64encode((d / f"{n}.png").read_bytes()).decode("ascii")
    return out


def delete(key: str | None) -> None:
    d = _dir(key) if key else None
    if d is not None:
        shutil.rmtree(d, ignore_errors=True)


def prune(keep: int) -> int:
    """Keep the newest `keep` sets (by when they were saved); return how many went."""
    r = root()
    if not r.is_dir():
        return 0
    sets = [p for p in r.iterdir() if p.is_dir() and not p.name.endswith(".tmp")]
    if len(sets) <= keep:
        return 0
    sets.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    gone = 0
    for p in sets[keep:]:
        shutil.rmtree(p, ignore_errors=True)
        gone += 1
    return gone


# ── a cut-out around one finding ─────────────────────────────────────────

def crop(key: str, box, which=NAMES, max_px: int = 480) -> dict | None:
    """Cut-outs of the stored images around a finding's box (same window on
    each, so Before/After/Change line up). {<name>_b64 (PNG), box: [x, y, w,
    h] in the cut-out, …} or None when nothing is stored / the box is off it."""
    from PIL import Image
    m = meta(key)
    if m is None:
        return None
    win = fb.crop_window(box, m["bounds"], int(m["width"]), int(m["height"]))
    if win is None:
        return None
    d = _dir(key)
    out = {"box": win["box"], "scan_id": key, "instrument": "SAR", "source": "radar_images",
           "date": (m.get("dates_after") or [None])[0], "date_before": (m.get("dates_before") or [None])[0],
           "dates_before": m.get("dates_before"), "dates_after": m.get("dates_after")}
    for n in which:
        if n not in NAMES:
            continue
        img = Image.open(d / f"{n}.png")
        c = img.crop((win["x0"], win["y0"], win["x1"], win["y1"]))
        side = max(c.width, c.height)
        scale = max(1.0, 240 / side)
        if side * scale > max_px:
            scale = max_px / side
        if scale != 1.0:
            # nearest-neighbour: a 10–20 m radar pixel should look like a pixel
            c = c.resize((max(1, round(c.width * scale)), max(1, round(c.height * scale))), Image.NEAREST)
        buf = io.BytesIO()
        c.save(buf, format="PNG", optimize=True)
        out[f"{n}_b64"] = base64.b64encode(buf.getvalue()).decode("ascii")
        out["width"], out["height"] = c.width, c.height
    out["image_b64"] = out.get("after_b64")
    return out


# ── what a scan row says about how to fetch its frames again ─────────────

def source_of(summary: dict | None, zone_bounds) -> dict | None:
    """From a change scan's result_summary: the box, the dates on each side
    and the pixel size it was rendered at — or None when the scan did not
    record its dates (it cannot be repeated faithfully)."""
    s = summary if isinstance(summary, dict) else {}
    bb = fb.as_bounds(s.get("bounds")) or fb.as_bounds(zone_bounds)
    before, after = list(s.get("dates_before") or []), list(s.get("dates_after") or [])
    if bb is None or not before or not after:
        return None
    w, so, e, n = bb
    width_m = (e - w) * 111_320 * math.cos(math.radians((so + n) / 2))
    m_px = float(s.get("m_per_px") or 0)
    px = round(width_m / m_px) if m_px > 0 else 512
    return {"bounds": list(bb), "dates_before": before, "dates_after": after,
            "px": max(64, min(1024, int(px))), "requests": len(before) + len(after)}


# ── on-demand regeneration ───────────────────────────────────────────────

_JOBS: dict[str, dict] = {}


def job(key: str) -> dict | None:
    return _JOBS.get(key)


async def regenerate(key: str, src: dict, fetch_fn, meta_extra: dict | None = None) -> dict:
    """Fetch the scan's own dates again, render, store. One request per date."""
    import pwtt
    w, s, e, n = src["bounds"]
    bounds = {"west": w, "south": s, "east": e, "north": n}
    total = len(src["dates_before"]) + len(src["dates_after"])
    st = _JOBS[key] = {"status": "running", "done": 0, "total": total, "started": time.time()}

    def bump(*_a):
        st["done"] += 1

    try:
        before, used_b, fail_b = await pwtt.fetch_stack(fetch_fn, bounds, src["dates_before"],
                                                        width=src["px"], height=src["px"], on_progress=bump)
        after, used_a, fail_a = await pwtt.fetch_stack(fetch_fn, bounds, src["dates_after"],
                                                       width=src["px"], height=src["px"], on_progress=bump)
        if before is None or after is None:
            fails = (fail_b if before is None else []) + (fail_a if after is None else [])
            why = "; ".join(sorted({str(f.get("reason"))[:80] for f in fails})) or "no frame came back"
            st.update(status="error", error=f"Sentinel Hub returned no usable frame for the "
                                            f"{'before' if before is None else 'after'} dates — {why}")
            return st
        m = await asyncio.to_thread(save_from_stacks, key, before, after, src["bounds"],
                                    {**(meta_extra or {}), "dates_before": used_b, "dates_after": used_a,
                                     "source": "regenerated", "px": src["px"]})
        if m is None:
            st.update(status="error", error="the images could not be stored")
        else:
            st.update(status="ready")
        return st
    except Exception as ex:                                  # noqa: BLE001
        print(f"[radar-images] error: regenerate {key}: {type(ex).__name__}: {ex}", flush=True)
        st.update(status="error", error=f"{type(ex).__name__}: {ex}")
        return st
    finally:
        st["finished"] = time.time()
        for k in [k for k, v in _JOBS.items() if v.get("finished") and time.time() - v["finished"] > 3600]:
            _JOBS.pop(k, None)
