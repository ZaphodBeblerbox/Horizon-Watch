"""The packaged app can stay logged in; a browser is unchanged.

In the DMG the page origin is tauri://localhost while the API is on
another registrable domain, so hw_session is a third-party cookie and
WKWebView blocks it. The cookie was set, never stored, never sent — and
every launch asked for the password again.
"""
import importlib
import uuid

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def app_mod():
    return importlib.import_module("main")


@pytest.fixture
def user(app_mod):
    from database import User, get_db
    from passlib.context import CryptContext
    pwd = CryptContext(schemes=["bcrypt"])
    uid, email, secret = str(uuid.uuid4()), f"px-{uuid.uuid4().hex[:8]}@test.local", "hunter2-hunter2"
    with get_db() as db:
        db.add(User(id=uid, email=email, password_hash=pwd.hash(secret),
                    name="Px", role="analyst", approved=True))
        db.commit()
    yield {"id": uid, "email": email, "password": secret}
    with get_db() as db:
        db.query(User).filter(User.id == uid).delete()
        db.commit()


def _login(app_mod, user, origin=None):
    c = TestClient(app_mod.app)
    h = {"Origin": origin} if origin else {}
    return c, c.post("/api/auth/login",
                     json={"email": user["email"], "password": user["password"]},
                     headers=h)


def test_the_desktop_app_is_given_a_token(app_mod, user):
    _, r = _login(app_mod, user, origin="tauri://localhost")
    assert r.status_code == 200
    assert r.json().get("session_token"), "desktop build got no token to hold"


def test_a_browser_is_never_given_the_token(app_mod, user):
    """Handing a raw JWT to a browser page puts it within reach of any
    injected script — which is what httpOnly exists to prevent."""
    _, r = _login(app_mod, user, origin="http://localhost:5173")
    assert r.status_code == 200
    assert "session_token" not in r.json()


def test_no_origin_is_treated_as_a_browser(app_mod, user):
    _, r = _login(app_mod, user)
    assert "session_token" not in r.json()


def test_a_bearer_token_authenticates_without_any_cookie(app_mod, user):
    _, r = _login(app_mod, user, origin="tauri://localhost")
    token = r.json()["session_token"]
    fresh = TestClient(app_mod.app)          # no cookie jar entry
    assert fresh.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 200
    assert fresh.get("/api/cases", headers={"Authorization": f"Bearer {token}"}).status_code == 200


def test_a_forged_bearer_is_refused(app_mod):
    c = TestClient(app_mod.app)
    assert c.get("/api/cases", headers={"Authorization": "Bearer not.a.real.token"}).status_code == 401
    assert c.get("/api/cases").status_code == 401


def test_the_cookie_still_works_on_its_own(app_mod, user):
    """The browser path must not regress: it keeps the httpOnly cookie."""
    c, r = _login(app_mod, user, origin="http://localhost:5173")
    assert "hw_session" in r.cookies or c.cookies.get("hw_session")
    assert c.get("/api/auth/me").status_code == 200
