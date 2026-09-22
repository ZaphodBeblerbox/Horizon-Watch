"""A fire becoming a standing area of interest."""
import firms_aoi as fa


def _fire(lat, lon, frp=None, **kw):
    f = {"lat": lat, "lon": lon, "frp": frp}
    f.update(kw)
    return f


def test_bbox_is_wider_in_degrees_at_high_latitude():
    # A fixed degree box at 60°N covers half the ground it does at the
    # equator, so the degree width has to grow with latitude.
    eq = fa.bbox_for(0, 0)
    hi = fa.bbox_for(60, 0)
    assert (hi["max_lon"] - hi["min_lon"]) > (eq["max_lon"] - eq["min_lon"])


def test_bbox_near_the_pole_does_not_span_the_world():
    b = fa.bbox_for(89.9, 0)
    assert (b["max_lon"] - b["min_lon"]) <= 90.0


def test_polygon_is_closed_and_in_geojson_order():
    p = fa.polygon_for(25.3, 56.36)
    ring = p["coordinates"][0]
    assert ring[0] == ring[-1], "a GeoJSON ring must close"
    lon, lat = ring[0]
    assert 56 < lon < 57 and 25 < lat < 26, "GeoJSON is [lon, lat]"


def test_one_wildfire_is_one_aoi():
    # The real failure mode: a single fire front gives dozens of hotspot
    # pixels across several passes, and one AOI each means scanning the
    # same ground a dozen times over. Kept inside DEDUP_KM on purpose —
    # a front genuinely wider than that IS more than one area to look at.
    fires = [_fire(25.30 + i * 0.0008, 56.36 + i * 0.0008, frp=10 + i) for i in range(20)]
    assert len(fa.dedupe_fires(fires)) == 1


def test_a_cluster_straddling_a_grid_boundary_still_clusters():
    # THE REGRESSION. The first version snapped fires to a coarse grid,
    # so a tight cluster sitting across a cell edge became two AOIs —
    # the same false negative this codebase already documents for fusion
    # geo keys. Rounding is not clustering.
    step = fa.DEDUP_KM / fa.EARTH_KM_PER_DEG
    edge = round(25.0 / step) * step + step / 2      # exactly on a cell edge
    fires = [_fire(edge - 0.001, 56.0, frp=5), _fire(edge + 0.001, 56.0, frp=9)]
    assert len(fa.dedupe_fires(fires)) == 1


def test_a_front_wider_than_the_dedup_radius_is_more_than_one_area():
    fires = [_fire(25.0, 56.0, frp=5), _fire(25.10, 56.0, frp=9)]   # ~11km apart
    assert len(fa.dedupe_fires(fires)) == 2


def test_separate_fires_stay_separate():
    fires = [_fire(25.3, 56.36, frp=10), _fire(40.0, 10.0, frp=5)]
    assert len(fa.dedupe_fires(fires)) == 2


def test_the_strongest_pixel_represents_the_cluster():
    # So the AOI centres on the fire, not on whichever pixel arrived first.
    fires = [_fire(25.300, 56.360, frp=5), _fire(25.302, 56.362, frp=99)]
    kept = fa.dedupe_fires(fires)
    assert len(kept) == 1 and kept[0]["frp"] == 99


def test_fires_without_usable_coordinates_are_dropped():
    fires = [_fire(None, 1), _fire(1, None), _fire("x", "y"), _fire(999, 999), _fire(1, 1)]
    assert len(fa.dedupe_fires(fires)) == 1


def test_an_existing_nearby_aoi_is_reused():
    zones = [{"bbox_min_lat": 25.28, "bbox_max_lat": 25.32,
              "bbox_min_lon": 56.34, "bbox_max_lon": 56.38}]
    assert fa.should_create(25.30, 56.36, zones) is False


def test_a_distant_fire_gets_its_own_aoi():
    zones = [{"bbox_min_lat": 25.28, "bbox_max_lat": 25.32,
              "bbox_min_lon": 56.34, "bbox_max_lon": 56.38}]
    assert fa.should_create(40.0, 10.0, zones) is True


def test_first_fire_ever_creates_an_aoi():
    assert fa.should_create(1.0, 1.0, []) is True


def test_zone_centre_reads_dicts_and_objects():
    class Row:
        bbox_min_lat, bbox_max_lat = 1.0, 3.0
        bbox_min_lon, bbox_max_lon = 5.0, 7.0
    assert fa.zone_centre(Row()) == (2.0, 6.0)
    assert fa.zone_centre({"bbox_min_lat": 1, "bbox_max_lat": 3,
                           "bbox_min_lon": 5, "bbox_max_lon": 7}) == (2.0, 6.0)
    assert fa.zone_centre({}) is None


def test_distance_is_a_real_great_circle():
    # ~111km per degree of latitude; the flat approximation is wrong by
    # enough to matter for a 5km dedup radius.
    assert 110 < fa.km_between(0, 0, 1, 0) < 112
    assert fa.km_between(10, 10, 10, 10) == 0


def test_a_zone_is_never_named_by_a_bare_identifier():
    # Standing rule: never a bare id or coordinate with no context.
    name = fa.zone_name_for(_fire(25.3, 56.36))
    assert "Fire" in name and "25.30" in name and "N" in name and "E" in name
    named = fa.zone_name_for(_fire(-1.5, -2.5, place="Khor Fakkan"))
    assert "Khor Fakkan" in named and "S" in named and "W" in named


def test_the_alert_says_why_it_matters_not_just_that_it_happened():
    txt = fa.fire_alert_text(_fire(1, 1, frp=42, satellite="VIIRS"), detections=[1, 2])
    assert "VIIRS" in txt
    assert "42MW" in txt
    assert "2 objects" in txt
    assert "rescanned" in txt


def test_the_alert_is_honest_when_nothing_was_found():
    txt = fa.fire_alert_text(_fire(1, 1), detections=[])
    assert "no objects found" in txt
