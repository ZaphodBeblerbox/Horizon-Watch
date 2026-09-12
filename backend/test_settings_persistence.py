"""
Verification script for the real Settings round's per-user, server-
persisted, apply-on-change settings store:
  - database.py's migrate_db() adds the new `settings` column to the
    existing `users` table.
  - PATCH /api/users/me/settings deep-merges a partial update into the
    real authenticated user's own row (never a client-supplied user id) —
    confirms a later patch to one nested leaf (alerts.quietHours.startHour)
    never clobbers an earlier sibling (alerts.quietHours.enabled), and that
    a flat legacy key (soundMuted) survives alongside nested ones.
  - GET /api/auth/me reflects the real persisted value afterwards.

Runs against the REAL backend/data directory (gitignored), same pattern as
test_theme_persistence.py. Creates one real throwaway user row, cleaned up
at the end.

Usage:
    cd backend
    python3 test_settings_persistence.py
"""
import os, sys, uuid
os.environ.setdefault("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
sys.path.insert(0, os.path.dirname(__file__))

FAILURES = []

def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)

print("=" * 70)
print("  Settings persistence (real Settings round) — verification")
print("=" * 70)

import database  # noqa: E402
database.migrate_db()

import sqlite3
db_path = os.path.join(os.environ["DATA_DIR"], "akili.db")
conn = sqlite3.connect(db_path)
cols = [row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()]
conn.close()
check("migrate_db() added users.settings column", "settings" in cols)

from fastapi.testclient import TestClient
import main  # noqa: E402
from database import User, get_db

test_email = f"settings-test-{uuid.uuid4().hex[:8]}@trifecta-technologies.com"
with get_db() as db:
    u = User(id=str(uuid.uuid4()), email=test_email, password_hash="x", name="Settings Test", role="analyst", approved=True)
    db.add(u)
    db.commit()
    db.refresh(u)
    user_id = u.id
    check("throwaway user starts with settings unset", u.settings is None)

token = main._create_session_token(user_id)

with TestClient(main.app) as client:
    client.cookies.set("hw_session", token)

    me = client.get("/api/auth/me")
    check("GET /api/auth/me succeeds with a real session cookie", me.status_code == 200, str(me.status_code))
    check("real user with unset settings gets {} over the wire", me.json().get("settings") == {}, str(me.json().get("settings")))

    r1 = client.patch("/api/users/me/settings", json={"soundMuted": True})
    check("PATCH /api/users/me/settings accepts a flat top-level key", r1.status_code == 200, str(r1.status_code))
    check("first patch's value is echoed back", r1.json().get("soundMuted") is True)

    r2 = client.patch("/api/users/me/settings", json={"alerts": {"quietHours": {"enabled": True}}})
    check("second patch (nested) succeeds", r2.status_code == 200, str(r2.status_code))
    check("nested value applied", r2.json().get("alerts", {}).get("quietHours", {}).get("enabled") is True)
    check("earlier flat key survived the nested patch", r2.json().get("soundMuted") is True)

    r3 = client.patch("/api/users/me/settings", json={"alerts": {"quietHours": {"startHour": 22}}})
    check("third patch (sibling nested leaf) succeeds", r3.status_code == 200, str(r3.status_code))
    merged_quiet = r3.json().get("alerts", {}).get("quietHours", {})
    check("deep merge kept the earlier nested sibling (enabled) alongside the new one (startHour)",
          merged_quiet.get("enabled") is True and merged_quiet.get("startHour") == 22, str(merged_quiet))
    check("flat key still survives after two nested patches", r3.json().get("soundMuted") is True)

    me2 = client.get("/api/auth/me")
    check("GET /api/auth/me reflects every real persisted change", me2.json().get("settings") == r3.json(), str(me2.json().get("settings")))

    bad = client.patch("/api/users/me/settings", json="not an object")
    check("PATCH /api/users/me/settings rejects a non-object body", bad.status_code == 400, str(bad.status_code))

    anon = TestClient(main.app)
    unauth = anon.patch("/api/users/me/settings", json={"soundMuted": True})
    check("PATCH /api/users/me/settings requires a real session (401 without one)", unauth.status_code == 401, str(unauth.status_code))

with get_db() as db:
    row = db.query(User).filter(User.id == user_id).first()
    check("real DB row itself carries the fully merged settings", row is not None and row.settings.get("soundMuted") is True and row.settings.get("alerts", {}).get("quietHours", {}).get("startHour") == 22)

with get_db() as db:
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()
    check("cleanup removed the throwaway user", db.query(User).filter(User.id == user_id).count() == 0)

print("=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    sys.exit(1)
print(f"  RESULT: all checks passed")
sys.exit(0)
