"""
zone_context.py — what to look for in a watched area, given where it is.

The same pass means different things in different places. At Khor Fakkan,
on the Gulf of Oman with Houthi strikes on Gulf energy sites in the news,
what matters is tankers loitering offshore, damage or fire scars at the tank
farm, naval vessels, and the port emptying. At Rotterdam it is congestion
and an unusual vessel. So each area gets a short profile:

    situation  — one or two sentences on why this place matters now
    watch_for  — 3-6 concrete things an imagery analyst should look for here

written by the cheap model (openai_gate ENRICH) from the area's name, class
and position, and from what the console knows about its surroundings: the
relevant signals within 150 km (local) and 1200 km (regional) in the last week, satellite fire detections
within 25 km, and the vessels in the area now. The profile is cached for 12
hours per area (data/zone_context.json) and is passed to the imagery note,
which reads each pass against it.
"""
from __future__ import annotations

import json
import os
import threading
import time

_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "zone_context.json")
_LOCK = threading.Lock()
_PENDING: set[str] = set()
TTL_S = 12 * 3600

SYSTEM = """You brief an imagery analyst on a watched area before they look at a satellite pass.
You get the area (name, class, position), and what is happening around it: recent security signals nearby,
satellite fire detections, and vessel traffic now. Write:
- situation: one or two plain sentences on why this place matters now, naming the conflict or activity
  around it if there is one — locally, or in the region it belongs to (a port within reach of a war's
  missiles, on a route the war threatens, or serving one side, matters because of that war). If nothing notable is going on, say what the place normally is and does.
- watch_for: 3 to 6 concrete, visible things to look for in 10 m satellite imagery of THIS place given the
  situation (e.g. "fire scars or blackened tanks at the tank farm south of the port", "tankers holding
  at anchor offshore instead of berthing", "warships alongside the naval pier"). Each under 15 words.
- kind: what the place mainly is, exactly one of: naval_base, airbase, oil_terminal, energy_site,
  commercial_port, other. An oil export terminal or tank farm port is oil_terminal; a refinery, power
  station, gas plant or oil field is energy_site; a container or general cargo port is commercial_port.
Answer as JSON: {"situation": "...", "watch_for": ["...", "..."], "kind": "..."}"""


def _load() -> dict:
    try:
        with open(_PATH, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def cached(system_id: str, fresh_only: bool = False) -> dict | None:
    rec = _load().get(system_id)
    if rec and fresh_only and time.time() - rec.get("at", 0) > TTL_S:
        return None
    return rec


def _store(system_id: str, rec: dict) -> None:
    with _LOCK:
        cache = _load()
        cache[system_id] = rec
        tmp = _PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(cache, fh)
        os.replace(tmp, _PATH)


def write(system_id: str, *, name: str, aoi_class: str, lat: float, lon: float, surroundings: dict) -> dict | None:
    import openai_gate
    client = openai_gate.get_client(openai_gate.ENRICH)
    if client is None:
        return None
    sig = "\n".join(f"- [{s.get('ring', 'local')}] {s['headline']} ({s['km']} km away, {str(s.get('published_at') or '')[:10]})"
                    for s in surroundings.get("signals", [])[:22]) or "- none in the last week"
    text = (f"Area: {name} ({aoi_class}) at {lat:.3f}, {lon:.3f}\n"
            f"Satellite fire detections within 25 km, last 14 days: {surroundings.get('fires', 0)}\n"
            f"Vessels in or near the area now (AIS): {surroundings.get('vessels_now', 0)}\n"
            f"Security signals, last 7 days (local = within 150 km, regional = within 1200 km):\n{sig}")
    model = openai_gate.model_for(openai_gate.ENRICH)
    try:
        resp = client.chat.completions.create(
            model=model, temperature=0, max_tokens=500, response_format={"type": "json_object"},
            messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": text}])
        out = json.loads(resp.choices[0].message.content or "{}")
    except Exception as e:                                   # noqa: BLE001
        print(f"[zone_context] {system_id}: {type(e).__name__}: {str(e)[:200]}", flush=True)
        return None
    usage = getattr(resp, "usage", None)
    if usage:
        try:
            import usage_tracker
            usage_tracker.record_call(input_tokens=usage.prompt_tokens, output_tokens=usage.completion_tokens,
                                      call_type="enrich", model=model, headline=f"zone context {name}")
        except Exception:                                    # noqa: BLE001
            pass
    rec = {
        "situation": str(out.get("situation") or "").strip()[:600] or None,
        "watch_for": [str(w).strip()[:140] for w in (out.get("watch_for") or []) if str(w).strip()][:6],
        "kind": out.get("kind") if out.get("kind") in ("naval_base", "airbase", "oil_terminal", "energy_site",
                                                       "commercial_port", "other") else "other",
        "surroundings": surroundings, "at": time.time(), "model": model,
    }
    _store(system_id, rec)
    return rec


def request(system_id: str, **kw) -> None:
    if system_id in _PENDING:
        return
    _PENDING.add(system_id)

    def run():
        try:
            write(system_id, **kw)
        finally:
            _PENDING.discard(system_id)
    threading.Thread(target=run, daemon=True, name=f"zone-context-{system_id}").start()


def kind_for(zone: dict) -> tuple[str, str]:
    """(kind, where it came from): the analyst's choice, else the model's."""
    meta = zone.get("metadata") or {}
    if meta.get("kind"):
        return meta["kind"], "set by you"
    rec = cached(zone.get("system_id") or "")
    if rec and rec.get("kind"):
        return rec["kind"], "proposed from the area's context"
    return "other", "not yet known"


def pending(system_id: str) -> bool:
    return system_id in _PENDING
