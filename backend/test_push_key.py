"""Web push signs with the VAPID key. Passed as PEM text, pywebpush could
not read it and every send failed silently (2026-10-10)."""
import base64
import re

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid


def _pem():
    return re.search(r'_VAPID_PRIVATE_KEY = """(.*?)"""', open("main.py").read(), re.S).group(1)


def test_the_key_loads_as_a_key_object():
    assert Vapid.from_pem(_pem().encode()).private_key is not None


def test_the_frontend_holds_the_matching_public_key():
    pub = Vapid.from_pem(_pem().encode()).public_key.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    fe = re.search(r"VAPID_PUBLIC_KEY = '([^']+)'", open("../src/utils/pushNotifications.js").read()).group(1)
    assert base64.urlsafe_b64encode(pub).rstrip(b"=").decode() == fe


def test_send_push_uses_the_object_not_the_text():
    src = open("main.py").read()
    body = src[src.index("def _send_push"):src.index("def _broadcast_push")]
    assert "vapid_private_key=_VAPID_KEY" in body
