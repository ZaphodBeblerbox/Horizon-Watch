"""smoke_classify: what a Sentinel-2 change flagged by smoke.py actually is.

Owner, 2026-10-13: dark fields, runways and cloud shadows were published as
smoke plumes. Two kinds of test:

  * synthetic scenes, one per rule (smoke over desert with a fire, a
    ploughed parcel, a cloud and its shadow, a runway / apron / port / tank
    farm from OpenStreetMap, ground that was there on earlier passes);
  * the labelled set built from production's own smoke detections
    (backend/data/smoke_labelled_set.json — features measured on the real
    Sentinel-2 bands, labels decided by eye on before/after crops plus SCL,
    earlier passes and FIRMS; see its "method"). Its numbers are a floor: a
    change to the rules that publishes more fields or loses real smoke fails.
"""
import json
import os

import numpy as np
import pytest

import smoke
import smoke_classify as sc

B = {"west": 48.0, "south": 25.0, "east": 48.2, "north": 25.2}
H = W = 200
rng = np.random.default_rng(7)


def desert():
    a = np.zeros((9, H, W), dtype=np.float32)
    a[0], a[1], a[2], a[3], a[4], a[5], a[8] = 0.15, 0.25, 0.42, 0.5, 0.65, 0.6, 0.13
    a[6], a[7] = 5, 1
    a[:6] += rng.normal(0, 0.004, (6, H, W)).astype(np.float32)
    return a


def farmland():
    """Green crops with darker parcel strips; parcel edges exist on every pass."""
    a = np.zeros((9, H, W), dtype=np.float32)
    a[0], a[1], a[2], a[3], a[4], a[5], a[8] = 0.04, 0.07, 0.05, 0.35, 0.20, 0.10, 0.04
    a[6], a[7] = 4, 1
    a[:6, 60:120, 50:130] = np.array([0.06, 0.09, 0.10, 0.25, 0.28, 0.20])[:, None, None]   # stubble parcel
    a[:6] += rng.normal(0, 0.003, (6, H, W)).astype(np.float32)
    return a


def hist_of(f, n=4):
    return np.stack([f() for _ in range(n)])


def rect(y0, y1, x0, x1):
    m = np.zeros((H, W), bool)
    m[y0:y1, x0:x1] = True
    return m


def test_black_plume_from_a_fire_over_desert_is_smoke():
    hist = hist_of(desert)
    now = desert()
    now[0:3, 90:110, 60:150] *= 0.2
    now[8, 90:110, 60:150] *= 0.18
    now[3, 90:110, 60:150] *= 0.3
    now[4:6, 90:110, 60:150] *= 0.45
    now[5, 98:102, 150:154], now[4, 98:102, 150:154] = 0.9, 0.5
    found, _ = smoke.plumes(now, np.median(hist, axis=0), B)
    assert len(found) == 1
    fire = smoke.masks(now, np.median(hist, axis=0))[2]
    out = sc.assess_plumes(now, hist, found, B, {"fire": fire})
    assert out[0]["class"] == "smoke_plume", out[0]["reasons"]
    assert sc.is_finding(out[0]["class"])
    assert out[0]["features"]["fire"] > 0
    assert any(r["kind"] == "fire" for r in out[0]["reasons"])


def test_ploughed_parcel_on_cropland_is_a_field_not_smoke():
    hist = hist_of(farmland)
    now = farmland()
    # the stubble parcel ploughed: dark soil, NIR falls most
    now[:6, 60:120, 50:130] = np.array([0.045, 0.06, 0.07, 0.12, 0.20, 0.17])[:, None, None]
    now[8, 60:120, 50:130] = 0.045
    wc = np.full((H, W), 40, np.uint8)
    v = sc.assess(now, hist, rect(60, 120, 50, 130), B, {"worldcover": wc})
    assert v["class"] == "field_change", v["reasons"]
    assert not sc.is_finding(v["class"])
    assert v["features"]["cropland"] == 1.0


def test_a_cloud_and_its_shadow_are_named_as_such():
    hist = hist_of(farmland)
    now = farmland()
    now[:6, 20:50, 20:50] = np.array([0.45, 0.45, 0.46, 0.5, 0.35, 0.25])[:, None, None]       # cloud
    now[8, 20:50, 20:50] = 0.45
    now[6, 20:50, 20:50] = 8
    now[:6, 52:80, 20:50] *= 0.45                                                           # its shadow
    now[8, 52:80, 20:50] *= 0.45
    assert sc.assess(now, hist, rect(20, 50, 20, 50), B)["class"] == "cloud"
    v = sc.assess(now, hist, rect(52, 80, 20, 50), B)
    assert v["class"] == "cloud_shadow", v["reasons"]
    # the scene classification alone is enough
    now2 = farmland()
    now2[:6, 140:170, 140:170] *= 0.5
    now2[6, 140:170, 140:170] = 3
    assert sc.assess(now2, hist, rect(140, 170, 140, 170), B)["class"] == "cloud_shadow"


def _darkened(now, m):
    now[:6][:, m] *= 0.6
    now[8][m] *= 0.6
    return now


@pytest.mark.parametrize("key,cls", [("aeroway", "runway"), ("apron", "aircraft"),
                                     ("port", "port_infrastructure"), ("tanks", "storage_tank")])
def test_the_place_it_is_in_names_it(key, cls):
    hist = hist_of(desert)
    m = rect(80, 100, 40, 160)
    now = _darkened(desert(), m)
    ctx = {key: m.copy()}
    v = sc.assess(now, hist, m, B, ctx)
    assert v["class"] == cls, v["reasons"]
    assert not sc.is_finding(cls)


def test_smoke_with_heat_beats_the_place():
    """A strike on a port smokes: heat + smoke evidence wins over OSM context."""
    hist = hist_of(desert)
    now = desert()
    now[0:3, 90:110, 60:150] *= 0.2
    now[8, 90:110, 60:150] *= 0.18
    now[3, 90:110, 60:150] *= 0.3
    now[4:6, 90:110, 60:150] *= 0.45
    m = rect(90, 110, 60, 150)
    fire = rect(98, 102, 150, 154)
    v = sc.assess(now, hist, m, B, {"port": m.copy(), "fire": fire})
    assert v["class"] == "smoke_plume", v["reasons"]


def test_small_bright_thing_on_open_water_is_a_ship():
    hist = hist_of(desert)
    for h in hist:
        h[:6, 90:110, 90:110] = 0.02
    now = desert()
    now[:6, 90:110, 90:110] = 0.02
    now[:6, 99:102, 99:104] = np.array([0.12, 0.12, 0.12, 0.15, 0.10, 0.08])[:, None, None]   # ~0.15 km² at 100 m px
    now[8, 99:102, 99:104] = 0.12
    wc = np.full((H, W), 60, np.uint8)
    wc[90:110, 90:110] = 80
    v = sc.assess(now, hist, rect(99, 102, 99, 104), B, {"worldcover": wc})
    assert v["class"] == "vessel", v["reasons"]


def test_ground_present_on_two_earlier_clear_passes_is_not_smoke():
    def dark_patch():
        a = desert()
        a[:6, 80:110, 80:110] *= 0.5
        a[8, 80:110, 80:110] *= 0.5
        return a
    hist = np.stack([desert(), dark_patch(), dark_patch(), desert()])
    now = dark_patch()
    v = sc.assess(now, hist, rect(80, 110, 80, 110), B)
    assert v["features"]["persist"] >= 2
    assert v["class"] in ("persistent", "runway") and not sc.is_finding(v["class"])


def test_polygon_mask_and_osm_rasterising():
    g = {"type": "Polygon", "coordinates": [[[48.05, 25.15], [48.15, 25.15], [48.15, 25.05], [48.05, 25.05], [48.05, 25.15]]]}
    m = sc.polygon_mask(g, B, (H, W))
    assert 0.2 < m.mean() < 0.3                         # half the width × half the height
    els = [{"tags": {"aeroway": "runway", "width": "60"}, "geometry": [{"lat": 25.1, "lon": 48.02}, {"lat": 25.1, "lon": 48.18}]},
           {"tags": {"man_made": "storage_tank"}, "geometry": [{"lat": 25.02, "lon": 48.02}, {"lat": 25.02, "lon": 48.04},
                                                              {"lat": 25.04, "lon": 48.04}, {"lat": 25.02, "lon": 48.02}]}]
    ctx = sc.osm_context(B, (H, W), elements=els)
    assert ctx["aeroway"][99:101, 100].any() and not ctx["aeroway"][50, 100]
    assert ctx["tanks"].any() and not ctx["port"].any()


def test_osm_outage_backs_off_instead_of_stalling_every_pass(monkeypatch):
    import urllib.request
    calls = []
    def boom(*a, **k):
        calls.append(1)
        raise OSError("refused")
    monkeypatch.setattr(urllib.request, "urlopen", boom)
    monkeypatch.setattr(sc, "_OSM_DOWN", {"until": 0.0})
    monkeypatch.setattr(sc, "_OSM_CACHE", {})
    assert sc.osm_context({"west": 1, "south": 1, "east": 1.1, "north": 1.1}, (10, 10)) == {}
    n = len(calls)
    assert n == len(sc.OVERPASS_URLS)
    assert sc.osm_context({"west": 2, "south": 2, "east": 2.1, "north": 2.1}, (10, 10)) == {}
    assert len(calls) == n                              # no new requests during the back-off


def test_a_region_that_cannot_be_measured_is_not_published():
    hist = hist_of(desert)
    bad = [{"geometry": {"type": "Polygon", "coordinates": [[[10, 10], [10.1, 10], [10.1, 10.1], [10, 10]]]},
            "source_lat": 10, "source_lon": 10}]
    out = sc.assess_plumes(desert(), hist, bad, B, {})
    assert out[0]["class"] == "unclassified" and not sc.is_finding(out[0]["class"])


def test_a_model_fitted_on_a_handful_of_answers_does_not_overrule_the_rules(monkeypatch, tmp_path):
    f = {k: 0.0 for k in sc.FEATURES}
    f.update({"vis": -0.4, "nir": -0.2, "swir": -0.2, "nir_frac": 0.5, "swir_frac": 0.5, "mono": 1.0, "cropland": 0.9,
              "elong": 2, "rect": 0.5, "length_m": 900, "width_m": 400, "persist": 0, "area_km2": 2})
    base = sc.classify(f)["class"]
    model = {"features": list(sc.FEATURES), "mean": [0] * len(sc.FEATURES), "scale": [1] * len(sc.FEATURES),
             "coef": [0.0] * len(sc.FEATURES), "intercept": [10.0], "classes": ["field_change", "smoke_plume"], "n": 5}
    p = tmp_path / "m.json"
    p.write_text(json.dumps(model))
    monkeypatch.setattr(sc, "MODEL_PATH", str(p))
    monkeypatch.setattr(sc, "_MODEL", {"mtime": None, "model": None})
    assert sc.classify(f)["class"] == base
    model["n"] = 500
    p.write_text(json.dumps(model))
    os.utime(p, (1e9, 2e9))
    assert sc.classify(f)["class"] == "smoke_plume"


# ── The labelled set from production ─────────────────────────────────────

LABELLED = os.path.join(os.path.dirname(__file__), "data", "smoke_labelled_set.json")


def _labelled():
    d = json.load(open(LABELLED))
    return [x for x in d["items"] if x.get("label") and x["label"] != "unsure" and x.get("features")]


def test_labelled_set_is_documented():
    d = json.load(open(LABELLED))
    assert d["method"] and d["items"]
    for x in d["items"]:
        assert x["label"] and x["evidence"], x["detection_id"]


def test_rules_on_the_labelled_set():
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
    import train_detection_classifier as t
    ex = [{"label": x["label"], "features": x["features"]} for x in _labelled()]
    r = t.rules_report(ex, show=False)
    pub, sm = r["published"], r["smoke"]
    floor = json.load(open(LABELLED))["floor"]
    # published = smoke plume or burn scar; the owner's complaint was false positives
    assert pub["precision"] is not None and pub["precision"] >= floor["published_precision"], r["pairs"]
    assert pub["recall"] is not None and pub["recall"] >= floor["published_recall"], r["pairs"]
    assert sm["fp"] <= floor["smoke_false_positives"], [p for p in r["pairs"] if p[1] == "smoke_plume"]


@pytest.mark.parametrize("kind", ["field_change", "cloud", "cloud_shadow"])
def test_no_labelled_false_positive_of_this_kind_is_published(kind):
    xs = [x for x in _labelled() if x["label"] == kind]
    if not xs:
        pytest.skip(f"no {kind} in the labelled set")
    published = [x["detection_id"] for x in xs if sc.is_finding(sc._rule_class(x["features"])[0])]
    assert len(published) <= max(1, len(xs) // 20), published


def sea():
    """Open sea: green-brighter than near-infrared (NDWI > 0), scene class 6."""
    a = np.zeros((9, H, W), dtype=np.float32)
    a[0], a[1], a[2], a[3], a[4], a[5], a[8] = 0.06, 0.05, 0.03, 0.015, 0.01, 0.008, 0.07
    a[6], a[7] = 6, 1
    a[:6] += rng.normal(0, 0.002, (6, H, W)).astype(np.float32)
    return a


@pytest.mark.parametrize("label", ["no worldcover", "scene says water"])
def test_brightened_sea_without_heat_is_water_not_smoke(label):
    # owner, 2026-10-13: "our system identified water as a smoke plume"
    hist = hist_of(sea)
    now = sea()
    now[0:3, 80:120, 40:160] += np.array([0.06, 0.05, 0.04])[:, None, None]       # glint / haze-like brightening
    now[8, 80:120, 40:160] += 0.07
    v = sc.assess(now, hist, rect(80, 120, 40, 160), B, {})
    assert v["class"] == "water", v["reasons"]
    assert not sc.is_finding(v["class"])

