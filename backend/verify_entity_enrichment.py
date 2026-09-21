"""
Regression test — real flagcdn/Wikipedia entity enrichment service
(fix/geoconfirmed-parallax-rebuild, Parts 5 & 7.5).

Real live network calls (flagcdn + Wikipedia REST summary) — no mock path,
since the module's entire value is that these are real external sources.

Usage:
    cd backend
    python3 test_entity_enrichment.py
"""
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

FAILURES = []


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


print("=" * 70)
print("  Entity enrichment (flagcdn + Wikipedia) — real regression test")
print("=" * 70)

import entity_enrichment as ee

print("\n[1] Real country enrichment (Yemen — ORBAT's own flag field was previously empty)")
result = ee.enrich_country("Yemen", "YE", force_refresh=True)
check("real flagcdn flag returned", result["flag_path"] == "https://flagcdn.com/ye.svg", result["flag_path"])
check("real Wikipedia summary returned", result["wikipedia"] is not None)
if result["wikipedia"]:
    check("real Wikipedia extract is non-empty real prose", len(result["wikipedia"]["extract"] or "") > 50)
    check("real Wikipedia citation carries a real url", bool(result["wikipedia"]["citation"]["url"]))

print("\n[2] Real group/unit enrichment — image, never labeled 'flag'")
houthi = ee.enrich_group_entity("Houthi movement", force_refresh=True)
check("real image returned for a real, well-documented group", houthi["image"] is not None)
check("result has no 'flag_path' key at all (armies/groups never get a flag)", "flag_path" not in houthi)

print("\n[3] Honest absence for a real entity with no Wikipedia page")
fake = ee.enrich_group_entity("39th Anti-aircraft Missile Regiment (fictional test, should not exist)", force_refresh=True)
check("no image fabricated for a nonexistent page", fake["image"] is None)
check("no wikipedia data fabricated for a nonexistent page", fake["wikipedia"] is None)

print("\n[4] flagcdn_url() real ISO-code handling")
check("valid 2-letter code returns a real flagcdn URL", ee.flagcdn_url("de") == "https://flagcdn.com/de.svg")
check("empty/invalid code returns None, not a broken URL", ee.flagcdn_url("") is None and ee.flagcdn_url("XYZ") is None)

print("\n" + "=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    print("=" * 70)
    sys.exit(1)
else:
    print("  RESULT: ALL CHECKS PASSED")
    print("=" * 70)
