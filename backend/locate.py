"""
locate.py — where a piece of footage was filmed: the model reads, the code places.

The owner's case (2026-10-06): a video from Yemen or Mali, the country known,
the spot not — find where it was filmed, then use the shadows for the time
and the vehicles for their direction. The time and the direction are
geometry and live in the browser (src/locate/locateMath.js); this is the
first step, the place.

The vision model looks at one frame and the post's own words and reports
what it can READ — sign and shop text, a mosque's minaret style, a road
number, the terrain, a river, a ridge line — and the places those point to.
The code then resolves each named place with the geocoder, only inside the
country the post is about, and drops what does not resolve: a model's
coordinates are never used, and a place outside the country is never
offered. What reaches the analyst is a short list of real places to compare
against satellite imagery, each with the clue that suggested it.

Runs on the stronger vision model (LOCATE_MODEL, default gpt-4o) through
openai_gate under the monthly cap: one call per click by an analyst, about
a cent, never in the background. Cached by frame and text.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import threading

import openai_gate

LOCATE_MODEL = os.getenv("OPENAI_LOCATE_MODEL", "gpt-4o")
MAX_CANDIDATES = 6
_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "locate_suggestions.json")
_LOCK = threading.Lock()

SYSTEM = """You help an intelligence analyst find where a photo or video frame was taken.
You get one frame, the text of the post it came with, the country it is about, and the place the post names (if any).

Report only what you can actually see or read:
- clues: up to 8, each {"kind": one of "text" (signs, shop names, plates, graffiti — transcribe it, give the language),
  "landmark" (a named or distinctive building, monument, bridge, mosque, tower), "terrain" (mountains, wadi, dunes,
  river, coast, vegetation), "built" (architecture, road type, power lines, density), "other",
  "detail": what it is, "points_to": a place it suggests or null}
- candidates: up to 6 real places where this could have been filmed, most likely first, each
  {"place": "Name, Region, Country" as a geocoder would find it (a town, village, district, road, or named site),
   "why": the clue(s) that point there, "confidence": 0..1}
  Stay inside the country given. Prefer places near the place the post names when the scene fits it.
  If nothing points anywhere specific, return the post's named place alone with a low confidence, or no candidates.
- setting: one short phrase ("urban street, dense 2-3 storey concrete", "open desert track", "mountain road").
- shadows: one short phrase on what the shadows show ("long shadows to the left", "sun high, short shadows",
  "overcast, no shadows").
Never invent text you cannot read. Never give coordinates.
Answer as JSON: {"clues": [...], "candidates": [...], "setting": "...", "shadows": "..."}"""


def _load() -> dict:
    try:
        with open(_PATH, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def _store(key: str, value: dict) -> None:
    with _LOCK:
        cache = _load()
        cache[key] = value
        tmp = _PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(cache, fh)
        os.replace(tmp, _PATH)


def km(a_lat, a_lon, b_lat, b_lon) -> float:
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b_lon - a_lon) / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def resolve(candidates: list[dict], country_code: str | None, near: dict | None, geocode) -> list[dict]:
    """The model's place names -> geocoded places inside the country, each
    once, with distance from the post's named place. `geocode(q, cc)` returns
    geocoder hits [{lat, lon, display_name, country_code}]."""
    cc = (country_code or "").lower() or None
    out, seen = [], set()
    for c in candidates[:MAX_CANDIDATES]:
        name = str(c.get("place") or "").strip()
        if not name:
            continue
        parts = [p.strip() for p in name.split(",") if p.strip()]
        tries = [name] + ([f"{parts[0]}, {parts[-1]}"] if len(parts) > 2 else [])
        hit = None
        for q in tries:
            hits = [h for h in (geocode(q, cc) or [])
                    if not cc or (h.get("country_code") or "").lower() == cc]
            if hits:
                hit = hits[0]
                break
        if not hit:
            continue
        lat, lon = float(hit["lat"]), float(hit["lon"])
        key = (round(lat, 3), round(lon, 3))
        if key in seen:
            continue
        seen.add(key)
        conf = c.get("confidence")
        out.append({
            "place": name, "resolved_as": hit.get("display_name") or name, "lat": lat, "lon": lon,
            "why": str(c.get("why") or "")[:300],
            "confidence": round(float(conf), 2) if isinstance(conf, (int, float)) else None,
            "km_from_post": round(km(near["lat"], near["lon"], lat, lon), 1)
                            if near and near.get("lat") is not None and near.get("lon") is not None else None,
        })
    return out


def _geocode(q: str, cc: str | None) -> list[dict]:
    from geocode_utils import geocode_place, prefer_settlement
    return prefer_settlement(geocode_place(q, expected_country_codes=[cc] if cc else None))


def suggest(image_b64: str, text: str = "", country_code: str | None = None,
            place: str | None = None, near: dict | None = None) -> dict:
    """{clues, candidates (resolved), setting, shadows, model} or {error}."""
    if not image_b64:
        return {"error": "no frame"}
    key = hashlib.sha1((image_b64[:200000] + "|" + (text or "")[:2000] + "|" + (country_code or "")).encode()).hexdigest()
    hit = _load().get(key)
    if hit:
        return hit
    client = openai_gate.get_client(openai_gate.ENRICH)
    if client is None:
        return {"error": "the model is unavailable (no key, or the monthly cap is reached)"}
    try:
        from location_extract import country_name_from_code
        country = country_name_from_code(country_code or "") or country_code
    except Exception:                                        # noqa: BLE001
        country = country_code
    prompt = (f"Country: {country or 'unknown'}\nPlace the post names: {place or 'none'}\n"
              f"Post text:\n{(text or '')[:1500]}")
    mime = "image/png" if image_b64.startswith("iVBOR") else "image/jpeg"
    try:
        resp = client.chat.completions.create(
            model=LOCATE_MODEL, temperature=0, max_tokens=1200, response_format={"type": "json_object"},
            messages=[{"role": "system", "content": SYSTEM},
                      {"role": "user", "content": [
                          {"type": "text", "text": prompt},
                          {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_b64}", "detail": "high"}},
                      ]}])
    except Exception as e:                                   # noqa: BLE001
        return {"error": f"{type(e).__name__}: {str(e)[:200]}"}
    usage = getattr(resp, "usage", None)
    if usage:
        try:
            import usage_tracker
            usage_tracker.record_call(input_tokens=usage.prompt_tokens, output_tokens=usage.completion_tokens,
                                      call_type="enrich", model=LOCATE_MODEL, headline=f"locate {place or country or ''}")
        except Exception:                                    # noqa: BLE001
            pass
    try:
        raw = json.loads(resp.choices[0].message.content or "{}")
    except ValueError:
        return {"error": "unreadable answer"}
    clues = [{"kind": str(c.get("kind") or "other"), "detail": str(c.get("detail") or "")[:240],
              "points_to": c.get("points_to") if isinstance(c.get("points_to"), str) else None}
             for c in (raw.get("clues") or []) if isinstance(c, dict) and c.get("detail")][:8]
    cands = [c for c in (raw.get("candidates") or []) if isinstance(c, dict)]
    out = {
        "clues": clues,
        "candidates": resolve(cands, country_code, near, _geocode),
        "unresolved": [str(c.get("place")) for c in cands if c.get("place")][:MAX_CANDIDATES],
        "setting": raw.get("setting") if isinstance(raw.get("setting"), str) else None,
        "shadows": raw.get("shadows") if isinstance(raw.get("shadows"), str) else None,
        "model": LOCATE_MODEL,
    }
    resolved = {c["place"] for c in out["candidates"]}
    out["unresolved"] = [p for p in out["unresolved"] if p not in resolved]
    _store(key, out)
    return out
