"""Tests for PARALLAX addendum §A4–§A7 — the rules that decide whether
something interrupts an analyst. Each test names the acceptance criterion in
§A13 it holds down."""
import math
import time

import alerts_derived as D

NOW = 1_700_000_000.0
DAY = D.DAY


def rec(i, *, lat=12.5, lon=43.3, days_ago=1.0, cat="maritime", place="Bab el-Mandeb"):
    return {"id": f"GC-{i}", "lat": lat, "lon": lon, "ts": NOW - days_ago * DAY,
            "cat": cat, "place": place, "title": f"Vessel attacked {i}"}


# ── §A4 the cell ──────────────────────────────────────────────────────────

def test_cell_groups_one_event_and_separates_distant_ports():
    """2.5° must be big enough that two reports of one event land together
    and small enough that Rotterdam and Marseille never do."""
    assert D.cell_of(12.58, 43.33) == D.cell_of(12.70, 43.45)
    rotterdam, marseille = (51.9, 4.5), (43.3, 5.4)
    assert D.cell_of(*rotterdam) != D.cell_of(*marseille)


def test_cell_is_never_shown_to_the_analyst():
    """The name is a real place, or a DMS centroid — never the cell key."""
    cell = D.cell_of(12.58, 43.33)
    assert D.cell_name(cell, [{"place": "Bab el-Mandeb, Yemen"}]) == "Bab el-Mandeb"
    fallback = D.cell_name(cell, [{"place": ""}])
    assert ":" not in fallback and "°" in fallback


# ── §A5 surge ─────────────────────────────────────────────────────────────

def test_surge_uses_a_poisson_tail_not_a_ratio():
    """A jump from 0→3 must not be treated like 40→120."""
    # 4 against a baseline of ~0 is improbable; 120 against 40 is a real
    # change but both must come back as probabilities, not multiples.
    assert D.poisson_tail(4, 0.05) < 0.001
    assert D.poisson_tail(120, 40) <= 1e-6   # clamped floor: never exactly 0
    assert D.poisson_tail(1, 1.0) > 0.5          # utterly ordinary
    assert D.poisson_tail(0, 5.0) == 1.0


def test_three_points_is_a_coincidence():
    """min 4 records — the spec's own words."""
    three = [rec(i) for i in range(3)]
    assert D.detect_surges(three, NOW) == []
    four = [rec(i) for i in range(4)]
    assert len(D.detect_surges(four, NOW)) == 1


def test_surge_is_measured_against_the_same_cell_and_category():
    """Twelve maritime confirmations is quiet for a busy cell. The same
    twelve in a cell with no history is the finding."""
    quiet_cell = [rec(i, days_ago=1) for i in range(12)]
    busy_history = quiet_cell + [
        rec(1000 + i, days_ago=8 + (i % 80)) for i in range(400)
    ]
    assert len(D.detect_surges(quiet_cell, NOW)) == 1
    assert D.detect_surges(busy_history, NOW) == []


def test_a_surge_in_one_category_is_not_a_surge_in_another():
    """Baselines are per category: a maritime spike must not be diluted by
    an unrelated air history in the same cell."""
    rows = [rec(i, cat="maritime", days_ago=1) for i in range(6)]
    rows += [rec(500 + i, cat="air", days_ago=8 + (i % 80)) for i in range(300)]
    out = D.detect_surges(rows, NOW)
    assert [s["cat"] for s in out] == ["maritime"]


def test_uncategorised_records_never_raise_a_surge():
    """A guessed category does not mislabel a pin, it manufactures a trend."""
    rows = [dict(rec(i), cat=None) for i in range(20)]
    assert D.detect_surges(rows, NOW) == []


def test_multiplier_against_no_history_is_none_not_infinity():
    """§A10/§A13 — 'no prior activity in this cell', never '×∞'."""
    s = D.detect_surges([rec(i) for i in range(6)], NOW)[0]
    assert s["mult"] is None
    n = D.surge_notification(s)
    assert "no prior activity in this cell" in n["sub"]
    assert "∞" not in n["sub"] and "×" not in n["sub"]


def test_multiplier_is_reported_when_there_is_a_real_baseline():
    rows = [rec(i, days_ago=1) for i in range(30)]
    rows += [rec(900 + i, days_ago=10 + (i % 80)) for i in range(60)]
    out = D.detect_surges(rows, NOW)
    assert out, "a genuine 30-vs-baseline spike must still be found"
    assert out[0]["mult"] and out[0]["mult"] > 1
    assert "×" in D.surge_notification(out[0])["sub"]


def test_surge_copy_says_attention_never_a_confirmed_event():
    """§A13 — surge copy must not imply something happened on the ground."""
    n = D.surge_notification(D.detect_surges([rec(i) for i in range(6)], NOW)[0])
    blob = (n["title"] + " " + n["sub"]).lower()
    assert "reporting" in blob
    for claim in ("attack", "struck", "destroyed", "confirmed strike"):
        assert claim not in blob


def test_surge_names_the_records_that_triggered_it():
    """§A9 — a derived mark that cannot name its inputs is asking to be
    taken on faith."""
    s = D.detect_surges([rec(i) for i in range(6)], NOW)[0]
    assert len(s["rows"]) == 6
    assert D.ontology_record(s)["source_ref"] == [f"GC-{i}" for i in range(6)][::-1] or \
           sorted(D.ontology_record(s)["source_ref"]) == sorted(f"GC-{i}" for i in range(6))


# ── §A6 fusion ────────────────────────────────────────────────────────────

def item(mod, *, lat=26.5, lon=56.2, hours_ago=5, label="thing", ref=None):
    return {"lat": lat, "lon": lon, "ts": NOW - hours_ago * D.HOUR,
            "mod": mod, "label": label, "ref": ref or f"{mod}-1"}


def test_fusion_requires_two_distinct_modalities():
    """§A13 — two records of ONE kind never qualifies, however many."""
    one_kind = [item("confirmation", ref=f"c{i}") for i in range(9)]
    assert D.detect_fusions(one_kind, NOW) == []
    two_kinds = one_kind[:1] + [item("imagery")]
    assert len(D.detect_fusions(two_kinds, NOW)) == 1


def test_breadth_of_kind_outranks_volume():
    """strength = modalities + min(3, records/4): a third modality must beat
    any pile of records of two kinds."""
    broad = [item("confirmation", lat=26.5, lon=56.2, ref="a"),
             item("imagery", lat=26.5, lon=56.2, ref="b"),
             item("ais", lat=26.5, lon=56.2, ref="c")]
    deep = [item("confirmation", lat=-30.0, lon=-70.0, ref=f"d{i}") for i in range(20)]
    deep += [item("signal", lat=-30.0, lon=-70.0, ref=f"e{i}") for i in range(20)]
    out = D.detect_fusions(broad + deep, NOW)
    assert out[0]["mods"] == ["ais", "confirmation", "imagery"]


def test_fusion_ignores_records_outside_the_window():
    stale = [item("confirmation", hours_ago=24 * 9), item("imagery", hours_ago=24 * 9)]
    assert D.detect_fusions(stale, NOW) == []


def test_fusion_severity_escalates_with_independent_kinds():
    two = D.detect_fusions([item("confirmation"), item("imagery")], NOW)[0]
    three = D.detect_fusions(
        [item("confirmation"), item("imagery"), item("ais")], NOW)[0]
    assert D.fusion_notification(two)["sev"] == "high"
    assert D.fusion_notification(three)["sev"] == "critical"


def test_fusion_notification_names_its_modalities_and_span():
    f = D.detect_fusions([item("confirmation", hours_ago=2),
                          item("imagery", hours_ago=33)], NOW)[0]
    n = D.fusion_notification(f)
    assert "confirmed incident + satellite imagery" in n["sub"]
    assert "31h" in n["sub"]


# ── §A7 evaluate at the playhead ──────────────────────────────────────────

def test_detection_is_evaluated_at_the_playhead_not_wall_clock():
    """The same records must surge when the playhead sits in August and fall
    silent when it sits before the episode."""
    episode = [rec(i, days_ago=1) for i in range(8)]
    assert len(D.detect_surges(episode, NOW)) == 1
    earlier = NOW - 40 * DAY
    assert D.detect_surges(episode, earlier) == [], \
        "records in the playhead's future must not count"


def test_records_after_the_playhead_are_never_counted():
    future = [rec(i, days_ago=-3) for i in range(9)]
    assert D.detect_surges(future, NOW) == []
    assert D.detect_fusions(
        [item("confirmation", hours_ago=-5), item("imagery", hours_ago=-5)], NOW) == []


# ── §A12 provenance ───────────────────────────────────────────────────────

def test_every_derived_finding_is_an_ontology_instance():
    """Rule 4 — nothing reaches a view without an ontology record."""
    s = D.detect_surges([rec(i) for i in range(6)], NOW)[0]
    f = D.detect_fusions([item("confirmation"), item("imagery")], NOW)[0]
    for r in (D.ontology_record(s), D.ontology_record(f)):
        assert r["origin_class"] == "D", "derived, not promoted to its inputs' class"
        assert r["licence_tier"] == "T3"
        assert r["source_ref"], "a finding that cannot name its inputs breaks the chain"
        assert r["edges"] == ["mentioned_with"]



def test_two_kinds_of_traffic_are_not_a_fusion():
    """A sanctioned tanker and a military flight in the same region is
    traffic, not an event."""
    assert D.detect_fusions([item("ais"), item("aircraft")], NOW) == []


def test_evidence_far_apart_or_days_apart_is_not_one_fusion():
    assert D.detect_fusions([item("confirmation"), item("imagery", lon=57.5)], NOW) == []      # ~130 km
    assert D.detect_fusions([item("confirmation", hours_ago=2), item("imagery", hours_ago=80)], NOW) == []


def test_a_fusion_explains_itself():
    f = D.detect_fusions([item("confirmation", label="Strike on the port", ref="c1"),
                          item("heat", lat=26.55, label="New heat (84 MW)", hours_ago=3, ref="h1")], NOW)[0]
    assert f["headline"] == "Strike on the port"
    assert any("heat detection: New heat (84 MW) — 5.6 km, 2 h after" == e for e in f["explain"])



def test_tracking_corroborates_only_when_right_there():
    far = D.detect_fusions([item("confirmation"), item("aircraft", lat=26.7)], NOW)      # ~22 km
    near = D.detect_fusions([item("confirmation"), item("aircraft", lat=26.55)], NOW)    # ~5.6 km
    assert far == [] and len(near) == 1
