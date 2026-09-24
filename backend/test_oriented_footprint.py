"""The hull a detection actually describes, instead of a square."""
import math
import sar_detector as sd


def _dims(corners):
    """(along, across) extent in metres, from the returned corners."""
    def m(a, b):
        dlat = (b[0] - a[0]) * 111_320.0
        dlon = (b[1] - a[1]) * 111_320.0 * math.cos(math.radians(a[0]))
        return math.hypot(dlat, dlon)
    return m(corners[0], corners[3]), m(corners[0], corners[1])


def test_a_long_thin_vessel_is_drawn_long_and_thin():
    # A 300m tanker and a 20m fishing boat came out as identical squares.
    c = sd.oriented_footprint(0.0, 0.0, 300, 40, 0.0)
    along, across = _dims(c)
    assert 290 < along < 310
    assert 35 < across < 45


def test_it_lies_along_its_heading():
    north = sd.oriented_footprint(0.0, 0.0, 200, 20, 0.0)
    east = sd.oriented_footprint(0.0, 0.0, 200, 20, 90.0)
    # Heading 0 runs north-south, so latitude spread dominates.
    assert max(p[0] for p in north) - min(p[0] for p in north) > \
           max(p[1] for p in north) - min(p[1] for p in north)
    # Heading 90 runs east-west, so it is the other way round.
    assert max(e[1] for e in east) - min(e[1] for e in east) > \
           max(e[0] for e in east) - min(e[0] for e in east)


def test_four_corners_in_hull_order():
    c = sd.oriented_footprint(59.4, 24.7, 120, 18, 45.0)
    assert len(c) == 4
    for lat, lon in c:
        assert -90 <= lat <= 90 and -180 <= lon <= 180


def test_longitude_is_scaled_by_latitude():
    # A degree of longitude is half a degree's worth of metres at 60N;
    # ignoring that draws every high-latitude hull twice as wide.
    eq = sd.oriented_footprint(0.0, 0.0, 100, 100, 90.0)
    hi = sd.oriented_footprint(60.0, 0.0, 100, 100, 90.0)
    span = lambda c: max(p[1] for p in c) - min(p[1] for p in c)
    assert span(hi) > span(eq) * 1.8


def test_it_refuses_rather_than_inventing_a_hull():
    assert sd.oriented_footprint(0, 0, 0, 10, 0) is None
    assert sd.oriented_footprint(0, 0, 100, 0, 0) is None
    assert sd.oriented_footprint(0, 0, None, None, 0) is None
    assert sd.oriented_footprint("x", 0, 100, 10, 0) is None


def test_absurd_model_output_is_clamped():
    # Rather than drawing a hull across a whole bay.
    c = sd.oriented_footprint(0.0, 0.0, 99999, 99999, 0.0)
    along, across = _dims(c)
    assert along <= 520 and across <= 130


def test_sixteen_heading_buckets():
    # The attribute head predicts 16, so each is 22.5 degrees. Getting
    # this wrong points every hull the wrong way without looking broken.
    assert sd.HEADING_BUCKETS == 16
    assert 360.0 / sd.HEADING_BUCKETS == 22.5
