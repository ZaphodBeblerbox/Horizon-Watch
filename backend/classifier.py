"""
classifier.py — Zero-cost keyword classifier for surface pool events.
Returns structured classification including icon type and infrastructure to preload.
"""

from __future__ import annotations

# (keywords, ev_type, icon, color, preload_infra)
RULES = [
    (["explosion", "bomb", "blast", "ied", "detonation"], "explosion", "explosion",   "red",    ["hospitals", "military"]),
    (["missile", "rocket", "strike", "projectile", "launch"], "missile", "missile",   "red",    ["military", "airports"]),
    (["shooting", "gunfire", "clash", "killed", "attack", "raid", "troops"], "armed_clash", "armed_clash", "red", ["hospitals", "military"]),
    (["fire", "arson", "burning", "blaze"], "fire", "fire",                            "amber",  ["hospitals"]),
    (["aircraft", "flight", "airline", "crash", "airspace", "runway"], "aviation", "aviation",  "amber",  ["airports"]),
    (["ship", "vessel", "tanker", "port", "naval", "maritime", "piracy", "strait"], "maritime", "maritime", "teal", ["ports", "chokepoints"]),
    (["pipeline", "oil", "gas", "refinery", "power", "electricity", "grid"], "energy", "energy", "amber", ["power_plants", "pipelines"]),
    (["earthquake", "tremor", "magnitude", "seismic"], "earthquake", "earthquake",    "orange", ["hospitals", "airports"]),
    (["protest", "demonstration", "riot", "march", "rally"], "protest", "protest",    "yellow", []),
    (["hospital", "medical", "clinic", "wounded", "casualties"], "medical", "medical", "white",  ["hospitals"]),
]

DEFAULT = ("general", "general", "grey", ["airports", "hospitals"])

def classify_event(headline: str, description: str = "", source: str = "") -> dict:
    """
    Classify a surface event by keyword matching. Returns:
    {type, icon, color, confidence, infrastructure_types_to_preload}
    confidence: 1.0 if 2+ keywords matched, 0.7 if 1 matched, 0.4 if default
    """
    text = f"{headline} {description[:100]}".lower()

    for keywords, ev_type, icon, color, preload in RULES:
        matched = [kw for kw in keywords if kw in text]
        if matched:
            confidence = 1.0 if len(matched) >= 2 else 0.7
            return {
                "type":   ev_type,
                "icon":   icon,
                "color":  color,
                "confidence": confidence,
                "infrastructure_types_to_preload": list(preload),
            }

    return {
        "type":   DEFAULT[0],
        "icon":   DEFAULT[1],
        "color":  DEFAULT[2],
        "confidence": 0.4,
        "infrastructure_types_to_preload": list(DEFAULT[3]),
    }
