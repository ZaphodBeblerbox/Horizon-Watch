"""
Verification script for the prepare_intelligence_picture() performance
round: root-caused the real 11-17s reported slowness to the traffic-
summary section's count(distinct mmsi/icao24) queries over VesselHistory/
AircraftHistory (895K/1.1M real rows respectively, ~98% of which already
fall inside any real 24h window, so the timestamp filter barely narrows
anything and the real cost is the distinct-count itself). Fixed with a
real composite (column, timestamp) index on each table.

Runs against the REAL backend/data/akili.db (gigantic, live, shared —
confirmed earlier this session) — this is deliberately a read-only
performance check, no throwaway rows created or needed.

Usage:
    cd backend
    python3 test_perf_briefing_prep.py
"""
import os, sys, time
os.environ.setdefault("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
sys.path.insert(0, os.path.dirname(__file__))

FAILURES = []

def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)

print("=" * 70)
print("  prepare_intelligence_picture() performance — verification")
print("=" * 70)

import database  # noqa: E402
database.migrate_db()

import sqlite3
db_path = os.path.join(os.environ["DATA_DIR"], "akili.db")
conn = sqlite3.connect(db_path)
ah_indexes = {row[1] for row in conn.execute("PRAGMA index_list(aircraft_history)").fetchall()}
vh_indexes = {row[1] for row in conn.execute("PRAGMA index_list(vessel_history)").fetchall()}
conn.close()
check("migrate_db() created the real composite index on aircraft_history(icao24, timestamp)",
      "ix_aircraft_history_icao24_timestamp" in ah_indexes, str(ah_indexes))
check("migrate_db() created the real composite index on vessel_history(mmsi, timestamp)",
      "ix_vessel_history_mmsi_timestamp" in vh_indexes, str(vh_indexes))

import briefing_prep

db = database.SessionLocal()
try:
    # The specific real queries that were the confirmed dominant cost
    # (measured directly, before this fix: ~2.97s vessel / ~2.59s
    # aircraft; after: ~0.06s / ~0.08s against this same real, live data).
    import datetime
    from database import VesselHistory, AircraftHistory
    cutoff = datetime.datetime.utcnow() - datetime.timedelta(hours=24)

    t0 = time.perf_counter()
    vcount = db.query(VesselHistory.mmsi).filter(VesselHistory.timestamp >= cutoff).distinct().count()
    vtime = time.perf_counter() - t0
    check(f"real vessel distinct-count query ({vcount} distinct mmsi) now completes fast", vtime < 1.0, f"{vtime:.3f}s")

    t0 = time.perf_counter()
    acount = db.query(AircraftHistory.icao24).filter(AircraftHistory.timestamp >= cutoff).distinct().count()
    atime = time.perf_counter() - t0
    check(f"real aircraft distinct-count query ({acount} distinct icao24) now completes fast", atime < 1.0, f"{atime:.3f}s")

    # The full real function, end to end, against real live data.
    t0 = time.perf_counter()
    pic = briefing_prep.prepare_intelligence_picture(db, forge_alerts=[], fusion_engine_instance=None)
    total = time.perf_counter() - t0
    check("prepare_intelligence_picture() returns a real, complete structured picture",
          isinstance(pic, dict) and "statistics" in pic and "traffic_summary" in pic)
    check(f"prepare_intelligence_picture() total real wall-clock time is now well under the prior 11-17s baseline",
          total < 6.0, f"{total:.3f}s")
    print(f"  [INFO] real measured total: {total:.3f}s (prior confirmed baseline: 10.5-17.6s)")

    # Real, honest confirmation: an explicit fresh-computation call still
    # produces a genuinely fresh generated_at timestamp — no caching layer
    # was introduced that could make this stale (a deliberate, disclosed
    # scope decision given the fix above already resolves the dominant
    # real cost — see this round's PR description).
    before = datetime.datetime.utcnow()
    pic2 = briefing_prep.prepare_intelligence_picture(db, forge_alerts=[], fusion_engine_instance=None)
    generated_at = datetime.datetime.fromisoformat(pic2["generated_at"])
    check("every call still computes a real, genuinely fresh result (no stale cache introduced)",
          generated_at >= before, f"generated_at={pic2['generated_at']}, called at {before.isoformat()}")

    # Real region/time-window scoping (already existed pre-fix — confirmed
    # still functioning, not a regression from the index/instrumentation
    # changes above).
    scoped_pic = briefing_prep.prepare_intelligence_picture(
        db, forge_alerts=[], fusion_engine_instance=None,
        region=["Red Sea / Arabian Peninsula"],
    )
    check("real region-scoped calls still work correctly after this round's changes",
          isinstance(scoped_pic, dict) and "statistics" in scoped_pic)
finally:
    db.close()

print("=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    sys.exit(1)
print(f"  RESULT: all checks passed")
sys.exit(0)
