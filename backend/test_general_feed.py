"""general_feed: one timeline across sources, newest first, paged without repeats."""
import sqlite3

import general_feed as g


def _db(tmp_path):
    p = str(tmp_path / "f.db")
    c = sqlite3.connect(p)
    c.executescript("""
    CREATE TABLE alerts (alert_id TEXT, alert_type TEXT, title TEXT, severity TEXT, lat REAL, lon REAL, region TEXT, country_code TEXT, source TEXT, created_at TEXT);
    CREATE TABLE geoconfirmed_placemarks (id TEXT, title TEXT, name TEXT, description TEXT, date TEXT, latitude REAL, longitude REAL, faction TEXT,
        original_source TEXT, theatre_slug TEXT, ingested_at TEXT);
    CREATE TABLE telegram_posts (channel TEXT, msg_id INT, channel_title TEXT, posted_at TEXT, headline TEXT, summary_en TEXT, text TEXT, media TEXT,
        thumb TEXT, place TEXT, country_code TEXT, lat REAL, lon REAL, event_type TEXT, role TEXT, graphic INT, relevant INT, unpublished_reason TEXT);
    """)
    c.executemany("INSERT INTO alerts VALUES (?,?,?,?,?,?,?,?,?,?)", [
        ("a1", "Heat", "New heat at a refinery", "high", 1, 2, "Iraq", "iq", "firms", "2026-10-10 12:00:00.1"),
        ("a2", "gps_interference", "GPS degraded", "high", 1, 2, "x", "", "gps", "2026-10-10 13:00:00.1"),
    ])
    c.execute("INSERT INTO geoconfirmed_placemarks VALUES ('g1','','30 MAR','Strike on a depot','2026-10-10 00:00:00.0',1,2,'X',"
              "'https://x.com/someone/status/123 more','ua','2026-10-10')")
    c.execute("INSERT INTO telegram_posts VALUES ('chan',5,'Chan','2026-10-10T14:00:00+00:00','Drone hits Sanaa','',''"
              ",'video',NULL,'Sanaa','ye',15,44,'strike','local',0,1,NULL)")
    c.commit(); c.close()
    return p


def test_one_timeline(tmp_path):
    d = g.feed(_db(tmp_path), limit=5)
    assert [i["kind"] for i in d["items"]] == ["telegram", "signal", "geoconfirmed"]
    gc = d["items"][-1]
    assert gc["headline"] == "Strike on a depot" and gc["x_url"] == "https://x.com/someone/status/123"
    assert all(i["headline"] != "GPS degraded" for i in d["items"])      # readings are not events


def test_paging_has_no_repeats(tmp_path):
    p = _db(tmp_path)
    first = g.feed(p, limit=5, kinds=("signal", "telegram"))["items"]
    later = g.feed(p, before=first[0]["at"], limit=5)["items"]
    assert first[0]["id"] not in {i["id"] for i in later}
