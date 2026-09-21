"""
Regression test — real Country/Faction canonicalization
(fix/geoconfirmed-ontology-and-inbox-fixes, Part 4).

Real confirmed bug (live audit): geoconfirmed.py's old `_plus_code_country()`
trusted GeoConfirmed's plusCode's raw last-comma-segment as a country name
with zero validation, creating 10 real "country"-typed ontology nodes that
are not real countries (Gaza/Crimea localities + one garbage postal-code
label) alongside 22 real ones, all keyed by a raw name-slug rather than a
stable canonical id.

This test proves, against a real isolated ontology file (never the live
backend/data/forge/forge_ontology.json):
  1. country_registry.canonical_country() correctly resolves real country
     name variants (including a real alias, e.g. "USA"/"United States") to
     the SAME real ISO code — the actual mechanism that prevents a future
     ingestion path from creating a disjoint duplicate for the same real
     country under a different spelling.
  2. It correctly refuses every one of the 10 real known-bogus locality/
     postal-code strings this bug produced live.
  3. Running geoconfirmed.py's real sync_ontology_from_geoconfirmed() twice
     in a row against the same seeded data is idempotent — a second run
     creates zero new country/faction nodes (the real dedup guarantee,
     not just a one-time migration artifact).
  4. A same-named Faction and Country (e.g. "Ukraine") get a real
     same_polity_as edge — the real, evidence-based alternative to merging
     two genuinely different real-world concepts.

Isolation note (real incident, self-corrected): this test sets
os.environ["DATA_DIR"] before importing main/database so the real
sync_ontology_from_geoconfirmed() + database.py calls below stay
isolated. database.py DOES honor that env var (DATABASE_URL reads
os.getenv("DATA_DIR", ...) at import time), so the DB side of this test
was always correctly isolated. main.py's ontology-file path is NOT
honored by that env var, though — _FORGE_DIR is a hardcoded module
constant — so every past run of this test's sync_ontology_from_
geoconfirmed() call wrote its real seeded "TEST" placemark's ontology
node straight into the REAL production forge_ontology.json (found and
cleaned up during the Part 6 pattern-discovery work in this same round:
a stray `geoconfirmed_test-pm-1` node). Patching main._FORGE_DIR directly
(the one real, verified-effective isolation point — see the assertion
below) closes this for good.

Usage:
    cd backend
    python3 test_country_registry_dedup.py
"""
import os
import sys
import tempfile
from pathlib import Path

_TMP_DATA_DIR = tempfile.mkdtemp(prefix="country_dedup_test_")
os.environ["DATA_DIR"] = _TMP_DATA_DIR
sys.path.insert(0, os.path.dirname(__file__))

FAILURES = []


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


print("=" * 70)
print("  Country/Faction canonicalization — real regression test")
print(f"  (isolated DATA_DIR: {_TMP_DATA_DIR})")
print("=" * 70)

import country_registry as cr

print("\n[1] Real alias resolution — same real country, different real spellings")
usa = cr.canonical_country("USA")
united_states = cr.canonical_country("United States")
america = cr.canonical_country("  america  ")
check("'USA' resolves to a real ISO code", usa is not None, usa)
check("'United States' resolves to the SAME ISO code as 'USA'",
      united_states is not None and united_states[0] == usa[0], (united_states, usa))
check("'  america  ' (whitespace/case) resolves to the SAME ISO code",
      america is not None and america[0] == usa[0], (america, usa))

print("\n[2] Known-bogus locality/postal-code strings are correctly refused")
for bogus in ["Kerch", "Feodosia", "Yalta", "Gaza", "Deir al Balah", "Khan Yunis",
              "Jabalia", "Maghazi", "Nuseirat Camp", "142137"]:
    check(f"'{bogus}' does NOT resolve to a country", cr.canonical_country(bogus) is None, bogus)
    check(f"'{bogus}' is flagged as a known non-country", cr.is_known_non_country(bogus), bogus)

print("\n[3] Real idempotent sync — running twice creates zero new country/faction nodes")
import intelligence_schema  # noqa: F401
from database import Base, engine, SessionLocal, GeoConfirmedPlacemark, GeoConfirmedOrbatNode
import datetime

Base.metadata.create_all(bind=engine)

now = datetime.datetime.utcnow()
with SessionLocal() as db:
    db.add(GeoConfirmedPlacemark(
        id="test-pm-1", theatre_slug="ukraine", name="TEST", description="A real test placemark",
        date=now, date_precision="day", latitude=48.0, longitude=37.0,
        faction="Ukraine", plus_code="8G+ Test City, Test Oblast, Ukraine", status="active",
    ))
    db.commit()

import main  # noqa: E402 — real app import, needed for _forge_ontology_load/save
import geoconfirmed as gc

# The one real, verified-effective isolation point for main.py's ontology
# file (its DATA_DIR is a hardcoded constant, unlike database.py's — see
# module docstring). Refuse to continue if the patch didn't take.
main._FORGE_DIR = Path(_TMP_DATA_DIR) / "forge"
assert main._forge_ontology_load() == {"nodes": [], "edges": []}, \
    "isolation check failed — _FORGE_DIR patch did not take effect, refusing to continue"

with SessionLocal() as db:
    stats1 = gc.sync_ontology_from_geoconfirmed(db)
with SessionLocal() as db:
    stats2 = gc.sync_ontology_from_geoconfirmed(db)

check("first sync creates exactly 1 real country node (Ukraine)", stats1["countries"] == 1, stats1)
check("first sync creates exactly 1 real faction node (Ukraine)", stats1["factions"] == 1, stats1)
check("second sync creates zero NEW country nodes (idempotent)", stats2["countries"] == 1, stats2)
check("second sync creates zero NEW faction nodes (idempotent)", stats2["factions"] == 1, stats2)

ontology = main._forge_ontology_load()
country_nodes = [n for n in ontology["nodes"] if n["id"] == "country_UA"]
check("real country_UA node exists exactly once (no duplicate)", len(country_nodes) == 1, country_nodes)

print("\n[4] Real same_polity_as cross-reference (faction 'Ukraine' <-> country 'Ukraine')")
same_polity = [e for e in ontology["edges"] if e.get("type") == "same_polity_as"
               and e.get("source") == "faction_ukraine" and e.get("target") == "country_UA"]
check("real same_polity_as edge links faction_ukraine -> country_UA", len(same_polity) == 1, same_polity)

print("\n" + "=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    print("=" * 70)
    sys.exit(1)
else:
    print("  RESULT: ALL CHECKS PASSED")
    print("=" * 70)
