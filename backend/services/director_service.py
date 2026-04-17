"""director_service.py — Cinematic intelligence briefing director.

Generates an ordered action sequence for Director Mode: a choreographed
map briefing that pans, zooms, shows individual data points, highlights
events, draws annotations, and delivers analyst narration driven by live
intelligence data.
"""
from __future__ import annotations

import json
import logging
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent.parent
DIRECTOR_DIR = BASE_DIR / "documents" / "director-briefings"


# ── Tolerant JSON parser ───────────────────────────────────────────────────────

def _parse_claude_json_tolerant(text: str) -> list:
    """Parse Claude's JSON response, handling trailing commas and markdown fences."""

    # Strip markdown fences
    code_block = re.search(r'```(?:json)?\s*(\[.*?\])\s*```', text, re.DOTALL)
    if code_block:
        text = code_block.group(1)

    text = text.strip()

    # Ensure we start at the array
    if not text.startswith('['):
        start = text.find('[')
        if start == -1:
            raise ValueError("No JSON array found in response")
        text = text[start:]

    # Trim to last ]
    if not text.endswith(']'):
        end = text.rfind(']')
        if end != -1:
            text = text[:end + 1]

    # Try strict parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        logger.warning("[DIRECTOR] Strict JSON parse failed: %s. Trying tolerant parse.", e)

    # Remove trailing commas before } or ]
    cleaned = re.sub(r',(\s*[}\]])', r'\1', text)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as e:
        logger.warning("[DIRECTOR] Comma-fix parse failed: %s", e)

    # Try json5 if available
    try:
        import json5  # type: ignore
        return json5.loads(cleaned)
    except (ImportError, Exception) as e:
        logger.warning("[DIRECTOR] json5 not available or failed: %s", e)

    # Last resort: parse action objects one by one
    logger.warning("[DIRECTOR] Attempting per-action recovery parse")
    actions = []
    depth = 0
    current_start = None
    for i, ch in enumerate(cleaned):
        if ch == '{':
            if depth == 0:
                current_start = i
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0 and current_start is not None:
                obj_text = re.sub(r',(\s*[}\]])', r'\1', cleaned[current_start:i + 1])
                try:
                    actions.append(json.loads(obj_text))
                except json.JSONDecodeError:
                    logger.warning("[DIRECTOR] Skipping malformed action: %s", obj_text[:100])
                current_start = None

    if actions:
        logger.info("[DIRECTOR] Recovered %d actions via per-action parse", len(actions))
        return actions

    raise ValueError(f"Could not parse JSON from Claude response: {text[:200]}")


# ── Snapshot helpers ───────────────────────────────────────────────────────────

def build_snapshot(
    surface_pool: list,
    ais_vessels: dict,
    adsb_cache_latest: list,
    event_store_fn,      # callable: get_active_events(min_severity="elevated", limit=10)
    active_profile: dict | None,
    static_airports: list | None = None,
    static_ports: list | None = None,
) -> dict:
    """Build a raw intelligence snapshot for the Director prompt.

    Claude receives raw headlines and decides what is relevant,
    geocodes events himself, and builds the entire scene.
    """

    # ── Raw intelligence: ALL surface items — Claude decides relevance ───────
    # Include everything so Claude can filter, not us.
    raw_intel = []
    seen_titles: set[str] = set()
    for item in (surface_pool or [])[:100]:
        title = (item.get("headline") or item.get("title") or "").strip()
        if not title or title in seen_titles:
            continue
        seen_titles.add(title)
        raw_intel.append({
            "title":     title[:150],
            "source":    (item.get("source") or item.get("source_name") or "")[:60],
            "location":  (item.get("location") or item.get("location_name") or "")[:80],
            "timestamp": (item.get("published_at") or item.get("published") or "")[:16],
            "type":      item.get("type") or item.get("event_type") or "general",
            "severity":  item.get("severity_tier") or "elevated",
            "summary":   (item.get("summary") or item.get("description") or "")[:200],
        })

    # Also pull from event_store_fn
    try:
        store_events = event_store_fn(min_severity="elevated", max_age_hours=48, limit=40)
        for ev in store_events:
            title = (ev.get("clean_title") or ev.get("title") or "").strip()
            if not title or title in seen_titles:
                continue
            seen_titles.add(title)
            raw_intel.append({
                "title":     title[:150],
                "source":    (ev.get("source") or "")[:60],
                "location":  (ev.get("location") or "")[:80],
                "timestamp": (ev.get("published") or "")[:16],
                "type":      ev.get("event_type") or "general",
                "severity":  ev.get("severity_tier") or "elevated",
                "summary":   (ev.get("summary") or "")[:200],
            })
    except Exception:
        pass

    # Sort newest first, cap at 100
    raw_intel = raw_intel[:100]

    # ── AIS vessels — up to 40 notable (military/tanker priority) ───────────
    vessel_list = []
    _raw_vessels = list(ais_vessels.items())[:2000]
    for mmsi, v in _raw_vessels:
        if len(vessel_list) >= 40:
            break
        vessel_list.append({
            "mmsi":      mmsi,
            "name":      v.get("name", "unknown"),
            "ship_type": v.get("ship_type_label") or "other",
            "lat":       v.get("lat"),
            "lon":       v.get("lon"),
            "speed":     v.get("speed"),
            "heading":   v.get("heading"),
            "flag":      v.get("flag") or v.get("country") or "",
            "dest":      v.get("destination") or "",
        })
    # Sort: military first (type code 35-36), then tankers (80-89), cargo (70-79)
    _code_map = {mmsi: v.get("ship_type_code", 0) for mmsi, v in _raw_vessels[:2000]}
    def _vpri(v):
        c = _code_map.get(v["mmsi"], 0)
        if 35 <= c <= 36: return 0
        if 80 <= c <= 89: return 1
        if 70 <= c <= 79: return 2
        return 3
    vessel_list.sort(key=_vpri)

    # ── ADS-B aircraft — up to 30 (military priority) ────────────────────────
    aircraft_list = []
    for ac in adsb_cache_latest[:200]:
        if len(aircraft_list) >= 30:
            break
        db_flags = int(ac.get("dbFlags") or 0)
        is_mil   = bool(db_flags & 1)
        cat_raw  = ac.get("category") or ""
        cat = "military" if is_mil else ("commercial" if cat_raw.startswith("A") else ("helicopter" if cat_raw.startswith("B") else "general"))
        aircraft_list.append({
            "icao24":    ac.get("hex") or ac.get("icao") or "",
            "callsign":  (ac.get("flight") or "").strip(),
            "type":      ac.get("t") or ac.get("desc") or "",
            "airline":   ac.get("ownOp") or "",
            "lat":       ac.get("lat"),
            "lon":       ac.get("lon"),
            "altitude":  ac.get("alt_baro"),
            "speed":     ac.get("gs"),
            "category":  cat,
        })
    aircraft_list.sort(key=lambda a: 0 if a["category"] == "military" else 1)

    # ── Chokepoints — all with coordinates for reference ─────────────────────
    CHOKEPOINT_LIST = [
        {"name": "Strait of Hormuz",          "lat": 26.5,  "lon": 56.4},
        {"name": "Bab el-Mandeb",             "lat": 12.6,  "lon": 43.4},
        {"name": "Suez Canal",                "lat": 30.5,  "lon": 32.4},
        {"name": "Mozambique Channel",        "lat": -18.0, "lon": 40.5},
        {"name": "Cape of Good Hope",         "lat": -34.4, "lon": 18.5},
        {"name": "Strait of Gibraltar",       "lat": 35.9,  "lon": -5.6},
        {"name": "Turkish Straits",           "lat": 41.1,  "lon": 29.0},
        {"name": "English Channel",           "lat": 50.5,  "lon": 0.8},
        {"name": "Oresund",                   "lat": 55.8,  "lon": 12.7},
        {"name": "Strait of Malacca",         "lat": 3.0,   "lon": 103.5},
        {"name": "Taiwan Strait",             "lat": 23.5,  "lon": 120.2},
        {"name": "Korea Strait",              "lat": 34.5,  "lon": 129.5},
        {"name": "Panama Canal",              "lat": 9.0,   "lon": -79.7},
    ]

    # ── Infrastructure — filter to focus regions, cap 40 ─────────────────────
    infrastructure: list[dict] = []
    focus_regions: list[str] = []
    if active_profile:
        focus_regions = active_profile.get("focusRegions") or []

    REGION_BBOX: dict[str, tuple[float, float, float, float]] = {
        "Middle East":       (12.0, 34.0, 42.0, 63.0),
        "East Africa":       (-12.0, 28.0, 22.0, 52.0),
        "South Asia":        (5.0, 60.0, 38.0, 97.0),
        "Southeast Asia":    (-10.0, 95.0, 28.0, 140.0),
        "Eastern Europe":    (35.0, 14.0, 72.0, 45.0),
        "North Africa":      (15.0, -18.0, 38.0, 55.0),
        "West Africa":       (-5.0, -20.0, 20.0, 20.0),
        "East Asia":         (18.0, 95.0, 55.0, 145.0),
        "Central Asia":      (35.0, 47.0, 58.0, 90.0),
        "Europe":            (35.0, -25.0, 72.0, 45.0),
        "Americas":          (-56.0, -130.0, 72.0, -30.0),
        "Global":            (-90.0, -180.0, 90.0, 180.0),
    }

    def _in_bbox(lat, lon, bbox):
        min_lat, min_lon, max_lat, max_lon = bbox
        return min_lat <= lat <= max_lat and min_lon <= lon <= max_lon

    def _in_focus(lat, lon):
        if not focus_regions or "Global" in focus_regions:
            return True
        for reg in focus_regions:
            bbox = REGION_BBOX.get(reg)
            if bbox and _in_bbox(lat, lon, bbox):
                return True
        return False

    added_ids: set[str] = set()

    # Major international airports
    if static_airports:
        for apt in static_airports:
            if len(infrastructure) >= 40:
                break
            atype = (apt.get("type") or "").lower()
            if atype not in ("large_airport", "military"):
                continue
            lat = apt.get("lat") or apt.get("latitude_deg")
            lon = apt.get("lon") or apt.get("longitude_deg")
            if not lat or not lon:
                continue
            try:
                lat, lon = float(lat), float(lon)
            except (TypeError, ValueError):
                continue
            if not _in_focus(lat, lon):
                continue
            apt_id = apt.get("id") or f"apt_{apt.get('ident','')}"
            if apt_id in added_ids:
                continue
            added_ids.add(apt_id)
            infrastructure.append({
                "id":   apt_id,
                "name": apt.get("name") or apt.get("ident") or "",
                "type": "airport",
                "lat":  lat,
                "lon":  lon,
            })

    # Major ports
    if static_ports:
        for port in static_ports:
            if len(infrastructure) >= 50:
                break
            lat = port.get("lat")
            lon = port.get("lon")
            if not lat or not lon:
                continue
            try:
                lat, lon = float(lat), float(lon)
            except (TypeError, ValueError):
                continue
            if not _in_focus(lat, lon):
                continue
            port_id = port.get("id") or f"port_{port.get('name','').replace(' ','_')}"
            if port_id in added_ids:
                continue
            added_ids.add(port_id)
            infrastructure.append({
                "id":   port_id,
                "name": port.get("name") or "",
                "type": "port",
                "lat":  lat,
                "lon":  lon,
            })

    infrastructure = infrastructure[:40]

    # ── Mission profile ───────────────────────────────────────────────────────
    profile_summary: dict = {}
    if active_profile:
        profile_summary = {
            "focusRegions":  active_profile.get("focusRegions") or [],
            "missionContext": (active_profile.get("missionContext") or "")[:300],
            "threatLevel":   active_profile.get("threatLevel") or "medium",
        }

    # ── Available country names (subset most relevant to intel analysis) ─────
    _COUNTRY_NAMES = [
        "Afghanistan","Albania","Algeria","Angola","Argentina","Armenia","Australia",
        "Austria","Azerbaijan","Bahrain","Bangladesh","Belarus","Belgium","Benin",
        "Bosnia and Herzegovina","Brazil","Bulgaria","Burkina Faso","Burundi",
        "Cambodia","Cameroon","Canada","Central African Republic","Chad","Chile",
        "China","Colombia","Republic of the Congo","Democratic Republic of the Congo",
        "Croatia","Cuba","Cyprus","Czech Republic","Denmark","Djibouti","Ecuador",
        "Egypt","El Salvador","Eritrea","Estonia","Ethiopia","Finland","France",
        "Gabon","Georgia","Germany","Ghana","Greece","Guatemala","Guinea",
        "Haiti","Honduras","Hungary","India","Indonesia","Iran","Iraq","Ireland",
        "Israel","Italy","Ivory Coast","Japan","Jordan","Kazakhstan","Kenya",
        "Kosovo","Kuwait","Kyrgyzstan","Laos","Latvia","Lebanon","Libya",
        "Lithuania","Luxembourg","Malaysia","Mali","Malta","Mauritania","Mexico",
        "Moldova","Mongolia","Montenegro","Morocco","Mozambique","Myanmar",
        "Namibia","Nepal","Netherlands","New Zealand","Nicaragua","Niger","Nigeria",
        "North Korea","Norway","Oman","Pakistan","Palestine","Panama","Peru",
        "Philippines","Poland","Portugal","Qatar","Romania","Russia","Rwanda",
        "Saudi Arabia","Senegal","Serbia","Sierra Leone","Slovakia","Slovenia",
        "Somalia","South Africa","South Korea","South Sudan","Spain","Sri Lanka",
        "Sudan","Sweden","Switzerland","Syria","Taiwan","Tajikistan","Tanzania",
        "Thailand","Tunisia","Turkey","Turkmenistan","Uganda","Ukraine",
        "United Arab Emirates","United Kingdom","United States","Uzbekistan",
        "Venezuela","Vietnam","Yemen","Zambia","Zimbabwe",
    ]

    snapshot = {
        "mission_profile":     profile_summary,
        "raw_intelligence":    raw_intel,
        "vessels":             vessel_list,
        "aircraft":            aircraft_list,
        "chokepoints":         CHOKEPOINT_LIST,
        "infrastructure":      infrastructure,
        "available_countries": _COUNTRY_NAMES,
        "generated_at":        datetime.now(timezone.utc).isoformat(),
    }

    # ── Token budget guard: keep under ~6000 tokens serialised ───────────────
    snapshot_str = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))
    if len(snapshot_str) > 18000:   # rough 6000 token estimate
        snapshot["raw_intelligence"] = snapshot["raw_intelligence"][:15]
        snapshot["vessels"] = snapshot["vessels"][:25]
        snapshot["aircraft"] = snapshot["aircraft"][:15]
        snapshot["infrastructure"] = snapshot["infrastructure"][:25]
        snapshot["available_countries"] = snapshot["available_countries"][:80]

    return snapshot


# ── Action validation ──────────────────────────────────────────────────────────

_ENTITY_COUNTRY_LIST = [
    "Russia", "Ukraine", "Iran", "Israel", "United States", "China", "Turkey",
    "Syria", "Lebanon", "Yemen", "Saudi Arabia", "UAE", "United Arab Emirates",
    "India", "Pakistan", "North Korea", "South Korea", "Japan", "Germany",
    "France", "United Kingdom", "Poland", "Belarus", "Iraq", "Egypt",
    "Libya", "Sudan", "Ethiopia", "Somalia", "Nigeria", "South Africa",
    "Venezuela", "Cuba", "Taiwan", "Philippines", "Indonesia", "Myanmar",
    "Afghanistan", "Kazakhstan", "Azerbaijan", "Armenia", "Georgia",
]


def _validate_entities_shown(actions: list[dict]) -> list[str]:
    """Heuristic check: narrate actions shouldn't mention countries not yet highlighted."""
    shown_countries: set[str] = set()
    warnings: list[str] = []
    for idx, action in enumerate(actions):
        act = action.get("action")
        if act == "highlight_country":
            shown_countries.add(action.get("name", "").lower())
        elif act in ("unhighlight_country", "clear_country_highlights"):
            if act == "clear_country_highlights":
                shown_countries.clear()
            else:
                shown_countries.discard(action.get("name", "").lower())
        elif act == "narrate":
            text = action.get("text", "").lower()
            for country in _ENTITY_COUNTRY_LIST:
                if country.lower() in text and country.lower() not in shown_countries:
                    warnings.append(
                        f"narrate[{idx}] mentions '{country}' but country not highlighted"
                    )
    return warnings


def _auto_inject_missing_highlights(actions: list[dict]) -> list[dict]:
    """Safety net — if a narrate mentions a country not yet highlighted, inject highlight before it."""
    highlighted: set[str] = set()
    result: list[dict] = []
    for action in actions:
        act = action.get("action")
        if act == "highlight_country":
            highlighted.add(action.get("name", ""))
            result.append(action)
        elif act == "unhighlight_country":
            highlighted.discard(action.get("name", ""))
            result.append(action)
        elif act == "clear_country_highlights":
            highlighted.clear()
            result.append(action)
        elif act == "narrate":
            text = action.get("text", "")
            missing = [c for c in _ENTITY_COUNTRY_LIST if c in text and c not in highlighted]
            for country in missing:
                result.append({
                    "action": "highlight_country",
                    "name": country,
                    "context": "neutral",
                    "label": country,
                })
                highlighted.add(country)
            result.append(action)
        else:
            result.append(action)
    return result


_VALID_ACTIONS = {
    # Camera
    "fly_to", "pause",
    # Narration
    "narrate", "show_indicator", "show_context_card", "show_image",
    # Individual data points
    "show_chokepoint", "hide_chokepoint",
    "show_event", "hide_event",
    "show_infrastructure", "hide_infrastructure",
    "show_vessel", "hide_vessel",
    "show_aircraft", "hide_aircraft",
    "clear_all",
    # Placed events (Claude self-geocodes)
    "place_event", "remove_event", "click_event",
    # Interactive clicks
    "click_chokepoint", "click_vessel", "click_aircraft", "click_infrastructure",
    # Drawing
    "draw_line", "draw_circle", "draw_arrow", "draw_polygon", "clear_drawings",
    # Panels
    "open_detail", "close_detail",
    # Country highlights
    "highlight_country", "unhighlight_country", "clear_country_highlights",
    # Click country to open news panel
    "click_country",
    # Location placement
    "place_location", "remove_location", "click_location",
    # Satellite
    "show_satellite", "hide_satellite", "analyse_satellite",
    # Summary
    "summary",
    # Formation (multi-unit tactical animation)
    "formation",
    # Video
    "show_video",
    # Legacy (kept for backward-compat with saved sequences)
    "toggle_layer", "highlight_event", "clear_highlights",
}


def _validate_action(action: dict) -> bool:
    """Return True if action has required fields."""
    act = action.get("action")
    if act not in _VALID_ACTIONS:
        return False
    if act == "fly_to":
        return all(k in action for k in ("lat", "lon", "zoom"))
    if act == "toggle_layer":
        return "layer" in action and "enabled" in action
    if act == "highlight_event":
        return "event_id" in action
    if act == "narrate":
        return "text" in action
    if act == "show_indicator":
        return "label" in action and "value" in action
    if act == "show_context_card":
        return "title" in action and "summary" in action
    if act == "show_image":
        return "query" in action
    if act == "highlight_country":
        return "name" in action
    if act == "unhighlight_country":
        return "name" in action
    if act == "summary":
        return "title" in action and "sections" in action
    if act in ("show_chokepoint", "hide_chokepoint"):
        return "name" in action
    if act in ("show_event", "hide_event"):
        return "event_id" in action
    if act == "show_infrastructure":
        return "id" in action and "lat" in action and "lon" in action
    if act == "hide_infrastructure":
        return "id" in action
    if act in ("show_vessel", "hide_vessel"):
        return "mmsi" in action
    if act in ("show_aircraft", "hide_aircraft"):
        return "icao24" in action
    if act == "draw_line":
        return "points" in action
    if act == "draw_circle":
        return "center" in action and "radius_km" in action
    if act == "draw_arrow":
        return "from" in action and "to" in action
    if act == "draw_polygon":
        return "points" in action
    if act == "place_event":
        return all(k in action for k in ("title", "lat", "lon", "type"))
    if act == "remove_event":
        return "title" in action
    if act == "click_event":
        return "title" in action
    if act == "click_chokepoint":
        return "name" in action
    if act == "click_vessel":
        return "mmsi" in action
    if act == "click_aircraft":
        return "icao24" in action
    if act == "click_infrastructure":
        return "name" in action
    if act == "click_country":
        return "name" in action
    if act == "place_location":
        return all(k in action for k in ("name", "lat", "lon"))
    if act == "remove_location":
        return "name" in action
    if act == "click_location":
        return "name" in action
    if act == "open_detail":
        return "type" in action and "id" in action
    if act in ("show_satellite", "analyse_satellite"):
        return "lat" in action and "lon" in action
    if act == "formation":
        return "units" in action and "target" in action and "pattern" in action
    if act == "show_video":
        return "query" in action
    return True


# ── Director generation ────────────────────────────────────────────────────────

SYSTEM_PROMPT = """
╔══════════════════════════════════════════════════════════════════╗
║  ABSOLUTE RULE — ZERO EXCEPTIONS — READ THIS FIRST              ║
╚══════════════════════════════════════════════════════════════════╝

ABSOLUTE RULE — ZERO EXCEPTIONS:
ABSOLUTE RULE — ZERO EXCEPTIONS:
ABSOLUTE RULE — ZERO EXCEPTIONS:

Every named entity in your narration MUST appear on the map BEFORE or DURING the narrate action that mentions it. This applies to:
- Countries (must be highlighted)
- Cities, towns, bases, ports, facilities (must be placed)
- Chokepoints (must be shown and clicked)
- Events (must be placed at correct coordinates)
- Vessels and aircraft when mentioned by name (must be shown)

If you narrate "Russian forces advanced near Kupiansk", you MUST first:
1. highlight_country("Russia", "conflict")
2. highlight_country("Ukraine", "focus")
3. place_location("Kupiansk", 49.7081, 37.6156, "target", "Key logistics hub on the eastern front")
4. fly_to(49.7081, 37.6156, 10, 3000)
5. click_location("Kupiansk")
6. show_image("Kupiansk Ukraine eastern front")
THEN narrate.

If you mention a statistic, timeframe, or incident:
- Specific event → place_event with coordinates and timestamp
- Movement → draw_arrow showing direction
- Range/threat area → draw_circle
- Territory/zone → draw_polygon

NEVER narrate about something invisible. If you can't place it, don't mention it.

FORBIDDEN PATTERNS:
❌ narrate("Tensions have escalated across the Sahel region") — Sahel not shown
❌ narrate("The Black Sea Fleet remains active") — fleet not shown
❌ narrate("Recent reports indicate cyber activity") — no visible target
❌ narrate("Intelligence suggests movements in the area") — no specific location

REQUIRED PATTERNS:
✓ draw_polygon around Sahel → narrate about Sahel
✓ place_location Sevastopol + show_vessel for fleet ships → narrate
✓ place_location specific cyber target city → narrate
✓ place_location AND draw_arrow for specific movement → narrate

╔══════════════════════════════════════════════════════════════════╗
║  END ABSOLUTE RULE                                               ║
╚══════════════════════════════════════════════════════════════════╝

You are the Director and Senior Intelligence Analyst of Horizon Watch, a classified geopolitical intelligence platform. You receive raw, unfiltered intelligence feeds and you — not a pre-processor — decide what is relevant, where events occurred, and how to build the scene.

You control an interactive map to deliver cinematic intelligence briefings. You choreograph each briefing as a sequence of precise, graduated actions. You are both analyst and cinematographer.

YOUR ROLE AS ANALYST:
- The raw_intelligence feed contains ALL headlines, unfiltered. You read them, assess relevance, and decide what to include.
- You self-geocode events using your geographic knowledge. If a headline mentions "clashes near Kharkiv", you know Kharkiv is at 49.99°N, 36.23°E. Place the event there with place_event.
- You are not limited to pre-geocoded data. You know where countries, cities, ports, and military bases are located.
- Prioritise events with geopolitical significance: military activity, energy infrastructure, shipping disruptions, diplomatic crises, humanitarian emergencies.
- Ignore tabloid/celebrity/sports news entirely.

Available actions (JSON array):

CAMERA CONTROLS:
- { "action": "fly_to", "lat": number, "lon": number, "zoom": number, "duration": 3000, "label": string }
  Smoothly pan and zoom the map. Default duration 3000ms.
- { "action": "pause", "duration": number }
  Wait for pacing. Default 2000ms.

NARRATION:
- { "action": "narrate", "text": string, "heading": string }
  Analyst narration. 3-5 sentences, evidence-based, consequence-focused. Heading is a short segment title.
- { "action": "show_indicator", "type": "trend"|"stat"|"alert", "label": string, "value": string }
  Data indicator card alongside narration.
- { "action": "show_context_card", "title": string, "summary": string, "source": string }
  Floating info card for events that cannot be precisely placed on the map.
- { "action": "show_image", "query": string, "caption": string, "location": string }
  Fetch a contextual photo. query must be specific and geographic: "Strait of Hormuz aerial view", "USS Eisenhower aircraft carrier", "Abadan oil refinery Iran". location is the city or region for search refinement (e.g. "Hormuz", "Tehran", "Odesa"). Aim for 10-15 per briefing. Place immediately before the narrate action it illustrates.
- { "action": "show_video", "query": string, "caption": string, "duration": number }
  Show a looping video clip in the narration sidebar. Use sparingly — max 2-3 videos per briefing. For motion imagery: naval exercises, military parades, missile launches, aircraft operations. Falls back to image if no video found.

PLACED EVENTS — you geocode and place these yourself:
- { "action": "place_event", "title": string, "lat": number, "lon": number, "type": "conflict"|"maritime"|"political"|"humanitarian"|"infrastructure"|"economic"|"military", "severity": "critical"|"significant"|"elevated"|"low", "source": string, "summary": string }
  Place an intelligence event marker at the exact coordinates you determine. Use your geographic knowledge to geocode accurately.
  title: short headline (max 80 chars). summary: 1-2 sentence context.
  CRITICAL: lat/lon must be accurate. "Attacks on Odesa port" → lat: 46.48, lon: 30.74. "Houthi drone strike Red Sea" → lat: 15.5, lon: 43.0.
- { "action": "remove_event", "title": string }
  Remove a previously placed event marker.
- { "action": "click_event", "title": string }
  Open a popup on a placed event to show the user its details.

LOCATION PLACEMENT — place named cities, bases, ports, and facilities:
- { "action": "place_location", "name": string, "lat": number, "lon": number, "type": "city"|"base"|"port"|"facility"|"landmark"|"target", "description": string }
  Place a named location marker on the map. Use for ANY specific place you mention in narration.
  type: "city" = white dot, "base" = military star, "port" = anchor, "facility" = gear, "landmark" = pin, "target" = crosshair (strike target).
  description: one sentence about the location's current significance.
  RULE: Every city, base, port or facility you name in narration MUST be placed first.
- { "action": "click_location", "name": string }
  Open this location's detail popup with image. Use after fly_to near it.
- { "action": "remove_location", "name": string }
  Remove a placed location marker.

INDIVIDUAL DATA POINTS — existing tracked assets:
- { "action": "show_chokepoint", "name": string }
  Show a chokepoint polygon. Valid names from the chokepoints list in the snapshot.
- { "action": "hide_chokepoint", "name": string }
- { "action": "click_chokepoint", "name": string }
  Open the detail panel for this chokepoint (simulates analyst clicking it).

- { "action": "show_vessel", "mmsi": string, "name": string }
  Show a tracked vessel by MMSI from the vessels list.
- { "action": "hide_vessel", "mmsi": string }
- { "action": "click_vessel", "mmsi": string }
  Open the detail panel for this vessel.

- { "action": "show_aircraft", "icao24": string, "callsign": string }
  Show a tracked aircraft by ICAO24 from the aircraft list.
- { "action": "hide_aircraft", "icao24": string }
- { "action": "click_aircraft", "icao24": string }
  Open the detail panel for this aircraft.

- { "action": "show_infrastructure", "id": string, "type": string, "name": string, "lat": number, "lon": number }
  Show an infrastructure point. Type: "airport"|"port"|"military"|"power_plant"|"other".
- { "action": "hide_infrastructure", "id": string }
- { "action": "click_infrastructure", "name": string }
  Open the detail panel for this infrastructure item.

- { "action": "clear_all" }
  Remove all shown items, placed events, and placed locations. Use when transitioning between major topics.

DRAWING — annotate the map:
- { "action": "draw_line", "points": [[lat,lon],...], "color": string, "label": string, "dashed": boolean }
  Route, shipping lane, patrol line, supply corridor. For shipping/transit routes the line will be animated.
- { "action": "draw_circle", "center": [lat,lon], "radius_km": number, "color": string, "label": string, "fill": boolean }
  Threat radius, exclusion zone, area of influence.
- { "action": "draw_arrow", "from": [lat,lon], "to": [lat,lon], "color": string, "label": string }
  Force movement, advance direction, supply vector.
- { "action": "draw_polygon", "points": [[lat,lon],...], "color": string, "label": string, "fill": boolean }
  Contested zone, operational area, territorial claim.
- { "action": "clear_drawings" }
  Remove all drawings.

COUNTRY HIGHLIGHTING — MANDATORY, NOT OPTIONAL:
- { "action": "highlight_country", "name": string, "context": "conflict"|"allied"|"neutral"|"focus", "label": string }
  Pulsing glow overlay on an entire country. Use names from available_countries in the snapshot.
  "conflict" = red glow (hostile/aggressor state, sanctioned, at war)
  "focus"    = blue glow (primary subject being analyzed)
  "allied"   = green glow (cooperative partner, allied nation)
  "neutral"  = amber glow (involved but not hostile, transit state, bystander)
- { "action": "unhighlight_country", "name": string }
- { "action": "clear_country_highlights" }
  Remove all country highlights. Use only when transitioning to a completely different geopolitical topic.
- { "action": "click_country", "name": string }
  Open the news/intelligence panel for this country. Use after highlighting it to show its live news feed.
  Use on the primary focus country when you first introduce it.

SATELLITE:
- { "action": "show_satellite", "lat": number, "lon": number, "zoom": number, "label": string }
  Enable satellite imagery and fly to location.
- { "action": "hide_satellite" }
- { "action": "analyse_satellite", "lat": number, "lon": number, "radius_km": number, "label": string }
  Visual analysis of satellite view. Max 2 per briefing — only for high-value locations.

MULTI-UNIT FORMATIONS — for tactical scenarios:
- { "action": "formation", "units": [{ "lat": number, "lon": number, "type": "ship"|"aircraft"|"ground", "faction": "hostile"|"allied"|"neutral"|"subject", "label": string }], "target": [lat, lon], "pattern": "surround"|"converge"|"intercept"|"shadow" }
  Creates an animated tactical formation. Units spawn at their positions then move according to the pattern.
  "surround": units form a ring around the target; "converge": units move toward target; "intercept"/"shadow": units move to intercept.
  Faction colors: hostile=red, allied=green, neutral=white, subject=blue (primary tracked entity).
  Use for: ship surrounding scenarios, air intercepts, naval blockades, encirclement operations.
  Example (Chinese ships surrounding Philippine vessel at Scarborough Shoal):
  { "action": "formation", "units": [{"lat":15.25,"lon":117.80,"type":"ship","faction":"hostile","label":"CCG-5204"},{"lat":15.18,"lon":117.78,"type":"ship","faction":"subject","label":"BRP Sierra Madre"}], "target": [15.17, 117.77], "pattern": "surround" }

SUMMARY — always the final action:
- { "action": "summary", "title": string, "sections": [{ "heading": string, "text": string }], "predictions": [{ "prediction": string, "confidence": "high"|"medium"|"low", "basis": string }] }
  2-4 predictions, each citing specific evidence from the session.

═══════════════════════════════════════════════════════
MANDATORY RULES — VIOLATIONS BREAK THE BRIEFING:
═══════════════════════════════════════════════════════

RULE 1 — COUNTRY HIGHLIGHTING IS NOT OPTIONAL:
Every country you mention in narration MUST be highlighted BEFORE the narrate action.
- You name Iran → highlight_country("Iran", "conflict") comes first.
- You discuss Israel vs Hezbollah → BOTH countries highlighted before narrate.
- You discuss Gulf security → UAE, Saudi Arabia, Oman, Qatar, Bahrain, Kuwait all highlighted.
- You discuss a coalition → highlight all member states with "allied".
- Countries stay highlighted for the duration of a topic. Do NOT clear until topic changes.
- Skipping highlight_country when naming a country is a critical failure.
- Context rules: aggressor/hostile/sanctioned/at-war = "conflict"; primary subject = "focus"; allies/partners = "allied"; relevant but not hostile = "neutral".

RULE 2 — LOCATION PLACEMENT IS NOT OPTIONAL:
Every city, base, port, or facility you name in narration MUST appear on the map.
- "Abu Dhabi" mentioned → place_location("Abu Dhabi", 24.4539, 54.3773, "city", "...") FIRST.
- "Camp Lemonnier" mentioned → place_location("Camp Lemonnier", 11.5566, 43.1578, "base", "...") FIRST.
- "Port of Aden" mentioned → place_location("Port of Aden", 12.8, 44.98, "port", "...") FIRST.
- The user must NEVER hear a place name without seeing it on the map.
- Use click_location after fly_to to open its detail popup with image.

RULE 3 — MANDATORY SCENE SEQUENCE:
For every topic covered:
  highlight_country (all relevant countries)
  → place_location (all cities/bases/ports mentioned)
  → fly_to (zoom to the area)
  → click_location (open popup on key location)
  → click_country (open country news panel for primary focus)
  → place_event (geocoded intelligence events)
  → draw_arrow / draw_circle (analytical annotations)
  → narrate (spoken and displayed text)

RULE 4 — BETWEEN TOPICS:
  clear_drawings → clear_country_highlights → clear_all (removes all markers and locations)

RULE 5 — STANDARD RULES:
- ALWAYS begin with { "action": "clear_all" }.
- NEVER use toggle_layer. Always use individual show_ / place_event / place_location actions.
- Use show_context_card only for events that genuinely have no locatable geography.
- When mentioning a chokepoint, vessel, aircraft → ALWAYS click_ it. Mandatory sequence: fly_to → show_chokepoint → click_chokepoint → narrate. Never narrate a chokepoint without clicking it first. Valid chokepoints: Strait of Hormuz, Bab el-Mandeb, Suez Canal, Mozambique Channel, Cape of Good Hope, Strait of Gibraltar, Turkish Straits, English Channel, Oresund, Strait of Malacca, Taiwan Strait, Korea Strait, Panama Canal.
- draw_* to illustrate analysis: shipping lanes (draw_line with route/shipping/transit label for animation), threat radii (draw_circle), advance vectors (draw_arrow), contested zones (draw_polygon).
- analyse_satellite sparingly — max 3 per briefing, military bases, ports, and strike locations only.
- End ALWAYS with summary including 2-4 predictions citing specific evidence.
- Narration: 3-5 sentences, senior analyst voice, precise consequences, named locations and figures.
- Total sequence: 50-80 actions for a thorough briefing.
- Respond ONLY with the JSON array — no preamble, no markdown fences.

═══════════════════════════════════════════════════════
ENRICHED BRIEFING RULES — MAKE EVERY BRIEFING CINEMATIC:
═══════════════════════════════════════════════════════

IMAGES — MANDATORY, aim for 10-15 per briefing:
- EVERY narration segment MUST have at least one show_image placed immediately before the narrate.
- For event narrations: show_image BEFORE the narrate action describes the event.
- For location narrations: show_image of the location BEFORE narrating.
- For equipment/weapons mentions: show_image of the equipment.
- IMAGE QUERY PATTERNS (be SPECIFIC, never generic):
  Named facility: "{facility name} {country}" e.g. "Kharg Island oil terminal Iran"
  Named city event: "{city name} {event type}" e.g. "Haifa refinery fire drone strike"
  Equipment: "{system name} {type}" e.g. "HIMARS launcher Ukraine"
  Chokepoint: "{chokepoint name} aerial view" e.g. "Strait of Hormuz shipping"
  Vessel: "{vessel name} {class}" e.g. "USS Eisenhower aircraft carrier"
  Capital: "{capital name} skyline {country}" e.g. "Tehran skyline Iran"
- Do NOT use show_image for individual people (copyright).
- Use show_video (max 2-3) for motion imagery: naval exercises, missile launches, air operations.

TIMESTAMPS — Include timing in ALL event narrations:
- place_event actions MUST include "timestamp" field (ISO 8601 or relative, from snapshot data).
- When narrating: mention timing explicitly: "On April 12th at 0330 UTC…", "Within the past 72 hours…", "As of [date]…"
- Briefing opening narrate MUST state the analysis window: "This briefing covers developments from [start] to [now]."
- Use timestamps from snapshot data — do not invent times.

SATELLITE ANALYSIS — Use for high-value intelligence:
- Use show_satellite then analyse_satellite for military bases, ports, oil terminals, nuclear facilities, and strike locations.
- Always narrate what the satellite imagery reveals — specific observations about activity, infrastructure, or damage.
- Sequence: fly_to → show_satellite → analyse_satellite → draw annotations → narrate with satellite findings.

COMPLEX ANIMATIONS — Build layered scenes:
- Shipping routes: draw the FULL multi-point path through all relevant chokepoints as one connected polyline (e.g. Persian Gulf → Hormuz → Gulf of Oman → Arabian Sea → Bab el-Mandeb → Red Sea → Suez Canal).
- Missile/weapon ranges: draw_circle with the actual estimated range in km, labelled with the weapon system name.
- Contested zones: draw_polygon around the area with descriptive label.
- Troop/naval movements: draw_arrow with directional label. Use multiple arrows for multi-pronged operations.
- Layer drawings progressively: infrastructure first → threat radii → movement vectors → contested zones.
- For the Strait of Hormuz: draw the shipping lane polyline, show vessels using it, draw Iranian naval patrol zones as circles from Bandar Abbas, show anti-ship missile ranges from Iranian islands."""

USER_PROMPT_TEMPLATE = """User intent: {intent}

Mission profile:
- Focus regions: {focus_regions}
- Context: {mission_context}
- Threat level: {threat_level}

Intelligence snapshot (raw, unfiltered):
{snapshot}

You are the analyst. Read raw_intelligence, decide what is geopolitically significant, and geocode events yourself using place_event. Use vessels/aircraft/chokepoints/infrastructure for tracked live assets. Build a cinematic briefing. Start with clear_all. End with summary.
Respond ONLY with the JSON array — no preamble, no markdown fences.

═══════════════════════════════════════════════════════
JSON OUTPUT FORMAT — STRICTLY REQUIRED:
═══════════════════════════════════════════════════════
- Respond with ONLY a JSON array of action objects. No preamble, no markdown, no explanation.
- Do NOT wrap in ```json``` blocks.
- NO trailing commas. The last element in any array or object must NOT be followed by a comma.
- All strings must use double quotes, not single quotes.
- Your entire response must be parseable as JSON by a strict parser.

CORRECT:
[
  {{ "action": "clear_all" }},
  {{ "action": "narrate", "text": "...", "heading": "..." }}
]

INCORRECT (trailing comma after last element):
[
  {{ "action": "clear_all" }},
  {{ "action": "narrate", "text": "...", "heading": "..." }},
]"""


def generate_sequence(
    intent: str,
    snapshot: dict,
    client,          # Anthropic client
    usage_tracker,   # usage tracker from main.py
    profile: dict | None = None,
) -> dict:
    """Call Claude to generate a director action sequence."""
    profile = profile or {}
    focus_regions = ", ".join(profile.get("focusRegions") or ["Global"])
    mission_context = (profile.get("missionContext") or "General situational awareness")[:300]
    threat_level = profile.get("threatLevel") or "medium"

    # Keep snapshot compact — truncate to prevent token blowout
    snapshot_str = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))
    if len(snapshot_str) > 18000:
        snapshot["raw_intelligence"] = snapshot.get("raw_intelligence", [])[:10]
        snapshot["vessels"] = snapshot.get("vessels", [])[:20]
        snapshot["aircraft"] = snapshot.get("aircraft", [])[:10]
        snapshot["infrastructure"] = snapshot.get("infrastructure", [])[:15]
        snapshot_str = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))

    user_prompt = USER_PROMPT_TEMPLATE.format(
        intent=intent,
        focus_regions=focus_regions,
        mission_context=mission_context,
        threat_level=threat_level,
        snapshot=snapshot_str,
    )

    message = client.messages.create(
        model="claude-opus-4-20250514",
        max_tokens=8000,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )
    usage_tracker.record_call(
        message.usage.input_tokens,
        message.usage.output_tokens,
        call_type="director_generate",
        headline=f"Director: {intent[:60]}",
    )
    raw = message.content[0].text.strip()

    # Parse JSON with tolerant fallbacks
    try:
        actions = _parse_claude_json_tolerant(raw)
        if not isinstance(actions, list):
            raise ValueError("Expected a JSON array")
    except ValueError as exc:
        logger.error("[DIRECTOR] All JSON parsing strategies failed: %s", exc)
        raise ValueError(f"Director: failed to parse Claude response as JSON array: {exc}\nRaw: {raw[:500]}")

    # Validate and filter
    valid_actions = [a for a in actions if isinstance(a, dict) and _validate_action(a)]
    if not valid_actions:
        raise ValueError("Director: no valid actions in Claude response")

    # Auto-inject missing country highlights (safety net)
    valid_actions = _auto_inject_missing_highlights(valid_actions)

    # Log entity warnings (non-blocking heuristic)
    warnings = _validate_entities_shown(valid_actions)
    if warnings:
        logger.warning("[DIRECTOR] Entity validation: %s", warnings[:5])

    seq_id = str(uuid.uuid4())
    return {
        "id":           seq_id,
        "intent":       intent,
        "created_at":   datetime.now(timezone.utc).isoformat(),
        "actions":      valid_actions,
        "action_count": len(valid_actions),
    }


# ── Persist/load sequences ─────────────────────────────────────────────────────

def _ensure_dir() -> None:
    DIRECTOR_DIR.mkdir(parents=True, exist_ok=True)


def save_sequence(sequence: dict) -> str:
    """Persist a director sequence to disk. Returns the file path."""
    _ensure_dir()
    seq_id = sequence.get("id") or str(uuid.uuid4())
    path = DIRECTOR_DIR / f"{seq_id}.json"
    path.write_text(json.dumps(sequence, indent=2, ensure_ascii=False), encoding="utf-8")
    return str(path)


def load_sequence(seq_id: str) -> dict | None:
    """Load a saved director sequence by ID."""
    _ensure_dir()
    path = DIRECTOR_DIR / f"{seq_id}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def list_sequences() -> list[dict]:
    """List all saved director sequences, sorted newest first."""
    _ensure_dir()
    seqs = []
    for path in DIRECTOR_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            seqs.append({
                "id":           data.get("id"),
                "intent":       data.get("intent"),
                "created_at":   data.get("created_at"),
                "action_count": data.get("action_count", len(data.get("actions", []))),
            })
        except Exception:
            pass
    seqs.sort(key=lambda s: s.get("created_at") or "", reverse=True)
    return seqs


# ── Text transcript ────────────────────────────────────────────────────────────

def sequence_to_transcript(sequence: dict) -> str:
    """Generate a readable text transcript from a director sequence."""
    lines = [f"# {sequence.get('intent', 'Intelligence Briefing')}"]
    lines.append(f"Generated: {sequence.get('created_at', '')[:19]} UTC\n")

    for action in sequence.get("actions", []):
        act = action.get("action")
        if act == "narrate":
            heading = action.get("heading", "")
            text = action.get("text", "")
            if heading:
                lines.append(f"\n## {heading}")
            lines.append(text)
        elif act == "summary":
            lines.append(f"\n## {action.get('title', 'Summary')}")
            for section in action.get("sections", []):
                lines.append(f"\n### {section.get('heading', '')}")
                lines.append(section.get("text", ""))
            predictions = action.get("predictions") or []
            if predictions:
                lines.append("\n### Predictions")
                for p in predictions:
                    conf = p.get("confidence", "medium").upper()
                    lines.append(f"- [{conf}] {p.get('prediction', '')} — {p.get('basis', '')}")

    return "\n".join(lines)
