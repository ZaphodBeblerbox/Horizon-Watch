"""Two assets near one signal are one notification naming both."""
import asset_watch as aw


def test_one_card_per_signal():
    sit = {"signals": [{"id": "s1", "title": "Strike on a depot", "severity": "high", "km": 3, "lat": 1, "lon": 2, "when": "t"}]}
    a = aw.cards_for({"id": "A", "name": "Plant 3", "kind_label": "Site", "radius_km": 50}, sit)
    b = aw.cards_for({"id": "B", "name": "Office", "kind_label": "Site", "radius_km": 50},
                     {"signals": [{**sit["signals"][0], "km": 2}]})
    other = aw.cards_for({"id": "C", "name": "MT Aurora", "kind_label": "Tanker", "radius_km": 50},
                         {"signals": [{"id": "s2", "title": "Clash", "severity": "critical", "km": 9, "when": "t"}]})
    out = aw.merge(a + b + other)
    assert len(out) == 2
    m = next(c for c in out if c["id"] == "asset:sig:s1")
    assert m["title"] == "Strike on a depot — 2 km from Office and Plant 3 (your assets)"
    assert m["asset_ids"] == ["B", "A"]
    single = next(c for c in out if c["signal_id"] == "s2")
    assert single["id"] == "asset:C:s2"
