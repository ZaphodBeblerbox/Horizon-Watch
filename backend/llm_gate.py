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
# content only, but it is a SECOND model call per report on top of the draft,
# and it is off by default: with credit scarce, the draft itself is what
# earns the spend. submit-for-review still advances the report — the council
# is bypassed, not failed, and says so in the bypass reason.
#
#     HW_LLM_PURPOSES=briefing,council   turns it back on
COUNCIL = "council"

_DEFAULT_ALLOWED = frozenset({BRIEFING})

# Said once per process — see get_client.
_BUDGET_REPORTED = False

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


# ── the month's ceiling ──────────────────────────────────────────────────
#
# There was none. The OpenAI path has had a hard monthly cap since it was
# built, but this one was bounded only by which purposes were switched on —
# so the way to keep Claude spend under control was to leave features
# disabled, and turning any of them on meant turning the cap off. That is
# why fusion narratives, foresight and the council were all off rather than
# budgeted.
#
# A ceiling instead. Spend is read from the same per-call log the OpenAI cap
# uses, so the figure is the one the usage screen shows rather than a
# counter that can drift from it.
BUDGET_USD = float(os.getenv("HW_LLM_BUDGET_USD", "10"))


def month_key() -> str:
    import datetime as _dt
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m")


def spent_this_month() -> float:
    try:
        import usage_tracker
        return float(usage_tracker.anthropic_cost_for_month(month_key()))
    except Exception:
        # A budget that cannot be read must not become a budget of zero:
        # that would disable every Claude feature the moment the usage log
        # is unreadable, which is a storage problem, not a spend problem.
        return 0.0


def over_budget() -> bool:
    return spent_this_month() >= BUDGET_USD


def status() -> dict:
    spent = spent_this_month()
    return {
        "configured": bool(os.getenv("ANTHROPIC_API_KEY")),
        "purposes": sorted(allowed_purposes()),
        "month": month_key(),
        "budget_usd": BUDGET_USD,
        "spent_usd": round(spent, 4),
        "remaining_usd": round(max(0.0, BUDGET_USD - spent), 4),
        "over_budget": spent >= BUDGET_USD,
    }


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
    if over_budget():
        # Said once per process. A line per call would bury the log on the
        # day the budget runs out, which is the day somebody reads it.
        global _BUDGET_REPORTED
        if not _BUDGET_REPORTED:
            print(f"[llm_gate] the month's Claude budget of ${BUDGET_USD:.2f} is "
                  f"spent — every purpose degrades to its non-model behaviour",
                  flush=True)
            _BUDGET_REPORTED = True
        return None
    try:
        import anthropic
    except ImportError:
        return None
    return anthropic.Anthropic(api_key=key)
