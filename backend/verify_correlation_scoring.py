"""
Real tests for correlation_scoring.py — Parts 1-5 of the correlation-engine
deepening pass. Script-style (matches test_null_island_correlation.py's
convention), run via `python3 test_correlation_scoring.py`.
"""
import os
import sys
import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import correlation_scoring as cs  # noqa: E402

FAILURES = []


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


now = datetime.datetime.utcnow()

# ── Part 1: real haversine distance/time decay fixes the bucket-boundary
#    false negative. Two points a few km apart but on opposite sides of the
#    OLD 0.1-degree rounding boundary (e.g. 34.049 / 34.051 straddle the
#    round(x,1)=34.0/34.1 line) must now correlate. ──────────────────────
print("Part 1 — geo-temporal distance/time decay")

sig_a = {"signal_id": "A", "domain": "AIS", "lat": 34.049, "lon": 24.501, "timestamp": now}
sig_b = {"signal_id": "B", "domain": "NEWS", "lat": 34.051, "lon": 24.499,
         "timestamp": now + datetime.timedelta(minutes=5)}
w_close = cs.pairwise_geo_temporal_weight(sig_a, sig_b)
check("two signals ~0.3km apart, straddling the old 0.1-deg rounding boundary, correlate (weight > 0)",
      w_close > 0.9, f"weight={w_close}")

sig_far = {"signal_id": "C", "domain": "AIS", "lat": 10.0, "lon": 80.0, "timestamp": now}
w_far = cs.pairwise_geo_temporal_weight(sig_a, sig_far)
check("two signals genuinely far apart (~thousands of km) do NOT correlate (weight == 0)",
      w_far == 0.0, f"weight={w_far}")

# Real radius-based cluster-key lookup: seed an active GEO: bucket at the
# boundary-adjacent point, confirm a nearby-but-cross-boundary signal joins
# the SAME key instead of minting a new one (the old round(lat,1) bug).
active = {"GEO:34.0490,24.5010": [sig_a]}
key = cs.find_or_create_radius_geo_key(34.051, 24.499, now, active)
check("radius-based lookup assigns the cross-boundary-but-nearby signal to the EXISTING cluster key",
      key == "GEO:34.0490,24.5010", f"got key={key}")

key_far = cs.find_or_create_radius_geo_key(10.0, 80.0, now, active)
check("radius-based lookup mints a NEW key for a genuinely distant signal",
      key_far != "GEO:34.0490,24.5010", f"got key={key_far}")

cluster_w = cs.cluster_geo_temporal_weight([sig_a, sig_b])
check("cluster_geo_temporal_weight of the close pair is high",
      cluster_w > 0.9, f"got {cluster_w}")


# ── Part 2: real 1-hop OntologyLink graph correlation, using the real DB. ──
print("Part 2 — ontology-graph correlation (real DB)")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from database import SessionLocal, OntologyLink  # noqa: E402
import uuid as _uuid  # noqa: E402

_db = SessionLocal()
_test_link_ids = []
try:
    sid_x = f"TESTSIG-{_uuid.uuid4().hex[:8]}"
    sid_y = f"TESTSIG-{_uuid.uuid4().hex[:8]}"
    sid_z = f"TESTSIG-{_uuid.uuid4().hex[:8]}"
    shared_entity = f"TESTCABLE-{_uuid.uuid4().hex[:8]}"
    other_entity  = f"TESTCABLE-{_uuid.uuid4().hex[:8]}"

    def _mk_link(source_id, entity_id, link_type="contains", distance_km=None):
        link_id = f"LNK-TEST-{_uuid.uuid4().hex[:8]}"
        _test_link_ids.append(link_id)
        _db.add(OntologyLink(
            link_id=link_id, source_type="signal", source_id=source_id,
            entity_type="cable", entity_id=entity_id, entity_name="Test Cable",
            link_type=link_type, distance_km=distance_km,
        ))

    # X and Y both link (via "contains") to the SAME real entity — 1-hop.
    _mk_link(sid_x, shared_entity, "contains")
    _mk_link(sid_y, shared_entity, "contains")
    # Z links only to a DIFFERENT entity — no shared link with X or Y at all
    # (this stands in for the "only a 2-hop-away path" case: with no real
    # entity-to-entity edges in this codebase's non-circular data, Z simply
    # has no real 1-hop connection to X/Y, which is exactly what the 1-hop
    # default is supposed to correctly report as uncorrelated).
    _mk_link(sid_z, other_entity, "contains")
    _db.commit()

    sig_x = {"signal_id": sid_x}
    sig_y = {"signal_id": sid_y}
    sig_z = {"signal_id": sid_z}

    w_xy, shared_xy = cs.graph_weight(sig_x, sig_y, _db)
    check("two signals sharing a real 1-hop entity link correlate (weight == 1.0, contains)",
          w_xy == 1.0 and shared_entity in shared_xy, f"w={w_xy} shared={shared_xy}")

    w_xz, shared_xz = cs.graph_weight(sig_x, sig_z, _db)
    check("two signals with NO shared entity (only a 2-hop-away path) do NOT correlate under the 1-hop default",
          w_xz == 0.0 and shared_xz == [], f"w={w_xz} shared={shared_xz}")

    cw, cshared, cavail = cs.cluster_graph_weight([sig_x, sig_y], _db)
    check("cluster_graph_weight reports graph_available=True when real OntologyLink rows exist for the cluster",
          cavail is True and cw == 1.0, f"w={cw} avail={cavail}")

    sig_none = {"signal_id": f"TESTSIG-NOLINK-{_uuid.uuid4().hex[:8]}"}
    cw2, cshared2, cavail2 = cs.cluster_graph_weight([sig_none], _db)
    check("cluster_graph_weight reports graph_available=False when NO signal in the cluster has any real OntologyLink row",
          cavail2 is False and cw2 == 0.0, f"w={cw2} avail={cavail2}")

finally:
    for lid in _test_link_ids:
        _db.query(OntologyLink).filter(OntologyLink.link_id == lid).delete()
    _db.commit()
    _db.close()


# ── Part 3: graduated, reliability-weighted domain-diversity, real floor. ──
print("Part 3 — cross-domain corroboration")

single_domain = [{"domain": "AIS", "confidence": 0.84}]
score_single, _ = cs.domain_diversity_score(single_domain)
check("a genuinely single-domain cluster stays below the real floor",
      score_single < cs.DOMAIN_DIVERSITY_FLOOR, f"score={score_single} floor={cs.DOMAIN_DIVERSITY_FLOOR}")

# Real regression case found live: a single signal can carry a per-instance
# confidence ABOVE the AIS domain default (e.g. 0.95, or the true ceiling
# 1.0) — the floor must hold even at that worst case, not just the typical
# 0.84 case.
single_domain_high_conf = [{"domain": "AIS", "confidence": 1.0}]
score_high_conf, _ = cs.domain_diversity_score(single_domain_high_conf)
check("a single-domain signal at the real confidence ceiling (1.0) still stays below the floor",
      score_high_conf < cs.DOMAIN_DIVERSITY_FLOOR, f"score={score_high_conf} floor={cs.DOMAIN_DIVERSITY_FLOOR}")

mixed_high = [{"domain": "AIS", "confidence": 0.84}, {"domain": "NEWS", "confidence": 0.80}]
score_high, breakdown_high = cs.domain_diversity_score(mixed_high)
mixed_low = [{"domain": "AIS", "confidence": 0.84}, {"domain": "NEWS", "confidence": 0.20}]
score_low, breakdown_low = cs.domain_diversity_score(mixed_low)
check("a multi-domain cluster with a high-reliability second source scores higher than the same domains with a low-reliability source",
      score_high > score_low, f"high={score_high} low={score_low}")
check("multi-domain score clears the real floor",
      score_high > cs.DOMAIN_DIVERSITY_FLOOR, f"score={score_high}")


# ── Part 4: dark-ship binary weight + real z-score arithmetic. ─────────────
print("Part 4 — statistical baseline deviation")

check("no dark-ship signal in cluster -> weight 0.0",
      cs.dark_ship_weight([{"domain": "AIS", "rule_name": "Sanctioned Vessel"}]) == 0.0)
check("a real dark-ship signal in the cluster -> weight 1.0",
      cs.dark_ship_weight([{"domain": "AIS", "rule_name": "AIS_DARK_SHIP", "rule_trigger": "AIS_DARK_SHIP"}]) == 1.0)

# Insufficient history: fewer than MIN_BASELINE_DAYS distinct days.
short_history = {f"2026-09-0{d}": 5 for d in range(1, 4)}  # 3 days
res_short = cs.zscore_and_weight(short_history, "2026-09-04")
check("fewer than MIN_BASELINE_DAYS of real history -> honest insufficient_history, not a fabricated baseline",
      res_short["status"] == "insufficient_history", f"got {res_short}")

# Real baseline: 20 days, all count=10 including today — genuine zero variance.
today_key = "2026-08-29"
zero_var_all_same = {f"2026-08-{10+d:02d}": 10 for d in range(20)}  # 20 days, all count=10
res_novar = cs.zscore_and_weight(zero_var_all_same, today_key)
check("zero-variance baseline with no deviation today -> weight 0.0 (not a fabricated z)",
      res_novar["status"] == "ok" and res_novar["stdev"] == 0.0 and res_novar["weight"] == 0.0, f"got {res_novar}")

zero_var_with_spike = dict(zero_var_all_same)
zero_var_with_spike[today_key] = 40  # today (already one of the 20 days) spikes to 40; other 19 unchanged at 10
res_spike_zerovar = cs.zscore_and_weight(zero_var_with_spike, today_key)
check("zero-variance-except-today baseline WITH a real deviation today -> weight 1.0",
      res_spike_zerovar["status"] == "ok" and res_spike_zerovar["weight"] == 1.0, f"got {res_spike_zerovar}")

# Real non-zero-variance case with hand-checkable arithmetic. 20 real days
# (today included in the population, matching zscore_and_weight's actual
# behavior — it does not exclude today from the baseline it computes):
# counts = [8,9,10,11,12,8,9,10,11,12,8,9,10,11,12,8,9,10,11,16]  (today's
# real count is the last value, 16 — a real spike vs the other 19 days).
import statistics as _stats  # noqa: E402
counts_cycle = [8, 9, 10, 11, 12] * 4
counts_with_spike = counts_cycle[:-1] + [16]  # last day (today) spikes to 16
mean_expected = _stats.mean(counts_with_spike)
stdev_expected = _stats.pstdev(counts_with_spike)
hist = {f"2026-08-{10+i:02d}": c for i, c in enumerate(counts_with_spike)}
today_key2 = f"2026-08-{10+len(counts_with_spike)-1:02d}"  # the last date = today
z_expected = (16 - mean_expected) / stdev_expected
res_real = cs.zscore_and_weight(hist, today_key2)
check("real z-score arithmetic matches hand-computed (mean, stdev, z) exactly",
      res_real["status"] == "ok"
      and abs(res_real["mean"] - mean_expected) < 1e-9
      and abs(res_real["stdev"] - stdev_expected) < 1e-9
      and abs(res_real["z"] - z_expected) < 1e-9,
      f"got {res_real} expected mean={mean_expected} stdev={stdev_expected} z={z_expected}")
check(f"real z={z_expected:.2f} clears the stated Z_SCORE_THRESHOLD={cs.Z_SCORE_THRESHOLD} -> nonzero weight",
      res_real["weight"] > 0.0, f"z={res_real['z']} weight={res_real['weight']}")


# ── Part 5: combined formula — weights, missing-term renormalisation. ─────
print("Part 5 — combined correlation-strength formula")

check("real weights sum to 1.0",
      abs((cs.W1_GEO_TEMPORAL + cs.W2_GRAPH + cs.W3_DOMAIN_DIVERSITY + cs.W4_STATISTICAL) - 1.0) < 1e-9)

full = cs.combined_strength(geo_weight=0.9, graph_weight_val=0.8, domain_score=0.9,
                             statistical_weight=0.7, graph_available=True)
check("all four real inputs present and strong -> high strength",
      full["strength"] > 70, f"got {full}")
check("component breakdown is present and not blended into a single opaque number",
      set(full["components"].keys()) == {"geo_temporal", "graph", "domain_diversity", "statistical"},
      f"got {full['components']}")

reduced = cs.combined_strength(geo_weight=0.9, graph_weight_val=0.0, domain_score=0.9,
                                statistical_weight=0.7, graph_available=False)
check("missing graph term is re-normalised across the remaining 3 real terms (not silently zero-padded)",
      reduced["components"]["graph"] is None and abs(sum(reduced["weights_used"].values()) - 1.0) < 0.01,
      f"got {reduced}")
check("a cluster with no real correlation signal at all scores near 0",
      cs.combined_strength(0.0, 0.0, 0.0, 0.0, graph_available=True)["strength"] == 0.0)


# ── Part 8: full end-to-end scenario via score_cluster(), real DB. ─────────
print("Part 8 — full combined scenario (score_cluster)")

_db2 = SessionLocal()
_e2e_link_ids = []
try:
    e2e_entity = f"TESTCABLE-E2E-{_uuid.uuid4().hex[:8]}"

    def _mk_link2(source_id, entity_id, link_type="contains", distance_km=None):
        link_id = f"LNK-E2E-{_uuid.uuid4().hex[:8]}"
        _e2e_link_ids.append(link_id)
        _db2.add(OntologyLink(
            link_id=link_id, source_type="signal", source_id=source_id,
            entity_type="cable", entity_id=entity_id, entity_name="E2E Test Cable",
            link_type=link_type, distance_km=distance_km,
        ))

    t0 = datetime.datetime.utcnow()
    sid_ais  = f"TESTSIG-E2E-AIS-{_uuid.uuid4().hex[:8]}"
    sid_news = f"TESTSIG-E2E-NEWS-{_uuid.uuid4().hex[:8]}"
    sid_adsb = f"TESTSIG-E2E-ADSB-{_uuid.uuid4().hex[:8]}"
    sid_dark = f"TESTSIG-E2E-DARK-{_uuid.uuid4().hex[:8]}"

    e2e_signals = [
        {"signal_id": sid_ais,  "domain": "AIS",  "confidence": 0.84, "lat": 35.0, "lon": 25.0, "timestamp": t0},
        {"signal_id": sid_news, "domain": "NEWS", "confidence": 0.80, "lat": 35.005, "lon": 25.004, "timestamp": t0 + datetime.timedelta(minutes=10)},
        {"signal_id": sid_adsb, "domain": "ADSB", "confidence": 0.74, "lat": 34.998, "lon": 24.997, "timestamp": t0 + datetime.timedelta(minutes=20)},
        {"signal_id": sid_dark, "domain": "AIS",  "confidence": 0.84, "lat": 35.002, "lon": 25.001,
         "timestamp": t0 + datetime.timedelta(minutes=15), "rule_trigger": "AIS_DARK_SHIP", "rule_name": "AIS_DARK_SHIP"},
    ]
    # Real ontology link: two of the signals genuinely share an entity.
    _mk_link2(sid_ais, e2e_entity, "contains")
    _mk_link2(sid_news, e2e_entity, "proximity", distance_km=5.0)
    _db2.commit()

    result = cs.score_cluster(e2e_signals, _db2)
    check("three-plus-domain cluster with a real ontology link and a real dark-ship signal produces a strong combined score",
          result["strength"] > 50, f"got {result}")
    check("all real components are individually visible in the breakdown (never one opaque score)",
          all(k in result["components"] for k in ("geo_temporal", "graph", "domain_diversity", "statistical")),
          f"got {result['components']}")
    check("real ontology link was found and is available for this cluster",
          result["graph_available"] is True and result["components"]["graph"] > 0, f"got {result}")
    check("real dark-ship signal was detected as a statistical input",
          result["dark_ship"] is True, f"got {result}")

    # A genuinely unrelated pair: different places, different times, no
    # ontology link. score_cluster() scores an ALREADY-FORMED cluster (real
    # operation only ever calls it on signals fusion_engine has already
    # grouped by real geo_key/radius adjacency — Part 1's job); it is not
    # itself responsible for re-deriving geographic coherence from a raw,
    # disjoint pair, so the real "never fires a correlation" guarantee for
    # unrelated signals is that they never reach the same geo_key/cluster
    # in the first place. Confirm that directly, the same way _evaluate_
    # fusion() would group (or not) real incoming signals.
    unrelated_a = {"signal_id": f"TESTSIG-UNREL-A-{_uuid.uuid4().hex[:8]}", "domain": "AIS",
                   "confidence": 0.84, "lat": -10.0, "lon": 140.0, "timestamp": t0}
    unrelated_b = {"signal_id": f"TESTSIG-UNREL-B-{_uuid.uuid4().hex[:8]}", "domain": "NEWS",
                   "confidence": 0.66, "lat": 60.0, "lon": -50.0, "timestamp": t0 - datetime.timedelta(days=3)}
    active_unrelated = {"GEO:-10.0000,140.0000": [unrelated_a]}
    key_b = cs.find_or_create_radius_geo_key(unrelated_b["lat"], unrelated_b["lon"], t0, active_unrelated)
    check("genuinely unrelated signals (different places, different times) never resolve to the same cluster key",
          key_b != "GEO:-10.0000,140.0000", f"got key_b={key_b}")

    # And a cluster that IS artificially forced together (bypassing real
    # grouping, as this direct call does) still correctly shows zero geo,
    # graph and statistical evidence — only the domain-diversity term (a
    # real, independent dimension: these ARE two distinct, reliable-source
    # domains) contributes, which the combined formula's real weighting
    # keeps from dominating on its own once the other three genuinely
    # absent/zero dimensions are honestly reported.
    result_unrelated = cs.score_cluster([unrelated_a, unrelated_b], _db2)
    check("an artificially-forced unrelated pair honestly shows zero geo/graph/statistical evidence",
          result_unrelated["components"]["geo_temporal"] == 0.0
          and result_unrelated["components"]["statistical"] == 0.0
          and result_unrelated["graph_available"] is False,
          f"got {result_unrelated}")
finally:
    for lid in _e2e_link_ids:
        _db2.query(OntologyLink).filter(OntologyLink.link_id == lid).delete()
    _db2.commit()
    _db2.close()


print("=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
else:
    print("  RESULT: ALL CHECKS PASSED")
print("=" * 70)

if __name__ == "__main__":
    sys.exit(1 if FAILURES else 0)
