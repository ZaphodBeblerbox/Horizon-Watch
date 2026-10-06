import numpy as np
import land_water as lw


def test_tiles_cover_an_area_across_a_tile_edge():
    assert lw.tile_name(24, 54) == "N24E054"
    assert lw.tile_name(-3, -60) == "S03W060"
    assert sorted(lw.tiles_for(53.9, 24.5, 54.2, 24.8)) == [(24, 51), (24, 54)]


def test_vessels_on_water_structures_on_land():
    water = np.zeros((10, 10), dtype=bool)
    water[:, 5:] = True                       # east half is sea
    bbox = [0.0, 0.0, 1.0, 1.0]
    assert lw.plausible("vessel", water, 0.5, 0.85, bbox)
    assert not lw.plausible("vessel", water, 0.5, 0.15, bbox)
    assert lw.plausible("storage_tank", water, 0.5, 0.15, bbox)
    assert not lw.plausible("storage_tank", water, 0.5, 0.85, bbox)
    assert lw.plausible("port_infrastructure", water, 0.5, 0.85, bbox)
