"""
scoring.py — Mission-profile-aware event scoring engine.

Scores GDELT events and news conflict markers 0-100 based on:
  (1) Geographic match to profile focus regions     — 30 pts
  (2) Infrastructure domain match                  — 25 pts
  (3) Event severity via Goldstein scale            — 20 pts
  (4) Pattern detection (3+ same type/region/72h)  — 15 pts
  (5) Chokepoint proximity flag                    — 10 pts

No Claude calls. Pure Python. All logic is deterministic and template-based.
"""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import Optional


# ── Region bounding boxes (south, north, west, east) ─────────────────────────
# Tuples of (south, north, west, east) in decimal degrees.
# None = "Global" — matches everywhere.

REGION_BBOXES: dict[str, tuple[float, float, float, float] | None] = {
    "East Africa":                (-12.0,   5.0,  28.0,  42.0),
    "Horn of Africa":             (  2.0,  18.0,  38.0,  52.0),
    "Great Lakes Region":         (-10.0,   2.0,  27.0,  33.0),
    "Sahel":                      ( 10.0,  20.0, -17.0,  24.0),
    "West Africa":                (  4.0,  20.0, -17.0,  16.0),
    "North Africa":               ( 18.0,  38.0, -17.0,  37.0),
    "Central Africa":             (-10.0,  10.0,   8.0,  32.0),
    "Southern Africa":            (-35.0, -12.0,  12.0,  36.0),
    "Red Sea / Arabian Peninsula":( 12.0,  30.0,  32.0,  60.0),
    "Gulf States":                ( 22.0,  30.0,  46.0,  60.0),
    "Middle East":                ( 25.0,  42.0,  28.0,  63.0),
    "Indian Ocean":               (-35.0,  25.0,  30.0, 110.0),
    "Mediterranean":              ( 30.0,  46.0,  -6.0,  42.0),
    "South Asia":                 (  5.0,  38.0,  60.0,  95.0),
    "Southeast Asia":             (-10.0,  28.0,  92.0, 140.0),
    "Central Asia":               ( 36.0,  55.0,  46.0,  90.0),
    "Europe":                     ( 35.0,  72.0, -25.0,  45.0),
    "Global":                     None,
}

# Pre-computed centroids from REGION_BBOXES: (lat, lon) or None for "Global".
REGION_CENTROIDS: dict[str, tuple[float, float] | None] = {
    region: (None if bbox is None else ((bbox[0] + bbox[1]) / 2, (bbox[2] + bbox[3]) / 2))
    for region, bbox in REGION_BBOXES.items()
}


# ── Chokepoint locations (lat, lon, radius_km) ────────────────────────────────

CHOKEPOINT_LOCS: dict[str, tuple[float, float, float]] = {
    "Strait of Hormuz":           ( 26.5,  56.4, 150.0),
    "Suez Canal":                 ( 30.5,  32.4, 200.0),
    "Red Sea":                    ( 20.0,  38.5, 500.0),
    "Bab el-Mandeb":              ( 12.6,  43.4, 150.0),
    "Malacca Strait":             (  3.0, 103.5, 250.0),
    "Cape of Good Hope":          (-34.4,  18.5, 250.0),
    "Panama Canal":               (  9.0, -79.7, 150.0),
    "Strait of Gibraltar":        ( 35.9,  -5.6, 150.0),
    "Bosporus / Turkish Straits": ( 41.1,  29.0, 150.0),
    "Mozambique Channel":         (-17.0,  40.5, 500.0),
}


# ── Infrastructure domain keyword lists ───────────────────────────────────────
# Checked against event type, location, summary, description, actor fields.

INFRA_KEYWORDS: dict[str, list[str]] = {
    "Aviation": [
        "airport", "airfield", "aerodrome", "airspace", "airline", "aircraft",
        "flight", "aviation", "runway", "atc", "air traffic",
    ],
    "Telecommunications": [
        "telecom", "internet", "broadband", "undersea cable", "fiber", "fibre",
        "satellite link", "radio tower", "communications", "network", "4g", "5g",
        "bandwidth", "signal", "jamming",
    ],
    "Maritime / Ports": [
        "port", "harbor", "harbour", "dock", "shipping", "vessel", "maritime",
        "sea lane", "naval", "coast guard", "coastguard", "piracy", "tanker",
        "freighter", "cargo ship",
    ],
    "Energy": [
        "oil", "gas", "pipeline", "refinery", "power plant", "electricity",
        "nuclear", "petroleum", "fuel", "lng", "energy", "power grid",
        "substation", "drilling",
    ],
    "Border / Land": [
        "border", "crossing", "checkpoint", "customs", "immigration", "frontier",
        "land route", "smuggling", "blockade",
    ],
    "Financial": [
        "bank", "financial", "currency", "exchange rate", "payment", "economic",
        "trade", "sanction", "imf", "world bank", "inflation", "central bank",
        "money laundering",
    ],
}


# ── CAMEO root codes → conflict family ───────────────────────────────────────
# Root codes 14-20 are conflictual; 19-20 are violent/critical.
# Used to determine severity tier independent of Goldstein score.

_CONFLICT_ROOTS: frozenset[int] = frozenset({14, 15, 16, 17, 18, 19, 20})
_CRITICAL_ROOTS: frozenset[int] = frozenset({19, 20})


# ── Threshold → minimum score mapping ────────────────────────────────────────

THRESHOLD_MIN_SCORE: dict[int, int] = {
    0: 70,   # Minimal     — only highly relevant events
    1: 40,   # Standard    — balanced (default)
    2: 20,   # High        — broad monitoring
}
DEFAULT_MIN_SCORE = 40


# ── Geometry helpers ──────────────────────────────────────────────────────────

def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1))
         * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(min(1.0, a)))


# ── Geographic hard gate for the surface pool ─────────────────────────────────

def geo_gate_passes(lat: float, lon: float, profile: dict | None) -> bool:
    """
    Hard geographic filter for the surface pool.

    Returns True (allow) if any of the following:
      - No profile, or profile has no focusRegions.
      - "Global" is in focusRegions.
      - Event falls within ANY focus-region bounding box.
      - Event is within 400 km of the edge of ANY focus-region bbox (buffer zone).
      - Event is within 600 km of ANY watched chokepoint.

    Uses bbox containment (not centroid distance) so that cities near the edge
    of a region bbox are not incorrectly excluded by a tight centroid radius.

    Otherwise returns False (exclude from surface pool).
    """
    if not profile:
        return True
    focus_regions = list(profile.get("focusRegions", []))
    if not focus_regions:
        return True
    if "Global" in focus_regions:
        return True

    # Bbox containment + 400km buffer check
    for region in focus_regions:
        bbox = REGION_BBOXES.get(region)
        if bbox is None:          # "Global" sub-entry → pass
            return True
        s, n, w, e = bbox
        # Direct bbox containment
        if s <= lat <= n and w <= lon <= e:
            return True
        # Buffer: point within 400km of any bbox corner/edge
        # Clamp lat/lon to bbox, then measure distance to nearest bbox point
        clamp_lat = max(s, min(n, lat))
        clamp_lon = max(w, min(e, lon))
        if _haversine_km(lat, lon, clamp_lat, clamp_lon) <= 400.0:
            return True

    # Chokepoint proximity check (600 km)
    for cp_name in list(profile.get("chokepoints", [])):
        loc = CHOKEPOINT_LOCS.get(cp_name)
        if loc is None:
            continue
        cp_lat, cp_lon, _ = loc
        if _haversine_km(lat, lon, cp_lat, cp_lon) <= 600.0:
            return True

    return False


# ── Component scorers ─────────────────────────────────────────────────────────

def _geo_score(lat: float, lon: float, focus_regions: list[str]) -> int:
    """0–30 pts based on geographic match to focus regions.

    30 pts — event is inside the focus-region bbox (strict containment).
    20 pts — event is within 500 km of the nearest bbox edge (buffer zone).
             Catches border areas like UAE (just south of Middle East bbox),
             Yemen, coastal Oman, and other edge cases.
     0 pts — miss.

    Mirrors the 400 km buffer in geo_gate_passes so that events allowed
    through the hard gate also receive a non-zero relevance contribution.
    """
    if not focus_regions:
        return 15          # no preference → neutral weight
    best = 0
    for region in focus_regions:
        bbox = REGION_BBOXES.get(region)
        if bbox is None:   # "Global"
            return 30
        s, n, w, e = bbox
        if s <= lat <= n and w <= lon <= e:
            return 30      # full score — no need to check further
        # Buffer zone: clamp to bbox, measure distance to nearest edge point
        clamp_lat = max(s, min(n, lat))
        clamp_lon = max(w, min(e, lon))
        dist_km = _haversine_km(lat, lon, clamp_lat, clamp_lon)
        if dist_km <= 500.0:
            best = max(best, 20)
    return best


def _infra_score(event: dict, allowed_domains: set[str]) -> tuple[int, str | None]:
    """0–25 pts + matched domain name (or None).

    Requires ≥2 distinct keyword matches to assign a domain — prevents incidental
    single-word matches (e.g., a city named "Port ..." triggering Maritime).
    If allowed_domains is non-empty, only domains in that set can award points.
    """
    haystack = " ".join(
        str(event.get(k, ""))
        for k in ("type", "event_type", "location", "summary", "description", "actor")
    ).lower()

    best_domain: str | None = None
    best_count = 0

    for domain, keywords in INFRA_KEYWORDS.items():
        # Count distinct keywords present (not occurrences — same keyword repeated
        # across multiple haystack fields still counts as 1 match).
        distinct_matches = sum(1 for kw in keywords if kw in haystack)
        if distinct_matches >= 2 and distinct_matches > best_count:
            if allowed_domains and domain not in allowed_domains:
                continue
            best_count  = distinct_matches
            best_domain = domain

    if best_domain:
        return 25, best_domain
    return 0, None


def _goldstein_score(goldstein) -> int:
    """0–20 pts. Negative Goldstein (conflict) → higher score."""
    if goldstein is None:
        return 8             # unknown → moderate default
    try:
        g = float(goldstein)
    except (ValueError, TypeError):
        return 8
    # Map [-10, +10] → [20, 0]
    return int(round((10.0 - max(-10.0, min(10.0, g))) / 20.0 * 20.0))


def _chokepoint_score(
    lat: float,
    lon: float,
    chokepoints: list[str],
) -> tuple[int, bool]:
    """0–10 pts, True/False near-chokepoint flag."""
    for cp_name in chokepoints:
        loc = CHOKEPOINT_LOCS.get(cp_name)
        if loc is None:
            continue
        cp_lat, cp_lon, radius_km = loc
        if _haversine_km(lat, lon, cp_lat, cp_lon) <= radius_km:
            return 10, True
    return 0, False


def _severity_tier(goldstein, relevance_score: int, root_code: str) -> str:
    """Classify into low / elevated / significant / critical."""
    try:
        root = int(root_code) if root_code else 0
    except (ValueError, TypeError):
        root = 0
    try:
        g = float(goldstein) if goldstein is not None else 0.0
    except (ValueError, TypeError):
        g = 0.0

    if g <= -7 or root in _CRITICAL_ROOTS:
        return "critical"
    if g <= -4 or (root in _CONFLICT_ROOTS and relevance_score >= 55):
        return "significant"
    if g < 0 or relevance_score >= 35:
        return "elevated"
    return "low"


def _context_string(
    event: dict,
    tier: str,
    infra_type: str | None,
    pattern_detected: bool,
    chokepoint_flag: bool,
) -> str:
    """Build a short, template-based context string. No Claude call."""
    loc      = event.get("location") or event.get("action_geo_full_name") or "Unknown location"
    ev_type  = event.get("type") or event.get("event_type") or "Event"
    actor    = event.get("actor") or ""
    sources  = int(event.get("sources", event.get("num_sources", 0)) or 0)
    mentions = int(event.get("mentions", event.get("num_mentions", 0)) or 0)
    g        = event.get("goldstein")
    try:
        g_str = f"Goldstein {float(g):+.1f}." if g is not None else ""
    except (ValueError, TypeError):
        g_str = ""

    parts: list[str] = []

    if tier == "critical":
        parts.append(f"Critical: {ev_type} in {loc}.")
        if actor:
            parts.append(f"Actor: {actor}.")
        if sources > 1:
            parts.append(f"Corroborated across {sources} sources.")
    elif tier == "significant":
        parts.append(f"Significant {ev_type} in {loc}.")
        if actor:
            parts.append(f"Actor: {actor}.")
        if g_str:
            parts.append(g_str)
    elif tier == "elevated":
        parts.append(f"Elevated: {ev_type} in {loc}.")
        if mentions > 0:
            parts.append(f"{mentions} mention{'s' if mentions != 1 else ''} detected.")
    else:
        parts.append(f"{ev_type} in {loc}.")
        if g_str:
            parts.append(g_str)

    if infra_type:
        parts.append(f"Potential {infra_type} impact.")
    if chokepoint_flag:
        parts.append("Near monitored chokepoint.")
    if pattern_detected:
        parts.append("Part of a recurring pattern in this region.")

    return " ".join(parts)


# ── Pattern detection ─────────────────────────────────────────────────────────

def _detect_patterns(
    events: list[dict],
    window_hours: int = 72,
    min_count: int = 3,
) -> frozenset[str]:
    """
    Return the set of event IDs that belong to a detected pattern.

    A pattern = same CAMEO root code appearing in the same ~100km cell
    (1° lat/lon grid) at least `min_count` times within `window_hours`.

    O(n) using a grid-bucket approach — safe for 20 k events.
    """
    cutoff_date = (
        datetime.now(timezone.utc) - timedelta(hours=window_hours)
    ).strftime("%Y-%m-%d")

    buckets: dict[tuple[int, int, str], list[str]] = defaultdict(list)

    for ev in events:
        ev_date = str(ev.get("date") or ev.get("event_date") or "")
        if ev_date < cutoff_date:
            continue
        root = str(ev.get("event_root_code") or "").strip()
        if not root:
            continue
        try:
            lat = float(ev.get("lat"))
            lon = float(ev.get("lon"))
        except (TypeError, ValueError):
            continue
        ev_id = str(ev.get("id") or ev.get("event_id") or "")
        if not ev_id:
            continue
        # Quantise to ~111km grid cell
        cell = (round(lat), round(lon), root)
        buckets[cell].append(ev_id)

    pattern_ids: set[str] = set()
    for ids in buckets.values():
        if len(ids) >= min_count:
            pattern_ids.update(ids)

    return frozenset(pattern_ids)


# ── Public API ────────────────────────────────────────────────────────────────

def batch_score(
    events: list[dict],
    profile: dict | None,
    apply_filter: bool = True,
) -> list[dict]:
    """
    Score and enrich a list of GDELT-sourced frontend events using the
    Mission Profile. Events are expected to have already been converted
    to frontend shape by _gdelt_event_to_frontend() (fields: id, lat, lon,
    goldstein, event_root_code, type, event_type, location, summary,
    description, actor, mentions, sources).

    Each returned event gains:
        relevance_score    int   0-100
        severity_tier      str   low | elevated | significant | critical
        infrastructure_type str | None
        pattern_detected   bool
        chokepoint_flag    bool
        context            str   (template, no Claude)

    If apply_filter=True (default), only events at or above the profile's
    threshold min-score are returned.

    Returned list is sorted: highest relevance first, then severity tier.
    """
    if not events:
        return []

    focus_regions  = list(profile.get("focusRegions", []))  if profile else []
    infra_domains  = set(profile.get("infraDomains", []))   if profile else set()
    chokepoints    = list(profile.get("chokepoints", []))   if profile else []
    threshold_val  = int(profile.get("threshold", 1))       if profile else 1
    min_score      = THRESHOLD_MIN_SCORE.get(threshold_val, DEFAULT_MIN_SCORE)

    pattern_ids = _detect_patterns(events)

    _tier_order = {"critical": 0, "significant": 1, "elevated": 2, "low": 3}
    results: list[dict] = []

    for ev in events:
        try:
            lat = float(ev["lat"])
            lon = float(ev["lon"])
        except (KeyError, TypeError, ValueError):
            continue

        ev_id = str(ev.get("id") or "")

        geo_pts             = _geo_score(lat, lon, focus_regions)
        infra_pts, infra_t  = _infra_score(ev, infra_domains)
        gold_pts            = _goldstein_score(ev.get("goldstein"))
        pattern_detected    = ev_id in pattern_ids
        pattern_pts         = 15 if pattern_detected else 0
        choke_pts, choke_f  = _chokepoint_score(lat, lon, chokepoints)

        total = min(100, geo_pts + infra_pts + gold_pts + pattern_pts + choke_pts)

        root  = str(ev.get("event_root_code") or "")
        tier  = _severity_tier(ev.get("goldstein"), total, root)
        ctx   = _context_string(ev, tier, infra_t, pattern_detected, choke_f)

        verdict = "PASS" if (not apply_filter or total >= min_score) else "FAIL"
        label   = (ev.get("type") or ev.get("event_type") or "")[:40]
        loc     = (ev.get("location") or "")[:30]
        print(
            f"[scoring/gdelt] {verdict} geo={geo_pts}/30 infra={infra_pts}"
            f"({infra_t or '-'})/25 gold={gold_pts}/20 pat={pattern_pts}/15"
            f" choke={choke_pts}/10 total={total} tier={tier}"
            f" | {label} @ {loc}"
        )

        enriched = {
            **ev,
            "relevance_score":     total,
            "severity_tier":       tier,
            "infrastructure_type": infra_t,
            "pattern_detected":    pattern_detected,
            "chokepoint_flag":     choke_f,
            "context":             ctx,
        }

        if apply_filter and total < min_score:
            continue

        results.append(enriched)

    results.sort(
        key=lambda e: (-e["relevance_score"], _tier_order.get(e["severity_tier"], 4))
    )
    return results


def score_news_markers(
    markers: list[dict],
    profile: dict | None,
    apply_filter: bool = True,
) -> list[dict]:
    """
    Score and enrich news conflict markers (from /news-conflicts).

    News markers carry: lat, lon, headline, source, confidence, published,
    location, url, expires_at.

    Goldstein is not available, so `confidence` (high/medium/low) acts as a
    severity proxy:  high=18 pts, medium=12 pts, low=5 pts out of 20.

    Pattern detection is skipped (insufficient structured data for markers).
    """
    if not markers:
        return []

    focus_regions  = list(profile.get("focusRegions", []))  if profile else []
    infra_domains  = set(profile.get("infraDomains", []))   if profile else set()
    chokepoints    = list(profile.get("chokepoints", []))   if profile else []
    threshold_val  = int(profile.get("threshold", 1))       if profile else 1
    min_score      = THRESHOLD_MIN_SCORE.get(threshold_val, DEFAULT_MIN_SCORE)

    results: list[dict] = []

    for m in markers:
        try:
            lat = float(m["lat"])
            lon = float(m["lon"])
        except (KeyError, TypeError, ValueError):
            continue

        geo_pts = _geo_score(lat, lon, focus_regions)

        # Build pseudo-event from headline + location for keyword matching
        pseudo = {
            "type":        m.get("headline", ""),
            "event_type":  "",
            "location":    m.get("location", ""),
            "summary":     m.get("headline", ""),
            "description": m.get("headline", ""),
            "actor":       "",
        }
        infra_pts, infra_t = _infra_score(pseudo, infra_domains)

        conf = (m.get("confidence") or "low").lower()
        conf_pts = {"high": 18, "medium": 12, "low": 5}.get(conf, 8)

        choke_pts, choke_f = _chokepoint_score(lat, lon, chokepoints)

        total = min(100, geo_pts + infra_pts + conf_pts + choke_pts)

        # Tier for news markers (confidence-driven)
        if conf == "high" and total >= 55:
            tier = "significant"
        elif total >= 35:
            tier = "elevated"
        else:
            tier = "low"

        headline = m.get("headline") or "No headline"
        ctx_parts = [f"{headline} — {conf.upper()} confidence."]
        if infra_t:
            ctx_parts.append(f"Potential {infra_t} impact.")
        if choke_f:
            ctx_parts.append("Near monitored chokepoint.")
        context = " ".join(ctx_parts)

        verdict = "PASS" if (not apply_filter or total >= min_score) else "FAIL"
        print(
            f"[scoring/news] {verdict} geo={geo_pts}/30 infra={infra_pts}"
            f"({infra_t or '-'})/25 conf={conf_pts}/18({conf})/20"
            f" choke={choke_pts}/10 total={total} tier={tier}"
            f" | {headline[:80]}"
        )

        enriched = {
            **m,
            "relevance_score":     total,
            "severity_tier":       tier,
            "infrastructure_type": infra_t,
            "pattern_detected":    False,
            "chokepoint_flag":     choke_f,
            "context":             context,
        }

        if apply_filter and total < min_score:
            continue

        results.append(enriched)

    results.sort(key=lambda e: -e["relevance_score"])
    return results
