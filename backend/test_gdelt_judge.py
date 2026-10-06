import gdelt_judge as gj


def test_place_matches_most_specific_part():
    assert gj.place_matches("Khurais, Saudi Arabia", "Khurais, Ash Sharqiyah, Saudi Arabia")
    assert not gj.place_matches("Khurais, Saudi Arabia", "Riyadh, Ar Riya?, Saudi Arabia")
    assert gj.place_matches("Kryvyi Rih", "Kryvyi Rih, Dnipropetrovs'k, Ukraine")
    assert not gj.place_matches(None, "Gaza")
    assert gj.place_matches("Gaza City", "Gaza City, Gaza Strip, Palestine")


def test_worth_reading_skips_narrow_framing():
    assert gj.worth_reading({"event_types": ["Fight"], "mentions": 1})
    assert not gj.worth_reading({"event_types": ["Coerce"], "mentions": 3})
    assert gj.worth_reading({"event_types": ["Protest"], "mentions": 12})


def test_filter_draws_only_kept_stories_once_at_the_judged_place(monkeypatch):
    url = "https://example.com/aramco"
    pts = [{"source_url": url, "title": "Bangladeshi killed in Houthi attack on Aramco site at Khurais", "event_type": "Fight",
            "event_types": ["Fight"], "mentions": m, "location_name": loc}
           for loc, m in (("Riyadh, Saudi Arabia", 20), ("Hajjah, Yemen", 8), ("Khurais, Saudi Arabia", 4))]
    pts.append({"source_url": "https://example.com/court", "title": "Court issues warrant", "event_type": "Fight",
                "event_types": ["Fight"], "mentions": 10, "location_name": "Varanasi, India"})
    monkeypatch.setattr(gj, "_CACHE", {
        url: {"category": "armed_conflict", "incident": True, "keep": True, "where": "Khurais, Saudi Arabia", "headline": "Houthi missile hits Aramco site at Khurais"},
        "https://example.com/court": {"category": "legal", "incident": True, "keep": False, "where": None, "headline": None}})
    monkeypatch.setattr(gj, "_save", lambda: None)
    kept, counts = gj.filter_points(pts)
    assert [p["location_name"] for p in kept] == ["Khurais, Saudi Arabia"]
    assert kept[0]["title"].startswith("Houthi missile")
    assert counts["pending"] == 0


def test_headline_must_name_the_judged_place():
    assert gj.headline_names("Khurais, Saudi Arabia", "Houthi missile hits Aramco facility at Khurais")
    assert not gj.headline_names("Mecca, Saudi Arabia", "Houthis claim attacks on Saudi airports")
    assert not gj.headline_names("Bokkos, Nigeria", "Christian mother, daughter killed in Gaza strike")


def test_country_only_answer_is_not_pinned_on_a_city():
    assert not gj.place_matches("Saudi Arabia", "Mecca, Makkah, Saudi Arabia")
    assert gj.place_matches("Saudi Arabia", "Saudi Arabia")
