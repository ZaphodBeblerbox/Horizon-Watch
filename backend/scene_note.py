"""
scene_note.py — what a satellite pass shows, in words.

The detector says "15 storage tank · 2 vessel"; an analyst says "the tank
farm south of the port is unchanged, two ships are alongside the container
quay, one fewer than on 29 Sep". That second sentence is what the Imagery
page leads with, and it is written here, once per acquisition, by the cheap
vision model (openai_gate ENRICH): the scene image at native resolution, the
detector's list with sizes and positions, and the counts against the
previous acquisition.

The model may also flag detections that do not look like what the detector
says (a "vessel" on a hillside). It does not add detections and does not
change counts — the detector is the measurement, the note is the reading.
Cached in data/scene_notes.json by scan id; a scene's pixels never change.
"""
from __future__ import annotations

import json
import os
import threading

from paths import data_path as _data_path
_PATH = str(_data_path("scene_notes.json"))
_LOCK = threading.Lock()
_PENDING: set[str] = set()

SYSTEM = """You are an imagery analyst writing for an intelligence console.
You get one satellite scene (Sentinel-2 optical at 10 m per pixel, or Sentinel-1 radar), the name of the watched area,
the automatic detector's findings (id, class, confidence, size, position in the frame as x,y from the top-left, and
whether each is new, existing or removed against the previous pass), and the per-class counts against the previous pass.

Write:
- summary: two or three plain sentences on what this pass shows that matters, judged against why this area
  matters now and what to look for there (say plainly whether any of those things are visible or not): where activity is (name parts of the
  scene by what they are: "the container quay", "the tank farm south of the port", "the anchorage offshore"),
  and what changed since the previous pass. Use only the counts given; never invent numbers.
- notable: up to 4 detections worth an analyst's look, as {"id": "...", "note": "short reason"}.
- doubtful: ids of detections that do not look like their class in the image (e.g. a vessel on land, a tank that
  is a roundabout). Only when clearly wrong.
- cloud_or_quality: one short sentence if clouds, haze, or no-data areas limit what can be seen, else null.
Answer as JSON: {"summary": "...", "notable": [...], "doubtful": [...], "cloud_or_quality": null}"""


def _load() -> dict:
    try:
        with open(_PATH, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def _store(scan_id: str, note: dict) -> None:
    with _LOCK:
        cache = _load()
        cache[scan_id] = note
        tmp = _PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(cache, fh)
        os.replace(tmp, _PATH)


def cached(scan_id: str) -> dict | None:
    return _load().get(scan_id)


def describe_detections(changes: list[dict]) -> str:
    lines = []
    for c in changes[:80]:
        bx = c.get("bbox") or [0, 0, 0, 0]
        size = ""
        if c.get("length_m"):
            size = f", {round(c['length_m'])}x{round(c.get('width_m') or 0)} m"
        lines.append(f"{c['id']}: {str(c.get('label', '')).replace('_', ' ')} {round((c.get('conf') or 0) * 100)}%"
                     f"{size}, at x={bx[0] + bx[2] / 2:.2f} y={bx[1] + bx[3] / 2:.2f}, {c.get('type')}")
    return "\n".join(lines) or "(no detections)"


def write(scan_id: str, *, zone_name: str, instrument: str, when: str | None, image_b64: str,
          changes: list[dict], counts: list, reference_date: str | None,
          context: dict | None = None) -> dict | None:
    import openai_gate
    client = openai_gate.get_client(openai_gate.ENRICH)
    if client is None or not image_b64:
        return None
    count_line = "; ".join(f"{str(l).replace('_', ' ')}: {n} ({'+' if d > 0 else ''}{d})" for l, n, d in counts) or "none"
    ctx = ""
    if context and (context.get("situation") or context.get("watch_for")):
        ctx = (f"Why this area matters now: {context.get('situation') or ''}\n"
               f"Look especially for: {'; '.join(context.get('watch_for') or [])}\n")
    text = (f"Area: {zone_name}\n{ctx}Sensor: {instrument}\nAcquired: {when or 'unknown'}\n"
            f"Previous pass: {reference_date or 'none — this is the first'}\n"
            f"Counts now (change vs previous): {count_line}\n\nDetections:\n{describe_detections(changes)}")
    model = openai_gate.model_for(openai_gate.ENRICH)
    try:
        resp = client.chat.completions.create(
            model=model, temperature=0, max_tokens=700, response_format={"type": "json_object"},
            messages=[{"role": "system", "content": SYSTEM},
                      {"role": "user", "content": [
                          {"type": "text", "text": text},
                          {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_b64}", "detail": "high"}},
                      ]}])
    except Exception as e:                                   # noqa: BLE001
        print(f"[scene_note] {scan_id}: {type(e).__name__}: {str(e)[:200]}", flush=True)
        return None
    usage = getattr(resp, "usage", None)
    if usage:
        try:
            import usage_tracker
            usage_tracker.record_call(input_tokens=usage.prompt_tokens, output_tokens=usage.completion_tokens,
                                      call_type="enrich", model=model, headline=f"scene note {zone_name}")
        except Exception:                                    # noqa: BLE001
            pass
    try:
        out = json.loads(resp.choices[0].message.content or "{}")
    except ValueError:
        return None
    ids = {c["id"] for c in changes}
    note = {
        "summary": str(out.get("summary") or "").strip()[:900] or None,
        "notable": [n for n in (out.get("notable") or []) if isinstance(n, dict) and n.get("id") in ids][:4],
        "doubtful": [i for i in (out.get("doubtful") or []) if i in ids],
        "quality": out.get("cloud_or_quality") if isinstance(out.get("cloud_or_quality"), str) else None,
        "model": model,
    }
    _store(scan_id, note)
    return note


def request(scan_id: str, **kw) -> None:
    """Write the note in the background, once."""
    if scan_id in _PENDING or cached(scan_id):
        return
    _PENDING.add(scan_id)

    def run():
        try:
            write(scan_id, **kw)
        finally:
            _PENDING.discard(scan_id)
    threading.Thread(target=run, daemon=True, name=f"scene-note-{scan_id[:8]}").start()


def pending(scan_id: str) -> bool:
    return scan_id in _PENDING
