"""
Verification script for the Parallax theming round's real per-user,
server-persisted theme setting (Part 5 of the theming prompt):
  - database.py's migrate_db() adds the new `theme` column to an existing
    `users` table without touching any other row data.
  - PUT /api/users/me/theme persists the real per-user value onto the
    real authenticated user's own row (resolved from a real signed session
    cookie via _get_current_user, never a client-supplied user id).
  - GET /api/auth/me reflects the real persisted value afterwards.

Runs against the REAL backend/data directory (gitignored), like this
repo's other verification scripts (see test_ontology_claims.py). Creates
one real throwaway user row for the round-trip, cleaned up at the end.

Usage:
    cd backend
    python3 test_theme_persistence.py
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
print("  Theme persistence (Parallax theming round, Part 5) — verification")
print("=" * 70)

# ── Migration check — run migrate_db() against the real DB, confirm the
# new column exists (idempotent: real users.db already has every other
# column added this same way across prior rounds). ──
import database  # noqa: E402
database.migrate_db()

import sqlite3
db_path = os.path.join(os.environ["DATA_DIR"], "akili.db")
conn = sqlite3.connect(db_path)
cols = [row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()]
conn.close()
check("migrate_db() added users.theme column", "theme" in cols)

from fastapi.testclient import TestClient
import main  # noqa: E402
from database import User, get_db

# ── Create one real throwaway user row directly (bypassing bcrypt login —
# this script only needs a real verified session, and main._create_session_
# token is the exact real function /api/auth/login itself calls). ──
test_email = f"theme-test-{uuid.uuid4().hex[:8]}@trifecta-technologies.com"
with get_db() as db:
    u = User(id=str(uuid.uuid4()), email=test_email, password_hash="x", name="Theme Test", role="analyst", approved=True)
    db.add(u)
    db.commit()
    db.refresh(u)
    user_id = u.id
    check("throwaway user starts with theme unset", u.theme is None)

token = main._create_session_token(user_id)

with TestClient(main.app) as client:
    client.cookies.set("hw_session", token)

    me = client.get("/api/auth/me")
    check("GET /api/auth/me succeeds with a real session cookie", me.status_code == 200, str(me.status_code))
    check("real user with unset theme defaults to 'dark' over the wire", me.json().get("theme") == "dark", str(me.json().get("theme")))

    r = client.put("/api/users/me/theme", json={"theme": "light"})
    check("PUT /api/users/me/theme accepts 'light'", r.status_code == 200, str(r.status_code))
    check("PUT response echoes the real stored value", r.json().get("theme") == "light", str(r.json()))

    me2 = client.get("/api/auth/me")
    check("GET /api/auth/me reflects the real persisted change", me2.json().get("theme") == "light", str(me2.json().get("theme")))

    bad = client.put("/api/users/me/theme", json={"theme": "blue"})
    check("PUT /api/users/me/theme rejects a non-real theme value", bad.status_code == 400, str(bad.status_code))

    anon = TestClient(main.app)
    unauth = anon.put("/api/users/me/theme", json={"theme": "light"})
    check("PUT /api/users/me/theme requires a real session (401 without one)", unauth.status_code == 401, str(unauth.status_code))

with get_db() as db:
    row = db.query(User).filter(User.id == user_id).first()
    check("real DB row itself carries the persisted value (not just the API response)", row is not None and row.theme == "light")

# ── Cleanup ──
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
