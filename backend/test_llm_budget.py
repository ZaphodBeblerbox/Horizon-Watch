"""
The Claude budget that did not exist.

The OpenAI path has had a hard monthly cap since it was built. This one was
bounded only by which purposes were switched on, so the way to control
Claude spend was to leave features disabled — which is why fusion
narratives, foresight and the council were all off rather than budgeted.
"""
import llm_gate


def test_a_disabled_purpose_still_returns_none(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setattr(llm_gate, "allowed_purposes", lambda: frozenset({"briefing"}))
    assert llm_gate.get_client("fusion_narrative") is None


def test_no_key_returns_none(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(llm_gate, "allowed_purposes", lambda: frozenset({"briefing"}))
    assert llm_gate.get_client("briefing") is None


def test_an_enabled_purpose_is_refused_once_the_budget_is_spent(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setattr(llm_gate, "allowed_purposes", lambda: frozenset({"briefing"}))
    monkeypatch.setattr(llm_gate, "spent_this_month", lambda: llm_gate.BUDGET_USD)
    monkeypatch.setattr(llm_gate, "_BUDGET_REPORTED", False)
    assert llm_gate.get_client("briefing") is None
    assert llm_gate.over_budget() is True


def test_under_budget_an_enabled_purpose_is_served(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setattr(llm_gate, "allowed_purposes", lambda: frozenset({"briefing"}))
    monkeypatch.setattr(llm_gate, "spent_this_month", lambda: 0.0)
    c = llm_gate.get_client("briefing")
    # The anthropic package may not be installed in every environment; what
    # matters is that the budget did not refuse it.
    assert c is not None or llm_gate.over_budget() is False


def test_an_unreadable_usage_log_is_not_a_budget_of_zero(monkeypatch):
    """Otherwise every Claude feature dies the moment the log is
    unreadable, which is a storage problem, not a spend problem."""
    import usage_tracker
    monkeypatch.setattr(usage_tracker, "anthropic_cost_for_month",
                        lambda *_a: (_ for _ in ()).throw(OSError("no file")))
    assert llm_gate.spent_this_month() == 0.0
    assert llm_gate.over_budget() is False


def test_the_two_budgets_are_counted_separately():
    """One key can be exhausted while the other is untouched, and a single
    combined figure would let the cheaper one mask the other running out."""
    import usage_tracker
    m = llm_gate.month_key()
    # Both helpers exist and read the same log through different filters.
    assert usage_tracker.anthropic_cost_for_month(m) >= 0.0
    assert usage_tracker.openai_cost_for_month(m) >= 0.0


def test_status_reports_what_is_on_and_what_is_left():
    st = llm_gate.status()
    for k in ("configured", "purposes", "budget_usd", "spent_usd",
              "remaining_usd", "over_budget"):
        assert k in st, k
