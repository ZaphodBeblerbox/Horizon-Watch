"""The notification tray's query must be indexable.

Why this exists: the tray was empty in production and it looked like a
frontend fault. It was not — /api/notifications never returned. The
query asks for status='active' AND created_at >= cutoff, ordered by
created_at DESC and limited, and with separate indexes on status and
created_at SQLite chose the status index and then sorted every matching
row in a temp B-tree. The LIMIT could not short-circuit, so the whole
active set was sorted on every call: 4.592s at 49,218 active alerts
locally, and no response at all against production.
"""
import sqlite3


def _db(with_index: bool):
    c = sqlite3.connect(":memory:")
    c.execute("""CREATE TABLE alerts (
        id INTEGER PRIMARY KEY, alert_id TEXT, status TEXT,
        created_at TEXT, title TEXT)""")
    c.execute("CREATE INDEX ix_alerts_status ON alerts(status)")
    c.execute("CREATE INDEX ix_alerts_created_at ON alerts(created_at)")
    if with_index:
        c.execute("CREATE INDEX ix_alerts_status_created ON alerts(status, created_at)")
    rows = [(f"ALT-{i}", "active" if i % 2 else "closed",
             f"2026-09-{(i % 28) + 1:02d}", "t") for i in range(4000)]
    c.executemany("INSERT INTO alerts (alert_id,status,created_at,title) VALUES (?,?,?,?)", rows)
    c.commit()
    return c


QUERY = ("SELECT * FROM alerts WHERE status='active' AND created_at >= '2026-09-10'"
         " ORDER BY created_at DESC LIMIT 2400")


def test_without_the_composite_index_it_sorts_everything():
    plan = " ".join(str(r[-1]) for r in _db(False).execute("EXPLAIN QUERY PLAN " + QUERY))
    assert "TEMP B-TREE" in plan.upper(), plan


def test_with_it_the_scan_is_already_in_order():
    plan = " ".join(str(r[-1]) for r in _db(True).execute("EXPLAIN QUERY PLAN " + QUERY))
    assert "TEMP B-TREE" not in plan.upper(), plan
    assert "ix_alerts_status_created" in plan, plan


def test_the_schema_declares_it():
    # It must also be in the model, or a fresh database is built without
    # it and only existing ones get it from the migration.
    import database
    idx = {i.name for i in database.Alert.__table__.indexes}
    assert "ix_alerts_status_created" in idx, idx


def test_the_migration_creates_it_on_an_existing_database():
    # create_all() never adds an index to a table that already exists,
    # so without the explicit migration production would never get it.
    import re
    src = open("database.py").read()
    assert re.search(r"CREATE INDEX IF NOT EXISTS ix_alerts_status_created", src)
    assert "PRAGMA index_list(alerts)" in src


def test_the_index_does_not_change_the_answer():
    # An index must not change WHICH rows come back. It may change the
    # order among rows sharing a created_at, because the query has no
    # tiebreak — that is a property of the query, not of the index, and
    # asserting a stable order here would be asserting something SQLite
    # never promised.
    a = _db(False).execute(QUERY).fetchall()
    b = _db(True).execute(QUERY).fetchall()
    assert {r[1] for r in a} == {r[1] for r in b}
    assert len(a) == len(b)


def test_results_are_ordered_newest_first_either_way():
    for with_index in (False, True):
        dates = [r[3] for r in _db(with_index).execute(QUERY).fetchall()]
        assert dates == sorted(dates, reverse=True), with_index
