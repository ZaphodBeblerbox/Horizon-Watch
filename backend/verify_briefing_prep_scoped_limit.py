"""
Verification script for the briefing_prep.py limit-before-filter fix.

Confirmed real bug (audit, 2026-08-23): prepare_intelligence_picture()'s Alert
query applied `.order_by(created_at.desc()).limit(100)` at the DB level BEFORE
region/period scoping ran per-row in Python (`_region_ok()`/`_period_ok()`,
applied afterwards over the already-truncated result). Real numbers that day:
177 real quality-passing Alert rows existed in the last 24h against a
hardcoded limit(100) — 77 real alerts silently dropped before the region
filter ever saw them, on every single call, regardless of what region was
requested. The same limit-then-filter-in-Python shape existed for
news_articles (limit 20), sentinel_detections (limit 20), and
intelligence_assessments (limit 15) — those three just hadn't manifested yet
because their tables were near-empty at the time.

The fix pushes the region bbox + period bounds into the SQL query itself (via
briefing_prep._sql_region_filter plus direct created_at/ingested_at bounds)
so the LIMIT applies to an already-scoped result set, and raises the fetch
ceiling substantially (10x) when a region/period scope is actually requested
— omitting region/period (the default, existing call sites) is unaffected.

This script proves it with seeded volumes shaped exactly like the real bug:
for each of the 4 query sites, more out-of-region rows than the OLD limit
(each with a higher sort-key than the in-region rows, so they'd fully occupy
the old LIMIT) than there are real in-region rows — the old code's own
query+limit shape is reproduced directly (not by re-adding the removed code)
to report real "rows silently dropped" numbers, then the real (fixed)
prepare_intelligence_picture() is called and checked to surface every real
in-region row instead.

Runs against an ISOLATED, throwaway sqlite DB (its own private DATA_DIR) —
NOT backend/data/akili.db. A real backend process is running an unrelated,
hours-long real-data observation window against that live database right
now, and this script must not write to it. Pointing DATA_DIR at a fresh temp
directory before importing `database` gets the exact same create_all()-built
schema and the exact same prepare_intelligence_picture() code path, without
touching any live data.

Usage:
    cd backend
    python3 test_briefing_prep_scoped_limit.py
"""
import os, sys, tempfile, shutil

_TMP_DATA_DIR = tempfile.mkdtemp(prefix="briefing_prep_test_")
os.environ["DATA_DIR"] = _TMP_DATA_DIR
sys.path.insert(0, os.path.dirname(__file__))

FAILURES = []


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


print("=" * 70)
print("  briefing_prep.py limit-before-filter fix — verification")
print(f"  (isolated DATA_DIR: {_TMP_DATA_DIR})")
print("=" * 70)

import datetime
from datetime import timedelta

import intelligence_schema  # noqa: F401 — registers IntelligenceAssessment with Base before create_all
import database
from database import Base, engine, get_db, Alert, NewsArticle, SentinelDetection
from intelligence_schema import IntelligenceAssessment

Base.metadata.create_all(bind=engine)

import briefing_prep  # noqa: E402

PREFIX = "TESTBP"
now = datetime.datetime.utcnow()

# "Red Sea / Arabian Peninsula" bbox per scoring.REGION_BBOXES: (12.0, 30.0, 32.0, 60.0)
IN_LAT,  IN_LON  = 18.0, 42.0     # well inside the bbox
OUT_LAT, OUT_LON = -30.0, -60.0   # South America — well outside, and >400km buffer
REGION = ["Red Sea / Arabian Peninsula"]

# ── Seed volumes ─────────────────────────────────────────────────────────────
# Alerts: old query ordered by created_at DESC — out-of-region rows are made
# newer than the in-region ones so the old limit(100) is entirely consumed by
# out-of-region rows before the region filter ever runs.
N_OUT_ALERT, N_IN_ALERT = 130, 50
# News articles: old query ordered by relevance_score DESC.
N_OUT_ART, N_IN_ART = 25, 22
# Sentinel detections: old query ordered by confidence DESC. Kept <=10 so the
# final output's own [:10] display-slice (unrelated, pre-existing, applied
# only to the returned dict — not the bug) doesn't mask the result.
N_OUT_SEN, N_IN_SEN = 25, 6
# Intelligence assessments: old query ordered by confidence DESC. Same <=10
# reasoning as sentinel above.
N_OUT_ASS, N_IN_ASS = 20, 7

created_alert_ids = []
created_article_urls = []
created_detection_ids = []
created_assessment_ids = []

with get_db() as db:
    for i in range(N_OUT_ALERT):
        aid = f"{PREFIX}-ALERT-OUT-{i}"
        created_alert_ids.append(aid)
        db.add(Alert(
            alert_id=aid, source="ais", alert_type=f"{PREFIX}_type",
            title=f"{PREFIX} out-of-region alert {i}", severity="medium",
            lat=OUT_LAT, lon=OUT_LON, status="active",
            created_at=now - timedelta(minutes=i),
        ))
    for i in range(N_IN_ALERT):
        aid = f"{PREFIX}-ALERT-IN-{i}"
        created_alert_ids.append(aid)
        db.add(Alert(
            alert_id=aid, source="ais", alert_type=f"{PREFIX}_type",
            title=f"{PREFIX} in-region alert {i}", severity="medium",
            lat=IN_LAT, lon=IN_LON, status="active",
            created_at=now - timedelta(hours=5, minutes=i),
        ))
    db.commit()

    for i in range(N_OUT_ART):
        url = f"https://example.org/{PREFIX}-art-out-{i}"
        created_article_urls.append(url)
        db.add(NewsArticle(
            url=url, title=f"{PREFIX} out article {i}", tier=1, relevance_score=99.0,
            lat=OUT_LAT, lon=OUT_LON, ingested_at=now - timedelta(hours=1),
        ))
    for i in range(N_IN_ART):
        url = f"https://example.org/{PREFIX}-art-in-{i}"
        created_article_urls.append(url)
        db.add(NewsArticle(
            url=url, title=f"{PREFIX} in article {i}", tier=1, relevance_score=50.0,
            lat=IN_LAT, lon=IN_LON, ingested_at=now - timedelta(hours=1),
        ))
    db.commit()

    for i in range(N_OUT_SEN):
        did = f"{PREFIX}-SEN-OUT-{i}"
        created_detection_ids.append(did)
        db.add(SentinelDetection(
            detection_id=did, scan_id=f"{PREFIX}-SCAN", zone_id=1,
            object_type="vessel", confidence=0.99,
            centroid_lat=OUT_LAT, centroid_lon=OUT_LON,
            severity="high", alert_tier="immediate", created_at=now - timedelta(hours=1),
        ))
    for i in range(N_IN_SEN):
        did = f"{PREFIX}-SEN-IN-{i}"
        created_detection_ids.append(did)
        db.add(SentinelDetection(
            detection_id=did, scan_id=f"{PREFIX}-SCAN", zone_id=1,
            object_type="vessel", confidence=0.5,
            centroid_lat=IN_LAT, centroid_lon=IN_LON,
            severity="high", alert_tier="immediate", created_at=now - timedelta(hours=1),
        ))
    db.commit()

    for i in range(N_OUT_ASS):
        assid = f"{PREFIX}-ASS-OUT-{i}"
        created_assessment_ids.append(assid)
        db.add(IntelligenceAssessment(
            assessment_id=assid, assessment_type="test", domain="NEWS", severity="high",
            confidence=0.99, headline=f"{PREFIX} out assessment {i}",
            lat=OUT_LAT, lon=OUT_LON,
            expires_at=now + timedelta(hours=6), created_at=now - timedelta(hours=1),
        ))
    for i in range(N_IN_ASS):
        assid = f"{PREFIX}-ASS-IN-{i}"
        created_assessment_ids.append(assid)
        db.add(IntelligenceAssessment(
            assessment_id=assid, assessment_type="test", domain="NEWS", severity="high",
            confidence=0.5, headline=f"{PREFIX} in assessment {i}",
            lat=IN_LAT, lon=IN_LON,
            expires_at=now + timedelta(hours=6), created_at=now - timedelta(hours=1),
        ))
    db.commit()

print(f"  seeded: {N_OUT_ALERT}+{N_IN_ALERT} alerts, {N_OUT_ART}+{N_IN_ART} articles, "
      f"{N_OUT_SEN}+{N_IN_SEN} sentinel detections, {N_OUT_ASS}+{N_IN_ASS} assessments "
      f"(out-of-region+in-region)")

# ── Reproduce the OLD query+limit shape directly (not by re-adding removed
# code — same filter/order_by/limit as the pre-fix code) to report real
# "before" numbers, then apply _region_ok exactly as the old Python-side
# filter did. ─────────────────────────────────────────────────────────────────
with get_db() as db:
    cutoff_24h = now - timedelta(hours=24)
    cutoff_48h = now - timedelta(hours=48)

    old_alert_rows = (
        db.query(Alert)
        .filter(Alert.status == "active", Alert.created_at >= cutoff_24h,
                Alert.alert_type.isnot(None), Alert.alert_type != "unknown",
                Alert.title.isnot(None), Alert.title != "")
        .order_by(Alert.created_at.desc())
        .limit(100)
        .all()
    )
    old_in_region_alerts = [r for r in old_alert_rows if briefing_prep._region_ok(r.lat, r.lon, REGION)]

    old_article_rows = (
        db.query(NewsArticle)
        .filter(NewsArticle.tier.in_([1, 2]), NewsArticle.ingested_at >= cutoff_24h)
        .order_by(NewsArticle.relevance_score.desc())
        .limit(20)
        .all()
    )
    old_in_region_articles = [r for r in old_article_rows if briefing_prep._region_ok(r.lat, r.lon, REGION)]

    old_sentinel_rows = (
        db.query(SentinelDetection)
        .filter(SentinelDetection.alert_tier == "immediate", SentinelDetection.created_at > cutoff_48h)
        .order_by(SentinelDetection.confidence.desc())
        .limit(20)
        .all()
    )
    old_in_region_sentinel = [
        r for r in old_sentinel_rows if briefing_prep._region_ok(r.centroid_lat, r.centroid_lon, REGION)
    ]

    old_assessment_rows = (
        db.query(IntelligenceAssessment)
        .filter(IntelligenceAssessment.domain == "NEWS", IntelligenceAssessment.expires_at > now,
                IntelligenceAssessment.severity.in_(["high", "critical"]))
        .order_by(IntelligenceAssessment.confidence.desc())
        .limit(15)
        .all()
    )
    old_in_region_assessments = [
        r for r in old_assessment_rows if briefing_prep._region_ok(r.lat, r.lon, REGION)
    ]

print("-" * 70)
print("  BEFORE (old limit-before-filter shape, real seeded volumes):")
print(f"    alerts:       {len(old_in_region_alerts)} of {N_IN_ALERT} real in-region alerts surfaced "
      f"({N_IN_ALERT - len(old_in_region_alerts)} silently dropped)")
print(f"    articles:     {len(old_in_region_articles)} of {N_IN_ART} real in-region articles surfaced "
      f"({N_IN_ART - len(old_in_region_articles)} silently dropped)")
print(f"    sentinel:     {len(old_in_region_sentinel)} of {N_IN_SEN} real in-region detections surfaced "
      f"({N_IN_SEN - len(old_in_region_sentinel)} silently dropped)")
print(f"    assessments:  {len(old_in_region_assessments)} of {N_IN_ASS} real in-region assessments surfaced "
      f"({N_IN_ASS - len(old_in_region_assessments)} silently dropped)")
print("-" * 70)

check("OLD shape: alerts silently drops all in-region rows (bug reproduced)",
      len(old_in_region_alerts) == 0, len(old_in_region_alerts))
check("OLD shape: articles silently drops all in-region rows (bug reproduced)",
      len(old_in_region_articles) == 0, len(old_in_region_articles))
check("OLD shape: sentinel detections silently drops all in-region rows (bug reproduced)",
      len(old_in_region_sentinel) == 0, len(old_in_region_sentinel))
check("OLD shape: assessments silently drops all in-region rows (bug reproduced)",
      len(old_in_region_assessments) == 0, len(old_in_region_assessments))

# ── Now call the real, fixed prepare_intelligence_picture() ─────────────────
with get_db() as db:
    result = briefing_prep.prepare_intelligence_picture(db, forge_alerts=[], region=REGION)

after_alerts = result["statistics"]["total_active_signals"]
after_articles = [a for a in result["top_articles"] if a["title"].startswith(f"{PREFIX} in article")]
after_sentinel = [d for d in result["sentinel_detections"]]
after_assessments = [a for a in result["news_assessments"]]

print("  AFTER (fixed prepare_intelligence_picture, same seeded volumes, region-scoped call):")
print(f"    alerts (total_active_signals): {after_alerts}")
print(f"    articles surfaced:             {len(after_articles)}")
print(f"    sentinel detections surfaced:  {len(after_sentinel)}")
print(f"    assessments surfaced:          {len(after_assessments)}")
print("=" * 70)

check(f"FIXED: region-scoped call surfaces all {N_IN_ALERT} real in-region alerts (was 0)",
      after_alerts == N_IN_ALERT, after_alerts)
check(f"FIXED: region-scoped call surfaces all {N_IN_ART} real in-region articles (was 0)",
      len(after_articles) == N_IN_ART, len(after_articles))
check(f"FIXED: region-scoped call surfaces all {N_IN_SEN} real in-region sentinel detections (was 0)",
      len(after_sentinel) == N_IN_SEN, len(after_sentinel))
check(f"FIXED: region-scoped call surfaces all {N_IN_ASS} real in-region assessments (was 0)",
      len(after_assessments) == N_IN_ASS, len(after_assessments))

# No out-of-region rows should have leaked through either.
check("FIXED: no out-of-region article leaked into the result",
      not any(a["title"].startswith(f"{PREFIX} out article") for a in result["top_articles"]),
      [a["title"] for a in result["top_articles"]])

# ── Default (unscoped) call reproduces prior behavior unchanged: still capped
# at the original hardcoded limits, since no region/period was requested. ────
with get_db() as db:
    unscoped = briefing_prep.prepare_intelligence_picture(db, forge_alerts=[])
check("UNSCOPED call (no region/period) reproduces the exact prior hardcoded limit(100) unchanged "
      "(180 real alerts seeded, no region/period requested -> still exactly 100, byte-for-byte prior behavior)",
      unscoped["statistics"]["total_active_signals"] == 100, unscoped["statistics"])

# ── Cleanup — this is a throwaway DB, but tear down rows explicitly for parity
# with this codebase's fixture/cleanup convention, then remove the temp dir. ──
with get_db() as db:
    db.query(Alert).filter(Alert.alert_id.in_(created_alert_ids)).delete(synchronize_session=False)
    db.query(NewsArticle).filter(NewsArticle.url.in_(created_article_urls)).delete(synchronize_session=False)
    db.query(SentinelDetection).filter(SentinelDetection.detection_id.in_(created_detection_ids)).delete(synchronize_session=False)
    db.query(IntelligenceAssessment).filter(IntelligenceAssessment.assessment_id.in_(created_assessment_ids)).delete(synchronize_session=False)
    db.commit()
    check("cleanup removed test alerts", db.query(Alert).filter(Alert.alert_id.in_(created_alert_ids)).count() == 0)
    check("cleanup removed test articles", db.query(NewsArticle).filter(NewsArticle.url.in_(created_article_urls)).count() == 0)
    check("cleanup removed test sentinel detections",
          db.query(SentinelDetection).filter(SentinelDetection.detection_id.in_(created_detection_ids)).count() == 0)
    check("cleanup removed test assessments",
          db.query(IntelligenceAssessment).filter(IntelligenceAssessment.assessment_id.in_(created_assessment_ids)).count() == 0)

shutil.rmtree(_TMP_DATA_DIR, ignore_errors=True)

print("=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    sys.exit(1)
else:
    print("  RESULT: ALL CHECKS PASSED")
print("=" * 70)
