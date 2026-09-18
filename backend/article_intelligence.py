"""
article_intelligence.py — Unified article intelligence via Claude Haiku.

Single call per article returning all intelligence fields: location,
article_type, tier (1-4), event_title, icon_type, has_image, is_breaking,
and context_summary.
"""
from __future__ import annotations

import llm_gate
import json
import re

import anthropic

_SYSTEM = (
    "You are an intelligence analyst. Analyse the news article and return ONLY "
    "valid JSON — no preamble, no markdown fences, no explanation."
)

_USER_TMPL = (
    "Title: {title}\n"
    "Source: {source}\n"
    "Body: {body}\n\n"
    "Return a JSON object with exactly these fields:\n"
    '{{\n'
    '  "location": "Extract the most specific geographic location mentioned in this article. '
    "Prefer specific locations in this order: "
    "1. Named facility (airport, port, base, plant, bridge) + city/country. "
    "2. Named city or town. "
    "3. Named region or province. "
    "4. Country (last resort only). "
    "Examples: 'Kuwait International Airport, Kuwait' not 'Kuwait'. "
    "'Port of Rotterdam, Netherlands' not 'Netherlands'. "
    "'Strait of Hormuz' for chokepoint articles. "
    "'Kyiv, Ukraine' for city-level events. "
    "Return ONLY the location string. "
    "Return null if no physical event — company news, stock prices, earnings, sports, celebrity, lifestyle.\",\n"
    '  "location_country": "ISO-3166-1 alpha-2 lowercase country code for the event location. '
    'null if uncertain, international waters, or multi-country.\",\n'
    '  "location_confidence": "city OR region OR country OR none",\n'
    '  "article_type": "conflict OR maritime OR aviation OR infrastructure OR energy OR cyber OR disaster OR political OR economic OR local_incident OR other",\n'
    '  "icon_type": "conflict OR maritime OR aviation OR infrastructure OR energy OR cyber OR disaster OR political OR local_incident OR economic OR other",\n'
    '  "tier": integer 1-4 where:\n'
    "    1 = breaking/urgent security event: active armed conflict, airstrikes, missile launches, "
    "naval incidents, ship attacks, piracy, chokepoint disruptions (Suez/Hormuz/Bab el-Mandeb), "
    "mass casualty events (10+ dead), nuclear/chemical weapon events, coup d'état, "
    "assassination of major figures, major natural disaster (earthquake M6+, major flood).\n"
    "    2 = significant geopolitical/strategic event: military movements/exercises/deployments, "
    "sanctions/trade restrictions/diplomatic expulsion, political crisis/protests with violence, "
    "infrastructure attack or sabotage, any terrorist attack, refugee/displacement crisis, "
    "energy supply disruption, cyberattack on critical infrastructure, election crisis or disputed results.\n"
    "    3 = contextual/background: diplomatic meetings, economic data with geopolitical implications, "
    "general political developments, humanitarian aid, non-violent protests, minor incidents.\n"
    "    4 = irrelevant: local crime (not terrorism), sports, entertainment, celebrity, "
    "local transport/infrastructure (S-Bahn, metro), weather (unless disaster scale), "
    "cultural events, corporate/business news without geopolitical impact.\n"
    "    IMPORTANT: Use tier 2 broadly — when in doubt between tier 2 and 3, choose tier 2.\n"
    '    Assign tier 4 ONLY for clearly irrelevant content (sports, celebrity, local traffic).,\n'
    '  "relevance_score": integer 1-10 — '
    "1-3: Domestic politics, culture, sports, economics with no security angle. "
    "4-5: Regional significance, diplomatic developments. "
    "6-7: Security incidents, military movements, sanctions, protests. "
    "8-9: Active conflict, strikes, explosions, naval incidents, terrorism. "
    "10: Mass casualty event, declaration of war, nuclear/chemical incident.,\n"
    '  "event_title": "Concise 4-8 word label for this event, e.g. \'Missile strike on Kyiv port\' or \'Typhoon Haikui Taiwan landfall\'. null if no specific event.",\n'
    '  "has_image": true or false — true if article likely has an impactful photo worth displaying,\n'
    '  "is_breaking": true or false — true only for tier 1 events reported within the last 6 hours,\n'
    '  "context_summary": "1-2 sentence intelligence summary: what happened, where, and why it matters.",\n'
    '  "entities": array of up to 8 named entities critical to this event. Each object: '
    '{{"name": "entity name", "type": "person|organization|vessel|aircraft|port|airport|location|infrastructure", '
    '"role": "one-word role e.g. attacker/target/operator/authority"}}. '
    'Empty array [] if no significant named entities.\n'
    "}}"
)

HIGH_CONFLICT_COUNTRIES = frozenset({
    "sd", "ss", "ml", "bf", "ne", "td", "cd", "cf", "so", "et",
    "er", "mm", "af", "ye", "sy", "iq", "ua", "ru", "ps", "lb",
    "ly", "mr", "gn", "gw", "ng", "ht", "mx",
})

_FALLBACK: dict = {
    "location": None,
    "location_country": None,
    "location_confidence": "none",
    "article_type": "other",
    "icon_type": "other",
    "tier": 4,
    "relevance_score": 0.0,
    "event_title": None,
    "has_image": False,
    "is_breaking": False,
    "context_summary": "",
    "entities": [],
}

_STRIP_MD = re.compile(r"```(?:json)?\s*|\s*```")


def analyse_article(
    title: str,
    body: str | None = None,
    source: str | None = None,
) -> dict:
    """
    Single Claude Haiku call returning all intelligence fields.
    Never raises — returns _FALLBACK (tier=4) on any failure.
    """
    try:
        import os as _os
        import usage_tracker as _ut
        # Shared default (see usage_tracker.DEFAULT_DAILY_HARD_CAP_USD) — this used
        # to hardcode "0.65" here while main.py hardcoded "10.0" for the SAME env
        # var, so the two code paths self-throttled at wildly different effective
        # daily budgets whenever CLAUDE_DAILY_HARD_CAP_USD was left unset.
        _daily_cap = float(_os.getenv("CLAUDE_DAILY_HARD_CAP_USD", str(_ut.DEFAULT_DAILY_HARD_CAP_USD)))
        _today_cost = _ut.get_today_cost()
        if _today_cost >= _daily_cap:
            print(f"[article-intelligence] Daily cap ${_daily_cap} hit "
                  f"(${_today_cost:.3f}) — returning fallback")
            return dict(_FALLBACK)
        client = llm_gate.get_client("article_intelligence")
        clean_body = re.sub(r"<[^>]+>", "", body or "")[:600]
        user = _USER_TMPL.format(
            title=title or "",
            source=source or "unknown",
            body=clean_body or "not available",
        )
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=500,
            temperature=0,
            system=_SYSTEM,
            messages=[{"role": "user", "content": user}],
        )
        _ut.record_call(
            msg.usage.input_tokens,
            msg.usage.output_tokens,
            call_type="article_intelligence",
            headline=(title or "")[:120],
            model="claude-haiku-4-5-20251001",
        )
        raw = _STRIP_MD.sub("", msg.content[0].text.strip())
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
            tier = int(data.get("tier", 4))
            tier = max(1, min(4, tier))
        except (TypeError, ValueError):
            tier = 4

        try:
            score = float(data.get("relevance_score", 0.0))
            score = max(0.0, min(10.0, score))
        except (TypeError, ValueError):
            score = 0.0

        # Conflict zone promotion: tier 3 → tier 2 for active conflict countries
        _raw_country = (data.get("location_country") or "").lower().strip()[:2]
        if _raw_country and _raw_country in HIGH_CONFLICT_COUNTRIES:
            if tier == 3:
                tier = 2
            if tier == 2:
                score = min(10.0, score * 1.4)

        event_title = data.get("event_title") or None
        if isinstance(event_title, str) and not event_title.strip():
            event_title = None

        raw_entities = data.get("entities") or []
        entities = [
            e for e in raw_entities
            if isinstance(e, dict) and e.get("name")
        ][:8]

        return {
            "location":             location,
            "location_country":     loc_country,
            "location_confidence":  str(data.get("location_confidence", "none")).lower(),
            "article_type":         str(data.get("article_type", "other")).lower(),
            "icon_type":            str(data.get("icon_type", "other")).lower(),
            "tier":                 tier,
            "relevance_score":      score,
            "event_title":          event_title,
            "has_image":            bool(data.get("has_image", False)),
            "is_breaking":          bool(data.get("is_breaking", False)),
            "context_summary":      str(data.get("context_summary", "") or ""),
            "entities":             entities,
        }
    except Exception as ex:
        print(f"[article-intelligence] failed for '{(title or '')[:60]}': {ex}")
        return dict(_FALLBACK)
