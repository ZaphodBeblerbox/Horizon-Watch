"""
test_wiki_warmaps.py — control points into faction areas.

These are DERIVED polygons. The source publishes points, and every shape
this module produces is a computed estimate of a boundary nobody drew.
That makes two properties worth pinning: the arithmetic has to be right,
and the derivation has to keep saying it is a derivation — a shape that
looks exactly like DeepStateMap's surveyed Ukraine front while being a
nearest-neighbour guess is the most dangerous output here.

    cd backend && python3 -m pytest test_wiki_warmaps.py -q
"""
import wiki_warmaps as w


# ── reading the source ────────────────────────────────────────────────────

def test_a_mark_becomes_a_point_with_a_faction_colour():
    lua = '{ lat = "14.799", long = "42.949", mark = "Dot green 0d0.svg", label = "[[Al Hudaydah]]" },'
    pts = w.parse_marks(lua)
    assert len(pts) == 1
    assert pts[0]["colour"] == "green"
    assert pts[0]["label"] == "Al Hudaydah"


def test_a_wikilink_label_becomes_plain_text():
    """Labels arrive as "[[Nyala, Sudan#History|Nyala]]"."""
    lua = '{ lat = "12.0", long = "24.8", mark = "Location dot red.svg", label = "[[Nyala, Sudan#History|Nyala]]" },'
    assert w.parse_marks(lua)[0]["label"] == "Nyala"


def test_a_mark_with_no_faction_colour_is_not_control_data():
    """Arrows, peaks without colour and decorations are not claims."""
    lua = '{ lat = "13.0", long = "24.0", mark = "Arrow-plain.svg" },'
    assert w.parse_marks(lua) == []


def test_impossible_coordinates_are_refused():
    lua = '{ lat = "999", long = "42.9", mark = "Dot green 0d0.svg" },'
    assert w.parse_marks(lua) == []


def test_the_colour_vocabulary_covers_the_icons_these_modules_use():
    for icon, want in [("Dot green 0d0.svg", "green"),
                       ("Map-peak-lime.svg", "green"),
                       ("Location dot red.svg", "red"),
                       ("Map-arcNE-blue.svg", "blue"),
                       ("Abm-lime-icon.png", "green")]:
        assert w._colour_of(icon) == want, icon


# ── naming factions ───────────────────────────────────────────────────────

def test_a_colour_is_named_only_where_the_module_documents_it():
    """Red is Russia in Ukraine and the recognised government in Yemen, so
    a generic colour-to-faction table would be confidently wrong."""
    assert w.THEATRES["yemen"]["legend"]["green"] == "Houthi (Ansar Allah)"
    assert w.THEATRES["sudan"]["legend"]["red"] == "Sudanese Armed Forces"


def test_an_undocumented_theatre_still_loads_without_inventing_names():
    """Syria's colours are not declared; it must still be usable."""
    assert "syria" in w.THEATRES
    assert w.THEATRES["syria"]["legend"] == {}


# ── the derivation, and its honesty ───────────────────────────────────────

def test_too_few_points_produce_no_polygons_rather_than_a_guess():
    out = w.polygons.__doc__
    assert out  # the function documents itself as derived
    # Two points cannot be tessellated into meaningful territory.
    import unittest.mock as _m
    with _m.patch.object(w, "fetch", return_value={
            "available": True,
            "points": [{"lat": 1.0, "lon": 1.0, "colour": "red", "faction": "A"},
                       {"lat": 1.0, "lon": 1.0, "colour": "red", "faction": "A"}]}):
        r = w.polygons("yemen")
    assert r["geojson"]["features"] == []
    assert "too few" in (r.get("polygon_error") or "")


def test_duplicate_coordinates_do_not_break_the_tessellation():
    """Two marks on one town is normal in these modules."""
    import unittest.mock as _m
    pts = [{"lat": 15.0 + i * 0.1, "lon": 44.0, "colour": "red", "faction": "A"}
           for i in range(4)]
    pts.append(dict(pts[0]))          # exact duplicate
    with _m.patch.object(w, "fetch", return_value={"available": True, "points": pts}):
        r = w.polygons("yemen")
    assert r.get("polygon_error") is None


def test_every_derived_area_admits_it_is_derived():
    """THE ONE THAT MATTERS. These shapes look identical to a surveyed
    front line, so each must carry the fact that no one drew it."""
    import unittest.mock as _m
    pts = [{"lat": 15.0, "lon": 44.0, "colour": "red", "faction": "A"},
           {"lat": 15.5, "lon": 44.5, "colour": "green", "faction": "B"},
           {"lat": 14.5, "lon": 44.5, "colour": "red", "faction": "A"},
           {"lat": 15.0, "lon": 45.2, "colour": "green", "faction": "B"}]
    with _m.patch.object(w, "fetch", return_value={"available": True, "points": pts}):
        r = w.polygons("yemen")
    feats = r["geojson"]["features"]
    assert feats, "expected derived areas"
    for f in feats:
        assert f["properties"]["derived"] is True
        assert "not asserted" in f["properties"]["how"]


def test_one_area_per_faction_not_one_per_point():
    """The cells are dissolved, or a reader sees a mosaic of a thousand
    slivers instead of two sides."""
    import unittest.mock as _m
    pts = [{"lat": 15.0 + i * 0.2, "lon": 44.0 + (i % 2) * 0.2,
            "colour": "red" if i % 2 else "green",
            "faction": "A" if i % 2 else "B"} for i in range(10)]
    with _m.patch.object(w, "fetch", return_value={"available": True, "points": pts}):
        r = w.polygons("yemen")
    assert len(r["geojson"]["features"]) == 2
