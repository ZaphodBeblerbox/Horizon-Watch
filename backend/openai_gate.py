"""
openai_gate.py — the single place the OpenAI client is constructed.

THE DIVISION OF LABOUR. Claude writes briefings; that is the one job worth
a frontier model, and llm_gate.py keeps every other Claude call switched
off. OpenAI is the cheap all-rounder for everything that is a small,
structured judgement made many times a day — turning a spoken sentence into
an action, filling a gap in the graph, labelling something.

WHY A SECOND GATE RATHER THAN ONE. The two have different budgets, different
failure modes and different lists of what they may be used for. Sharing a
gate would mean one env var deciding both, and "turn the expensive one off
but leave the cheap one on" is precisely the thing that has to be
expressible.

THE BUDGET IS A HARD STOP, NOT A WARNING. A spend ceiling that only logs is
not a ceiling. Past it, get_client() returns None and every caller degrades
to the behaviour it already has for "no key configured" — which they all
support, because that has always been a real state.

    HW_OPENAI_PURPOSES=voice,constellation   turns extra purposes on
    HW_OPENAI_PURPOSES=all                   everything
    OPENAI_BUDGET_USD=11                     the monthly ceiling, USD
    OPENAI_MODEL=gpt-4o-mini                 what the all-rounder runs on
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

# ── purposes ────────────────────────────────────────────────────────────

# Spoken sentences the rule parser could not resolve. The rules handle the
# ordinary phrasings for free and cost nothing; this is the fallback for the
# sentence nobody anticipated, which is where a model actually earns its
# keep.
VOICE = "voice"

# Named but OFF, so the audit reads as a list of decisions rather than as an
# absence. Each is a real place a cheap model would help; none is wired yet.
# Reading a place's signals and saying what they amount to. A separate
# purpose from VOICE because it is a different kind of spend: a voice
# command is ~300 tokens, an explanation carries forty signals.
EXPLAIN = "explain"

# Pulling the facts out of a free-text signal, and giving a useless
# headline a usable one. The highest-volume purpose by far, and the cheapest
# per call because signals are batched.
ENRICH = "enrich"

# Reading a paragraph into a scenario, and reading a scenario against the
# day's signals. Low volume, high value: a scenario is written once and
# read against a changing world many times.
FORECAST = "forecast"

# The day's outlook on the Home screen: named actors, named places, each
# resting on a signal it has to cite. Replaces a block of category-level
# base rates that named nothing.
OUTLOOK = "outlook"

# Writing up a fusion — the cluster of signals from different domains that
# landed on the same place and time. It was a Claude purpose and was off, so
# every fusion fell back to a template that read "Multi-domain intelligence
# signals detected at Unknown Location ... requiring analyst review", which
# names nothing. Claude is reserved for briefings and the decks built from
# them, so this belongs here, under the one monthly cap.
FUSION = "fusion"

KNOWN_PURPOSES = frozenset({
    VOICE, EXPLAIN, ENRICH, FORECAST, OUTLOOK, FUSION,
    "constellation",      # filling gaps between entities in the graph
    "summarise",          # a one-line precis of a long wire report
    "translate",
})

_DEFAULT_ALLOWED = frozenset({VOICE, EXPLAIN, ENRICH, FORECAST, OUTLOOK, FUSION})

DEFAULT_MODEL = "gpt-4o-mini"

# Per-1M-token prices, USD. gpt-4o-mini is the cheap all-rounder: at these
# rates a voice command costs a small fraction of a cent, which is why a
# ten-euro month is thousands of them rather than dozens.
PRICES = {
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4o":      (2.50, 10.00),
    "gpt-4.1-mini": (0.40, 1.60),
    "gpt-4.1-nano": (0.10, 0.40),
}
_FALLBACK_PRICE = PRICES["gpt-4o-mini"]


def allowed_purposes() -> frozenset[str]:
    raw = (os.getenv("HW_OPENAI_PURPOSES") or "").strip()
    if not raw:
        return _DEFAULT_ALLOWED
    if raw.lower() == "all":
        return KNOWN_PURPOSES
    return frozenset(p.strip() for p in raw.split(",") if p.strip())


def is_enabled(purpose: str) -> bool:
    return purpose in allowed_purposes()


def model_for(purpose: str = VOICE) -> str:
    return (os.getenv("OPENAI_MODEL") or "").strip() or DEFAULT_MODEL


def budget_usd() -> float:
    try:
        return float(os.getenv("OPENAI_BUDGET_USD", "11.0"))
    except ValueError:
        return 11.0


def price_for(model: str | None) -> tuple[float, float]:
    """Per-TOKEN prices for a model id, matched on a prefix so a dated
    snapshot id does not fall off the table."""
    m = (model or "").lower()
    for key, (pin, pout) in PRICES.items():
        if m.startswith(key):
            return pin / 1_000_000, pout / 1_000_000
    pin, pout = _FALLBACK_PRICE
    return pin / 1_000_000, pout / 1_000_000


def month_key(now: datetime | None = None) -> str:
    return (now or datetime.now(timezone.utc)).strftime("%Y-%m")


def spent_this_month() -> float:
    """What OpenAI has cost so far this calendar month.

    Read from the same usage log Claude writes to, so there is one answer to
    "what has this system spent" rather than two that have to be added up by
    hand.
    """
    try:
        import usage_tracker
        return usage_tracker.openai_cost_for_month(month_key())
    except Exception:
        # An unreadable log must not become a licence to spend without
        # limit, but it must not block the product either. Reporting zero
        # with the per-call cap still in force is the lesser of the two.
        return 0.0


def over_budget() -> bool:
    cap = budget_usd()
    return cap > 0 and spent_this_month() >= cap


def get_client(purpose: str, api_key: str | None = None):
    """The OpenAI client for this purpose, or None.

    None when: the purpose is off, no key is configured, the SDK is not
    installed, or the month's budget is spent. Every caller treats None as
    "do it without a model", which is the behaviour they have anyway.
    """
    if not is_enabled(purpose):
        return None
    key = api_key or os.getenv("OPENAI_API_KEY")
    if not key:
        return None
    if over_budget():
        return None
    try:
        from openai import OpenAI
    except ImportError:
        return None
    return OpenAI(api_key=key, timeout=20.0, max_retries=1)


def status() -> dict:
    """What the gate is doing, for the health endpoint and for a human
    wondering why a feature is quiet."""
    cap = budget_usd()
    spent = spent_this_month()
    return {
        "configured": bool(os.getenv("OPENAI_API_KEY")),
        "model": model_for(),
        "purposes": sorted(allowed_purposes()),
        "month": month_key(),
        "budget_usd": cap,
        "spent_usd": round(spent, 4),
        "remaining_usd": round(max(0.0, cap - spent), 4),
        "over_budget": over_budget(),
    }
