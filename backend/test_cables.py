"""
Quick smoke test for submarine cable endpoints.

Usage:
    python test_cables.py [base_url]

Default base_url: http://localhost:8000
"""

import sys, json, urllib.request

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://localhost:8000"


def get(path: str) -> dict:
    url = BASE + path
    req = urllib.request.Request(url, headers={"User-Agent": "NaginiTest/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def assert_geojson(data: dict, label: str) -> int:
    assert data.get("type") == "FeatureCollection", f"{label}: expected FeatureCollection, got {data.get('type')}"
    features = data.get("features", [])
    assert isinstance(features, list), f"{label}: features is not a list"
    print(f"  [{label}] OK — {len(features)} features returned")
    return len(features)


print(f"Testing against {BASE}\n")

# ── 1. GET /api/cables ────────────────────────────────────────────────────────
print("1. GET /api/cables")
cables_data = get("/api/cables")
cable_count = assert_geojson(cables_data, "GET /api/cables")
assert cable_count > 0, "Expected at least one cable"

# ── 2. GET /api/cables/landing-points ────────────────────────────────────────
print("\n2. GET /api/cables/landing-points")
lp_data = get("/api/cables/landing-points")
lp_count = assert_geojson(lp_data, "GET /api/cables/landing-points")
assert lp_count > 0, "Expected at least one landing point"

# ── 3. GET /api/cables/by-country/France ─────────────────────────────────────
print("\n3. GET /api/cables/by-country/France")
france_data = get("/api/cables/by-country/France")
assert france_data.get("type") == "FeatureCollection", "Expected FeatureCollection"
france_cables = france_data.get("features", [])
print(f"  Cables touching France: {len(france_cables)}")
for f in sorted(france_cables, key=lambda x: x["properties"]["cable_name"]):
    props = f["properties"]
    print(f"    - {props['cable_name']} (countries: {props.get('all_countries', 'N/A')})")

# ── 4. GET /api/cables/{cable_id} for the first cable ────────────────────────
print("\n4. GET /api/cables/{cable_id} — first cable from collection")
first_id = cables_data["features"][0]["properties"]["cable_id"]
cable = get(f"/api/cables/{first_id}")
assert cable.get("type") == "Feature", "Expected Feature"
props = cable["properties"]
print(f"  cable_id    : {props['cable_id']}")
print(f"  cable_name  : {props['cable_name']}")
print(f"  owners      : {props.get('owners')}")
print(f"  rfs_year    : {props.get('rfs_year')}")
print(f"  length_km   : {props.get('length_km')}")
print(f"  country_a   : {props.get('country_a')}")
print(f"  country_b   : {props.get('country_b')}")
print(f"  all_countries: {props.get('all_countries')}")
geom = cable.get("geometry", {})
print(f"  geometry    : {geom.get('type')} with {len(geom.get('coordinates', []))} segments")

# ── 5. GET /api/cables/landing-points/{id} ───────────────────────────────────
print("\n5. GET /api/cables/landing-points/{id} — first LP from collection")
first_lp_id = lp_data["features"][0]["properties"]["landing_point_id"]
lp = get(f"/api/cables/landing-points/{first_lp_id}")
assert lp.get("type") == "Feature", "Expected Feature"
lp_props = lp["properties"]
print(f"  landing_point_id: {lp_props['landing_point_id']}")
print(f"  name            : {lp_props['name']}")
print(f"  country         : {lp_props.get('country')}")
print(f"  cable_ids       : {lp_props.get('cable_ids')}")
lp_geom = lp.get("geometry", {})
print(f"  coordinates     : {lp_geom.get('coordinates')}")

print("\n=== ALL TESTS PASSED ===")
print(f"  Cables in DB         : {cable_count}")
print(f"  Landing points in DB : {lp_count}")
print(f"  Cables touching France: {len(france_cables)}")
