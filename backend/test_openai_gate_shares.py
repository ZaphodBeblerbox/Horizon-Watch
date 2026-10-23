"""openai_gate per-purpose shares, daily pacing and the global stop (DATAMINR_PLAN B0)."""
import datetime as dt

import pytest

import openai_gate as g
import usage_tracker


@pytest.fixture
def ledger(monkeypatch, tmp_path):
    monkeypatch.setattr(usage_tracker, "USAGE_LOG_PATH", tmp_path / "usage.json")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("OPENAI_BUDGET_USD", "40")
    monkeypatch.delenv("OPENAI_PURPOSE_SHARES", raising=False)
    monkeypatch.delenv("HW_OPENAI_PURPOSES", raising=False)
    monkeypatch.setattr(g, "_QUOTA", {"until": 0.0, "since": None, "hits": 0, "last": None})
    monkeypatch.setattr(g, "_SPEND_CACHE", {"at": 0.0, "key": None, "v": ({}, {})})
    monkeypatch.setattr(g, "SPEND_CACHE_S", 0.0)
    return tmp_path


def spend(purpose, usd, model="gpt-4o-mini"):
    # gpt-4o-mini: $0.60 per 1M output tokens
    usage_tracker.record_call(input_tokens=0, output_tokens=int(usd / 0.0000006), call_type=purpose, model=model, purpose=purpose)


def test_defaults_follow_the_plan_and_leave_a_reserve(ledger):
    sh = g.effective_shares()
    assert sh["live_incident"] == 16 and sh["brief"] == 4 and sh["assistant"] == 7
    assert round(g.reserve_usd(), 2) == 3.0


def test_a_lower_budget_shrinks_every_share_alike(ledger, monkeypatch):
    monkeypatch.setenv("OPENAI_BUDGET_USD", "11")
    sh = g.effective_shares()
    assert sum(sh.values()) < 11 and g.reserve_usd() > 0
    assert sh["live_incident"] / sh["brief"] == pytest.approx(4.0)


def test_spend_is_counted_per_purpose_and_survives_the_log_cap(ledger, monkeypatch):
    monkeypatch.setattr(usage_tracker, "CALL_LOG_MAX", 2)
    for _ in range(5):
        spend("brief", 0.01)
    month = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m")
    assert usage_tracker.openai_purpose_spend(month=month)["brief"] == pytest.approx(0.05, rel=1e-3)
    assert usage_tracker.openai_cost_for_month(month) == pytest.approx(0.05, rel=1e-3)   # not 0.02 from the 2 kept entries


def test_a_purpose_stops_at_its_share(ledger, monkeypatch):
    monkeypatch.setenv("OPENAI_PURPOSE_SHARES", "brief:0.5,live_incident:16")
    spend("brief", 0.6)
    assert "monthly share" in (g.refusal("brief") or "")
    assert g.get_client("brief") is None and g.REFUSED["brief"]["count"] >= 1
    assert g.refusal("live_incident") is None                  # another purpose is untouched


def test_daily_pacing_stops_a_burst(ledger, monkeypatch):
    monkeypatch.setenv("OPENAI_PURPOSE_SHARES", "brief:3")
    now = dt.datetime.now(dt.timezone.utc)
    allow = g.purpose_budget("brief", now)["today_allowance_usd"]
    assert allow == pytest.approx(3 / g._days_left(now) * 1.5, rel=1e-3)
    spend("brief", allow + 0.001)
    assert "pace" in (g.refusal("brief", now) or "")


def test_unlisted_purposes_share_the_reserve(ledger):
    spend("enrich", 2.0)
    spend("forecast", 1.1)
    b = g.purpose_budget("enrich")
    assert b["pool"] == "reserve" and b["spent_month_usd"] == pytest.approx(3.1, rel=1e-3)
    assert "monthly share" in (g.refusal("enrich") or "")


def test_the_global_ceiling_stops_everything(ledger, monkeypatch):
    monkeypatch.setenv("OPENAI_BUDGET_USD", "1")
    spend("assistant", 1.2)
    assert "monthly OpenAI budget" in g.refusal("live_incident")
    assert g.get_client("live_incident") is None
