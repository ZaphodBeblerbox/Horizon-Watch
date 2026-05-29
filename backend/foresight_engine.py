"""
foresight_engine.py — Claude-powered escalation foresight per strategic zone.

• Runs once per 6 hours per zone with threat score >= 40.
• Uses Opus for zones >= 55, Sonnet for 40-54.
• Hard cap: 5 analyses per hour.
• Intelligence gathered: 30-day score history, recent alerts,
  active fusions, news surges, tier 1-2 articles — all filtered
  to the zone's bounding box.
"""
from __future__ import annotations

import json
import re
import datetime
from typing import Optional

import anthropic

FORESIGHT_COOLDOWN_HOURS = 6
MAX_ANALYSES_PER_HOUR   = 5

_analyses_this_hour: int = 0
_analyses_hour_start: datetime.datetime = datetime.datetime.utcnow()

_client: Optional[anthropic.Anthropic] = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


def _reset_hourly_counter() -> None:
    global _analyses_this_hour, _analyses_hour_start
    now = datetime.datetime.utcnow()
    if (now - _analyses_hour_start).total_seconds() > 3600:
        _analyses_this_hour  = 0
        _analyses_hour_start = now


def _can_run_analysis() -> bool:
    _reset_hourly_counter()
    return _analyses_this_hour < MAX_ANALYSES_PER_HOUR


def _in_bbox(lat, lon, bbox: dict) -> bool:
    if lat is None or lon is None:
        return False
    try:
        return (bbox["min_lat"] <= float(lat) <= bbox["max_lat"]
                and bbox["min_lon"] <= float(lon) <= bbox["max_lon"])
    except Exception:
        return False


def _gather_zone_intelligence(zone_id: str, zone_name: str, db) -> dict:
    """Collect all available 30-day intelligence for the zone."""
    from threat_matrix import REGIONS
    from database import (
        ThreatSnapshotHourly, Alert, FusionEvent,
        SurgeEvent, NewsArticle,
    )

    now        = datetime.datetime.utcnow()
    cutoff_30d = now - datetime.timedelta(days=30)
    cutoff_7d  = now - datetime.timedelta(days=7)

    bbox = REGIONS.get(zone_id, {}).get("bbox", {})

    def in_zone(lat, lon):
        return _in_bbox(lat, lon, bbox)

    # ── Score history (30 days, every 6th hourly row) ─────────────────────────
    hourly_rows = (
        db.query(ThreatSnapshotHourly)
        .filter(ThreatSnapshotHourly.region_name == zone_id,
                ThreatSnapshotHourly.snapshot_at >= cutoff_30d)
        .order_by(ThreatSnapshotHourly.snapshot_at.asc())
        .all()
    )
    score_history = [
        {"date": r.snapshot_at.strftime("%Y-%m-%d %H:00"),
         "score": round(r.score, 1),
         "level": r.threat_level}
        for r in hourly_rows[::6]   # ~every 6h sample
    ]

    # ── Recent alerts (7d in zone) ───────────────────────────────────────────
    raw_alerts = (
        db.query(Alert)
        .filter(Alert.created_at >= cutoff_7d,
                Alert.lat.isnot(None))
        .all()
    )
    zone_alerts = [
        {"domain":   a.domain or "",
         "rule":     a.rule_name or "",
         "severity": a.severity or "",
         "title":    (a.title or "")[:150],
         "date":     a.created_at.strftime("%Y-%m-%d %H:%M") if a.created_at else ""}
        for a in raw_alerts
        if in_zone(a.lat, a.lon)
    ][:30]

    # ── Active fusions ────────────────────────────────────────────────────────
    raw_fusions = (
        db.query(FusionEvent)
        .filter(FusionEvent.status == "active",
                FusionEvent.lat.isnot(None))
        .all()
    )
    zone_fusions = [
        {"title":      f.title or "",
         "domains":    f.domains or "",
         "confidence": f.confidence,
         "severity":   f.severity or "",
         "created":    f.created_at.strftime("%Y-%m-%d") if f.created_at else ""}
        for f in raw_fusions
        if in_zone(f.lat, f.lon)
    ]

    # ── News surges (7d) ─────────────────────────────────────────────────────
    raw_surges = (
        db.query(SurgeEvent)
        .filter(SurgeEvent.created_at >= cutoff_7d,
                SurgeEvent.lat.isnot(None))
        .all()
    )
    zone_surges = [
        {"headline": (s.headline or "")[:150],
         "severity": s.severity or "",
         "articles": s.article_count or 0,
         "context":  (s.context_summary or "")[:300],
         "why":      (getattr(s, "why_it_matters", None) or "")[:200],
         "date":     s.created_at.strftime("%Y-%m-%d") if s.created_at else ""}
        for s in raw_surges
        if in_zone(s.lat, s.lon)
    ][:10]

    # ── Tier 1+2 articles (30d) ───────────────────────────────────────────────
    raw_articles = (
        db.query(NewsArticle)
        .filter(NewsArticle.created_at >= cutoff_30d,
                NewsArticle.tier.in_([1, 2]),
                NewsArticle.lat.isnot(None))
        .order_by(NewsArticle.relevance_score.desc())
        .all()
    )
    zone_articles = [
        {"title":   (a.event_title or getattr(a, "headline", None) or "")[:150],
         "context": (a.context_summary or "")[:300],
         "source":  (a.source_name or "")[:60],
         "date":    str(a.published_at or ""),
         "tier":    a.tier}
        for a in raw_articles
        if in_zone(a.lat, a.lon)
    ][:25]

    current_score = score_history[-1]["score"] if score_history else 0.0

    return {
        "zone_name":          zone_name,
        "zone_id":            zone_id,
        "score_history_30d":  score_history,
        "current_score":      current_score,
        "alerts_7d":          zone_alerts,
        "active_fusions":     zone_fusions,
        "news_surges_7d":     zone_surges,
        "news_articles_30d":  zone_articles,
        "generated_at":       now.isoformat(),
    }


_FORESIGHT_SYSTEM = (
    "You are a senior intelligence analyst specialising in conflict prediction "
    "and geopolitical risk. Respond with valid JSON only — no preamble, no markdown."
)

_FORESIGHT_USER = """Analyse the following multi-source intelligence data for the {zone_name} strategic zone and provide a structured foresight assessment.

INTELLIGENCE DATA:
{intelligence_json}

Return a JSON object with exactly these fields:
{{
  "situation_summary": "2-3 sentences describing what is actually happening based on the data.",
  "trajectory_assessment": "1-2 sentences on whether the situation is improving, stable, or deteriorating and why.",
  "escalation_probability": {{
    "30_days": <float 0.0-1.0>,
    "probability_basis": "what specific signals are driving this estimate"
  }},
  "early_warning_indicators": [
    {{
      "indicator": "specific observable thing to watch for",
      "domain": "AIS|ADSB|NEWS|SENTINEL|ECONOMIC",
      "significance": "why this matters",
      "current_status": "not_observed|weak_signal|active"
    }}
  ],
  "likely_scenarios": [
    {{
      "scenario": "short name (4-6 words)",
      "probability": <float 0.0-1.0>,
      "description": "what happens and why",
      "timeline": "days|weeks|months",
      "key_triggers": ["specific trigger event"]
    }}
  ],
  "pattern_matches": [
    {{
      "historical_analogue": "name of historical situation this resembles",
      "similarity_basis": "what specifically is similar",
      "similarity_score": <float 0.0-1.0>,
      "outcome_of_analogue": "what happened in that historical case"
    }}
  ],
  "intelligence_gaps": [
    "specific information that would materially change this assessment"
  ],
  "confidence": "low|medium|high",
  "confidence_basis": "why this confidence level",
  "analyst_note": "single most important thing to watch — one sentence"
}}"""


async def run_foresight_analysis(
    zone_id: str,
    zone_name: str,
    current_score: float,
    db,
    force: bool = False,
) -> Optional[dict]:
    """
    Run foresight analysis for one zone.
    Returns the assessment dict or None if skipped/failed.
    """
    global _analyses_this_hour

    if not _can_run_analysis() and not force:
        print(f"[foresight] Hour cap ({MAX_ANALYSES_PER_HOUR}) reached — skipping {zone_name}")
        return None

    # Cooldown check
    if not force:
        from database import ForesightAssessment
        cutoff = datetime.datetime.utcnow() - datetime.timedelta(hours=FORESIGHT_COOLDOWN_HOURS)
        existing = (db.query(ForesightAssessment)
                    .filter(ForesightAssessment.zone_id == zone_id,
                            ForesightAssessment.generated_at >= cutoff)
                    .first())
        if existing:
            return None

    print(f"[foresight] Analysing {zone_name} (score={current_score:.0f})...")

    intel = _gather_zone_intelligence(zone_id, zone_name, db)

    model = "claude-opus-4-5" if current_score >= 55 else "claude-sonnet-4-6"

    intel_str = json.dumps(intel, indent=2)
    if len(intel_str) > 28_000:
        intel["news_articles_30d"] = intel["news_articles_30d"][:10]
        intel_str = json.dumps(intel, indent=2)

    prompt = _FORESIGHT_USER.format(
        zone_name=zone_name,
        intelligence_json=intel_str,
    )

    try:
        client = _get_client()
        response = client.messages.create(
            model=model,
            max_tokens=2000,
            system=_FORESIGHT_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )
        _analyses_this_hour += 1

        raw = response.content[0].text
        match = re.search(r'\{.*\}', raw, re.DOTALL)
        if not match:
            raise ValueError("No JSON in response")
        assessment = json.loads(match.group())

        # Persist
        from database import ForesightAssessment
        db.add(ForesightAssessment(
            zone_id                    = zone_id,
            zone_name                  = zone_name,
            score_at_generation        = current_score,
            model_used                 = model,
            situation_summary          = assessment.get("situation_summary", ""),
            trajectory_assessment      = assessment.get("trajectory_assessment", ""),
            escalation_probability_30d = float(assessment.get("escalation_probability", {}).get("30_days", 0.0)),
            probability_basis          = assessment.get("escalation_probability", {}).get("probability_basis", ""),
            early_warning_indicators   = json.dumps(assessment.get("early_warning_indicators", [])),
            likely_scenarios           = json.dumps(assessment.get("likely_scenarios", [])),
            pattern_matches            = json.dumps(assessment.get("pattern_matches", [])),
            intelligence_gaps          = json.dumps(assessment.get("intelligence_gaps", [])),
            confidence                 = assessment.get("confidence", "low"),
            analyst_note               = assessment.get("analyst_note", ""),
            full_assessment            = json.dumps(assessment),
            generated_at               = datetime.datetime.utcnow(),
            expires_at                 = datetime.datetime.utcnow() + datetime.timedelta(hours=12),
        ))
        db.commit()

        ep = assessment.get("escalation_probability", {}).get("30_days", 0)
        print(f"[foresight] {zone_name} — escalation_30d: {ep:.0%}, "
              f"confidence: {assessment.get('confidence')}, model: {model}")
        return assessment

    except Exception as e:
        import traceback
        print(f"[foresight] {zone_name} failed: {e}")
        traceback.print_exc()
        return None


async def run_foresight_cycle(db, forge_alerts: list = None) -> None:
    """
    Called from background scheduler (hourly).
    Analyses up to 3 qualifying zones per cycle.
    Priority: rapid_escalation > escalating > score >= 55 > score >= 40.
    """
    from threat_matrix import compute_all_zone_scores

    zones = compute_all_zone_scores(db, forge_alerts)

    def _priority(z: dict) -> int:
        traj = z.get("trajectory", "")
        if traj == "rapid_escalation":   return 0
        if traj == "escalating":         return 1
        if z.get("is_escalating"):       return 2
        if z.get("threat_score", 0) >= 55: return 3
        return 9

    candidates = [z for z in zones if z.get("threat_score", 0) >= 40]
    candidates.sort(key=_priority)

    for zone in candidates[:3]:
        await run_foresight_analysis(
            zone["zone_id"],
            zone["zone_name"],
            float(zone.get("threat_score", 0)),
            db,
        )
