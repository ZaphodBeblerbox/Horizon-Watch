"""
process_role.py — which half of the app this process is.

WHY THIS EXISTS. Measured in production, the event loop was blocked 68% of
wall-clock time: 45.4s out of 67s, longest single block 26.5s. Not one bad
function — the process was being asked to ingest AIS at 5,400 messages a
minute, run a detection cycle over 1,700 vessels every five minutes, warm
derived data for 156s out of every 720s, resolve 33,000 vessels, and serve
HTTP, all inside one Python interpreter where the GIL lets exactly one
thread run at a time.

Four separate fixes moved work off the loop and none of them were enough,
because moving CPU-bound Python to a thread relocates GIL contention
rather than removing it. The only thing that removes it is another
process.

WHAT MOVES, AND WHAT DELIBERATELY DOES NOT. A loop may move only if
everything it produces is visible to the other process — which in practice
means it writes to SQLite and nothing else. A loop that fills an
in-process dict must stay with the readers of that dict, or moving it
makes things worse rather than better: `_risk_index_warm_loop` warms
`routers.risk_index._RISK_CACHE`, a plain module-level dict with no
persistence, so warming it in a worker would leave every web request
recomputing 121 countries from scratch.

So this is deliberately a partial split. The loops that own in-memory
state the API serves — fusion buckets, `_forge_alerts`, `_AIS_VESSELS`,
`_SURFACE_POOL`, the warm caches — stay in the web process until that
state is persisted. Everything that already only writes to the database
goes now.
"""
import os

#: "all" (default, and what every existing deployment does), "web", or
#: "worker". Defaulting to "all" means nothing changes for anyone who does
#: not set it, including local development and the test suite.
ROLE = (os.getenv("PARALLAX_ROLE") or "all").strip().lower()

if ROLE not in ("all", "web", "worker"):
    raise SystemExit(
        f"PARALLAX_ROLE must be one of all, web, worker — got {ROLE!r}")

#: Loops whose entire output is rows in SQLite. Verified individually: each
#: one writes to the database and touches no module-level structure that an
#: endpoint reads. Adding a name here without checking that is how the web
#: process quietly starts serving an empty layer.
WORKER_ONLY = frozenset({
    # Storage upkeep — heavy, purely custodial.
    "_ais_aggregate_loop",          # upserts track_density (~123M rows)
    "_ais_history_flush_loop",      # buffered vessel_history writes
    "_prune_history_loop",
    "_daily_db_purge_loop",
    "_wal_checkpoint_loop",
    "_analytics_daily_loop",        # folds alerts into alert_daily (Analytics page)
    # Enrichment and ingest — all DB-backed.
    "_vessel_resolution_loop",      # walks 33,000+ vessels
    "_graph_bootstrap_loop",
    "_facilities_ingest_loop",
    "_geo_refresh_loop",
    "_sanctions_refresh_loop",
    "_geoconfirmed_sync_loop",
    "_background_news_geocode_loop",
    "_auto_ingest_task",
    "_zone_images_warmup_task",
    # Modelling — expensive fits, results persisted.
    "_forecast_tail_loop",
    "_forecast_publish_loop",
    "_imminence_loop",
    "_trajectory_loop",
})

#: Checked, and deliberately NOT in the list above.
#:
#: A first pass classified these as database-only by looking at each loop
#: function alone. That is not enough: a loop that touches nothing itself
#: can still CALL something that reads in-process state, and moving it
#: would leave that read looking at an empty structure in the wrong
#: process — a silently broken feature, not an error.
#:
#:   _weekly_snapshot_loop          reads _forge_alerts
#:   _sentinel_zone_scheduler_loop  reaches _fusion_engine
#:   _threat_matrix_loop            reaches _forge_alerts and _fusion_engine
#:
#: test_process_role.py re-derives this transitively from the source, so
#: the list cannot drift away from what the code actually does.


def runs_here(loop_name: str) -> bool:
    """Should this process start that background loop?"""
    if ROLE == "all":
        return True
    if ROLE == "worker":
        return loop_name in WORKER_ONLY
    return loop_name not in WORKER_ONLY        # web


def describe() -> str:
    if ROLE == "all":
        return "all (single process: serves HTTP and runs every background loop)"
    if ROLE == "worker":
        return f"worker ({len(WORKER_ONLY)} background loops, no HTTP traffic expected)"
    return f"web (HTTP + the loops that own in-process state; {len(WORKER_ONLY)} deferred to the worker)"
