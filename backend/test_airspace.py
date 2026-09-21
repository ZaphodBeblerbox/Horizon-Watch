"""Airspace vertical limits.

This is the part that can be wrong without looking wrong: a ceiling
drawn at the wrong height is still a plausible box in the sky.
"""
import airspace


class TestMetres:
    def test_feet_convert(self):
        assert airspace.metres({"value": 1000, "unit": 1}) == 304.8

    def test_metres_pass_through(self):
        assert airspace.metres({"value": 500, "unit": 0}) == 500.0

    def test_a_flight_level_is_hundreds_of_feet(self):
        # FL95 is 9,500ft by definition — not 95ft, and not 95m.
        assert round(airspace.metres({"value": 95, "unit": 6})) == 2896

    def test_unusable_limits_are_none_not_zero(self):
        # Zero would be sea level, which is a place; None is "unknown".
        for bad in (None, {}, {"value": None, "unit": 1}, {"value": "x", "unit": 1},
                    {"value": 100, "unit": 99}):
            assert airspace.metres(bad) is None


class TestLabel:
    def test_reads_back_the_way_a_controller_says_it(self):
        assert airspace.label({"value": 95, "unit": 6, "referenceDatum": 2}) == "FL95"
        assert airspace.label({"value": 0, "unit": 1, "referenceDatum": 0}) == "GND"
        assert airspace.label({"value": 2500, "unit": 1, "referenceDatum": 1}) == "2500 ft MSL"

    def test_no_label_without_a_value(self):
        assert airspace.label({"unit": 1}) is None
        assert airspace.label(None) is None


SQUARE = [[8.0, 50.0], [8.1, 50.0], [8.1, 50.1], [8.0, 50.1], [8.0, 50.0]]


def _item(**kw):
    base = {
        "_id": "a1", "name": "EDDF CTR", "country": "DE", "icaoClass": 3, "type": 4,
        "geometry": {"type": "Polygon", "coordinates": [SQUARE]},
        "lowerLimit": {"value": 0, "unit": 1, "referenceDatum": 0},
        "upperLimit": {"value": 95, "unit": 6, "referenceDatum": 2},
    }
    base.update(kw)
    return base


class TestNormalise:
    def test_a_complete_airspace_survives_with_both_limits(self):
        a = airspace.normalise(_item())
        assert a["name"] == "EDDF CTR"
        assert a["icao_class"] == "D"
        assert a["floor_label"] == "GND" and a["ceiling_label"] == "FL95"
        assert a["floor_m"] == 0.0 and round(a["ceiling_m"]) == 2896
        assert len(a["ring"]) == 5

    def test_flags_a_pressure_based_volume(self):
        # The caller has to be able to say "approximate" about exactly
        # these, and only these.
        assert airspace.normalise(_item())["pressure_based"] is True
        msl = _item(upperLimit={"value": 2500, "unit": 1, "referenceDatum": 1})
        assert airspace.normalise(msl)["pressure_based"] is False

    def test_an_unclassified_airspace_says_so_rather_than_guessing(self):
        # openAIP uses 8 for airspace it holds with no class assigned.
        assert airspace.normalise(_item(icaoClass=8))["icao_class"] == "unclassified"

    def test_drops_a_volume_with_no_usable_height(self):
        for bad in ({"lowerLimit": None}, {"upperLimit": {"value": "x", "unit": 1}},
                    # ceiling below floor is not a volume
                    {"upperLimit": {"value": 0, "unit": 1, "referenceDatum": 0}}):
            assert airspace.normalise(_item(**bad)) is None

    def test_skips_geometry_it_cannot_draw(self):
        assert airspace.normalise(_item(geometry={"type": "MultiPolygon", "coordinates": []})) is None
        assert airspace.normalise(_item(geometry={"type": "Polygon", "coordinates": [[[8, 50]]]})) is None

    def test_keeps_the_raw_openaip_type_rather_than_inventing_a_name(self):
        # openAIP's `type` is its own enum with no codebook in the
        # payload. A wrong name for a danger area is worse than a number.
        a = airspace.normalise(_item(type=26))
        assert a["openaip_type"] == 26

    def test_ignores_junk(self):
        assert airspace.normalise(None) is None
        assert airspace.normalise("nope") is None
