"""
llm_gate.py — the single place the Anthropic client is constructed.

Every Claude call in this codebase used to build its own client inline
(`anthropic.Anthropic()`), in nine different modules, so there was no way to
answer "what does this system send to the model, and when" without reading
all of them — and no way to turn any of it off without editing twenty-five
call sites.

POLICY. The model is used for BRIEFING GENERATION and nothing else. Every
other caller — fusion narratives, surge headlines, foresight, news scoring,
per-marker enrichment, chat, image reasoning — asks for a client and gets
None. Those paths already handle a missing client, because a missing
ANTHROPIC_API_KEY has always been a supported state; they degrade to their
real, non-model behaviour instead of failing.

Why a gate rather than deleting the calls: the call sites are the product's
history and several are half-built features. Disabling them at one choke
point is reversible, greppable, and cannot be partially applied. Deleting
them is neither.

    HW_LLM_PURPOSES=briefing,fusion   re-enables extra purposes
    HW_LLM_PURPOSES=all               re-enables everything
"""
from __future__ import annotations
import os

# The one purpose that is on.
BRIEFING = "briefing"

# The council (report_council.py) reviews a drafted briefing's own claims
# against its own snapshot and flags overstatement. It runs on briefing
# content and nothing else, so it stays on — as a separate purpose, so it
# can be switched off on its own.
COUNCIL = "council"

_DEFAULT_ALLOWED = frozenset({BRIEFING, COUNCIL})

# Everything that exists and is currently off, named so the audit is
# readable rather than implicit in what is missing.
KNOWN_PURPOSES = frozenset({
    BRIEFING,
    "fusion_narrative", "surge_headline", "foresight", "article_intelligence",
    "marker_enrich", "auto_brief", "chat", "imagery", "threat_matrix",
    "route_analysis", "area_analysis", "event_analysis", "forge", "infrastructure",
    "weekly_snapshot", "council",
})


def allowed_purposes() -> frozenset[str]:
    raw = (os.getenv("HW_LLM_PURPOSES") or "").strip()
    if not raw:
        return _DEFAULT_ALLOWED
    if raw.lower() == "all":
        return KNOWN_PURPOSES
    return frozenset(p.strip() for p in raw.split(",") if p.strip())


def is_enabled(purpose: str) -> bool:
    return purpose in allowed_purposes()


def get_client(purpose: str, api_key: str | None = None):
    """The Anthropic client for this purpose, or None if the purpose is off.

    Returning None rather than raising is deliberate: None is the state every
    one of these call sites already knows how to handle, because running
    without an API key has always been supported. Raising would turn a
    disabled feature into a 500.
    """
    if not is_enabled(purpose):
        return None
    key = api_key or os.getenv("ANTHROPIC_API_KEY")
    if not key:
        return None
    try:
        import anthropic
    except ImportError:
        return None
    return anthropic.Anthropic(api_key=key)
