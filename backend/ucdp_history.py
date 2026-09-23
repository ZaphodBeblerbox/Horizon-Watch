"""
ucdp_history.py — the training corpus the forecaster never had.

WHY THIS EXISTS. forecast.py was measured against the data this system
already held and found ZERO skill beyond each locale's own base rate —
not because the model was wrong but because it was fitted to six months.
`ucdp_ingest.py` pulls UCDP's CANDIDATE GED, which is the rolling recent
release: current by design, useless for training by design.

UCDP also publishes the full Georeferenced Event Dataset, free, covering
1989 to the present — the same columns, three decades deep, 39MB
compressed. That is the difference between a forecaster that can be
trained and one that can only restate history.

KEPT SEPARATE FROM `ucdp_events` ON PURPOSE. That table feeds map pins
and carries `pinnable`; it is read on a request path. This is a training
corpus: written rarely, read in bulk, and holding only the columns a
model uses. Mixing them would put 350,000 historical rows behind every
map query, on a database that is already 37GB on a network volume.

WHAT IT DELIBERATELY DOES NOT STORE. No actor names, no source URLs, no
conflict names, no geometry precision. A feature the model cannot use is
a column that costs disk and I/O on every scan.
"""
from __future__ import annotations
import csv
import io
import re
import sqlite3
import urllib.request
import zipfile
from datetime import datetime, timezone

INDEX_URL = "https://ucdp.uu.se/downloads/index.html"
_UA = "HorizonWatch/2.0 (+https://github.com/ZaphodBeblerbox/Horizon-Watch)"

#: UCDP type_of_violence, same coding as the live ingest.
VIOLENCE_TYPE = {
    "1": "state-based conflict",
    "2": "non-state conflict",
    "3": "one-sided violence against civilians",
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS ucdp_history (
    event_id     INTEGER PRIMARY KEY,   -- UCDP's own id: re-ingest updates
    date         TEXT NOT NULL,         -- date_start, ISO yyyy-mm-dd
    year         INTEGER NOT NULL,
    country      TEXT NOT NULL,
    adm1         TEXT,
    lat          REAL,
    lon          REAL,
    violence     TEXT NOT NULL,
    deaths       INTEGER NOT NULL DEFAULT 0
);
-- The two access patterns a model actually has: "this locale over time"
-- and "everything in a window". Nothing else is indexed, because every
-- index is paid for on every write of a 350,000-row import.
CREATE INDEX IF NOT EXISTS ix_ucdph_locale ON ucdp_history(country, violence, date);
CREATE INDEX IF NOT EXISTS ix_ucdph_date   ON ucdp_history(date);
"""


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


def latest_ged_url(timeout: int = 60) -> str | None:
    """The newest full-GED CSV archive published on the downloads page.

    Discovered rather than hardcoded: UCDP bumps the version yearly
    (ged241, ged251, ged261...) and a pinned URL silently rots into a
    404 that looks like "the network is down".
    """
    req = urllib.request.Request(INDEX_URL, headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        html = r.read().decode("utf-8", "replace")
    urls = re.findall(r'https://ucdp\.uu\.se/downloads/ged/(ged\d+)-csv\.zip', html)
    if not urls:
        return None
    # "ged261" sorts correctly as a number, not as a string: ged99 must
    # not beat ged261.
    best = max(urls, key=lambda s: int(s[3:]))
    return f"https://ucdp.uu.se/downloads/ged/{best}-csv.zip"


def _rows_from_zip(blob: bytes):
    """Yield CSV dict rows from the single CSV inside the archive."""
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        names = [n for n in z.namelist() if n.lower().endswith(".csv")]
        if not names:
            raise ValueError("no CSV inside the GED archive")
        with z.open(names[0]) as fh:
            text = io.TextIOWrapper(fh, encoding="utf-8", errors="replace")
            for row in csv.DictReader(text):
                yield row


def parse(row: dict) -> dict | None:
    """One GED row in the compact training shape, or None if unusable.

    Dropped rather than defaulted: a row with no date or no country
    cannot contribute to a per-locale time series, and inventing either
    would put a fabricated event into the training set.
    """
    date = (row.get("date_start") or "").strip()[:10]
    if len(date) != 10:
        return None
    country = (row.get("country") or "").strip()
    if not country:
        return None
    vtype = VIOLENCE_TYPE.get(str(row.get("type_of_violence") or "").strip())
    if not vtype:
        return None
    try:
        eid = int(float(row.get("id") or row.get("relid") or 0))
    except (TypeError, ValueError):
        return None
    if not eid:
        return None

    def _num(*keys):
        for k in keys:
            v = row.get(k)
            if v not in (None, ""):
                try:
                    return float(v)
                except (TypeError, ValueError):
                    continue
        return None

    lat, lon = _num("latitude"), _num("longitude")
    # best_est is UCDP's own preferred figure; the low/high bounds are
    # its uncertainty, not a better number.
    deaths = _num("best", "best_est") or 0.0
    try:
        year = int(date[:4])
    except ValueError:
        return None

    return {
        "event_id": eid, "date": date, "year": year,
        "country": country, "adm1": (row.get("adm_1") or "").strip() or None,
        "lat": lat, "lon": lon, "violence": vtype, "deaths": int(deaths),
    }


def ingest(db_path: str, *, url: str | None = None, timeout: int = 600,
           blob: bytes | None = None) -> dict:
    """Download and store the full GED. Idempotent on UCDP's own event id.

    `blob` exists so the parsing and storage can be tested without
    downloading 39MB; nothing else passes it.
    """
    src = url or latest_ged_url()
    if not src and blob is None:
        return {"available": False, "error": "no GED archive found on the index page"}

    if blob is None:
        req = urllib.request.Request(src, headers={"User-Agent": _UA})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            blob = r.read()

    conn = sqlite3.connect(db_path)
    try:
        ensure_schema(conn)
        seen = skipped = 0
        batch = []
        for raw in _rows_from_zip(blob):
            rec = parse(raw)
            if rec is None:
                skipped += 1
                continue
            batch.append((rec["event_id"], rec["date"], rec["year"], rec["country"],
                          rec["adm1"], rec["lat"], rec["lon"], rec["violence"],
                          rec["deaths"]))
            seen += 1
            if len(batch) >= 5000:
                _write(conn, batch)
                batch = []
        if batch:
            _write(conn, batch)
        conn.commit()
        return {"available": True, "source": src, "ingested": seen,
                "skipped": skipped, "stats": stats(conn),
                "fetched_at": datetime.now(timezone.utc).isoformat()}
    finally:
        conn.close()


def _write(conn: sqlite3.Connection, batch: list) -> None:
    conn.executemany(
        "INSERT INTO ucdp_history"
        " (event_id, date, year, country, adm1, lat, lon, violence, deaths)"
        " VALUES (?,?,?,?,?,?,?,?,?)"
        " ON CONFLICT(event_id) DO UPDATE SET"
        "  date=excluded.date, year=excluded.year, country=excluded.country,"
        "  adm1=excluded.adm1, lat=excluded.lat, lon=excluded.lon,"
        "  violence=excluded.violence, deaths=excluded.deaths", batch)


def stats(conn: sqlite3.Connection) -> dict:
    try:
        n, lo, hi = conn.execute(
            "SELECT COUNT(*), MIN(date), MAX(date) FROM ucdp_history").fetchone()
    except sqlite3.Error:
        return {"events": 0}
    countries = conn.execute(
        "SELECT COUNT(DISTINCT country) FROM ucdp_history").fetchone()[0]
    years = 0
    if lo and hi:
        years = round((int(hi[:4]) - int(lo[:4])) + 1)
    return {"events": n, "first": lo, "last": hi,
            "countries": countries, "years": years}


def monthly_counts(conn: sqlite3.Connection, *, violence: str | None = None,
                   country: str | None = None) -> list:
    """(country, violence, month, events, deaths) — the model's raw input.

    Aggregated in SQL rather than in Python: 350,000 rows is not a lot
    for SQLite and is a great deal for a per-row loop, which is the
    mistake that made the notification endpoint take 20 seconds.
    """
    where, params = [], []
    if violence:
        where.append("violence = ?")
        params.append(violence)
    if country:
        where.append("country = ?")
        params.append(country)
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    return conn.execute(
        f"SELECT country, violence, substr(date, 1, 7) AS month,"
        f" COUNT(*) AS events, SUM(deaths) AS deaths"
        f" FROM ucdp_history{clause}"
        f" GROUP BY country, violence, month ORDER BY country, violence, month",
        params).fetchall()
