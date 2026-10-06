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


def test_a_precise_place_retries_without_its_region(monkeypatch):
    import geocode_utils
    calls = []
    def fake(q, expected_country_codes=None):
        calls.append(q)
        return [{"lat": 12.7, "lon": 43.4, "country_code": "ye"}] if q == "Ras Al-Arah, Yemen" else []
    monkeypatch.setattr(geocode_utils, "geocode_place", fake)
    hit, why = ti.locate("Ras Al-Arah, Bab Al-Mandab, Yemen", "village", "ye")
    assert why is None and calls == ["Ras Al-Arah, Bab Al-Mandab, Yemen", "Ras Al-Arah, Yemen"]


def test_statements_near_matches_region_claims_by_country(monkeypatch):
    import telegram_ingest as t
    rows = [
        {"id": "a", "cite_lat": 12.6, "cite_lon": 43.3, "country_code": "YE"},   # located, ~300 km from Sanaa
        {"id": "b", "cite_lat": None, "cite_lon": None, "country_code": "YE"},   # "near Bab al-Mandab, Yemen"
        {"id": "c", "cite_lat": None, "cite_lon": None, "country_code": "SA"},
    ]
    monkeypatch.setattr(t, "statements", lambda hours=72: rows)
    near = {s["id"] for s in t.statements_near(15.35, 44.2)}          # Sanaa, country from the point
    assert near == {"b"}
    assert {s["id"] for s in t.statements_near(12.7, 43.35, country="YE")} == {"a", "b"}
