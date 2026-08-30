"""
Verification script for wiring entity-linking into the universal write_alert()
path (main.py).

Confirmed real gap (audit, 2026-08-23): only 2 of 4 real alert-writing code
paths called entity_linker.link_alert() explicitly — the _forge_detection_cycle()
AIS/ADSB/news alert loop (main.py, near line 20086) and the news-pattern path
(main.py, near line 9109) did; the sanctioned-vessel alert path (near line
9387) and the ship-to-ship-transfer path (near line 9616, inside
_sts_detection_loop) wrote real alerts via write_alert() but never linked
entities. The fix moves entity-linking INTO write_alert() itself (main.py, top
of file) so every alert-writing call site gets it automatically, and removes
the now-redundant explicit calls at the 2 sites that already had them.

This script constructs one realistic alert dict shaped like each of the 4 real
call sites and calls main.write_alert() directly (not through the HTTP API —
these are internal helper functions, not endpoints), then checks a real
OntologyLink row (entity_type="port", proximity to a seeded test port) was
created for each — confirming genuine end-to-end behavior, not just that the
code compiles.

Runs against an ISOLATED, throwaway sqlite DB (its own private DATA_DIR) —
NOT backend/data/akili.db. A real backend process is running an unrelated,
hours-long real-data observation window against that live database right
now, and this script must not write to it. Pointing the DATA_DIR env var at a
fresh temp directory before importing `database`/`main` redirects every
SQLAlchemy read/write (Alert, OntologyLink, ...) to the isolated file —
main.py's own incidental static-data loading (airports/ports/feeds config)
still reads the real repo's read-only reference files, which is harmless.

Usage:
    cd backend
    python3 test_write_alert_entity_linking.py
"""
import os, sys, tempfile, shutil

_TMP_DATA_DIR = tempfile.mkdtemp(prefix="write_alert_test_")
os.environ["DATA_DIR"] = _TMP_DATA_DIR
sys.path.insert(0, os.path.dirname(__file__))

FAILURES = []


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


print("=" * 70)
print("  write_alert() universal entity-linking — verification")
print(f"  (isolated DATA_DIR: {_TMP_DATA_DIR})")
print("=" * 70)

import intelligence_schema  # noqa: F401 — registers IntelligenceAssessment with Base before create_all
from database import Base, engine, get_db, OntologyLink, PortBoundary, Alert

Base.metadata.create_all(bind=engine)

import main  # noqa: E402 — heavy import (full app module), but a bare `import main`
             # (no TestClient/startup event) never starts background loops or
             # touches a live server — same guarantee this task's own
             # verification step ("python3 -c 'import main'") relies on.

PREFIX = "TESTWA"
LAT, LON = 18.0, 42.0  # matches a seeded test port within its 30km proximity radius

created_alert_ids = []
created_link_source_ids = []

with get_db() as db:
    port = PortBoundary(
        system_id=f"{PREFIX}-PORT-1", port_name=f"{PREFIX} Test Port",
        latitude=LAT + 0.05, longitude=LON + 0.05,  # a few km away, well within 30km
    )
    db.add(port)
    db.commit()

main.entity_linker.load_cache()  # own session; loads the port seeded above
check("entity_linker cache loaded", main.entity_linker._loaded is True)
check("entity_linker cache picked up the seeded test port",
      any(p["id"] == f"{PREFIX}-PORT-1" for p in main.entity_linker._ports),
      [p["id"] for p in main.entity_linker._ports])


def links_for(source_id: str):
    with get_db() as db:
        return db.query(OntologyLink).filter(OntologyLink.source_id == source_id).all()


# ── Shape 1: _forge_detection_cycle()'s AIS/ADSB/news alert loop ────────────
# write_alert({**_aw_alert, "source": _src}) — lat/lng (not lon!) keys, "id"
# already set by the detector.
shape1_id = f"{PREFIX}-FORGE-1"
created_alert_ids.append(shape1_id)
result1 = main.write_alert({
    "id": shape1_id, "source": "ais", "alert_type": "vessel_dark",
    "title": f"{PREFIX} forge-cycle AIS alert", "severity": "high",
    "lat": LAT, "lng": LON, "rule_name": "TEST_RULE",
})
created_link_source_ids.append(result1 or shape1_id)

# ── Shape 2: news-pattern path ───────────────────────────────────────────────
# write_alert({"id": assess_id, "source": "news", ..., "lat", "lon", "region"}).
shape2_id = f"{PREFIX}-NEWSPATTERN-1"
created_alert_ids.append(shape2_id)
result2 = main.write_alert({
    "id": shape2_id, "source": "news", "alert_type": "news_test_pattern",
    "title": f"{PREFIX} news-pattern alert", "severity": "medium",
    "lat": LAT, "lon": LON, "region": None,
})
created_link_source_ids.append(result2 or shape2_id)

# ── Shape 3: sanctioned-vessel path ──────────────────────────────────────────
# alert_dict has no "id" at all — write_alert/alert_writer generates one.
# domain/source = "AIS" (uppercase).
result3 = main.write_alert({
    "domain": "AIS", "source": "AIS", "alert_type": "Sanctioned Vessel",
    "title": f"{PREFIX} SANCTIONED: test vessel detected", "severity": "critical",
    "confidence": 0.95, "relevance_score": 100,
    "lat": LAT, "lon": LON, "mmsi": "123456789", "entity_id": "123456789",
    "entity_name": f"{PREFIX} Test Vessel",
})
check("shape 3 (sanctioned-vessel): write_alert returned a real alert_id", bool(result3), result3)
if result3:
    created_alert_ids.append(result3)
    created_link_source_ids.append(result3)

# ── Shape 4: ship-to-ship-transfer path ──────────────────────────────────────
# Same shape as sanctions: no "id", domain/source = "AIS".
result4 = main.write_alert({
    "domain": "AIS", "source": "AIS", "alert_type": "Ship-to-Ship Transfer",
    "title": f"{PREFIX} STS: test vessel A <-> test vessel B", "severity": "high",
    "confidence": 0.7, "relevance_score": 85,
    "lat": LAT, "lon": LON, "mmsi": "111111111", "entity_id": "PAIR-TEST",
    "entity_name": f"{PREFIX} Test Vessel A / Test Vessel B",
})
check("shape 4 (ship-to-ship-transfer): write_alert returned a real alert_id", bool(result4), result4)
if result4:
    created_alert_ids.append(result4)
    created_link_source_ids.append(result4)

print("-" * 70)

shapes = [
    ("1: forge-detection-cycle AIS/ADSB/news loop", shape1_id, result1),
    ("2: news-pattern path", shape2_id, result2),
    ("3: sanctioned-vessel path", result3, result3),
    ("4: ship-to-ship-transfer path", result4, result4),
]

for label, alert_id_used, source_id in shapes:
    if not source_id:
        check(f"shape {label} produced a usable alert_id", False, "write_alert returned no id")
        continue
    with get_db() as db:
        alert_row = db.query(Alert).filter(Alert.alert_id == source_id).first()
    check(f"shape {label}: real Alert row persisted", alert_row is not None, source_id)

    links = links_for(source_id)
    check(f"shape {label}: at least one real OntologyLink row created",
          len(links) > 0, f"source_id={source_id}, links={links}")
    port_links = [l for l in links if l.entity_type == "port" and l.entity_id == f"{PREFIX}-PORT-1"]
    check(f"shape {label}: OntologyLink correctly proximity-links to the seeded test port",
          len(port_links) == 1, [(l.entity_type, l.entity_id) for l in links])

print("-" * 70)

# ── Regression guard: the 2 previously-linking sites must not be double-called ──
# (source-level check — the explicit entity_linker.link_alert() calls that used
# to sit next to write_alert() at these 2 sites must be gone; write_alert()
# itself is the only remaining call, so this file's own read of main.py's
# source should show it not called twice around either site.)
with open(os.path.join(os.path.dirname(__file__), "main.py")) as _f:
    _main_src = _f.read()

_news_pattern_start = _main_src.find("Persist as Alert (write_alert() itself now handles")
_news_pattern_slice = _main_src[_news_pattern_start:_news_pattern_start + 700] if _news_pattern_start >= 0 else ""
check("news-pattern site: source no longer has an explicit entity_linker.link_alert() call",
      "entity_linker.link_alert(assess_id" not in _news_pattern_slice, _news_pattern_start)

_forge_cycle_start = _main_src.find("Persist new alerts to DB (write_alert() itself now handles")
_forge_cycle_slice = _main_src[_forge_cycle_start:_forge_cycle_start + 700] if _forge_cycle_start >= 0 else ""
check("forge-detection-cycle site: source no longer has an explicit entity_linker.link_alert() call",
      "entity_linker.link_alert(\n" not in _forge_cycle_slice and "entity_linker.link_alert(" not in _forge_cycle_slice,
      _forge_cycle_start)

# ── Cleanup ───────────────────────────────────────────────────────────────────
with get_db() as db:
    db.query(OntologyLink).filter(OntologyLink.source_id.in_(created_link_source_ids)).delete(synchronize_session=False)
    db.query(Alert).filter(Alert.alert_id.in_(created_alert_ids)).delete(synchronize_session=False)
    db.query(PortBoundary).filter(PortBoundary.system_id == f"{PREFIX}-PORT-1").delete(synchronize_session=False)
    db.commit()
    check("cleanup removed test OntologyLinks",
          db.query(OntologyLink).filter(OntologyLink.source_id.in_(created_link_source_ids)).count() == 0)
    check("cleanup removed test alerts",
          db.query(Alert).filter(Alert.alert_id.in_(created_alert_ids)).count() == 0)
    check("cleanup removed test port",
          db.query(PortBoundary).filter(PortBoundary.system_id == f"{PREFIX}-PORT-1").count() == 0)

shutil.rmtree(_TMP_DATA_DIR, ignore_errors=True)

print("=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    sys.exit(1)
else:
    print("  RESULT: ALL CHECKS PASSED")
print("=" * 70)
