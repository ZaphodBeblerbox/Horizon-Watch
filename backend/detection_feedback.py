"""
detection_feedback.py — analysts' answers to "is this detection what it says?"

Owner, 2026-10-13: the Sentinel-2 smoke detector called dark fields, runways
and cloud shadows smoke. Every published detection can now be answered
"Correct" or "Not this — it's: <class>" (DetectionFeedback.jsx). One answer
per user per detection; answering again replaces it. Each row keeps what the
classifier said and the features it decided on at the time, so
tools/train_detection_classifier.py can fit on the answers even after the
detection row changes or is deleted.

The table is created on first use (CREATE TABLE IF NOT EXISTS), so no
migration is needed.
"""
from __future__ import annotations

import datetime
import json

VERDICTS = ("correct", "incorrect")
# What an analyst can say a detection actually is (imageryModel.FEEDBACK_CLASSES).
ACTUAL_CLASSES = ("field", "runway", "cloud", "cloud_shadow", "port_infrastructure", "storage_tank",
                  "aircraft", "vessel", "smoke_plume", "burn_scar", "other")
# Feedback words -> smoke_classify classes.
TO_CLASS = {"field": "field_change"}

DDL = """CREATE TABLE IF NOT EXISTS detection_feedback (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    detection_id    TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    user_label      TEXT,
    verdict         TEXT NOT NULL,
    actual_class    TEXT,
    predicted_class TEXT,
    note            TEXT,
    features        TEXT,
    zone_system_id  TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    UNIQUE (detection_id, user_id)
)"""

_READY: set = set()


class FeedbackError(ValueError):
    pass


def ensure(engine) -> None:
    key = id(engine)
    if key in _READY:
        return
    from sqlalchemy import text
    with engine.begin() as c:
        c.execute(text(DDL))
        c.execute(text("CREATE INDEX IF NOT EXISTS ix_detection_feedback_det ON detection_feedback (detection_id)"))
    _READY.add(key)


def validate(verdict, actual_class, note) -> tuple[str, str | None, str | None]:
    if verdict not in VERDICTS:
        raise FeedbackError(f"verdict must be one of {', '.join(VERDICTS)}")
    if verdict == "incorrect":
        if actual_class not in ACTUAL_CLASSES:
            raise FeedbackError(f"say what it is instead: one of {', '.join(ACTUAL_CLASSES)}")
    else:
        actual_class = None
    note = (str(note).strip()[:500] or None) if note else None
    return verdict, actual_class, note


def label_of(row: dict) -> str | None:
    """The class an answer says the detection is, in smoke_classify's words."""
    if row.get("verdict") == "correct":
        return row.get("predicted_class")
    a = row.get("actual_class")
    return TO_CLASS.get(a, a) if a and a != "other" else None


def _row(m) -> dict:
    d = dict(m)
    if d.get("features"):
        try:
            d["features"] = json.loads(d["features"])
        except ValueError:
            d["features"] = None
    return d


def save(engine, *, detection_id: str, user_id, user_label: str | None, verdict: str, actual_class: str | None,
         note: str | None, predicted_class: str | None, features: dict | None, zone_system_id: str | None) -> dict:
    from sqlalchemy import text
    verdict, actual_class, note = validate(verdict, actual_class, note)
    ensure(engine)
    now = datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z"
    p = {"d": detection_id, "u": str(user_id), "ul": user_label, "v": verdict, "a": actual_class,
         "pc": predicted_class, "n": note, "f": json.dumps(features) if features else None, "z": zone_system_id, "t": now}
    with engine.begin() as c:
        c.execute(text("""INSERT INTO detection_feedback
              (detection_id, user_id, user_label, verdict, actual_class, predicted_class, note, features, zone_system_id, created_at, updated_at)
              VALUES (:d, :u, :ul, :v, :a, :pc, :n, :f, :z, :t, :t)
              ON CONFLICT (detection_id, user_id) DO UPDATE SET
              user_label = :ul, verdict = :v, actual_class = :a, predicted_class = :pc, note = :n,
              features = COALESCE(:f, features), zone_system_id = :z, updated_at = :t"""), p)
        m = c.execute(text("SELECT * FROM detection_feedback WHERE detection_id = :d AND user_id = :u"), p).mappings().first()
    return _row(m)


def for_detection(engine, detection_id: str) -> list[dict]:
    from sqlalchemy import text
    ensure(engine)
    with engine.connect() as c:
        rows = c.execute(text("SELECT * FROM detection_feedback WHERE detection_id = :d ORDER BY updated_at DESC"),
                         {"d": detection_id}).mappings().all()
    return [_row(r) for r in rows]


def all_rows(engine) -> list[dict]:
    from sqlalchemy import text
    ensure(engine)
    with engine.connect() as c:
        return [_row(r) for r in c.execute(text("SELECT * FROM detection_feedback ORDER BY updated_at")).mappings().all()]


def public(row: dict, me) -> dict:
    """What the page sees of one answer: no features, and whose it is."""
    return {"detection_id": row["detection_id"], "verdict": row["verdict"], "actual_class": row["actual_class"],
            "predicted_class": row["predicted_class"], "note": row["note"], "user": row.get("user_label"),
            "mine": str(row["user_id"]) == str(me), "created_at": row["created_at"], "updated_at": row["updated_at"]}


def detection_snapshot(attributes: str | None, object_type: str) -> tuple[str, dict | None]:
    """(predicted class, features) from a detection row's attributes."""
    try:
        a = json.loads(attributes or "{}") or {}
    except ValueError:
        a = {}
    f = a.get("features")
    if isinstance(f, dict) and isinstance(a.get("band_ratios"), dict):
        f = {**f, "ratios": a["band_ratios"]}
    return object_type, (f if isinstance(f, dict) else None)
