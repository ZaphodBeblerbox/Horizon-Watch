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

Only smoke_plume, burn_scar and runway are findings; the rest explain why a
change was not reported.

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

import numpy as np

# s2_bands order: B02 B03 B04 B08 B11 B12 SCL mask [B01]
IB = {"B02": 0, "B03": 1, "B04": 2, "B08": 3, "B11": 4, "B12": 5, "SCL": 6, "MASK": 7, "B01": 8}
CLOUD_SCL = (8, 9, 10)
SHADOW_SCL = (3,)
BAD_SCL = (0, 1, 3, 8, 9, 10, 11)

FINDING_CLASSES = ("smoke_plume", "burn_scar", "runway")
CLASSES = ("smoke_plume", "burn_scar", "field_change", "runway", "cloud", "cloud_shadow", "persistent")

# Fitted on the labelled prod sample (see tools/train_detection_classifier.py
# --rules-report); the smoke evidence score a candidate must reach.
SMOKE_THRESHOLD = 2.0

FEATURES = ("vis", "nir", "swir", "blue_red", "aer_blue", "mono", "nir_excess", "swir_vs_vis",
            "flatness", "dnbr", "ndvi_base", "cloud_frac", "shadow_frac", "bright_b02", "persist",
            "area_km2", "elong", "rect", "solidity", "edge_step", "tex_corr", "cropland", "builtup",
            "aeroway", "fire", "firms", "nir_frac", "swir_frac", "edge_align", "cloud_px", "cloud_near")

MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "detection_classifier.json")
_MODEL = {"mtime": None, "model": None}


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
    cloud_px = float(cloudish[comp].mean())
    try:
        from scipy import ndimage
        near_c = ndimage.binary_dilation(comp, iterations=max(2, int(1500 / px_m)))
        cloud_near = float(cloudish[near_c & ~comp].mean())
    except Exception:
        cloud_near = 0.0

    wc = ctx.get("worldcover")
    cropland = builtup = 0.0
    if wc is not None and wc.shape == comp.shape:
        v = wc[comp]
        cropland = float((v == 40).mean())
        builtup = float((v == 50).mean())
    aero = ctx.get("aeroway")
    aeroway = float(aero[comp].mean()) if aero is not None and aero.shape == comp.shape else 0.0
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
         "firms": int(ctx.get("firms") or 0), "length_m": sh["length_m"], "width_m": sh["width_m"],
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
    return s, why


def _rule_class(f: dict) -> tuple[str, float, list]:
    s, why = smoke_evidence(f)
    bright = f["vis"] > 0
    # Cloud / shadow first: they explain everything else away.
    if (f["cloud_frac"] > 0.3 or f["cloud_px"] > 0.2 or (bright and f["nir_frac"] > 0.8 and f["cloud_near"] > 0.02)
            or (f["cloud_px"] > 0.03 and f["cloud_near"] > 0.05)):
        why.insert(0, {"kind": "spectral", "sign": "-", "text": "bright in visible and near-infrared alike, cloud pixels in/around it — cloud"})
        return "cloud", 0.85, why
    flat = abs(f["nir"] - f["vis"]) < 0.25 * abs(f["vis"]) and abs(f["swir"] - f["vis"]) < 0.45 * abs(f["vis"])
    if f["shadow_frac"] > 0.3 or (not bright and flat and f["vis"] < -0.15 and f["cloud_near"] > 0.02):
        why.insert(0, {"kind": "spectral", "sign": "-", "text": "darker by the same factor in every band with cloud next to it — a cloud shadow"})
        return "cloud_shadow", 0.8, why
    linear = f["elong"] >= 8 and f["rect"] > 0.6 and 600 <= f["length_m"] <= 5000 and f["width_m"] <= 120
    if f["aeroway"] > 0.2 or (f["persist"] >= 2 and linear):
        why.insert(0, {"kind": "shape", "sign": "+", "text": f"long straight uniform strip {round(f['length_m'])} m × {round(f['width_m'])} m"
                       + (" on an OSM runway" if f["aeroway"] > 0.2 else ", present on earlier passes")})
        return "runway", 0.8 if f["aeroway"] > 0.2 else 0.55, why
    if f["persist"] >= 2:
        return "persistent", 0.75, why
    # Burn scar / impact point: newly dark, burnt (NBR drop), compact, hot.
    if (not bright and f["dnbr"] > 0.1 and f["nir"] < -0.08 and f["area_km2"] < 3
            and (f["fire"] or f["firms"]) and f["edge_align"] < 0.45):
        why.insert(0, {"kind": "spectral", "sign": "+", "text": f"burn ratio dropped by {f['dnbr']:.2f} with heat on it — burnt ground"})
        return "burn_scar", 0.8, why
    if s >= SMOKE_THRESHOLD:
        return "smoke_plume", round(min(0.97, 0.6 + (s - SMOKE_THRESHOLD) * 0.08), 2), why
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
    out = {"class": cls, "confidence": conf, "reasons": why, "classifier": "rules v1", "smoke_score": round(s, 2)}
    model = _load_model()
    # The model only re-decides between ground-truth classes it was trained
    # on; cloud and shadow stay with the physics.
    if model and cls not in ("cloud", "cloud_shadow"):
        try:
            mcls, mconf = _model_predict(model, f)
            if mcls != cls:
                why.insert(0, {"kind": "model", "sign": "+", "text": f"analyst-trained model says {mcls.replace('_', ' ')} ({round(mconf * 100)}%); rules said {cls.replace('_', ' ')}"})
            out.update({"class": mcls, "confidence": round(mconf, 2), "classifier": f"model {model.get('trained_at', '')[:10]}"})
        except Exception as e:                                     # noqa: BLE001
            print(f"[smoke_classify] error: model predict failed, rules used: {e}", flush=True)
    return out


def is_finding(cls: str) -> bool:
    return cls in FINDING_CLASSES
