"""The viewport query that keeps the map fast.

Loading every aircraft on earth and letting the browser sort it out is
what made the globe slow. These two functions are what replaces that,
so they are tested apart from the endpoint.
"""
import importlib.util
import pathlib
import sys

spec = importlib.util.spec_from_file_location(
    "main_for_test", pathlib.Path(__file__).parent / "main.py")


def _load():
    """Import main.py once, tolerating its heavy import-time work."""
    if "main_for_test" in sys.modules:
        return sys.modules["main_for_test"]
    mod = importlib.util.module_from_spec(spec)
    sys.modules["main_for_test"] = mod
    spec.loader.exec_module(mod)
    return mod


m = _load()


def _ac(lat, lon, **kw):
    a = {"lat": lat, "lon": lon, "military": False, "interesting": False}
    a.update(kw)
    return a


class TestInBbox:
    def test_no_bbox_means_everywhere(self):
        assert m._in_bbox(0, 0, None, None, None, None) is True

    def test_inside_and_outside(self):
        assert m._in_bbox(50, 8, 0, 40, 20, 60) is True
        assert m._in_bbox(50, 30, 0, 40, 20, 60) is False
        assert m._in_bbox(70, 8, 0, 40, 20, 60) is False

    def test_viewport_crossing_the_antimeridian(self):
        # west > east here. A naive west <= lon <= east returns nothing,
        # which looks exactly like "no aircraft over the Pacific".
        assert m._in_bbox(0, 179, 170, -10, -170, 10) is True
        assert m._in_bbox(0, -179, 170, -10, -170, 10) is True
        assert m._in_bbox(0, 0, 170, -10, -170, 10) is False


class TestThinForViewport:
    def test_returns_everything_when_under_the_limit(self):
        got = m._thin_for_viewport([_ac(0, 0), _ac(1, 1)], 700)
        assert len(got) == 2

    def test_caps_at_the_limit(self):
        many = [_ac(50 + i * 0.001, 8 + i * 0.001) for i in range(5000)]
        assert len(m._thin_for_viewport(many, 700)) <= 700

    def test_keeps_every_flagged_aircraft(self):
        many = [_ac(50, 8) for _ in range(3000)]
        many += [_ac(10, 10, military=True), _ac(11, 11, interesting=True)]
        got = m._thin_for_viewport(many, 100)
        assert sum(1 for a in got if a["military"] or a["interesting"]) == 2

    def test_spreads_instead_of_clustering(self):
        # 2,000 over one airport and 20 scattered across an ocean. Taking
        # the first N would drop every one of the scattered aircraft,
        # which are the ones worth seeing on a map.
        dense = [_ac(50.03 + i * 0.0001, 8.57 + i * 0.0001) for i in range(2000)]
        sparse = [_ac(-20 + i * 3, -140 + i * 2) for i in range(20)]
        got = m._thin_for_viewport(dense + sparse, 200)
        kept_sparse = sum(1 for a in got if a["lon"] < -100)
        assert kept_sparse >= 15, f"only {kept_sparse} of 20 ocean aircraft survived"

    def test_never_invents_an_aircraft(self):
        src = [_ac(i, i) for i in range(50)]
        got = m._thin_for_viewport(src, 10)
        for a in got:
            assert a in src
