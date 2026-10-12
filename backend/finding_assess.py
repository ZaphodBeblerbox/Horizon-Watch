"""finding_assess.py — a second opinion on one finding, from a vision model,
ON REQUEST ONLY (owner, 2026-10-12: "OpenAI enrichment when we check out a
location — only when we press on the detected thing — so it can say 'I think
that actually is something' or not; most of the time it won't be anything").

What is sent: the finding's cut-outs (radar After, Before and Change — the
comparison's own images — and the optical cut-out of the area when one is
held), each with the box drawn on it, and the measured facts (what the
detector said, size in ha, strength, land cover, sensor and dates, place and
country, the system's own signals nearby). What comes back, structured:

    verdict        likely_real | uncertain | likely_benign
    confidence     0..1
    most_likely    what it most likely is (vehicle park, tent camp,
                   construction, harvest / soil moisture, water, radar
                   artefact, …)
    reasons        why
    would_confirm  what would settle it (a high-resolution image, a second
                   pass in 6 days, …)
    limits         always including that 10–20 m imagery cannot tell a field
                   hospital from a camp

THE RULES.
  - Never automatic: only routers/finding_assess.py's POST, which only the
    "Assess with AI" button calls. Nothing in the app's loops imports this.
  - Through openai_gate with the already-enabled ENRICH purpose (production's
    HW_OPENAI_PURPOSES includes it), under the one monthly budget; refused
    when the month's spend plus this call's estimate would pass the cap.
  - Cached by finding + the exact images + the prompt version, on disk, so
    the same question is never paid for twice. Every paid call is logged to
    usage_tracker (call_type "assess").
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import logging
import math
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

PROMPT_VERSION = "assess-v1"
VERDICTS = ("likely_real", "uncertain", "likely_benign")
RESOLUTION_LIMIT = ("Sentinel imagery is 10–20 m per pixel: it can show that ground or returns changed, "
                    "not what a thing is — it cannot tell a field hospital from a camp, or a tent from a truck.")
# A low-detail image costs a fixed number of tokens; on gpt-4o-mini images are
# billed at ~33x the text token count (2,833 tokens each at "low").
IMAGE_TOKENS = {"gpt-4o-mini": 2833, "gpt-4o": 85, "gpt-4.1-mini": 2833, "gpt-4.1-nano": 2833}
TEXT_TOKENS = 1400
OUTPUT_TOKENS = 450

_root_override: Path | None = None


def root() -> Path:
    if _root_override is not None:
        return _root_override
    import paths
    return paths.DATA_DIR / "finding_assessments"


SYSTEM = """You are an imagery analyst giving a careful SECOND OPINION on one automatic detection from free satellite imagery \
(Sentinel-1 radar at ~10-20 m per pixel, Sentinel-2 optical at 10 m). Automatic detections are usually NOT anything: \
most are harvest, ploughing, soil moisture after rain, standing water, vegetation change, construction that was already \
there, speckle, or radar geometry artefacts. Say "likely_real" only when the images and the facts together point to a \
real new man-made presence (vehicles, tents, earthworks, a new structure). Prefer "uncertain" over guessing.

How to read the images: each has the finding's box drawn in red. Radar After / Before are the mean backscatter of several \
passes (bright = strong returns: metal, buildings, vehicles, rough or wet surfaces; dark = smooth: water, tarmac, fresh \
soil, short crop). Radar Change: red = brighter now, blue = darker now. An optical image, when given, shows the area \
as seen in daylight, but may be older or cloudy.

Answer ONLY a JSON object:
{"verdict": "likely_real" | "uncertain" | "likely_benign",
 "confidence": number 0..1 (how sure you are of the verdict),
 "most_likely": short phrase (e.g. "vehicle park", "tent camp", "construction", "harvest / soil moisture", "water", "radar artefact"),
 "alternatives": [short phrases],
 "reasons": [2-5 short sentences, each tied to what is visible or measured],
 "would_confirm": [1-3 concrete next steps, e.g. "a high-resolution image", "a second radar pass in 6 days"],
 "limits": [1-2 sentences on what this imagery cannot tell]}"""


# ── pure helpers ────────────────────────────────────────────────────────────
def cache_key(zone_id: str, finding: dict, images: dict) -> str:
    h = hashlib.sha256()
    h.update(f"{PROMPT_VERSION}|{zone_id}|{finding.get('id')}|{finding.get('scan_id')}".encode())
    for name in sorted(images):
        h.update(name.encode())
        h.update(hashlib.sha256(images[name].encode() if isinstance(images[name], str) else images[name]).digest())
    return h.hexdigest()[:40]


def estimate_usd(n_images: int, model: str) -> float:
    import openai_gate
    pin, pout = openai_gate.price_for(model)
    per_img = next((v for k, v in IMAGE_TOKENS.items() if (model or "").lower().startswith(k)), 2833)
    return round((TEXT_TOKENS + per_img * n_images) * pin + OUTPUT_TOKENS * pout, 5)


def _clamp01(v, default=0.5) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return default
    return default if math.isnan(x) else min(1.0, max(0.0, x))


def _strs(v, n=6) -> list[str]:
    if isinstance(v, str):
        v = [v]
    return [str(x).strip()[:300] for x in (v or []) if str(x).strip()][:n]


def normalise_verdict(raw: dict) -> dict:
    """Whatever the model returned → the shape the app shows; the resolution
    limit is always there, whatever the model said."""
    raw = raw if isinstance(raw, dict) else {}
    v = str(raw.get("verdict") or "").strip().lower().replace(" ", "_")
    if v not in VERDICTS:
        v = "uncertain"
    limits = _strs(raw.get("limits"), 3)
    if not any("10" in x and ("hospital" in x.lower() or "identify" in x.lower() or "tell" in x.lower()) for x in limits):
        limits.append(RESOLUTION_LIMIT)
    return {"verdict": v, "confidence": round(_clamp01(raw.get("confidence")), 2),
            "most_likely": str(raw.get("most_likely") or "unclear").strip()[:80],
            "alternatives": _strs(raw.get("alternatives"), 4), "reasons": _strs(raw.get("reasons"), 5) or ["The model gave no reasons."],
            "would_confirm": _strs(raw.get("would_confirm"), 3) or ["A high-resolution image of the box."],
            "limits": limits}


def facts_text(f: dict, ctx: dict) -> str:
    area = f.get("area_m2")
    lines = [
        f"Detection: {f.get('label')} (kind {f.get('kind')}, {f.get('sensor') or 'Sentinel'})",
        f"Size: {round(area / 10000, 2)} ha ({round(area)} m²)" if area else "Size: not measured",
        f"Strength: |t| {abs(float(f['t_peak'])):.1f} (how far past chance the change is; not a probability)" if f.get("t_peak") not in (None, "") else None,
        f"Detector confidence: {round(float(f['confidence']) * 100)}%" if f.get("confidence") not in (None, "") else None,
        f"Direction: {'brighter now (new returns)' if f.get('direction') != 'removed' else 'darker now (returns gone)'}" if f.get("kind") == "radar_change" else None,
        f"Land cover at the spot: {f.get('landcover')}" if f.get("landcover") else None,
        f"Box extent from: {f.get('box_source')}",
        f"Date found: {f.get('date')}",
        f"Radar passes before: {', '.join(ctx.get('dates_before') or []) or 'n/a'}; after: {', '.join(ctx.get('dates_after') or []) or 'n/a'}",
        f"Optical image date: {ctx.get('optical_date')}" if ctx.get("optical_date") else "No optical image of the area is held.",
        f"Place: {ctx.get('zone_name')} ({f.get('lat'):.4f}, {f.get('lon'):.4f}), country: {ctx.get('country') or 'unknown'}",
        f"Watched area type: {ctx.get('aoi_class')}" if ctx.get("aoi_class") else None,
        f"Other findings in the same comparison: {ctx.get('siblings')}" if ctx.get("siblings") is not None else None,
    ]
    near = ctx.get("nearby") or []
    lines.append("The system's own signals within 25 km, last 14 days: " + ("none" if not near else ""))
    lines += [f"  - {n}" for n in near[:8]]
    return "\n".join(x for x in lines if x)


def boxed_png(b64: str, box) -> str:
    """The cut-out with the finding's box ([x, y, w, h] fractions) drawn in red, as PNG base64."""
    from PIL import Image, ImageDraw
    img = Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")
    if box and len(box) == 4:
        x, y, w, h = [float(v) for v in box]
        W, H = img.size
        d = ImageDraw.Draw(img)
        d.rectangle([x * W, y * H, (x + w) * W, (y + h) * H], outline=(255, 40, 40), width=max(2, round(min(W, H) / 120)))
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii")


# ── the cache ───────────────────────────────────────────────────────────────
def cached(key: str) -> dict | None:
    p = root() / f"{key}.json"
    try:
        return json.loads(p.read_text()) if p.is_file() else None
    except Exception:                                            # noqa: BLE001
        return None


def _store(key: str, rec: dict) -> None:
    d = root()
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / f".{key}.tmp"
    tmp.write_text(json.dumps(rec))
    os.replace(tmp, d / f"{key}.json")


# ── gathering ───────────────────────────────────────────────────────────────
def gather(db, zone, finding_id: str) -> dict | None:
    """The finding, its images (boxed) and its facts — or None when there is no such finding."""
    import radar_images
    import zone_findings
    from database import Alert
    d = zone_findings.zone_findings(db, zone, days=365)
    f = next((x for x in d["findings"] if x.get("id") == finding_id), None)
    if f is None:
        return None
    images, ctx = {}, {"zone_name": zone.name, "aoi_class": getattr(zone, "aoi_class", None)}
    if f.get("kind") in ("sweep_find", "radar_change") and f.get("scan_id") and radar_images.has(f["scan_id"]):
        c = radar_images.crop(f["scan_id"], f["box"])
        if c:
            for n in ("after", "before", "change"):
                if c.get(f"{n}_b64"):
                    images[f"radar_{n}"] = boxed_png(c[f"{n}_b64"], c.get("box"))
            ctx["dates_before"], ctx["dates_after"] = c.get("dates_before"), c.get("dates_after")
    o = zone_findings.crop_for(db, zone, f["box"], prefer="OPTICAL")
    if o and o.get("image_b64") and (o.get("instrument") or "OPTICAL") != "SAR":
        images["optical"] = boxed_png(o["image_b64"], o.get("box"))
        ctx["optical_date"] = o.get("date")
    if f.get("scan_id"):
        ctx["siblings"] = sum(1 for x in d["findings"] if x.get("scan_id") == f["scan_id"]) - 1
    try:
        import geo_land
        ctx["country"] = geo_land.country_at(f["lat"], f["lon"])
    except Exception:                                            # noqa: BLE001
        ctx["country"] = None
    dlat = 25 / 110.574
    dlon = 25 / (111.32 * max(0.05, math.cos(math.radians(f["lat"]))))
    since = datetime.utcnow() - timedelta(days=14)
    rows = (db.query(Alert.title, Alert.alert_type, Alert.created_at)
            .filter(Alert.lat.between(f["lat"] - dlat, f["lat"] + dlat), Alert.lon.between(f["lon"] - dlon, f["lon"] + dlon),
                    Alert.created_at >= since, Alert.alert_type != "Imagery signal")
            .order_by(Alert.created_at.desc()).limit(8).all())
    ctx["nearby"] = [f"{(r[2].strftime('%d %b') if r[2] else '')} · {r[1]} · {str(r[0])[:140]}" for r in rows]
    return {"finding": f, "images": images, "ctx": ctx, "facts": facts_text(f, ctx)}


IMAGE_CAPTIONS = {"radar_after": "Radar AFTER (mean of the recent passes)", "radar_before": "Radar BEFORE (mean of the earlier passes)",
                  "radar_change": "Radar CHANGE (red brighter now, blue darker now)", "optical": "OPTICAL (Sentinel-2, true colour)"}


def preview(g: dict, zone_id: str) -> dict:
    """What a run would cost, and whether it is already answered (free)."""
    import openai_gate
    model = openai_gate.model_for(openai_gate.ENRICH)
    key = cache_key(zone_id, g["finding"], g["images"])
    hit = cached(key)
    st = openai_gate.status()
    return {"status": "ready" if hit else "none", "assessment": hit, "estimate_usd": estimate_usd(len(g["images"]), model),
            "model": model, "images": sorted(g["images"]), "enabled": openai_gate.is_enabled(openai_gate.ENRICH) and st["configured"],
            "over_budget": st["over_budget"], "remaining_usd": st["remaining_usd"]}


class AssessRefused(Exception):
    """Not run: the purpose is off, no key, the budget, nothing to look at."""


def run(g: dict, zone_id: str, *, client_factory=None) -> dict:
    """Ask the model (or answer from the cache). Raises AssessRefused."""
    import openai_gate
    model = openai_gate.model_for(openai_gate.ENRICH)
    key = cache_key(zone_id, g["finding"], g["images"])
    hit = cached(key)
    if hit:
        return {**hit, "cached": True}
    if not g["images"]:
        raise AssessRefused("No image of this finding is held, so there is nothing to look at.")
    est = estimate_usd(len(g["images"]), model)
    cap = openai_gate.budget_usd()
    if cap > 0 and openai_gate.spent_this_month() + est > cap:
        raise AssessRefused(f"This month's AI budget (${cap:.2f}) is spent; the assessment would cost about ${est:.4f}.")
    client = (client_factory or openai_gate.get_client)(openai_gate.ENRICH)
    if client is None:
        raise AssessRefused("The AI assessment is not available here (no OpenAI key, the purpose is off, or the budget is spent).")
    content = [{"type": "text", "text": "Facts measured by the system:\n" + g["facts"] + "\n\nThe images follow, each captioned."}]
    for name in ("radar_after", "radar_before", "radar_change", "optical"):
        if name in g["images"]:
            content.append({"type": "text", "text": IMAGE_CAPTIONS[name]})
            content.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{g['images'][name]}", "detail": "low"}})
    resp = client.chat.completions.create(
        model=model, temperature=0, max_tokens=700, response_format={"type": "json_object"},
        messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": content}])
    try:
        raw = json.loads(resp.choices[0].message.content or "{}")
    except (ValueError, TypeError):
        raw = {}
    usage = getattr(resp, "usage", None)
    tin, tout = int(getattr(usage, "prompt_tokens", 0) or 0), int(getattr(usage, "completion_tokens", 0) or 0)
    pin, pout = openai_gate.price_for(model)
    cost = round(tin * pin + tout * pout, 6)
    try:
        import usage_tracker
        usage_tracker.record_call(input_tokens=tin, output_tokens=tout, call_type="assess", model=model,
                                  headline=f"finding assessment {zone_id} {g['finding'].get('id')}", item_id=g["finding"].get("id") or "")
    except Exception:                                            # noqa: BLE001
        logger.warning("[assess] usage not recorded", exc_info=True)
    logger.info("[assess] %s %s: %s tokens in, %s out, $%.5f", zone_id, g["finding"].get("id"), tin, tout, cost)
    rec = {**normalise_verdict(raw), "finding_id": g["finding"].get("id"), "zone_id": zone_id, "model": model,
           "images": sorted(g["images"]), "tokens_in": tin, "tokens_out": tout, "cost_usd": cost,
           "assessed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "prompt_version": PROMPT_VERSION,
           "label": "AI assessment — a second opinion, not evidence"}
    _store(key, rec)
    return {**rec, "cached": False}
