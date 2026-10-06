def test_a_town_beats_its_province_of_the_same_name():
    from geocode_utils import prefer_settlement
    region = {"lat": 19.80, "lon": 0.73, "class": "boundary", "type": "administrative"}
    town = {"lat": 18.44, "lon": 1.41, "class": "place", "type": "city"}
    assert prefer_settlement([region, town])[0] is town
    assert prefer_settlement([region])[0] is region
