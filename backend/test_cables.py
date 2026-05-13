"""
Smoke tests for cable, landing-point, ontology, and rule endpoints.

Usage:
    python test_cables.py [base_url]

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
        print(f"  HTTP {e.code} from {method} {path}: {body_text[:200]}")
        raise


def get(path):  return req("GET",  path)
def post(path, body): return req("POST", path, body)
def put(path, body):  return req("PUT",  path, body)
def delete(path):     return req("DELETE", path)


print(f"Testing against {BASE}\n")

# ── 1. DB spot-check: all cables have system_id, infra_type, region_id ───────
print("1. DB spot-check (direct)")
sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
from database import CableSegment, OntologyEntity, RegionDefinition, RuleConfig, get_db
from sqlalchemy import func

with get_db() as db:
    total          = db.query(CableSegment).count()
    with_system_id = db.query(CableSegment).filter(CableSegment.system_id != None).count()
    with_infra     = db.query(CableSegment).filter(CableSegment.infra_type != None).count()
    with_region    = db.query(CableSegment).filter(CableSegment.region_id != None).count()
    regions        = (
        db.query(CableSegment.region_id, func.count().label("n"))
        .group_by(CableSegment.region_id)
        .order_by(func.count().desc())
        .all()
    )
    onto_count     = db.query(OntologyEntity).count()
    region_defs    = db.query(RegionDefinition).count()

assert with_system_id == total, f"Missing system_ids: {total - with_system_id}"
assert with_infra == total, f"Missing infra_type: {total - with_infra}"
assert with_region == total, f"Missing region_id: {total - with_region}"

print(f"  Total cables     : {total}")
print(f"  With system_id   : {with_system_id}/{total}  ✓")
print(f"  With infra_type  : {with_infra}/{total}  ✓")
print(f"  With region_id   : {with_region}/{total}  ✓")
print(f"  RegionDefinitions: {region_defs}")
print(f"  OntologyEntities : {onto_count}")
print()
print("  Region breakdown:")
for region_id, count in regions:
    print(f"    {region_id:<15} {count}")

# ── 2. GET /api/cables — includes new fields ──────────────────────────────────
print("\n2. GET /api/cables")
cables_data = get("/api/cables")
assert cables_data.get("type") == "FeatureCollection"
count = cables_data["total"]
print(f"  {count} cables — OK")
first_props = cables_data["features"][0]["properties"]
assert first_props.get("system_id") is not None, "First cable missing system_id in API response"
assert first_props.get("region_id") is not None, "First cable missing region_id in API response"
print(f"  First cable: {first_props['cable_name']} | system_id={first_props.get('system_id')} | region={first_props.get('region_id')}")

# ── 3. GET /api/cables/landing-points ────────────────────────────────────────
print("\n3. GET /api/cables/landing-points")
lp_data = get("/api/cables/landing-points")
assert lp_data.get("type") == "FeatureCollection"
lp_count = lp_data["total"]
print(f"  {lp_count} landing points — OK")

# ── 4. GET /api/ontology/entities?type=Submarine+Cable ───────────────────────
print("\n4. GET /api/ontology/entities?type=Submarine+Cable")
onto = get("/api/ontology/entities?type=Submarine+Cable")
assert "entities" in onto
print(f"  {onto['total']} Submarine Cable ontology entities")
if onto["entities"]:
    sample = onto["entities"][0]
    print(f"  Sample: {sample['system_id']} | {sample['name']} | region={sample['region_id']}")

# ── 5. GET /api/rules — initially empty (or existing) ────────────────────────
print("\n5. GET /api/rules")
rules_before = get("/api/rules")
print(f"  {rules_before['total']} existing rules")

# ── 6. POST /api/rules — create loitering rule ───────────────────────────────
print("\n6. POST /api/rules — create AIS_LOITERING_NEAR_CABLE")
new_rule = post("/api/rules", {
    "rule_name": "AIS_LOITERING_NEAR_CABLE",
    "params": {
        "target":           "REG-MED",
        "distance_metres":  500,
        "duration_minutes": 30,
        "max_speed_knots":  2.0,
    },
    "enabled": True,
})
assert new_rule.get("id"), "Rule creation did not return an id"
rule_id = new_rule["id"]
print(f"  Created rule id={rule_id} — OK")
print(f"  Params: {new_rule['params']}")

# ── 7. PUT /api/rules/{id} — disable it ──────────────────────────────────────
print("\n7. PUT /api/rules/{id} — disable rule")
updated = put(f"/api/rules/{rule_id}", {"enabled": False})
assert updated["enabled"] == False
print(f"  Rule {rule_id} disabled — OK")

# ── 8. PUT /api/rules/{id} — re-enable and change target ─────────────────────
print("\n8. PUT /api/rules/{id} — re-enable, change target to ALL")
updated2 = put(f"/api/rules/{rule_id}", {
    "enabled": True,
    "params": {
        "target":           "ALL",
        "distance_metres":  500,
        "duration_minutes": 30,
        "max_speed_knots":  2.0,
    },
})
assert updated2["enabled"] == True
assert updated2["params"]["target"] == "ALL"
print(f"  Rule {rule_id} re-enabled, target=ALL — OK")

# ── 9. GET /api/rules — confirm our rule is in the list ──────────────────────
print("\n9. GET /api/rules — verify list")
rules_after = get("/api/rules")
ids = [r["id"] for r in rules_after["rules"]]
assert rule_id in ids, f"Rule {rule_id} missing from list"
print(f"  {rules_after['total']} rules, our rule id={rule_id} present — OK")

# ── 10. DELETE /api/rules/{id} ───────────────────────────────────────────────
print("\n10. DELETE /api/rules/{id}")
deleted = delete(f"/api/rules/{rule_id}")
assert deleted.get("deleted") == rule_id
rules_final = get("/api/rules")
assert rule_id not in [r["id"] for r in rules_final["rules"]]
print(f"  Rule {rule_id} deleted — OK")

# ── 11. Re-create REG-MED rule for the project ───────────────────────────────
print("\n11. Re-create REG-MED loitering rule (persistent)")
final_rule = post("/api/rules", {
    "rule_name": "AIS_LOITERING_NEAR_CABLE",
    "params": {
        "target":           "REG-MED",
        "distance_metres":  500,
        "duration_minutes": 30,
        "max_speed_knots":  2.0,
    },
    "enabled": True,
})
print(f"  Created persistent rule id={final_rule['id']}")

print()
print("=== ALL TESTS PASSED ===")
print(f"  Cables in DB           : {total}")
print(f"  Landing points in DB   : {lp_count}")
print(f"  Ontology entities      : {onto['total']}")
print(f"  Active loitering rules : 1 (REG-MED, 500m, 30min, ≤2kn)")
