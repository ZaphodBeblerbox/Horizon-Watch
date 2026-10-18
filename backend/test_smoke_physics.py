"""The look-alike tests added 2026-10-17 — owner: "We're still recognising
clouds as smoke. We're still recognising random stuff as smoke … have no cap
on how many things we can actually recognise on the map."

One test per rule, on synthetic band arrays (s2_bands order: B02 B03 B04
B08 B11 B12 SCL mask B01 [cloud probability]); then the read-side verdict on
stored detections (imagery_verdict) and the findings list without its cap.
"""
import datetime as dt
import json

import numpy as np
import pytest

import imagery_verdict as iv
import smoke
import smoke_classify as sc

B = {"west": 48.0, "south": 25.0, "east": 48.2, "north": 25.2}       # ~100 m pixels at 200 px
H = W = 200
rng = np.random.default_rng(11)


@pytest.fixture(autouse=True)
def _no_model(monkeypatch):
    monkeypatch.setattr(sc, "MODEL_PATH", "/nonexistent/model.json")


def farmland(cloud_band=False):
    a = np.zeros((10 if cloud_band else 9, H, W), dtype=np.float32)
    a[0], a[1], a[2], a[3], a[4], a[5], a[8] = 0.04, 0.07, 0.05, 0.35, 0.20, 0.10, 0.04
    a[6], a[7] = 4, 1
    a[:6] += rng.normal(0, 0.003, (6, H, W)).astype(np.float32)
    return a


def desert():
    a = np.zeros((9, H, W), dtype=np.float32)
    a[0], a[1], a[2], a[3], a[4], a[5], a[8] = 0.15, 0.25, 0.42, 0.5, 0.65, 0.6, 0.13
    a[6], a[7] = 5, 1
    a[:6] += rng.normal(0, 0.004, (6, H, W)).astype(np.float32)
    return a


def hist_of(f, n=4, **kw):
    return np.stack([f(**kw) for _ in range(n)])


def rect(y0, y1, x0, x1):
    m = np.zeros((H, W), bool)
    m[y0:y1, x0:x1] = True
    return m


REGION = (100, 120, 60, 140)


def bluish_haze(now, y0=REGION[0], y1=REGION[1], x0=REGION[2], x1=REGION[3]):
    """What smoke looks like over green fields: blue and aerosol up most,
    NIR and SWIR as they were."""
    now[0, y0:y1, x0:x1] = 0.10
    now[1, y0:y1, x0:x1] = 0.11
    now[2, y0:y1, x0:x1] = 0.07
    now[8, y0:y1, x0:x1] = 0.12
    return now


def test_smoke_that_has_no_source_is_not_published():
    """Jebel Ali, 9 Oct: "white smoke plumes … from its densest point", no
    hot pixel, no FIRMS. A plume needs a fire under it."""
    hist = hist_of(farmland)
    v = sc.assess(bluish_haze(farmland()), hist, rect(*REGION), B)
    assert v["smoke_score"] >= sc.SMOKE_THRESHOLD           # it does look like smoke
    assert v["class"] == "no_source" and v["decision"] == "rejected"
    assert "nothing is burning" in v["decided_by"]


def test_the_same_haze_with_a_fire_at_its_edge_is_smoke():
    hist = hist_of(farmland)
    fire = rect(108, 112, 140, 143)
    v = sc.assess(bluish_haze(farmland()), hist, rect(*REGION), B, {"fire": fire})
    assert v["class"] == "smoke_plume" and v["decision"] == "kept", v["reasons"]


def test_a_cloud_is_known_by_its_shadow():
    """Sun due south 60° from the zenith: a cloud 3 km up throws its shadow
    5.2 km (52 px) north. The same haze without the shadow has none."""
    hist = hist_of(farmland)
    now = bluish_haze(farmland())
    now[:6, 48:68, 60:140] *= 0.5                                # the shadow, 52 px north
    now[8, 48:68, 60:140] *= 0.5
    fire = rect(108, 112, 140, 143)
    ctx = {"sun": (180.0, 60.0)}
    v = sc.assess(now, hist, rect(*REGION), B, ctx)
    f = v["features"]
    assert f["shadow_pair"] >= 0.8 and 4.5 < f["pair_km"] < 6.0, f
    assert v["class"] == "cloud", v["reasons"]
    assert any(r["kind"] == "shadow" for r in v["reasons"])
    # no shadow: no pairing
    v2 = sc.assess(bluish_haze(farmland()), hist, rect(*REGION), B, {**ctx, "fire": fire})
    assert v2["features"]["shadow_pair"] < 0.3 and v2["class"] == "smoke_plume"


def test_a_cloud_shadow_is_known_by_its_cloud():
    hist = hist_of(farmland)
    now = farmland()
    now[:6, 100:120, 60:140] *= 0.5                              # dark patch
    now[8, 100:120, 60:140] *= 0.5
    now[:6, 152:172, 60:140] = np.array([0.45, 0.45, 0.46, 0.5, 0.35, 0.25])[:, None, None]   # cloud 52 px south
    now[8, 152:172, 60:140] = 0.45
    v = sc.assess(now, hist, rect(100, 120, 60, 140), B, {"sun": (180.0, 60.0)})
    assert v["features"]["shadow_pair"] >= 0.5
    assert v["class"] == "cloud_shadow", v["reasons"]


def test_cloud_probability_band_names_cumulus_the_scene_class_missed():
    hist = hist_of(farmland, cloud_band=True)
    now = bluish_haze(farmland(cloud_band=True))
    now[9, 100:120, 60:140] = 0.8
    v = sc.assess(now, hist, rect(*REGION), B)
    assert v["features"]["cloud_prob"] == pytest.approx(0.8)
    assert v["class"] == "cloud"
    assert any("cloud-probability" in r["text"] for r in v["reasons"])


def test_thin_cloud_over_desert_is_opaque_in_swir_not_smoke():
    """Desert is bright at 1.6 µm, so a cloud's +0.1 there is a small RATIO
    and the ratio rules read "SWIR hardly moved — smoke". In reflectance it
    rose as much as blue: smoke does not do that."""
    hist = hist_of(desert)
    now = desert()
    now[:6, 80:110, 40:160] += 0.1
    now[8, 80:110, 40:160] += 0.1
    v = sc.assess(now, hist, rect(80, 110, 40, 160), B)
    f = v["features"]
    assert f["swir_opaque"] > 0.8 and f["d_b11"] > 0.05
    assert not sc.is_finding(v["class"]) and v["class"] in ("bright_surface", "cloud")
    assert any("1.6 µm" in r["text"] for r in v["reasons"])
    # roof "hot pixels" at its edge (the Rostock case) no longer carry it into smoke
    fire = rect(94, 97, 160, 163)
    v2 = sc.assess(now, hist, rect(80, 110, 40, 160), B, {"fire": fire})
    assert v2["class"] != "smoke_plume", v2["reasons"]


def test_snow_is_snow():
    hist = hist_of(farmland)
    now = farmland()
    now[:6, 50:90, 50:150] = np.array([0.6, 0.6, 0.6, 0.55, 0.05, 0.04])[:, None, None]
    now[8, 50:90, 50:150] = 0.6
    v = sc.assess(now, hist, rect(50, 90, 50, 150), B)
    assert v["class"] == "snow" and v["features"]["ndsi"] > 0.8


def test_sun_glint_on_the_sea():
    def sea():
        a = farmland()
        a[:6, 40:160, 40:160] = np.array([0.05, 0.04, 0.03, 0.02, 0.01, 0.01])[:, None, None]
        a[8, 40:160, 40:160] = 0.05
        return a
    hist = np.stack([sea() for _ in range(4)])
    now = sea()
    now[:6, 80:110, 60:140] += 0.08
    now[8, 80:110, 60:140] += 0.08
    wc = np.full((H, W), 40, np.uint8)
    wc[40:160, 40:160] = 80
    v = sc.assess(now, hist, rect(80, 110, 60, 140), B, {"worldcover": wc})
    assert v["class"] == "sun_glint", v["reasons"]


def test_haze_at_a_cloud_edge():
    hist = hist_of(farmland)
    now = bluish_haze(farmland())
    now[:6, 60:98, 60:140] = np.array([0.45, 0.45, 0.46, 0.5, 0.35, 0.25])[:, None, None]   # cloud beside it
    now[6, 60:98, 60:140] = 8
    v = sc.assess(now, hist, rect(*REGION), B)
    assert v["class"] == "haze", v["reasons"]


def test_wind_agrees_or_disagrees():
    hist = hist_of(farmland)
    fire = rect(108, 112, 140, 143)
    now = bluish_haze(farmland())
    w = sc.assess(now, hist, rect(*REGION), B, {"fire": fire, "wind_diff": 20.0})
    a = sc.assess(now, hist, rect(*REGION), B, {"fire": fire, "wind_diff": 170.0})
    assert w["smoke_score"] - a["smoke_score"] == pytest.approx(2.0)
    assert any(r["kind"] == "wind" and "against" in r["text"] for r in a["reasons"])
    assert sc.angle_diff(350, 10) == 20 and sc.angle_diff(90, 270) == 180


def test_hot_pixels_need_to_be_dark_in_blue():
    base = desert()
    now = desert()
    now[5, 10, 10], now[4, 10, 10], now[0, 10, 10] = 0.9, 0.5, 0.05      # a flame
    now[5, 20, 20], now[4, 20, 20], now[0, 20, 20] = 0.9, 0.6, 0.7       # glint on a metal roof
    now[5, 30, 30], now[4, 30, 30], now[0, 30, 30], now[6, 30, 30] = 0.55, 0.4, 0.3, 9   # cloud
    hot = smoke.hot_pixels(now, base)
    assert hot[10, 10] and not hot[20, 20] and not hot[30, 30]


def test_sun_position():
    az, zen = sc.sun_position(dt.datetime(2026, 10, 12, 10, 35), 54.16, 12.1)          # Rostock pass
    assert 150 < az < 180 and 58 < zen < 68
    az, zen = sc.sun_position("2026-03-20T12:00:00Z", 0.0, 0.0)
    assert zen < 3


def test_shadow_pairing_ignores_ground_dark_everywhere():
    comp = rect(*REGION)
    partner = np.ones((H, W), bool)
    assert sc.shadow_pairing(comp, partner, 100.0, 180.0, 60.0, toward_sun=False)[0] == pytest.approx(0.0)


# ── the stored detections, judged on read ─────────────────────────────────

def test_legacy_plume_without_firms_is_withdrawn_and_with_firms_kept():
    a = {"kind": "bright", "fire_px": 5, "source_lat": 54.16, "source_lon": 12.09}
    v = iv.judge("smoke_plume", a, 54.16, 12.09, [])
    assert v["shown"] is False and v["class"] == "no_source" and "FIRMS" in v["decided_by"]
    v = iv.judge("smoke_plume", a, 54.16, 12.09, [(54.165, 12.1)])
    assert v["shown"] is True


def test_fires_need_firms_or_enough_checked_pixels():
    assert iv.judge("active_fire", {"fire_area_m2": 800}, 54.16, 12.09, [])["shown"] is False
    assert iv.judge("active_fire", {"fire_area_m2": 800}, 54.16, 12.09, [(54.161, 12.091)])["shown"] is True
    assert iv.judge("active_fire", {"fire_px": 5, "hot_pixel_test": "v2"}, 54.16, 12.09, [])["shown"] is True
    assert iv.judge("active_fire", {"fire_px": 3, "hot_pixel_test": "v2"}, 54.16, 12.09, [])["shown"] is False


def test_a_measured_detection_is_classified_again_with_todays_rules():
    import os
    d = json.load(open(os.path.join(os.path.dirname(__file__), "data", "smoke_labelled_set.json")))
    cloud = next(i for i in d["items"] if i["label"] == "cloud")
    smoke_ = next(i for i in d["items"] if i["label"] == "smoke_plume" and i["features"]["firms"])
    f = {k: v for k, v in cloud["features"].items() if k != "ratios"}
    v = iv.judge("smoke_plume", {"features": f, "band_ratios": cloud["features"]["ratios"]}, cloud["lat"], cloud["lon"], [])
    assert v["shown"] is False and v["class"] == "cloud"
    f = {k: v for k, v in smoke_["features"].items() if k != "ratios"}
    v = iv.judge("smoke_plume", {"features": f, "band_ratios": smoke_["features"]["ratios"]}, smoke_["lat"], smoke_["lon"], [])
    assert v["shown"] is True
    assert iv.judge("vessel", {}, 0, 0, []) is None


# ── no cap on findings ────────────────────────────────────────────────────

@pytest.fixture
def db():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from database import FireDetection, SentinelDetection, SentinelScan, WatchZone
    eng = create_engine("sqlite://")
    for t in (WatchZone, SentinelScan, SentinelDetection, FireDetection):
        t.__table__.create(eng)
    s = sessionmaker(bind=eng)()
    yield s
    s.close()


def test_every_new_object_is_a_finding_and_withdrawn_smoke_is_not(db):
    import zone_findings
    from database import SentinelDetection, SentinelScan, WatchZone
    now = dt.datetime.utcnow()
    z = WatchZone(system_id="ZONE-9", name="Z", polygon_geojson="{}", bbox_min_lon=30.0, bbox_min_lat=50.0,
                  bbox_max_lon=30.2, bbox_max_lat=50.1, priority="high", scan_interval_hours=24, enabled=True,
                  created_at=now, ml_tasks="[]", alert_threshold="both", zone_metadata="{}", aoi_class="port")
    db.add(z)
    db.flush()
    db.add(SentinelScan(scan_id="S1", zone_id=z.id, triggered_by="schedule", status="completed", created_at=now,
                        image_timestamp_utc=now, instrument="OPTICAL"))
    ring = [[30.05, 50.05], [30.051, 50.05], [30.051, 50.051], [30.05, 50.051], [30.05, 50.05]]
    for i in range(150):                                          # the old cap was 60 (objects 30)
        db.add(SentinelDetection(detection_id=f"V{i}", scan_id="S1", zone_id=z.id, instrument="OPTICAL",
                                 object_type="vessel", confidence=0.8, centroid_lat=50.05, centroid_lon=30.05 + i * 1e-4,
                                 geo_geometry=json.dumps({"type": "Polygon", "coordinates": [ring]}), area_m2=900,
                                 severity="info", alert_tier="silent", created_at=now,
                                 attributes=json.dumps({"change_type": "new", "tier": "confirmed"})))
    db.add(SentinelDetection(detection_id="SMK", scan_id="S1", zone_id=z.id, instrument="OPTICAL",
                             object_type="smoke_plume", confidence=0.9, centroid_lat=50.06, centroid_lon=30.1,
                             geo_geometry=json.dumps({"type": "Polygon", "coordinates": [ring]}), area_m2=1e6,
                             severity="high", alert_tier="silent", created_at=now,
                             attributes=json.dumps({"change_type": "new", "kind": "bright", "fire_px": 0,
                                                    "source_lat": 50.06, "source_lon": 30.1})))
    db.flush()
    out = zone_findings.zone_findings(db, z, days=30)
    ids = [f.get("detection_id") or f.get("id") for f in out["findings"]]
    assert out["total"] == 150 and len(out["findings"]) == 150
    assert not any("SMK" in str(i) for i in ids)
    page = zone_findings.zone_findings(db, z, days=30, offset=100, limit=40)
    assert len(page["findings"]) == 40 and page["next_offset"] == 140
    assert zone_findings.zone_findings(db, z, days=30, offset=140, limit=40)["next_offset"] is None
