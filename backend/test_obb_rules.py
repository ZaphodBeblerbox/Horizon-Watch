"""Object-recognition rules added 2026-10-17: boxes cut by a tile seam are
left to the tile that sees them whole, one-model detections clear their
class's own bar, and classes too small for the native resolution are not
reported."""
import obb_detect as od
import sentinel_ml as sm


def box(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def test_a_box_on_an_inner_seam_inside_the_overlap_is_left_to_the_neighbour():
    # tile 2 of a row: starts at x=400, 512 wide, overlap 76; image 1200×512
    assert od._cut_by_seam(box(399, 100, 440, 130), 400, 0, 512, 512, 1200, 512, 76)
    # the same cut on the image's own border is the only view there is
    assert not od._cut_by_seam(box(0, 100, 40, 130), 0, 0, 512, 512, 1200, 512, 76)
    # wider than the overlap: no tile sees it whole, keep it
    assert not od._cut_by_seam(box(399, 100, 520, 130), 400, 0, 512, 512, 1200, 512, 76)
    # well inside the tile
    assert not od._cut_by_seam(box(600, 100, 640, 130), 400, 0, 512, 512, 1200, 512, 76)
    # right inner edge
    assert od._cut_by_seam(box(880, 10, 913, 40), 400, 0, 512, 512, 1200, 512, 76)


def test_one_model_detections_clear_their_class_bar(monkeypatch):
    a = [{"cls": "plane", "conf": 0.3, "px": box(0, 0, 10, 10)},
         {"cls": "ship", "conf": 0.3, "px": box(50, 50, 60, 60)}]
    b = [{"cls": "plane", "conf": 0.5, "px": box(100, 100, 110, 110)}]
    runs = {"m1": a, "m2": b}
    monkeypatch.setattr(od, "detect", lambda image, m, model, conf, bounds: runs[model])
    out = od.ensemble(None, 5.0, models=("m1", "m2"))
    got = sorted((d["cls"], d["conf"], d["tier"]) for d in out)
    # the 0.30 one-model plane is gone; the 0.30 ship and the 0.50 plane stay
    assert got == [("plane", 0.5, "probable"), ("ship", 0.3, "probable")]


def test_agreeing_models_keep_the_common_floor(monkeypatch):
    a = [{"cls": "plane", "conf": 0.3, "px": box(0, 0, 10, 10)}]
    b = [{"cls": "plane", "conf": 0.28, "px": box(1, 1, 11, 11)}]
    runs = {"m1": a, "m2": b}
    monkeypatch.setattr(od, "detect", lambda image, m, model, conf, bounds: runs[model])
    out = od.ensemble(None, 5.0, models=("m1", "m2"))
    assert [d["tier"] for d in out] == ["confirmed"]


def test_cars_are_not_reported_at_ten_metres():
    assert sm.unresolvable("small-vehicle", 10.0)
    assert sm.unresolvable("large-vehicle", 10.0)
    assert sm.unresolvable("small-vehicle", 0.5) is None
    assert sm.unresolvable("ship", 10.0) is None
