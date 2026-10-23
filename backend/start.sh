#!/usr/bin/env bash
# Start Parallax as two processes in one container.
#
# WHY TWO PROCESSES, AND WHY IN ONE CONTAINER.
#
# Measured in production, the API's event loop was blocked 68% of
# wall-clock time — 45.4s out of 67s, longest block 26.5s. That is what
# the hourly outages were. One Python interpreter was ingesting AIS at
# ~5,400 messages/minute, running a detection cycle over ~1,700 vessels
# every five minutes, warming derived data for 156s out of every 720s,
# resolving 33,000+ vessels, and serving HTTP. Under the GIL only one
# thread runs Python at a time, so moving work into threads relocates the
# contention instead of removing it. Only another process removes it.
#
# They share one container rather than being two Railway services because
# a Railway volume mounts to exactly ONE service, and both halves need the
# same akili.db. Same volume, same image, two interpreters, two GILs.
#
# Memory cost measured: web ~1400MB, worker ~87MB. The worker is small
# because it never loads the airports/ports datasets the API serves — so
# this is about +6%, not double.
set -uo pipefail

# Job control, so the worker subshell becomes its own process group and
# the trap below can signal the whole group. Without this, `kill -- -PID`
# has no group to address and uvicorn is left orphaned when the container
# stops.
set -m

# Python block-buffers stdout when it is a pipe rather than a terminal, so
# a plain print() from either process can sit unflushed for kilobytes.
# Caught locally: the worker's own startup banner never appeared in the
# log at all. In production that is the difference between being able to
# diagnose the worker and not.
export PYTHONUNBUFFERED=1

# NATIVE THREADS AND MALLOC ARENAS (measured 2026-10-23, web process, 7.8 h
# up: 6.07 GB RSS, 188 OS threads of which only 48 run Python). The host
# shows 48 CPUs, so OpenBLAS (twice: numpy's and scipy's), libgomp (twice)
# and torch each started a 48-thread pool at import: ~150 idle threads. And
# glibc gives every thread that allocates its own 64 MB arena (up to 8 per
# CPU = 384): 48 arena heaps held 2.45 GB resident, freed memory that never
# returns to the OS. Bounded here, before Python starts (malloc reads its
# setting once); a variable set in Railway still wins.
export MALLOC_ARENA_MAX="${MALLOC_ARENA_MAX:-4}"
export OMP_NUM_THREADS="${OMP_NUM_THREADS:-4}"
export OPENBLAS_NUM_THREADS="${OPENBLAS_NUM_THREADS:-4}"
export MKL_NUM_THREADS="${MKL_NUM_THREADS:-4}"
export NUMEXPR_MAX_THREADS="${NUMEXPR_MAX_THREADS:-4}"

PORT="${PORT:-8000}"
WORKER_PORT="${WORKER_PORT:-8090}"

# The worker reuses the same entrypoint rather than a second one, so there
# is no separate startup path to keep in sync. It binds a loopback port
# only because uvicorn needs one; nothing connects to it.
if [ "${PARALLAX_RUN_WORKER:-true}" = "true" ]; then
  (
    while true; do
      PARALLAX_ROLE=worker python -m uvicorn main:app \
        --host 127.0.0.1 --port "$WORKER_PORT" --log-level warning
      code=$?
      # A worker that exits takes its loops with it and nothing else
      # notices, so it is restarted rather than left dead. The delay stops
      # a crash-on-boot from becoming a hot loop.
      echo "[start] worker exited ($code) — restarting in 10s" >&2
      sleep 10
    done
  ) &
  WORKER_SUPERVISOR=$!
  # Container lifecycle follows the web process; take the worker with it.
  # The group first (which reaches uvicorn), then the supervisor itself as
  # a fallback if the group is already gone.
  cleanup() {
    kill -TERM -- -"$WORKER_SUPERVISOR" 2>/dev/null \
      || kill -TERM "$WORKER_SUPERVISOR" 2>/dev/null || true
  }
  trap cleanup EXIT INT TERM
  echo "[start] worker supervisor pid $WORKER_SUPERVISOR (role=worker, port $WORKER_PORT)"
else
  echo "[start] PARALLAX_RUN_WORKER=false — single process, every loop in the web role"
fi

# exec, so uvicorn is PID 1's direct successor and receives signals.
PARALLAX_ROLE="${PARALLAX_ROLE:-web}" exec python -m uvicorn main:app \
  --host 0.0.0.0 --port "$PORT"
