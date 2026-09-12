"""
Regression test — real origin_class/licence_tier provenance model
(Parallax translation step 1, Parts 1-2).

Real audit finding this test guards: no origin_class/licence_tier field
existed anywhere before this change; the pre-existing
_DOMAIN_DEFAULT_RELIABILITY in correlation_scoring.py is a different thing
(a numeric fusion-scoring weight, not an evidentiary-class/legal-clearance
classification) and is not merged with or superseded by this pair.

Isolation: patches DATA_DIR before importing database/provenance so this
never touches the real production akili.db — same pattern established
after the earlier ontology-graph test-isolation incident this session
(see test_forge_pattern_discovery_auto_edges.py's docstring), just applied
to the SQL side (database.py's DATABASE_URL DOES honor DATA_DIR, unlike
main.py's forge-ontology path).

Usage:
    cd backend
    python3 test_provenance.py
"""
import os
import sys
import tempfile

_TMP_DATA_DIR = tempfile.mkdtemp(prefix="provenance_test_")
os.environ["DATA_DIR"] = _TMP_DATA_DIR
sys.path.insert(0, os.path.dirname(__file__))

FAILURES = []


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


print("=" * 70)
print("  Provenance (origin_class/licence_tier) — real regression test")
print(f"  (isolated DATA_DIR: {_TMP_DATA_DIR})")
print("=" * 70)

import provenance as prov
from database import Base, engine, SessionLocal, Alert, validate_claim_relationship_type
import alert_writer

Base.metadata.create_all(bind=engine)

print("\n[1] Independence of the two axes — never collapsed into one")
check("origin_class and licence_tier are stored as two separate real fields",
      hasattr(Alert, "origin_class") and hasattr(Alert, "licence_tier"))

print("\n[2] Real per-source mapping produces the correct real pair")
for source, (expected_class, expected_tier) in prov.ALERT_SOURCE_PROVENANCE.items():
    oc, lt = prov.provenance_for_alert_source(source)
    check(f"real source '{source}' -> ({expected_class}, {expected_tier})",
          (oc, lt) == (expected_class, expected_tier), (oc, lt))
    # Case-insensitivity — real live data has both 'AIS' and 'ais'.
    oc2, lt2 = prov.provenance_for_alert_source(source.upper())
    check(f"real source '{source}' is matched case-insensitively", (oc2, lt2) == (expected_class, expected_tier))

print("\n[3] A real source NOT in the mapping table is honestly unclassified, never guessed at")
for unmapped in ("surge", "fusion", "manual", "totally_unknown_source"):
    oc, lt = prov.provenance_for_alert_source(unmapped)
    check(f"'{unmapped}' gets (None, None), not a fabricated guess", (oc, lt) == (None, None), (oc, lt))

print("\n[4] Real end-to-end ingest: write_alert() populates the correct real pair per source")
test_cases = [
    ({"source": "ais", "title": "t", "lat": 1.0, "lon": 1.0}, ("B", "T1")),
    ({"source": "adsb", "title": "t", "lat": 1.0, "lon": 1.0}, ("C", "T1")),
    ({"source": "geoconfirmed", "title": "t", "lat": 1.0, "lon": 1.0}, ("B", "T3")),
    ({"source": "surge", "title": "t", "lat": 1.0, "lon": 1.0}, (None, None)),
]
written_ids = []
for alert_dict, expected in test_cases:
    aid = alert_writer.write_alert(alert_dict)
    written_ids.append(aid)
    with SessionLocal() as db:
        row = db.query(Alert).filter(Alert.alert_id == aid).first()
        check(f"real ingested '{alert_dict['source']}' alert carries ({expected[0]}, {expected[1]})",
              row is not None and (row.origin_class, row.licence_tier) == expected,
              (row.origin_class, row.licence_tier) if row else None)

print("\n[5] Real structural GDELT/open-reporting edge-type restriction (Part 0/2)")
try:
    validate_claim_relationship_type("D", "owns")
    check("class-D claim asserting 'owns' (stronger than mentioned_with) is rejected", False)
except ValueError:
    check("class-D claim asserting 'owns' (stronger than mentioned_with) is rejected", True)

try:
    validate_claim_relationship_type("D", "mentioned_with")
    check("class-D claim asserting 'mentioned_with' is allowed", True)
except ValueError:
    check("class-D claim asserting 'mentioned_with' is allowed", False)

try:
    validate_claim_relationship_type("B", "owns")
    check("a class-B claim (not open-reporting) is NOT restricted to mentioned_with", True)
except ValueError:
    check("a class-B claim (not open-reporting) is NOT restricted to mentioned_with", False)

# Real, honest note (not a failure): GDELT itself creates zero real
# OntologyClaim rows today (confirmed — it only ever feeds
# fusion_engine.on_signal(), never a claim/edge), so there is no real
# GDELT-sourced claim row to test end-to-end yet; the structural guard
# above is real and general (keyed on origin_class=='D'), ready for the
# day a class-D source does mint a claim.
print("  (note: GDELT creates zero real OntologyClaim rows today — the guard above is real and general, not yet exercised by a live GDELT-sourced claim)")

# Cleanup
with SessionLocal() as db:
    for aid in written_ids:
        if aid:
            db.query(Alert).filter(Alert.alert_id == aid).delete()
    db.commit()
print("\n[cleanup] removed test alert rows")

print("\n" + "=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    print("=" * 70)
    sys.exit(1)
else:
    print("  RESULT: ALL CHECKS PASSED")
    print("=" * 70)
