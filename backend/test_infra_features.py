import infra_features as f


def test_kinds_from_tile_layers():
    assert f.kind_of("power_generator", {"source": "wind"}) == "wind_turbine"
    assert f.kind_of("power_generator", {"source": "solar"}) is None          # panels: too many, too small
    assert f.kind_of("power_line", {"type": "cable"}) == "power_cable"
    assert f.kind_of("power_line", {"type": "line", "location": "underwater"}) == "power_cable"
    assert f.kind_of("telecoms_mast", {}) == "telecom_mast"


def test_level_of_detail():
    assert f.keep("power_line", {"voltage": 380}, 4)
    assert not f.keep("power_line", {"voltage": 110}, 5)
    assert f.keep("power_line", {"voltage": 110}, 8)
    assert not f.keep("power_plant", {"output": "5"}, 6)
    assert f.keep("power_plant", {"output": "900"}, 3)
    assert not f.keep("telecom_mast", {}, 9) and f.keep("telecom_mast", {}, 12)


def test_facts_and_models_by_kind():
    plant = {"source": "nuclear", "output": "1300.0", "operator": "EDF", "start_date": "1987"}
    facts = dict(f.facts("power_plant", plant))
    assert facts["Fuel"] == "Nuclear" and facts["Capacity"].startswith("1,300") and facts["Operator"] == "EDF"
    assert f.model_for("power_plant", plant) == "nuclear_plant"
    line = dict(f.facts("power_line", {"voltage": 400.0, "voltage_2": 220.0, "circuits": 2, "type": "line"}))
    assert line["Voltage"] == "400 kV / 220 kV" and line["Circuits"] == "2"
    assert f.model_for("pipeline", {}) == "pipeline" and f.model_for("well", {}) == "oil_well"
    assert f.title_of({"kind": "pipeline", "props": {"substance": "gas"}}) == "Gas pipeline"


def test_tiles_are_bounded():
    z, tiles = f.tiles_for(-10, 35, 30, 60, 9)
    assert len(tiles) <= f.MAX_TILES and z < 9
    assert f.thin([[0, 0], [0.0001, 0], [1, 1], [1, 1.00001], [2, 2]], 0.01) == [[0, 0], [1, 1], [2, 2]]
