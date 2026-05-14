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
    '  "location": "The SPECIFIC PHYSICAL PLACE where this event is HAPPENING ON THE GROUND RIGHT NOW. Rules: '
    "Return the city, port, strait, region, or country where the physical event occurs — a bombing, a ship "
    "incident, a fire, a protest, a clash. "
    "If the article is about a COMPANY decision (layoffs, stock price, earnings, merger, product launch) → return null. Companies are not locations. "
    "If the article is about a PERSON's statement, speech, or travel with no physical incident → return null. "
    "If the article is about FINANCIAL MARKETS, CURRENCIES, COMMODITIES with no physical location → return null. "
    "If the article mentions a city only because a company is HQ'd there or an official spoke there → return null, that is not where the event is occurring. "
    "If the article is about DIPLOMACY or NEGOTIATIONS, return the country the negotiations are ABOUT, not where the talks are held. "
    "If genuinely uncertain, return null. A wrong location is worse than no location.\",\n"
    '  "location_confidence": "city OR region OR country OR none",\n'
    '  "location_country": "ISO 2-letter country code (lowercase) of the country where the physical event is occurring. '
    'International waters / straits → null. If the location spans multiple countries → null. If uncertain → null.",\n'
    '  "article_type": "one of: conflict / maritime / aviation / infrastructure / '
    'energy / political / economic / cyber / disaster / other",\n'
    '  "relevance_score": a float 0.0-10.0. Rules: '
    "9-10 = direct military/maritime/infrastructure threat or incident. "
    "7-8 = significant geopolitical event with operational implications. "
    "5-6 = relevant background intelligence (sanctions, diplomacy, tensions). "
    "3-4 = tangentially related (economics, politics without direct impact). "
    "1-2 = mostly irrelevant to maritime/geospatial intelligence. "
    "0 = completely irrelevant (sports, entertainment, lifestyle). "
    "STRICT RULES: Any article about company finances, stock prices, earnings, layoffs unrelated to military/strategic industry → maximum 2.0. "
    "Sports, entertainment, lifestyle, celebrity → 0.0. "
    "Technology product launches with no defence/surveillance angle → 1.0. "
    "Only score >= 6.0 if there is a clear physical security, military, maritime, infrastructure, or conflict dimension.,\n"
    '  "relevance_reasoning": "one sentence explaining the score"\n'
    "}}"
)

_FALLBACK: dict = {
    "location": None,
    "location_confidence": "none",
    "location_country": None,
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
            max_tokens=180,
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

        loc_country = data.get("location_country")
        if loc_country in (None, "null", "", "None", "unknown"):
            loc_country = None
        elif isinstance(loc_country, str):
            loc_country = loc_country.lower().strip()[:2] or None

        try:
            score = float(data.get("relevance_score", 5.0))
            score = max(0.0, min(10.0, score))
        except (TypeError, ValueError):
            score = 5.0

        return {
            "location":             location,
            "location_confidence":  str(data.get("location_confidence", "none")).lower(),
            "location_country":     loc_country,
            "article_type":         str(data.get("article_type", "other")).lower(),
            "relevance_score":      score,
            "relevance_reasoning":  str(data.get("relevance_reasoning", "")),
            "relevance_tier":       _tier(score),
        }
    except Exception as ex:
        print(f"[article-intelligence] failed for '{(title or '')[:60]}': {ex}")
        return dict(_FALLBACK)
