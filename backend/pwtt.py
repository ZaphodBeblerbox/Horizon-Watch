"""
pwtt.py — Pixel-Wise T-Test change detection on Sentinel-1 amplitude.

WHAT THIS IS FOR. It is the only route on free imagery to the two targets
nothing else here can reach: DAMAGED infrastructure and NEW infrastructure.
Neither is a visual property of an object — a building is a building — so no
object detector can find them. Both are properties of a DIFFERENCE, which is
what this measures.

It is also how a camp is found. At Sentinel's 10 m/px a tent is half a pixel
and a person is invisible, but a cluster of tents, vehicles and cleared
ground over fifty metres changes how that ground scatters radar, and that
change is detectable. The finding is never "that is a camp" — it is
"something is here that was not, and nothing here has moved in months".

THE METHOD, and why this one. Published as an open-access alternative to
InSAR coherence (Nature Comms Earth & Env, 2025; arXiv 2405.06323). Two
stacks of Sentinel-1 GRD amplitude — before and after — compared per pixel
with Welch's t-test. Against coherence methods it keeps the sensor's native
10 m instead of ~30 m, needs only amplitude rather than complex SLC data,
and runs as arithmetic rather than a model: no weights, no GPU, nothing to
download. Reported 76.3% recall / 68.4% F1 against UNOSAT ground truth in
Ukraine.

WELCH, NOT STUDENT. The two stacks rarely have equal variance: a quiet
period and a period of activity differ in spread as much as in mean, which
is the whole point. Assuming equal variance would understate the statistic
exactly where the ground actually changed.

WHAT IT CANNOT TELL YOU. It finds structural change, not its cause.
Demolition, construction, heavy earthworks, a new berm and a flooded field
all register. It is a CUE — a reason to look at the optical scene — never a
finding on its own. Radar also changes with soil moisture and vegetation, so
a whole-scene shift after rain is the expected false positive and is
suppressed by the scene-level normalisation below.
"""
from __future__ import annotations

import math

# A pixel must clear this |t| before it is called changed. 1.63 is the value
# the published work calibrated against UNOSAT labels in Ukraine; it is a
# starting point for a theatre, not a universal constant, and the honest
# thing is to say so rather than present it as physics.
DEFAULT_T_THRESHOLD = 1.63

# Below this many acquisitions a "stack" has no usable variance and the
# t-statistic is noise with decimal places. Sentinel-1 revisits every ~6
# days, so this is about five weeks of imagery a side.
MIN_STACK = 3

# Changed pixels smaller than this are speckle, and the number is measured
# rather than chosen.
#
# At |t| >= 1.63 roughly 10-16% of pixels clear the threshold BY CHANCE —
# that is simply what the t-distribution does at these stack depths, not a
# fault in the data. At that density, 8-connected clusters form readily. On
# pure-noise scene pairs the largest random blob ran to 23 pixels (n=4) and
# 9-13 pixels at realistic depths, and NO random blob ever reached 25 across
# any depth tested.
#
# 25 is therefore the floor, and it agrees with the physics: at 10 m/px, 25
# pixels is 2,500 m², a 50x50 m footprint — the smallest thing this
# resolution can honestly call a structure rather than a bright patch.
MIN_BLOB_PIXELS = 25


class NotEnoughData(ValueError):
    """Too few acquisitions to say anything. A real, reportable condition."""


def welch_t(before, after):
    """Per-pixel Welch t-statistic between two stacks.

    `before` and `after` are 3-D arrays (n_dates, h, w) of amplitude.
    Returns a 2-D array of t, positive where the after-stack is brighter.
    """
    import numpy as np

    b = np.asarray(before, dtype=np.float64)
    a = np.asarray(after, dtype=np.float64)
    if b.ndim != 3 or a.ndim != 3:
        raise ValueError("stacks must be (n_dates, h, w)")
    if b.shape[0] < MIN_STACK or a.shape[0] < MIN_STACK:
        raise NotEnoughData(
            f"need at least {MIN_STACK} acquisitions each side; "
            f"got {b.shape[0]} before and {a.shape[0]} after"
        )
    if b.shape[1:] != a.shape[1:]:
        raise ValueError(f"stack footprints differ: {b.shape[1:]} vs {a.shape[1:]}")
    if not (np.isfinite(b).all() and np.isfinite(a).all()):
        # Refusing beats returning an array of NaN that every downstream
        # comparison silently reads as "no change".
        raise ValueError("stacks contain non-finite values; nodata must be "
                         "resolved before comparison")

    nb, na = b.shape[0], a.shape[0]
    mb, ma = b.mean(axis=0), a.mean(axis=0)
    # ddof=1: these are samples of a process, not the whole population.
    vb, va = b.var(axis=0, ddof=1), a.var(axis=0, ddof=1)

    # A pixel that never varies gives zero denominator and would register as
    # an infinite change the instant it moves at all. Radar always has
    # speckle, so zero variance means "too few looks", not "perfectly
    # stable" — floored rather than trusted.
    denom = np.sqrt(np.maximum(vb / nb + va / na, 1e-9))
    return (ma - mb) / denom


def normalise_scene_shift(t):
    """Remove a whole-scene shift before thresholding.

    Rain, soil moisture and seasonal vegetation move the entire scene's
    backscatter together. Without removing that, the first wet week reports
    an entire city as damaged. Subtracting the median leaves only pixels
    that moved DIFFERENTLY from their surroundings, which is what a
    structural change looks like.
    """
    import numpy as np
    return np.asarray(t) - float(np.median(t))


def change_mask(t, threshold: float = DEFAULT_T_THRESHOLD, direction: str = "both"):
    """Boolean mask of pixels that changed.

    `direction`: "increase" catches new hard structure (a building, a
    vehicle park — metal and corners scatter strongly back to the sensor);
    "decrease" catches its removal (rubble scatters diffusely, so a
    destroyed building gets DARKER in radar, which is the counter-intuitive
    part and the reason damage detection works at all here).
    """
    import numpy as np
    t = np.asarray(t)
    if direction == "increase":
        return t >= threshold
    if direction == "decrease":
        return t <= -threshold
    return np.abs(t) >= threshold


def _erode(mask):
    """3x3 erosion: a pixel survives only if all eight neighbours are set."""
    import numpy as np
    m = np.asarray(mask, dtype=bool)
    out = m.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy == 0 and dx == 0:
                continue
            out &= np.roll(np.roll(m, dy, axis=0), dx, axis=1)
    # Rolling wraps, so the border is not validly eroded; clear it rather
    # than let the opposite edge vote on it.
    out[0, :] = out[-1, :] = out[:, 0] = out[:, -1] = False
    return out


def _dilate(mask):
    """3x3 dilation, the inverse half of an opening."""
    import numpy as np
    m = np.asarray(mask, dtype=bool)
    out = m.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy == 0 and dx == 0:
                continue
            out |= np.roll(np.roll(m, dy, axis=0), dx, axis=1)
    return out


def open_mask(mask):
    """Morphological opening — erode, then dilate.

    THE SIZE FILTER ALONE IS NOT ENOUGH. At |t| >= 1.63 roughly 13% of
    pixels clear the threshold by chance, and at that density 8-connected
    speckle PERCOLATES: measured, a pure-noise scene produced a single
    stringy cluster of 256 pixels, comfortably past any reasonable area
    floor. Area cannot separate them because the false cluster is large.
    SHAPE can: a real structure is a solid block, a percolating random
    cluster is one pixel wide almost everywhere. Erosion deletes anything
    thinner than three pixels; dilation restores what survived to its
    original extent.
    """
    return _dilate(_erode(mask))


def _label_blobs(mask):
    """Connected components, 8-connected. Iterative flood fill.

    Deliberately not scipy.ndimage: this backend already carries a heavy
    dependency list and a stack-based fill over a boolean array is twenty
    lines. Iterative, not recursive — a large contiguous change region on a
    2000px scene would blow the interpreter's stack.
    """
    import numpy as np

    mask = np.asarray(mask, dtype=bool)
    h, w = mask.shape
    labels = np.zeros((h, w), dtype=np.int32)
    current = 0
    for y0 in range(h):
        for x0 in range(w):
            if not mask[y0, x0] or labels[y0, x0]:
                continue
            current += 1
            stack = [(y0, x0)]
            labels[y0, x0] = current
            while stack:
                y, x = stack.pop()
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not labels[ny, nx]:
                            labels[ny, nx] = current
                            stack.append((ny, nx))
    return labels, current


def blobs_to_detections(t, mask, bounds: dict, *,
                        min_pixels: int = MIN_BLOB_PIXELS,
                        m_per_px: float = 10.0) -> list[dict]:
    """Turn changed pixels into geolocated change regions.

    Each region carries its own strength and direction, so a caller can tell
    a strong localised appearance from a weak diffuse one without re-reading
    the array.
    """
    import numpy as np

    t = np.asarray(t)
    labels, n = _label_blobs(mask)
    if not n:
        return []

    h, w = t.shape
    west, south = float(bounds["west"]), float(bounds["south"])
    east, north = float(bounds["east"]), float(bounds["north"])
    dlon = (east - west) / max(1, w)
    dlat = (north - south) / max(1, h)

    out = []
    for lid in range(1, n + 1):
        ys, xs = np.nonzero(labels == lid)
        if ys.size < min_pixels:
            continue
        cy, cx = float(ys.mean()), float(xs.mean())
        vals = t[ys, xs]
        peak = float(vals[np.argmax(np.abs(vals))])
        out.append({
            "object_type": "structural_change",
            "change_direction": "appeared" if peak > 0 else "removed",
            "pixels": int(ys.size),
            "area_m2": round(float(ys.size) * m_per_px * m_per_px, 1),
            # Image rows run north-to-south; latitude runs the other way.
            "centroid_lat": round(north - (cy + 0.5) * dlat, 6),
            "centroid_lon": round(west + (cx + 0.5) * dlon, 6),
            "bbox_px": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
            # Normalised [x, y, w, h] as a fraction of the scene, which is
            # what every overlay in this app draws with. Without it a change
            # region could be located on a map but never shown on the image
            # it was found in.
            "bbox": [round(float(xs.min()) / max(1, w), 6),
                     round(float(ys.min()) / max(1, h), 6),
                     round(float(xs.max() - xs.min() + 1) / max(1, w), 6),
                     round(float(ys.max() - ys.min() + 1) / max(1, h), 6)],
            "t_peak": round(peak, 2),
            "t_mean": round(float(vals.mean()), 2),
            # NOT a probability. It is how far past the threshold the region
            # sits, squashed to 0..1 for display, and calling it a
            # probability would be inventing a calibration nobody did.
            "strength": round(min(1.0, abs(peak) / 6.0), 3),
            "method": "PWTT (Sentinel-1 amplitude, Welch t)",
            "provenance": "sar_change",
            "corroborated": False,
        })
    out.sort(key=lambda d: -abs(d["t_peak"]))
    return out


def detect_change(before, after, bounds: dict, *,
                  threshold: float = DEFAULT_T_THRESHOLD,
                  direction: str = "both",
                  min_pixels: int = MIN_BLOB_PIXELS,
                  m_per_px: float = 10.0) -> dict:
    """End to end: two amplitude stacks in, geolocated change regions out."""
    t = welch_t(before, after)
    t = normalise_scene_shift(t)
    raw_mask = change_mask(t, threshold=threshold, direction=direction)
    mask = open_mask(raw_mask)
    dets = blobs_to_detections(t, mask, bounds,
                               min_pixels=min_pixels, m_per_px=m_per_px)

    import numpy as np
    # Report what SURVIVED, not what the raw threshold flagged. The raw
    # figure is ~13% on an unchanged scene purely from the t-distribution,
    # and presenting that as "13% of this area changed" would be alarming
    # and wrong.
    changed_px = int(mask.sum())
    raw_px = int(raw_mask.sum())
    total_px = int(mask.size)
    return {
        "detections": dets,
        "changed_pixels": changed_px,
        "changed_fraction": round(changed_px / max(1, total_px), 5),
        "raw_flagged_fraction": round(raw_px / max(1, total_px), 5),
        "threshold": threshold,
        "direction": direction,
        "stack_before": int(np.asarray(before).shape[0]),
        "stack_after": int(np.asarray(after).shape[0]),
        # A scene where a third of pixels "changed" has not been destroyed;
        # something systematic has happened — rain, a different orbit, a
        # processing change. Saying so beats reporting 4,000 findings.
        "suspect_wholesale_shift": bool(changed_px / max(1, total_px) > 0.25),
        "note": ("structural change only — appearance or removal of hard "
                 "scatterers. A cue to look at the optical scene, not a "
                 "finding on its own."),
    }


# ── fetching the two stacks ───────────────────────────────────────────────
#
# Orchestration is kept separate from the maths above so the detector stays
# testable without a network, and so the cost of a run is visible in one
# place: one Sentinel Hub request per acquisition per side.

def geotiff_to_amplitude(image_bytes):
    """First band of a Sentinel-1 raw VH/VV GeoTIFF, as a float array.

    VH is used rather than VV: cross-polarised return is dominated by volume
    and multiple-bounce scattering, which is what changes when a structure
    appears or collapses. VV is more sensitive to surface roughness and
    therefore to soil moisture — the false positive this is trying to avoid.
    """
    import io

    import numpy as np
    import rasterio

    with rasterio.open(io.BytesIO(image_bytes)) as src:
        return src.read(1).astype(np.float32)


def acquisition_dates(end, count, step_days=6, skip_days=0):
    """Dates to sample, newest first. Sentinel-1 revisits about every 6 days.

    Each date becomes one Process API request for a one-day window, which is
    how a STACK is obtained: the API mosaics whatever falls inside a window,
    so a single wide request returns one composite and no variance at all —
    and without variance a t-test is meaningless.
    """
    import datetime as _dt

    if isinstance(end, str):
        end = _dt.date.fromisoformat(end)
    return [(end - _dt.timedelta(days=skip_days + i * step_days)).isoformat()
            for i in range(count)]


async def fetch_stack(fetch_fn, bounds: dict, dates: list[str], *,
                      width=None, height=None, on_progress=None,
                      stop_at: int | None = None) -> tuple:
    """Fetch one amplitude array per date. Returns (stack, dates_used, failures).

    A date with no acquisition is skipped rather than substituted: filling a
    gap with a neighbouring date would make the same image appear twice in
    the stack and shrink the variance it is there to measure.
    """
    import numpy as np

    arrays, used, failures = [], [], []
    for i, d in enumerate(dates):
        try:
            got = await fetch_fn(bounds, date_from=d, date_to=d,
                                 width=width, height=height)
        except Exception as e:                              # noqa: BLE001
            failures.append({"date": d, "reason": f"{type(e).__name__}: {e}"})
            continue
        if got.get("error"):
            failures.append({"date": d, "reason": got["error"]})
            continue
        try:
            arr = geotiff_to_amplitude(got["image_bytes"])
        except Exception as e:                              # noqa: BLE001
            failures.append({"date": d, "reason": f"unreadable GeoTIFF: {e}"})
            continue
        # NODATA COMES BACK TWO WAYS and both mean "no acquisition on this
        # date", not "this ground returns nothing": an all-zero raster, and
        # an all-NaN one. The NaN case was the one that bit — every
        # statistic downstream silently became NaN and the detector reported
        # a clean scene.
        finite = np.isfinite(arr)
        finite_frac = float(finite.mean())
        if finite_frac < 0.5:
            failures.append({"date": d,
                             "reason": f"no acquisition ({finite_frac:.0%} valid pixels)"})
            continue
        if not np.any(arr[finite]):
            failures.append({"date": d, "reason": "empty scene (no acquisition)"})
            continue
        # A partially-valid frame is real — it is the edge of the swath.
        # Those pixels are filled with the frame's own median so they carry
        # no change signal rather than dragging the statistic around.
        if finite_frac < 1.0:
            arr = np.where(finite, arr, np.nanmedian(arr[finite]))
        arrays.append(arr)
        used.append(d)
        if on_progress:
            on_progress(i + 1, len(dates), len(arrays))
        # Extra candidates exist only to cover rejected partial swaths.
        # Once the stack is deep enough, stop: every further fetch is a
        # paid request buying nothing.
        if stop_at is not None and len(arrays) >= stop_at:
            break

    if not arrays:
        return None, [], failures
    shapes = {a.shape for a in arrays}
    if len(shapes) > 1:
        # Different footprints cannot be stacked; comparing them would
        # report the difference between two places as a change in one.
        target = min(shapes, key=lambda s: (s[0], s[1]))
        arrays = [a[: target[0], : target[1]] for a in arrays]
    return np.stack(arrays), used, failures
