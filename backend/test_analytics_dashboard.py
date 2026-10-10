"""analytics_dashboard: alerts fold into alert_daily by band, kind and
country (names and codes to one key), and build() reads them per day."""
import datetime as dt
import sqlite3

import analytics_dashboard as ad

TODAY = dt.date(2026, 10, 10)


def _db(tmp_path):
    p = str(tmp_path / "a.db")
    con = sqlite3.connect(p)
    con.execute("CREATE TABLE alerts (alert_id TEXT, alert_type TEXT, severity TEXT, country_code TEXT, title TEXT,"
                " lat REAL, lon REAL, created_at TEXT)")
    rows = [
        ("1", "AIS_DARK_SHIP", "critical", "ua", "a", 1, 2, "2026-10-10T08:00:00"),
        ("2", "AIS_DARK_SHIP", "significant", "UKRAINE", "b", 1, 2, "2026-10-10T09:00:00"),
        ("3", "gps_interference", "low", "", "c", None, None, "2026-10-09T09:00:00"),
        ("4", "gps_interference", "medium", "ir", "d", 1, 2, "2026-09-01T09:00:00"),
    ]
    con.executemany("INSERT INTO alerts VALUES (?,?,?,?,?,?,?,?)", rows)
    con.commit(); con.close()
    return p


def test_refresh_and_build(tmp_path):
    p = _db(tmp_path)
    done = ad.refresh_daily(p, keep_days=7, today=TODAY)
    assert done[:2] == ["2026-10-10", "2026-10-09"]
    out = ad.build(p, days=7, today=TODAY)
    last = out["alerts_per_day"][-1]
    assert last["date"] == "2026-10-10" and last["critical"] == 1 and last["high"] == 1
    assert out["alerts_per_day"][-2]["low"] == 1
    # "ua" and "UKRAINE" are one country
    assert [c["key"] for c in out["countries"]] == ["ua"] and out["countries"][0]["value"] == 2
    assert out["kpis"][0]["value"] == 3
    # filters
    assert ad.build(p, days=7, kind="gps_interference", today=TODAY)["kpis"][0]["value"] == 1
    assert ad.build(p, days=7, country="ua", today=TODAY)["kpis"][0]["value"] == 2


def test_empty_days_are_marked_done(tmp_path):
    p = _db(tmp_path)
    ad.refresh_daily(p, keep_days=7, max_new_days=10, today=TODAY)
    con = sqlite3.connect(p)
    days = {r[0] for r in con.execute("SELECT DISTINCT day FROM alert_daily")}
    assert len(days) == 7
    # a second call recounts only today and yesterday
    assert ad.refresh_daily(p, keep_days=7, today=TODAY) == ["2026-10-10", "2026-10-09"]


def test_day_detail_most_serious_first(tmp_path):
    p = _db(tmp_path)
    rows = ad.day_detail(p, "2026-10-10")
    assert rows[0]["band"] == "critical" and rows[0]["country"]
