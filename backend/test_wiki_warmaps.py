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


def test_a_curated_legend_only_fills_what_the_module_does_not_publish():
    """Syria's /doc names red, blue, green, grey and black at runtime, so
    the curated table only has to carry what it leaves — and must not
    shadow it."""
    curated = set(w.THEATRES["syria"]["legend"])
    assert "yellow" in curated          # not in the module's own table
    assert "red" not in curated         # the module names this one


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


# ── no unnamed factions, guaranteed by refusal ────────────────────────────
#
# Asked to make sure the map never shows an unnamed faction. The guarantee
# is kept by NOT OFFERING a war whose colours cannot all be named, rather
# than by inventing names — "unnamed faction (grey)" is merely unhelpful,
# but a confidently mislabelled belligerent on a control map is the worst
# output this system can produce.

def test_every_war_is_offered_even_without_a_legend():
    """POLICY REVERSED, deliberately. These wars were withheld to avoid
    showing an unnamed colour, which hid real geography — how fragmented
    a war is and where its boundaries run is legible without knowing the
    sides' names. They are offered; the sides are labelled unidentified."""
    rows = {t["key"]: t for t in w.theatres()}
    for key in ("myanmar", "libya", "somalia", "mali"):
        assert rows[key]["available"] is True, key
        assert rows[key]["legend_known"] is False, key
        assert rows[key]["reason"], f"{key} must say why its sides are unnamed"


def test_a_war_with_a_legend_is_marked_as_having_one():
    rows = {t["key"]: t for t in w.theatres()}
    assert rows["yemen"]["legend_known"] is True
    assert rows["yemen"]["reason"] is None


def test_an_unnamed_side_is_worded_never_left_blank(monkeypatch):
    """A null faction renders as an empty line. The reader must be TOLD
    the side is unknown, which is a different thing from being shown
    nothing — and must never be told a guess."""
    monkeypatch.setattr(w, "fetch_legend", lambda t: {})
    monkeypatch.setattr(w, "_get", lambda p: {"query": {"pages": {"1": {"revisions": [{
        "timestamp": "2026-09-17T00:00:00Z",
        "slots": {"main": {"*":
            '{ lat = "20.0", long = "96.0", mark = "Location dot red.svg" },'}}}]}}}})
    w._CACHE.clear()
    d = w.fetch("myanmar", force=True)
    p = d["points"][0]
    assert p["faction_known"] is False
    assert "unidentified" in p["faction"]
    assert d["legend_available"] is False
    assert d["legend_note"]


def test_no_colour_reaches_the_map_without_a_name(monkeypatch):
    """THE GUARANTEE ITSELF, checked the way it actually holds.

    Coverage is a RUNTIME property: the curated table fills only what the
    module's /doc does not publish, so inspecting either alone proves
    nothing. This drives the real merge with a stubbed /doc, then asserts
    that every colour present in the data is named.
    """
    monkeypatch.setattr(w, "fetch_legend", lambda t: {"red": "From the module"})
    monkeypatch.setattr(w, "_get", lambda p: {"query": {"pages": {"1": {"revisions": [{
        "timestamp": "2026-09-17T00:00:00Z",
        "slots": {"main": {"*": (
            '{ lat = "15.0", long = "44.0", mark = "Location dot red.svg" },'
            '{ lat = "15.1", long = "44.1", mark = "Dot green 0d0.svg" },'
            '{ lat = "15.2", long = "44.2", mark = "Location dot blue.svg" },'
        )}}}]}}}})
    w._CACHE.clear()
    d = w.fetch("yemen", force=True)
    assert d["available"]
    assert d["unlabelled_colours"] == [], d["unlabelled_colours"]
    for p in d["points"]:
        assert p["faction"], f"{p['colour']} reached the map unnamed"


def test_where_each_name_came_from_is_recorded(monkeypatch):
    """A wrong faction has to be traceable to the source that asserted it
    — the editors' table or this file's own curated fallback."""
    monkeypatch.setattr(w, "fetch_legend", lambda t: {"red": "From the module"})
    monkeypatch.setattr(w, "_get", lambda p: {"query": {"pages": {"1": {"revisions": [{
        "timestamp": "2026-09-17T00:00:00Z",
        "slots": {"main": {"*": (
            '{ lat = "15.0", long = "44.0", mark = "Location dot red.svg" },'
            '{ lat = "15.1", long = "44.1", mark = "Dot green 0d0.svg" },'
        )}}}]}}}})
    w._CACHE.clear()
    d = w.fetch("yemen", force=True)
    assert d["legend_source"]["red"] == "module /doc"
    assert d["legend_source"]["green"] == "curated"


# ── the palette confusion that produced a wrong belligerent ───────────────

def test_an_article_hex_is_not_used_to_name_an_icon_colour():
    """Sudan's SAF is #FFCDCD on the static SVG — a pale pink, which
    nearest-RGB bucketing called "yellow". Naming the module's yellow
    icons from it labelled SPLM-N as the Sudanese Armed Forces. Two
    palettes for two maps; matching one against the other is a category
    error, and the guard is that fetch() no longer consults it."""
    import inspect
    src = inspect.getsource(w.fetch)
    assert "fetch_article_legend" not in src


def test_template_parameters_are_not_mistaken_for_factions():
    """"type = notice" appeared as a faction because it sits in a table
    cell. A faction name is prose, not an assignment."""
    lua = "|-\n|type      = notice\n|[[File:Location dot orange.svg|11px]]\n"
    assert w.parse_legend(lua) == {}


def test_a_mixed_control_row_never_names_a_colour():
    """A row whose icons span several colours is a contested-control key,
    not a faction, and naming a colour from it mislabels everything drawn
    in that colour."""
    lua = ("|-\n|Contested\n|[[File:Location dot red.svg|11px]]\n"
           "|[[File:Location dot green.svg|11px]]\n")
    assert w.parse_legend(lua) == {}


def test_a_real_legend_row_is_read():
    lua = ("|-\n|[[Assadism|Assadist]] forces and [[Russian Armed Forces]]\n"
           "|[[File:Location dot red.svg|11px]]\n"
           "|[[File:Abm-red-icon.png|13px]]\n")
    assert w.parse_legend(lua) == {"red": "Assadist forces and Russian Armed Forces"}
