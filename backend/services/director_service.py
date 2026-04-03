"""director_service.py — Cinematic intelligence briefing director.

Generates an ordered action sequence for Director Mode: a choreographed
map briefing that pans, zooms, toggles layers, highlights events, and
delivers analyst narration driven by live intelligence data.
"""
from __future__ import annotations

import json
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

BASE_DIR = Path(__file__).parent.parent
DIRECTOR_DIR = BASE_DIR / "documents" / "director-briefings"

# ── Snapshot helpers ───────────────────────────────────────────────────────────

def build_snapshot(
    surface_pool: list,
    ais_vessels: dict,
    adsb_cache_latest: list,
    event_store_fn,      # callable: get_active_events(min_severity="elevated", limit=10)
    active_profile: dict | None,
) -> dict:
    """Build a compact intelligence snapshot for the Director prompt."""

    # Surface items — top 20
    surface_items = []
    for item in (surface_pool or [])[:20]:
        surface_items.append({
            "id":        item.get("id", ""),
            "title":     (item.get("headline") or item.get("title") or "")[:120],
            "lat":       item.get("lat"),
            "lon":       item.get("lon"),
            "type":      item.get("type") or item.get("event_type") or "general",
            "severity":  item.get("severity_tier") or "elevated",
            "source":    item.get("source") or item.get("source_name") or "",
            "timestamp": (item.get("published_at") or item.get("published") or "")[:19],
            "location":  item.get("location") or "",
        })

    # AIS vessels — count by type, surface notable (military)
    vessel_count = len(ais_vessels)
    type_counts: dict[str, int] = {}
    notable_vessels = []
    for mmsi, v in list(ais_vessels.items())[:2000]:
        vtype = v.get("ship_type_label") or "other"
        type_counts[vtype] = type_counts.get(vtype, 0) + 1
        if v.get("ship_type_code", 0) in range(35, 36):  # military
            notable_vessels.append({
                "mmsi":  mmsi,
                "name":  v.get("name", "unknown"),
                "lat":   v.get("lat"),
                "lon":   v.get("lon"),
                "speed": v.get("speed"),
            })

    # ADS-B aircraft — count by type, flag any military
    aircraft_military = []
    aircraft_count = len(adsb_cache_latest)
    ac_type_counts: dict[str, int] = {}
    for ac in adsb_cache_latest:
        db_flags = int(ac.get("dbFlags") or 0)
        cat = ac.get("category") or "?"
        ac_type_counts[cat] = ac_type_counts.get(cat, 0) + 1
        if db_flags & 1:  # military bit
            aircraft_military.append({
                "icao":     ac.get("hex") or ac.get("icao"),
                "callsign": (ac.get("flight") or "").strip(),
                "lat":      ac.get("lat"),
                "lon":      ac.get("lon"),
                "alt_baro": ac.get("alt_baro"),
            })

    # Recent elevated+ events
    recent_events = []
    try:
        events = event_store_fn(min_severity="elevated", max_age_hours=24, limit=10)
        for ev in events:
            recent_events.append({
                "id":       ev.get("id", ""),
                "title":    ev.get("clean_title") or ev.get("title") or "",
                "lat":      ev.get("lat"),
                "lon":      ev.get("lon"),
                "type":     ev.get("event_type") or "general",
                "severity": ev.get("severity_tier") or "elevated",
                "location": ev.get("location") or "",
                "published": (ev.get("published") or "")[:19],
            })
    except Exception:
        pass

    # Mission profile
    profile_summary = {}
    if active_profile:
        profile_summary = {
            "focusRegions": active_profile.get("focusRegions") or [],
            "missionContext": (active_profile.get("missionContext") or "")[:300],
            "threatLevel": active_profile.get("threatLevel") or "medium",
        }

    return {
        "surface_items":   surface_items,
        "active_vessels":  {
            "total":      vessel_count,
            "by_type":    type_counts,
            "notable":    notable_vessels[:5],
        },
        "active_aircraft": {
            "total":    aircraft_count,
            "military": aircraft_military[:5],
            "by_cat":   ac_type_counts,
        },
        "recent_events":   recent_events,
        "mission_profile": profile_summary,
        "generated_at":    datetime.now(timezone.utc).isoformat(),
    }


# ── Action validation ──────────────────────────────────────────────────────────

_VALID_ACTIONS = {
    "fly_to", "toggle_layer", "highlight_event", "clear_highlights",
    "narrate", "pause", "show_indicator", "summary",
}

_VALID_LAYERS = {
    "adsb", "ais", "news_conflicts", "eez", "chokepoints", "satellite",
    "country_borders", "nautical_chart", "infrastructure", "piracy",
    "unified_events", "borders", "aisVessels", "newsConflicts",
    "unifiedEvents",
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
    if act == "summary":
        return "title" in action and "sections" in action
    return True  # pause, clear_highlights have no required fields beyond "action"


# ── Director generation ────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are the Director of Horizon Watch, a geopolitical intelligence platform. You control an interactive map to deliver cinematic intelligence briefings. You have access to the following actions to choreograph a briefing:

Available actions (use as a JSON array):
- { "action": "fly_to", "lat": number, "lon": number, "zoom": number, "duration": 2000 }
  Smoothly pan and zoom the map to a location. Duration in ms.
- { "action": "toggle_layer", "layer": string, "enabled": boolean }
  Toggle a map layer. Layers: "adsb", "aisVessels", "newsConflicts", "eez", "chokepoints", "satellite", "borders", "infrastructure", "imbPiracy", "unifiedEvents"
- { "action": "highlight_event", "event_id": string, "style": "pulse" | "ring" | "glow" }
  Visually highlight a specific event marker on the map
- { "action": "clear_highlights" }
  Remove all highlights
- { "action": "narrate", "text": string, "heading": string }
  Display narration text to the user. Heading is a short title for this segment. Text is 2-4 sentences of analyst-grade prose.
- { "action": "pause", "duration": number }
  Wait for a duration in ms before next action. Use for dramatic pacing.
- { "action": "show_indicator", "type": "trend" | "stat" | "alert", "label": string, "value": string }
  Show a data indicator card alongside the narration.
- { "action": "summary", "title": string, "sections": [{ "heading": string, "text": string }] }
  Final summary slide. Always the last action.

Rules:
- Begin with a wide establishing shot (fly_to at zoom 3-4) then progressively zoom into areas of interest
- Toggle only the layers relevant to each segment of the briefing
- Every fly_to should be followed by a narrate explaining what the user is seeing
- Use highlight_event for specific incidents from the surface_items or recent_events lists
- Clear highlights before moving to a new topic
- End with a summary action containing key findings, trend assessment, and indicators to watch
- The narration should read like a senior intelligence analyst — confident, precise, specific
- Reference specific events, locations, and data points from the snapshot
- Keep the total sequence between 15-30 actions
- Pace cinematically: establish → zoom to specifics → pattern → next topic → summary
- Respond ONLY with the JSON array, no preamble, no markdown fences"""

USER_PROMPT_TEMPLATE = """User intent: {intent}

Mission profile:
- Focus regions: {focus_regions}
- Context: {mission_context}
- Threat level: {threat_level}

Current intelligence snapshot:
{snapshot}

Generate a director sequence as a JSON array of actions.
Respond ONLY with the JSON array, no preamble, no markdown fences."""


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
    if len(snapshot_str) > 8000:
        # Truncate surface_items if too long
        snapshot["surface_items"] = snapshot.get("surface_items", [])[:10]
        snapshot_str = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))

    user_prompt = USER_PROMPT_TEMPLATE.format(
        intent=intent,
        focus_regions=focus_regions,
        mission_context=mission_context,
        threat_level=threat_level,
        snapshot=snapshot_str,
    )

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4000,
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

    # Parse JSON — strip any accidental markdown fences
    if raw.startswith("```"):
        lines = raw.split("\n")
        raw = "\n".join(lines[1:-1] if lines[-1].startswith("```") else lines[1:])

    try:
        actions = json.loads(raw)
        if not isinstance(actions, list):
            raise ValueError("Expected a JSON array")
    except Exception as exc:
        raise ValueError(f"Director: failed to parse Claude response as JSON array: {exc}\nRaw: {raw[:500]}")

    # Validate and filter
    valid_actions = [a for a in actions if isinstance(a, dict) and _validate_action(a)]
    if not valid_actions:
        raise ValueError("Director: no valid actions in Claude response")

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

    return "\n".join(lines)
