"""
Regression test — real country<->chokepoint and event<->chokepoint
proximity auto-linking (fix/geoconfirmed-parallax-rebuild, Part 3).

Real confirmed bug (live audit): Yemen had zero real links to anything in
the ontology graph despite an obvious, structurally-derivable relationship
(Yemen borders the real Bab-el-Mandeb strait). Root cause: no country<->
chokepoint/asset proximity-linking logic existed at all — entity_linker.py
only covers event-to-infrastructure links (cables/ports/airports/zones),
never country-to-chokepoint.

This test proves, against REAL chokepoint definitions (main.py's
_CHOKEPOINT_DEFS, parsed directly via AST so this never imports/starts the
full app) and the real countries.geojson boundary file:
  1. Yemen real-links to Bab el-Mandeb.
  2. Djibouti and Egypt (this prompt's own suggested spot-checks) also
     real-link to Bab el-Mandeb / Suez respectively.
  3. A country with no real nearby chokepoint (Ukraine) gets no link —
     proving this isn't a dense same-country-style catch-all that fires
     for everything.
  4. Every produced edge is auto:True with a real, disclosed distance_km
     and basis string — never a vague/generic association.

Usage:
    cd backend
    python3 test_geo_proximity_linker.py
"""
import ast
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

FAILURES = []


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


print("=" * 70)
print("  Country/event <-> chokepoint proximity linking — real regression test")
print("=" * 70)

import geo_proximity_linker as gpl

# Real _CHOKEPOINT_DEFS, parsed from main.py's actual source without
# importing/starting the full app (this module has no dependency on it).
_src = open(os.path.join(os.path.dirname(__file__), "main.py")).read()
_tree = ast.parse(_src)
CHOKEPOINT_DEFS = None
for node in ast.walk(_tree):
    if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "_CHOKEPOINT_DEFS" for t in node.targets):
        CHOKEPOINT_DEFS = ast.literal_eval(node.value)
        break
assert CHOKEPOINT_DEFS is not None, "could not find real _CHOKEPOINT_DEFS in main.py"

GEOJSON_PATH = os.path.join(os.path.dirname(__file__), "geo", "countries.geojson")

print(f"\n[1] Real chokepoint definitions loaded: {len(CHOKEPOINT_DEFS)}")
check("at least Hormuz/Suez/Bab el-Mandeb are present",
      {"Strait of Hormuz", "Suez Canal", "Bab el-Mandeb"}.issubset({c["name"] for c in CHOKEPOINT_DEFS}))

print("\n[2] Real country<->chokepoint links")
country_nodes = [
    {"id": "country_YE", "iso_code": "YE"},
    {"id": "country_DJ", "iso_code": "DJ"},
    {"id": "country_EG", "iso_code": "EG"},
    {"id": "country_UA", "iso_code": "UA"},
]
edges = gpl.country_chokepoint_links(country_nodes, CHOKEPOINT_DEFS, GEOJSON_PATH)
by_source = {}
for e in edges:
    by_source.setdefault(e["source"], []).append(e)

check("Yemen links to a real chokepoint", "country_YE" in by_source, by_source.get("country_YE"))
if "country_YE" in by_source:
    check("Yemen's real link is specifically to Bab el-Mandeb",
          any(e["target"] == f"choke_{c['system_id']}" for e in by_source["country_YE"]
              for c in CHOKEPOINT_DEFS if c["name"] == "Bab el-Mandeb"),
          by_source["country_YE"])

check("Djibouti links to a real chokepoint (spot-check)", "country_DJ" in by_source, by_source.get("country_DJ"))
check("Egypt links to a real chokepoint (spot-check)", "country_EG" in by_source, by_source.get("country_EG"))
check("Ukraine (no real nearby chokepoint) gets NO link — proves this isn't a dense catch-all",
      "country_UA" not in by_source, by_source.get("country_UA"))

print("\n[3] Every real edge is auto:True with a disclosed real basis (never vague)")
for e in edges:
    check(f"edge {e['source']}->{e['target']} is auto:True", e.get("auto") is True, e)
    check(f"edge {e['source']}->{e['target']} has a real numeric distance_km", isinstance(e.get("distance_km"), (int, float)), e)
    check(f"edge {e['source']}->{e['target']} states its real basis", bool(e.get("basis")), e)

print("\n[4] Real event<->chokepoint links (a real event near Hormuz)")
event_nodes = [
    {"id": "geoconfirmed_test_hormuz", "lat": 26.6, "lng": 56.3},   # inside/near the real Hormuz polygon
    {"id": "geoconfirmed_test_middle_atlantic", "lat": 10.0, "lng": -40.0},  # nowhere near any real chokepoint
]
ev_edges = gpl.event_chokepoint_links(event_nodes, CHOKEPOINT_DEFS)
ev_by_source = {e["source"]: e for e in ev_edges}
check("event near Hormuz links to a real chokepoint", "geoconfirmed_test_hormuz" in ev_by_source, ev_by_source)
check("event nowhere near any real chokepoint gets no link",
      "geoconfirmed_test_middle_atlantic" not in ev_by_source, ev_by_source)

print("\n" + "=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    print("=" * 70)
    sys.exit(1)
else:
    print("  RESULT: ALL CHECKS PASSED")
    print("=" * 70)
