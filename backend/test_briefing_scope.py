from briefing_scope import parts, box_for


def test_parts_split_the_subject_into_places():
    assert parts("Yemen and the Red Sea") == ["Yemen", "Red Sea"]
    assert parts("Sudan / Chad, Libya") == ["Sudan", "Chad", "Libya"]


def test_named_places_and_the_geocoder_union_into_one_box():
    geo = {"Yemen": [{"boundingbox": ["12.1", "19.0", "42.5", "54.5"]}]}
    b = box_for("Yemen and the Bab el-Mandeb", geocode=lambda q: geo.get(q, []))
    assert b[0] <= 12.1 and b[1] >= 19.0 and b[3] >= 54.5      # Yemen, and the strait's radius around 12.6N 43.4E
    assert box_for("Atlantis", geocode=lambda q: []) is None
