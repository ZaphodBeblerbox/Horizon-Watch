"""
Verification script for the 6 health-monitoring gaps closed in
GET /api/health/detailed (2026-08 audit): sanctions_loader.py's loader,
GDELT's missing sources-list entry, Sentinel-1 SAR fetch status, the
AllenAI SAR detector's pre-provisioned status key, the news funnel's
near-dup/embedding-relevance stage guards, and entity_linker.py's health
tracking.

Calls main.get_health_detailed() DIRECTLY as a plain function (no
TestClient, no ASGI lifespan/startup event) — this endpoint takes no
request-scoped input and only reads in-memory state
(_DS_STATUS/_PIPELINES_DATA/etc.), so a direct call exercises the exact
same code the real endpoint runs without needing a live server and,
critically, without triggering the real startup_event() (which would make
real outbound network calls — e.g. sanctions_loader's real OpenSanctions
download — that this script must not depend on).

Runs against an ISOLATED, throwaway sqlite DB (its own private DATA_DIR) —
NOT backend/data/akili.db. A real backend process is running an unrelated,
hours-long real-data observation window against that live database right
now, and this script must not write to it (same pattern as
test_write_alert_entity_linking.py on this branch).

Covers:
  1. All 6 new/fixed source entries appear in data_sources with the right
     fields, in their initial (pre-failure) state.
  2. Real failure-path simulation for entity_linker: monkeypatches
     EntityLinker._proximity_links to raise, calls the real link_alert()
     (not a direct _DS_STATUS poke), and confirms both _DS_STATUS and the
     health endpoint's entity_linker entry flip to "degraded".
  3. Real failure-path simulation for sanctions: monkeypatches
     sanctions_loader.httpx.AsyncClient to raise, calls the real
     load_or_refresh() (not a direct _DS_STATUS poke), and confirms both
     _DS_STATUS and the health endpoint's sanctions entry flip to
     "degraded".
  4. Sanctions staleness logic (last_loaded > ~48h ago, no error) also
     produces "degraded".

Usage:
    cd backend
    python3 test_health_detailed_sources.py
"""
import asyncio
import os
import sys
import tempfile
from datetime import datetime, timedelta

_TMP_DATA_DIR = tempfile.mkdtemp(prefix="health_detailed_test_")
os.environ["DATA_DIR"] = _TMP_DATA_DIR
sys.path.insert(0, os.path.dirname(__file__))

FAILURES = []


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


print("=" * 70)
print("  GET /api/health/detailed — 6 data-source health gaps — verification")
print(f"  (isolated DATA_DIR: {_TMP_DATA_DIR})")
print("=" * 70)

import intelligence_schema  # noqa: F401 — registers IntelligenceAssessment with Base before create_all
from database import Base, engine

Base.metadata.create_all(bind=engine)

import main  # noqa: E402 — bare import: no TestClient/startup event, so no real
             # network calls (sanctions download, AIS connect, etc.) ever fire.
import sanctions_loader as sanctions_loader_module  # noqa: E402

by_id = {}


def _refresh_sources():
    global by_id
    result = main.get_health_detailed()
    check("get_health_detailed() returns a dict with 'data_sources'",
          isinstance(result, dict) and isinstance(result.get("data_sources"), list), result)
    by_id = {s["id"]: s for s in result["data_sources"]}
    return result


# ── 1. Baseline shape — all 6 new/fixed entries present ────────────────────
print("\n[1] Baseline shape of all 6 new/fixed source entries")
_refresh_sources()

check("'sanctions' entry present", "sanctions" in by_id, list(by_id))
if "sanctions" in by_id:
    s = by_id["sanctions"]
    check("sanctions has required fields",
          {"last_fetch", "status", "failures", "last_attempt", "vessel_count", "message"}.issubset(s),
          s)
    check("sanctions initial status is 'pending' (never loaded)", s["status"] == "pending", s["status"])

check("'gdelt' entry present (previously missing from sources list)", "gdelt" in by_id, list(by_id))
if "gdelt" in by_id:
    g = by_id["gdelt"]
    check("gdelt has required fields",
          {"last_fetch", "status", "failures", "events_pushed"}.issubset(g), g)

check("'copernicus' entry present", "copernicus" in by_id, list(by_id))
if "copernicus" in by_id:
    c = by_id["copernicus"]
    check("copernicus carries new sar_* fields alongside existing token_valid",
          {"token_valid", "expires_at", "sar_last_success", "sar_failures", "sar_last_error"}.issubset(c),
          c)

# 2026-10 alert/detector audit follow-up: the 'sar_detection' entry (a
# pre-provisioned placeholder for sar_detector.py, which was never wired
# into any live caller) was removed along with sar_detector.py itself —
# confirmed real code, confirmed zero production callers. This is now a
# real regression guard that the dead placeholder doesn't come back.
check("'sar_detection' entry no longer exists (sar_detector.py was fully removed, not just left pre-provisioned)",
      "sar_detection" not in by_id, list(by_id))

check("'embedding_relevance' entry present", "embedding_relevance" in by_id, list(by_id))
if "embedding_relevance" in by_id:
    er = by_id["embedding_relevance"]
    check("embedding_relevance has required fields",
          {"last_fetch", "status", "failures", "last_error"}.issubset(er), er)
    check("embedding_relevance initial status is 'ok' (no failures yet)", er["status"] == "ok", er["status"])

check("'entity_linker' entry present", "entity_linker" in by_id, list(by_id))
if "entity_linker" in by_id:
    el = by_id["entity_linker"]
    check("entity_linker has required fields",
          {"last_fetch", "status", "failures", "loaded", "links_written", "last_error"}.issubset(el), el)
    check("entity_linker initial status is 'pending' (cache not loaded yet)",
          el["status"] == "pending", el["status"])

# ── 2. Real entity_linker failure path ──────────────────────────────────────
print("\n[2] entity_linker real failure path (link_alert() genuinely raises)")
main.entity_linker.load_cache()
check("entity_linker cache loaded", main.entity_linker._loaded is True)
_refresh_sources()
check("entity_linker 'loaded' flips to True in health/detailed after load_cache()",
      by_id["entity_linker"]["loaded"] is True, by_id["entity_linker"])

_orig_proximity = main.entity_linker._proximity_links


def _boom_proximity(*a, **kw):
    raise RuntimeError("simulated entity-linker failure")


main.entity_linker._proximity_links = _boom_proximity
try:
    main.entity_linker.link_alert("TEST-EL-1", "test", 1.0, 1.0, title="x")
finally:
    main.entity_linker._proximity_links = _orig_proximity

check("_DS_STATUS['entity_linker']['failures'] incremented by the real except block",
      main._DS_STATUS["entity_linker"]["failures"] >= 1, main._DS_STATUS["entity_linker"])
check("_DS_STATUS['entity_linker']['last_error'] mentions the real exception",
      "RuntimeError" in (main._DS_STATUS["entity_linker"].get("last_error") or "")
      and "link_alert" in (main._DS_STATUS["entity_linker"].get("last_error") or ""),
      main._DS_STATUS["entity_linker"].get("last_error"))

_refresh_sources()
check("health/detailed entity_linker entry now reports status='degraded'",
      by_id["entity_linker"]["status"] == "degraded", by_id["entity_linker"])
check("health/detailed entity_linker entry's failures/last_error match _DS_STATUS",
      by_id["entity_linker"]["failures"] == main._DS_STATUS["entity_linker"]["failures"], by_id["entity_linker"])

# ── 3. Real sanctions failure path ──────────────────────────────────────────
print("\n[3] sanctions real failure path (load_or_refresh() genuinely raises)")
check("sanctions_loader singleton never loaded (bare import — no startup event ran)",
      main.sanctions_loader._last_loaded is None, main.sanctions_loader._last_loaded)


class _BoomAsyncClient:
    """Emulates a realistic network failure: real httpx.AsyncClient's
    __aenter__ doesn't do I/O and essentially never raises — only .get()
    fails for network reasons. Raising from .get() (not __aenter__) is what
    exercises the CSV loop's real per-URL try/except AND the JSON-fallback's
    real try/except, matching how load_or_refresh() actually fails in
    production rather than an unrealistic failure shape."""
    def __init__(self, *a, **kw):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, *a, **kw):
        raise RuntimeError("simulated network outage")


_orig_async_client = sanctions_loader_module.httpx.AsyncClient
sanctions_loader_module.httpx.AsyncClient = _BoomAsyncClient
try:
    refresh_result = asyncio.run(main.sanctions_loader.load_or_refresh())
finally:
    sanctions_loader_module.httpx.AsyncClient = _orig_async_client

check("load_or_refresh() returns an error dict on genuine failure",
      isinstance(refresh_result, dict) and "error" in refresh_result, refresh_result)
check("_DS_STATUS['sanctions']['failures'] incremented by the real failure path",
      main._DS_STATUS["sanctions"]["failures"] >= 1, main._DS_STATUS["sanctions"])
check("_DS_STATUS['sanctions']['last_attempt'] set",
      main._DS_STATUS["sanctions"]["last_attempt"] is not None, main._DS_STATUS["sanctions"])
check("_DS_STATUS['sanctions']['error'] set to the real error string",
      bool(main._DS_STATUS["sanctions"].get("error")), main._DS_STATUS["sanctions"].get("error"))

_refresh_sources()
check("health/detailed sanctions entry now reports status='degraded'",
      by_id["sanctions"]["status"] == "degraded", by_id["sanctions"])
check("health/detailed sanctions entry's message carries the real error",
      bool(by_id["sanctions"].get("message")), by_id["sanctions"])

# ── 4. Sanctions staleness logic (last_loaded > ~48h ago, no error) ─────────
print("\n[4] Sanctions staleness — degraded when last_loaded is stale, even with no error")
with main._DS_STATUS_LOCK:
    main._DS_STATUS["sanctions"]["error"] = None
    main._DS_STATUS["sanctions"]["last_loaded"] = (datetime.utcnow() - timedelta(hours=72)).isoformat()
_refresh_sources()
check("stale (>48h) last_loaded with no error still reports 'degraded'",
      by_id["sanctions"]["status"] == "degraded", by_id["sanctions"])

with main._DS_STATUS_LOCK:
    main._DS_STATUS["sanctions"]["last_loaded"] = datetime.utcnow().isoformat()
_refresh_sources()
check("fresh last_loaded with no error reports 'ok'",
      by_id["sanctions"]["status"] == "ok", by_id["sanctions"])

print("\n" + "=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    print("=" * 70)
    sys.exit(1)
else:
    print("  RESULT: ALL CHECKS PASSED")
    print("=" * 70)
