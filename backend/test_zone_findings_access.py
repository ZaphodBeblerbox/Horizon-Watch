"""Who may open a zone's findings and images (routers/zone_findings.py):
anybody an imagery notification about the zone went to — a radar change
names the zone as its entity, an optical "Imagery signal" only in raw_json."""
import datetime as dt
import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Alert
from routers.zone_findings import _notified_about


@pytest.fixture
def db():
    eng = create_engine("sqlite://")
    Alert.__table__.create(eng)
    s = sessionmaker(bind=eng)()
    yield s
    s.close()


def _alert(db, aid, *, entity_id=None, zone_id=None, alert_type="Imagery signal", compact=False):
    raw = {"alert_type": alert_type, "raw_json": {"scan_id": "S1", **({"zone_id": zone_id} if zone_id else {})}}
    db.add(Alert(alert_id=aid, source="SAT-TASK", alert_type=alert_type, title=aid, severity="high",
                 entity_id=entity_id, raw_json=json.dumps(raw, separators=(",", ":")) if compact else json.dumps(raw),
                 created_at=dt.datetime.utcnow()))
    db.flush()


def test_a_radar_change_names_the_zone_as_its_entity(db):
    _alert(db, "RCHG-ZONE-005-2026-10-11", entity_id="ZONE-005", zone_id="ZONE-005")
    assert _notified_about(db, Alert, "ZONE-005")


def test_an_optical_signal_names_the_zone_only_in_raw_json(db):
    _alert(db, "ALT-588082D0", entity_id="", zone_id="ZONE-004")
    assert _notified_about(db, Alert, "ZONE-004")


def test_compact_json_counts_too(db):
    _alert(db, "ALT-1", zone_id="ZONE-007", compact=True)
    assert _notified_about(db, Alert, "ZONE-007")


def test_no_notification_no_access(db):
    _alert(db, "ALT-2", zone_id="ZONE-0041")                          # a longer id is another zone
    _alert(db, "X-1", zone_id="ZONE-004", alert_type="Vessel dark")    # not an imagery notification
    assert not _notified_about(db, Alert, "ZONE-004")
    assert not _notified_about(db, Alert, "ZONE-009")
