"""Telegram runs on the deployed server only."""
import pytest

import telegram_ingest as tg

RAILWAY = ("RAILWAY_ENVIRONMENT_ID", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT", "TELEGRAM_LOCAL")


def _clear(monkeypatch):
    for k in RAILWAY:
        monkeypatch.delenv(k, raising=False)


def test_the_laptop_never_opens_a_client(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("TELEGRAM_API_ID", "1"); monkeypatch.setenv("TELEGRAM_API_HASH", "x")
    assert not tg.on_server() and not tg.configured()
    with pytest.raises(RuntimeError, match="server only"):
        tg._client()


def test_railway_and_a_deliberate_local_test_may(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "production")
    assert tg.on_server()
    _clear(monkeypatch)
    monkeypatch.setenv("TELEGRAM_LOCAL", "1")
    assert tg.on_server()
