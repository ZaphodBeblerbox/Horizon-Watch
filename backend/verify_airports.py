"""
Smoke tests for airport endpoints and ADSB loitering rule creation.

Usage:
    python test_airports.py [base_url]

Default base_url: http://localhost:8000
"""

import sys, json, urllib.request, urllib.error, os

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://localhost:8000"


def req(method: str, path: str, body: dict = None) -> dict:
    url     = BASE + path
    data    = json.dumps(body).encode() if body else None
    headers = {"User-Agent": "NaginiTest/1.0", "Content-Type": "application/json"}
    r       = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode()
        print(f"  HTTP {e.code} from {method} {path}: {body_text[:300]}")
        raise


def get(path):        return req("GET",    path)
def post(path, body): return req("POST",   path, body)
def delete(path):     return req("DELETE", path)


print(f"Testing against {BASE}\n")

# ── 1. DB spot-check: Airport table has entries ───────────────────────────────
print("1. DB spot-check — Airport table")
sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
from database import Airport, get_db

with get_db() as db:
    total = db.query(Airport).count()
    type_counts = {}
    for row in db.query(Airport).all():
        type_counts[row.airport_type] = type_counts.get(row.airport_type, 0) + 1

assert total > 0, "No airports in Airport table — run ingest_airports.py first"
print(f"   {total:,} airports total")
for t in ["large_airport", "medium_airport", "small_airport", "seaplane_base"]:
    print(f"   {t:<20} {type_counts.get(t, 0):,}")
print("   PASS\n")


# ── 2. GET /api/airports?type=large_airport&region_id=REG-MED ─────────────────
print("2. GET /api/airports?type=large_airport&region_id=REG-MED")
d = get("/api/airports?type=large_airport&region_id=REG-MED")
features = d.get("features", [])
assert len(features) > 0, "No large airports in REG-MED returned"
print(f"   {len(features)} large airports in Mediterranean region")
for f in features[:5]:
    p = f.get("properties", {})
    print(f"   · {p.get('airport_name', '?')} ({p.get('icao_code') or p.get('ident', '?')}) — {p.get('country_name', '?')}")
print("   PASS\n")


# ── 3. GET /api/airports/near — London area ───────────────────────────────────
print("3. GET /api/airports/near?lat=51.5&lon=-0.1&radius_km=50")
d = get("/api/airports/near?lat=51.5&lon=-0.1&radius_km=50")
features = d.get("features", [])
assert len(features) > 0, "No airports near London returned"
print(f"   {len(features)} airports within 50km of central London")
for f in features[:5]:
    p = f.get("properties", {})
    print(f"   · {p.get('airport_name', '?')} ({p.get('icao_code') or p.get('ident', '?')}) [{p.get('airport_type', '?')}]")
print("   PASS\n")


# ── 4. GET /api/airports/search?q=Heathrow ────────────────────────────────────
print("4. GET /api/airports/search?q=Heathrow")
d = get("/api/airports/search?q=Heathrow")
features = d.get("features", [])
assert len(features) > 0, "No results for 'Heathrow' search"
names = [f.get("properties", {}).get("airport_name", "?") for f in features]
assert any("Heathrow" in n for n in names), f"Heathrow not in results: {names}"
p = features[0].get("properties", {})
print(f"   Top result: {p.get('airport_name', '?')} — ICAO: {p.get('icao_code') or p.get('ident', '?')}, IATA: {p.get('iata_code', '?')}")
print("   PASS\n")


# ── 5. GET /api/ontology/entities?type=Airport ────────────────────────────────
print("5. GET /api/ontology/entities?type=Airport")
d = get("/api/ontology/entities?type=Airport")
entities = d.get("entities") or d.get("items") or (d if isinstance(d, list) else [])
assert len(entities) > 0, "No Airport ontology entities returned"
print(f"   {len(entities):,} Airport entities in ontology")
sample = entities[0]
print(f"   Sample: {sample.get('name', '?')} / {sample.get('system_id', '?')}")
print("   PASS\n")


# ── 6. POST ADSB_LOITERING_NEAR_AIRPORT rule ─────────────────────────────────
print("6. POST /api/rules — ADSB_LOITERING_NEAR_AIRPORT (REG-MED, large airports)")
rule_body = {
    "rule_name":    "Test ADSB Loiter MED Large",
    "trigger_type": "ADSB_LOITERING_NEAR_AIRPORT",
    "severity":     "high",
    "params": {
        "target":               "REGION:REG-MED",
        "airport_types":        ["large_airport"],
        "proximity_km":         5,
        "min_duration_minutes": 20,
        "max_speed_knots":      200,
    },
}
d = post("/api/rules", rule_body)
assert "id" in d, f"Expected id in response: {d}"
rule_id = d["id"]
print(f"   Created rule id={rule_id}")
print(f"   Rule body: {json.dumps(d, indent=2)}")
print("   PASS\n")


# ── 7. Verify rule in list ────────────────────────────────────────────────────
print("7. GET /api/rules — verify rule present")
d = get("/api/rules")
rules = d.get("rules") or (d if isinstance(d, list) else [])
ids = {r["id"] for r in rules}
assert rule_id in ids, f"Rule {rule_id} not found in /api/rules"
rule = next(r for r in rules if r["id"] == rule_id)
params = json.loads(rule.get("params", "{}")) if isinstance(rule.get("params"), str) else rule.get("params", {})
print(f"   Rule visible: {rule.get('rule_name')} | target={params.get('target')} | types={params.get('airport_types')}")
print("   PASS\n")


# ── 8. Cleanup ────────────────────────────────────────────────────────────────
print("8. DELETE test rule")
delete(f"/api/rules/{rule_id}")
d = get("/api/rules")
rules_after = d.get("rules") or (d if isinstance(d, list) else [])
assert rule_id not in {r["id"] for r in rules_after}, "Rule not deleted"
print("   Deleted")
print("   PASS\n")


print("=" * 40)
print("All airport tests passed.")
