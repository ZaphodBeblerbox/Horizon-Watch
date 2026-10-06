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
        url: {"category": "armed_conflict", "incident": True, "act": "attack", "force": True, "actor": "armed_group", "casualties": 1, "where": "Khurais, Saudi Arabia", "headline": "Houthi missile hits Aramco site at Khurais"},
        "https://example.com/court": {"category": "legal", "incident": True, "act": "other", "casualties": None, "where": None, "headline": None}})
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


def test_keep_needs_an_act_of_force_or_a_movement_of_force():
    from gdelt_judge import keep
    base = {"incident": True, "force": False}
    # 2026-10-06 leaks, as the model now reads them
    assert not keep({**base, "category": "violent_unrest", "act": "protest", "actor": "crowd"})        # Cornell students
    assert not keep({**base, "category": "violent_unrest", "act": "other", "actor": "state_forces"})   # festival security
    assert not keep({**base, "category": "violent_unrest", "act": "attack", "force": True, "actor": "individual"})  # pupil
    assert not keep({**base, "category": "terrorism", "act": "arrest", "actor": "state_forces"})       # RAF Fairford arrests
    assert not keep({**base, "category": "military_movement", "act": "exercise", "actor": "state_forces"})
    assert not keep({**base, "category": "maritime_security", "act": "statement", "actor": "state_forces"})  # India condemns
    # kept
    assert not keep({**base, "category": "armed_conflict", "act": "attack", "force": True, "actor": "individual"})  # pupil again
    assert not keep({**base, "category": "military_movement", "act": "deployment", "actor": "police"})          # Vizag festivals
    assert not keep({**base, "category": "violent_unrest", "act": "riot", "force": True, "actor": "crowd", "casualties": 0})
    assert keep({**base, "category": "violent_unrest", "act": "riot", "force": True, "actor": "rioters", "casualties": 12})
    assert keep({**base, "category": "violent_unrest", "act": "attack", "force": True, "actor": "settlers"})
    assert keep({**base, "category": "armed_conflict", "act": "attack", "actor": "state_forces"})
    assert keep({**base, "category": "military_movement", "act": "deployment", "actor": "state_forces"})
    # an old judgement without an act is re-asked, not drawn
    assert not keep({"category": "armed_conflict", "incident": True, "keep": True})


def test_many_outlets_one_event_is_one_pin(monkeypatch):
    import gdelt_judge as g
    pts, cache = [], {}
    for i, m in enumerate([3, 9, 5]):
        u = f"https://ex.com/fairford{i}"
        pts.append({"source_url": u, "title": "Seventh man arrested over RAF Fairford attack plot", "event_type": "Assault",
                    "location_name": "Fairford, Gloucestershire, United Kingdom", "mentions": m, "lat": 51.7, "lon": -1.8})
        cache[u] = {"category": "terrorism", "incident": True, "act": "attack", "force": False, "actor": "terrorist_group", "casualties": 0,
                    "where": "Fairford, United Kingdom", "headline": "Man arrested over RAF Fairford plot"}
    monkeypatch.setattr(g, "_load", lambda: cache)
    monkeypatch.setattr(g, "_RUNNING", type("E", (), {"is_set": lambda self: True})())
    kept, _ = g.filter_points(pts)
    assert len(kept) == 1 and kept[0]["mentions"] == 9 and kept[0]["reports"] == 3
