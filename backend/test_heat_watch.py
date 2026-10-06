import heat_watch as hw

PLACES = [{"name": "Khurais oil facility", "kind": "watched", "lat": 25.25, "lon": 48.10},
          {"name": "Some airbase", "kind": "military", "lat": 30.0, "lon": 47.0}]


def test_new_heat_near_a_watched_place_is_notable():
    out = hw.assess([{"lat": 25.252, "lon": 48.095, "frp": 84}], [], PLACES)
    assert len(out) == 1 and out[0]["near"]["name"] == "Khurais oil facility"
    assert hw.headline(out[0], None).startswith("New heat at Khurais oil facility")
    assert hw.severity(out[0]) == "critical"


def test_a_flare_that_burned_before_is_not_new():
    assert hw.assess([{"lat": 25.252, "lon": 48.095, "frp": 84}], [(25.253, 48.096)], PLACES) == []


def test_weak_heat_far_from_anything_is_ignored_but_strong_heat_is_not():
    assert hw.assess([{"lat": 10.0, "lon": 10.0, "frp": 5}], [], PLACES) == []
    assert hw.assess([{"lat": 10.0, "lon": 10.0, "frp": 60}], [], PLACES)[0]["strong"]


def test_pixels_of_one_fire_are_one_event():
    fires = [{"lat": 25.252, "lon": 48.095, "frp": 84}, {"lat": 25.254, "lon": 48.097, "frp": 40}]
    out = hw.assess(fires, [], PLACES)
    assert len(out) == 1 and out[0]["pixels"] == 2 and out[0]["frp_total"] == 124


def test_a_small_fire_near_an_airport_is_a_field_and_fires_in_one_area_are_one_alert():
    ap = [{"name": "Airport", "kind": "airport", "lat": 30.0, "lon": 47.0}]
    assert hw.assess([{"lat": 30.03, "lon": 47.0, "frp": 2}], [], ap) == []
    out = hw.assess([{"lat": 13.5, "lon": 39.5, "frp": 105}, {"lat": 13.55, "lon": 39.55, "frp": 41},
                     {"lat": 13.6, "lon": 39.45, "frp": 36}], [], [])
    assert len(out) == 1 and out[0]["fires"] == 3
    assert hw.headline(out[0], "Ethiopia") == "Strong new heat in Ethiopia (3 fires, up to 105 MW)"
