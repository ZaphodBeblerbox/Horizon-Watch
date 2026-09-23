"""
ucdp_candidate.py — the nine months the training corpus does not have.

THE PROBLEM THIS SOLVES. `ucdp_history` is the full GED: revised, stable
and three decades deep, which is what makes the model trainable. It also
STOPS at the last annual release — 2025-12-31 while the console was
running in September 2026. A board built on it alone answers "what
happens in the next three months" with a distribution about January to
March 2026 and labels it as the coming quarter. That is not a stale
number, it is a mislabelled window, which is worse: a stale number
invites suspicion and a mislabelled one does not.

WHY IT IS A SEPARATE TABLE, AND NEVER TRAINED ON. UCDP's candidate
release is preliminary. Events are added and re-coded in later releases,
always in the same direction — upward — so the most recent month is
always the lightest. Training on it would teach the model that recent
months are quiet, which is exactly backwards and would show up as
spurious "de-escalation" at the right-hand edge of every series. So:

    train on the revised corpus, predict from the current one.

The candidate rows extend the tail of the panel at PREDICTION time only.
`train()` never sees them.

HOW THE RELEASES ARE SHAPED, which is not what the naming suggests. Each
`GEDEvent_vYY_0_M.csv` holds ONE month — not the year to date. Measured
across v26_0_1 to v26_0_8: each file carries ~1,700-1,800 events for its
own month plus a short tail of late-coded stragglers for earlier ones,
and 90 event ids appeared in more than one file, re-coded. So the year is
assembled by fetching every release and deduplicating on event id, last
release winning.

THE BIAS, MEASURED — AND IT IS NOT WHAT IT LOOKS LIKE. The obvious worry
is that a preliminary release is INCOMPLETE, and within one release
series it is: a month gains 1-2% in later files as stragglers are coded.
But the candidate and revised datasets overlap for twelve months, and
over that overlap the candidate release runs HEAVY, not light. Revision
does not mainly add events. It consolidates and removes them:

    state-based conflict                    cand/rev  0.98
    non-state conflict                      cand/rev  1.09
    one-sided violence against civilians    cand/rev  1.42

measured over 2025-01 to 2025-12, 25,770 revised against 27,192 candidate
events. The third row is the dangerous one. One-sided violence against
civilians is the hardest category to code from news, and revision drops
roughly a third of it — in every single overlapping month, never once the
other way. Splice that tail on raw and every locale acquires a large
apparent escalation in exactly the category the board reports, with a
confident probability printed next to it.

So the tail is CALIBRATED, per violence type, against the overlap the two
datasets actually share, and the factors are measured at runtime rather
than frozen here so they track the corpus. This is a correction applied
to real counts, which is a thing to be suspicious of; it is defensible
only because it is measured rather than assumed, refuses to apply itself
on too little overlap, and is reported to the reader instead of being
folded in silently.
"""
from __future__ import annotations
import csv
import io
import sqlite3
import urllib.request
from datetime import datetime, timezone

import ucdp_history as uh

BASE = "https://ucdp.uu.se/downloads/candidateged/GEDEvent_v{yy}_0_{m}.csv"
_UA = "HorizonWatch/2.0 (+https://github.com/ZaphodBeblerbox/Horizon-Watch)"

SCHEMA = """
CREATE TABLE IF NOT EXISTS ucdp_candidate (
    event_id INTEGER PRIMARY KEY,
    date     TEXT NOT NULL,
    year     INTEGER NOT NULL,
    country  TEXT NOT NULL,
    adm1     TEXT,
    lat      REAL,
    lon      REAL,
    violence TEXT NOT NULL,
    deaths   INTEGER NOT NULL DEFAULT 0,
    release  TEXT NOT NULL        -- which file it last came from
);
CREATE INDEX IF NOT EXISTS ix_ucdpc_locale ON ucdp_candidate(country, violence, date);
CREATE INDEX IF NOT EXISTS ix_ucdpc_date   ON ucdp_candidate(date);
"""


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


def release_urls(today=None) -> list:
    """Every candidate release that could plausibly exist, newest last.

    Reaches back into the previous year because a January console still
    needs the prior December, and the annual GED that would supersede it
    is published months later.
    """
    now = today or datetime.now(timezone.utc)
    out = []
    for yy, upto in ((now.year - 1, 12), (now.year, now.month)):
        for m in range(1, upto + 1):
            out.append((f"{yy % 100:02d}_0_{m}",
                        BASE.format(yy=f"{yy % 100:02d}", m=m)))
    return out


def _fetch(url: str, timeout: int) -> bytes | None:
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except Exception:                                        # noqa: BLE001
        # A missing release is the normal case, not an error: the loop
        # walks past months that have not been published.
        return None


def ingest(db_path: str, *, timeout: int = 180, blobs=None) -> dict:
    """Fetch every available release and merge them on event id.

    Later releases win, because a re-coded event is a correction.
    """
    conn = sqlite3.connect(db_path)
    try:
        ensure_schema(conn)
        pairs = blobs if blobs is not None else [
            (tag, _fetch(url, timeout)) for tag, url in release_urls()]
        merged, releases = {}, []
        for tag, blob in pairs:
            if not blob:
                continue
            releases.append(tag)
            text = blob.decode("utf-8", errors="replace")
            for raw in csv.DictReader(io.StringIO(text)):
                rec = uh.parse(raw)
                if rec:
                    rec["release"] = tag
                    merged[rec["event_id"]] = rec
        if not merged:
            return {"ok": False, "error": "no candidate releases available",
                    "events": 0}

        rows = list(merged.values())
        # Replaced wholesale rather than appended. A candidate row can be
        # WITHDRAWN between releases, and an append-only table would keep
        # a retracted event forever.
        conn.execute("DELETE FROM ucdp_candidate")
        conn.executemany(
            "INSERT OR REPLACE INTO ucdp_candidate"
            " (event_id, date, year, country, adm1, lat, lon, violence, deaths, release)"
            " VALUES (:event_id,:date,:year,:country,:adm1,:lat,:lon,:violence,:deaths,:release)",
            rows)
        conn.commit()
        span = conn.execute(
            "SELECT MIN(date), MAX(date) FROM ucdp_candidate").fetchone()
        return {"ok": True, "events": len(rows), "releases": releases,
                "first": span[0], "last": span[1]}
    finally:
        conn.close()


#: Below this many overlapping months the ratio is noise and no
#: correction is applied — a factor fitted to two months would be a
#: worse object than no factor at all.
MIN_OVERLAP_MONTHS = 6


def covered_months(conn: sqlite3.Connection) -> list:
    """The months a candidate release actually PUBLISHED.

    Not the months present in the table. Every release carries a short
    tail of late-coded stragglers for earlier months — one event for
    2024-02, six for 2024-12 — and those months look "present" while
    being almost entirely absent. Calibrating on them compares a full
    revised month against a handful of stragglers and returns a factor
    that is nonsense: it moved state-based conflict from 1.02 to 1.09 and
    one-sided violence from 0.71 to 0.78, in the wrong direction, from
    three junk cells out of thirty-nine.

    The release tag says which month a file is for, so that is what
    defines coverage.
    """
    out = []
    try:
        tags = [r[0] for r in conn.execute(
            "SELECT DISTINCT release FROM ucdp_candidate")]
    except sqlite3.Error:
        return []
    for t in tags:
        try:
            yy, _, mm = str(t).split("_")
            out.append(f"20{int(yy):02d}-{int(mm):02d}")
        except (ValueError, TypeError):
            continue
    return sorted(set(out))


def calibration(conn: sqlite3.Connection) -> dict:
    """Per-violence factors bringing candidate counts onto revised scale.

    `revised_total / candidate_total` over the published months the two
    datasets both cover. Returns {} when the overlap is too thin to fit,
    and the caller then uses the tail uncorrected and says so.
    """
    months = covered_months(conn)
    if not months:
        return {}
    ph = ",".join("?" * len(months))
    try:
        rows = conn.execute(
            f"SELECT h.v, SUM(h.n), SUM(c.n), COUNT(*) FROM"
            f" (SELECT substr(date,1,7) m, violence v, COUNT(*) n"
            f"    FROM ucdp_history WHERE substr(date,1,7) IN ({ph})"
            f"    GROUP BY m, v) h"
            f" JOIN"
            f" (SELECT substr(date,1,7) m, violence v, COUNT(*) n"
            f"    FROM ucdp_candidate WHERE substr(date,1,7) IN ({ph})"
            f"    GROUP BY m, v) c"
            f" ON h.m = c.m AND h.v = c.v"
            f" GROUP BY h.v", months + months).fetchall()
    except sqlite3.Error:
        return {}
    out = {}
    for violence, rev, cand, months in rows:
        if months < MIN_OVERLAP_MONTHS or not cand or not rev:
            continue
        out[violence] = rev / cand
    return out


def monthly_counts(conn: sqlite3.Connection, *, after: str | None = None,
                   calibrate: bool = True) -> list:
    """Same five-column shape as ucdp_history.monthly_counts.

    `after` is the revised corpus's last month. Only months strictly
    beyond it are returned, so the two sources never both contribute to
    one month — a half-revised, half-candidate month would be a count
    from neither dataset.
    """
    where, params = [], []
    if after:
        where.append("substr(date, 1, 7) > ?")
        params.append(after)
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    rows = conn.execute(
        f"SELECT country, violence, substr(date, 1, 7) AS month,"
        f" COUNT(*) AS events, SUM(deaths) AS deaths"
        f" FROM ucdp_candidate{clause}"
        f" GROUP BY country, violence, month ORDER BY country, violence, month",
        params).fetchall()
    if not calibrate:
        return rows
    factors = calibration(conn)
    if not factors:
        return rows
    out = []
    for country, violence, month, events, deaths in rows:
        f = factors.get(violence)
        if f is None:
            out.append((country, violence, month, events, deaths))
            continue
        # A locale that had ANY events keeps at least one. Rounding a
        # real month of violence down to zero would be read by the model
        # as a cessation, which is a stronger claim than the correction
        # is entitled to make.
        out.append((country, violence, month,
                    max(1, round(events * f)), int(round((deaths or 0) * f))))
    return out


def stats(conn: sqlite3.Connection) -> dict:
    try:
        n, first, last = conn.execute(
            "SELECT COUNT(*), MIN(date), MAX(date) FROM ucdp_candidate").fetchone()
    except sqlite3.Error:
        return {"events": 0, "first": None, "last": None, "months": 0}
    months = conn.execute(
        "SELECT COUNT(DISTINCT substr(date,1,7)) FROM ucdp_candidate").fetchone()[0]
    return {"events": n or 0, "first": first, "last": last, "months": months or 0}
