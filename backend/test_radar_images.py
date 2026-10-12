"""test_radar_images.py — the radar images a change comparison was made from:
rendering, storage with its georeference, the laptop cap, the cut-outs, and
fetching an old comparison's frames again.

    cd backend && python3 -m pytest test_radar_images.py -q
"""
import asyncio
import base64
import datetime as dt
import io
import json

import numpy as np
import pytest
from PIL import Image

import finding_boxes as fb
import radar_images as ri

BOUNDS = [30.0, 50.0, 30.2, 50.1]          # w, s, e, n
H, W = 100, 200
BLOCK = (40, 60, 120, 150)                  # y0, y1, x0, x1 — the "new camp"


def _stacks(seed=0, n=4, bright=True):
    rng = np.random.default_rng(seed)
    before = rng.gamma(4.0, 0.025, size=(n, H, W))
    after = rng.gamma(4.0, 0.025, size=(n, H, W))
    if bright:
        y0, y1, x0, x1 = BLOCK
        after[:, y0:y1, x0:x1] *= 12.0      # ~ +10.8 dB: new hard scatterers
    return before, after


@pytest.fixture(autouse=True)
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(ri, "_root_override", tmp_path / "radar_images")
    for k in ("RAILWAY_ENVIRONMENT_ID", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT", "RADAR_IMAGES_KEEP_ALL"):
        monkeypatch.delenv(k, raising=False)
    ri._JOBS.clear()
    yield tmp_path


def _png(b):
    return np.asarray(Image.open(io.BytesIO(b)))


def test_render_shares_one_stretch_and_paints_brightening_red():
    before, after = _stacks()
    r = ri.render(before, after)
    assert (r["width"], r["height"]) == (W, H)
    b, a, c = _png(r["before"]), _png(r["after"]), _png(r["change"])
    assert b.shape == a.shape == (H, W) and c.shape == (H, W, 3)
    y0, y1, x0, x1 = BLOCK
    # same ground outside the block → same grey on both (one stretch)
    assert abs(float(b[:30].mean()) - float(a[:30].mean())) < 6
    assert a[y0:y1, x0:x1].mean() > b[y0:y1, x0:x1].mean() + 60
    inside = c[y0 + 3:y1 - 3, x0 + 3:x1 - 3].reshape(-1, 3).mean(axis=0)
    outside = c[:30, :60].reshape(-1, 3).mean(axis=0)
    assert inside[0] > 200 and inside[2] < 120             # red
    assert outside[0] < 140                                # dimmed grey, not red
    assert r["brighter_fraction"] > 0.02 and r["darker_fraction"] < 0.02


def test_darkening_is_blue():
    before, after = _stacks(bright=False)
    y0, y1, x0, x1 = BLOCK
    before[:, y0:y1, x0:x1] *= 12.0                        # it was there; it is gone
    c = _png(ri.render(before, after)["change"])
    inside = c[y0 + 3:y1 - 3, x0 + 3:x1 - 3].reshape(-1, 3).mean(axis=0)
    assert inside[2] > 200 and inside[0] < 120


def test_saved_images_carry_their_georeference_and_a_box_lands_on_its_pixels():
    before, after = _stacks()
    m = ri.save_from_stacks("scan-abc-1", before, after, {"west": 30.0, "south": 50.0, "east": 30.2, "north": 50.1},
                            {"dates_before": ["2026-08-26"], "dates_after": ["2026-10-10"]})
    assert m["bounds"] == BOUNDS and (m["width"], m["height"]) == (W, H)
    assert ri.has("scan-abc-1") and not ri.has("scan-other")
    got = ri.load("scan-abc-1")
    assert got["dates_after"] == ["2026-10-10"]
    for n in ("before", "after", "change"):
        assert _png(base64.b64decode(got[f"{n}_b64"])).shape[:2] == (H, W)
    # the block's pixel extent → degrees → back to pixels of the stored image
    y0, y1, x0, x1 = BLOCK
    box = fb.frac_to_geo([x0 / W, y0 / H, (x1 - x0) / W, (y1 - y0) / H], m["bounds"])
    fr = fb.geo_to_frac(box, m["bounds"])
    px = [fr[0] * W, fr[1] * H, fr[2] * W, fr[3] * H]
    assert px == pytest.approx([x0, y0, x1 - x0, y1 - y0], abs=0.05)


def test_crop_cuts_the_same_window_from_before_after_and_change():
    before, after = _stacks()
    ri.save_from_stacks("scan-crop-1", before, after, BOUNDS)
    y0, y1, x0, x1 = BLOCK
    box = fb.frac_to_geo([x0 / W, y0 / H, (x1 - x0) / W, (y1 - y0) / H], BOUNDS)
    c = ri.crop("scan-crop-1", box)
    assert c["source"] == "radar_images" and c["image_b64"] == c["after_b64"]
    sizes = {_png(base64.b64decode(c[f"{n}_b64"])).shape[:2] for n in ("before", "after", "change")}
    assert len(sizes) == 1
    bx, by, bw, bh = c["box"]
    assert 0 <= bx < 1 and 0 <= by < 1 and 0 < bw <= 1 and 0 < bh <= 1
    # the box sits on the bright block of the After cut-out
    a = _png(base64.b64decode(c["after_b64"]))
    h, w = a.shape
    inner = a[int((by + bh * 0.25) * h):int((by + bh * 0.75) * h), int((bx + bw * 0.25) * w):int((bx + bw * 0.75) * w)]
    assert inner.mean() > a.mean()
    assert ri.crop("scan-missing", box) is None


def test_the_laptop_keeps_only_the_newest_sets_and_the_server_keeps_all(monkeypatch):
    before, after = _stacks(n=3)
    r = ri.render(before, after)
    monkeypatch.setattr(ri, "KEEP_LOCAL", 3)
    for i in range(5):
        ri.save(f"scan-lap-{i}", r, BOUNDS)
    held = sorted(p.name for p in ri.root().iterdir())
    assert len(held) == 3 and "scan-lap-4" in held
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "production")
    for i in range(5, 9):
        ri.save(f"scan-lap-{i}", r, BOUNDS)
    assert len(list(ri.root().iterdir())) == 7


def test_keys_cannot_leave_the_store():
    assert ri._dir("../../etc") is None and ri._dir("a/b") is None and not ri.has("..")


def test_source_of_an_old_comparison():
    s = {"m_per_px": 20.0, "dates_before": ["2026-08-26", "2026-08-25", "2026-08-23"],
         "dates_after": ["2026-10-10", "2026-10-09", "2026-10-07"],
         "bounds": {"west": 37.167361, "south": 50.592885, "east": 37.457731, "north": 50.77686}}
    src = ri.source_of(s, None)
    assert src["requests"] == 6 and src["bounds"][0] == 37.167361
    assert 1000 <= src["px"] <= 1030                       # the sweep's 1024 px across ~20.5 km
    # an older zone pass without bounds: the zone's own box
    s2 = {"m_per_px": 8.9, "dates_before": ["2026-07-13"] * 5, "dates_after": ["2026-10-11"] * 5}
    src2 = ri.source_of(s2, (38.19, 48.452, 38.244, 48.488))
    assert src2["bounds"] == [38.19, 48.452, 38.244, 48.488] and abs(src2["px"] - 448) <= 2
    assert ri.source_of({"m_per_px": 8.9}, (38.19, 48.452, 38.244, 48.488)) is None


def test_regenerate_fetches_each_recorded_date_once_and_keeps_the_images(monkeypatch):
    import pwtt
    before, after = _stacks(n=3)
    frames = {f"b{i}": before[i] for i in range(3)} | {f"a{i}": after[i] for i in range(3)}
    asked = []

    async def fetch(bounds, date_from=None, date_to=None, width=None, height=None):
        asked.append((date_from, width, height, bounds["west"]))
        return {"image_bytes": date_from}

    monkeypatch.setattr(pwtt, "geotiff_to_amplitude", lambda b: frames[b].astype(np.float32))
    src = {"bounds": BOUNDS, "dates_before": ["b0", "b1", "b2"], "dates_after": ["a0", "a1", "a2"], "px": 200, "requests": 6}
    st = asyncio.run(ri.regenerate("scan-regen-1", src, fetch, {"zone_id": "ZONE-054"}))
    assert st["status"] == "ready" and st["done"] == 6
    assert [a[0] for a in asked] == ["b0", "b1", "b2", "a0", "a1", "a2"] and {a[1] for a in asked} == {200}
    m = ri.meta("scan-regen-1")
    assert m["source"] == "regenerated" and m["zone_id"] == "ZONE-054" and m["bounds"] == BOUNDS
    assert m["dates_after"] == ["a0", "a1", "a2"]


def test_regenerate_says_why_when_no_frame_comes_back(monkeypatch):
    async def fetch(bounds, **kw):
        return {"error": "Sentinel Hub API error 429"}
    src = {"bounds": BOUNDS, "dates_before": ["b0"], "dates_after": ["a0"], "px": 64, "requests": 2}
    st = asyncio.run(ri.regenerate("scan-regen-2", src, fetch))
    assert st["status"] == "error" and "429" in st["error"] and not ri.has("scan-regen-2")


# ── through the zone's findings and the endpoints' sync halves ──────────

from sqlalchemy import create_engine          # noqa: E402
from sqlalchemy.orm import sessionmaker       # noqa: E402

import zone_findings                           # noqa: E402
from database import SentinelDetection, SentinelScan, WatchZone   # noqa: E402


@pytest.fixture
def db():
    eng = create_engine("sqlite://")
    for t in (WatchZone, SentinelScan, SentinelDetection):
        t.__table__.create(eng)
    s = sessionmaker(bind=eng)()
    yield s
    s.close()


def _zone_with_change(db, scan_id="CHG-1"):
    z = WatchZone(system_id="ZONE-9", name="Z", polygon_geojson="{}", bbox_min_lon=30.0, bbox_min_lat=50.0,
                  bbox_max_lon=30.2, bbox_max_lat=50.1, priority="high", scan_interval_hours=24, enabled=True,
                  created_at=dt.datetime.utcnow(), ml_tasks="[]", alert_threshold="both", zone_metadata="{}",
                  aoi_class="border")
    db.add(z)
    db.flush()
    summ = {"method": "PWTT", "m_per_px": 10.0, "bounds": {"west": 30.0, "south": 50.0, "east": 30.2, "north": 50.1},
            "dates_before": ["2026-08-26", "2026-08-25", "2026-08-23"], "dates_after": ["2026-10-10", "2026-10-09", "2026-10-07"],
            "change": {"verdict": "changed", "until": "2026-10-10"}}
    db.add(SentinelScan(scan_id=scan_id, zone_id=z.id, triggered_by="change-detect", status="completed",
                        created_at=dt.datetime.utcnow(), instrument="SAR", result_summary=json.dumps(summ)))
    db.add(SentinelDetection(detection_id="d1", scan_id=scan_id, zone_id=z.id, instrument="SAR",
                             object_type="structural_change", confidence=0.9, centroid_lat=50.05, centroid_lon=30.1,
                             area_m2=8000.0, attributes=json.dumps({"change_direction": "appeared", "t_peak": 7.0,
                                                                    "pixels": 80, "bbox": [0.6, 0.4, 0.15, 0.2]})))
    db.flush()
    return z


def test_findings_say_whether_their_radar_images_are_held(db):
    z = _zone_with_change(db)
    f = zone_findings.zone_findings(db, z, days=30)["findings"]
    assert f and f[0]["kind"] == "radar_change" and f[0]["radar_images"] is False
    src = zone_findings.radar_source(db, z, "CHG-1")
    assert src["requests"] == 6 and src["bounds"] == BOUNDS
    before, after = _stacks(n=3)
    ri.save_from_stacks("CHG-1", before, after, src["bounds"])
    assert zone_findings.zone_findings(db, z, days=30)["findings"][0]["radar_images"] is True
    assert zone_findings.radar_source(db, z, "not-a-scan") is None


def test_a_whole_scene_shift_is_not_painted_as_change():
    before, after = _stacks()
    after = after * 0.4                        # everything ~4 dB darker (season, moisture)
    r = ri.render(before, after)
    assert r["scene_shift_db"] < -3
    assert r["darker_fraction"] < 0.05         # not the whole scene blue
    c = _png(r["change"])
    y0, y1, x0, x1 = BLOCK
    assert c[y0 + 3:y1 - 3, x0 + 3:x1 - 3].reshape(-1, 3).mean(axis=0)[0] > 200   # the block still stands out red
