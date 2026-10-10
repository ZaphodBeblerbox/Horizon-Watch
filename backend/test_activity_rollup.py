import datetime as dt
import sqlite3

import activity_rollup as ar


def test_rolls_completed_missing_days_only(tmp_path):
    db = tmp_path / "a.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE track_density (grid_lat REAL, grid_lon REAL, hour TEXT, domain TEXT, count INT, avg_speed REAL)")
    con.execute("CREATE TABLE activity_daily (day TEXT, domain TEXT, grid_lat INT, grid_lon INT, count INT, avg_speed REAL,"
                " PRIMARY KEY (day, domain, grid_lat, grid_lon))")
    con.execute("INSERT INTO activity_daily VALUES ('2026-10-05','ais',10,20,1,1)")
    rows = [(10.5, 20.5, "2026-10-06 03:00:00", "ais", 5, 10), (10.2, 20.9, "2026-10-06 04:00:00", "ais", 7, 12),
            (-3.5, 40.1, "2026-10-07 01:00:00", "adsb", 2, 300), (10.5, 20.5, "2026-10-08 05:00:00", "ais", 9, 9)]
    con.executemany("INSERT INTO track_density VALUES (?,?,?,?,?,?)", rows)
    con.commit(); con.close()
    done = ar.roll_missing_days(str(db), today=dt.date(2026, 10, 8))
    assert done == ["2026-10-06", "2026-10-07"]                    # the 8th is not complete yet
    con = sqlite3.connect(db)
    assert con.execute("SELECT count FROM activity_daily WHERE day='2026-10-06'").fetchone()[0] == 12
    assert con.execute("SELECT grid_lat, grid_lon FROM activity_daily WHERE day='2026-10-07'").fetchone() == (-4, 40)
    assert ar.roll_missing_days(str(db), today=dt.date(2026, 10, 8)) == []
