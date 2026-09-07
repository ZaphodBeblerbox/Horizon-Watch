"""
Real regression test for the CorrelationEngine -> fusion_engine.py fold
(2026-09/10 alert/detector audit follow-up).

CorrelationEngine._assess_cluster()/correlate() used to be the thing that
decided whether a cross-domain correlation was HIGH/CRITICAL enough to get
auto-added to the ontology graph (main.py's _auto_add_correlation_to_
ontology(), called from the old "Stage 4" block in _forge_detection_cycle).
That whole class has been deleted — confirmed zero remaining callers via
grep — and ontology auto-add now reads directly off a real FusionEvent's
own severity/lat/lon/narrative/confidence/domains, fired from main.py's
_fusion_fire_callback the moment fusion_engine.py creates or updates one.

This test proves the NEW path actually produces the same real, observable
effect the OLD path did for an equivalent case: a real cross-domain cluster
whose severity clears the HIGH/CRITICAL threshold gets a real "correlation"
node written into forge_ontology.json, linked to real nearby ontology
entities, and a real entry appended to main._correlation_assessments (the
same list routers/forge.py's /api/forge/brain/inspect endpoint reports as
the live "Correlations" stat).

Claude itself is mocked out — this is a behavior test, not a narrative-
quality test (see test_fusion_narrative_validator.py/test_fusion_narrative_
throttle.py for that). Script-style, matches this directory's existing
test_*.py convention.
"""
import hashlib
import os
import sys
import uuid
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import main  # noqa: E402

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
  "title": "Ontology Fold Test Convergence",
  "subtitle": "AIS + NEWS convergence",
  "narrative": "A sanctioned vessel was detected loitering while news reports describe a related disruption.",
  "key_signals": ["Sanctioned vessel detected loitering"],
  "threat_indicators": ["Sanctions-evasion activity"]
}"""

print("=" * 70)
print("  CorrelationEngine -> fusion_engine.py ontology-fold regression test")
print("=" * 70)

if not getattr(main, "_HAS_FUSION", False) or main._fusion_engine is None:
    print("  fusion engine not available in this build — cannot run test")
    sys.exit(1)

fe = main._fusion_engine
test_tag = uuid.uuid4().hex[:8]

# Real startup_event() wires this same callback, but it also makes real
# outbound network calls (sanctions_loader's OpenSanctions download, etc.)
# a test must not depend on — main._fusion_fire_callback was pulled out to
# module level specifically so it can be registered directly here instead,
# exercising the exact real callback the running app uses.
_prior_callback = fe._fire_callback
fe.set_fire_callback(main._fusion_fire_callback)


def _random_remote_point(seed: str, lat_box: float, lon_box: float, spread: float = 8.0):
    h = int(hashlib.sha256(f"{test_tag}:{seed}".encode()).hexdigest(), 16)
    lat_frac = (h % 100_000) / 100_000.0
    lon_frac = ((h // 100_000) % 100_000) / 100_000.0
    return round(lat_box - lat_frac * spread, 3), round(lon_box - lon_frac * spread, 3)


LAT, LON = _random_remote_point("ontology_fold", lat_box=-50.0, lon_box=100.0)
LOC = f"TEST SYNTHETIC LOCATION {test_tag} (AUTOMATED TEST — SAFE TO DELETE)"

# ── Seed a real, clearly-tagged test ontology node near the fusion location ──
# so _find_nearby_entities() (the real 150km lookup) has something real to
# find — without this, _auto_add_correlation_to_ontology() would legitimately
# no-op (it returns early when related_entities is empty, exactly as
# designed) and the test would prove nothing either way.
test_node_id = f"test_node_{test_tag}"
ontology_before = main._forge_ontology_load()
ontology_before.setdefault("nodes", []).append({
    "id": test_node_id, "type": "test_node",
    "label": f"TEST ONTOLOGY NODE {test_tag} (AUTOMATED TEST — SAFE TO DELETE)",
    "lat": LAT, "lng": LON, "source": "test:ontology_fold",
})
main._forge_ontology_save(ontology_before)

correlations_before = len(main._correlation_assessments)

sig_ais = main.normalize_signal("AIS", {
    "severity": "critical", "lat": LAT, "lon": LON, "location_name": LOC, "country": None,
    "rule_id": "test_ontology_fold_ais", "rule_name": "TEST_AIS_ANOMALY",
    "title": f"[TEST {test_tag}] synthetic AIS anomaly, ontology-fold scenario",
})
sig_ais["signal_id"] = f"TEST-ONTOFOLD-AIS-{test_tag}"

sig_news = main.normalize_signal("NEWS", {
    "severity": "critical", "lat": LAT, "lon": LON, "location_name": LOC, "country": None,
    "rule_id": "test_ontology_fold_news", "rule_name": "TEST_NEWS_ASSESSMENT",
    "title": f"[TEST {test_tag}] synthetic news assessment, ontology-fold scenario",
})
sig_news["signal_id"] = f"TEST-ONTOFOLD-NEWS-{test_tag}"

geo_key = fe._resolve_geo_key(sig_ais)

with patch("anthropic.Anthropic") as MockAnthropic:
    instance = MockAnthropic.return_value
    instance.messages.create.side_effect = lambda **kwargs: _mock_msg(CLEAN_JSON)

    print("1. a real critical-severity, 2-domain fusion event is created")
    fe.on_signal(sig_ais)
    fe.on_signal(sig_news)

    fusions = [f for f in fe.active_fusions.values() if f.get("geo_key") == geo_key]
    check("fusion event was created", len(fusions) == 1, f"fusions={fusions}")
    fusion_id = fusions[0]["fusion_id"] if fusions else None
    check("the fusion event's real composite severity is 'critical' (both contributing signals were critical)",
          fusions and fusions[0].get("severity") == "critical", fusions)

    print("2. main._correlation_assessments got a real new entry for this HIGH/CRITICAL fusion")
    correlations_after = len(main._correlation_assessments)
    check("exactly one new correlation-assessment entry was appended",
          correlations_after == correlations_before + 1,
          f"before={correlations_before} after={correlations_after}")

    new_assessment = main._correlation_assessments[-1] if main._correlation_assessments else None
    check("the new assessment references the real fusion_id",
          new_assessment and new_assessment.get("fusion_id") == fusion_id, new_assessment)
    check("the new assessment's severity is the real uppercased fusion severity ('CRITICAL')",
          new_assessment and new_assessment.get("severity") == "CRITICAL", new_assessment)

    print("3. forge_ontology.json got a real new 'correlation' node + edge to the real nearby test node")
    ontology_after = main._forge_ontology_load()
    corr_nodes = [n for n in ontology_after.get("nodes", [])
                  if n.get("type") == "correlation" and n.get("severity") == "CRITICAL"
                  and abs((n.get("lat") or 0) - LAT) < 0.01 and abs((n.get("lng") or 0) - LON) < 0.01]
    check("a real correlation node was added at the fusion's real location",
          len(corr_nodes) >= 1, f"matching nodes={corr_nodes}")

    corr_node_id = corr_nodes[0]["id"] if corr_nodes else None
    edges_to_test_node = [e for e in ontology_after.get("edges", [])
                          if e.get("type") == "correlates_with" and e.get("target") == test_node_id
                          and e.get("source") == corr_node_id]
    check("a real edge links the new correlation node to the real nearby test ontology node",
          len(edges_to_test_node) == 1, f"edges={edges_to_test_node}")

# ── Cleanup ──────────────────────────────────────────────────────────────
if fusion_id:
    try:
        main.api_fusions_delete(fusion_id)
        print(f"  [cleanup] resolved test fusion {fusion_id} via /api/fusions/{{id}} DELETE handler")
    except Exception as _cleanup_err:
        print(f"  [cleanup] could not resolve {fusion_id}: {_cleanup_err}")

fe.active_signals.pop(geo_key, None)
for fdict in list(fe.active_fusions.values()):
    if fdict.get("geo_key") == geo_key:
        fe.active_fusions.pop(fdict["fusion_id"], None)
for sid in (sig_ais["signal_id"], sig_news["signal_id"]):
    fe.signal_to_fusion.pop(sid, None)
fe.set_fire_callback(_prior_callback)

# Remove the test ontology node and the correlation node/edge this test added.
ontology_final = main._forge_ontology_load()
ontology_final["nodes"] = [
    n for n in ontology_final.get("nodes", [])
    if n.get("id") != test_node_id and not (n.get("type") == "correlation" and n.get("id") in
        {n2["id"] for n2 in ontology_after.get("nodes", []) if n2.get("type") == "correlation"
         and abs((n2.get("lat") or 0) - LAT) < 0.01 and abs((n2.get("lng") or 0) - LON) < 0.01})
]
ontology_final["edges"] = [
    e for e in ontology_final.get("edges", [])
    if e.get("target") != test_node_id and e.get("source") != test_node_id
]
main._forge_ontology_save(ontology_final)
print(f"  [cleanup] removed test ontology node {test_node_id} and its correlation node/edge")

print("=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
else:
    print("  RESULT: ALL CHECKS PASSED")
print("=" * 70)

if __name__ == "__main__":
    sys.exit(1 if FAILURES else 0)
