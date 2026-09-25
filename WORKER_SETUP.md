# Running Parallax as two processes

## Why

Measured in production on 2026-09-25, the API process had its event loop
blocked **68% of wall-clock time** — 45.4s out of 67s, longest single
block 26.5s. That is what the hourly 10–15 minute outages were.

It was not one slow function. One Python interpreter was being asked to
ingest AIS at ~5,400 messages/minute, run a detection cycle over ~1,700
vessels every five minutes, warm derived data for 156s out of every 720s,
resolve 33,000+ vessels, and serve HTTP. Under the GIL only one thread
runs Python at a time, so moving work into threads relocates the
contention instead of removing it. Four separate fixes did exactly that
and none was sufficient.

Another **process** is the thing that actually removes it.

## What runs where

`PARALLAX_ROLE` selects the half. It defaults to `all`, which is the
existing single-process behaviour, so a deployment that sets nothing
keeps working exactly as before.

| Role     | Serves HTTP | Background loops                                  |
|----------|-------------|---------------------------------------------------|
| `all`    | yes         | every loop (the default, and local development)   |
| `web`    | yes         | the loops that own in-process state the API reads |
| `worker` | no traffic  | the 18 loops in `process_role.WORKER_ONLY`        |

The split is deliberately partial. A loop may move only if everything it
produces reaches the other process — in practice, only if it writes to
SQLite and nothing else. `_risk_index_warm_loop` warms a plain
module-level dict with no persistence, so warming it in the worker would
leave every web request recomputing 121 countries; it stays. The same is
true for fusion buckets, `_forge_alerts`, `_AIS_VESSELS` and
`_SURFACE_POOL`.

`test_process_role.py` re-derives the allowlist from the source
transitively and fails if an entry reaches in-process state. It caught
three wrong entries on the first pass — a loop that touches nothing
itself can still call something that does.

## Setting it up on Railway

**One container, two processes** — not two services. A Railway volume
mounts to exactly one service, and both halves need the same `akili.db`,
so a second service could not see the database.

`backend/Procfile` now runs `./start.sh`, which launches the worker in the
background and the web process in the foreground. Nothing else to
configure: deploy as usual.

To roll back, set `PARALLAX_RUN_WORKER=false`. The web process then runs
every loop itself, exactly as before.

### What it costs

Measured at import, per process:

| Role   | Memory |
|--------|--------|
| web    | 849 MB |
| worker | 581 MB |

So the split adds roughly **581 MB**. The worker is smaller because it
skips `_load_static_infra_datasets()` — ~49,000 airports and ~11,700
ports held in memory purely so the API can serve them, which no
worker-only loop touches. Without that skip the worker was 1,179 MB and
the split cost ~914 MB.

If the container is memory-limited, this is the number to check first.

## Checking it worked

Both processes announce themselves in their first log lines:

    [startup] process role: web (HTTP + the loops that own in-process state; 18 deferred to the worker)
    [startup] process role: worker (18 background loops, no HTTP traffic expected)

Then watch the web service for `[loop-lag]`. That line reports how long
the event loop was blocked, measured rather than inferred, and it is
silent while healthy. Before the split it reported blocks of 26–75s.

## Caveat worth knowing

Two processes writing one SQLite file rely on WAL plus the busy timeout
(`database.py` sets `synchronous=NORMAL` and `busy_timeout=30000`). That
is sound for this write volume, but it is the thing to watch: if
`database is locked` reappears in either log, the next step is moving the
write-heavy tables to the Postgres instance that already exists in the
project but is currently Offline.
