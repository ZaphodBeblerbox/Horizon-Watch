"""zone_change.py — the radar change verdict, the notification title and
the per-zone findings badge (owner, 2026-10-11)."""
import datetime as dt

import zone_change as zc


def _r(lat, lon, t=6.0, area=20_000, d="appeared"):
    return {"centroid_lat": lat, "centroid_lon": lon, "t_peak": t if d == "appeared" else -t,
            "area_m2": area, "change_direction": d}


def _out(regions, **kw):
    return {"status": "completed", "detections": regions, "changed_fraction": 0.01,
            "dates_before": ["2026-07-13", "2026-07-07"], "dates_after": ["2026-10-09", "2026-10-03"],
            "m_per_px": 12.0, **kw}


def test_weak_or_small_regions_are_not_findings():
    sig = zc.significant([_r(48, 37, t=2.0), _r(48, 37.1, area=800), _r(48, 37.2)])
    assert len(sig) == 1 and sig[0]["centroid_lon"] == 37.2


def test_first_comparison_reports_significant_change():
    b = zc.summarize(_out([_r(48.0, 37.0, area=120_000), _r(48.05, 37.05, t=2.0)]), None)
    assert b["verdict"] == "changed" and b["new_regions"] == 1 and b["first_comparison"]
    assert b["brighter_m2"] == 120_000 and b["since"] == "2026-07-13" and b["until"] == "2026-10-09"
    assert zc.alert_title("Vuglegirska power station", b) == \
        "Change detected at Vuglegirska power station — radar, 12 ha brighter since 13 Jul"


def test_change_already_reported_is_not_new_again():
    prev = [_r(48.0, 37.0)]
    b = zc.summarize(_out([_r(48.001, 37.001)]), prev, previous_until="2026-10-02")
    assert b["verdict"] == "no_change" and b["new_regions"] == 0
    assert b["headline"] == "radar compared — nothing new since 2 Oct"
    # The same place but the opposite direction (built, then destroyed) is new.
    b = zc.summarize(_out([_r(48.001, 37.001, d="removed")]), prev, previous_until="2026-10-02")
    assert b["verdict"] == "changed" and b["darker_m2"] == 20_000
    assert "2.0 ha darker since 2 Oct" in b["headline"]


def test_whole_scene_shift_is_inconclusive_and_errors_say_why():
    assert zc.summarize(_out([_r(48, 37)], changed_fraction=0.3), None)["verdict"] == "inconclusive"
    e = zc.summarize({"status": "error", "error": "no Sentinel-1 acquisitions"}, None)
    assert e["verdict"] == "error" and "acquisitions" in e["reason"]


def test_scan_finding_is_derived_from_what_changed():
    radar = {"method": "PWTT", "change": zc.summarize(_out([_r(48, 37)]), None)}
    assert zc.scan_finding(radar, "change-detect")["kind"] == "radar_change"
    assert zc.scan_finding({"method": "PWTT", "change": {"verdict": "no_change"}}, "change-detect") is None
    # A port with 27 ships every pass is not a finding; 3 new ones are.
    same = {"total_detections": 27, "what_changed": {"baseline": False, "new_by_type": {}}}
    assert zc.scan_finding(same, "schedule") is None
    new = {"total_detections": 30, "what_changed": {"baseline": False, "new_by_type": {"vessel": 3}}}
    f = zc.scan_finding(new, "schedule")
    assert f["count"] == 3 and "3 vessel" in f["text"]
    assert zc.scan_finding({"total_detections": 5, "what_changed": {"baseline": True}}, "schedule")["kind"] == "objects"
    assert zc.scan_finding({"total_detections": 5}, "schedule") is None      # stored before what_changed existed


def test_zone_findings_badge():
    now = dt.datetime(2026, 10, 11, 12)
    radar = {"method": "PWTT", "change": zc.summarize(_out([_r(48, 37)]), None), "total_detections": 1}
    scans = [
        {"scan_id": "a", "created_at": now - dt.timedelta(hours=2), "status": "completed", "triggered_by": "schedule",
         "result_summary": {"total_detections": 0, "what_changed": {"baseline": False, "new_by_type": {}}}},
        {"scan_id": "b", "created_at": now - dt.timedelta(hours=5), "status": "completed",
         "triggered_by": "change-detect", "result_summary": radar},
        {"scan_id": "c", "created_at": now - dt.timedelta(days=3, hours=1), "status": "completed",
         "triggered_by": "schedule", "result_summary": {"total_detections": 4}},
        {"scan_id": "d", "created_at": now - dt.timedelta(hours=1), "status": "error", "triggered_by": "schedule",
         "result_summary": {}},
    ]
    f = zc.zone_findings(scans, now)
    assert f["last_detections"] == 0 and f["detections_7d"] == 4          # change regions are not objects
    assert f["fresh"]["kind"] == "radar_change" and f["fresh"]["scan_id"] == "b"
    assert f["radar_change"]["verdict"] == "changed"
    assert zc.zone_findings([], now)["fresh"] is None
