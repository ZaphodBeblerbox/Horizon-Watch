"""
smoke.py — smoke plumes and the fires under them, from Sentinel-2.

Found on the first real case it was tried on: Khurais, Saudi Eastern
Province, 5 Oct 2026 07:33 UTC — a black plume streaming south-west from the
oil facility, three hours before VIIRS reported the fire (84 MW at 10:38).

THE SIGNATURE IS A CHANGE, NOT A COLOUR. Oil smoke over desert is dark;
smoke from a grass or wood fire over a dark field or the sea is bright. What
both share is that smoke is far more opaque to visible light than to
short-wave infrared, whose longer wavelength passes through it. So against
the area's own clear baseline (the median of earlier clear passes), per
pixel:

    r_vis  = visible (B02,B03,B04) now / baseline
    r_swir = short-wave IR (B11,B12) now / baseline     (both normalised by
                                                          their scene median)
    dark smoke    r_vis < 0.75  and  r_swir − r_vis > 0.08
    bright smoke  r_vis > 1.25  and  r_vis − r_swir > 0.15

Measured at Khurais: thick plume r_vis 0.12–0.17 against r_swir 0.25–0.30;
its thin edge 0.51–0.55 against 0.62–0.67; clear desert 0.93 against 0.95.
Cloud brightens both bands and cloud shadow darkens both, so neither passes
the difference test (Sentinel-2's own scene classification called the plume
"bare soil" — it cannot be used to separate smoke from cloud).

Active fire: B12 well above B11 and above its baseline — burning hydrocarbons
are hotter in the 2.2 µm band than the 1.6 µm one.

A plume is a connected region of smoke over 0.1 km² touching a fire, or
over 1 km² without one (smaller fire-less patches were noise). Its source is the fire
at its edge if there is one, else its densest point; its direction is the
bearing from the source to its far end — the way the wind is carrying it.
"""
from __future__ import annotations

import math

import numpy as np

MIN_AREA_KM2 = 0.1


def masks(now: np.ndarray, baseline: np.ndarray):
    """(smoke_dark, smoke_bright, fire, r_vis) boolean masks / ratio image.
    Arrays are (bands, H, W) in s2_bands order: B02 B03 B04 B08 B11 B12 SCL mask."""
    eps = 1e-3
    vis = lambda a: (a[0] + a[1] + a[2]) / 3
    sw = lambda a: (a[4] + a[5]) / 2
    valid = (now[7] > 0) & (baseline[7] > 0)
    rv = (vis(now) + eps) / (vis(baseline) + eps)
    rs = (sw(now) + eps) / (sw(baseline) + eps)
    rv = rv / np.median(rv[valid]) if valid.any() else rv
    rs = rs / np.median(rs[valid]) if valid.any() else rs
    dark = valid & (rv < 0.75) & (rs - rv > 0.08)
    # Bright smoke looks like cloud over bright ground (clouds are dimmer in
    # SWIR than desert): it must also be dimmer than cloud in blue, and not
    # what Sentinel-2's scene classification calls cloud, cirrus or shadow.
    cloudy = np.isin(now[6], (3, 8, 9, 10))
    bright = valid & (rv > 1.25) & (rv - rs > 0.15) & (now[0] < 0.3) & ~cloudy
    fire = valid & (now[5] - now[4] > 0.08) & (now[5] > 0.3) & (now[5] - baseline[5] > 0.1)
    return dark, bright, fire, rv


def _bearing(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]


def compass(deg: float) -> str:
    return COMPASS[int((deg + 22.5) // 45) % 8]


def plumes(now: np.ndarray, baseline: np.ndarray, bounds: dict) -> list[dict]:
    """Every smoke plume in the scene, with its source and drift."""
    import cv2
    from scipy import ndimage
    dark, bright, fire, rv = masks(now, baseline)
    h, w = rv.shape
    W, S, E, N = bounds["west"], bounds["south"], bounds["east"], bounds["north"]
    m_x = (E - W) * 111_320 * math.cos(math.radians((S + N) / 2)) / w
    m_y = (N - S) * 110_574 / h
    px_km2 = m_x * m_y / 1e6

    smoke = dark | bright
    # Close small gaps inside a plume, drop speckle.
    smoke = ndimage.binary_closing(smoke, structure=np.ones((3, 3)), iterations=2)
    smoke = ndimage.binary_opening(smoke, structure=np.ones((2, 2)))
    lab, n = ndimage.label(smoke)
    fire_lab, _ = ndimage.label(ndimage.binary_dilation(fire, iterations=1))

    def ll(y, x):
        return N - (y + 0.5) / h * (N - S), W + (x + 0.5) / w * (E - W)

    out = []
    for i in range(1, n + 1):
        comp = lab == i
        area = float(comp.sum()) * px_km2
        if area < MIN_AREA_KM2:
            continue
        ys, xs = np.nonzero(comp)
        # Source: fire touching the plume (within ~300 m), else densest point.
        near = ndimage.binary_dilation(comp, iterations=max(1, int(300 / max(m_x, 1))))
        fire_here = fire & near
        if fire_here.any():
            fy, fx = np.nonzero(fire_here)
            sy, sx = float(fy.mean()), float(fx.mean())
        else:
            k = int(np.argmin(rv[ys, xs]) if dark[ys, xs].any() else np.argmax(rv[ys, xs]))
            sy, sx = float(ys[k]), float(xs[k])
        # A plume with no fire under it must be large to count: the small
        # fire-less patches on clear days (≤0.5 km² at Khurais) are noise;
        # smoke at a fire is kept however small — flares smoke too.
        if not fire_here.any() and area < 1.0:
            continue
        d2 = ((ys - sy) * m_y) ** 2 + ((xs - sx) * m_x) ** 2
        far = int(np.argmax(d2))
        length_km = math.sqrt(float(d2[far])) / 1000
        slat, slon = ll(sy, sx)
        flat, flon = ll(ys[far], xs[far])
        drift = _bearing(slat, slon, flat, flon)

        # Outline: the component's contour, simplified to ~2 px.
        cnts, _ = cv2.findContours(comp.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        c = max(cnts, key=cv2.contourArea)
        c = cv2.approxPolyDP(c, 2.0, True)[:, 0, :]
        ring = [[round(ll(y, x)[1], 6), round(ll(y, x)[0], 6)] for x, y in c]
        if len(ring) < 3:
            continue
        ring.append(ring[0])
        out.append({
            "kind": "dark" if dark[ys, xs].mean() >= 0.5 else "bright",
            "area_km2": round(area, 2), "length_km": round(length_km, 1),
            "drift_deg": round(drift), "drift": compass(drift),
            "source_lat": round(slat, 6), "source_lon": round(slon, 6),
            "fire_px": int(fire_here.sum()),
            "density": round(float(1 - np.clip(rv[ys, xs], 0, 2).mean()) if dark[ys, xs].mean() >= 0.5
                             else float(np.clip(rv[ys, xs], 0, 3).mean() - 1), 2),
            "geometry": {"type": "Polygon", "coordinates": [ring]},
        })
    out.sort(key=lambda p: -p["area_km2"])

    # Fires not under any plume are reported too.
    fires = []
    flab, fn = ndimage.label(fire)
    for j in range(1, fn + 1):
        fy, fx = np.nonzero(flab == j)
        lat, lon = ll(float(fy.mean()), float(fx.mean()))
        fires.append({"lat": round(lat, 6), "lon": round(lon, 6), "px": int(len(fy)),
                      "area_m2": round(len(fy) * m_x * m_y)})
    return out, fires


def describe(p: dict) -> str:
    src = "from a fire" if p["fire_px"] else "from its densest point"
    return (f"{'Black' if p['kind'] == 'dark' else 'White'} smoke plume, {p['length_km']} km long, "
            f"drifting {p['drift']} {src} — {p['area_km2']} km²")
