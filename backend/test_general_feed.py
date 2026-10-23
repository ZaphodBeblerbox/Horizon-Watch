"""general_feed: one timeline across sources, newest first, paged without repeats."""
import sqlite3

import general_feed as g


def _db(tmp_path):
    p = str(tmp_path / "f.db")
    c = sqlite3.connect(p)
    c.executescript("""
    CREATE TABLE alerts (id INTEGER PRIMARY KEY, alert_id TEXT, alert_type TEXT, title TEXT, severity TEXT, lat REAL, lon REAL, region TEXT,
        country_code TEXT, source TEXT, created_at TEXT, entity_id TEXT, raw_json TEXT, status TEXT DEFAULT 'active');
    CREATE INDEX ix_alerts_alert_type ON alerts (alert_type);
    CREATE TABLE geoconfirmed_placemarks (id TEXT, title TEXT, name TEXT, description TEXT, date TEXT, latitude REAL, longitude REAL, faction TEXT,
        original_source TEXT, theatre_slug TEXT, ingested_at TEXT, status TEXT DEFAULT 'active');
    CREATE TABLE telegram_posts (channel TEXT, msg_id INT, channel_title TEXT, posted_at TEXT, headline TEXT, summary_en TEXT, text TEXT, media TEXT,
        thumb TEXT, place TEXT, country_code TEXT, lat REAL, lon REAL, event_type TEXT, role TEXT, graphic INT, relevant INT, unpublished_reason TEXT);
    """)
    c.executemany("INSERT INTO alerts (alert_id, alert_type, title, severity, lat, lon, region, country_code, source, created_at)"
                  " VALUES (?,?,?,?,?,?,?,?,?,?)", [
        ("a1", "Heat", "New heat at a refinery", "high", 1, 2, "Iraq", "iq", "firms", "2026-10-10 12:00:00.1"),
        ("a2", "gps_interference", "GPS degraded", "high", 1, 2, "x", "", "gps", "2026-10-10 13:00:00.1"),
    ])
    c.execute("INSERT INTO geoconfirmed_placemarks (id, title, name, description, date, latitude, longitude, faction, original_source,"
              " theatre_slug, ingested_at) VALUES ('g1','','30 MAR','Strike on a depot','2026-10-10 00:00:00.0',30,2,'X',"
              "'https://x.com/someone/status/123 more','ua','2026-10-10 11:00:00')")
    c.execute("INSERT INTO telegram_posts VALUES ('chan',5,'Chan','2026-10-10T14:00:00+00:00','Drone hits Sanaa','',''"
              ",'video',NULL,'Sanaa','ye',15,44,'strike','local',0,1,NULL)")
    c.commit(); c.close()
    return p


def test_one_timeline(tmp_path):
    d = g.feed(_db(tmp_path), limit=5)
    assert [i["kind"] for i in d["items"]] == ["telegram", "signal", "geoconfirmed"]
    assert d["items"][-1]["event_date"] == "2026-10-10"
    gc = d["items"][-1]
    assert gc["headline"] == "Strike on a depot" and gc["x_url"] == "https://x.com/someone/status/123"
    assert all(i["headline"] != "GPS degraded" for i in d["items"])      # readings are not events


def test_paging_has_no_repeats(tmp_path):
    p = _db(tmp_path)
    first = g.feed(p, limit=5, kinds=("signal", "telegram"))["items"]
    later = g.feed(p, before=first[0]["at"], limit=5)["items"]
    assert first[0]["id"] not in {i["id"] for i in later}


def _add_alerts(p, rows):
    c = sqlite3.connect(p)
    c.executemany("INSERT INTO alerts (alert_id, alert_type, title, severity, lat, lon, region, country_code, source, created_at, entity_id, raw_json)"
                  " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", rows)
    c.commit(); c.close()


def test_own_alerts_only_never_news(tmp_path):
    """The General desk is our own alerts: no article surges, no news, no
    forecasts, no unconfirmed sanctions; a Telegram mood alert is ours."""
    p = _db(tmp_path)
    _add_alerts(p, [
        ("n1", "surge_volume_surge", "Conflict surge — Kyiv", "critical", 50, 30, None, "ua", "surge", "2026-10-10 15:00:00", None, None),
        ("n2", "imminence", "Colombia: conflict running 2.7x", "critical", 4, -74, None, "co", "forecast", "2026-10-10 15:01:00", None, None),
        ("n3", "Sanctioned Vessel (Possible)", "Possible sanctioned vessel X", "medium", 50, 0, None, "", "AIS", "2026-10-10 15:02:00", "1", None),
        ("n4", "Sanctioned Vessel", "Sanctioned vessel NAMESAKE in the North Sea", "critical", 55, 3, None, "", "AIS", "2026-10-10 15:03:00", "211000000",
         '{"payload": {"match": "exact_name", "sanctions_confirmed": true}}'),
        ("o1", "Sanctioned Vessel", "Sanctioned vessel SMYRTOS in the English Channel", "critical", 50.5, -2.3, None, "", "AIS", "2026-10-10 15:04:00",
         "613411302", '{"mmsi": "613411302", "payload": {"match": "mmsi", "sanctions_confirmed": true}}'),
        ("o2", "Imagery signal", "Rostock hafen: black smoke plume", "high", 54.1, 12.1, "Rostock hafen", "de", "SAT-TASK", "2026-10-10 15:05:00", None, None),
        ("o3", "Telegram mood: calls for conflict rising", "Telegram mood: calls for war rising in Serbian channels", "medium", 44.8, 20.4,
         None, "rs", "telegram", "2026-10-10 15:06:00", None, None),
        ("o4", "Russia-linked vessel loitering", "Russian ship loitering 12 km off Gotland", "critical", 57.5, 18.9, None, "", "AIS",
         "2026-10-10 15:07:00", "273000000", None),
    ])
    ids = {i["id"] for i in g.feed(p, limit=20, kinds=("signal",))["items"]}
    assert {"sig:o1", "sig:o2", "sig:o3", "sig:o4"} <= ids
    assert not ids & {"sig:n1", "sig:n2", "sig:n3", "sig:n4"}


def test_one_event_one_card(tmp_path):
    p = _db(tmp_path)
    _add_alerts(p, [
        ("h1", "Heat", "Strong new heat at Baiji refinery (80 MW)", "high", 34.93, 43.49, "Iraq", "iq", "FIRMS", "2026-10-10 16:00:00", None, None),
        ("h2", "Imagery signal", "Baiji refinery: black smoke plume from a fire", "critical", 34.94, 43.49, "Iraq", "iq", "SAT-TASK",
         "2026-10-10 17:00:00", None, None),
    ])
    items = g.feed(p, limit=20, kinds=("signal",))["items"]
    baiji = [i for i in items if "Baiji" in i["headline"]]
    assert len(baiji) == 1 and baiji[0]["also_count"] == 1
    assert baiji[0]["id"] == "sig:h2"                         # the most severe leads
    assert baiji[0]["at"].startswith("2026-10-10T17:00")


def test_cursor_keeps_rows_stamped_in_the_same_second(tmp_path):
    """A GeoConfirmed sync stamps many rows in one second: paging must not
    skip the rest of them."""
    p = _db(tmp_path)
    c = sqlite3.connect(p)
    c.executemany("INSERT INTO geoconfirmed_placemarks (id, title, description, date, latitude, longitude, original_source, theatre_slug, ingested_at)"
                  " VALUES (?,?,?,?,?,?,?,?,?)",
                  [(f"b{n}", "", f"Event {n}", "2026-10-11", 10 + n, 10 + n, "", "ua", f"2026-10-11 09:00:00.{n:06d}") for n in range(12)])
    c.commit(); c.close()
    seen, before = [], None
    for _ in range(5):
        d = g.feed(p, before=before, limit=5, kinds=("geoconfirmed",))
        seen += [i["id"] for i in d["items"]]
        before = d["next"]
        if not before:
            break
    assert len([s for s in seen if s.startswith("gc:b")]) == 12 and len(set(seen)) == len(seen)


def test_geoconfirmed_is_dated_by_its_event_not_by_our_sync(tmp_path):
    """2026-10-23: GeoConfirmed items weeks old read 'just now' — they carried the
    sync's ingested_at. An event stored after its day is dated by its day, marked
    day-precision; one stored on its own day keeps the time we learned of it."""
    p = _db(tmp_path)
    c = sqlite3.connect(p)
    c.executemany("INSERT INTO geoconfirmed_placemarks (id, title, description, date, latitude, longitude, original_source, theatre_slug, ingested_at)"
                  " VALUES (?,?,?,?,?,?,?,?,?)", [
        ("old", "", "Strike weeks ago", "2026-09-20 00:00:00.000000", 48, 37, "", "ukraine", "2026-10-22 17:30:08.545362"),
        ("today", "", "Strike today", "2026-10-22 00:00:00.000000", 48, 37, "", "ukraine", "2026-10-22 09:15:00.000000"),
    ] + [(f"m{n}", "", f"Mid {n}", f"2026-10-{n + 1:02d} 00:00:00.000000", 48, 37, "", "ukraine", "2026-10-22 17:30:08.5") for n in range(9)])
    c.commit(); c.close()
    seen, before = [], None
    for _ in range(10):
        d = g.feed(p, before=before, limit=5, kinds=("geoconfirmed",))
        seen += d["items"]
        before = d["next"]
        if not before:
            break
    by = {i["id"]: i for i in seen}
    assert by["gc:old"]["at"] == "2026-09-20T23:59:59" and by["gc:old"]["at_precision"] == "day"
    assert by["gc:old"]["published_at"].startswith("2026-10-22T17:30")
    assert by["gc:today"]["at"].startswith("2026-10-22T09:15") and by["gc:today"]["at_precision"] == "time"
    ids = [i["id"] for i in seen]
    assert ids[0] == "gc:today" and ids[-1] == "gc:old"           # chronology by the event
    assert len(ids) == len(set(ids)) == 12                        # paged without repeats or gaps (+ g1)


def test_own_source_rule():
    assert g.is_own_source("geoconfirmed") and g.is_own_source("FIRMS") and g.is_own_source("AIS")
    assert not g.is_own_source("gdelt") and not g.is_own_source("rss:reuters") and not g.is_own_source("News API")
    assert g.is_news("surge", "surge_volume_surge") and not g.is_news("SAT-TASK", "Imagery signal")


def _flood(p, n_tg=120, n_gc=20, n_sig=20):
    """Production's shape: Telegram every minute, GeoConfirmed and alerts a few an hour."""
    c = sqlite3.connect(p)
    c.executemany("INSERT INTO telegram_posts VALUES (?,?,?,?,?,'','',NULL,NULL,'Kharkiv','ua',?,?,'strike','local',0,1,NULL)",
                  [("tg", 100 + i, "TG", f"2026-10-11T{12 + (59 - i % 60) // 60 + (1 - i // 60)}:{59 - i % 60:02d}:00+00:00",
                    f"Telegram report {i} about item{i}", 40 + i, 20 + i) for i in range(n_tg)])
    c.executemany("INSERT INTO geoconfirmed_placemarks (id, title, description, date, latitude, longitude, faction, original_source, theatre_slug,"
                  " ingested_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                  [(f"m{i}", f"Verified strike number{i}", "", "2026-10-11", -10 - i, -10 - i, "Russia",
                    f"https://x.com/gc/status/{9000 + i}", "ukraine", f"2026-10-11 {11 - i // 4:02d}:{(i % 4) * 15:02d}:00.{i:06d}") for i in range(n_gc)])
    c.executemany("INSERT INTO alerts (alert_id, alert_type, title, severity, lat, lon, region, country_code, source, created_at)"
                  " VALUES (?,?,?,?,?,?,?,?,?,?)",
                  [(f"s{i}", "Heat", f"Heat signal place{i}", "high", 60 + i, 100 + i, "R", "ru", "firms", f"2026-10-11 {11 - i // 4:02d}:{(i % 4) * 15 + 5:02d}:00.1")
                   for i in range(n_sig)])
    c.commit(); c.close()


def test_fair_mix_shares_chronology_and_cursor(tmp_path):
    """A page of All is never one kind: GeoConfirmed and alerts get their
    share even when Telegram has a minute-by-minute flood; each page reads
    newest first; paging on reaches every item once."""
    p = _db(tmp_path)
    _flood(p)
    total = {"telegram": 121, "geoconfirmed": 21, "signal": 21}
    seen, before, pages = [], None, 0
    while pages < 30:
        d = g.feed(p, before=before, limit=20)
        items = d["items"]
        pages += 1
        if pages == 1:
            kinds = [i["kind"] for i in items]
            assert kinds.count("geoconfirmed") >= 5 and kinds.count("signal") >= 5      # 25% of 20
            assert kinds.count("telegram") >= 5
            assert items[0]["kind"] == "telegram"                                       # the newest still leads
            gc = next(i for i in items if i["kind"] == "geoconfirmed")
            assert gc["place"] == "Ukraine" and gc["faction"] == "Russia" and gc["x_url"]
        ats = [i["at"] for i in items]
        assert ats == sorted(ats, reverse=True)
        seen += [x["id"] for i in items for x in [i, *(i.get("also") or [])]]
        before = d["next"]
        if not before:
            break
    assert before is None
    got = set(seen)
    for kind, n in total.items():
        pre = {"telegram": "tg/", "geoconfirmed": "gc:", "signal": "sig:"}[kind]
        assert len([s for s in got if s.startswith(pre) or (kind == "telegram" and s.startswith("chan/"))]) == n, kind


def test_single_kind_and_old_cursor_still_work(tmp_path):
    p = _db(tmp_path)
    _flood(p)
    d = g.feed(p, limit=10, kinds=("geoconfirmed",))
    assert {i["kind"] for i in d["items"]} == {"geoconfirmed"} and len(d["items"]) == 10
    assert d["next"].startswith("g=") and "t=" not in d["next"]
    old = g.feed(p, before="2026-10-11T12:00:00", limit=10)                           # a plain time: every kind from there
    assert old["items"] and all(i["at"] < "2026-10-11T12:00:00" for i in old["items"])
