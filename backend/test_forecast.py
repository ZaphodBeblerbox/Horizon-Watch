"""The event forecaster, and mostly the things it refuses to claim.

The sequence miner in this codebase had three separate statistical
faults that each produced confident, plausible, wrong numbers. These
tests exist to stop the forecaster doing the same.
"""
import datetime as _dt
import math
import forecast as F


def _days(*iso):
    return [_dt.date.fromisoformat(s) for s in iso]


def _daily(start, n, step=1):
    d0 = _dt.date.fromisoformat(start)
    return [d0 + _dt.timedelta(days=i * step) for i in range(n)]


def test_series_needs_locale_type_and_date():
    # A forecast for locale "" is not a forecast.
    ev = [
        {"country": "UA", "violence_type": "state-based conflict", "date": "2026-01-01"},
        {"country": "", "violence_type": "x", "date": "2026-01-01"},
        {"country": "UA", "violence_type": "", "date": "2026-01-01"},
        {"country": "UA", "violence_type": "x", "date": "not-a-date"},
    ]
    s = F.to_series(ev)
    assert list(s) == [("UA", "state-based conflict")]


def test_intensity_never_sees_the_day_it_predicts():
    # Including the day being predicted is how a backtest scores 0.99
    # and means nothing.
    hist = _days("2026-01-01", "2026-01-10", "2026-01-20")
    at = _dt.date.fromisoformat("2026-01-10")
    lam = F.intensity(hist, at, mu=0.0, alpha=1.0, tau=7.0)
    only_first = math.exp(-9 / 7.0)
    assert abs(lam - only_first) < 1e-9, "the 10th and 20th must be excluded"


def test_intensity_decays_with_age():
    hist = _days("2026-01-01")
    near = F.intensity(hist, _dt.date.fromisoformat("2026-01-02"),
                       mu=0, alpha=1, tau=7)
    far = F.intensity(hist, _dt.date.fromisoformat("2026-02-01"),
                      mu=0, alpha=1, tau=7)
    assert near > far


def test_probability_is_a_probability():
    assert F.probability(0) == 0.0
    assert 0 < F.probability(0.01, 14) < 1
    assert F.probability(100, 14) < 1.0000001


def test_base_rate_is_per_day_over_the_observed_span():
    days = _daily("2026-01-01", 10)
    r = F.base_rate(days, days[0], days[-1])
    assert abs(r - 1.0) < 1e-9


def test_windows_label_the_future_not_the_past():
    days = _daily("2026-01-01", 60)
    w = F._windows(days, days[0], days[-1], 7)
    assert w, "there should be evaluation points"
    assert all(isinstance(hit, bool) for _t, hit in w)


def test_brier_rewards_being_right():
    assert F.brier([(1.0, True), (0.0, False)]) == 0.0
    assert F.brier([(0.0, True), (1.0, False)]) == 1.0


def test_excitation_is_global_and_must_earn_itself():
    # Per-series selection on eight validation windows is noise
    # fitting, which measured WORSE than the base rate. One global
    # parameter pair, or none at all.
    series = {(f"L{i}", "t"): _daily("2026-01-01", 120, 2) for i in range(6)}
    models = F.fit(series, horizon=14)
    assert models
    alphas = {m["alpha"] for m in models.values()}
    assert len(alphas) == 1, "excitation must be one global value, not per series"
    sel = next(iter(models.values()))["selection"]
    assert sel["global_alpha"] == next(iter(alphas))


def test_a_model_that_cannot_beat_the_base_rate_becomes_the_base_rate():
    # Perfectly regular events have no excitation to find; claiming one
    # would be inventing structure.
    series = {("L", "t"): _daily("2026-01-01", 100, 3)}
    models = F.fit(series, horizon=14)
    if models:
        m = next(iter(models.values()))
        if not m["excited"]:
            assert m["alpha"] == 0.0


def test_skill_is_measured_against_the_locales_own_base_rate():
    # Beating a global average is easy and means nothing, because
    # violence is concentrated.
    series = {("L", "t"): _daily("2026-01-01", 120, 2)}
    models = F.fit(series, horizon=14)
    bt = F.backtest(series, models, horizon=14)
    assert "skill_vs_base_rate" in bt
    assert bt["baseline_brier"] is not None


def test_reliability_reports_observed_against_stated():
    # Discrimination is not calibration. A model that says 90% and
    # means 50% is worse than useless in a briefing.
    pairs = [(0.9, True)] * 9 + [(0.9, False)]
    rel = F.reliability(pairs)
    band = [r for r in rel if r["n"] == 10][0]
    assert band["observed"] == 0.9


def test_it_refuses_to_forecast_from_stale_evidence():
    # THE IMPORTANT ONE. A base rate computed over a window that closed
    # three months ago, printed as "probability over the next 14 days",
    # reads as a live assessment and is a historical average. The real
    # UCDP copy ends 2026-06-30, 84 days before today.
    series = {("L", "t"): _daily("2026-01-01", 120)}
    models = F.fit(series, horizon=14)
    at = _dt.date.fromisoformat("2026-09-22")
    out = F.forecast(series, models, at=at, horizon=14)
    assert out["forecasts"] == []
    assert out["refused_stale"], "a refusal must be reported, not silent"
    assert out["refused_stale"][0]["age_days"] > 14
    assert out["refused_stale"][0]["data_ends"]


def test_stale_data_can_be_forecast_only_on_explicit_opt_in():
    series = {("L", "t"): _daily("2026-01-01", 120)}
    models = F.fit(series, horizon=14)
    at = _dt.date.fromisoformat("2026-09-22")
    out = F.forecast(series, models, at=at, horizon=14, allow_stale=True)
    assert out["forecasts"]
    assert out["forecasts"][0]["data_age_days"] > 14


def test_fresh_evidence_forecasts_normally():
    end = _dt.date.today()
    days = [end - _dt.timedelta(days=i) for i in range(120)][::-1]
    series = {("L", "t"): days}
    models = F.fit(series, horizon=14)
    out = F.forecast(series, models, at=end, horizon=14)
    assert out["forecasts"]
    assert out["forecasts"][0]["data_age_days"] <= 14


def test_a_saturated_forecast_says_so():
    # P(at least one) is ~1.00 for an actively violent locale and
    # carries no information; 1.00 must not be mistaken for insight.
    end = _dt.date.today()
    days = [end - _dt.timedelta(days=i) for i in range(200)][::-1]
    series = {("L", "t"): days}
    models = F.fit(series, horizon=14)
    out = F.forecast(series, models, at=end, horizon=14)
    assert out["forecasts"][0]["saturated"] is True
    assert "saturated" in out["note"]


def test_every_forecast_carries_its_arithmetic_and_a_caveat():
    end = _dt.date.today()
    days = [end - _dt.timedelta(days=i * 2) for i in range(80)][::-1]
    models = F.fit({("L", "t"): days}, horizon=14)
    out = F.forecast({("L", "t"): days}, models, at=end, horizon=14)
    f = out["forecasts"][0]
    assert "base rate" in f["basis"]
    assert f["caveat"]


def test_an_empty_dataset_does_not_throw():
    assert F.fit({}, horizon=14) == {}
    out = F.forecast({}, {}, horizon=14)
    assert out["forecasts"] == []
