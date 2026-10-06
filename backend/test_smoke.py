import numpy as np
import smoke

B = {"west": 48.0, "south": 25.0, "east": 48.2, "north": 25.2}


def scene():
    a = np.zeros((8, 200, 200), dtype=np.float32)
    a[0], a[1], a[2], a[3], a[4], a[5] = 0.15, 0.25, 0.42, 0.5, 0.65, 0.6     # bright desert
    a[6], a[7] = 5, 1
    return a


def test_black_plume_from_a_fire_is_found_and_a_cloud_is_not():
    base, now = scene(), scene()
    # plume: visible down to ~20%, SWIR only to ~45%, streaming west from x=150
    now[0:3, 90:110, 60:150] *= 0.2
    now[4:6, 90:110, 60:150] *= 0.45
    # fire at the plume's east end: B12 hot, above B11
    now[5, 98:102, 150:154], now[4, 98:102, 150:154] = 0.9, 0.5
    # cloud: everything brighter together
    now[0:6, 20:60, 20:60] = 0.8
    p, f = smoke.plumes(now, base, B)
    assert len(p) == 1
    assert p[0]["kind"] == "dark" and p[0]["fire_px"] > 0
    assert p[0]["drift"] == "west"
    assert f


def test_nothing_on_a_clear_pass():
    p, f = smoke.plumes(scene(), scene(), B)
    assert p == [] and f == []
