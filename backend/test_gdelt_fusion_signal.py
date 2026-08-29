"""
GDELT signal-domain / fusion-engine participation test.

This is a real end-to-end check of the wiring added to feed GDELT into the
existing multi-domain fusion/correlation engine (fusion_engine.py) as one
signal domain among several (AIS/ADSB/NEWS/GDELT/...), exactly the way an AIS
anomaly or ADS-B loiter already is. It deliberately does NOT special-case the
signal shape for the test: the GDELT source dict built below is shaped
exactly like gdelt_events.py's normalized event dict, run through the same
severity_tier -> fusion-severity mapping (main._GDELT_SEVERITY_MAP) and the
same main.normalize_signal("GDELT", {...}) helper that main._gdelt_loop()
uses in production.

Two scenarios, at two distinct synthetic (remote, off-zone) locations so
they can't interfere with each other or with real production signals. The
exact coordinates are randomized per run (deterministically derived from a
fresh uuid each time, within fixed remote-ocean boxes) rather than hardcoded
constants: on_signal() persists every signal to the DB with a ~12h TTL, so a
FIXED test location would accumulate leftover signals from previous test
runs at the exact same geo_key and contaminate later runs (observed while
developing this test — a second run's "lone GDELT" scenario found a prior
run's leftover AIS signal still present at the same fixed coordinates).
Randomizing the location every run keeps each run's geo_key isolated from
any of its own prior runs' DB residue.

  A. A LONE GDELT signal at a geo_key with no other domain present must NOT
     create a FusionEvent (a GDELT signal is corroboration fodder only, never
     a standalone confirmed event on its own).
  B. A GDELT signal + a second, different-domain signal ("AIS") landing in
     the SAME geo_key (same 0.1-degree-rounded lat/lon grid cell) together
     satisfy fusion_engine's >=2-domains/>=2-signals threshold and DO create
     a FusionEvent that lists both domains.

Cleanup: FusionEngine has no public "delete this signal" API, and on_signal()
always persists a FusionSignal row (TTL ~12h, extended by the app's own daily
purge loop only once expired). Any FusionEvent this test creates IS cleaned
up via the app's own existing DELETE /api/fusions/{fusion_id} handler
(main.api_fusions_delete, called directly as a plain function — an ORM
status update, not raw SQL) which marks it resolved/invisible. The
underlying FusionSignal rows have no equivalent app-native early-deletion
path, so — per this codebase's convention for hard-to-clean state (see
test_null_island_correlation.py) — we do NOT touch the SQLite DB with raw
SQL to force-remove them; they are left tagged (TEST-* signal_id,
"AUTOMATED TEST — SAFE TO DELETE" in location_name) for the app's own
expiry/purge loop to clear once their TTL elapses. This test also reverses
the in-memory singleton state (active_signals / active_fusions /
signal_to_fusion) it added so repeated runs in the same process don't
accumulate.
"""
import hashlib
import os
import sys
import uuid

# Note: main.py's DATA_DIR is hardcoded to backend/data (or /var/lib/railway)
# and does not read a DATA_DIR env var, so — like the other test_* scripts in
# this directory — this runs against the real backend/data dir. It writes
# FusionSignal/FusionEvent rows via fusion_engine's own persistence code path
# (see docstring above for why, and what cleanup is/isn't done).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import main  # noqa: E402

FAILURES = []


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


print("=" * 70)
print("  GDELT -> fusion engine signal-domain participation test")
print("=" * 70)

if not getattr(main, "_HAS_FUSION", False) or main._fusion_engine is None:
    print("  fusion engine not available in this build — cannot run test")
    sys.exit(1)

fe = main._fusion_engine
test_tag = uuid.uuid4().hex[:8]


def _random_remote_point(seed: str, lat_box: float, lon_box: float, spread: float = 8.0):
    """Deterministic-per-seed pseudo-random point within [lat_box-spread, lat_box]
    x [lon_box-spread, lon_box] — a fixed remote-ocean box, but a fresh point
    inside it every test run (see module docstring: fixed coordinates would
    accumulate leftover signals across runs since on_signal() persists to DB)."""
    h = int(hashlib.sha256(f"{test_tag}:{seed}".encode()).hexdigest(), 16)
    lat_frac = (h % 100_000) / 100_000.0
    lon_frac = ((h // 100_000) % 100_000) / 100_000.0
    return round(lat_box - lat_frac * spread, 3), round(lon_box - lon_frac * spread, 3)


def _build_gdelt_signal(lat, lon, location_name, severity_tier, event_type, event_root_code, summary):
    """Shape a GDELT source dict exactly like gdelt_events.py's normalized
    event output, then run it through the same severity mapping + the same
    normalize_signal("GDELT", ...) call that main._gdelt_loop() uses."""
    gdelt_event = {
        "lat": lat, "lon": lon,
        "location_name": location_name,
        "country_code": "XX",          # deliberately non-real, keeps geo-keying on lat/lon grid
        "severity_tier": severity_tier,  # gdelt_events.py vocabulary
        "event_type": event_type,
        "event_root_code": event_root_code,
        "summary": summary,
    }
    severity = main._GDELT_SEVERITY_MAP.get(gdelt_event["severity_tier"], "medium")
    sig = main.normalize_signal("GDELT", {
        "severity":      severity,
        "lat":           gdelt_event["lat"],
        "lon":           gdelt_event["lon"],
        "location_name": gdelt_event["location_name"],
        "country":       None,
        "rule_id":       f"gdelt_{gdelt_event['event_root_code']}",
        "rule_name":     gdelt_event["event_type"],
        "title":         gdelt_event["summary"],
    })
    return sig


# ── Scenario A: lone GDELT signal — must NOT create a FusionEvent ─────────
# Remote South Pacific box, no strategic zone, no other domain traffic.
LONE_LAT, LONE_LON = _random_remote_point("lone", lat_box=-40.0, lon_box=175.0)

sig_lone = _build_gdelt_signal(
    LONE_LAT, LONE_LON,
    f"TEST SYNTHETIC LOCATION {test_tag}-A (AUTOMATED TEST — SAFE TO DELETE)",
    severity_tier="critical", event_type="Mass Violence", event_root_code="20",
    summary=f"[TEST {test_tag}] synthetic GDELT mass-violence event, lone-signal scenario",
)
sig_lone["signal_id"] = f"TEST-GDELT-LONE-{test_tag}"

geo_key_lone = fe._resolve_geo_key(sig_lone)
fe.on_signal(sig_lone)

fusions_at_lone = [f for f in fe.active_fusions.values() if f.get("geo_key") == geo_key_lone]
check(
    "lone GDELT signal does NOT create a FusionEvent",
    len(fusions_at_lone) == 0,
    f"geo_key={geo_key_lone} fusions={fusions_at_lone}",
)
domains_at_lone = {s["domain"] for s in fe.active_signals.get(geo_key_lone, [])}
check(
    "lone GDELT geo_key has exactly one domain present (GDELT only)",
    domains_at_lone == {"GDELT"},
    f"domains={domains_at_lone}",
)

# ── Scenario B: GDELT + a second domain (AIS) at the SAME geo_key ─────────
#    fusion_engine requires >=2 distinct domains AND >=2 signals -> must fire.
# Different remote box (South Atlantic), well clear of scenario A's Pacific box.
COLL_LAT, COLL_LON = _random_remote_point("coll", lat_box=-40.0, lon_box=-20.0)

sig_gdelt = _build_gdelt_signal(
    COLL_LAT, COLL_LON,
    f"TEST SYNTHETIC LOCATION {test_tag}-B (AUTOMATED TEST — SAFE TO DELETE)",
    severity_tier="significant", event_type="Fight", event_root_code="19",
    summary=f"[TEST {test_tag}] synthetic GDELT armed-clash event, collision scenario",
)
sig_gdelt["signal_id"] = f"TEST-GDELT-COLL-{test_tag}"

# A second, different-domain signal built the same way NEWS/AIS signals
# already are (via normalize_signal), landing in the same 0.1-degree grid cell.
sig_ais = main.normalize_signal("AIS", {
    "severity":      "medium",
    "lat":           COLL_LAT + 0.002,
    "lon":           COLL_LON + 0.001,
    "location_name": f"TEST SYNTHETIC LOCATION {test_tag}-B (AUTOMATED TEST — SAFE TO DELETE)",
    "country":       None,
    "rule_id":       "test_ais_rule",
    "rule_name":     "TEST_AIS_ANOMALY",
    "title":         f"[TEST {test_tag}] synthetic AIS anomaly, collision scenario",
})
sig_ais["signal_id"] = f"TEST-AIS-COLL-{test_tag}"

geo_key_gdelt = fe._resolve_geo_key(sig_gdelt)
geo_key_ais   = fe._resolve_geo_key(sig_ais)
check(
    "GDELT and AIS synthetic signals resolve to the SAME geo_key",
    geo_key_gdelt == geo_key_ais,
    f"gdelt={geo_key_gdelt} ais={geo_key_ais}",
)

fe.on_signal(sig_gdelt)
fusions_before_second_domain = [f for f in fe.active_fusions.values() if f.get("geo_key") == geo_key_gdelt]
check(
    "GDELT alone at the collision geo_key does NOT yet create a FusionEvent",
    len(fusions_before_second_domain) == 0,
    f"fusions={fusions_before_second_domain}",
)

fe.on_signal(sig_ais)
fusions_after_second_domain = [f for f in fe.active_fusions.values() if f.get("geo_key") == geo_key_gdelt]
check(
    "GDELT + AIS at the same geo_key DOES create a FusionEvent",
    len(fusions_after_second_domain) == 1,
    f"fusions={fusions_after_second_domain}",
)
if fusions_after_second_domain:
    domains_in_fusion = set(fusions_after_second_domain[0].get("domains", []))
    check(
        "created FusionEvent's domains include both GDELT and AIS",
        {"GDELT", "AIS"}.issubset(domains_in_fusion),
        f"domains={domains_in_fusion}",
    )

# ── Cleanup (see module docstring for why full DB cleanup isn't possible) ─
# Use the app's own DELETE /api/fusions/{fusion_id} handler (ORM-based
# resolve, not raw SQL) to mark any FusionEvent this test created as
# resolved/invisible immediately, rather than leaving it "active".
created_fusion_ids = [f["fusion_id"] for f in fusions_after_second_domain]
for fid in created_fusion_ids:
    try:
        main.api_fusions_delete(fid)
        print(f"  [cleanup] resolved test fusion {fid} via /api/fusions/{{id}} DELETE handler")
    except Exception as _cleanup_err:
        print(f"  [cleanup] could not resolve {fid}: {_cleanup_err}")

# Reverse the in-memory singleton state this test added so repeated runs in
# the same process don't accumulate. The underlying FusionSignal DB rows
# (~12h TTL) are left for the app's own expiry/purge loop, as documented above.
for gk in (geo_key_lone, geo_key_gdelt):
    fe.active_signals.pop(gk, None)
for fdict in list(fe.active_fusions.values()):
    if fdict.get("geo_key") in (geo_key_lone, geo_key_gdelt):
        fe.active_fusions.pop(fdict["fusion_id"], None)
for sid in (sig_lone["signal_id"], sig_gdelt["signal_id"], sig_ais["signal_id"]):
    fe.signal_to_fusion.pop(sid, None)

print("=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
else:
    print("  RESULT: ALL CHECKS PASSED")
print("=" * 70)

if __name__ == "__main__":
    sys.exit(1 if FAILURES else 0)
