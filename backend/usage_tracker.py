"""
usage_tracker.py — Claude API token usage tracking and pre-call gating.

Handles:
  - Persistent token/cost accumulation (usage_log.json)
  - Gate 3: persistent deduplication cache (24h TTL, disk-backed)
  - Budget remaining calculation
  - GET /api/usage stats
"""

from __future__ import annotations

import json
import math
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BASE_DIR       = Path(__file__).resolve().parent
USAGE_LOG_PATH = BASE_DIR / "usage_log.json"

# ── Per-model pricing ──────────────────────────────────────────────────────────
# Previously this module hardcoded ONE flat rate (Sonnet's) for every call type.
# article_intelligence.py's analyse_article() and main.py's _gate1_filter_markers()
# both call Haiku (claude-haiku-4-5), which is ~3x cheaper than Sonnet on both
# input and output tokens — so every recorded "today's cost" for a Haiku call was
# actually ~3x the true dollar cost. Prices below are current Anthropic API rates
# (verified via the claude-api skill's pricing table, cached 2026-06-24):
#   Haiku 4.5:  $1/1M input,  $5/1M output
#   Sonnet 4.x: $3/1M input, $15/1M output
#   Opus:       $5/1M input, $25/1M output  (not currently called anywhere in this
#                                             codebase; included for completeness)
# Keyed by a lowercase substring of the model id — every "claude-sonnet-*" /
# "claude-haiku-*" / "claude-opus-*" id in this codebase matches one entry
# without needing an exact-string table that goes stale on every new dated
# snapshot id.
_PRICE_TABLE: dict[str, tuple[float, float]] = {
    "claude-haiku":  (0.000001, 0.000005),
    "claude-sonnet": (0.000003, 0.000015),
    "claude-opus":   (0.000005, 0.000025),
}
# Preserves the old flat-rate behaviour for any call site that doesn't (yet) pass
# a model= or a recognised call_type — i.e. this is the previous hardcoded price,
# now only the FALLBACK rather than the only rate that exists.
_DEFAULT_PRICE = _PRICE_TABLE["claude-sonnet"]
PRICE_INPUT_PER_TOKEN, PRICE_OUTPUT_PER_TOKEN = _DEFAULT_PRICE  # kept for any external readers

# call_type → model-family hint, used only when a call site records a call
# without an explicit model= (defense in depth — every call site that matters
# for cost accounting has been updated to pass model= explicitly too).
_CALL_TYPE_MODEL_HINT: dict[str, str] = {
    "article_intelligence": "claude-haiku",
    "gate1_relevance":      "claude-haiku",
}

# Single shared default for CLAUDE_DAILY_HARD_CAP_USD. main.py previously
# defaulted this env var to 10.0 while article_intelligence.py defaulted the
# SAME env var to 0.65 — since backend/.env never set it explicitly, the two
# code paths self-throttled Haiku calls at wildly different effective daily
# budgets. Both now import this one constant instead of hardcoding their own
# fallback string.
DEFAULT_DAILY_HARD_CAP_USD = 10.0


def _price_for(model: str | None, call_type: str | None = None) -> tuple[float, float]:
    """Return (input_price_per_token, output_price_per_token) for a call.
    Prefers an explicit model id; falls back to a call_type hint; falls back
    to the historical flat Sonnet-equivalent rate for anything unrecognised."""
    if model:
        m = model.lower()
        for prefix, price in _PRICE_TABLE.items():
            if prefix in m:
                return price
    if call_type:
        hint = _CALL_TYPE_MODEL_HINT.get(call_type)
        if hint:
            return _PRICE_TABLE[hint]
    return _DEFAULT_PRICE


DEDUP_TTL_SECONDS = 24 * 3600

_lock = threading.Lock()


# ── Persistence helpers ───────────────────────────────────────────────────────

def _load() -> dict[str, Any]:
    if USAGE_LOG_PATH.exists():
        try:
            with USAGE_LOG_PATH.open(encoding="utf-8") as fh:
                return json.load(fh)
        except Exception:
            pass
    return {
        "total_input_tokens":  0,
        "total_output_tokens": 0,
        "total_cost_usd":      0.0,
        "calls_total":         0,
        "calls_by_date":       {},
        "dedup_cache":         {},
    }


def _save(data: dict[str, Any]) -> None:
    try:
        USAGE_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with USAGE_LOG_PATH.open("w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)
    except Exception as exc:
        print(f"[usage] save failed: {exc}")


# ── Token recording ───────────────────────────────────────────────────────────

def record_call(
    input_tokens:  int,
    output_tokens: int,
    call_type:     str = "analysis",   # "briefing" | "analysis" | "route" | "background"
    headline:      str = "",
    model:         str | None = None,  # e.g. "claude-haiku-4-5-20251001" — drives correct per-model pricing
) -> None:
    """Accumulate token counts and cost after a successful Claude call."""
    price_in, price_out = _price_for(model, call_type)
    cost  = (input_tokens * price_in) + (output_tokens * price_out)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    now   = time.time()
    with _lock:
        data = _load()
        data["total_input_tokens"]  = data.get("total_input_tokens",  0) + input_tokens
        data["total_output_tokens"] = data.get("total_output_tokens", 0) + output_tokens
        data["total_cost_usd"]      = data.get("total_cost_usd",      0.0) + cost
        data["calls_total"]         = data.get("calls_total",          0) + 1

        # Per-date input/output breakdown
        by_date = data.setdefault("calls_by_date", {})
        day_entry = by_date.setdefault(today, {}) if isinstance(by_date.get(today), dict) else {}
        if isinstance(by_date.get(today), int):
            # Migrate legacy int → dict
            day_entry = {"count": by_date[today]}
        day_entry["count"]  = day_entry.get("count",  0) + 1
        day_entry["cost"]   = round(day_entry.get("cost",  0.0) + cost, 6)
        day_entry["input"]  = day_entry.get("input",  0) + input_tokens
        day_entry["output"] = day_entry.get("output", 0) + output_tokens
        # Per-day call-type breakdown
        types = day_entry.get("types")
        if not isinstance(types, dict):
            types = {}
        types[call_type] = types.get(call_type, 0) + 1
        day_entry["types"] = types
        by_date[today] = day_entry

        # Call-type counters
        by_type = data.setdefault("calls_by_type", {})
        by_type[call_type] = by_type.get(call_type, 0) + 1

        # Track most expensive call this week (rolling 7 days)
        week_ago = now - 7 * 86400
        expensive = data.setdefault("expensive_calls", [])
        expensive.append({"ts": now, "cost": round(cost, 6), "type": call_type, "headline": headline[:120]})
        expensive = [e for e in expensive if e["ts"] >= week_ago]
        expensive.sort(key=lambda e: e["cost"], reverse=True)
        data["expensive_calls"] = expensive[:20]

        _save(data)


def get_stats(budget_usd: float) -> dict[str, Any]:
    """Return usage stats suitable for the /api/usage response."""
    with _lock:
        data = _load()

    total_cost    = float(data.get("total_cost_usd", 0.0))
    remaining     = max(0.0, budget_usd - total_cost)
    remaining_pct = (remaining / budget_usd * 100.0) if budget_usd > 0 else 0.0
    now           = datetime.now(timezone.utc)
    today_str     = now.strftime("%Y-%m-%d")

    by_date = data.get("calls_by_date", {})

    # Helper to extract int count from legacy int or new dict entry
    def _day_count(entry):
        if isinstance(entry, int):   return entry
        if isinstance(entry, dict):  return entry.get("count", 0)
        return 0
    def _day_cost(entry):
        if isinstance(entry, dict):  return entry.get("cost", 0.0)
        return 0.0

    # Last 7 days bar chart
    daily_spend = []
    week_cost   = 0.0
    week_input  = 0
    week_output = 0
    for i in range(6, -1, -1):
        d = (now - __import__("datetime").timedelta(days=i)).strftime("%Y-%m-%d")
        entry = by_date.get(d, {})
        c = _day_cost(entry)
        daily_spend.append({"date": d, "cost": round(c, 4), "calls": _day_count(entry)})
        week_cost   += c
        if isinstance(entry, dict):
            week_input  += entry.get("input",  0)
            week_output += entry.get("output", 0)

    # Current month cost
    month_prefix = now.strftime("%Y-%m")
    month_cost   = sum(_day_cost(v) for k, v in by_date.items() if k.startswith(month_prefix))

    # Most expensive call this week
    week_ago   = time.time() - 7 * 86400
    expensive  = [e for e in data.get("expensive_calls", []) if e.get("ts", 0) >= week_ago]
    top_call   = max(expensive, key=lambda e: e["cost"], default=None)

    calls_today = _day_count(by_date.get(today_str, {}))

    return {
        "total_input_tokens":   int(data.get("total_input_tokens",  0)),
        "total_output_tokens":  int(data.get("total_output_tokens", 0)),
        "total_cost_usd":       round(total_cost,    4),
        "budget_usd":           round(budget_usd,    2),
        "budget_remaining_usd": round(remaining,     4),
        "budget_remaining_pct": round(remaining_pct, 2),
        "calls_today":          int(calls_today),
        "calls_total":          int(data.get("calls_total", 0)),
        # Extended stats
        "week_cost_usd":        round(week_cost,   4),
        "week_input_tokens":    int(week_input),
        "week_output_tokens":   int(week_output),
        "month_cost_usd":       round(month_cost,  4),
        "calls_by_type":        data.get("calls_by_type", {}),
        "daily_spend":          daily_spend,
        "top_call_this_week":   top_call,
    }


def get_today_cost() -> float:
    """Return today's accumulated cost in USD."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    with _lock:
        data = _load()
    entry = data.get("calls_by_date", {}).get(today, {})
    if isinstance(entry, dict):
        return float(entry.get("cost", 0.0))
    return 0.0


def get_calls_today_by_type(call_type: str) -> int:
    """Return today's call count for a given call_type."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    with _lock:
        data = _load()
    entry = data.get("calls_by_date", {}).get(today, {})
    if isinstance(entry, dict):
        types = entry.get("types", {})
        if isinstance(types, dict):
            return int(types.get(call_type, 0))
    return 0


# ── Gate 3: persistent deduplication cache ────────────────────────────────────

def check_dedup(key: str) -> dict[str, Any] | None:
    """Return cached Claude result if key was seen within the last 24 hours."""
    with _lock:
        data  = _load()
        cache = data.get("dedup_cache", {})
        entry = cache.get(key)
    if not entry:
        return None
    if time.time() - float(entry.get("ts", 0)) > DEDUP_TTL_SECONDS:
        return None
    return entry.get("result")


def store_dedup(key: str, result: dict[str, Any]) -> None:
    """Persist a Claude result to the dedup cache and prune stale entries."""
    with _lock:
        data  = _load()
        cache = data.get("dedup_cache", {})
        now   = time.time()
        # Prune expired
        cache = {k: v for k, v in cache.items()
                 if now - float(v.get("ts", 0)) < DEDUP_TTL_SECONDS}
        cache[key] = {"ts": now, "result": result}
        data["dedup_cache"] = cache
        _save(data)


# ── Gate 1: mission profile geographic relevance ──────────────────────────────

def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(min(1.0, a)))


def _bbox_centroid(bbox: tuple[float, float, float, float]) -> tuple[float, float]:
    s, n, w, e = bbox
    return ((s + n) / 2.0, (w + e) / 2.0)


def gate1_profile_relevance(
    lat: float,
    lon: float,
    profile: dict[str, Any] | None,
    focus_region_km: float = 2000.0,
    chokepoint_km:   float = 500.0,
) -> bool:
    """
    Return True if the event is geographically relevant to the mission profile.
    Passes through (True) when:
      - No profile provided
      - Profile has no focus regions AND no chokepoints
      - lat/lon within focus_region_km of any focus region centroid
      - lat/lon within chokepoint_km of any watched chokepoint
    """
    if not profile:
        return True

    focus_regions = profile.get("focusRegions") or []
    chokepoints   = profile.get("chokepoints")  or []

    if not focus_regions and not chokepoints:
        return True   # unconfigured profile → don't filter

    try:
        from scoring import REGION_BBOXES, CHOKEPOINT_LOCS
    except ImportError:
        return True   # scoring unavailable → pass through

    for region_name in focus_regions:
        bbox = REGION_BBOXES.get(region_name)
        if bbox is None:          # "Global" → matches everywhere
            return True
        clat, clon = _bbox_centroid(bbox)
        if _haversine_km(lat, lon, clat, clon) <= focus_region_km:
            return True

    for cp_name in chokepoints:
        cp = CHOKEPOINT_LOCS.get(cp_name)
        if cp is None:
            continue
        clat, clon, _r = cp
        if _haversine_km(lat, lon, clat, clon) <= chokepoint_km:
            return True

    return False


# ── Gate 2: significance threshold ────────────────────────────────────────────

def gate2_significance(
    intensity:    float | None = None,
    source_count: int   | None = None,
    confidence:   str   | None = None,
) -> bool:
    """
    Return True only if item is above significance threshold for Claude analysis.
    - Conflict zone clusters:  intensity > 0.6
    - News conflict events:    source_count > 5  OR  confidence == 'high'
    - No info provided:        pass through
    """
    if intensity is not None:
        return intensity > 0.6
    if source_count is not None:
        return source_count > 5
    if confidence is not None:
        return confidence == "high"
    return True   # unknown type → pass through


def rule_based_summary(
    event_type: str = "",
    location:   str = "unknown location",
    count:      int = 0,
    hours:      int = 72,
) -> str:
    """Plain-English summary generated without a Claude call."""
    _TYPE_MAP = {
        "assault":    "Armed assault reported",
        "clash":      "Armed clashes reported",
        "fight":      "Armed clashes reported",
        "violence":   "Mass violence incident reported",
        "protest":    "Protest activity recorded",
        "force":      "Security force activity reported",
        "coer":       "Coercive action reported",
    }
    base = "Incident reported"
    lower = event_type.lower()
    for kw, phrase in _TYPE_MAP.items():
        if kw in lower:
            base = phrase
            break
    summary = f"{base} in {location}."
    if count > 1:
        summary += f" {count} incidents detected in the past {hours} hours."
    summary += " Signal strength below threshold — automated summary only."
    return summary
