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

# "Where it stands now" for each war in seed/conflicts.json, written only
# from the system's own recent reports and citing them (conflict_context.py).
CONTEXT = "context"

# The strict extractor that decides whether a Telegram post is a LIVE incident
# and where exactly (live_incident.py, owner 2026-10-22). One short call per
# post that passes the prefilter, capped per hour and day in that module.
LIVE_INCIDENT = "live_incident"

# The one assistant of desktop, phone and voice (assistant.py, DATAMINR_PLAN
# B5-B7): answers a user's own question from our data through tools, with
# citations, and proposes set-up the user confirms. Called only when a user
# asks something the rule path cannot answer; capped per user per day.
ASSISTANT = "assistant"

# The web agent (web_agent.py, owner 2026-10-23): one Responses API call with
# the web_search tool, for a question the assistant could not answer from our
# data, an important incident in a watched place ("what happened at Trappes"),
# or a watched area's recent incidents (off by default). Its own daily caps
# live in that module; each call carries a search fee on top of the tokens.
WEB_AGENT = "web_agent"

# The evolving brief of one event (events.py, DATAMINR_PLAN B3): rewritten only
# when someone watches the place and something material changed; code drops
# every uncited fact. gpt-4o-mini, at most 300 tokens out.
BRIEF = "brief"

KNOWN_PURPOSES = frozenset({
    VOICE, EXPLAIN, ENRICH, FORECAST, OUTLOOK, FUSION, CONTEXT, LIVE_INCIDENT, ASSISTANT, WEB_AGENT, BRIEF,
    "constellation",      # filling gaps between entities in the graph
    "summarise",          # a one-line precis of a long wire report
    "translate",
})

_DEFAULT_ALLOWED = frozenset({VOICE, EXPLAIN, ENRICH, FORECAST, OUTLOOK, FUSION, CONTEXT, LIVE_INCIDENT, ASSISTANT, WEB_AGENT, BRIEF})

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


# ── the account's credit ────────────────────────────────────────────────
# 2026-10-18: the OpenAI credit ran out and every Telegram pass kept calling
# every 15 s, each failing with 429 insufficient_quota, while posts piled up
# unread (0 relevant Telegram posts in two days). A spent account is not a
# transient error: after one such answer the gate says None for
# QUOTA_PAUSE_S, every caller takes its no-model path (rules), and the next
# call after the pause finds out whether the owner has topped up.
QUOTA_PAUSE_S = 15 * 60
_QUOTA = {"until": 0.0, "since": None, "hits": 0, "last": None}


def is_quota_error(e: BaseException) -> bool:
    s = f"{type(e).__name__} {e}"
    return ("insufficient_quota" in s or "credit_balance_exhausted" in s
            or "exceeded your current quota" in s)


def note_error(e: BaseException, now: float | None = None) -> bool:
    """Every model caller's except block calls this. True when the error
    means the account is out of credit (and the gate now pauses)."""
    if not is_quota_error(e):
        return False
    import time as _t
    now = now if now is not None else _t.time()
    if _QUOTA["until"] <= now:
        print(f"[openai] ACCOUNT OUT OF CREDIT — every model pass is paused {QUOTA_PAUSE_S // 60} min and "
              f"rule-based reading takes over: {str(e)[:160]}", flush=True)
    _QUOTA["until"] = now + QUOTA_PAUSE_S
    _QUOTA["since"] = _QUOTA["since"] or datetime.now(timezone.utc).isoformat()
    _QUOTA["hits"] += 1
    _QUOTA["last"] = datetime.now(timezone.utc).isoformat()
    return True


def note_ok() -> None:
    _QUOTA.update(until=0.0, since=None)


def quota_paused(now: float | None = None) -> bool:
    import time as _t
    return _QUOTA["until"] > (now if now is not None else _t.time())


# ── per-purpose shares and daily pacing (DATAMINR_PLAN §2.4, B0) ────────
# Each purpose has a monthly share of OPENAI_BUDGET_USD; a busy day for one
# can no longer starve the others. Purposes not listed share what is left of
# the budget (the reserve). Within its share a purpose spends at most
# (share left) / (days left in the month, today included) x PACE_FACTOR a
# day, so a burst on the 3rd cannot eat the month.
DEFAULT_SHARES = "live_incident:16,brief:4,assistant:7,web_agent:3,voice:1,explain:2,fusion:2,context:1,outlook:1"
PACE_FACTOR = 1.5
RESERVE = "reserve"


def shares() -> dict[str, float]:
    raw = os.getenv("OPENAI_PURPOSE_SHARES")
    raw = DEFAULT_SHARES if raw is None else raw
    out: dict[str, float] = {}
    for part in raw.split(","):
        name, _, usd = part.partition(":")
        try:
            if name.strip():
                out[name.strip()] = max(0.0, float(usd))
        except ValueError:
            continue
    return out


RESERVE_MIN_FRACTION = 0.075         # $3 of $40: what unlisted purposes (enrich, forecast) share at least


def effective_shares() -> dict[str, float]:
    """The shares, scaled down when they would leave less than RESERVE_MIN_FRACTION of the budget (a lower
    OPENAI_BUDGET_USD shrinks every share alike)."""
    sh = shares()
    room = budget_usd() * (1 - RESERVE_MIN_FRACTION)
    total = sum(sh.values())
    if total > room > 0:
        return {k: v * room / total for k, v in sh.items()}
    return sh


def reserve_usd() -> float:
    return max(0.0, budget_usd() - sum(effective_shares().values()))


def _days_left(now: datetime) -> int:
    import calendar
    last = calendar.monthrange(now.year, now.month)[1]
    return last - now.day + 1


_SPEND_CACHE: dict = {"at": 0.0, "key": None, "v": ({}, {})}
SPEND_CACHE_S = 5.0


def _spend(now: datetime) -> tuple[dict, dict]:
    """({purpose: usd this month}, {purpose: usd today}); read from the usage log at most every SPEND_CACHE_S."""
    import time as _t
    key = now.strftime("%Y-%m-%d")
    if _SPEND_CACHE["key"] == key and _t.time() - _SPEND_CACHE["at"] < SPEND_CACHE_S:
        return _SPEND_CACHE["v"]
    try:
        import usage_tracker
        v = (usage_tracker.openai_purpose_spend(month=month_key(now)), usage_tracker.openai_purpose_spend(day=key))
    except Exception:                                          # noqa: BLE001
        v = ({}, {})
    _SPEND_CACHE.update(at=_t.time(), key=key, v=v)
    return v


def purpose_budget(purpose: str, now: datetime | None = None) -> dict:
    """What `purpose` may spend: its share (or the reserve, shared by every unlisted purpose), what it spent this
    month and today, and today's pace allowance."""
    now = now or datetime.now(timezone.utc)
    sh = effective_shares()
    month, today = _spend(now)
    if purpose in sh:
        share, members = sh[purpose], {purpose}
    else:
        share, members = reserve_usd(), {p for p in set(month) | set(today) | {purpose} if p not in sh}
    spent_m = sum(month.get(p, 0.0) for p in members)
    spent_d = sum(today.get(p, 0.0) for p in members)
    left_before_today = max(0.0, share - (spent_m - spent_d))
    allowance = left_before_today / _days_left(now) * PACE_FACTOR
    return {"purpose": purpose, "pool": purpose if purpose in sh else RESERVE, "share_usd": round(share, 4),
            "spent_month_usd": round(spent_m, 5), "spent_today_usd": round(spent_d, 5),
            "today_allowance_usd": round(allowance, 5), "days_left": _days_left(now)}


def refusal(purpose: str, now: datetime | None = None) -> str | None:
    """Why `purpose` may not call the model now, or None. The one place that says it."""
    if not is_enabled(purpose):
        return f"purpose '{purpose}' is not in HW_OPENAI_PURPOSES"
    if not os.getenv("OPENAI_API_KEY"):
        return "no OPENAI_API_KEY"
    if quota_paused():
        return "OpenAI credit exhausted (all model passes paused)"
    if over_budget():
        return "monthly OpenAI budget spent (OPENAI_BUDGET_USD)"
    b = purpose_budget(purpose, now)
    if b["spent_month_usd"] >= b["share_usd"]:
        return f"'{purpose}' spent its monthly share (${b['share_usd']:.2f}, {b['pool']})"
    if b["spent_today_usd"] >= b["today_allowance_usd"]:
        return f"'{purpose}' reached today's pace (${b['today_allowance_usd']:.3f} of ${b['share_usd']:.2f})"
    return None


REFUSED: dict[str, dict] = {}


def note_refused(purpose: str, why: str) -> None:
    r = REFUSED.setdefault(purpose, {"count": 0, "last": None, "why": None})
    if (r["last"] or "")[:10] != datetime.now(timezone.utc).strftime("%Y-%m-%d"):
        # said loudly once a day per purpose: a silent cut-off is a defect (memory: silent failure pattern)
        print(f"[openai] '{purpose}' refused, rule path meanwhile: {why} (GET /api/ai/budget)", flush=True)
    r["count"] += 1
    r["last"] = datetime.now(timezone.utc).isoformat()
    r["why"] = why


def get_client(purpose: str, api_key: str | None = None):
    """The OpenAI client for this purpose, or None.

    None when: the purpose is off, no key is configured, the SDK is not
    installed, the month's budget is spent, the purpose's own share or
    today's pace is spent, or the account answered "no credit" in the last
    QUOTA_PAUSE_S. Every caller treats None as "do it without a model",
    which is the behaviour they have anyway.
    """
    if not is_enabled(purpose):
        return None
    key = api_key or os.getenv("OPENAI_API_KEY")
    if not key:
        return None
    if quota_paused():
        return None
    if over_budget():
        return None
    b = purpose_budget(purpose)
    if b["spent_month_usd"] >= b["share_usd"] or b["spent_today_usd"] >= b["today_allowance_usd"]:
        note_refused(purpose, refusal(purpose) or "share or pace spent")
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
        # out of credit at OpenAI (not our own cap): the owner must top up
        "credit_exhausted": quota_paused() or bool(_QUOTA["since"]),
        "credit_exhausted_since": _QUOTA["since"],
        "credit_errors": _QUOTA["hits"],
        "credit_last_error": _QUOTA["last"],
        "shares": {k: round(v, 2) for k, v in effective_shares().items()},
        "reserve_usd": round(reserve_usd(), 2),
    }
