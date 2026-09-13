"""
Real throwaway user fixture for the frontend theming E2E regression guard
(tests/e2e/theming.spec.js). Same "real DB row, created and cleaned up
directly" pattern this repo's backend test_*.py scripts already use —
there is no public self-service registration endpoint (accounts are
invite-only/approved), so the Playwright suite shells out to this script
rather than building a second, parallel account-creation mechanism.

Usage:
    cd backend
    python3 e2e_theming_fixture.py create   # idempotent — prints email/password
    python3 e2e_theming_fixture.py cleanup  # deletes the throwaway row
"""
import os, sys

os.environ.setdefault("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
sys.path.insert(0, os.path.dirname(__file__))

from database import get_db, User

EMAIL = "e2e-theming-probe@test.local"
PASSWORD = "ThemingProbe-2026!"


def create():
    from passlib.context import CryptContext
    pwd = CryptContext(schemes=["bcrypt"])
    with get_db() as db:
        u = db.query(User).filter(User.email == EMAIL).first()
        if not u:
            u = User(
                email=EMAIL, name="E2E Theming Probe", password_hash=pwd.hash(PASSWORD),
                role="analyst", is_super_admin=False, approved=True,
                capability_role="security_lead",
            )
            db.add(u)
        else:
            u.password_hash = pwd.hash(PASSWORD)
            u.approved = True
        db.commit()
    print(f"email={EMAIL}")
    print(f"password={PASSWORD}")


def cleanup():
    with get_db() as db:
        db.query(User).filter(User.email == EMAIL).delete(synchronize_session=False)
        db.commit()
    print("cleaned up")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "create"
    if cmd == "create":
        create()
    elif cmd == "cleanup":
        cleanup()
    else:
        print(f"unknown command: {cmd}", file=sys.stderr)
        sys.exit(1)
