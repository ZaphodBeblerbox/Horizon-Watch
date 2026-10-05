"""telegram_ingest: only a precise place inside the right country is published."""
import telegram_ingest as ti


def test_vague_places_are_never_pinned():
    for p in ("region", "country", "none", ""):
        hit, why = ti.locate("Donetsk Oblast, Ukraine", p, "ua")
        assert hit is None and "too vague" in why


def test_a_place_that_resolves_in_another_country_is_rejected(monkeypatch):
    import geocode_utils
    monkeypatch.setattr(geocode_utils, "geocode_place",
                        lambda q, expected_country_codes=None: [{"lat": 1, "lon": 2, "country_code": "ru"}])
    hit, why = ti.locate("Pokrovsk, Donetsk Oblast, Ukraine", "town", "ua")
    assert hit is None and "did not resolve inside UA" in why


def test_a_precise_place_in_the_right_country_is_published(monkeypatch):
    import geocode_utils
    monkeypatch.setattr(geocode_utils, "geocode_place",
                        lambda q, expected_country_codes=None: [{"lat": 48.28, "lon": 37.18, "country_code": "ua", "display_name": "Pokrovsk"}])
    hit, why = ti.locate("Pokrovsk, Donetsk Oblast, Ukraine", "town", "ua")
    assert why is None and hit["lat"] == 48.28
