"""
bench_postgres.py — real benchmark of the same two queries in bench_sqlite.py,
run against a local Postgres 17 + PostGIS 3.6 prototype instance (scratch
data dir, port 5433, unix socket /tmp/pg17_nagini_sock — NOT the system's
Homebrew postgresql@15 service on 5432).

Data: migrated by migrate_minimal.py — ONLY the columns/rows needed for
these two queries (alerts subset, ports, airports, cables). See that file's
docstring for what was deliberately left out (raw_json, history tables,
everything else in the real 6.5GB akili.db).

QUERY A — Alert region+period+quality scoped query
  Same filter chain as briefing_prep._sql_region_filter() + the quality/
  period filters bench_sqlite.py's bench_region_query() applies, expressed
  as raw SQL (identical predicate logic, not a different query). Run once
  with zero indexes (apples-to-apples with SQLite's zero-index baseline),
  then again after adding a btree index, so both "no index" and "realistic
  index" numbers are reported.

QUERY B — entity_linker proximity match (the identified bottleneck)
  Same real thresholds entity_linker.py uses (_PORT_KM=30, _AIRPORT_KM=20,
  _CABLE_KM=50) via ST_DWithin on geography columns. Run once with zero
  spatial indexes (apples-to-apples with SQLite's brute-force haversine
  loop), then again after adding GIST indexes on ports/airports/cables.

Run: python3 bench_postgres.py
"""
import random
import statistics
import time

import psycopg2

PG_DSN = "host=/tmp/pg17_nagini_sock port=5433 dbname=nagini_bench"

# Same thresholds entity_linker.py uses (in km, converted to metres for ST_DWithin)
_PORT_KM = 30.0
_AIRPORT_KM = 20.0
_CABLE_KM = 50.0

# Same bbox + 400km buffer formula as briefing_prep._sql_region_filter(), for
# region = "Red Sea / Arabian Peninsula" (scoring.REGION_BBOXES value copied
# verbatim: s=12.0, n=30.0, w=32.0, e=60.0)
import math
_S, _N, _W, _E = 12.0, 30.0, 32.0, 60.0
_LAT_BUF = 400.0 / 111.0
_EXTREME_LAT = min(max(abs(_S), abs(_N)) + _LAT_BUF, 89.0)
_COS_LAT = max(math.cos(math.radians(_EXTREME_LAT)), 0.05)
_LON_BUF = 400.0 / (111.0 * _COS_LAT)
LAT_MIN, LAT_MAX = _S - _LAT_BUF, _N + _LAT_BUF
LON_MIN, LON_MAX = _W - _LON_BUF, _E + _LON_BUF


def _stats(label, times):
    times_ms = [t * 1000 for t in times]
    print(f"\n{label}")
    print(f"  runs: {len(times_ms)}")
    print(f"  min:    {min(times_ms):8.2f} ms")
    print(f"  median: {statistics.median(times_ms):8.2f} ms")
    print(f"  max:    {max(times_ms):8.2f} ms")
    return {
        "runs": len(times_ms),
        "min_ms": round(min(times_ms), 2),
        "median_ms": round(statistics.median(times_ms), 2),
        "max_ms": round(max(times_ms), 2),
    }


def bench_region_query(conn, n_runs=9, label_suffix=""):
    sql = """
        SELECT id, status, alert_type, title, lat, lon, created_at
        FROM alerts
        WHERE status = 'active'
          AND created_at >= (NOW() - INTERVAL '24 hours')
          AND alert_type IS NOT NULL
          AND alert_type != 'unknown'
          AND title IS NOT NULL
          AND title != ''
          AND lat >= %s AND lat <= %s
          AND lon >= %s AND lon <= %s
          AND created_at >= (NOW() - INTERVAL '30 days')
          AND created_at <= NOW()
        ORDER BY created_at DESC
        LIMIT 1000
    """
    times = []
    row_count_last = None
    for _ in range(n_runs):
        cur = conn.cursor()
        t0 = time.perf_counter()
        cur.execute(sql, (LAT_MIN, LAT_MAX, LON_MIN, LON_MAX))
        rows = cur.fetchall()
        t1 = time.perf_counter()
        row_count_last = len(rows)
        times.append(t1 - t0)
        print(f"    run {len(times)}: {(t1 - t0)*1000:.2f} ms")
        cur.close()
    print(f"  (bbox lat[{LAT_MIN:.2f},{LAT_MAX:.2f}] lon[{LON_MIN:.2f},{LON_MAX:.2f}], rows returned = {row_count_last})")
    return _stats(f"QUERY A{label_suffix} — Alert region+period+quality scoped query (Postgres, raw SQL, same predicates)", times)


def bench_proximity(conn, points, n_runs=5, label_suffix=""):
    sql_ports = "SELECT id FROM ports WHERE ST_DWithin(geog, ST_MakePoint(%s, %s)::geography, %s)"
    sql_airports = "SELECT id FROM airports WHERE ST_DWithin(geog, ST_MakePoint(%s, %s)::geography, %s)"
    sql_cables = "SELECT id FROM cables WHERE ST_DWithin(geog, ST_MakePoint(%s, %s)::geography, %s)"

    times = []
    total_links = 0
    for _ in range(n_runs):
        cur = conn.cursor()
        t0 = time.perf_counter()
        batch_links = 0
        for (lat, lon) in points:
            cur.execute(sql_ports, (lon, lat, _PORT_KM * 1000))
            batch_links += len(cur.fetchall())
            cur.execute(sql_airports, (lon, lat, _AIRPORT_KM * 1000))
            batch_links += len(cur.fetchall())
            cur.execute(sql_cables, (lon, lat, _CABLE_KM * 1000))
            batch_links += len(cur.fetchall())
        t1 = time.perf_counter()
        cur.close()
        times.append(t1 - t0)
        total_links = batch_links
    n_points = len(points)
    print(f"  ({n_points} points/batch, sample links found in last batch = {total_links})")
    stats = _stats(f"QUERY B{label_suffix} — entity_linker proximity match via ST_DWithin, {n_points} points/batch", times)
    stats["per_point_median_ms"] = round(statistics.median(times) / n_points * 1000, 4)
    print(f"  per-point median: {stats['per_point_median_ms']:.4f} ms")
    return stats


def get_sample_points(conn, n_points=200):
    cur = conn.cursor()
    cur.execute("SELECT lat, lon FROM alerts WHERE lat IS NOT NULL AND lon IS NOT NULL ORDER BY id LIMIT 5000")
    rows = cur.fetchall()
    cur.close()
    random.seed(42)
    return [random.choice(rows) for _ in range(n_points)]


def check_index_usage(conn, label):
    cur = conn.cursor()
    cur.execute("""
        SELECT indexname, tablename FROM pg_indexes
        WHERE tablename IN ('alerts', 'ports', 'airports', 'cables')
        ORDER BY tablename, indexname
    """)
    rows = cur.fetchall()
    cur.close()
    print(f"\n[{label}] indexes present:")
    for idx, tbl in rows:
        print(f"  {tbl}.{idx}")
    if not rows:
        print("  (none)")


if __name__ == "__main__":
    print("=" * 70)
    print("Postgres 17 + PostGIS 3.6 benchmark — nagini_bench (prototype, port 5433)")
    print("=" * 70)

    conn = psycopg2.connect(PG_DSN)
    conn.autocommit = True

    results = {}

    # ---- Phase 1: NO INDEXES (apples-to-apples with SQLite's zero-index baseline) ----
    check_index_usage(conn, "BEFORE any indexes created")
    points = get_sample_points(conn)
    print(f"\nSampled {len(points)} real alert lat/lon points for proximity benchmark.")

    results["query_a_no_index"] = bench_region_query(conn, label_suffix=" [no index]")
    results["query_b_no_index"] = bench_proximity(conn, points, label_suffix=" [no spatial index]")

    # ---- Phase 2: add realistic indexes, re-run ----
    print("\n" + "=" * 70)
    print("Creating indexes (btree for query A, GIST/geography for query B)...")
    print("=" * 70)
    cur = conn.cursor()
    cur.execute("CREATE INDEX idx_alerts_status_created ON alerts (status, created_at DESC)")
    cur.execute("CREATE INDEX idx_alerts_lat_lon ON alerts (lat, lon)")
    cur.execute("CREATE INDEX idx_ports_geog ON ports USING GIST (geog)")
    cur.execute("CREATE INDEX idx_airports_geog ON airports USING GIST (geog)")
    cur.execute("CREATE INDEX idx_cables_geog ON cables USING GIST (geog)")
    cur.execute("ANALYZE alerts; ANALYZE ports; ANALYZE airports; ANALYZE cables;")
    cur.close()
    check_index_usage(conn, "AFTER indexes created")

    results["query_a_indexed"] = bench_region_query(conn, label_suffix=" [btree indexed]")
    results["query_b_indexed"] = bench_proximity(conn, points, label_suffix=" [GIST indexed]")

    conn.close()

    print("\n" + "=" * 70)
    print("SUMMARY (JSON)")
    print("=" * 70)
    import json
    print(json.dumps(results, indent=2))


# ---------------------------------------------------------------------------
# RESULTS — last real run against the live akili.db (170,297 alerts /
# 11,736 ports / 49,156 airports / 694 cables migrated via migrate_minimal.py)
#
#                                   median/event    median/batch(200)
#   Query A, SQLite  (zero index)       54.57 ms          n/a
#   Query A, Postgres (zero index)       7.11 ms          n/a
#   Query A, Postgres (btree indexed)    0.22 ms          n/a   <- 248x vs SQLite
#
#   Query B, SQLite   (brute-force loop) 37.45 ms       7489 ms
#   Query B, Postgres (zero spatial idx) 59.60 ms      11921 ms  <- slower than
#                                                                    SQLite: 3
#                                                                    round-trip
#                                                                    queries/point
#                                                                    with no index
#   Query B, Postgres (GIST indexed)      0.77 ms        154 ms  <- 49x vs SQLite
#
# Recommendation: Query B (entity-linker proximity match against
# ports/airports/cables) is the strong, measured case for PostGIS — a
# GIST-indexed geography index turns an O(n) per-event scan into a flat
# ~0.77ms lookup regardless of table growth. Query A's 248x win comes from
# ordinary indexing (status+created_at, lat+lon) that SQLite could also
# apply without a Postgres migration. Postgres with NO index is not
# automatically faster (see Query B's non-indexed row) — the index is what
# does the work either way. See this file's and migrate_minimal.py's
# docstrings for full methodology; nothing in this directory is imported
# by backend/main.py (verified: empty git diff on main.py, no psycopg/
# postgres references in it, and `import main` still succeeds standalone).
# ---------------------------------------------------------------------------
