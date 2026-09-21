"""
Regression test for a real bug in EntityLinker._entity_mention_links():

It matched a Haiku-extracted entity name against candidate port/airport
names with a bare substring check (`ent_name in port_name.lower()`), guarded
only by a minimum length of 3 characters. A short, generic extracted term —
e.g. "san" — is a literal substring of many real, completely unrelated port
names ("Santos", "San Juan", ...) even though it does not appear there as a
whole word. That created a fabricated OntologyLink between a news article
and a real but unrelated port/airport: the exact same short-generic-
substring false-positive shape as the sanctioned-vessel name matcher bug
fixed earlier tonight in sanctions_loader.py.

The fix makes `_entity_mention_links` use a `\\b` word-boundary match (the
same technique `_mention_links`, a few lines above it in the same class,
already uses for title matching) instead of a bare substring check.

This test builds an EntityLinker with an in-memory port cache (no DB) and
confirms:
  - a generic short entity name that is only a MID-WORD FRAGMENT of an
    unrelated port's name does NOT produce a link;
  - a real whole-word match still does.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from entity_linker import EntityLinker  # noqa: E402

FAILURES = []


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


print("=" * 70)
print("  entity_mention_links word-boundary fix — regression test")
print("=" * 70)

linker = EntityLinker()
linker._loaded = True
linker._ports = [
    {"id": "PORT-SANTOS", "name": "Santos", "lat": -23.96, "lon": -46.33},
]
linker._airports = [
    {"id": "APT-ADEN", "name": "Aden International Airport", "lat": 12.83, "lon": 45.03},
]

# ── Case 1: "san" is a mid-word fragment of "Santos" — must NOT link ───────
false_positive_entities = [{"name": "San", "type": "port"}]
results = linker._entity_mention_links("article", "https://example.test/a1", false_positive_entities)
check(
    "generic fragment 'San' does NOT link to unrelated port 'Santos'",
    len(results) == 0,
    f"got {results}",
)

# ── Case 2: a real whole-word match still works (sanity check the fix
#            didn't just break matching entirely) ─────────────────────────
real_match_entities = [{"name": "Aden", "type": "airport"}]
results2 = linker._entity_mention_links("article", "https://example.test/a2", real_match_entities)
check(
    "whole-word entity 'Aden' still links to 'Aden International Airport'",
    len(results2) == 1 and results2[0]["entity_id"] == "APT-ADEN",
    f"got {results2}",
)

print("=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
else:
    print("  RESULT: ALL CHECKS PASSED")
print("=" * 70)

if __name__ == "__main__":
    sys.exit(1 if FAILURES else 0)
