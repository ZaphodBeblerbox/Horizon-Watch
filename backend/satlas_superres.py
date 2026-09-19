"""
satlas_superres.py — Allen AI's Satlas super-resolution, 4x on Sentinel-2.

WHAT IT IS. An ESRGAN (RRDBNet) trained on paired Sentinel-2 / NAIP imagery,
upscaling 10 m/px Sentinel-2 to roughly 2.5 m/px. Weights come from Allen
AI's public bucket and are downloaded once on first use, the same pattern
sar_detector.py already uses for the Sentinel-1 vessel model rather than
committing 128MB to git.

The architecture here is not a guess: the checkpoint's own keys were read
before this was written. conv_first is (64, 3, 3, 3), the body uses
rdb1..rdb3 with five convs each at growth 32, and 702 tensors resolves to
exactly 23 blocks. `load_state_dict(..., strict=True)` is the test that this
matches, and it is asserted at load time rather than hoped for.

WHAT IT IS FOR, AND WHAT IT IS NOT FOR.

It is for LOOKING. A super-resolved scene makes a jetty, a tank farm or a
vehicle park legible to a person in a way the 10 m/px source is not.

It is NOT an independent observation, and nothing here may originate a
detection on its own. ESRGAN is generative: it invents plausible detail
consistent with its training set, so an object "found" only in the
super-resolved image may be an object the model drew. Worse, that detail is
a function of the SAME pixels Sentinel-2 supplied, so "Sentinel and the
super-resolution agree" is one observation counted twice, not two
witnesses.

The corroboration that has force is SAR, which is genuinely independent
physics — active microwave against reflected sunlight. So a detection made
on super-resolved imagery carries `provenance="superres"` and
`corroborated=False` until something that actually saw the ground agrees
with it, and callers are expected to treat an uncorroborated one as a
candidate rather than a finding.
"""
from __future__ import annotations

import os
import threading
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

# WEIGHTS LIVE ON THE VOLUME, not next to the code.
#
# On Railway the application directory is ephemeral and DATA_DIR /
# RAILWAY_VOLUME_MOUNT_PATH is the persistent volume. Writing a 128MB
# download beside the source means re-downloading it after every single
# deploy, and filling a container disk that is not sized for it. The same
# mistake is still present in sar_detector.py, which puts its own ~218MB of
# weights under BASE_DIR.
_DATA_DIR = Path(
    os.getenv("DATA_DIR")
    or os.getenv("RAILWAY_VOLUME_MOUNT_PATH")
    or (BASE_DIR / "data")
)
WEIGHTS_DIR = _DATA_DIR / "model_weights" / "satlas_superres"
WEIGHTS_NAME = "esrgan_1S2.pth"
WEIGHTS_URL = (
    "https://storage.googleapis.com/satlas-satellite-super-resolution/esrgan_1S2.pth"
)
# Verified by download on 2026-09-19.
WEIGHTS_BYTES_APPROX = 134_000_000

SCALE = 4                     # the model upsamples 4x: 10 m/px -> ~2.5 m/px
NUM_FEAT = 64
NUM_BLOCK = 23
NUM_GROW_CH = 32

# Sentinel-2 arrives as 8-bit RGB here (the true-colour Process API render),
# so it is simply scaled to 0..1. The upstream repo's /8160 divisor applies
# to raw 16-bit bands, which is not what this pipeline fetches.
_lock = threading.Lock()
_model = None
_device = None


class SuperResUnavailable(RuntimeError):
    """Weights or torch are not available. A real, reportable condition."""


def enabled() -> bool:
    """Opt-in. Super-resolution is generative, so it is never silently on."""
    return (os.getenv("SATLAS_SUPERRES_ENABLED", "").strip().lower()
            in ("1", "true", "yes"))


def weights_path() -> Path:
    return WEIGHTS_DIR / WEIGHTS_NAME


def weights_present() -> bool:
    p = weights_path()
    return p.exists() and p.stat().st_size > 1_000_000


# ── architecture ──────────────────────────────────────────────────────────
# Standard RRDBNet, as used by ESRGAN. Written to match the checkpoint's
# key names exactly so the load can be strict.

def _build_arch():
    import torch
    import torch.nn as nn
    import torch.nn.functional as F

    class ResidualDenseBlock(nn.Module):
        def __init__(self, nf=NUM_FEAT, gc=NUM_GROW_CH):
            super().__init__()
            self.conv1 = nn.Conv2d(nf, gc, 3, 1, 1)
            self.conv2 = nn.Conv2d(nf + gc, gc, 3, 1, 1)
            self.conv3 = nn.Conv2d(nf + 2 * gc, gc, 3, 1, 1)
            self.conv4 = nn.Conv2d(nf + 3 * gc, gc, 3, 1, 1)
            self.conv5 = nn.Conv2d(nf + 4 * gc, nf, 3, 1, 1)
            self.lrelu = nn.LeakyReLU(negative_slope=0.2, inplace=True)

        def forward(self, x):
            x1 = self.lrelu(self.conv1(x))
            x2 = self.lrelu(self.conv2(torch.cat((x, x1), 1)))
            x3 = self.lrelu(self.conv3(torch.cat((x, x1, x2), 1)))
            x4 = self.lrelu(self.conv4(torch.cat((x, x1, x2, x3), 1)))
            x5 = self.conv5(torch.cat((x, x1, x2, x3, x4), 1))
            return x5 * 0.2 + x

    class RRDB(nn.Module):
        def __init__(self, nf=NUM_FEAT, gc=NUM_GROW_CH):
            super().__init__()
            self.rdb1 = ResidualDenseBlock(nf, gc)
            self.rdb2 = ResidualDenseBlock(nf, gc)
            self.rdb3 = ResidualDenseBlock(nf, gc)

        def forward(self, x):
            return self.rdb3(self.rdb2(self.rdb1(x))) * 0.2 + x

    class RRDBNet(nn.Module):
        def __init__(self, in_ch=3, out_ch=3, nf=NUM_FEAT,
                     nb=NUM_BLOCK, gc=NUM_GROW_CH):
            super().__init__()
            self.conv_first = nn.Conv2d(in_ch, nf, 3, 1, 1)
            self.body = nn.Sequential(*[RRDB(nf, gc) for _ in range(nb)])
            self.conv_body = nn.Conv2d(nf, nf, 3, 1, 1)
            self.conv_up1 = nn.Conv2d(nf, nf, 3, 1, 1)
            self.conv_up2 = nn.Conv2d(nf, nf, 3, 1, 1)
            self.conv_hr = nn.Conv2d(nf, nf, 3, 1, 1)
            self.conv_last = nn.Conv2d(nf, out_ch, 3, 1, 1)
            self.lrelu = nn.LeakyReLU(negative_slope=0.2, inplace=True)

        def forward(self, x):
            feat = self.conv_first(x)
            feat = feat + self.conv_body(self.body(feat))
            feat = self.lrelu(self.conv_up1(F.interpolate(feat, scale_factor=2, mode="nearest")))
            feat = self.lrelu(self.conv_up2(F.interpolate(feat, scale_factor=2, mode="nearest")))
            return self.conv_last(self.lrelu(self.conv_hr(feat)))

    return RRDBNet


def ensure_weights(timeout: int = 900) -> Path:
    """Download the weights once. Never silently; the log says what and why."""
    p = weights_path()
    if weights_present():
        return p
    WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
    import urllib.request
    print(f"[superres] downloading Satlas ESRGAN weights (~128MB) → {p}")
    tmp = p.with_suffix(".part")
    try:
        with urllib.request.urlopen(WEIGHTS_URL, timeout=timeout) as r, open(tmp, "wb") as f:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)
        tmp.replace(p)
    except Exception as e:
        tmp.unlink(missing_ok=True)
        raise SuperResUnavailable(f"could not download super-resolution weights: {e}") from e
    print(f"[superres] weights ready ({p.stat().st_size / 1e6:.0f} MB)")
    return p


def _available_memory_mb() -> float | None:
    """Best-effort free memory, including a container's cgroup limit.

    A host reporting 32GB says nothing about a 512MB container, and on
    Railway the cgroup is the number that matters — exceed it and the
    process is killed outright, with no traceback to explain it.
    """
    try:
        for f in ("/sys/fs/cgroup/memory.max",
                  "/sys/fs/cgroup/memory/memory.limit_in_bytes"):
            p = Path(f)
            if p.exists():
                raw = p.read_text().strip()
                if raw and raw != "max":
                    limit = int(raw)
                    if limit < (1 << 62):          # not "unlimited"
                        used = 0
                        for g in ("/sys/fs/cgroup/memory.current",
                                  "/sys/fs/cgroup/memory/memory.usage_in_bytes"):
                            gp = Path(g)
                            if gp.exists():
                                used = int(gp.read_text().strip())
                                break
                        return (limit - used) / 1e6
    except Exception:
        pass
    return None


# torch plus this model needs roughly this much headroom to load and run.
MIN_FREE_MB = float(os.getenv("SUPERRES_MIN_FREE_MB", "700"))


def load_model():
    """Load once and cache. Raises SuperResUnavailable with a real reason."""
    global _model, _device
    with _lock:
        if _model is not None:
            return _model, _device

        free = _available_memory_mb()
        if free is not None and free < MIN_FREE_MB:
            # Refusing is the stable outcome. Loading anyway gets the whole
            # container OOM-killed, which takes every other feature down
            # with it — the opposite of what this switch is for.
            raise SuperResUnavailable(
                f"not enough memory to load the model: {free:.0f}MB free, "
                f"{MIN_FREE_MB:.0f}MB needed. Give the service more memory, "
                f"or leave super-resolution off."
            )

        try:
            import torch
        except ImportError as e:
            raise SuperResUnavailable(
                "torch is not installed in this environment — super-resolution "
                "and the SAR vessel detector both need it"
            ) from e

        path = ensure_weights()
        ck = torch.load(path, map_location="cpu", weights_only=False)
        # params_ema is the exponential-moving-average copy, which is what
        # ESRGAN evaluates with; params is the raw generator.
        sd = ck.get("params_ema") or ck.get("params") or ck

        RRDBNet = _build_arch()
        model = RRDBNet()
        # STRICT. A silently partial load produces a model that runs and
        # returns plausible noise, which is the worst possible failure for
        # something generative — it would look like imagery.
        model.load_state_dict(sd, strict=True)
        model.eval()

        device = torch.device("cpu")
        # Leave the machine a core, for the same reason ONNX does.
        torch.set_num_threads(max(1, (os.cpu_count() or 4) - 2))
        model.to(device)
        _model, _device = model, device
        print(f"[superres] Satlas ESRGAN loaded ({NUM_BLOCK} blocks, x{SCALE})")
        return _model, _device


def upscale(img, *, chip: int = 32, overlap: int = 8):
    """4x super-resolve a PIL RGB image. Returns a new PIL image.

    RUN AT THE TRAINING CHIP SIZE, 32x32 -> 128x128. This is not a
    performance knob, it is a correctness one. The first version fed the
    model 256px tiles on the reasoning that ESRGAN is fully convolutional
    and therefore size-agnostic. It is not, in practice: the output was
    striped, hallucinated texture that looked nothing like imagery, while
    passing every structural check — the weights loaded strictly and the
    result was exactly 4x. Only looking at the pixels showed it. At 32px the
    same weights produce real buildings, field boundaries and structures.

    OVERLAP AND BLEND, because each chip is super-resolved independently and
    the model returns slightly different brightness for each. Butt-jointed
    chips therefore leave a visible 32px checkerboard across the scene — and
    on a generative model a hard straight edge reads as a real boundary on
    the ground. Chips overlap and are accumulated with a linear feather, so
    the seams average out instead of being drawn.
    """
    import numpy as np
    import torch
    from PIL import Image

    model, device = load_model()
    src = img.convert("RGB")
    w, h = src.size
    ow, oh = w * SCALE, h * SCALE

    acc = np.zeros((oh, ow, 3), dtype=np.float32)
    wsum = np.zeros((oh, ow, 1), dtype=np.float32)

    def feather(n: int) -> np.ndarray:
        """Triangular window: full weight in the middle, tapering to the edge."""
        if n <= 2:
            return np.ones(n, dtype=np.float32)
        r = np.linspace(-1.0, 1.0, n, dtype=np.float32)
        return np.clip(1.0 - np.abs(r), 1e-3, 1.0)

    step = max(1, chip - overlap)
    with torch.no_grad():
        for y0 in range(0, max(1, h - 1), step):
            for x0 in range(0, max(1, w - 1), step):
                # Pull the window back inside the image rather than padding:
                # padding invents edge content and the model will happily
                # super-resolve the invention.
                x0c = min(x0, max(0, w - chip))
                y0c = min(y0, max(0, h - chip))
                x1, y1 = min(x0c + chip, w), min(y0c + chip, h)
                patch = src.crop((x0c, y0c, x1, y1))
                pw, ph = patch.size
                if pw < 1 or ph < 1:
                    continue

                arr = np.asarray(patch, dtype=np.float32) / 255.0
                t = torch.from_numpy(arr).permute(2, 0, 1).unsqueeze(0).to(device)
                sr = model(t).clamp(0, 1).squeeze(0).permute(1, 2, 0).cpu().numpy()

                win = (feather(ph * SCALE)[:, None] * feather(pw * SCALE)[None, :])[..., None]
                oy, ox = y0c * SCALE, x0c * SCALE
                acc[oy:oy + ph * SCALE, ox:ox + pw * SCALE] += sr * win
                wsum[oy:oy + ph * SCALE, ox:ox + pw * SCALE] += win

    out = acc / np.maximum(wsum, 1e-6)
    return Image.fromarray((np.clip(out, 0, 1) * 255.0 + 0.5).astype(np.uint8))


def torch_available() -> bool:
    import importlib.util
    return importlib.util.find_spec("torch") is not None


def status() -> dict:
    """What a caller can actually expect, without triggering a download."""
    free = _available_memory_mb()
    return {
        "enabled": enabled(),
        "torch_available": torch_available(),
        "free_memory_mb": round(free, 0) if free is not None else None,
        "min_free_memory_mb": MIN_FREE_MB,
        "weights_present": weights_present(),
        "weights_path": str(weights_path()),
        "scale": SCALE,
        "loaded": _model is not None,
        "note": ("super-resolution is generative — it may never originate a "
                 "detection on its own, only sharpen one another sensor found"),
    }
