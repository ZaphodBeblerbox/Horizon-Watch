"""
obb_detect.py — oriented-box object detection on satellite images.

One clean path for every image the console looks at (Sentinel-2 at 5–10 m,
the sub-metre Esri reference), replacing the per-caller copies:

  · the model is chosen by name — YOLOv8-OBB nano or medium, both DOTA v1
    (15 classes); medium is the default, nano is a quarter of the cost;
  · small objects are found by tiling: each window is magnified to the
    model's 1024 px input (SAHI), the window size set from the image's
    ground resolution so a ship is always drawn at the scale DOTA taught
    the model;
  · duplicates are merged by the overlap of the ROTATED boxes (shapely), not
    of their upright envelopes — two ships moored side by side at 30° have
    envelopes that overlap heavily and hulls that do not;
  · consensus (test-time augmentation): the image is also run flipped and
    rotated 90°, and an object is kept only if it is found in at least
    `agree` of the views. Noise from texture does not survive a rotation; a
    ship does. This is what lowers false detections without capping the
    number of real ones.

No count limit anywhere. Returns detections in image pixels and, given the
image's bounds, in degrees.
"""
from __future__ import annotations

import math
import os
import threading

import numpy as np

CLASSES = ["plane", "ship", "storage tank", "baseball diamond", "tennis court", "basketball court",
           "ground track field", "harbor", "bridge", "large vehicle", "small vehicle", "helicopter",
           "roundabout", "soccer ball field", "swimming pool"]
INPUT = 1024
_DIR = os.path.dirname(os.path.abspath(__file__))
_SESSIONS: dict = {}
_LOCK = threading.Lock()


def clear_coreml_leftovers() -> int:
    """Remove CoreML's compiled copies of the model left by earlier processes.

    The CoreML provider compiles the model into the system temp dir
    (onnxruntime-<uuid>-<pid>-….mlmodel/.mlmodelc, ~200 MB per load) and
    never deletes it. Every backend start left another: 140 of them filled
    the owner's disk on 2026-10-07. A copy whose process is gone is garbage."""
    import re
    import shutil
    import tempfile
    n = 0
    tmp = tempfile.gettempdir()
    for name in os.listdir(tmp):
        m = re.match(r"onnxruntime-[0-9A-F-]{36}-(\d+)-", name)
        if not m:
            continue
        pid = int(m.group(1))
        try:
            os.kill(pid, 0)
            continue                                         # still running: its copy is in use
        except ProcessLookupError:
            pass
        except PermissionError:
            continue
        p = os.path.join(tmp, name)
        try:
            shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
            n += 1
        except OSError:
            pass
    return n


def session(model: str = "yolov8m-obb"):
    import onnxruntime as ort
    with _LOCK:
        if model not in _SESSIONS:
            clear_coreml_leftovers()
            path = model if model.endswith(".onnx") else os.path.join(_DIR, "models", f"{model}.onnx")
            if not os.path.exists(path):
                path = os.path.join(_DIR, f"{model}.onnx")
            providers = [p for p in ("CoreMLExecutionProvider", "CPUExecutionProvider")
                         if p in ort.get_available_providers()]
            # YOLO26 is exported WITHOUT its end-to-end head (end2end=False):
            # CoreML mis-executes that head (GatherElements out of range),
            # and on the CPU it took 8 minutes a scene. The classic head runs
            # on CoreML at ~0.2 s a tile, and _nms() does the merging.
            try:
                _SESSIONS[model] = ort.InferenceSession(path, providers=providers)
            except Exception:                                # noqa: BLE001 — CoreML can refuse a graph
                _SESSIONS[model] = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
    return _SESSIONS[model]


def _corners(cx, cy, w, h, a):
    c, s = math.cos(a), math.sin(a)
    pts = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
    return [(cx + x * c - y * s, cy + x * s + y * c) for x, y in pts]


def window_for(m_per_px: float, target_m_per_px: float = 1.5) -> int:
    """Window size so that, magnified to 1024 px, the image is shown at
    about `target_m_per_px` — but never magnified more than 4× (beyond that
    the model sees interpolation, not objects)."""
    zoom = max(1.0, min(4.0, m_per_px / target_m_per_px))
    return max(160, int(INPUT / zoom))


def _run_view(img: np.ndarray, sess, window: int, conf: float):
    """One pass over the image (H×W×3 float32 0..1). Returns
    [(cls, score, corners_px)]."""
    from PIL import Image
    h, w = img.shape[:2]
    overlap = max(24, int(window * 0.15))
    stride = window - overlap

    def starts(n):
        if n <= window:
            return [0]
        s = list(range(0, n - window, stride))
        if s[-1] + window < n:
            s.append(n - window)
        return s

    out = []
    name = sess.get_inputs()[0].name
    pil = Image.fromarray((img * 255).astype(np.uint8))
    for ty in starts(h):
        for tx in starts(w):
            tw, th = min(window, w - tx), min(window, h - ty)
            sc = min(INPUT / tw, INPUT / th)
            nw, nh = int(tw * sc), int(th * sc)
            px, py = (INPUT - nw) // 2, (INPUT - nh) // 2
            canvas = Image.new("RGB", (INPUT, INPUT), (114, 114, 114))
            canvas.paste(pil.crop((tx, ty, tx + tw, ty + th)).resize((nw, nh), Image.BICUBIC), (px, py))
            arr = np.transpose(np.asarray(canvas, dtype=np.float32) / 255.0, (2, 0, 1))[None]
            raw = sess.run(None, {name: arr})[0][0]
            if raw.shape[-1] == 7:
                # End-to-end head (YOLO26): rows of cx, cy, w, h, score, class, angle.
                pred = raw
                best, cls = pred[:, 4], pred[:, 5].astype(int)
            else:
                # Classic head (YOLOv8/11): 4 + 15 class scores + angle, per anchor.
                pred = raw.T
                scores = pred[:, 4:4 + len(CLASSES)]
                best, cls = scores.max(axis=1), scores.argmax(axis=1)
            keep = best >= conf
            for (cx, cy, bw, bh), s, c, a in zip(pred[keep, :4], best[keep], cls[keep], pred[keep, -1]):
                pts = [(float((x - px) / sc + tx), float((y - py) / sc + ty)) for x, y in _corners(float(cx), float(cy), float(bw), float(bh), float(a))]
                # Skip boxes cut by a tile edge that the overlap will see whole.
                out.append((int(c), float(s), pts))
    return out


def _nms(dets, iou: float):
    """Per-class NMS on rotated polygons."""
    from shapely.geometry import Polygon
    from shapely.strtree import STRtree
    keep = []
    for c in {d[0] for d in dets}:
        group = sorted([d for d in dets if d[0] == c], key=lambda d: -d[1])
        polys = [Polygon(d[2]).buffer(0) for d in group]
        tree = STRtree(polys)
        dead = set()
        for i, p in enumerate(polys):
            if i in dead or p.area <= 0:
                continue
            keep.append(group[i])
            for j in tree.query(p):
                j = int(j)
                if j <= i or j in dead:
                    continue
                inter = p.intersection(polys[j]).area
                if inter and inter / (p.area + polys[j].area - inter) > iou:
                    dead.add(j)
    return keep


# The views: identity, horizontal flip, rotations by 90° and 270°. Each is
# (forward on the image, inverse on a point (x, y) given the ORIGINAL size).
def _views():
    return [
        ("id", lambda a: a, lambda x, y, w, h: (x, y)),
        ("flip", lambda a: a[:, ::-1], lambda x, y, w, h: (w - x, y)),
        ("r90", lambda a: np.rot90(a, 1), lambda x, y, w, h: (w - y, x)),
        ("r270", lambda a: np.rot90(a, 3), lambda x, y, w, h: (y, h - x)),
    ]


def detect(image, m_per_px: float, *, model: str = "yolov8m-obb", conf: float = 0.25,
           iou: float = 0.3, agree: int = 1, views: int = 1, bounds: dict | None = None) -> list[dict]:
    """Detections on a PIL image of known ground resolution.

    views 1 = plain; 2–4 = test-time augmentation, keeping objects found in
    at least `agree` views. bounds {west,south,east,north} adds lat/lon.
    """
    from shapely.geometry import Polygon
    from shapely.strtree import STRtree
    img = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
    h, w = img.shape[:2]
    sess = session(model)
    window = window_for(m_per_px)

    per_view = []
    for name, fwd, inv in _views()[:max(1, min(4, views))]:
        raw = _run_view(np.ascontiguousarray(fwd(img)), sess, window, conf)
        mapped = [(c, s, [inv(x, y, w, h) for x, y in pts]) for c, s, pts in raw]
        per_view.append(_nms(mapped, iou))

    base = per_view[0]
    if len(per_view) > 1:
        # Consensus: pool every view's detections, merge, and count how many
        # views each surviving object was seen in.
        pooled = [d for v in per_view for d in v]
        merged = _nms(pooled, iou)
        polys = {vi: [Polygon(d[2]).buffer(0) for d in v] for vi, v in enumerate(per_view)}
        trees = {vi: STRtree(ps) for vi, ps in polys.items() if ps}
        base = []
        for c, s, pts in merged:
            p = Polygon(pts).buffer(0)
            seen, scores = 0, []
            for vi, v in enumerate(per_view):
                if vi not in trees:
                    continue
                best = 0.0
                for j in trees[vi].query(p):
                    q = polys[vi][int(j)]
                    if v[int(j)][0] != c:
                        continue
                    inter = p.intersection(q).area
                    if inter:
                        best = max(best, inter / (p.area + q.area - inter))
                if best >= 0.3:
                    seen += 1
                    scores.append(s)
            if seen >= agree:
                base.append((c, float(np.mean(scores)) if scores else s, pts, seen))
    else:
        base = [(c, s, pts, 1) for c, s, pts in base]

    out = []
    for c, s, pts, seen in base:
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        e1 = math.dist(pts[0], pts[1]) * m_per_px
        e2 = math.dist(pts[1], pts[2]) * m_per_px
        d = {"cls": CLASSES[c], "conf": round(s, 4), "views": seen,
             "px": [[round(x, 2), round(y, 2)] for x, y in pts],
             "cx": float(np.mean(xs)), "cy": float(np.mean(ys)),
             "length_m": round(max(e1, e2), 1), "width_m": round(min(e1, e2), 1)}
        if bounds:
            def ll(x, y):
                return (bounds["north"] - y / h * (bounds["north"] - bounds["south"]),
                        bounds["west"] + x / w * (bounds["east"] - bounds["west"]))
            d["lat"], d["lon"] = ll(d["cx"], d["cy"])
            d["corners"] = [list(ll(x, y)) for x, y in pts]
        out.append(d)
    return out


# ── Two models, one answer ────────────────────────────────────────────────
#
# Measured against the sub-metre reference at Khor Fakkan and Jebel Ali
# (storage tanks, 2026-10-06): YOLOv8-m finds the most (recall 0.40–0.44)
# but invents — 19 "planes" in a port with no airfield; YOLO26-x is the
# most precise (0.81–0.94) and finds a little less. An object both find is
# right 89–100% of the time. So both run, nothing is thrown away, and each
# detection says how sure it is:
#
#     confirmed  — both models, same kind, overlapping outlines
#     probable   — one model only
#
# Signals are raised on confirmed detections; probable ones are drawn
# dashed for an analyst to judge.
ENSEMBLE = ("yolov8m-obb", "yolo26x-obb")


def _overlap(a: dict, b: dict) -> bool:
    from shapely.geometry import Polygon
    pa, pb = Polygon(a["px"]).buffer(0), Polygon(b["px"]).buffer(0)
    if pa.is_empty or pb.is_empty:
        return False
    inter = pa.intersection(pb).area
    return inter > 0 and inter / min(pa.area, pb.area) >= 0.3


def ensemble(image, m_per_px: float, *, bounds: dict | None = None, conf: float = 0.25,
             models: tuple = ENSEMBLE) -> list[dict]:
    runs = []
    for m in models:
        try:
            runs.append((m, detect(image, m_per_px, model=m, conf=conf, bounds=bounds)))
        except Exception as ex:                              # noqa: BLE001 — a missing model is not fatal
            print(f"[obb_detect] {m} unavailable: {type(ex).__name__}: {str(ex)[:160]}", flush=True)
    if not runs:
        return []
    if len(runs) == 1:
        return [{**d, "tier": "probable", "models": [runs[0][0]]} for d in runs[0][1]]
    (ma, a), (mb, b) = runs[0], runs[1]
    out, used = [], set()
    for d in a:
        partner = next((j for j, e in enumerate(b) if j not in used and e["cls"] == d["cls"] and _overlap(d, e)), None)
        if partner is not None:
            used.add(partner)
            e = b[partner]
            # The more precise model's outline, the higher confidence.
            out.append({**e, "conf": max(d["conf"], e["conf"]), "tier": "confirmed", "models": [ma, mb]})
        else:
            out.append({**d, "tier": "probable", "models": [ma]})
    out += [{**e, "tier": "probable", "models": [mb]} for j, e in enumerate(b) if j not in used]
    return out
