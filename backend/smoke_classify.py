"""
smoke_classify.py — what a dark or bright change on a Sentinel-2 pass actually is.

smoke.py finds regions whose reflectance changed against the area's clear
baseline. In autumn over Russian and Belarusian farmland that is mostly
ploughing and harvest: 209 "smoke plumes" in one day of sweeps, nearly all of
them fields, plus runways at Charles de Gaulle. A change is not smoke. This
module decides, per candidate region, which of these it is:

    smoke_plume   transient, semi-transparent, scatters short wavelengths most
    burn_scar     newly dark, burnt (NBR drop, SWIR up / NIR down), compact,
                  usually with a fire or a FIRMS hit — "impact point"
    field_change  ploughing / harvest / wet soil: change led by the NIR and
                  SWIR, red rising more than blue, sharp straight edges
    runway        persistent, long, straight, uniform strip, or on an OSM
                  aeroway
    cloud         bright in every band, Sentinel-2 scene class cloud/cirrus
    cloud_shadow  dark in every band equally, or scene class shadow
    persistent    present in >= 2 earlier clear passes — the ground, not smoke

    runway        on an OSM runway/taxiway, or a persistent long straight strip
    aircraft      a transient change on an OSM apron (parked aircraft come and go)
    port_infrastructure  on OSM port / harbour / quay / pier ground
    storage_tank  on an OSM storage tank or tank farm
    vessel        a small bright compact change on open water (WorldCover 80)

Added 2026-10-17 (owner: "We're still recognising clouds as smoke. We're
still recognising random stuff as smoke."), each from its own physics:

    snow          bright in green, black at 1.6 µm (snow index > 0.4)
    haze          a brightening beside cloud with nothing burning
    sun_glint     water brightened out to the NIR and SWIR, no cloud near
    bright_surface  brightened at 1.6 µm as much as in blue: a roof, sand,
                  cleared ground — smoke is nearly transparent there
    no_source     looks like smoke, but no hot pixel and no FIRMS fire
                  within 1 km that day: a plume needs a source
    and cloud / cloud_shadow now also from a cloud-probability band
    (s2cloudless / Sen2Cor), SWIR opacity in reflectance units, and shadow
    pairing: a cloud's shadow lies away from the sun at height × tan(zenith),
    found by sliding the region along the sun's line (scene time → sun
    position). The plume's drift is checked against the wind of the hour
    (Open-Meteo, 850 hPa) when its source is a fire.

Every verdict carries `decision` (kept / rejected) and `decided_by`, the
reason that decided it; the scanner stores the rejects on the scan
(result_summary.smoke_rejected), and imagery_verdict.py re-judges stored
detections with these rules on every read.

Only smoke_plume and burn_scar are published (as findings, and as signals);
the rest explain why a change was not reported and are logged, never stored
as detections — publishing "vessel" or "port_infrastructure" here would mix
into the ship/tank detector's counts and its "gone since the last pass"
damage signals.

THE PHYSICS, per band, as the change ratio inside the region relative to the
same ratio in a ring around it (so haze and sun angle cancel):

  * Smoke attenuates / scatters light more the shorter the wavelength
    (Angstrom). Its change is monotonic in wavelength: |log r| for B01 >=
    B02 >= B04 >= B08 >= B11/B12, all in the same direction, and blue moves
    at least as much as red.
  * A field ploughed or harvested changes mostly in the NIR (the red edge
    of vegetation) and SWIR (soil moisture): NIR moves more than red, red
    rises against blue when chlorophyll goes — the opposite of smoke.
  * Cloud shadow darkens every band by about the same factor.
  * Cloud brightens every band, SWIR included.
  * A burn drops NIR and raises B12: the normalised burn ratio falls.

Shape: plumes have diffuse edges and are not rectangles; fields and runways
have sharp straight edges. Time: anything with the same contrast against its
surroundings on two or more earlier clear passes is the ground itself.

Each verdict carries a confidence and the reasons, in words. If a model fitted
from analyst feedback exists (tools/train_detection_classifier.py writes
backend/data/detection_classifier.json), it is used for the class; the rules
remain the fallback and still supply the reasons.
"""
from __future__ import annotations

import json
import math
import os
import time

import numpy as np

# s2_bands order: B02 B03 B04 B08 B11 B12 SCL mask [B01]
IB = {"B02": 0, "B03": 1, "B04": 2, "B08": 3, "B11": 4, "B12": 5, "SCL": 6, "MASK": 7, "B01": 8, "CLOUDP": 9}
CLOUD_SCL = (8, 9, 10)
SHADOW_SCL = (3,)
BAD_SCL = (0, 1, 3, 8, 9, 10, 11)

FINDING_CLASSES = ("smoke_plume", "burn_scar")
CLASSES = ("smoke_plume", "burn_scar", "runway", "aircraft", "port_infrastructure", "storage_tank", "vessel",
           "field_change", "cloud", "cloud_shadow", "persistent", "water",
           # 2026-10-17 (owner: "we're still recognising clouds as smoke …
           # random stuff as smoke"): the look-alikes named for what they are.
           "snow", "haze", "bright_surface", "sun_glint", "no_source")
DARK_SCL = (2,)          # Sentinel-2 "dark area pixels": dark ground, burn scars, topographic shadow

# The smoke evidence score a candidate must reach. Set by hand, not fitted;
# checked against data/smoke_labelled_set.json (105 decided cases, 4 of them
# smoke) by test_smoke_classify.py and tools/train_detection_classifier.py
# --rules-report.
SMOKE_THRESHOLD = 2.0

FEATURES = ("vis", "nir", "swir", "blue_red", "aer_blue", "mono", "nir_excess", "swir_vs_vis",
            "flatness", "dnbr", "ndvi_base", "cloud_frac", "shadow_frac", "bright_b02", "persist",
            "area_km2", "elong", "rect", "solidity", "edge_step", "tex_corr", "cropland", "builtup",
            "aeroway", "fire", "firms", "nir_frac", "swir_frac", "edge_align", "cloud_px", "cloud_near",
            "apron", "port", "tanks", "water", "dark_frac")

MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "detection_classifier.json")
_MODEL = {"mtime": None, "model": None}
MODEL_MIN_LABELS = 40     # a model fitted on fewer answers does not overrule the physics


def _clear(a):
    """Pixels of one pass that see the ground: valid, not cloud/shadow/snow."""
    return (a[IB["MASK"]] > 0) & ~np.isin(a[IB["SCL"]], BAD_SCL)


def baseline(hist) -> np.ndarray:
    """Per-pixel median of the earlier passes, using only their clear pixels."""
    h = np.asarray(hist, dtype=np.float32)
    clear = np.stack([_clear(p) for p in h])                  # (K,H,W)
    data = np.where(clear[:, None], h, np.nan)
    with np.errstate(all="ignore"):
        med = np.nanmedian(data, axis=0)
    # Where no pass was clear, fall back to the plain median.
    fallback = np.median(h, axis=0)
    med = np.where(np.isnan(med), fallback, med)
    med[IB["SCL"]] = fallback[IB["SCL"]]
    med[IB["MASK"]] = (clear.any(axis=0)).astype(np.float32)
    return med


def _rings(comp, px_m):
    from scipy import ndimage
    near = max(2, int(round(60 / px_m)))
    far = max(near + 3, int(round(400 / px_m)))
    d_near = ndimage.binary_dilation(comp, iterations=near)
    d_far = ndimage.binary_dilation(comp, iterations=far)
    ring = d_far & ~d_near
    inner = comp & ~ndimage.binary_erosion(comp, iterations=1)
    outer = ndimage.binary_dilation(comp, iterations=1) & ~comp
    core = ndimage.binary_erosion(comp, iterations=2)
    if core.sum() < 3:
        core = comp
    return ring, inner, outer, core


def _band(a, name):
    i = IB[name]
    if i >= a.shape[0]:
        i = IB["B02"]            # 8-band arrays have no B01: use blue
    return a[i]


def _shape(comp, px_m):
    import cv2
    m = comp.astype(np.uint8)
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(cnts, key=cv2.contourArea)
    area = float(comp.sum())
    (_, _), (rw, rh), _ = cv2.minAreaRect(c)
    rw, rh = max(rw, 1.0), max(rh, 1.0)
    hull = cv2.convexHull(c)
    hull_a = max(cv2.contourArea(hull), 1.0)
    return {
        "area_km2": area * px_m * px_m / 1e6,
        "elong": max(rw, rh) / min(rw, rh),
        "length_m": max(rw, rh) * px_m, "width_m": min(rw, rh) * px_m,
        "rect": min(1.0, area / (rw * rh)),
        "solidity": min(1.0, area / hull_a),
    }


def features(now, hist, comp, px_m: float = 20.0, ctx: dict | None = None, base=None) -> dict:
    """The spectral, temporal, shape and context measurements of one region."""
    ctx = ctx or {}
    now = np.asarray(now, dtype=np.float32)
    hist = np.asarray(hist, dtype=np.float32)
    base = baseline(hist) if base is None else base
    comp = np.asarray(comp, dtype=bool)
    ring, inner, outer, core = _rings(comp, px_m)
    ok_now = (now[IB["MASK"]] > 0)
    ring_c = ring & _clear(now) & (base[IB["MASK"]] > 0)
    if ring_c.sum() < 10:
        ring_c = ring & ok_now
    eps = 1e-3

    def rr(name, region=comp):
        r = (_band(now, name) + eps) / (_band(base, name) + eps)
        a = float(np.median(r[region & ok_now])) if (region & ok_now).any() else 1.0
        b = float(np.median(r[ring_c])) if ring_c.any() else 1.0
        return max(a, 1e-3) / max(b, 1e-3)

    r = {b: rr(b) for b in ("B01", "B02", "B03", "B04", "B08", "B11", "B12")}
    L = {b: math.log(v) for b, v in r.items()}
    vis = (L["B02"] + L["B03"] + L["B04"]) / 3
    swir = (L["B11"] + L["B12"]) / 2
    nir = L["B08"]
    sign = 1 if vis >= 0 else -1
    # Monotonic decay with wavelength, all in vis' direction.
    seq = [L["B01"], L["B02"], L["B04"], L["B08"], swir]
    mags = [sign * x for x in seq]
    tol = 0.03
    mono = sum(1 for a, b in zip(mags, mags[1:]) if a + tol >= b) / 4
    if any(m < -0.05 for m in mags[:3]):
        mono = 0.0
    blue_red = sign * (L["B02"] - L["B04"])          # > 0: blue moved more (smoke)
    aer_blue = sign * (L["B01"] - L["B02"])
    nir_excess = abs(nir) - abs(L["B04"])             # > 0: NIR moved more than red (ground)
    swir_vs_vis = abs(swir) / max(abs(vis), 0.02)     # smoke: well below 1
    flatness = float(np.std([L["B02"], L["B04"], nir, swir]) / max(abs(vis), 0.02))

    def nbr(a, region):
        n_, s_ = a[IB["B08"]][region], a[IB["B12"]][region]
        return float(np.median((n_ - s_) / (n_ + s_ + eps))) if region.any() else 0.0

    reg = comp & ok_now
    dnbr = (nbr(base, reg) - nbr(now, reg)) - (nbr(base, ring_c) - nbr(now, ring_c))
    def ndvi(a, region):
        n_, r_ = a[IB["B08"]][region], a[IB["B04"]][region]
        return float(np.median((n_ - r_) / (n_ + r_ + eps))) if region.any() else 0.0
    ndvi_base = ndvi(base, reg)

    scl = now[IB["SCL"]][comp]
    cloud_frac = float(np.isin(scl, CLOUD_SCL).mean()) if scl.size else 0.0
    shadow_frac = float(np.isin(scl, SHADOW_SCL).mean()) if scl.size else 0.0
    bright_b02 = float(np.median(now[IB["B02"]][reg])) if reg.any() else 0.0

    # TEMPORAL: same contrast against the surroundings on earlier clear passes?
    def contrast(a):
        clear = _clear(a)
        ins, out = comp & clear, ring & clear
        if ins.sum() < 0.6 * comp.sum() or out.sum() < 10:
            return None
        v = lambda m: float(np.median((a[0][m] + a[1][m] + a[2][m]) / 3))
        return math.log(max(v(ins), eps) / max(v(out), eps))
    c_now = contrast(now)
    if c_now is None:
        v = lambda m: float(np.median((now[0][m] + now[1][m] + now[2][m]) / 3)) if m.any() else eps
        c_now = math.log(max(v(comp & ok_now), eps) / max(v(ring & ok_now), eps))
    persist = 0
    for p in hist:
        c = contrast(p)
        if c is None or abs(c_now) < 0.05:
            continue
        if (c * c_now > 0) and abs(c - c_now) < 0.4 * abs(c_now):
            persist += 1

    sh = _shape(comp, px_m)
    # Edge: a step (field, runway) or a fade (smoke)? Inner/outer boundary
    # pixels against core and ring, on the visible change ratio.
    rv = ((now[0] + now[1] + now[2]) + eps) / ((base[0] + base[1] + base[2]) + eps)
    def med(m):
        m = m & ok_now
        return float(np.median(rv[m])) if m.any() else 1.0
    span = med(core) - med(ring_c)
    edge_step = (med(inner) - med(outer)) / span if abs(span) > 0.02 else 0.0
    edge_step = float(np.clip(edge_step, -1, 2))

    # Semi-transparency: does the ground's NIR detail show through?
    tex_corr = 0.0
    try:
        from scipy import ndimage
        hp = lambda x: x - ndimage.uniform_filter(x, 5)
        a, b = hp(now[IB["B08"]])[core & ok_now], hp(base[IB["B08"]])[core & ok_now]
        if a.size > 20 and a.std() > 1e-4 and b.std() > 1e-4:
            tex_corr = float(np.corrcoef(a, b)[0, 1])
    except Exception:
        pass

    # Does its outline follow edges that were already there (a parcel, a
    # runway, a shoreline)? Smoke's edge has nothing to do with the ground.
    edge_align = 0.0
    try:
        import cv2
        bv = ((base[0] + base[1] + base[2]) / 3).astype(np.float32)
        g = np.hypot(cv2.Sobel(bv, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(bv, cv2.CV_32F, 0, 1, ksize=3))
        bnd = (inner | outer) & ok_now
        ref = g[ring & ok_now]
        if bnd.sum() > 5 and ref.size > 20:
            edge_align = float((g[bnd] > np.percentile(ref, 75)).mean())
    except Exception:
        pass

    # Cloud pixels: scene class, or white and bright out to the SWIR
    # (desert is bright in SWIR but far from white; smoke is clear in SWIR).
    cloudish = np.isin(now[IB["SCL"]], CLOUD_SCL) | ((now[0] > 0.2) & (now[4] > 0.25) & (now[0] > 0.6 * now[4]))
    cp = now[IB["CLOUDP"]] if now.shape[0] > IB["CLOUDP"] else None
    if cp is not None:
        cloudish = cloudish | (cp >= 0.5)
    cloud_px = float(cloudish[comp].mean())
    near_c = None
    try:
        from scipy import ndimage
        near_c = ndimage.binary_dilation(comp, iterations=max(2, int(1500 / px_m)))
        cloud_near = float(cloudish[near_c & ~comp].mean())
    except Exception:
        cloud_near = 0.0

    # ── What tells a cloud and a bright surface from smoke (2026-10-17) ──
    # Owner: "we're still recognising clouds as smoke. We're still
    # recognising random stuff as smoke." The ratios above are relative:
    # over dark ground or water a tiny change in SWIR is a large ratio, and
    # a cloud over the sea read as "SWIR hardly moved". These are in
    # reflectance units, region minus ring:
    #   * cloud probability (s2cloudless / Sen2Cor) inside and around;
    #   * how much SWIR (B11, 1.6 µm) brightened against blue: smoke
    #     particles are far smaller than 1.6 µm and nearly transparent
    #     there, a cloud's droplets are not — cloud brightens B11 by
    #     0.1-0.4, smoke by under a tenth of what it adds in blue;
    #   * whiteness: a cloud is spectrally flat blue to NIR, smoke is bluish;
    #   * the normalised snow index (green vs SWIR) — snow is bright in
    #     green and black at 1.6 µm.
    def dabs(name):
        d = _band(now, name) - _band(base, name)
        a = float(np.median(d[reg])) if reg.any() else 0.0
        b = float(np.median(d[ring_c])) if ring_c.any() else 0.0
        return a - b
    d_b02, d_b08, d_b11 = dabs("B02"), dabs("B08"), dabs("B11")
    swir_opaque = d_b11 / d_b02 if d_b02 > 0.01 else 0.0
    cloud_prob = float(np.median(cp[reg])) if cp is not None and reg.any() else -1.0
    cloud_prob_near = (float((cp[near_c & ~comp & ok_now] >= 0.5).mean())
                       if cp is not None and near_c is not None and (near_c & ~comp & ok_now).any() else -1.0)
    if reg.any():
        b03n, b11n = now[IB["B03"]][reg], now[IB["B11"]][reg]
        ndsi = float(np.median((b03n - b11n) / np.maximum(b03n + b11n, 1e-4)))
        b03_now = float(np.median(b03n))
        vnir = np.array([float(np.median(now[IB[k]][reg])) for k in ("B02", "B03", "B04", "B08")])
        whiteness = float(vnir.std() / max(vnir.mean(), 1e-3))
    else:
        ndsi, b03_now, whiteness = 0.0, 0.0, 1.0

    wc = ctx.get("worldcover")
    cropland = builtup = 0.0
    if wc is not None and wc.shape == comp.shape:
        v = wc[comp]
        cropland = float((v == 40).mean())
        builtup = float((v == 50).mean())
    def cover(key):
        m = ctx.get(key)
        return float(m[comp].mean()) if m is not None and getattr(m, "shape", None) == comp.shape else 0.0
    aeroway, apron, port, tanks = cover("aeroway"), cover("apron"), cover("port"), cover("tanks")
    water = float((wc[comp] == 80).mean()) if wc is not None and wc.shape == comp.shape else 0.0
    # Water also from the scene itself, so it holds without WorldCover: the
    # scene class (6 = water) and NDWI on the earlier passes, where the sea
    # is green-bright and near-infrared-dark (owner, 2026-10-13: water was
    # published as a smoke plume).
    try:
        b3, b8 = base[IB["B03"]][comp], base[IB["B08"]][comp]
        ndwi_water = float(((b3 - b8) / np.maximum(b3 + b8, 1e-4) > 0.2).mean())
    except Exception:                                       # noqa: BLE001
        ndwi_water = 0.0
    water = max(water, float((scl == 6).mean()) if scl.size else 0.0, ndwi_water)
    dark_frac = float(np.isin(scl, DARK_SCL).mean()) if scl.size else 0.0
    fire_m = ctx.get("fire")
    fire = 0
    if fire_m is not None:
        from scipy import ndimage
        fire = int((fire_m & ndimage.binary_dilation(comp, iterations=max(1, int(300 / px_m)))).sum())

    av = max(abs(vis), 0.02)
    f = {"nir_frac": nir / av * sign, "swir_frac": swir / av * sign, "edge_align": edge_align,
         "cloud_px": cloud_px, "cloud_near": cloud_near,
         "vis": vis, "nir": nir, "swir": swir, "blue_red": blue_red, "aer_blue": aer_blue, "mono": mono,
         "nir_excess": nir_excess, "swir_vs_vis": swir_vs_vis, "flatness": flatness, "dnbr": dnbr,
         "ndvi_base": ndvi_base, "cloud_frac": cloud_frac, "shadow_frac": shadow_frac,
         "bright_b02": bright_b02, "persist": persist, "area_km2": sh["area_km2"], "elong": sh["elong"],
         "rect": sh["rect"], "solidity": sh["solidity"], "edge_step": edge_step, "tex_corr": tex_corr,
         "cropland": cropland, "builtup": builtup, "aeroway": aeroway, "fire": fire,
         "apron": apron, "port": port, "tanks": tanks, "water": water, "dark_frac": dark_frac,
         "firms": int(ctx.get("firms") or 0), "length_m": sh["length_m"], "width_m": sh["width_m"],
         "d_b02": d_b02, "d_b08": d_b08, "d_b11": d_b11, "swir_opaque": swir_opaque,
         "cloud_prob": cloud_prob, "cloud_prob_near": cloud_prob_near, "ndsi": ndsi, "b03_now": b03_now,
         "whiteness": whiteness,
         # Filled by assess() from the whole scene (they look kilometres
         # away) and the plume's drift; -1 = not measured.
         "shadow_pair": float(ctx.get("shadow_pair", -1.0)), "pair_km": float(ctx.get("pair_km", -1.0)),
         "wind_diff": float(ctx.get("wind_diff", -1.0)),
         "ratios": {k: round(v, 3) for k, v in r.items()}}
    return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in f.items()}


def smoke_evidence(f: dict) -> tuple[float, list]:
    """Points for and against smoke, with the reason for each."""
    s, why = 0.0, []

    def add(pts, kind, text):
        nonlocal s
        s += pts
        why.append({"kind": kind, "sign": "+" if pts > 0 else "-", "text": text, "points": round(pts, 2)})

    r = f.get("ratios") or {}
    bright = f["vis"] > 0
    heat = f["fire"] > 0 or f["firms"] > 0
    if abs(f["vis"]) < 0.08:
        add(-1.5, "spectral", "barely changed in visible light")
    if bright:
        # Bright smoke scatters blue/aerosol, hardly touches NIR, not SWIR.
        if f["nir_frac"] < -0.05:
            add(-1.5, "spectral", f"near-infrared fell while visible rose (×{r.get('B08', 0):.2f} NIR) — vegetation turning or cut, not a layer over it")
        elif f["nir_frac"] < 0.6:
            add(1.2, "spectral", f"visible brightened (×{r.get('B02', 0):.2f} blue) while near-infrared hardly moved (×{r.get('B08', 0):.2f}) — a thin scattering layer")
        elif f["nir_frac"] > 0.8:
            add(-1.5, "spectral", f"near-infrared brightened as much as visible (×{r.get('B08', 0):.2f}) — cloud or bare ground, not smoke")
        if f["swir_frac"] < 0.35:
            add(0.8, "spectral", "short-wave infrared unchanged — sees straight through it")
        elif f["swir_frac"] > 0.6:
            add(-1.0, "spectral", "short-wave infrared brightened too — the surface changed, or cloud")
        if f["blue_red"] > 0.08 or f["aer_blue"] > 0.08:
            add(0.8, "spectral", "aerosol/blue band rose more than red — short wavelengths scattered most")
        elif f["blue_red"] < -0.05 and f["aer_blue"] < 0:
            add(-1.0, "spectral", "red rose more than blue — soil/stubble colour, not scattering")
    else:
        # Dark change: thick (black) smoke, or ploughing, burning, shadow.
        if f["nir_excess"] > 0.05:
            add(-1.2, "spectral", f"near-infrared dropped more than red ({r.get('B08', 0):.2f} vs {r.get('B04', 0):.2f}) — vegetation/soil change")
        if f["mono"] < 0.5:
            add(-0.8, "spectral", "change does not fade with wavelength")
        if (f["cropland"] < 0.3 and f["cloud_near"] < 0.01 and f["edge_align"] < 0.35
                and f["nir_excess"] <= 0.05 and f["mono"] >= 0.5):
            add(1.8, "spectral", "darkened evenly across the ground's own boundaries, off farmland, with no cloud to cast a shadow — black smoke")
        if not heat and f["cropland"] > 0.4:
            add(-1.5, "context", f"{round(f['cropland'] * 100)}% cropland (ESA WorldCover) with no heat — ploughed or harvested fields darken like this")
    if f["edge_align"] > 0.45:
        add(-1.2, "shape", f"{round(f['edge_align'] * 100)}% of its outline follows edges already on the earlier passes — a parcel/runway/shore, not a plume")
    elif f["edge_align"] < 0.3:
        add(0.5, "shape", "its outline ignores the ground's own edges")
    if f["rect"] > 0.7 and f["elong"] < 6:
        add(-0.8, "shape", f"rectangular ({round(f['rect'] * 100)}% of its bounding box) — a field parcel")
    if f["persist"] >= 2:
        add(-3.0, "temporal", f"same contrast on {f['persist']} earlier clear passes — it is the ground; smoke is transient")
    elif f["persist"] == 0:
        add(0.3, "temporal", "not there on any earlier clear pass")
    if bright and f["cloud_near"] > 0.05:
        add(-1.5, "spectral", f"cloud right next to it ({round(f['cloud_near'] * 100)}% of the surroundings) — cloud edge or haze")
    if f["cloud_px"] > 0.05:
        add(-2.0 * min(1.0, f["cloud_px"] * 5), "spectral", f"{round(f['cloud_px'] * 100)}% cloud pixels inside (white, bright to SWIR / scene class)")
    if f["fire"] >= 3:
        add(1.2, "fire", f"hot spot at its edge ({f['fire']} px, SWIR B12 > B11)")
    if f["firms"] > 0:
        add(1.0, "fire", f"{f['firms']} FIRMS fire detection(s) nearby that day")
    if f["aeroway"] > 0.2:
        add(-2.0, "context", "on an airfield runway/apron (OpenStreetMap)")

    # 2026-10-17 physics (see features()). Every key may be missing on
    # features stored before that day: missing = not measured = no points.
    g = lambda k, d=-1.0: d if f.get(k) is None else f.get(k)
    if g("cloud_prob") >= 0.5:
        add(-1.0 if heat else -2.5, "spectral",
            f"cloud-probability model: {round(g('cloud_prob') * 100)}% inside" + (" (thick smoke over a fire can read as cloud)" if heat else ""))
    if bright and g("d_b02", 0.0) > 0.01 and g("swir_opaque", 0.0) >= 0.6 and g("d_b11", 0.0) > 0.03:
        add(-2.0, "spectral", f"short-wave infrared brightened by {g('d_b11'):+.2f} against {g('d_b02'):+.2f} in blue — "
                              "opaque at 1.6 µm like a cloud or a new surface; smoke is nearly transparent there")
    if bright and 0 <= g("whiteness", 1.0) < 0.12 and g("b03_now", 0.0) > 0.2:
        add(-1.0, "spectral", "white — flat from blue to near-infrared, as cloud is; smoke is bluish")
    if g("shadow_pair") >= 0.3:
        add(-2.5 if not heat else -1.0, "shadow",
            (f"a matching shadow {g('pair_km'):.1f} km away on the side away from the sun — a cloud casting it"
             if bright else f"a cloud {g('pair_km'):.1f} km toward the sun, the right size and distance to cast it"))
    if g("ndsi", 0.0) > 0.4 and g("b03_now", 0.0) > 0.25:
        add(-3.0, "spectral", f"snow index {g('ndsi'):.2f} — bright in green, black at 1.6 µm: snow or ice")
    # Elongation only counts against: a drawn-out shape gave no points
    # because a haze band over a town with roof "hot pixels" (labelled set,
    # DET-1dfd899883de) is drawn out too, and a point tipped it into smoke.
    if f.get("elong", 9) < 1.4 and f.get("area_km2", 0) > 1:
        add(-0.5, "shape", "a round blob, not drawn out from a source")
    if g("wind_diff") >= 0:
        if g("wind_diff") <= 45:
            add(0.8, "wind", f"drifts with the wind of the hour (within {round(g('wind_diff'))}°)")
        elif g("wind_diff") >= 120:
            add(-1.2, "wind", f"drifts {round(g('wind_diff'))}° against the wind of the hour")
    return s, why


def _rule_class(f: dict) -> tuple[str, float, list]:
    s, why = smoke_evidence(f)
    bright = f["vis"] > 0
    heat = bool(f.get("fire", 0) >= 3 or f.get("firms", 0))
    g = lambda k: f.get(k, 0.0) or 0.0

    def first(kind, sign, text):
        why.insert(0, {"kind": kind, "sign": sign, "text": text})

    n = lambda k, d=-1.0: d if f.get(k) is None else f.get(k)
    opaque = bright and n("d_b02", 0.0) > 0.01 and n("swir_opaque", 0.0) >= 0.6 and n("d_b11", 0.0) > 0.03
    # A ship is small, compact, white and opaque too: the place decides it below.
    ship_like = g("water") > 0.6 and f["area_km2"] < 0.5 and f["solidity"] > 0.7
    if ship_like:
        opaque = False

    # Snow before cloud: both are white, only snow is black at 1.6 µm.
    if n("ndsi", 0.0) > 0.4 and n("b03_now", 0.0) > 0.25 and not heat:
        first("spectral", "-", f"snow index {n('ndsi'):.2f} with green at {n('b03_now'):.2f} — snow or ice")
        return "snow", 0.85, why
    # Cloud / shadow first: they explain everything else away.
    if (f["cloud_frac"] > 0.3 or f["cloud_px"] > 0.2 or (bright and f["nir_frac"] > 0.8 and f["cloud_near"] > 0.02)
            or (f["cloud_px"] > 0.03 and f["cloud_near"] > 0.05)):
        first("spectral", "-", "bright in visible and near-infrared alike, cloud pixels in/around it — cloud")
        return "cloud", 0.85, why
    if not heat and n("cloud_prob") >= 0.5:
        first("spectral", "-", f"the cloud-probability model puts {round(n('cloud_prob') * 100)}% on it — cloud")
        return "cloud", 0.85, why
    if not heat and bright and n("shadow_pair") >= 0.3:
        first("shadow", "-", f"it has a shadow {n('pair_km'):.1f} km away, opposite the sun — a cloud")
        return "cloud", 0.85, why
    # Sun glint: the sea turned mirror, bright out to the infrared — white
    # and opaque like a cloud, but with no cloud in or around it.
    if (not heat and bright and not ship_like and g("water") > 0.5 and n("d_b08", 0.0) > 0.02
            and n("d_b11", 0.0) > 0.01 and f["cloud_near"] <= 0.02 and n("cloud_prob") < 0.3):
        first("spectral", "-", "water brightened in near- and short-wave infrared too, no cloud near — sun glint on the sea")
        return "sun_glint", 0.8, why
    if not heat and opaque and (n("whiteness", 1.0) < 0.2 or f["cloud_near"] > 0.02 or n("cloud_prob") >= 0.3):
        first("spectral", "-", "white and opaque in short-wave infrared — cloud")
        return "cloud", 0.8, why
    flat = abs(f["nir"] - f["vis"]) < 0.25 * abs(f["vis"]) and abs(f["swir"] - f["vis"]) < 0.45 * abs(f["vis"])
    if f["shadow_frac"] > 0.3 or (not bright and flat and f["vis"] < -0.15 and f["cloud_near"] > 0.02):
        first("spectral", "-", "darker by the same factor in every band with cloud next to it — a cloud shadow"
              + (f" (scene class shadow on {round(f['shadow_frac'] * 100)}%)" if f["shadow_frac"] > 0.3 else ""))
        return "cloud_shadow", 0.8, why
    if not heat and not bright and n("shadow_pair") >= 0.3:
        first("shadow", "-", f"a cloud {n('pair_km'):.1f} km toward the sun casts it — a cloud shadow")
        return "cloud_shadow", 0.8, why
    # The brightening at a cloud's edge: next to cloud, no fire.
    if not heat and bright and (f["cloud_near"] > 0.02 or n("cloud_prob_near") > 0.1):
        first("spectral", "-", "brightening beside cloud with nothing burning — the haze at a cloud's edge")
        return "haze", 0.7, why
    # A new bright surface: roof, sand, cleared ground — opaque to SWIR.
    if not heat and opaque:
        first("spectral", "-", f"brightened in short-wave infrared ({n('d_b11'):+.2f}) as much as in blue — "
                               "a new bright surface (roof, sand, cleared ground), not a layer of smoke")
        return "bright_surface", 0.7, why
    # Smoke with a fire under it beats the place it is in: a strike on a
    # port or an airfield smokes too.
    if heat and s >= SMOKE_THRESHOLD and f["persist"] < 2:
        return "smoke_plume", round(min(0.97, 0.65 + (s - SMOKE_THRESHOLD) * 0.08), 2), why
    # Where it is (OpenStreetMap): the ground's own furniture changes too.
    if g("tanks") > 0.2:
        first("context", "+", f"{round(g('tanks') * 100)}% on storage tanks (OpenStreetMap) — tank roofs and fill levels change between passes")
        return "storage_tank", 0.7, why
    if g("port") > 0.3:
        first("context", "+", f"{round(g('port') * 100)}% on port / quay ground (OpenStreetMap) — berthed ships and cargo come and go")
        return "port_infrastructure", 0.7, why
    linear = f["elong"] >= 8 and f["rect"] > 0.6 and 600 <= f["length_m"] <= 5000 and f["width_m"] <= 120
    if g("aeroway") > 0.2 or (f["persist"] >= 2 and linear):
        first("shape", "+", f"long straight strip {round(f['length_m'])} m × {round(f['width_m'])} m"
              + (" on an OSM runway/taxiway" if g("aeroway") > 0.2 else ", present on earlier passes"))
        return "runway", 0.8 if g("aeroway") > 0.2 else 0.55, why
    if g("apron") > 0.3 and f["persist"] < 2:
        first("context", "+", f"{round(g('apron') * 100)}% on an airfield apron (OpenStreetMap) — parked aircraft come and go")
        return "aircraft", 0.6, why
    if g("water") > 0.6 and bright and f["area_km2"] < 0.5 and f["solidity"] > 0.7:
        first("context", "+", "small, compact and bright on open water (ESA WorldCover) — a ship")
        return "vessel", 0.6, why
    # On water and nothing burning: glint, waves, sediment or algae change the
    # sea between passes; smoke over water comes from a fire, which has heat.
    if g("water") > 0.5:
        first("context", "-", f"{round(g('water') * 100)}% on water (scene class / NDWI / WorldCover) with no heat — the sea changing, not smoke")
        return "water", 0.85, why
    if f["persist"] >= 2:
        return "persistent", 0.75, why
    # Burn scar / impact point: newly dark, burnt (NBR drop), compact, hot.
    if (not bright and f["dnbr"] > 0.1 and f["nir"] < -0.08 and f["area_km2"] < 3
            and (f["fire"] or f["firms"]) and f["edge_align"] < 0.45):
        first("spectral", "+", f"burn ratio dropped by {f['dnbr']:.2f} with heat on it — burnt ground")
        return "burn_scar", 0.8, why
    if s >= SMOKE_THRESHOLD and heat:
        return "smoke_plume", round(min(0.97, 0.6 + (s - SMOKE_THRESHOLD) * 0.08), 2), why
    if s >= SMOKE_THRESHOLD:
        # A plume needs a source (owner, 2026-10-17: "random stuff as
        # smoke"). Jebel Ali, 9 Oct: three "white smoke plumes … from its
        # densest point", no hot pixel and no FIRMS fire within days — every
        # smoke plume in the labelled set had one or the other. A smoulder
        # too small for both is missed; that is the price of not putting
        # clouds on the map as smoke.
        first("fire", "-", "looks like smoke, but nothing is burning under it — no hot pixel (B12 > B11) at its edge "
                           "and no FIRMS fire within 1 km that day; a plume needs a source")
        return "no_source", 0.6, why
    return "field_change", round(min(0.95, 0.5 + (SMOKE_THRESHOLD - s) * 0.08), 2), why


def _load_model():
    try:
        mt = os.path.getmtime(MODEL_PATH)
    except OSError:
        return None
    if _MODEL["mtime"] != mt:
        try:
            with open(MODEL_PATH) as fh:
                _MODEL["model"] = json.load(fh)
            _MODEL["mtime"] = mt
        except (OSError, ValueError) as e:
            print(f"[smoke_classify] error: model {MODEL_PATH} unreadable: {e}", flush=True)
            _MODEL["model"] = None
    return _MODEL["model"]


def vector(f: dict, names=FEATURES) -> np.ndarray:
    return np.array([float(f.get(k, 0.0) or 0.0) for k in names], dtype=np.float64)


def _model_predict(model: dict, f: dict):
    x = (vector(f, model["features"]) - np.array(model["mean"])) / np.array(model["scale"])
    z = np.array(model["coef"]) @ x + np.array(model["intercept"])
    if len(model["classes"]) == 2 and z.ndim == 1 and z.size == 1:
        p1 = 1 / (1 + math.exp(-z[0]))
        probs = np.array([1 - p1, p1])
    else:
        e = np.exp(z - z.max())
        probs = e / e.sum()
    k = int(np.argmax(probs))
    return model["classes"][k], float(probs[k])


def classify(f: dict) -> dict:
    """{class, confidence, reasons, classifier, smoke_score} for one region's features."""
    cls, conf, why = _rule_class(f)
    s, _ = smoke_evidence(f)
    out = {"class": cls, "confidence": conf, "reasons": why, "classifier": "rules v2", "smoke_score": round(s, 2)}
    model = _load_model()
    # The model only re-decides between ground-truth classes it was trained
    # on; cloud and shadow stay with the physics.
    if model and (model.get("n") or 0) >= MODEL_MIN_LABELS and cls not in ("cloud", "cloud_shadow"):
        try:
            mcls, mconf = _model_predict(model, f)
            if mcls != cls:
                why.insert(0, {"kind": "model", "sign": "+", "text": f"analyst-trained model says {mcls.replace('_', ' ')} ({round(mconf * 100)}%); rules said {cls.replace('_', ' ')}"})
            out.update({"class": mcls, "confidence": round(mconf, 2), "classifier": f"model {model.get('trained_at', '')[:10]}"})
        except Exception as e:                                     # noqa: BLE001
            print(f"[smoke_classify] error: model predict failed, rules used: {e}", flush=True)
    # The decision in one line, stored with the detection and the rejects
    # alike (owner, 2026-10-17): kept or rejected, and the reason that decided.
    out["decision"] = "kept" if is_finding(out["class"]) else "rejected"
    lead = next((r for r in why if r.get("sign") == ("+" if out["decision"] == "kept" else "-")), None)
    out["decided_by"] = lead["text"] if lead else out["class"].replace("_", " ")
    return out


def is_finding(cls: str) -> bool:
    return cls in FINDING_CLASSES


# ── Scene level: from smoke.py's candidate plumes to classes ──────────────

UA = "HorizonWatch/2.0 (+https://github.com/ZaphodBeblerbox/Horizon-Watch)"
OVERPASS_URLS = ("https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
                 "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter")
OSM_TTL_S = 7 * 86400     # airfields and ports do not move between passes
_OSM_CACHE: dict = {}
_OSM_DOWN = {"until": 0.0}
OSM_BACKOFF_S = 900
WINDOW_M = 2000           # context kept around a region: the ring (400 m) and cloud_near (1.5 km)


def _to_px(bounds: dict, shape) -> callable:
    h, w = shape
    W, S, E, N = bounds["west"], bounds["south"], bounds["east"], bounds["north"]
    return lambda lon, lat: ((lon - W) / (E - W) * w - 0.5, (N - lat) / (N - S) * h - 0.5)


def pixel_m(bounds: dict, shape) -> float:
    h, w = shape
    lat = (bounds["south"] + bounds["north"]) / 2
    m_x = (bounds["east"] - bounds["west"]) * 111_320 * math.cos(math.radians(lat)) / w
    m_y = (bounds["north"] - bounds["south"]) * 110_574 / h
    return float(math.sqrt(m_x * m_y))


def polygon_mask(geometry: dict, bounds: dict, shape) -> np.ndarray:
    """A GeoJSON polygon (lon/lat) rasterised on the scene grid."""
    import cv2
    px = _to_px(bounds, shape)
    m = np.zeros(shape, dtype=np.uint8)
    rings = geometry.get("coordinates") or []
    if geometry.get("type") == "MultiPolygon":
        rings = [r for poly in rings for r in poly[:1]]
    else:
        rings = rings[:1]
    for ring in rings:
        pts = np.array([px(lon, lat) for lon, lat in ring], dtype=np.float64)
        cv2.fillPoly(m, [np.round(pts).astype(np.int32)], 1)
    return m.astype(bool)


def overpass_query(bounds: dict) -> str:
    b = f'{bounds["south"]},{bounds["west"]},{bounds["north"]},{bounds["east"]}'
    tags = ("aeroway=runway", "aeroway=taxiway", "aeroway=apron", "landuse=port", "landuse=harbour", "harbour=yes",
            "industrial=port", "man_made=pier", "man_made=quay", "man_made=storage_tank", "industrial=oil")
    return "[out:json][timeout:25];(" + "".join(f"way[{t}]({b});" for t in tags) + ");out geom;"


def osm_context(bounds: dict, shape, elements: list | None = None) -> dict:
    """Masks on the scene grid from OpenStreetMap: aeroway (runway +
    taxiway), apron, port, tanks. Empty dict when Overpass cannot be read —
    the classifier then decides on spectra, time and shape alone."""
    import cv2
    key = tuple(round(bounds[k], 4) for k in ("west", "south", "east", "north"))
    if elements is None and key in _OSM_CACHE and time.time() - _OSM_CACHE[key][0] < OSM_TTL_S:
        elements = _OSM_CACHE[key][1]
    if elements is None and time.time() < _OSM_DOWN["until"]:
        return {}
    if elements is None:
        import urllib.parse
        import urllib.request
        for url in OVERPASS_URLS:
            try:
                req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": overpass_query(bounds)}).encode(),
                                             headers={"User-Agent": UA})
                elements = json.loads(urllib.request.urlopen(req, timeout=30).read()).get("elements", [])
                _OSM_CACHE[key] = (time.time(), elements)
                break
            except Exception as e:                                   # noqa: BLE001
                print(f"[smoke_classify] overpass {url.split('/')[2]}: {type(e).__name__}: {str(e)[:100]}", flush=True)
        if elements is None:
            # Every mirror failed: don't make each smoke pass wait out the
            # same outage — decide without OSM for the next 15 minutes.
            _OSM_DOWN["until"] = time.time() + OSM_BACKOFF_S
            print("[smoke_classify] error: no Overpass mirror answered; OSM context off for 15 min", flush=True)
            return {}
    px = _to_px(bounds, shape)
    pm = pixel_m(bounds, shape)
    masks = {k: np.zeros(shape, dtype=np.uint8) for k in ("aeroway", "apron", "port", "tanks")}
    for el in elements:
        tags, geom = el.get("tags") or {}, el.get("geometry") or []
        if len(geom) < 2:
            continue
        pts = np.round(np.array([px(g["lon"], g["lat"]) for g in geom])).astype(np.int32)
        closed = geom[0] == geom[-1] and len(geom) >= 4
        aero, mm = tags.get("aeroway"), tags.get("man_made")
        if aero in ("runway", "taxiway"):
            key = "aeroway"
        elif aero == "apron":
            key = "apron"
        elif mm == "storage_tank" or tags.get("industrial") == "oil":
            key = "tanks"
        else:
            key = "port"
        if closed and key != "aeroway":
            cv2.fillPoly(masks[key], [pts], 1)
        else:
            try:
                wm = float(str(tags.get("width", "")).split()[0])
            except (ValueError, IndexError):
                wm = 45.0 if aero == "runway" else 23.0 if aero == "taxiway" else 15.0
            cv2.polylines(masks[key], [pts], closed, 1, thickness=max(1, int(round(wm / pm))))
            if closed:
                cv2.fillPoly(masks[key], [pts], 1)
    return {k: v.astype(bool) for k, v in masks.items()}


def _window(comp: np.ndarray, px_m: float):
    ys, xs = np.nonzero(comp)
    pad = int(math.ceil(WINDOW_M / px_m))
    h, w = comp.shape
    return slice(max(0, ys.min() - pad), min(h, ys.max() + pad + 1)), slice(max(0, xs.min() - pad), min(w, xs.max() + pad + 1))


def sun_position(when, lat: float, lon: float) -> tuple[float, float]:
    """(azimuth, zenith) of the sun in degrees — azimuth clockwise from
    north — at a UTC datetime (NOAA's low-precision formulae, ~0.5°)."""
    import datetime as _dt
    if isinstance(when, str):
        when = _dt.datetime.fromisoformat(when.replace("Z", "+00:00"))
    if when.tzinfo is not None:
        when = when.astimezone(_dt.timezone.utc).replace(tzinfo=None)
    doy = when.timetuple().tm_yday
    hour = when.hour + when.minute / 60 + when.second / 3600
    g = 2 * math.pi / 365 * (doy - 1 + (hour - 12) / 24)
    decl = (0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g)
            + 0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g))
    eqt = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g)
                    - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    tst = hour * 60 + eqt + 4 * lon
    ha = math.radians(tst / 4 - 180)
    la = math.radians(lat)
    cz = math.sin(la) * math.sin(decl) + math.cos(la) * math.cos(decl) * math.cos(ha)
    zen = math.acos(max(-1.0, min(1.0, cz)))
    az = math.degrees(math.atan2(math.sin(ha), math.cos(ha) * math.sin(la) - math.tan(decl) * math.cos(la))) + 180
    return az % 360, math.degrees(zen)


SHADOW_MAX_KM = 12.0     # cloud tops a shadow is looked for under (fair-weather cumulus 0.5-3 km)


def scene_partners(now, base) -> tuple[np.ndarray, np.ndarray]:
    """(shadow, cloud) masks over the whole scene: pixels darker than the
    baseline in every band, and pixels that are cloud (white, bright out to
    SWIR, or cloud by the scene class / cloud probability)."""
    eps = 1e-3
    now = np.asarray(now, dtype=np.float32)
    base = np.asarray(base, dtype=np.float32)
    ok = (now[IB["MASK"]] > 0) & (base[IB["MASK"]] > 0)
    r = lambda n: (_band(now, n) + eps) / (_band(base, n) + eps)
    vis = (r("B02") + r("B03") + r("B04")) / 3
    shadow = ok & (vis < 0.8) & (r("B08") < 0.85) & (r("B11") < 0.9)
    cloud = ok & (np.isin(now[IB["SCL"]], CLOUD_SCL) | ((vis > 1.25) & (r("B11") > 1.1) & (now[0] > 0.12)))
    if now.shape[0] > IB["CLOUDP"]:
        cloud |= ok & (now[IB["CLOUDP"]] >= 0.5)
    return shadow, cloud


def shadow_pairing(comp, partner, px_m: float, sun_az: float, sun_zen: float, toward_sun: bool) -> tuple[float, float]:
    """(score, km): slide the region along the sun's line and find where it
    best lands on its partner — a cloud's shadow lies away from the sun at
    height × tan(zenith), the cloud casting a shadow lies toward it. Score
    is the overlap there minus the overlap the same distance the other way
    (so ground that is dark or bright everywhere scores nothing).

    The owner's test (2026-10-17): a cloud has a displaced shadow; smoke at
    that geometry usually does not — a plume is thin and low, its shadow
    faint and joined to it."""
    comp = np.asarray(comp, dtype=bool)
    ys, xs = np.nonzero(comp)
    if ys.size == 0 or sun_zen >= 85:
        return 0.0, -1.0
    if ys.size > 20000:
        k = np.random.default_rng(0).choice(ys.size, 20000, replace=False)
        ys, xs = ys[k], xs[k]
    h, w = comp.shape
    az = math.radians(sun_az if toward_sun else sun_az + 180)
    t = math.tan(math.radians(sun_zen))
    best, best_km = 0.0, -1.0

    def frac(dy, dx):
        y, x = np.round(ys + dy).astype(int), np.round(xs + dx).astype(int)
        inside = (y >= 0) & (y < h) & (x >= 0) & (x < w)
        if inside.mean() < 0.5:
            return None
        y, x = y[inside], x[inside]
        return float((partner[y, x] & ~comp[y, x]).mean())

    step_km = max(0.1, px_m * 2 / 1000 / max(t, 0.05))
    for hk in np.arange(0.2, SHADOW_MAX_KM + 1e-6, step_km):
        d_px = hk * 1000 * t / px_m
        if d_px < 2:
            continue
        dx, dy = d_px * math.sin(az), -d_px * math.cos(az)
        a, b = frac(dy, dx), frac(-dy, -dx)
        if a is None or b is None:
            continue                     # no control the other way: no claim
        sc = a - b
        if sc > best:
            best, best_km = sc, hk * t
    return round(best, 3), round(best_km, 2)


WIND_URLS = ("https://api.open-meteo.com/v1/forecast", "https://archive-api.open-meteo.com/v1/archive")
_WIND_CACHE: dict = {}


def wind_to(lat: float, lon: float, when) -> float | None:
    """Where the wind blew TO (degrees from north) at the plume's height
    (850 hPa, ~1.5 km; else 10 m) at the hour of the pass — Open-Meteo
    (ERA5 reanalysis for older days, the forecast model for recent ones);
    free and keyless. None when it cannot be read: the classifier then
    judges the drift by shape alone."""
    import datetime as _dt
    import urllib.parse
    import urllib.request
    if isinstance(when, str):
        when = _dt.datetime.fromisoformat(when.replace("Z", "+00:00"))
    if when.tzinfo is not None:
        when = when.astimezone(_dt.timezone.utc).replace(tzinfo=None)
    day, hour = when.date().isoformat(), int(round(when.hour + when.minute / 60)) % 24
    key = (round(lat, 1), round(lon, 1), day, hour)
    if key in _WIND_CACHE:
        return _WIND_CACHE[key]
    out = None
    for url in WIND_URLS:
        q = urllib.parse.urlencode({"latitude": round(lat, 3), "longitude": round(lon, 3), "start_date": day,
                                    "end_date": day, "timezone": "UTC",
                                    "hourly": "wind_direction_850hPa,wind_direction_10m"
                                    if "forecast" in url else "wind_direction_10m"})
        try:
            d = json.loads(urllib.request.urlopen(urllib.request.Request(f"{url}?{q}", headers={"User-Agent": UA}),
                                                  timeout=10).read())
            hr = d.get("hourly") or {}
            for k in ("wind_direction_850hPa", "wind_direction_10m"):
                v = (hr.get(k) or [None] * 24)[hour] if len(hr.get(k) or []) > hour else None
                if v is not None:
                    out = (float(v) + 180) % 360
                    break
            if out is not None:
                break
        except Exception as e:                                       # noqa: BLE001
            print(f"[smoke_classify] wind {url.split('/')[2]}: {type(e).__name__}: {str(e)[:100]}", flush=True)
    _WIND_CACHE[key] = out
    return out


def angle_diff(a: float, b: float) -> float:
    return abs((a - b + 180) % 360 - 180)


def assess(now, hist, comp, bounds: dict, ctx: dict | None = None, base=None, firms_points=(),
           partners=None) -> dict:
    """Features and class of one candidate region on a scene. ctx holds
    scene-grid arrays (worldcover, aeroway, apron, port, tanks, fire);
    firms_points the (lat, lon) of FIRMS detections around that day."""
    ctx = ctx or {}
    now = np.asarray(now, dtype=np.float32)
    hist = np.asarray(hist, dtype=np.float32)
    comp = np.asarray(comp, dtype=bool)
    if not comp.any():
        raise ValueError("empty region")
    pm = pixel_m(bounds, comp.shape)
    ys, xs = _window(comp, pm)
    sub = {k: v[ys, xs] for k, v in ctx.items() if isinstance(v, np.ndarray) and v.shape == comp.shape}
    # FIRMS within 1 km of the region.
    firms = 0
    if firms_points:
        from scipy import ndimage
        near = ndimage.binary_dilation(comp[ys, xs], iterations=max(1, int(1000 / pm)))
        px = _to_px(bounds, comp.shape)
        for lat, lon in firms_points:
            x, y = px(lon, lat)
            yi, xi = int(round(y)) - ys.start, int(round(x)) - xs.start
            if 0 <= yi < near.shape[0] and 0 <= xi < near.shape[1] and near[yi, xi]:
                firms += 1
    sub["firms"] = firms
    # Shadow pairing looks kilometres beyond the window, on the whole scene.
    sun = ctx.get("sun")
    if sun is None and ctx.get("when") is not None:
        try:
            sun = sun_position(ctx["when"], (bounds["south"] + bounds["north"]) / 2, (bounds["west"] + bounds["east"]) / 2)
        except (TypeError, ValueError):
            sun = None
    if sun is not None:
        if partners is None:
            partners = scene_partners(now, baseline(hist) if base is None else base)
        f_bright = None
        try:
            eps = 1e-3
            bb = baseline(hist) if base is None else np.asarray(base)
            vn = (now[0] + now[1] + now[2])[comp].mean()
            vb = (bb[0] + bb[1] + bb[2])[comp].mean()
            f_bright = vn + eps >= vb + eps
        except Exception:                                            # noqa: BLE001
            f_bright = True
        sc_, km_ = shadow_pairing(comp, partners[0] if f_bright else partners[1], pm, sun[0], sun[1],
                                  toward_sun=not f_bright)
        sub["shadow_pair"], sub["pair_km"] = sc_, km_
    if ctx.get("wind_diff") is not None:
        sub["wind_diff"] = ctx["wind_diff"]
    b = None if base is None else np.asarray(base)[:, ys, xs]
    f = features(now[:, ys, xs], hist[:, :, ys, xs], comp[ys, xs], px_m=pm, ctx=sub, base=b)
    out = classify(f)
    out["features"] = f
    return out


def assess_plumes(now, hist, plumes: list, bounds: dict, ctx: dict | None = None, firms_points=()) -> list:
    """smoke.plumes() output -> the same list, each with class, confidence,
    reasons, classifier and features. A region that cannot be measured is
    "unclassified" — not a finding, so not published; the error is logged.
    Smoke.py's word alone is what put fields and runways on the map."""
    hist = np.asarray(hist, dtype=np.float32)
    now = np.asarray(now, dtype=np.float32)
    # Passes fetched either side of a band step-down (s2_bands) differ by the
    # cloud-probability band: judge on what all of them have.
    nb = min(now.shape[0], hist.shape[1])
    now, hist = now[:nb], hist[:, :nb]
    base = baseline(hist)
    shape = now.shape[1:]
    ctx = dict(ctx or {})
    partners = None
    if ctx.get("when") is not None:
        try:
            ctx["sun"] = sun_position(ctx["when"], (bounds["south"] + bounds["north"]) / 2,
                                      (bounds["west"] + bounds["east"]) / 2)
            partners = scene_partners(now, base)
        except Exception as e:                                       # noqa: BLE001
            print(f"[smoke_classify] error: sun geometry unavailable, no shadow pairing: {type(e).__name__}: {e}", flush=True)
            ctx.pop("sun", None)
    out = []
    for p in plumes:
        try:
            comp = polygon_mask(p["geometry"], bounds, shape)
            pctx = ctx
            # Drift against the wind only means something when the source is
            # a fire: without one smoke.py's "source" is just the densest point.
            if ctx.get("wind_to") is not None and p.get("fire_px") and p.get("drift_deg") is not None:
                pctx = {**ctx, "wind_diff": angle_diff(float(p["drift_deg"]), float(ctx["wind_to"]))}
            v = assess(now, hist, comp, bounds, pctx, base=base, firms_points=firms_points, partners=partners)
        except Exception as e:                                       # noqa: BLE001
            print(f"[smoke_classify] error: region at {p.get('source_lat')},{p.get('source_lon')} unclassified: "
                  f"{type(e).__name__}: {e}", flush=True)
            v = {"class": "unclassified", "confidence": None, "reasons": [], "classifier": "none", "features": None}
        out.append({**p, **v})
    return out
