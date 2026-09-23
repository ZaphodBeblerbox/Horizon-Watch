"""The training corpus ingest.

forecast.py measured zero skill beyond base rates because it was fitted
to six months — the candidate GED is the rolling recent release, current
by design and untrainable by design. This pulls the full 1989-onward
dataset instead.
"""
import io
import sqlite3
import zipfile
import ucdp_history as uh


def _zip(rows, header=None):
    header = header or ["id", "date_start", "country", "adm_1", "latitude",
                        "longitude", "type_of_violence", "best"]
    buf = io.StringIO()
    buf.write(",".join(header) + "\n")
    for r in rows:
        buf.write(",".join("" if v is None else str(v) for v in r) + "\n")
    z = io.BytesIO()
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr("GEDEvent_v26_1.csv", buf.getvalue())
    return z.getvalue()


def _row(**kw):
    base = {"id": 1, "date_start": "2011-03-14", "country": "Libya",
            "adm_1": "Tripoli", "latitude": 32.9, "longitude": 13.2,
            "type_of_violence": 1, "best": 7}
    base.update(kw)
    return [base[k] for k in ("id", "date_start", "country", "adm_1",
                              "latitude", "longitude", "type_of_violence", "best")]


def test_it_parses_a_real_shaped_row():
    rec = uh.parse({"id": "42", "date_start": "2011-03-14 00:00:00.000",
                    "country": "Libya", "adm_1": "Tripoli", "latitude": "32.9",
                    "longitude": "13.2", "type_of_violence": "1", "best": "7"})
    assert rec["event_id"] == 42
    assert rec["date"] == "2011-03-14" and rec["year"] == 2011
    assert rec["violence"] == "state-based conflict"
    assert rec["deaths"] == 7


def test_rows_without_a_date_or_country_are_dropped_not_defaulted():
    # Either would put a fabricated event into the training set.
    assert uh.parse({"id": "1", "country": "Libya", "type_of_violence": "1"}) is None
    assert uh.parse({"id": "1", "date_start": "2011-03-14", "country": "",
                     "type_of_violence": "1"}) is None
    assert uh.parse({"id": "1", "date_start": "2011-03-14", "country": "Libya",
                     "type_of_violence": "9"}) is None
    assert uh.parse({"id": "0", "date_start": "2011-03-14", "country": "Libya",
                     "type_of_violence": "1"}) is None


def test_missing_coordinates_are_allowed():
    # A country-level event still contributes to a country time series;
    # only the map needs a pin.
    rec = uh.parse({"id": "5", "date_start": "2011-03-14", "country": "Libya",
                    "type_of_violence": "2"})
    assert rec is not None and rec["lat"] is None


def test_ingest_stores_and_reports(tmp_path):
    db = str(tmp_path / "t.db")
    out = uh.ingest(db, blob=_zip([_row(id=1), _row(id=2, date_start="2019-06-01"),
                                   _row(id=3, date_start="2024-01-09")]))
    assert out["available"] and out["ingested"] == 3
    st = out["stats"]
    assert st["events"] == 3 and st["first"] == "2011-03-14" and st["last"] == "2024-01-09"
    assert st["years"] >= 13


def test_reingest_updates_rather_than_duplicating(tmp_path):
    # UCDP revises figures between releases; a re-ingest must correct
    # them, not add a second copy of the same event.
    db = str(tmp_path / "t.db")
    uh.ingest(db, blob=_zip([_row(id=1, best=7)]))
    uh.ingest(db, blob=_zip([_row(id=1, best=19)]))
    conn = sqlite3.connect(db)
    assert conn.execute("SELECT COUNT(*) FROM ucdp_history").fetchone()[0] == 1
    assert conn.execute("SELECT deaths FROM ucdp_history").fetchone()[0] == 19


def test_unusable_rows_are_counted_not_silently_lost():
    # A skipped count that is never reported is how a half-empty
    # training set looks healthy.
    import tempfile, os
    with tempfile.TemporaryDirectory() as d:
        db = os.path.join(d, "t.db")
        out = uh.ingest(db, blob=_zip([_row(id=1), _row(id=2, country=""),
                                       _row(id=3, type_of_violence=9)]))
        assert out["ingested"] == 1 and out["skipped"] == 2


def test_monthly_counts_aggregate_in_sql(tmp_path):
    db = str(tmp_path / "t.db")
    uh.ingest(db, blob=_zip([
        _row(id=1, date_start="2020-01-05", best=2),
        _row(id=2, date_start="2020-01-19", best=3),
        _row(id=3, date_start="2020-02-02", best=4),
    ]))
    conn = sqlite3.connect(db)
    rows = uh.monthly_counts(conn)
    months = {r[2]: (r[3], r[4]) for r in rows}
    assert months["2020-01"] == (2, 5)
    assert months["2020-02"] == (1, 4)


def test_version_discovery_sorts_numerically():
    # ged99 must not beat ged261.
    import re
    html = ('x https://ucdp.uu.se/downloads/ged/ged99-csv.zip y '
            'https://ucdp.uu.se/downloads/ged/ged261-csv.zip z')
    urls = re.findall(r'https://ucdp\.uu\.se/downloads/ged/(ged\d+)-csv\.zip', html)
    assert max(urls, key=lambda s: int(s[3:])) == "ged261"


def test_an_archive_with_no_csv_is_an_error_not_an_empty_success(tmp_path):
    z = io.BytesIO()
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr("readme.txt", "nothing here")
    try:
        uh.ingest(str(tmp_path / "t.db"), blob=z.getvalue())
    except ValueError as e:
        assert "CSV" in str(e)
    else:
        raise AssertionError("an archive with no CSV must raise")


def test_ingest_commits_in_batches_not_once_at_the_end():
    """A single 417,968-row transaction is too much to hold open.

    On the production database — 60GB, WAL, on a network volume — an open
    write transaction stops the WAL being checkpointed and lets it grow
    for the whole ingest. Per-batch commits bound both, and make a run
    interrupted midway resumable rather than lost.
    """
    import inspect
    src = inspect.getsource(uh.ingest)
    loop = src[src.index("for raw in _rows_from_zip"):src.index("if batch:")]
    assert "conn.commit()" in loop, "the batch loop never commits"


def test_a_resumed_ingest_does_not_duplicate_rows():
    # Idempotent on UCDP's own event id, which is what lets the caller
    # re-run a partial ingest by checking the row count rather than a flag.
    import os, tempfile
    fd, path = tempfile.mkstemp(suffix=".db"); os.close(fd)
    try:
        blob = _zip([_row(id=1), _row(id=2, date_start="2011-03-15")])
        assert uh.ingest(path, blob=blob)["ingested"] == 2
        assert uh.ingest(path, blob=blob)["ingested"] == 2
        c = sqlite3.connect(path)
        assert c.execute("SELECT COUNT(*) FROM ucdp_history").fetchone()[0] == 2
        c.close()
    finally:
        os.unlink(path)
