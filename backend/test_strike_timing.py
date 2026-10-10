"""The strike-timing indicators: what each measures, and when it is elevated."""
import datetime as dt

import strike_timing as st

NOW = dt.datetime(2026, 10, 10, 2, 30)   # naive UTC, as aircraft_history stores it


def test_us_military_range():
    assert st.us_military("ae1234") and st.us_military("AFFFFF")
    assert not st.us_military("3c6444") and not st.us_military(None)


def test_the_window_is_thursday_evening_to_saturday():
    assert st.in_window(dt.datetime(2026, 10, 8, 19))       # Thu 19:00
    assert not st.in_window(dt.datetime(2026, 10, 8, 12))   # Thu noon
    assert st.in_window(dt.datetime(2026, 10, 10, 23))      # Sat
    assert not st.in_window(dt.datetime(2026, 10, 11, 1))   # Sun


def test_most_reference_openings_fall_in_the_window():
    w = st.week_pattern(dt.datetime(2026, 10, 7, 9, tzinfo=dt.timezone.utc))   # a Wednesday
    assert w["value"] == "12 of 17" and w["elevated"] is False


def _row(icao, typ, hours_ago, lat=50.0, lon=10.0, cs="X"):
    return (icao, cs, typ, lat, lon, (NOW - dt.timedelta(hours=hours_ago)).strftime("%Y-%m-%d %H:%M:%S"))


def test_tankers_against_the_hourly_median():
    rows = [_row(f"ae00{h:02d}", "K35R", h) for h in range(3, 24)]            # one an hour, earlier
    rows += [_row(f"ae10{i:02d}", "K35R", 0.3) for i in range(6)]             # six now
    t = st.tankers(rows, NOW)
    assert t["value"] == "6" and t["baseline"] == 1 and t["elevated"]
    assert not st.tankers([_row("3c0001", "K35R", 0.2)] * 9, NOW)["elevated"]  # not US


def test_command_aircraft_flag_the_nuclear_ones():
    c = st.c2isr([_row("ae0412", "E6", 0.2, cs="GOTO FMS"), _row("ae5555", "P8", 0.1)], NOW)
    assert c["value"] == "2" and c["elevated"] and "E-6B GOTO FMS" in c["text"]
    assert not st.c2isr([_row("ae5555", "P8", 0.1)], NOW)["elevated"]


def test_no_baseline_no_alarm_then_a_real_one():
    import sqlite3
    con = sqlite3.connect(":memory:")
    rows = [_row(f"ae20{i:02d}", "C17", 2) for i in range(30)]
    a = st.airlift(con, rows, NOW)
    assert a["value"] == "30" and a["baseline"] is None and not a["elevated"] and "still building" in a["text"]
    for d, v in (("2026-10-06", 10), ("2026-10-07", 12), ("2026-10-08", 9)):
        st._remember(con, d, "airlift", v)
    a = st.airlift(con, rows, NOW)
    assert a["baseline"] == 10 and a["elevated"]
