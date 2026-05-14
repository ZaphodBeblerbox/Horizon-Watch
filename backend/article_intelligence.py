"""
article_intelligence.py — LLM-based article intelligence extraction via Claude Haiku.

Single call per article to extract:
  - Physical location of the event
  - Article type (conflict/maritime/aviation/etc.)
  - Relevance score (0.0-10.0) for maritime/geospatial intelligence
"""
from __future__ import annotations
import json
import time

import anthropic

_SYSTEM = (
    "You are an intelligence analyst assistant. Given a news article, extract "
    "three things with precision. Return ONLY valid JSON, no preamble, no "
    "markdown, no explanation."
)

_USER_TMPL = (
    "Article title: {title}\n"
    "Article source: {source}\n"
    "Article body (may be truncated): {body}\n\n"
    "Return a JSON object with exactly these fields:\n"
    '{{\n'
    '  "location": "the specific city, region, or country where this event is '
    "PHYSICALLY OCCURRING — not where it is being reported from, not the "
    "nationality of the reporter. If a conflict is happening in Gaza, return Gaza. "
    "If sanctions are being imposed on Iran, return Iran. If a ship sank in the "
    "Red Sea, return Red Sea. If truly no geographic location applies, return null.\",\n"
    '  "location_confidence": "city OR region OR country OR none",\n'
    '  "article_type": "one of: conflict / maritime / aviation / infrastructure / '
    'energy / political / economic / cyber / disaster / other",\n'
    '  "relevance_score": a float 0.0-10.0 where: '
    "9-10 = direct military/maritime/infrastructure threat or incident, "
    "7-8 = significant geopolitical event with operational implications, "
    "5-6 = relevant background intelligence (sanctions, diplomacy, tensions), "
    "3-4 = tangentially related (economics, politics without direct impact), "
    "1-2 = mostly irrelevant to maritime/geospatial intelligence, "
    "0 = completely irrelevant (sports, entertainment, lifestyle),\n"
    '  "relevance_reasoning": "one sentence explaining the score"\n'
    "}}"
)

_FALLBACK: dict = {
    "location": None,
    "location_confidence": "none",
    "article_type": "other",
    "relevance_score": 5.0,
    "relevance_reasoning": "extraction failed",
    "relevance_tier": "medium",
}


def _tier(score: float) -> str:
    if score >= 7.0:
        return "high"
    if score >= 4.0:
        return "medium"
    return "low"


def extract_article_intelligence(
    title: str,
    body: str | None = None,
    source: str | None = None,
) -> dict:
    """
    Single Claude Haiku call. Returns extracted intelligence fields.
    Never raises — returns _FALLBACK dict on any failure.
    """
    try:
        client = anthropic.Anthropic()
        user = _USER_TMPL.format(
            title=title or "",
            source=source or "unknown",
            body=(body[:500] if body else "not available"),
        )
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=150,
            temperature=0,
            system=_SYSTEM,
            messages=[{"role": "user", "content": user}],
        )
        raw = msg.content[0].text.strip()
        # Strip markdown code fences if model wraps output
        if raw.startswith("```"):
            parts = raw.split("```")
            raw = parts[1] if len(parts) > 1 else raw
            if raw.startswith("json"):
                raw = raw[4:].lstrip()
        data = json.loads(raw)

        location = data.get("location")
        if location in (None, "null", "", "None"):
            location = None

        try:
            score = float(data.get("relevance_score", 5.0))
            score = max(0.0, min(10.0, score))
        except (TypeError, ValueError):
            score = 5.0

        return {
            "location":             location,
            "location_confidence":  str(data.get("location_confidence", "none")).lower(),
            "article_type":         str(data.get("article_type", "other")).lower(),
            "relevance_score":      score,
            "relevance_reasoning":  str(data.get("relevance_reasoning", "")),
            "relevance_tier":       _tier(score),
        }
    except Exception as ex:
        print(f"[article-intelligence] failed for '{(title or '')[:60]}': {ex}")
        return dict(_FALLBACK)
