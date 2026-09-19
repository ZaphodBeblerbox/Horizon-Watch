"""
test_scan_storage.py — change persistence and image retention, against a
real SQLite database built for the test and thrown away.

Uses its own temporary database rather than backend/data/akili.db, which is
a real shared file a live server may be running against.

    cd backend && python3 -m pytest test_scan_storage.py -q
"""
import datetime
import json
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

TMPDIR = tempfile.mkdtemp(prefix="scanstore-")
os.environ["DATA_DIR"] = TMPDIR

import database  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

import scan_storage as ss  # noqa: E402

ENGINE = create_engine(f"sqlite:///{TMPDIR}/test.db")
database.Base.metadata.create_all(ENGINE)
Session = sessionmaker(bind=ENGINE)


@pytest.fixture
def db():
    s = Session()
    for m in (database.SentinelDetection, database.SentinelScan, database.WatchZone):
        s.query(m).delete()
    s.commit()
    yield s
    s.rollback()
    s.close()


def make_zone(db, system_id="ZONE-T1"):
    z = database.WatchZone(
        system_id=system_id, name="test zone",
        polygon_geojson=json.dumps({
            "type": "Polygon",
            "coordinates": [[[56.30, 25.28], [56.42, 25.28],
                             [56.42, 25.40], [56.30, 25.40], [56.30, 25.28]]],
        }),
        bbox_min_lon=56.30, bbox_min_lat=25.28,
        bbox_max_lon=56.42, bbox_max_lat=25.40,
        enabled=True, status="active",
    )
    db.add(z); db.commit(); db.refresh(z)
    return z


_seq = [0]


def make_scan(db, zone, *, when_offset_min=0, image="x" * 1000,
              instrument="OPTICAL", status="completed"):
    _seq[0] += 1
    s = database.SentinelScan(
        scan_id=f"SCAN-{_seq[0]:04d}", zone_id=zone.id, status=status,
        triggered_by="test", instrument=instrument, image_b64=image,
        created_at=datetime.datetime(2026, 9, 1) + datetime.timedelta(minutes=when_offset_min),
        image_timestamp_utc=datetime.datetime(2026, 9, 1) + datetime.timedelta(minutes=when_offset_min),
    )
    db.add(s); db.commit(); db.refresh(s)
    return s


def add_det(db, zone, scan, lat, lon, kind="vessel", conf=0.9):
    _seq[0] += 1
    d = database.SentinelDetection(
        detection_id=f"DET-{_seq[0]:05d}", scan_id=scan.scan_id, zone_id=zone.id,
        object_type=kind, confidence=conf, centroid_lat=lat, centroid_lon=lon,
        instrument=scan.instrument, attributes=json.dumps({"model": "test"}),
    )
    db.add(d); db.commit()
    return d


def attrs_of(db, detection_id):
    r = (db.query(database.SentinelDetection)
           .filter(database.SentinelDetection.detection_id == detection_id).first())
    return json.loads(r.attributes)


# ── change persistence ────────────────────────────────────────────────────

def test_the_first_scan_of_a_region_is_a_baseline_not_a_pile_of_arrivals(db):
    z = make_zone(db)
    s1 = make_scan(db, z)
    d = add_det(db, z, s1, 25.30, 56.37)
    out = ss.apply_change_detection(db, z.id, s1.scan_id)
    db.commit()
    assert out["baseline"] is True
    assert out["summary"]["new"] == 0
    assert attrs_of(db, d.detection_id)["change_type"] == "baseline"


def test_a_genuinely_new_vessel_is_recorded_as_new(db):
    z = make_zone(db)
    s1 = make_scan(db, z, when_offset_min=0)
    add_det(db, z, s1, 25.30, 56.37)
    ss.apply_change_detection(db, z.id, s1.scan_id); db.commit()

    s2 = make_scan(db, z, when_offset_min=60)
    add_det(db, z, s2, 25.30, 56.37)            # the same ship, still there
    arrival = add_det(db, z, s2, 25.35, 56.42)  # a new one
    out = ss.apply_change_detection(db, z.id, s2.scan_id); db.commit()

    assert out["baseline"] is False
    assert out["compared_to"] == s1.scan_id
    assert out["summary"]["new"] == 1
    assert out["summary"]["persisted"] == 1
    assert attrs_of(db, arrival.detection_id)["change_type"] == "new"


def test_an_unchanged_scene_records_no_change_and_stays_quiet(db):
    z = make_zone(db)
    s1 = make_scan(db, z, when_offset_min=0)
    add_det(db, z, s1, 25.30, 56.37)
    ss.apply_change_detection(db, z.id, s1.scan_id); db.commit()

    s2 = make_scan(db, z, when_offset_min=60)
    add_det(db, z, s2, 25.30, 56.37)
    out = ss.apply_change_detection(db, z.id, s2.scan_id); db.commit()
    assert out["summary"]["new"] == 0 and out["summary"]["gone"] == 0
    assert out["severity"] == "info"
    assert "no change" in out["headline"]


def test_optical_and_sar_are_never_diffed_against_each_other(db):
    """Two instruments do not see the same things, so the difference between
    them is not a change on the ground."""
    z = make_zone(db)
    sar = make_scan(db, z, when_offset_min=0, instrument="SAR")
    add_det(db, z, sar, 25.30, 56.37)
    ss.apply_change_detection(db, z.id, sar.scan_id, instrument="SAR"); db.commit()

    opt = make_scan(db, z, when_offset_min=60, instrument="OPTICAL")
    add_det(db, z, opt, 25.35, 56.42)
    out = ss.apply_change_detection(db, z.id, opt.scan_id, instrument="OPTICAL")
    db.commit()
    # No previous OPTICAL scan exists, so this is a baseline — not "1 new,
    # 1 gone" manufactured by comparing radar against sunlight.
    assert out["baseline"] is True
    assert out["compared_to"] is None


def test_a_departure_is_reported_but_not_written_onto_a_scan_that_never_saw_it(db):
    z = make_zone(db)
    s1 = make_scan(db, z, when_offset_min=0)
    left = add_det(db, z, s1, 25.35, 56.42)
    ss.apply_change_detection(db, z.id, s1.scan_id); db.commit()

    s2 = make_scan(db, z, when_offset_min=60)
    add_det(db, z, s2, 25.30, 56.37)
    out = ss.apply_change_detection(db, z.id, s2.scan_id); db.commit()

    assert out["summary"]["gone"] == 1
    # The departed object still belongs to scan 1, unaltered.
    gone_row = (db.query(database.SentinelDetection)
                  .filter(database.SentinelDetection.detection_id == left.detection_id).first())
    assert gone_row.scan_id == s1.scan_id


def test_existing_attributes_survive_the_change_tag(db):
    z = make_zone(db)
    s1 = make_scan(db, z)
    d = add_det(db, z, s1, 25.30, 56.37)
    ss.apply_change_detection(db, z.id, s1.scan_id); db.commit()
    a = attrs_of(db, d.detection_id)
    assert a["model"] == "test", "tagging clobbered the detection's own attributes"
    assert "change_type" in a


# ── image retention ───────────────────────────────────────────────────────

def test_only_the_newest_two_scans_keep_their_image(db):
    z = make_zone(db)
    scans = [make_scan(db, z, when_offset_min=i * 60) for i in range(5)]
    out = ss.prune_scan_images(db, z.id, keep=2); db.commit()
    assert len(out["pruned"]) == 3
    kept = [s for s in db.query(database.SentinelScan).all() if s.image_b64 is not None]
    assert len(kept) == 2
    newest = sorted(scans, key=lambda s: s.created_at, reverse=True)[:2]
    assert {s.scan_id for s in kept} == {s.scan_id for s in newest}


def test_pruning_never_removes_a_detection(db):
    """Detections are the baseline change detection runs against. Dropping
    them would silently destroy the ability to report change — months later,
    which is the worst time to discover it."""
    z = make_zone(db)
    old = make_scan(db, z, when_offset_min=0)
    add_det(db, z, old, 25.30, 56.37, "storage_tank")
    add_det(db, z, old, 25.31, 56.38, "vessel")
    for i in range(1, 4):
        make_scan(db, z, when_offset_min=i * 60)

    ss.prune_scan_images(db, z.id, keep=2); db.commit()
    survivors = (db.query(database.SentinelDetection)
                   .filter(database.SentinelDetection.scan_id == old.scan_id).all())
    assert len(survivors) == 2
    assert all(d.centroid_lat and d.centroid_lon for d in survivors)


def test_an_aged_out_scan_can_still_serve_as_a_baseline(db):
    """The whole point of keeping the numbers: comparison must still work
    against a scan whose pixels are gone."""
    z = make_zone(db)
    s1 = make_scan(db, z, when_offset_min=0)
    add_det(db, z, s1, 25.30, 56.37)
    for i in range(1, 4):
        make_scan(db, z, when_offset_min=i * 60)
    ss.prune_scan_images(db, z.id, keep=2); db.commit()
    assert (db.query(database.SentinelScan)
              .filter(database.SentinelScan.scan_id == s1.scan_id).first()).image_b64 is None

    s5 = make_scan(db, z, when_offset_min=500)
    add_det(db, z, s5, 25.35, 56.42)
    out = ss.apply_change_detection(db, z.id, s5.scan_id); db.commit()
    assert out["baseline"] is False, "an image-less scan stopped counting as a baseline"


def test_a_pinned_image_is_never_aged_out(db):
    """An explicit decision by a person outranks a retention rule."""
    z = make_zone(db)
    keeper = make_scan(db, z, when_offset_min=0)
    ss.set_pinned(db, keeper.scan_id, True); db.commit()
    for i in range(1, 5):
        make_scan(db, z, when_offset_min=i * 60)

    ss.prune_scan_images(db, z.id, keep=2); db.commit()
    assert (db.query(database.SentinelScan)
              .filter(database.SentinelScan.scan_id == keeper.scan_id).first()).image_b64 is not None
    assert keeper.scan_id not in ss.prune_scan_images(db, z.id, keep=2)["pruned"]


def test_unpinning_does_not_destroy_the_image_immediately(db):
    """A toggle that deletes on the spot is dangerous to touch."""
    z = make_zone(db)
    s = make_scan(db, z)
    ss.set_pinned(db, s.scan_id, True); db.commit()
    ss.set_pinned(db, s.scan_id, False); db.commit()
    assert (db.query(database.SentinelScan)
              .filter(database.SentinelScan.scan_id == s.scan_id).first()).image_b64 is not None


def test_pinning_a_scan_whose_image_is_already_gone_says_so(db):
    """Silently accepting would imply the image is coming back."""
    z = make_zone(db)
    old = make_scan(db, z, when_offset_min=0)
    for i in range(1, 4):
        make_scan(db, z, when_offset_min=i * 60)
    ss.prune_scan_images(db, z.id, keep=2); db.commit()
    out = ss.set_pinned(db, old.scan_id, True); db.commit()
    assert out["has_image"] is False
    assert "cannot bring it back" in out["note"]


def test_an_aged_out_scan_is_marked_so_the_ui_can_explain_the_gap(db):
    """'No image' and 'image retired' must not render the same."""
    z = make_zone(db)
    old = make_scan(db, z, when_offset_min=0)
    for i in range(1, 4):
        make_scan(db, z, when_offset_min=i * 60)
    ss.prune_scan_images(db, z.id, keep=2); db.commit()
    row = (db.query(database.SentinelScan)
             .filter(database.SentinelScan.scan_id == old.scan_id).first())
    assert ss.image_dropped(row) is True


def test_pruning_is_idempotent(db):
    z = make_zone(db)
    for i in range(5):
        make_scan(db, z, when_offset_min=i * 60)
    first = ss.prune_scan_images(db, z.id, keep=2); db.commit()
    second = ss.prune_scan_images(db, z.id, keep=2); db.commit()
    assert len(first["pruned"]) == 3
    assert second["pruned"] == []


def test_pruning_one_region_leaves_another_alone(db):
    z1 = make_zone(db, "ZONE-A")
    z2 = make_zone(db, "ZONE-B")
    for i in range(4):
        make_scan(db, z1, when_offset_min=i * 60)
        make_scan(db, z2, when_offset_min=i * 60)
    ss.prune_scan_images(db, z1.id, keep=2); db.commit()
    z2_imgs = [s for s in db.query(database.SentinelScan)
               .filter(database.SentinelScan.zone_id == z2.id).all() if s.image_b64]
    assert len(z2_imgs) == 4, "pruning one region touched another"


# ── detection ids ─────────────────────────────────────────────────────────

def test_detection_ids_survive_a_restart():
    """detection_id is UNIQUE in the database and used to be a plain
    in-process counter, so it restarted at DET-000001 every time the backend
    did. The second run of any scan then collided on its first detection and
    the entire insert was rejected — the scan's findings were computed and
    thrown away, reported only as an IntegrityError.

    Simulating the restart by resetting the counter is the whole point: the
    id must not depend on process lifetime.
    """
    import sentinel_ml

    first = [sentinel_ml._next_det_id() for _ in range(5)]
    sentinel_ml._det_counter = 0            # a fresh process
    second = [sentinel_ml._next_det_id() for _ in range(5)]

    assert not (set(first) & set(second)), (
        "detection ids repeat after a restart, so a re-scan cannot be saved"
    )


def test_detection_ids_are_unique_within_a_run():
    import sentinel_ml
    ids = [sentinel_ml._next_det_id() for _ in range(500)]
    assert len(set(ids)) == 500


def test_detection_ids_stay_readable():
    """They appear in the UI and in alerts, so they cannot become opaque."""
    import sentinel_ml
    i = sentinel_ml._next_det_id()
    assert i.startswith("DET-")
    assert len(i) <= 20

# Super-resolution was implemented (Allen AI Satlas ESRGAN) and then removed
# on 2026-09-20. It worked — strict weight load, correct 4x, real detail at
# the 32px training chip — but the output quality on Gulf ports and desert
# was poor: the model is trained on Sentinel-2 -> NAIP, which is US aerial
# imagery, and the single-image variant is its weakest. Against 128MB of
# weights, minutes of CPU per scene and container memory pressure, for a
# picture that by design could never originate a detection, it did not earn
# its place. torch stays declared: the SAR vessel detector needs it.
