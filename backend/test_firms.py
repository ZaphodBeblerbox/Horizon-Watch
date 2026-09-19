"""NASA FIRMS as a scan trigger, and everything it must refuse to trigger on."""
import firms


def test_it_says_plainly_when_it_cannot_run(monkeypatch):
    """An empty list reads as "no fires". A missing key is not no fires."""
    monkeypatch.delenv("FIRMS_MAP_KEY", raising=False)
    monkeypatch.delenv("NASA_FIRMS_KEY", raising=False)
    res = firms.fetch_area((4, 51, 5, 52))
    assert res["status"] == "unavailable"
    assert "map_key" in res["reason"].lower()
    assert res["fires"] == []


def test_low_confidence_and_cool_detections_are_refused():
    assert not firms.is_credible({"confidence": "l", "brightness_k": 340.0})
    assert not firms.is_credible({"confidence": "h", "brightness_k": 250.0})
    assert not firms.is_credible({"confidence": "30", "brightness_k": 340.0})
    assert firms.is_credible({"confidence": "h", "brightness_k": 340.0})
    assert firms.is_credible({"confidence": "n", "brightness_k": 320.0})


def test_a_fire_with_nothing_nearby_does_not_earn_a_picture():
    """FIRMS reports tens of thousands of detections a day, nearly all
    agricultural burning. "A fire happened" is not a finding."""
    fires = [{"lat": 0.0, "lon": 0.0, "confidence": "h", "brightness_k": 340.0, "frp": 99.0}]
    targets = [{"lat": 51.95, "lon": 4.14, "label": "Port of Rotterdam"}]
    assert firms.triggers(fires, targets) == []


def test_a_fire_beside_something_we_track_does():
    fires = [{"lat": 51.95, "lon": 4.15, "confidence": "h", "brightness_k": 340.0, "frp": 12.0}]
    targets = [{"lat": 51.95, "lon": 4.14, "label": "Port of Rotterdam"}]
    out = firms.triggers(fires, targets)
    assert len(out) == 1
    assert "Port of Rotterdam" in out[0]["why"]
    assert out[0]["target"]["distance_km"] < 1


def test_a_nightly_gas_flare_does_not_task_imagery_for_ever():
    """A refinery flare burns every night at the same coordinate and FIRMS
    reports it every night. Without suppression the first zone containing a
    refinery consumes the whole imagery budget."""
    fires = [{"lat": 29.0, "lon": 48.0, "confidence": "h", "brightness_k": 350.0, "frp": 40.0}]
    targets = [{"lat": 29.0, "lon": 48.0, "label": "Refinery"}]
    assert len(firms.triggers(fires, targets, [])) == 1
    already = [{"lat": 29.001, "lon": 48.001}]
    assert firms.triggers(fires, targets, already) == []


def test_the_strongest_fire_is_ranked_first():
    targets = [{"lat": 51.95, "lon": 4.14, "label": "Port"}]
    fires = [
        {"lat": 51.95, "lon": 4.15, "confidence": "h", "brightness_k": 340.0, "frp": 5.0},
        {"lat": 51.96, "lon": 4.16, "confidence": "h", "brightness_k": 340.0, "frp": 90.0},
    ]
    out = firms.triggers(fires, targets)
    assert out[0]["frp"] == 90.0


def test_distance_maths_is_right():
    # Rotterdam to Antwerp is about 83km.
    assert 80 < firms.haversine_km(51.95, 4.14, 51.22, 4.40) < 86


def test_acquisition_time_parses_firms_hhmm():
    dt = firms.fire_time({"acq_date": "2026-09-18", "acq_time": "342"})
    assert dt is not None and dt.hour == 3 and dt.minute == 42
    assert firms.fire_time({"acq_date": None}) is None
