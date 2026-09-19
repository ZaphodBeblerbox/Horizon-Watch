"""
test_scan_changes.py — change detection has to survive the wobble a real
sensor has, without hiding a real change inside that tolerance.

The failure this guards against is specific and would be silent: two scans
of an unchanged scene reporting every object as both "gone" and "new",
burying the one thing that did change under a scene-sized false alarm.

    cd backend && python3 -m pytest test_scan_changes.py -q
"""
import pytest

import scan_changes as sc


def det(lat, lon, kind="vessel", conf=0.8):
    return {"centroid_lat": lat, "centroid_lon": lon,
            "object_type": kind, "confidence": conf}


# ── the noise floor ───────────────────────────────────────────────────────

def test_an_unchanged_scene_reports_no_change():
    """The headline property. Two passes over the same ships must not
    manufacture a scene full of arrivals and departures."""
    scene = [det(25.30, 56.37), det(25.31, 56.38), det(25.32, 56.39)]
    out = sc.diff_detections(scene, [dict(d) for d in scene], m_per_px=10.0)
    assert out["summary"] == {"new": 0, "gone": 0, "persisted": 3,
                              "moved": 0, "unconfirmed": 0}
    assert "no change" in out["headline"]


def test_sensor_wobble_is_not_reported_as_movement():
    """Successive passes land a box a few pixels over. That is the sensor,
    not the ship."""
    before = [det(25.30000, 56.37000)]
    after = [det(25.30010, 56.37010)]      # ~15m — inside the noise floor
    out = sc.diff_detections(before, after, m_per_px=10.0)
    assert out["summary"]["persisted"] == 1
    assert out["summary"]["moved"] == 0
    assert out["summary"]["new"] == 0 and out["summary"]["gone"] == 0


def test_a_ship_that_actually_relocated_is_reported_as_moved():
    before = [det(25.30, 56.37)]
    after = [det(25.3050, 56.3750)]        # ~700m — a real relocation
    out = sc.diff_detections(before, after, m_per_px=10.0)
    assert out["summary"]["moved"] + out["summary"]["new"] >= 1
    assert out["summary"]["persisted"] == 0


def test_the_match_radius_follows_the_scans_own_resolution():
    """An object on a 100 m/px image cannot be located to 25m, whatever the
    stored decimals imply."""
    assert sc.match_radius_m(10.0) < sc.match_radius_m(50.0)
    assert sc.match_radius_m(0.5) >= sc.MIN_MATCH_RADIUS_M   # floored
    assert sc.match_radius_m(10_000) <= sc.MAX_MATCH_RADIUS_M  # capped


def test_a_coarse_scan_does_not_merge_distinct_objects():
    """The ceiling exists so a bad resolution cannot swallow two real ships
    into one."""
    assert sc.MAX_MATCH_RADIUS_M <= 250.0


# ── the actual findings ───────────────────────────────────────────────────

def test_a_new_vessel_is_found():
    before = [det(25.30, 56.37)]
    after = [det(25.30, 56.37), det(25.35, 56.42)]
    out = sc.diff_detections(before, after, m_per_px=10.0)
    assert out["summary"]["new"] == 1
    assert out["new"][0]["change_type"] == "new"


def test_a_departed_vessel_is_found_and_carried_in_the_result():
    """A departure has no current detection, so it can only appear if the
    diff explicitly carries it — easy to lose, and it is half the signal."""
    before = [det(25.30, 56.37), det(25.35, 56.42)]
    after = [det(25.30, 56.37)]
    out = sc.diff_detections(before, after, m_per_px=10.0)
    assert out["summary"]["gone"] == 1
    assert out["gone"][0]["change_type"] == "gone"
    assert any(d.get("change_type") == "gone" for d in out["all"])


def test_a_tank_where_a_ship_was_is_two_findings_not_a_move():
    """Matching across types would report a departure and an arrival as one
    object that changed nature."""
    before = [det(25.30, 56.37, "vessel")]
    after = [det(25.30, 56.37, "storage_tank")]
    out = sc.diff_detections(before, after, m_per_px=10.0)
    assert out["summary"]["new"] == 1
    assert out["summary"]["gone"] == 1
    assert out["summary"]["persisted"] == 0


def test_one_previous_object_cannot_match_two_current_ones():
    """Otherwise a single ship last week explains two ships this week and
    the arrival is silently lost."""
    before = [det(25.30000, 56.37000)]
    after = [det(25.30000, 56.37000), det(25.30012, 56.37012)]
    out = sc.diff_detections(before, after, m_per_px=10.0)
    assert out["summary"]["new"] == 1
    assert out["summary"]["persisted"] == 1


# ── the first scan ────────────────────────────────────────────────────────

def test_a_first_scan_reports_a_baseline_not_a_scene_full_of_novelty():
    """'12 new vessels' on a first look would render 'we have never been
    here' identically to 'everything here just arrived'."""
    out = sc.diff_detections([], [det(25.30, 56.37), det(25.31, 56.38)],
                             m_per_px=10.0, baseline_exists=False)
    assert out["baseline"] is True
    assert out["summary"]["new"] == 0
    assert out["summary"]["baseline_count"] == 2
    assert all(d["change_type"] == "baseline" for d in out["all"])
    assert "first scan" in out["headline"]


def test_an_empty_previous_scan_with_a_real_baseline_is_genuinely_new():
    """Distinct from the case above: we DID look, and there was nothing."""
    out = sc.diff_detections([], [det(25.30, 56.37)],
                             m_per_px=10.0, baseline_exists=True)
    assert out["baseline"] is False
    assert out["summary"]["new"] == 1


# ── the sentence a person reads ───────────────────────────────────────────

def test_the_headline_names_what_changed_not_just_how_many():
    """A notification carrying only a count makes the reader do the work of
    finding out whether it matters."""
    before = [det(25.30, 56.37, "vessel")]
    after = [det(25.30, 56.37, "vessel"), det(25.35, 56.42, "vessel"),
             det(25.36, 56.43, "storage_tank")]
    line = sc.diff_detections(before, after, m_per_px=10.0)["headline"]
    assert "vessel" in line
    assert "storage tank" in line
    assert "appeared" in line


def test_the_headline_is_readable_english_not_schema_keys():
    before = []
    after = [det(25.30, 56.37, "port_infrastructure")]
    line = sc.diff_detections(before, after, m_per_px=10.0)["headline"]
    assert "port structure" in line
    assert "port_infrastructure" not in line


def test_singular_and_plural_are_both_correct():
    one = sc.diff_detections([], [det(25.3, 56.3)], m_per_px=10.0)["headline"]
    two = sc.diff_detections([], [det(25.3, 56.3), det(25.4, 56.4)],
                             m_per_px=10.0)["headline"]
    assert "1 vessel " in one and "1 vessels" not in one
    assert "2 vessels" in two


def test_departures_are_named_in_the_headline():
    out = sc.diff_detections([det(25.3, 56.3, "storage_tank")], [], m_per_px=10.0)
    assert "no longer present" in out["headline"]
    assert "storage tank" in out["headline"]


# ── how loudly to announce it ─────────────────────────────────────────────

def test_a_vanished_structure_outranks_a_vanished_ship():
    """Ships come and go; a storage tank that was there and is not is
    construction, demolition or damage."""
    ship_gone = sc.diff_detections([det(25.3, 56.3, "vessel")], [], m_per_px=10.0)
    tank_gone = sc.diff_detections([det(25.3, 56.3, "storage_tank")], [], m_per_px=10.0)
    assert sc.severity_for(tank_gone) == "high"
    assert sc.severity_for(ship_gone) == "low"


def test_new_construction_is_notable_but_less_urgent_than_loss():
    built = sc.diff_detections([], [det(25.3, 56.3, "storage_tank")], m_per_px=10.0)
    assert sc.severity_for(built) == "medium"


def test_a_concentration_of_anything_is_notable():
    """Ten of something arriving at once is a finding whatever it is made
    of — the vehicle-concentration case."""
    after = [det(25.30 + i * 0.001, 56.37, "vehicle") for i in range(12)]
    out = sc.diff_detections([], after, m_per_px=10.0)
    assert sc.severity_for(out) == "medium"


def test_an_unchanged_scene_is_not_announced_at_all():
    scene = [det(25.3, 56.3)]
    out = sc.diff_detections(scene, [dict(d) for d in scene], m_per_px=10.0)
    assert sc.severity_for(out) == "info"


# ── stability ─────────────────────────────────────────────────────────────

def test_the_diff_is_symmetric_in_its_own_terms():
    """What is 'new' going forward must be 'gone' going backward, or the
    two directions disagree about what happened."""
    a = [det(25.30, 56.37)]
    b = [det(25.30, 56.37), det(25.35, 56.42)]
    fwd = sc.diff_detections(a, [dict(d) for d in b], m_per_px=10.0)
    rev = sc.diff_detections(b, [dict(d) for d in a], m_per_px=10.0)
    assert fwd["summary"]["new"] == rev["summary"]["gone"] == 1


def test_running_the_same_diff_twice_gives_the_same_answer():
    a = [det(25.30, 56.37), det(25.31, 56.38)]
    b = [det(25.30, 56.37), det(25.35, 56.42)]
    first = sc.diff_detections([dict(d) for d in a], [dict(d) for d in b], m_per_px=10.0)["summary"]
    second = sc.diff_detections([dict(d) for d in a], [dict(d) for d in b], m_per_px=10.0)["summary"]
    assert first == second


def test_unlocated_detections_are_not_dropped():
    out = sc.diff_detections([], [{"object_type": "vessel", "confidence": 0.9}],
                             m_per_px=10.0)
    assert len(out["all"]) == 1


# ── detector instability vs real change ───────────────────────────────────
#
# Found on real imagery, not in theory: two Sentinel-2 passes over Khor
# Fakkan 23 days apart produced "3 storage tanks appeared and 3 vanished" —
# in a tank farm, in three weeks. Every one carried confidence 0.29-0.49.
# The detector was finding a different subset of the same scene each pass and
# the diff was reporting that as events on the ground.

def test_a_weak_detection_appearing_is_not_called_new():
    """Present now, absent before, but too weak to claim it arrived."""
    out = sc.diff_detections([], [det(25.30, 56.37, "storage_tank", conf=0.31)],
                             m_per_px=10.0)
    assert out["summary"]["new"] == 0
    assert out["summary"]["unconfirmed"] == 1
    assert out["unconfirmed"][0]["change_type"] == "unconfirmed"


def test_a_weak_detection_vanishing_is_not_called_gone():
    """Its absence is more likely a missed detection than a departure."""
    out = sc.diff_detections([det(25.30, 56.37, "storage_tank", conf=0.31)], [],
                             m_per_px=10.0)
    assert out["summary"]["gone"] == 0
    assert out["summary"]["unconfirmed"] == 1


def test_a_confident_detection_still_reports_change_normally():
    """The floor must not disable the feature it protects."""
    out = sc.diff_detections([], [det(25.30, 56.37, "storage_tank", conf=0.9)],
                             m_per_px=10.0)
    assert out["summary"]["new"] == 1


def test_structures_need_more_evidence_than_vessels():
    """A ship arriving is routine; a storage tank appearing is construction,
    so it has to clear a higher bar."""
    conf = 0.60
    ship = sc.diff_detections([], [det(25.3, 56.3, "vessel", conf=conf)], m_per_px=10.0)
    tank = sc.diff_detections([], [det(25.3, 56.3, "storage_tank", conf=conf)], m_per_px=10.0)
    assert ship["summary"]["new"] == 1
    assert tank["summary"]["new"] == 0, "a structure passed on vessel-grade evidence"


def test_an_unconfirmed_observation_is_never_silently_dropped():
    """It is a real observation, just not a reportable event — losing it
    would be the same absence-as-silence failure in a new place."""
    out = sc.diff_detections([], [det(25.30, 56.37, "storage_tank", conf=0.31)],
                             m_per_px=10.0)
    assert len(out["unconfirmed"]) == 1
    assert out["unconfirmed"][0]["unconfirmed_reason"]


def test_the_headline_admits_what_it_held_back():
    """Reporting a clean 'no change' while quietly withholding observations
    would be its own kind of dishonesty."""
    out = sc.diff_detections([], [det(25.30, 56.37, "storage_tank", conf=0.31)],
                             m_per_px=10.0)
    assert "weak detection" in out["headline"]


def test_the_real_khor_fakkan_case_no_longer_invents_structural_change():
    """The exact observed data: five weak detections on each side, none of
    which should raise a structural event."""
    before = [det(25.3090, 56.3680, "storage_tank", 0.47),
              det(25.3088, 56.3691, "storage_tank", 0.42),
              det(25.3090, 56.3734, "storage_tank", 0.38),
              det(25.3582, 56.3726, "port_infrastructure", 0.31)]
    after = [det(25.3067, 56.3731, "storage_tank", 0.475),
             det(25.3071, 56.3720, "storage_tank", 0.291),
             det(25.3587, 56.3724, "port_infrastructure", 0.307)]
    out = sc.diff_detections(before, after, m_per_px=10.0)
    assert out["summary"]["new"] == 0, "still inventing new structures from noise"
    assert out["summary"]["gone"] == 0, "still inventing demolitions from noise"
    assert sc.severity_for(out) in ("info", "low"), "still shouting about nothing"
