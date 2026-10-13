"""Analysts' answers on detections: one per user, replaceable, read back with
the features the classifier decided on (detection_feedback.py)."""
import pytest
from sqlalchemy import create_engine

import detection_feedback as fb


@pytest.fixture
def eng(tmp_path):
    return create_engine(f"sqlite:///{tmp_path / 'fb.db'}")


def test_one_answer_per_user_and_answering_again_replaces_it(eng):
    f = {"vis": -0.4, "cropland": 0.8, "persist": 0}
    a = fb.save(eng, detection_id="DET-1", user_id=7, user_label="Marc", verdict="incorrect", actual_class="field",
                note=" ploughed ", predicted_class="smoke_plume", features=f, zone_system_id="ZONE-1")
    assert a["actual_class"] == "field" and a["note"] == "ploughed" and a["features"] == f
    fb.save(eng, detection_id="DET-1", user_id=7, user_label="Marc", verdict="incorrect", actual_class="runway",
            note=None, predicted_class="smoke_plume", features=None, zone_system_id="ZONE-1")
    fb.save(eng, detection_id="DET-1", user_id=9, user_label="JC", verdict="correct", actual_class="field",
            note=None, predicted_class="smoke_plume", features=f, zone_system_id="ZONE-1")
    rows = fb.for_detection(eng, "DET-1")
    assert len(rows) == 2
    mine = [r for r in rows if r["user_id"] == "7"][0]
    assert mine["actual_class"] == "runway"
    assert mine["features"] == f                       # kept when a re-answer has none
    other = [r for r in rows if r["user_id"] == "9"][0]
    assert other["actual_class"] is None               # "correct" carries no other class
    pub = [fb.public(r, 7) for r in rows]
    assert sum(p["mine"] for p in pub) == 1 and all("features" not in p for p in pub)


@pytest.mark.parametrize("verdict,actual", [("maybe", None), ("incorrect", None), ("incorrect", "volcano")])
def test_refuses_answers_that_say_nothing(eng, verdict, actual):
    with pytest.raises(fb.FeedbackError):
        fb.save(eng, detection_id="DET-2", user_id=1, user_label=None, verdict=verdict, actual_class=actual,
                note=None, predicted_class="smoke_plume", features=None, zone_system_id=None)


def test_labels_in_the_classifiers_words():
    assert fb.label_of({"verdict": "correct", "predicted_class": "smoke_plume"}) == "smoke_plume"
    assert fb.label_of({"verdict": "incorrect", "actual_class": "field"}) == "field_change"
    assert fb.label_of({"verdict": "incorrect", "actual_class": "cloud_shadow"}) == "cloud_shadow"
    assert fb.label_of({"verdict": "incorrect", "actual_class": "other"}) is None


def test_snapshot_reads_features_and_band_ratios_from_attributes():
    import json
    cls, f = fb.detection_snapshot(json.dumps({"features": {"vis": 0.2}, "band_ratios": {"B02": 1.3}}), "smoke_plume")
    assert cls == "smoke_plume" and f == {"vis": 0.2, "ratios": {"B02": 1.3}}
    assert fb.detection_snapshot("not json", "burn_scar") == ("burn_scar", None)


def test_training_examples_take_the_majority_answer():
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
    import train_detection_classifier as t
    f = {"vis": 0.1}
    rows = [
        {"detection_id": "A", "verdict": "incorrect", "actual_class": "field", "features": f, "updated_at": "1"},
        {"detection_id": "A", "verdict": "incorrect", "actual_class": "field", "features": f, "updated_at": "2"},
        {"detection_id": "A", "verdict": "correct", "predicted_class": "smoke_plume", "features": f, "updated_at": "3"},
        {"detection_id": "B", "verdict": "incorrect", "actual_class": "other", "features": f, "updated_at": "1"},
        {"detection_id": "C", "verdict": "correct", "predicted_class": "smoke_plume", "features": None, "updated_at": "1"},
    ]
    ex = t.examples_from_feedback(rows)
    assert [(e["id"], e["label"]) for e in ex] == [("A", "field_change")]
