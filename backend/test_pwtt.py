"""
test_pwtt.py — change detection on SAR amplitude.

Synthetic stacks with a known answer, because the properties that matter
cannot be checked by eye on a radar scene: that an unchanged scene reports
nothing, that rain does not report a city as destroyed, that a destroyed
building gets DARKER rather than brighter, and that speckle is not a
building.

    cd backend && python3 -m pytest test_pwtt.py -q
"""
import numpy as np
import pytest

import pwtt

BOUNDS = {"west": 56.30, "south": 25.28, "east": 56.42, "north": 25.40}
H = W = 40
RNG = np.random.default_rng(7)


def stack(n, base=100.0, noise=6.0, shape=(H, W)):
    """A quiet stack: constant backscatter plus speckle."""
    return base + RNG.normal(0, noise, size=(n, *shape))


# ── the scene that did not change ─────────────────────────────────────────

def test_an_unchanged_scene_reports_nothing():
    """The headline property. Two stacks of the same quiet ground must not
    manufacture findings out of speckle."""
    out = pwtt.detect_change(stack(8), stack(8), BOUNDS)
    assert out["detections"] == []
    assert out["changed_fraction"] < 0.02


def test_rain_across_the_whole_scene_is_not_a_destroyed_city():
    """Soil moisture moves every pixel together. Without removing the
    scene-level shift, the first wet week reports the entire area as
    changed."""
    before = stack(8)
    after = stack(8) + 25.0            # everything brighter, uniformly
    out = pwtt.detect_change(before, after, BOUNDS)
    assert out["detections"] == [], "a uniform scene shift produced findings"


# ── the scene that did ────────────────────────────────────────────────────

def test_something_appearing_is_found_and_located():
    before = stack(8)
    after = stack(8)
    after[:, 10:16, 20:26] += 70.0      # a new hard scatterer
    out = pwtt.detect_change(before, after, BOUNDS)
    assert out["detections"], "a strong new structure was missed"
    d = out["detections"][0]
    assert d["change_direction"] == "appeared"
    # It must land inside the patch, not merely somewhere in the scene.
    lat_per_px = (BOUNDS["north"] - BOUNDS["south"]) / H
    lon_per_px = (BOUNDS["east"] - BOUNDS["west"]) / W
    exp_lat = BOUNDS["north"] - 13 * lat_per_px
    exp_lon = BOUNDS["west"] + 23 * lon_per_px
    assert abs(d["centroid_lat"] - exp_lat) < lat_per_px * 3
    assert abs(d["centroid_lon"] - exp_lon) < lon_per_px * 3


def test_a_destroyed_building_gets_darker_not_brighter():
    """The counter-intuitive part, and the reason damage detection works at
    all: rubble scatters diffusely, so it returns LESS signal than the
    walls and corners it replaced."""
    before = stack(8)
    before[:, 5:11, 5:11] += 70.0       # a building standing
    after = stack(8)                     # and gone
    out = pwtt.detect_change(before, after, BOUNDS)
    assert out["detections"]
    assert out["detections"][0]["change_direction"] == "removed"


def test_direction_can_be_restricted():
    before = stack(8)
    after = stack(8)
    after[:, 10:16, 20:26] += 70.0
    assert pwtt.detect_change(before, after, BOUNDS, direction="increase")["detections"]
    assert pwtt.detect_change(before, after, BOUNDS, direction="decrease")["detections"] == []


# ── speckle is not a building ─────────────────────────────────────────────

def test_a_single_bright_pixel_is_not_a_finding():
    """SAR is inherently speckly. One pixel is never a structure."""
    before = stack(8)
    after = stack(8)
    after[:, 20, 20] += 200.0
    out = pwtt.detect_change(before, after, BOUNDS)
    assert out["detections"] == []


def test_a_region_is_reported_once_not_per_pixel():
    before = stack(8)
    after = stack(8)
    after[:, 10:18, 10:18] += 70.0
    out = pwtt.detect_change(before, after, BOUNDS)
    assert len(out["detections"]) == 1
    assert out["detections"][0]["pixels"] >= 30


def test_two_separate_changes_are_two_findings():
    before = stack(8)
    after = stack(8)
    after[:, 5:11, 5:11] += 70.0
    after[:, 28:34, 28:34] += 70.0
    assert len(pwtt.detect_change(before, after, BOUNDS)["detections"]) == 2


# ── refusing to guess ─────────────────────────────────────────────────────

def test_too_few_acquisitions_is_refused_not_estimated():
    """With two dates there is no variance, and a t-statistic computed from
    it is noise with decimal places."""
    with pytest.raises(pwtt.NotEnoughData):
        pwtt.detect_change(stack(2), stack(8), BOUNDS)
    with pytest.raises(pwtt.NotEnoughData):
        pwtt.detect_change(stack(8), stack(2), BOUNDS)


def test_mismatched_footprints_are_refused():
    """Comparing different ground would report the difference between two
    places as a change in one."""
    with pytest.raises(ValueError):
        pwtt.welch_t(stack(5), stack(5, shape=(H, W + 4)))


def test_a_perfectly_constant_pixel_does_not_become_infinite():
    """Zero variance means too few looks, not perfect stability."""
    before = np.full((6, 8, 8), 50.0)
    after = np.full((6, 8, 8), 50.0)
    after[:, 3, 3] = 51.0
    t = pwtt.welch_t(before, after)
    assert np.isfinite(t).all()


# ── honesty of the output ─────────────────────────────────────────────────

def test_a_wholesale_shift_is_flagged_rather_than_reported_as_findings():
    """A third of a scene 'changing' is systematic — a different orbit, a
    processing change, weather. Saying so beats emitting 4,000 findings."""
    before = stack(8)
    after = stack(8)
    after[:, :, : W // 2] += 60.0        # half the scene, not a structure
    out = pwtt.detect_change(before, after, BOUNDS)
    assert out["suspect_wholesale_shift"] is True


def test_strength_is_not_presented_as_a_probability():
    before = stack(8)
    after = stack(8)
    after[:, 10:16, 20:26] += 70.0
    d = pwtt.detect_change(before, after, BOUNDS)["detections"][0]
    assert 0.0 <= d["strength"] <= 1.0
    assert "confidence" not in d
    assert "probability" not in d


def test_every_finding_says_it_is_a_cue_not_a_conclusion():
    before = stack(8)
    after = stack(8)
    after[:, 10:16, 20:26] += 70.0
    out = pwtt.detect_change(before, after, BOUNDS)
    assert "cue" in out["note"]
    assert out["detections"][0]["corroborated"] is False
    assert out["detections"][0]["provenance"] == "sar_change"


def test_area_is_reported_in_real_units():
    before = stack(8)
    after = stack(8)
    after[:, 10:16, 20:26] += 70.0
    d = pwtt.detect_change(before, after, BOUNDS, m_per_px=10.0)["detections"][0]
    assert d["area_m2"] == pytest.approx(d["pixels"] * 100.0)


# ── how often it is wrong ─────────────────────────────────────────────────
#
# A single seed proves nothing about a statistical detector. These two run
# the whole pipeline over many independent scenes and assert the rates,
# which is the only way to know that the speckle filtering is sound rather
# than lucky.

def test_pure_noise_almost_never_produces_a_finding():
    """Measured over 800 scene pairs while building this: zero false
    findings at every stack depth. Held to a small allowance here so the
    test is not brittle, but a regression to the pre-opening behaviour —
    where percolating speckle produced a 256-pixel 'structure' — fails this
    immediately."""
    for n in (4, 8):
        rng = np.random.default_rng(4242 + n)
        false_scenes = 0
        trials = 60
        for _ in range(trials):
            a = 100 + rng.normal(0, 6, size=(n, 40, 40))
            b = 100 + rng.normal(0, 6, size=(n, 40, 40))
            if pwtt.detect_change(a, b, BOUNDS)["detections"]:
                false_scenes += 1
        assert false_scenes <= 1, (
            f"stack n={n}: {false_scenes}/{trials} pure-noise scenes produced findings"
        )


def test_a_real_structure_is_found_essentially_every_time():
    """A 6x6 px patch is 60x60 m at Sentinel resolution — a building
    cluster, a vehicle park, a camp. Measured 100/100 at every depth."""
    for n in (4, 8):
        rng = np.random.default_rng(777 + n)
        hits = 0
        trials = 40
        for _ in range(trials):
            a = 100 + rng.normal(0, 6, size=(n, 40, 40))
            b = 100 + rng.normal(0, 6, size=(n, 40, 40))
            b[:, 10:16, 20:26] += 40.0
            if pwtt.detect_change(a, b, BOUNDS)["detections"]:
                hits += 1
        assert hits >= trials - 1, f"stack n={n}: only {hits}/{trials} detected"


def test_the_raw_threshold_rate_is_reported_separately():
    """~13% of pixels clear |t|>=1.63 by chance. Presenting that as
    'changed' would be alarming and wrong, so the surviving fraction and
    the raw flagged fraction are both reported."""
    out = pwtt.detect_change(stack(8), stack(8), BOUNDS)
    assert out["raw_flagged_fraction"] > out["changed_fraction"]
    assert out["changed_fraction"] < 0.02
