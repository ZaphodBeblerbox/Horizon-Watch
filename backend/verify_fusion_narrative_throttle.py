"""
Real regression test for the 2026-09 Claude-spend audit's primary finding:
fusion_engine.py's Haiku narrative call was completely unmetered and
unthrottled — _update_fusion() re-fired it on every contributing signal
added to an already-existing cluster, and a process restart re-fired it
again for every active cluster (and even minted a genuinely duplicate
FusionEvent row while doing so, since active_fusions was never reloaded
from the DB). Script-style, matches this directory's existing test_*.py
convention (see test_fusion_narrative_validator.py, test_gdelt_fusion_
signal.py).

Three real checks, against main._fusion_engine and the real dev DB (Claude
itself mocked out — this is a cost-control test, it should never spend a
real token to prove it doesn't spend real tokens):

  1. _narrative_refresh_due() unit behavior (pure function, no DB).
  2. A second contributing signal joining an already-fused cluster with no
     new domain makes ZERO additional Haiku calls (the direct ask: "process
     the same signal twice, confirm the second pass makes zero calls").
  3. Simulating a process restart (a fresh FusionEngine instance reloading
     from the real DB) and re-evaluating the same still-active cluster
     makes ZERO additional Haiku calls AND creates no second FusionEvent
     row for the same geo_key.
"""
import datetime
import hashlib
import os
import sys
import uuid
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import main  # noqa: E402
from fusion_engine import FusionEngine, FUSION_NARRATIVE_MIN_REFRESH_MINUTES  # noqa: E402

FAILURES = []


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


def _mock_msg(text):
    m = MagicMock()
    m.content = [MagicMock(text=text)]
    m.usage = MagicMock(input_tokens=100, output_tokens=50)
    return m


CLEAN_JSON = """{
  "title": "Throttle Test Convergence",
  "subtitle": "AIS + NEWS convergence",
  "narrative": "A sanctioned vessel was detected loitering while news reports describe a related disruption.",
  "key_signals": ["Sanctioned vessel detected loitering"],
  "threat_indicators": ["Sanctions-evasion activity"]
}"""

print("=" * 70)
print("  Fusion narrative throttle / restart-dedup regression test")
print("=" * 70)

if not getattr(main, "_HAS_FUSION", False) or main._fusion_engine is None:
    print("  fusion engine not available in this build — cannot run test")
    sys.exit(1)

fe = main._fusion_engine
test_tag = uuid.uuid4().hex[:8]


# ── 1. _narrative_refresh_due() pure-function behavior ─────────────────────
print("1. _narrative_refresh_due() gates correctly on presence + elapsed time")

check("no narrative yet -> always due",
      fe._narrative_refresh_due({"narrative": None, "narrative_generated_at": None}))

now = datetime.datetime.utcnow()
recent = now - datetime.timedelta(minutes=1)
old    = now - datetime.timedelta(minutes=FUSION_NARRATIVE_MIN_REFRESH_MINUTES + 5)

check("narrative present, generated 1 minute ago -> NOT due",
      not fe._narrative_refresh_due({"narrative": "x", "narrative_generated_at": recent}))
check(f"narrative present, generated {FUSION_NARRATIVE_MIN_REFRESH_MINUTES + 5} minutes ago -> due",
      fe._narrative_refresh_due({"narrative": "x", "narrative_generated_at": old}))
check("narrative present but no timestamp at all -> due (never seen a real generation time)",
      fe._narrative_refresh_due({"narrative": "x", "narrative_generated_at": None}))


def _random_remote_point(seed: str, lat_box: float, lon_box: float, spread: float = 8.0):
    h = int(hashlib.sha256(f"{test_tag}:{seed}".encode()).hexdigest(), 16)
    lat_frac = (h % 100_000) / 100_000.0
    lon_frac = ((h // 100_000) % 100_000) / 100_000.0
    return round(lat_box - lat_frac * spread, 3), round(lon_box - lon_frac * spread, 3)


LAT, LON = _random_remote_point("throttle", lat_box=-40.0, lon_box=60.0)
LOC = f"TEST SYNTHETIC LOCATION {test_tag} (AUTOMATED TEST — SAFE TO DELETE)"

sig_ais = main.normalize_signal("AIS", {
    "severity": "high", "lat": LAT, "lon": LON, "location_name": LOC, "country": None,
    "rule_id": "test_throttle_ais", "rule_name": "TEST_AIS_ANOMALY",
    "title": f"[TEST {test_tag}] synthetic AIS anomaly, throttle scenario",
})
sig_ais["signal_id"] = f"TEST-THROTTLE-AIS-{test_tag}"

sig_news = main.normalize_signal("NEWS", {
    "severity": "high", "lat": LAT, "lon": LON, "location_name": LOC, "country": None,
    "rule_id": "test_throttle_news", "rule_name": "TEST_NEWS_ASSESSMENT",
    "title": f"[TEST {test_tag}] synthetic news assessment, throttle scenario",
})
sig_news["signal_id"] = f"TEST-THROTTLE-NEWS-{test_tag}"

sig_ais2 = main.normalize_signal("AIS", {
    "severity": "high", "lat": LAT, "lon": LON, "location_name": LOC, "country": None,
    "rule_id": "test_throttle_ais", "rule_name": "TEST_AIS_ANOMALY",
    "title": f"[TEST {test_tag}] second synthetic AIS anomaly, same domain, throttle scenario",
})
sig_ais2["signal_id"] = f"TEST-THROTTLE-AIS2-{test_tag}"

geo_key = fe._resolve_geo_key(sig_ais)

call_count = {"n": 0}


def _fake_create(**kwargs):
    call_count["n"] += 1
    return _mock_msg(CLEAN_JSON)


with patch("anthropic.Anthropic") as MockAnthropic:
    instance = MockAnthropic.return_value
    instance.messages.create.side_effect = _fake_create

    # ── 2. First two signals (2 domains) create the fusion — exactly 1 call ─
    print("2. a second contributing signal (same domain set) makes ZERO additional calls")
    fe.on_signal(sig_ais)
    fe.on_signal(sig_news)
    calls_after_create = call_count["n"]
    check("exactly 1 Haiku call to create the fusion (2 domains, first time)",
          calls_after_create == 1, f"calls={calls_after_create}")

    fusions = [f for f in fe.active_fusions.values() if f.get("geo_key") == geo_key]
    check("fusion event was actually created", len(fusions) == 1, f"fusions={fusions}")

    # A third contributing signal, SAME domain set (no new domain), landing
    # moments later — the real "process the same signal twice" case Part 4
    # asks for: this must NOT spend a second Haiku call.
    fe.on_signal(sig_ais2)
    calls_after_second_signal = call_count["n"]
    check("a same-domain-set follow-up signal makes ZERO additional Haiku calls",
          calls_after_second_signal == calls_after_create,
          f"calls_before={calls_after_create} calls_after={calls_after_second_signal}")

    fusion_id = fusions[0]["fusion_id"] if fusions else None
    check("still exactly one fusion event for this geo_key (no duplicate created)",
          len([f for f in fe.active_fusions.values() if f.get("geo_key") == geo_key]) == 1)

    # ── 3. Simulated restart: fresh FusionEngine, reload from DB, re-evaluate ─
    print("3. simulated restart (fresh engine instance) makes ZERO additional Haiku calls")
    fe2 = FusionEngine()
    fe2._reload_fusions_from_db()
    fe2._add_signal(geo_key, sig_ais)
    fe2._add_signal(geo_key, sig_news)
    fe2._add_signal(geo_key, sig_ais2)
    fe2._evaluate_fusion(geo_key)
    calls_after_restart = call_count["n"]
    check("re-evaluating the same cluster after a simulated restart makes ZERO additional Haiku calls",
          calls_after_restart == calls_after_second_signal,
          f"calls_before={calls_after_second_signal} calls_after={calls_after_restart}")

    fusions_after_restart = [f for f in fe2.active_fusions.values() if f.get("geo_key") == geo_key]
    check("the reloaded engine sees the SAME fusion_id, not a new duplicate one",
          len(fusions_after_restart) == 1 and fusions_after_restart[0]["fusion_id"] == fusion_id,
          f"fusion_id={fusion_id} reloaded={fusions_after_restart}")

# ── Cleanup ──────────────────────────────────────────────────────────────
final_fusions = [f for f in fe.active_fusions.values() if f.get("geo_key") == geo_key]
for fdict in final_fusions:
    try:
        main.api_fusions_delete(fdict["fusion_id"])
        print(f"  [cleanup] resolved test fusion {fdict['fusion_id']} via /api/fusions/{{id}} DELETE handler")
    except Exception as _cleanup_err:
        print(f"  [cleanup] could not resolve {fdict['fusion_id']}: {_cleanup_err}")

fe.active_signals.pop(geo_key, None)
for fdict in list(fe.active_fusions.values()):
    if fdict.get("geo_key") == geo_key:
        fe.active_fusions.pop(fdict["fusion_id"], None)
for sid in (sig_ais["signal_id"], sig_news["signal_id"], sig_ais2["signal_id"]):
    fe.signal_to_fusion.pop(sid, None)

print("=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
else:
    print("  RESULT: ALL CHECKS PASSED")
print("=" * 70)

if __name__ == "__main__":
    sys.exit(1 if FAILURES else 0)
