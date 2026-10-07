import asset_watch as aw

A = {"id": "a1", "name": "MT Aurora", "kind_label": "Tanker", "radius_km": 80}


def test_cards_name_the_asset_and_the_distance():
    sit = {"signals": [
        {"id": "s1", "title": "Drone strike on Ras Isa terminal.", "severity": "high", "km": 18.4, "age_h": 3, "lat": 1, "lon": 2, "when": "2026-10-07T01:00:00Z"},
        {"id": "s2", "title": "Port notice", "severity": "low", "km": 60, "age_h": 2},            # far and minor: no card
        {"id": "s3", "title": "Small boat approach", "severity": "low", "km": 9, "age_h": 2},    # inner quarter: card
        {"id": "s4", "title": "Old strike", "severity": "critical", "km": 5, "age_h": 40},       # too old
    ]}
    cards = aw.cards_for(A, sit)
    assert [c["signal_id"] for c in cards] == ["s1", "s3"]
    assert cards[0]["title"] == "Drone strike on Ras Isa terminal — 18 km from MT Aurora (your tanker)"
    assert cards[0]["reason"] == "within 80 km of your tanker MT Aurora"
    assert cards[0]["kind"] == "asset" and cards[0]["asset_id"] == "a1" and cards[0]["sev"] == "high"


def test_no_user_no_cards():
    assert aw.notifications_for(None) == []
