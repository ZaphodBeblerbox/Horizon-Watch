"""Push subscriptions must survive a restart.

They used to be a module-level dict. A dict does not survive a restart, so
every deploy silently unsubscribed everyone: the browser still believed it
was subscribed, the server had nothing to send to, and nobody found out
until they noticed alerts had stopped. A notification channel that fails
silently is worse than none, because it is trusted.
"""
import importlib
import json
import uuid

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def app_mod():
    return importlib.import_module("main")


@pytest.fixture
def user(app_mod):
    from database import User, PushSubscription, get_db
    uid = str(uuid.uuid4())
    with get_db() as db:
        db.add(User(id=uid, email=f"push-{uid[:8]}@test.local", password_hash="x",
                    name="Push", role="analyst", approved=True))
        db.commit()
    yield uid
    with get_db() as db:
        db.query(PushSubscription).filter(PushSubscription.user_id == uid).delete()
        db.query(User).filter(User.id == uid).delete()
        db.commit()


def _client_as(app_mod, user_id):
    from jose import jwt
    token = jwt.encode({"sub": user_id}, app_mod.JWT_SECRET, algorithm=app_mod.JWT_ALGORITHM)
    c = TestClient(app_mod.app)
    c.cookies.set("hw_session", token)
    return c


SUB_A = {"endpoint": "https://push.example/a", "keys": {"p256dh": "k", "auth": "a"}}
SUB_B = {"endpoint": "https://push.example/b", "keys": {"p256dh": "k", "auth": "a"}}


def test_a_subscription_is_stored_in_the_database(app_mod, user):
    from database import PushSubscription, get_db
    c = _client_as(app_mod, user)
    assert c.post("/api/push/subscribe", json=SUB_A).status_code == 200

    # In the database, not in a dict that a restart would empty.
    with get_db() as db:
        rows = db.query(PushSubscription).filter(PushSubscription.user_id == user).all()
        assert len(rows) == 1
        assert json.loads(rows[0].subscription)["endpoint"] == SUB_A["endpoint"]


def test_two_devices_both_stay_subscribed(app_mod, user):
    """A laptop and a phone are two endpoints. The old dict was keyed by
    user and could only ever hold whichever subscribed last."""
    from database import PushSubscription, get_db
    c = _client_as(app_mod, user)
    c.post("/api/push/subscribe", json=SUB_A)
    c.post("/api/push/subscribe", json=SUB_B)

    with get_db() as db:
        endpoints = {json.loads(r.subscription)["endpoint"]
                     for r in db.query(PushSubscription).filter(PushSubscription.user_id == user).all()}
    assert endpoints == {SUB_A["endpoint"], SUB_B["endpoint"]}


def test_resubscribing_the_same_browser_does_not_duplicate(app_mod, user):
    from database import PushSubscription, get_db
    c = _client_as(app_mod, user)
    c.post("/api/push/subscribe", json=SUB_A)
    c.post("/api/push/subscribe", json=SUB_A)

    with get_db() as db:
        assert db.query(PushSubscription).filter(PushSubscription.user_id == user).count() == 1


def test_unsubscribe_removes_one_endpoint_not_all(app_mod, user):
    from database import PushSubscription, get_db
    c = _client_as(app_mod, user)
    c.post("/api/push/subscribe", json=SUB_A)
    c.post("/api/push/subscribe", json=SUB_B)

    c.post("/api/push/unsubscribe", json={"endpoint": SUB_A["endpoint"]})
    with get_db() as db:
        left = [json.loads(r.subscription)["endpoint"]
                for r in db.query(PushSubscription).filter(PushSubscription.user_id == user).all()]
    assert left == [SUB_B["endpoint"]]


def test_subscribing_requires_a_session(app_mod):
    """An anonymous subscription keyed off X-Forwarded-For addresses a
    header the client controls, which is not an identity — and behind a
    proxy it is frequently the same value for everyone."""
    assert TestClient(app_mod.app).post("/api/push/subscribe", json=SUB_A).status_code == 401


def test_the_alert_gate_does_not_read_the_removed_dict(app_mod):
    """The gate used to be `... and _PUSH_SUBS`. With subscriptions in the
    database that dict is always empty, so the condition would never be
    true again and alert push would stop without one error line."""
    import inspect
    src = inspect.getsource(app_mod)
    gate = [ln for ln in src.splitlines()
            if 'tier in ("critical", "significant")' in ln and "_WEBPUSH_OK" in ln]
    assert gate, "alert push gate not found"
    assert not any("_PUSH_SUBS" in ln for ln in gate)
