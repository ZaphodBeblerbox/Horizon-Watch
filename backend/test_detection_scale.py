"""
test_detection_scale.py — the detector was shown objects too small to see.

Reported as "we only detected 7 objects while I test scanned Jebel Ali
port", one of the largest container ports on earth.

YOLOv8-OBB on DOTA was trained on aerial imagery where a ship spans
hundreds of pixels. Sentinel-2 is 10 m/px, so a 300m container ship is 30
pixels — one to two orders of magnitude below anything in training.

What makes this measurable rather than a matter of taste is that a
detector starved of scale does not fail by returning nothing. IT MERGES
NEIGHBOURS. At native resolution this model reported vessels 915m long;
the largest ship ever built is 458m. So the honest test of the fix is not
"more detections" — which interpolation noise would also produce — but
whether the reported objects became physically possible, and whether
confidence rose rather than fell.

    cd backend && python3 -m pytest test_detection_scale.py -q
"""
import sentinel_ml as ml


# ── objects the world does not contain ────────────────────────────────────

def test_a_915m_vessel_is_rejected():
    """THE MEASURED ARTEFACT. At native scale the model boxed a whole berth
    as one ship. The largest vessel ever built is 458m."""
    assert ml.implausible_size("vessel", 915.3) is not None


def test_a_132m_aircraft_is_rejected():
    """Also measured. The An-225 was 84m long — nothing else came close."""
    assert ml.implausible_size("aircraft", 132.2) is not None


def test_real_ships_are_kept():
    """A 400m container ship is ordinary at Jebel Ali and must survive."""
    for length in (45.2, 140.4, 254.0, 399.0):
        assert ml.implausible_size("vessel", length) is None, length


def test_real_storage_tanks_are_kept():
    for length in (27.8, 50.8, 59.5, 100.0):
        assert ml.implausible_size("storage_tank", length) is None, length


def test_something_one_pixel_across_is_rejected():
    """At 10 m/px a 4m object is a sub-pixel guess, not a classification."""
    assert ml.implausible_size("vessel", 4.0) is not None


def test_large_linear_infrastructure_is_bounded_loosely_not_tightly():
    """A quay or a bridge really is kilometres long. The bound exists only
    to catch a box spanning the whole scene, not to second-guess geography."""
    assert ml.implausible_size("port_infrastructure", 1208.5) is None
    assert ml.implausible_size("bridge", 3000.0) is None


def test_an_unbounded_class_is_never_second_guessed():
    """Only classes with a real physical ceiling are policed. Inventing a
    bound for one would silently delete real findings."""
    assert ml.implausible_size("airfield", 99999.0) is None
    assert ml.implausible_size("structural_change", 99999.0) is None


def test_a_detection_with_no_measured_length_is_never_dropped():
    """Missing dimensions mean the corners were not a quadrilateral, which
    is not evidence the object is impossible."""
    assert ml.implausible_size("vessel", None) is None


# ── the reason travels with the rejection ─────────────────────────────────

def test_the_rejection_explains_itself():
    """A detection that vanishes with no reason is indistinguishable from a
    detector that failed to find it, and the two need different fixes."""
    why = ml.implausible_size("vessel", 915.3)
    assert "915" in why and "vessel" in why
    assert "merged" in why


def test_the_two_failure_modes_are_named_differently():
    too_big = ml.implausible_size("vessel", 915.3)
    too_small = ml.implausible_size("vessel", 4.0)
    assert too_big != too_small
    assert "merged" in too_big
    assert "unresolvable" in too_small


# ── the bounds themselves ─────────────────────────────────────────────────

def test_every_bound_is_ordered_and_positive():
    for kind, (lo, hi) in ml.PLAUSIBLE_LENGTH_M.items():
        assert 0 < lo < hi, kind


def test_the_vessel_ceiling_admits_the_largest_ship_ever_built():
    """Seawise Giant, 458.45m. A bound that excluded it would be wrong."""
    lo, hi = ml.PLAUSIBLE_LENGTH_M["vessel"]
    assert hi > 458.45
