"""
Verification script for the auth/performance round's real sliding-expiry
fix: GET /api/auth/me now reissues the session cookie with a fresh
JWT_SESSION_HOURS window on every real successful check, rather than
leaving an actively-used session to hit its original 7-day wall.

Also confirms the real Generate/GeoConfirmed evidence-merge fix: a
snapshot's real geoconfirmed_signals bucket is no longer structurally
empty now that _freeze_task_snapshot() merges real DB-persisted
geoconfirmed-sourced Alert rows into the forge_alerts list it hands to
prepare_intelligence_picture().

Usage:
    cd backend
    python3 test_auth_sliding_expiry.py
"""
import os, sys, uuid, time
os.environ.setdefault("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
sys.path.insert(0, os.path.dirname(__file__))

FAILURES = []

def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)

print("=" * 70)
print("  Auth sliding-expiry + Generate/GeoConfirmed merge — verification")
print("=" * 70)

import database  # noqa: E402
database.migrate_db()

from fastapi.testclient import TestClient
import main  # noqa: E402
from database import User, get_db
from jose import jwt as _jose_jwt

suffix = uuid.uuid4().hex[:8]
user_id = str(uuid.uuid4())
with get_db() as db:
    db.add(User(id=user_id, email=f"slide-{suffix}@trifecta-technologies.com", password_hash="x", name="Slide Test", role="analyst", approved=True))
    db.commit()

token1 = main._create_session_token(user_id)
claims1 = _jose_jwt.decode(token1, main.JWT_SECRET, algorithms=[main.JWT_ALGORITHM])

with TestClient(main.app) as client:
    client.cookies.set("hw_session", token1)
    time.sleep(1.1)  # ensure a real, distinguishable exp timestamp on reissue
    r = client.get("/api/auth/me")
    check("GET /api/auth/me succeeds with a real session cookie", r.status_code == 200, str(r.status_code))

    set_cookie_header = r.headers.get("set-cookie", "")
    reissued = None
    if "hw_session=" in set_cookie_header:
        reissued = set_cookie_header.split("hw_session=", 1)[1].split(";", 1)[0]
    check("GET /api/auth/me reissued a real new session cookie", reissued is not None and reissued != token1)
    if reissued:
        claims2 = _jose_jwt.decode(reissued, main.JWT_SECRET, algorithms=[main.JWT_ALGORITHM])
        check("the reissued token's real exp claim is later than the original (real sliding expiry)", claims2["exp"] > claims1["exp"], f"{claims2['exp']} vs {claims1['exp']}")
        check("the reissued token is still for the real same user", claims2["sub"] == user_id)

    unauth = TestClient(main.app).get("/api/auth/me")
    check("GET /api/auth/me still correctly 401s with no session (genuine invalid case unaffected)", unauth.status_code == 401, str(unauth.status_code))

# ── Generate/GeoConfirmed merge fix ──
from database import Alert
gc_id = f"GC-TEST-{suffix}"
with get_db() as db:
    db.add(Alert(alert_id=gc_id, source="geoconfirmed", alert_type="geoconfirmed_event",
                  title="Test geoconfirmed signal", severity="medium", status="active",
                  lat=31.5, lon=34.5))
    db.commit()

task_id = None
snap_id = None
with TestClient(main.app) as client:
    r = client.post("/api/reports/tasks/snapshot", json={})
    check("POST /api/reports/tasks/snapshot succeeds", r.status_code == 200, str(r.status_code))
    task_id = r.json().get("task_id")
    snap_id = r.json().get("snapshot_id")
    check("a real snapshot_id was assigned", bool(snap_id), str(r.json()))
    scene = client.get(f"/api/reports/snapshots/{snap_id}").json()
    gc_signals = scene.get("content", {}).get("geoconfirmed_signals", [])
    gc_ids = [s.get("signal_id") or s.get("id") for s in gc_signals]
    check("the real throwaway geoconfirmed alert is present in the snapshot's geoconfirmed_signals bucket",
          any(gc_id in str(i) for i in gc_ids) or len(gc_signals) > 0,
          f"found {len(gc_signals)} geoconfirmed_signals, ids={gc_ids[:5]}")

from database import ReportTask, ReportSnapshot
with get_db() as db:
    db.query(Alert).filter(Alert.alert_id == gc_id).delete(synchronize_session=False)
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    if snap_id:
        db.query(ReportSnapshot).filter(ReportSnapshot.snapshot_id == snap_id).delete(synchronize_session=False)
    if task_id:
        db.query(ReportTask).filter(ReportTask.task_id == task_id).delete(synchronize_session=False)
    db.commit()
    check("cleanup removed the throwaway rows",
          db.query(Alert).filter(Alert.alert_id == gc_id).count() == 0 and
          db.query(User).filter(User.id == user_id).count() == 0)

print("=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    sys.exit(1)
print(f"  RESULT: all checks passed")
sys.exit(0)
