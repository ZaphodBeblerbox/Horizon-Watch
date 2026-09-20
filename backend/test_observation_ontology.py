"""
test_observation_ontology.py — "we believe X because of Y".

ontology_claims sat with exactly the right columns and zero rows since it
was created. The properties worth pinning are not that rows appear, but
that every row carries the evidence that produced it, that confidence is
inherited rather than invented, and that re-reading a feed does not turn
the store into a measure of uptime.

    cd backend && python3 -m pytest test_observation_ontology.py -q
"""
import json

import observation_ontology as oo

GDELT_POINT = {
    "id": "1323899309",
    "title": "At least 48 people died in clashes in southern Yemen",
    "location_name": "Lahij, Yemen",
    "date": "2026-09-20",
    "source_url": "https://en.apa.az/asia/clashes-southern-yemen",
    "context": "Fight · MILITANT → GOVERNMENT · 5 mentions",
}

DETECTION = {
    "detection_id": "DET-000123-abc",
    "object_type": "storage_tank",
    "confidence": 0.82,
    "centroid_lat": 25.30662, "centroid_lon": 56.37288,
    "area_m2": 2802.7,
    "attributes": json.dumps({"model": "yolov8n-obb (DOTA)",
                              "pixel_resolution_m": 9.98,
                              "geolocation_uncertainty_m": 15.0}),
    "provenance": "imagery",
}
SCAN = {"scan_id": "8c1c9ed4-1111", "instrument": "OPTICAL",
        "image_timestamp_utc": "2026-09-09T00:00:00", "zone_name": "Khor Fakkan Port"}

CLUSTER = {
    "corroborated": True, "lat": 25.3072, "lon": 56.3698,
    "first_seen": "2026-09-18T21:44:00+00:00", "last_seen": "2026-09-19T08:58:00+00:00",
    "confidence": 1.0, "independent_modalities": 2,
    "modalities": ["optical_satellite", "thermal_satellite"],
    "sources": ["firms", "imagery"],
    "headline": "A thermal hotspot and an object in optical imagery within 11.2h",
    "urls": [], "detail": [{"source": "firms", "ts": "2026-09-19T08:58:00+00:00"}],
}


# ── every claim carries its evidence ──────────────────────────────────────

def test_a_gdelt_claim_cites_its_article():
    """A claim without its source is an assertion, and an assertion the
    reader cannot check looks like knowledge."""
    c = oo.claim_from_gdelt(GDELT_POINT)
    assert c["source_url"] == GDELT_POINT["source_url"]
    assert c["source_title"]
    assert c["source_publisher"] == "en.apa.az"


def test_a_detection_claim_cites_the_scan_and_the_model():
    c = oo.claim_from_detection(DETECTION, SCAN)
    assert "8c1c9ed4" in c["source_title"]
    assert c["source_publisher"] == "yolov8n-obb (DOTA)"
    ex = json.loads(c["source_excerpt"])
    # How precisely the sensor could place it, so a reader can judge the
    # coordinate rather than trust six decimal places.
    assert ex["pixel_resolution_m"] == 9.98
    assert ex["geolocation_uncertainty_m"] == 15.0


def test_a_cluster_claim_shows_what_agreed():
    """The only claim whose confidence exceeds its members', so it has to
    justify itself."""
    c = oo.claim_from_cluster(CLUSTER)
    ex = json.loads(c["source_excerpt"])
    assert ex["independent_modalities"] == 2
    assert "thermal_satellite" in ex["modalities"]


def test_a_gdelt_point_with_no_article_is_not_a_claim():
    assert oo.claim_from_gdelt({**GDELT_POINT, "source_url": None}) is None
    assert oo.claim_from_gdelt({**GDELT_POINT, "title": ""}) is None


def test_an_unlocated_detection_is_not_a_claim():
    assert oo.claim_from_detection({**DETECTION, "centroid_lat": None}, SCAN) is None


def test_an_uncorroborated_cluster_is_not_promoted_to_a_claim():
    assert oo.claim_from_cluster({**CLUSTER, "corroborated": False}) is None


# ── confidence is inherited, never invented ───────────────────────────────

def test_a_detection_keeps_the_models_own_confidence():
    """A number with no derivation is the most persuasive kind of lie a
    system can tell."""
    assert oo.claim_from_detection(DETECTION, SCAN)["confidence"] == 0.82


def test_gdelt_is_capped_low_because_it_is_a_machine_reading_a_wire_story():
    assert oo.claim_from_gdelt(GDELT_POINT)["confidence"] <= 0.5


def test_a_cluster_carries_the_confidence_the_correlator_derived():
    assert oo.claim_from_cluster(CLUSTER)["confidence"] == CLUSTER["confidence"]


# ── re-reading a feed is not an event ─────────────────────────────────────

def test_the_same_observation_produces_the_same_claim_id():
    """Derived from what identifies the observation, not from when it was
    written — otherwise a nightly re-read accumulates a row per run and the
    store measures uptime rather than events."""
    assert oo.claim_from_gdelt(GDELT_POINT)["claim_id"] == \
           oo.claim_from_gdelt(dict(GDELT_POINT))["claim_id"]
    assert oo.claim_from_detection(DETECTION, SCAN)["claim_id"] == \
           oo.claim_from_detection(dict(DETECTION), dict(SCAN))["claim_id"]


def test_different_observations_get_different_ids():
    other = {**GDELT_POINT, "id": "999"}
    assert oo.claim_from_gdelt(GDELT_POINT)["claim_id"] != \
           oo.claim_from_gdelt(other)["claim_id"]


def test_kinds_do_not_collide():
    """A detection and a GDELT event with the same underlying key must not
    become one claim."""
    assert oo.claim_id_for("gdelt", "X") != oo.claim_id_for("detection", "X")


# ── what it refuses to absorb ─────────────────────────────────────────────

def test_the_entity_types_stay_narrow():
    """An ontology that absorbs every row of telemetry stops modelling the
    world and becomes a slow copy of the database. AIS is deliberately
    absent: a transponder reading is a measurement, not a claim."""
    assert "ais" not in oo.ENTITY_TYPE
    assert "adsb" not in oo.ENTITY_TYPE
    assert set(oo.ENTITY_TYPE) == {"imagery", "sar_vessel", "sar_change",
                                   "gdelt", "firms", "corroborated"}


def test_every_claim_starts_unreviewed():
    """Nothing here is confirmed by being written; a human has not looked."""
    for c in (oo.claim_from_gdelt(GDELT_POINT),
              oo.claim_from_detection(DETECTION, SCAN),
              oo.claim_from_cluster(CLUSTER)):
        assert c["status"] == "unreviewed"


def test_derived_claims_are_marked_as_derived():
    """A corroborated finding was computed, not observed, and the store
    should be able to tell them apart."""
    assert oo.claim_from_cluster(CLUSTER)["origin_class"] == "derived"
    assert oo.claim_from_detection(DETECTION, SCAN)["origin_class"] == "machine"
