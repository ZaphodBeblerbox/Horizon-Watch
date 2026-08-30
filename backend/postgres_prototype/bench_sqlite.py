"""
bench_sqlite.py — real, read-only benchmark of SQLite performance for the
Postgres+PostGIS migration assessment (feature/overnight-hardening branch).

Does NOT modify akili.db in any way. Opens the real DB file explicitly in
SQLite URI read-only mode (mode=ro) so this can never write, regardless of
what code paths it touches.

Benchmarks two real, existing code paths (not synthetic queries):

  (a) The Alert region+period+quality scoping query that
      briefing_prep.prepare_intelligence_picture() runs for every Mission
      Task — reuses the REAL `_sql_region_filter()` helper from
      briefing_prep.py, unmodified, to build the same bbox filter the app
      itself builds.

  (b) entity_linker's real proximity-matching against ports/cables/airports
      — reuses the REAL EntityLinker.load_cache() and
      EntityLinker._proximity_links() methods, unmodified, run against a
      sample of real alert lat/lon pairs pulled from the live DB.

Run: python3 bench_sqlite.py
"""
import os
import sys
import time
import random
import statistics
import datetime
from datetime import timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # backend/

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "akili.db")
RO_URL = f"sqlite:///file:{DB_PATH}?mode=ro&uri=true"

os.environ.setdefault("DATA_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data"))


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


def bench_region_query(n_runs=9):
    """(a) Reuses the REAL briefing_prep._sql_region_filter() against the REAL
    Alert model, applying the exact same filter chain briefing_prep.py uses
    for a Mission-Task-scoped call: status=active, created_at>=cutoff_24h,
    quality filter (alert_type not unknown/blank, title not blank), region
    bbox, and an explicit period window — reproducing the real query
    verbatim rather than writing a new synthetic one."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from database import Alert
    import briefing_prep as bp
    from scoring import REGION_BBOXES

    engine = create_engine(RO_URL, connect_args={"check_same_thread": False})
    Session = sessionmaker(bind=engine)

    region = ["Red Sea / Arabian Peninsula"]
    now = datetime.datetime.utcnow()
    period_start = now - timedelta(days=30)
    period_end = now
    cutoff_24h = now - timedelta(hours=24)

    row_count_last = None
    times = []
    for _ in range(n_runs):
        db = Session()
        try:
            t0 = time.perf_counter()
            q = db.query(Alert).filter(
                Alert.status == "active",
                Alert.created_at >= cutoff_24h,
                Alert.alert_type.isnot(None),
                Alert.alert_type != "unknown",
                Alert.title.isnot(None),
                Alert.title != "",
            )
            clause = bp._sql_region_filter(Alert.lat, Alert.lon, region)
            if clause is not None:
                q = q.filter(clause)
            q = q.filter(Alert.created_at >= period_start, Alert.created_at <= period_end)
            rows = q.order_by(Alert.created_at.desc()).limit(1000).all()
            t1 = time.perf_counter()
            row_count_last = len(rows)
            times.append(t1 - t0)
            print(f"    run {len(times)}: {(t1 - t0)*1000:.2f} ms")
        finally:
            db.close()
    print(f"  (region bbox = {REGION_BBOXES[region[0]]}, period = 30d, rows returned = {row_count_last})")
    return _stats("QUERY A — Alert region+period+quality scoped query (real briefing_prep logic)", times)


def bench_proximity(n_points=200, n_runs=5):
    """(b) Reuses the REAL EntityLinker.load_cache() (loads ports/cables/
    airports/zones exactly as the live app does) and the REAL
    EntityLinker._proximity_links() per-event scan (haversine loop over
    ports+airports, shapely nearest-point-on-route loop over cables) — run
    against a sample of real alert lat/lon pairs pulled from the live DB."""
    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import sessionmaker
    from entity_linker import EntityLinker

    engine = create_engine(RO_URL, connect_args={"check_same_thread": False})
    Session = sessionmaker(bind=engine)
    db = Session()
    try:
        rows = db.execute(text(
            "SELECT lat, lon FROM alerts WHERE lat IS NOT NULL AND lon IS NOT NULL LIMIT 5000"
        )).fetchall()
    finally:
        db.close()

    if not rows:
        print("  no alerts with real lat/lon found — cannot benchmark proximity matching")
        return None

    random.seed(42)
    points = [random.choice(rows) for _ in range(n_points)]

    linker = EntityLinker()
    db2 = Session()
    try:
        t_load0 = time.perf_counter()
        linker.load_cache(db2)
        t_load1 = time.perf_counter()
    finally:
        db2.close()
    print(f"  cache load (cables={len(linker._cables)}, ports={len(linker._ports)}, "
          f"airports={len(linker._airports)}, zones={len(linker._watch_zones)}+{len(linker._strategic_zones)}): "
          f"{(t_load1 - t_load0)*1000:.1f} ms (one-time; not counted in per-batch timings below)")

    times = []
    total_links = 0
    for _ in range(n_runs):
        t0 = time.perf_counter()
        batch_links = 0
        for (lat, lon) in points:
            links = linker._proximity_links("alert", "bench", lat, lon)
            batch_links += len(links)
        t1 = time.perf_counter()
        times.append(t1 - t0)
        total_links = batch_links
    print(f"  ({n_points} points/batch, sample links found in last batch = {total_links})")
    stats = _stats(f"QUERY B — entity_linker proximity match, {n_points} points/batch (real code)", times)
    stats["per_point_median_ms"] = round(statistics.median(times) / n_points * 1000, 4)
    print(f"  per-point median: {stats['per_point_median_ms']:.4f} ms")
    return stats


def check_contention():
    import subprocess
    out = subprocess.run(["ps", "aux"], capture_output=True, text=True).stdout
    hits = [l for l in out.splitlines() if "uvicorn" in l or ("python" in l and "8001" in l)]
    print("Contention check (other real processes that may add noise):")
    for h in hits:
        print(" ", h[:160])
    if not hits:
        print("  none found")


if __name__ == "__main__":
    print("=" * 70)
    print("SQLite benchmark — akili.db (read-only mode, no writes possible)")
    print(f"DB path: {DB_PATH}")
    print(f"DB size: {os.path.getsize(DB_PATH) / 1e9:.2f} GB")
    print("=" * 70)
    check_contention()
    results = {}
    results["query_a"] = bench_region_query()
    results["query_b"] = bench_proximity()
    print("\n" + "=" * 70)
    print("SUMMARY (JSON)")
    print("=" * 70)
    import json
    print(json.dumps(results, indent=2))
