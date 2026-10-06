import imagery_signals as s


def test_tankers_massing_at_an_oil_terminal_is_a_signal_but_not_at_a_commercial_port():
    hist = {"vessel": [5, 6, 4, 5, 6]}
    kw = dict(place="X", counts={"vessel": 14}, history=hist, new_by_type={"vessel": 9}, gone_by_type={})
    oil = s.evaluate(kind="oil_terminal", **kw)
    assert oil and "14 vessels at the terminal" in oil[0]["title"]
    assert s.evaluate(kind="commercial_port", **{**kw, "counts": {"vessel": 8}}) == []


def test_every_movement_at_a_naval_base():
    out = s.evaluate(kind="naval_base", place="Tartus", counts={"vessel": 3}, history={},
                     new_by_type={"vessel": 1}, gone_by_type={})
    assert out[0]["title"] == "Tartus: 1 vessel arrived — 3 there now"


def test_a_fixed_structure_gone_is_reported_everywhere():
    out = s.evaluate(kind="commercial_port", place="P", counts={}, history={}, new_by_type={},
                     gone_by_type={"storage_tank": 2})
    assert out[0]["severity"] == "high" and "2 storage tanks gone" in out[0]["title"]


def test_new_heat_only_at_energy_sites():
    assert s.evaluate(kind="energy_site", place="R", counts={}, history={}, new_by_type={}, gone_by_type={}, new_heat=2)
    assert not s.evaluate(kind="commercial_port", place="R", counts={}, history={}, new_by_type={}, gone_by_type={}, new_heat=2)


def test_too_little_history_raises_nothing_from_counts():
    assert s.evaluate(kind="oil_terminal", place="K", counts={"vessel": 30}, history={"vessel": [5]},
                      new_by_type={}, gone_by_type={}) == []
