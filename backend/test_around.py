"""around.py: what is relevant around a clicked point, across domains, ranked and deduplicated."""
import datetime as dt

import around as ar

T0 = dt.datetime(2026, 10, 24, 14, 0, tzinfo=dt.timezone.utc)
C = {"lat": 48.8532, "lon": 2.3692, "at": T0.isoformat(), "domain": "live_signal"}


def it(i, dom, north_km=0.0, minutes=0, title=None, sev=None):
    return {"id": f"i{i}", "domain": dom, "title": title or f"thing {i}", "lat": 48.8532 + north_km / 111.0, "lon": 2.3692,
            "at": (T0 + dt.timedelta(minutes=minutes)).isoformat(), "sev": sev}


def test_near_and_recent_first_far_and_old_out():
    rows = ar.rank(C, [it(1, "news", 3.0, 120), it(2, "telegram", 0.2, 5), it(3, "fire", 0.5, -20),
                       it(4, "news", 9.0, 0), it(5, "telegram", 0.1, -60 * 8)], now=T0)
    assert [r["id"] for r in rows] == ["i3", "i2", "i1"]                  # a fire 500 m away outranks a post; 9 km and 8 h ago are out
    assert rows[1]["why"] == "200 m away · 5 min after" and rows[0]["why"].endswith("20 min before")
    assert rows[0]["domain_label"] == "Satellite fire detection"


def test_one_row_per_thing_and_the_clicked_event_excluded():
    rows = ar.rank(C, [it(1, "news", 0.3, 2, title="Explosion at Bastille"), it(2, "news", 0.4, 3, title="Explosion at Bastille!"),
                       {**it(3, "telegram", 0.1, 1), "ref": "tg:a:1"}], now=T0, exclude_refs={"tg:a:1"})
    assert len(rows) == 1 and rows[0]["title"].startswith("Explosion")


def test_traffic_is_there_now_and_graver_items_rank_up():
    rows = ar.rank(C, [it(1, "vessel", 1.0, -60 * 20), it(2, "alert", 2.0, 30, sev="critical"), it(3, "alert", 2.0, 30)], now=T0)
    assert rows[0]["id"] == "i2" and any(r["id"] == "i1" and r["why"].endswith("there now") for r in rows)


def test_adapters_carry_the_fields():
    s = ar.from_signal({"id": "ls-x", "title": "Arrest at Bastille", "lat": 1, "lon": 2, "event_time": "t", "high_impact": True,
                        "muted": False, "sources": [{"url": "https://t.me/a/1"}], "event_id": "ev_1"})
    assert s["domain"] == "live_signal" and s["url"] == "https://t.me/a/1" and s["sev"] == "high" and s["event_id"] == "ev_1"
    assert ar.from_alert({"alert_type": "Heat", "title": "Fire", "lat": 1, "lon": 2})["domain"] == "fire"
    assert ar.from_vessel({"mmsi": 123, "name": "ALPHA", "lat": 1, "lon": 2})["title"] == "ALPHA (vessel)"
