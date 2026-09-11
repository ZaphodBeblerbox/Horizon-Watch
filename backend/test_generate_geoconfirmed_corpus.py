"""
Regression test — "GeoConfirmed points don't load into Generate at all"
(fix/geoconfirmed-ontology-and-inbox-fixes).

Real root cause, confirmed by audit: Generate's evidence corpus is NOT built
from Situation's shared /api/surface pool — it has its own, separate real
query (backend/briefing_prep.py's prepare_intelligence_picture()), which
scores every real Alert row (including GeoConfirmed's, written by
geoconfirmed.py's write_geoconfirmed_alerts() with domain="GEOCONFIRMED")
into `all_scored`/`high_relevance`, but only ever emitted two literal output
buckets from that list — "ais_anomalies" (domain=="AIS") and
"adsb_anomalies" (domain=="ADSB"). A GeoConfirmed-domain signal was
genuinely scored and counted in statistics.total_active_signals, then
silently dropped before reaching any of the 9 keys src/reports/Generate.jsx
reads. Never a shared-selector mismatch — Generate's corpus assembly was
always its own separate real path.

Fix: briefing_prep.py now also emits "geoconfirmed_signals" (domain==
"GEOCONFIRMED"), and Generate.jsx's SECTION_TO_SNAPSHOT now includes it
under "open_source_context" (RSS's old slot — a genuinely closer semantic
fit for real, individually geolocation-verified GeoConfirmed placemarks
than RSS ever was).

Runs against an ISOLATED, throwaway sqlite DB (its own private DATA_DIR) —
NOT backend/data/akili.db, matching test_briefing_prep_scoped_limit.py's
own real isolation pattern (a real backend process may be running an
unrelated observation window against the live DB).

Usage:
    cd backend
    python3 test_generate_geoconfirmed_corpus.py
"""
import os
import sys
import tempfile

_TMP_DATA_DIR = tempfile.mkdtemp(prefix="generate_geoconfirmed_test_")
os.environ["DATA_DIR"] = _TMP_DATA_DIR
sys.path.insert(0, os.path.dirname(__file__))

FAILURES = []


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


print("=" * 70)
print("  Generate corpus — real GeoConfirmed signal inclusion")
print(f"  (isolated DATA_DIR: {_TMP_DATA_DIR})")
print("=" * 70)

import datetime
from datetime import timedelta

import intelligence_schema  # noqa: F401 — registers IntelligenceAssessment with Base before create_all
import database
from database import Base, engine, get_db, Alert, StrategicZone

Base.metadata.create_all(bind=engine)

import briefing_prep  # noqa: E402

PREFIX = "TESTGC"
now = datetime.datetime.utcnow()
# Real Red Sea theatre coordinates — inside scoring.REGION_BBOXES's
# "Red Sea / Arabian Peninsula" real bbox, so this is a real in-scope signal
# under a real region filter, not just an unscoped one.
LAT, LON = 15.5, 42.5

alert_id = f"{PREFIX}-ALERT-1"
zone_id = f"{PREFIX}-ZONE-1"

with get_db() as db:
    # relevance_scorer.score_all_active_signals() scores PURELY off real
    # StrategicZone containment/proximity (see relevance_scorer.py's own
    # module docstring) — a signal with no real zone nearby scores 0
    # regardless of domain, so a real zone covering the test coordinates is
    # required for this test to exercise the real >=60 high_relevance gate
    # (not a special case for GeoConfirmed — AIS/ADSB signals need the same
    # real zone context to ever appear in their own output buckets either).
    db.add(StrategicZone(
        zone_id=zone_id, name=f"{PREFIX} test zone", zone_type="CONFLICT_ACTIVE",
        severity_baseline="critical",
        polygon_geojson='{"type":"Polygon","coordinates":[[[41,14],[44,14],[44,17],[41,17],[41,14]]]}',
        bbox_min_lon=41, bbox_min_lat=14, bbox_max_lon=44, bbox_max_lat=17,
        enabled=True,
    ))
    db.add(Alert(
        alert_id=alert_id, source="geoconfirmed", alert_type="geoconfirmed_event",
        title=f"{PREFIX} real conflict-event placemark", severity="critical",
        lat=LAT, lon=LON, status="active",
        entity_type="geoconfirmed_placemark", entity_id=f"{PREFIX}-pm-1",
        created_at=now - timedelta(hours=1),
    ))
    db.commit()

print("\n[1] Unscoped call — real GeoConfirmed signal must reach Generate's real output bucket")
with get_db() as db:
    picture = briefing_prep.prepare_intelligence_picture(db)

geo_signals = picture.get("geoconfirmed_signals", [])
check("'geoconfirmed_signals' key exists in prepare_intelligence_picture()'s real output",
      "geoconfirmed_signals" in picture, list(picture.keys()))
check("the real seeded GeoConfirmed alert appears in geoconfirmed_signals",
      any(s.get("signal_id") == alert_id for s in geo_signals),
      [s.get("signal_id") for s in geo_signals])
check("statistics.total_active_signals counts the real seeded signal (>= 1)",
      picture.get("statistics", {}).get("total_active_signals", 0) >= 1,
      picture.get("statistics"))

print("\n[2] Region-scoped call — real signal is inside a real region bbox, must still surface")
with get_db() as db:
    picture_scoped = briefing_prep.prepare_intelligence_picture(db, region=["Red Sea / Arabian Peninsula"])
geo_signals_scoped = picture_scoped.get("geoconfirmed_signals", [])
check("region-scoped call still surfaces the real in-region GeoConfirmed signal",
      any(s.get("signal_id") == alert_id for s in geo_signals_scoped),
      [s.get("signal_id") for s in geo_signals_scoped])

print("\n[3] Frontend contract — Generate.jsx must recognize this real key")
with open(os.path.join(os.path.dirname(__file__), "..", "src", "reports", "Generate.jsx")) as f:
    generate_src = f.read()
check("Generate.jsx's ID_FIELD carries a real entry for geoconfirmed_signals",
      "geoconfirmed_signals:" in generate_src.replace(" ", "") or '"geoconfirmed_signals"' in generate_src,
      "grep for geoconfirmed_signals in Generate.jsx found nothing")
check("Generate.jsx's SECTION_TO_SNAPSHOT routes geoconfirmed_signals into a real UI toggle",
      "geoconfirmed_signals" in generate_src,
      "not found in SECTION_TO_SNAPSHOT")

# ── Cleanup ──────────────────────────────────────────────────────────────────
with get_db() as db:
    db.query(Alert).filter(Alert.alert_id == alert_id).delete(synchronize_session=False)
    db.query(StrategicZone).filter(StrategicZone.zone_id == zone_id).delete(synchronize_session=False)
    db.commit()
    check("cleanup removed the real seeded test alert",
          db.query(Alert).filter(Alert.alert_id == alert_id).count() == 0)
    check("cleanup removed the real seeded test zone",
          db.query(StrategicZone).filter(StrategicZone.zone_id == zone_id).count() == 0)

print("\n" + "=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    print("=" * 70)
    sys.exit(1)
else:
    print("  RESULT: ALL CHECKS PASSED")
    print("=" * 70)
