"""The conflict escalation model.

The predecessor measured ZERO skill because it was fitted to six months.
On 37 years it scores 0.178 against the base rate. The tests that matter
are the ones that would let a false score through: leakage, a random
split, and a model that cannot beat the baseline being shown anyway.
"""
import random
import conflict_model as cm


def _series(counts, start=24000):
    """A dense monthly series from a list of event counts."""
    return [{"m": start + i, "events": c, "deaths": c * 2}
            for i, c in enumerate(counts)]


def test_month_index_is_ordered_and_contiguous():
    assert cm.month_index("2020-02") - cm.month_index("2020-01") == 1
    assert cm.month_index("2020-01") - cm.month_index("2019-12") == 1


def test_panel_is_dense_because_a_quiet_month_is_an_observation():
    # Left sparse, "quiet" and "not recorded" become the same thing, and
    # a zero is the most informative month there is.
    rows = [("Mali", "state-based conflict", "2020-01", 4, 9),
            ("Mali", "state-based conflict", "2020-04", 2, 3)]
    panel = cm.to_panel(rows)
    series = panel[("Mali", "state-based conflict")]
    assert len(series) == 4
    assert [r["events"] for r in series] == [4, 0, 0, 2]


def test_features_use_only_the_past():
    """THE LEAKAGE TEST. Changing the future must not change a feature."""
    base = _series([3] * 40)
    i = 30
    before = cm.features_at(base, i)
    tampered = [dict(r) for r in base]
    for j in range(i + 1, len(tampered)):
        tampered[j]["events"] = 999
        tampered[j]["deaths"] = 999
    after = cm.features_at(tampered, i)
    assert before == after, "a feature moved when only the future changed"


def test_the_label_uses_only_the_future():
    base = _series([2] * 30 + [50] * 6)
    i = 28
    lab = cm.label_at(base, i)
    tampered = [dict(r) for r in base]
    for j in range(0, i - cm.BASELINE_M):
        tampered[j]["events"] = 0
    assert cm.label_at(tampered, i) == lab


def test_escalation_is_measured_against_the_locale_not_against_zero():
    # A steady war is not escalating; that is the entire point of the
    # target, because "is there a war on" saturates.
    steady = _series([10] * 40)
    assert cm.label_at(steady, 30) == 0
    rising = _series([2] * 30 + [40] * 10)
    assert cm.label_at(rising, 29) == 1


def test_a_short_series_is_not_modelled():
    assert cm.features_at(_series([1] * 5), 3) is None


def test_the_split_is_temporal_never_random():
    """Every training month must precede every test month."""
    panel = {("X", "state-based conflict"): _series([random.randint(0, 6) for _ in range(120)])}
    X, y, meta = cm.build_dataset(panel)
    tr, te = cm.temporal_split(meta)
    assert tr and te
    assert max(meta[i]["m"] for i in tr) < min(meta[i]["m"] for i in te)


def test_it_refuses_rather_than_reporting_a_score_it_cannot_support():
    tiny = {("X", "state-based conflict"): _series([1] * 40)}
    out = cm.train(tiny)
    assert out["available"] is False
    assert "reason" in out


def test_noise_does_not_produce_skill():
    """A model that finds skill in noise would find it anywhere."""
    random.seed(7)
    panel = {}
    for k in range(40):
        panel[(f"C{k}", "state-based conflict")] = _series(
            [random.randint(0, 5) for _ in range(140)])
    out = cm.train(panel)
    if out.get("available"):
        assert out["skill"] < 0.08, f"found skill {out['skill']} in random data"


def test_brier_and_reliability_arithmetic():
    assert cm.brier([(1.0, 1), (0.0, 0)]) == 0.0
    assert cm.brier([(0.0, 1), (1.0, 0)]) == 1.0
    rel = cm.reliability([(0.9, 1)] * 9 + [(0.9, 0)])
    band = [r for r in rel if r["n"] == 10][0]
    assert band["observed"] == 0.9


def test_predictions_carry_their_arithmetic():
    panel = {("Mali", "state-based conflict"):
             _series([random.randint(1, 8) for _ in range(140)])}
    fit = cm.train(panel)
    if not fit.get("available"):
        return
    preds = cm.predict_latest(panel, fit)
    assert preds
    p = preds[0]
    assert 0.0 <= p["probability"] <= 1.0
    assert "baseline" in p["basis"]


def test_an_unfitted_model_predicts_nothing_rather_than_guessing():
    assert cm.predict_latest({}, {"available": False}) == []


def test_month_label_inverts_month_index():
    # The board reported the raw index as its as-of date, which reads as
    # a serial number rather than a month — and telling a reader how
    # current the forecast is was the entire purpose of the field.
    for ym in ("1989-01", "2019-06", "2025-12", "2026-01", "2026-08"):
        assert cm.month_label(cm.month_index(ym)) == ym


def test_month_label_handles_the_december_january_boundary():
    # Where an off-by-one in the modulo shows up as year 2025 month 13.
    assert cm.month_label(cm.month_index("2025-12")) == "2025-12"
    assert cm.month_label(cm.month_index("2025-12") + 1) == "2026-01"
