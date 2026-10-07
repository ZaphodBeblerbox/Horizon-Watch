"""The cursor a local-first client resumes from."""
import datetime as _dt
import sqlite3
import sync_cursor as sc

# rows an hour old: a cursor-less first page only reaches back COLD_START_HOURS,
# and fixed dates aged out of that window (the test was written 2026-09-24)
BASE = (_dt.datetime.utcnow() - _dt.timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M")


def _db(rows):
    c = sqlite3.connect(":memory:")
    c.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, created_at TEXT, v TEXT)")
    c.executemany("INSERT INTO t (id, created_at, v) VALUES (?,?,?)", rows)
    c.commit()
    return c


COLS = ["id", "created_at", "v"]


def _page(c, cursor=None, limit=2):
    return sc.page(c, table="t", ts_col="created_at", id_col="id",
                   columns=COLS, cursor=cursor, limit=limit,
                   where="1=1")


def test_a_cursor_round_trips():
    cur = sc.encode_cursor("2026-09-24T10:00:00", 42)
    assert sc.decode_cursor(cur) == ("2026-09-24T10:00:00", 42)


def test_a_corrupt_cursor_is_a_cold_start_not_an_error():
    # A client that cannot parse its own stored cursor is offline and
    # cannot act on a 400. It gets a window instead.
    assert sc.decode_cursor("!!!not base64!!!") is None
    assert sc.decode_cursor("") is None
    assert sc.decode_cursor(None) is None


def test_it_pages_forward_without_repeating_or_skipping():
    c = _db([(i, f"{BASE}:0{i}", f"v{i}") for i in range(1, 6)])
    seen, cur = [], None
    for _ in range(5):
        p = _page(c, cur, limit=2)
        seen += [r["id"] for r in p["rows"]]
        cur = p["cursor"]
        if not p["more"]:
            break
    assert seen == [1, 2, 3, 4, 5]
    c.close()


def test_rows_sharing_a_timestamp_are_not_lost_or_repeated():
    # A scan writes hundreds of detections in the same second. A bare
    # timestamp cursor either re-sends the whole second every time or
    # drops its tail.
    c = _db([(i, f"{BASE}:00", f"v{i}") for i in range(1, 6)])
    seen, cur = [], None
    for _ in range(5):
        p = _page(c, cur, limit=2)
        seen += [r["id"] for r in p["rows"]]
        cur = p["cursor"]
        if not p["more"]:
            break
    assert seen == [1, 2, 3, 4, 5]
    c.close()


def test_more_is_honest_so_a_client_can_stop_polling():
    c = _db([(i, f"{BASE}:0{i}", "v") for i in range(1, 4)])
    assert _page(c, None, limit=2)["more"] is True
    p = _page(c, _page(c, None, limit=2)["cursor"], limit=2)
    assert p["more"] is False
    c.close()


def test_a_page_is_capped_however_it_is_asked_for():
    c = _db([(i, f"{BASE}:{i:02d}", "v") for i in range(1, 30)])
    assert len(_page(c, None, limit=99999)["rows"]) <= sc.MAX_PAGE
    assert len(_page(c, None, limit=0)["rows"]) >= 1
    c.close()


def test_a_broken_query_returns_the_cursor_unchanged():
    # The client must not advance past rows it never received.
    c = sqlite3.connect(":memory:")
    cur = sc.encode_cursor("2026-09-24T10:00:00", 1)
    out = sc.page(c, table="nope", ts_col="a", id_col="b", columns=["a"],
                  cursor=cur)
    assert out["rows"] == [] and out["cursor"] == cur and "error" in out
    c.close()


def test_a_cold_start_is_bounded_not_everything():
    # Millions of rows will not fit on a laptop and would not be read.
    import inspect
    src = inspect.getsource(sc.page)
    assert "COLD_START_HOURS" in src
    assert sc.COLD_START_HOURS >= 48
