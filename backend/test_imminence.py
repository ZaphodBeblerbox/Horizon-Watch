"""The bar for interrupting somebody."""
import imminence as im


def series(vals):
    return [{"m": i, "events": v, "deaths": 0} for i, v in enumerate(vals)]


def test_a_quiet_locale_with_a_high_probability_is_not_imminent():
    # The model can rate escalation likely over a quarter without
    # anything happening this month. That is the board's answer, not a
    # reason to interrupt anyone.
    s = series([5] * 24)
    assert im.assess_locale(s, 0.9) is None


def test_a_surge_without_model_support_is_not_imminent():
    s = series([2] * 23 + [40])
    assert im.assess_locale(s, 0.2) is None


def test_a_real_surge_with_model_support_is():
    s = series([4] * 23 + [40])
    hit = im.assess_locale(s, 0.8)
    assert hit is not None
    assert hit["events_last_month"] == 40
    assert hit["surge"] >= im.MIN_SURGE


def test_a_tiny_locale_cannot_trip_it_by_doubling():
    # One event a month going to three is a 3x surge and means nothing.
    # The absolute floor is what stops a warning built out of noise.
    s = series([1] * 23 + [3])
    assert im.assess_locale(s, 0.9) is None


def test_going_from_nothing_to_something_needs_real_volume():
    # A ratio against a zero baseline is not a number, so the absolute
    # count has to carry it alone.
    assert im.assess_locale(series([0] * 23 + [15]), 0.9) is None
    hit = im.assess_locale(series([0] * 23 + [30]), 0.9)
    assert hit is not None and hit["surge"] is None


def test_a_permanently_busy_locale_is_measured_against_ITSELF():
    # 200 events is alarming somewhere quiet and ordinary in an active
    # war. The baseline is the locale's own twelve months.
    s = series([200] * 23 + [210])
    assert im.assess_locale(s, 0.95) is None


def test_too_little_history_is_refused():
    assert im.assess_locale(series([50] * 6), 0.99) is None


def test_the_thresholds_are_stated_not_buried():
    assert im.MIN_P >= 0.5
    assert im.MIN_SURGE >= 2.0
    assert im.MIN_EVENTS >= 10


def test_scan_survives_an_unfitted_model():
    assert im.scan({}, {}) == []
    assert im.scan({("X", "y"): series([1] * 30)}, {"model": None}) == []


def test_every_warning_carries_a_falsifier():
    # A warning that cannot be wrong is not a warning.
    s = series([4] * 23 + [40])
    hit = im.assess_locale(s, 0.8)
    assert hit  # and the caller builds the sentence
    # scan() is what attaches it; check the shape it produces.
    class _M:
        def predict_proba(self, rows):
            import numpy as np
            return np.array([[0.1, 0.9]] * len(rows))
    panel = {("Ruritania", "state-based conflict"): series([4] * 30 + [40])}
    out = im.scan(panel, {"model": _M()})
    assert out and "falsifier" in out[0]
    assert "fall back to" in out[0]["falsifier"]
