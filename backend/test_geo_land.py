import geo_land


def test_land_is_named_by_country_and_sea_is_none():
    assert geo_land.country_at(10.0, 20.0) == "Chad"
    assert geo_land.country_at(52.25, 14.25) in ("Germany", "Poland")
    assert geo_land.country_at(30.0, 140.0) is None
