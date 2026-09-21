"""
Smoke tests for port boundary endpoints and STS/dark-ship rule creation.

Usage:
    python test_ports.py [base_url]

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


def expect_http_error(method: str, path: str, body: dict, expected_code: int):
    """Like req(), but asserts the call fails with expected_code — for
    endpoints that are supposed to reject the request."""
    try:
        req(method, path, body)
    except urllib.error.HTTPError as e:
        assert e.code == expected_code, f"Expected HTTP {expected_code}, got {e.code}"
        return
    raise AssertionError(f"Expected HTTP {expected_code} but {method} {path} succeeded")


print(f"Testing against {BASE}\n")

# ── 1. DB spot-check: PortBoundary table has entries ─────────────────────────
print("1. DB spot-check — PortBoundary table")
sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
from database import PortBoundary, OntologyEntity, get_db

with get_db() as db:
    total    = db.query(PortBoundary).count()
    with_sys = db.query(PortBoundary).filter(PortBoundary.system_id != None).count()
    sizes    = {}
    for row in db.query(PortBoundary).all():
        sizes[row.port_size] = sizes.get(row.port_size, 0) + 1

assert total > 0, "No ports in PortBoundary table — run ingest_ports.py first"
assert with_sys == total, f"Missing system_ids: {total - with_sys}"
print(f"   {total:,} ports, all have system_id")
for s in ["Very Large", "Large", "Medium", "Small"]:
    print(f"   {s:<12} {sizes.get(s, 0):,}")
print("   PASS\n")


# ── 2. GET /api/ports/by-region/REG-MED ──────────────────────────────────────
print("2. GET /api/ports/by-region/REG-MED")
d = get("/api/ports/by-region/REG-MED")
assert "features" in d or "ports" in d or isinstance(d, list), f"Unexpected response: {d}"
# Handle both GeoJSON FeatureCollection and plain list shapes
features = d.get("features") or d.get("ports") or (d if isinstance(d, list) else [])
assert len(features) > 0, "No Mediterranean ports returned"
print(f"   {len(features)} Mediterranean ports")
print(f"   First: {features[0].get('properties', features[0]).get('port_name', '?')}")
print("   PASS\n")


# ── 3. check-in-boundary: Rotterdam (should be IN port) ──────────────────────
print("3. POST /api/ports/check-in-boundary — Rotterdam (51.9, 4.48)")
d = post("/api/ports/check-in-boundary", {"lat": 51.9, "lon": 4.48})
assert d.get("in_port") is True, f"Expected in_port=true, got: {d}"
port = d.get("port") or {}
print(f"   in_port=true  →  {port.get('port_name', '?')} ({port.get('country', '?')})")
print("   PASS\n")


# ── 4. check-in-boundary: mid-Atlantic (should NOT be in port) ───────────────
print("4. POST /api/ports/check-in-boundary — mid-Atlantic (30.0, -40.0)")
d = post("/api/ports/check-in-boundary", {"lat": 30.0, "lon": -40.0})
assert d.get("in_port") is False, f"Expected in_port=false, got: {d}"
print("   in_port=false  (open ocean, correct)")
print("   PASS\n")


# ── 5. GET /api/ontology/entities?type=Port ──────────────────────────────────
print("5. GET /api/ontology/entities?type=Port")
d = get("/api/ontology/entities?type=Port")
entities = d.get("entities") or d.get("items") or (d if isinstance(d, list) else [])
assert len(entities) > 0, "No Port ontology entities returned"
print(f"   {len(entities)} Port entities in ontology")
sample = entities[0]
print(f"   Sample: {sample.get('name', '?')} / {sample.get('system_id', '?')}")
print("   PASS\n")


# ── 6. AIS_DARK_SHIP IS now one of WIRED_RULE_NAMES — DarkShipDetector.scan()
#      is now a real implementation, dispatched via WIRED_RULE_DISPATCH /
#      PIPELINE_NODE_RULE_FAMILIES (main.py), so /api/rules must accept
#      creating one instead of rejecting it as having zero live effect. This
#      used to assert the opposite (HTTP 400 rejection) from before
#      DarkShipDetector.scan() actually implemented gap detection; updated to
#      match the new, intentional, currently-enforced behavior — see the
#      dark-ship-detection wiring change.
print("6. POST /api/rules — AIS_DARK_SHIP is now accepted (wired)")
dark_body = {
    "rule_name":    "Test Dark Ship Rule",
    "trigger_type": "AIS_DARK_SHIP",
    "severity":     "high",
    "params": {
        "min_gap_minutes":      60,
        "min_speed_before_gap": 2.0,
        "last_known_region":    "REG-MED",
    },
}
created = post("/api/rules", dark_body)
assert created.get("rule_name") == "AIS_DARK_SHIP", created
assert created.get("wired") is True, f"AIS_DARK_SHIP should be wired now: {created}"
print(f"   Created rule id={created.get('id')} wired={created.get('wired')} live={created.get('live')}")
# Clean up: disable it again so this test stays repeatable (disabling a rule
# is always allowed regardless of wiring — see api_rules_update).
disabled = req("PUT", f"/api/rules/{created['id']}", {"enabled": False})
assert disabled.get("enabled") is False, disabled
print("   Correctly accepted with HTTP 200, then disabled for repeatability")
print("   PASS\n")


print("=" * 40)
print("All port tests passed.")
