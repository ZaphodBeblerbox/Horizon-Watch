"""Candidate GED, tested without touching the network."""
import csv
import datetime
import io
import os
import sqlite3
import tempfile

import ucdp_candidate as uc

COLS = ["id", "date_start", "country", "type_of_violence", "adm_1",
        "latitude", "longitude", "best"]


def _csv(rows):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=COLS)
    w.writeheader()
    for r in rows:
        w.writerow(r)
    return buf.getvalue().encode()


def _ev(i, date, country="Sudan", v="1", deaths=3):
    return {"id": i, "date_start": f"{date} 00:00:00.000", "country": country,
            "type_of_violence": v, "adm_1": "X", "latitude": "15.5",
            "longitude": "32.5", "best": deaths}


def _db():
    fd, p = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    return p


def test_release_urls_reach_back_into_the_previous_year():
    # A January console still needs the prior December, and the annual
    # GED that would supersede it is published months later.
    u = uc.release_urls(datetime.datetime(2026, 2, 1))
    tags = [t for t, _ in u]
    assert "25_0_12" in tags
    assert "26_0_2" in tags
    assert "26_0_3" not in tags          # not published yet


def test_a_missing_release_is_not_an_error():
    # The loop walks past months that have not been published.
    p = _db()
    try:
        out = uc.ingest(p, blobs=[("26_0_1", _csv([_ev(1, "2026-01-05")])),
                                  ("26_0_2", None)])
        assert out["ok"], out
        assert out["events"] == 1
        assert out["releases"] == ["26_0_1"]
    finally:
        os.unlink(p)


def test_releases_merge_on_event_id_with_the_later_one_winning():
    # Each file holds one month plus late-coded stragglers, and an event
    # re-coded in a later release is a correction, not a duplicate.
    p = _db()
    try:
        uc.ingest(p, blobs=[
            ("26_0_1", _csv([_ev(1, "2026-01-05", deaths=2)])),
            ("26_0_2", _csv([_ev(1, "2026-01-05", deaths=9),     # re-coded
                             _ev(2, "2026-02-03")])),
        ])
        c = sqlite3.connect(p)
        assert c.execute("SELECT COUNT(*) FROM ucdp_candidate").fetchone()[0] == 2
        assert c.execute(
            "SELECT deaths, release FROM ucdp_candidate WHERE event_id=1"
        ).fetchone() == (9, "26_0_2")
        c.close()
    finally:
        os.unlink(p)


def test_a_withdrawn_event_does_not_survive_the_next_ingest():
    # This is why the table is replaced rather than appended to: UCDP can
    # retract a candidate event, and an append-only table would keep it
    # forever.
    p = _db()
    try:
        uc.ingest(p, blobs=[("26_0_1", _csv([_ev(1, "2026-01-05"),
                                             _ev(2, "2026-01-06")]))])
        uc.ingest(p, blobs=[("26_0_1", _csv([_ev(1, "2026-01-05")]))])
        c = sqlite3.connect(p)
        assert [r[0] for r in c.execute(
            "SELECT event_id FROM ucdp_candidate")] == [1]
        c.close()
    finally:
        os.unlink(p)


def test_monthly_counts_never_overlaps_the_revised_corpus():
    # A month built half from revised and half from candidate rows is a
    # count from neither dataset.
    p = _db()
    try:
        uc.ingest(p, blobs=[("26_0_1", _csv([
            _ev(1, "2025-12-30"), _ev(2, "2026-01-05"), _ev(3, "2026-01-06"),
            _ev(4, "2026-02-01")]))])
        c = sqlite3.connect(p)
        months = [r[2] for r in uc.monthly_counts(c, after="2025-12")]
        assert months == ["2026-01", "2026-02"]
        assert "2025-12" not in months
        # Without the cut, the December straggler is visible — proving the
        # filter is what excludes it, not the data.
        assert "2025-12" in [r[2] for r in uc.monthly_counts(c)]
        c.close()
    finally:
        os.unlink(p)


def test_counts_match_the_shape_history_returns():
    # forecast_board concatenates the two, so a column order difference
    # would silently transpose events and deaths.
    p = _db()
    try:
        uc.ingest(p, blobs=[("26_0_1", _csv([
            _ev(1, "2026-01-05", deaths=2), _ev(2, "2026-01-09", deaths=4)]))])
        c = sqlite3.connect(p)
        row = uc.monthly_counts(c)[0]
        assert row == ("Sudan", "state-based conflict", "2026-01", 2, 6)
        c.close()
    finally:
        os.unlink(p)


def test_unusable_rows_are_dropped_not_defaulted():
    p = _db()
    try:
        bad = _ev(9, "2026-01-05")
        bad["country"] = ""
        out = uc.ingest(p, blobs=[("26_0_1", _csv([_ev(1, "2026-01-05"), bad]))])
        assert out["events"] == 1
    finally:
        os.unlink(p)


def test_no_releases_at_all_reports_failure_rather_than_emptying_the_table():
    p = _db()
    try:
        uc.ingest(p, blobs=[("26_0_1", _csv([_ev(1, "2026-01-05")]))])
        out = uc.ingest(p, blobs=[("26_0_2", None)])
        assert not out["ok"]
        c = sqlite3.connect(p)
        # The good data is still there: a network outage must not blank
        # the tail and silently take the board back nine months.
        assert c.execute("SELECT COUNT(*) FROM ucdp_candidate").fetchone()[0] == 1
        c.close()
    finally:
        os.unlink(p)


def test_stats_reports_span_and_month_count():
    p = _db()
    try:
        uc.ingest(p, blobs=[("26_0_1", _csv([
            _ev(1, "2026-01-05"), _ev(2, "2026-03-09")]))])
        c = sqlite3.connect(p)
        s = uc.stats(c)
        assert s == {"events": 2, "first": "2026-01-05",
                     "last": "2026-03-09", "months": 2}
        c.close()
    finally:
        os.unlink(p)


# ── Calibration against the revised corpus ────────────────────────────

def _with_history(p, hist_rows, cand_blobs):
    """A db holding both corpora, so the overlap can be measured."""
    uc.ingest(p, blobs=cand_blobs)
    c = sqlite3.connect(p)
    import ucdp_history as uh
    uh.ensure_schema(c)
    c.executemany(
        "INSERT OR REPLACE INTO ucdp_history"
        " (event_id, date, year, country, adm1, lat, lon, violence, deaths)"
        " VALUES (?,?,?,?,?,?,?,?,?)", hist_rows)
    c.commit()
    return c


def test_covered_months_come_from_release_tags_not_from_stragglers():
    # Every release carries a tail of late-coded events for earlier
    # months. Those months look present while being almost entirely
    # absent, and calibrating on them compares a full revised month
    # against a handful of stragglers.
    p = _db()
    try:
        uc.ingest(p, blobs=[("26_0_3", _csv([
            _ev(1, "2026-03-05"), _ev(2, "2026-03-06"),
            _ev(3, "2024-02-28")]))])           # one straggler
        c = sqlite3.connect(p)
        assert uc.covered_months(c) == ["2026-03"]
        assert "2024-02" in [r[2] for r in uc.monthly_counts(c, calibrate=False)]
        c.close()
    finally:
        os.unlink(p)


def test_calibration_is_the_revised_over_candidate_ratio():
    p = _db()
    try:
        # Eight published months; revision removes a third of them.
        hist, cand = [], []
        for m in range(1, 9):
            mm = f"2026-{m:02d}"
            for i in range(20):
                hist.append((m * 1000 + i, f"{mm}-05", 2026, "Sudan", None,
                             None, None, "one-sided violence against civilians", 1))
            cand.append((f"26_0_{m}", _csv([
                _ev(m * 100000 + j, f"{mm}-05",
                    v="3") for j in range(30)])))
        c = _with_history(p, hist, cand)
        f = uc.calibration(c)
        assert abs(f["one-sided violence against civilians"] - 20 / 30) < 1e-9
        c.close()
    finally:
        os.unlink(p)


def test_no_correction_is_applied_on_too_little_overlap():
    # A factor fitted to two months is a worse object than no factor.
    p = _db()
    try:
        hist = [(i, "2026-01-05", 2026, "Sudan", None, None, None,
                 "state-based conflict", 1) for i in range(20)]
        c = _with_history(p, hist, [("26_0_1", _csv(
            [_ev(900 + j, "2026-01-05") for j in range(30)]))])
        assert uc.calibration(c) == {}
        c.close()
    finally:
        os.unlink(p)


def test_a_real_month_is_never_rounded_down_to_nothing():
    # Zero would be read by the model as a cessation, which is a stronger
    # claim than a bias correction is entitled to make.
    p = _db()
    try:
        hist, cand = [], []
        for m in range(1, 9):
            mm = f"2026-{m:02d}"
            for i in range(1):
                hist.append((m * 1000 + i, f"{mm}-05", 2026, "Sudan", None,
                             None, None, "one-sided violence against civilians", 1))
            cand.append((f"26_0_{m}", _csv(
                [_ev(m * 100000 + j, f"{mm}-05", v="3") for j in range(50)])))
        # Chad appears once, in a month where the factor is tiny.
        cand.append(("26_0_8", _csv(
            [_ev(7777, "2026-08-05", country="Chad", v="3")] +
            [_ev(800000 + j, "2026-08-05", v="3") for j in range(50)])))
        c = _with_history(p, hist, cand)
        assert uc.calibration(c)["one-sided violence against civilians"] < 0.1
        chad = [r for r in uc.monthly_counts(c) if r[0] == "Chad"]
        assert chad and chad[0][3] == 1, chad
        c.close()
    finally:
        os.unlink(p)


def test_calibration_off_returns_the_raw_counts():
    p = _db()
    try:
        hist, cand = [], []
        for m in range(1, 9):
            mm = f"2026-{m:02d}"
            hist += [(m * 1000 + i, f"{mm}-05", 2026, "Sudan", None, None,
                      None, "one-sided violence against civilians", 1)
                     for i in range(10)]
            cand.append((f"26_0_{m}", _csv(
                [_ev(m * 100000 + j, f"{mm}-05", v="3") for j in range(30)])))
        c = _with_history(p, hist, cand)
        raw = {(r[0], r[2]): r[3] for r in uc.monthly_counts(c, calibrate=False)}
        cal = {(r[0], r[2]): r[3] for r in uc.monthly_counts(c, calibrate=True)}
        assert set(raw) == set(cal)
        assert all(v == 30 for v in raw.values())
        assert all(v == 10 for v in cal.values())
        c.close()
    finally:
        os.unlink(p)
