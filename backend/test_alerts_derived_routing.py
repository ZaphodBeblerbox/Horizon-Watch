"""The derived-alert routes live under /api/alerts/, where a pre-existing
/api/alerts/{alert_id} catch-all could swallow them.

This is not hypothetical tidiness: a shadowed route returns a perfectly
cheerful {"detail": "Alert not found"} with a 404, which looks like "no
surges" rather than "the endpoint does not exist", and nothing on the map
would ever say otherwise.
"""
import re
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

MAIN = Path(__file__).with_name("main.py").read_text(encoding="utf-8")


def _line_of(pattern: str) -> int:
    for i, line in enumerate(MAIN.splitlines(), 1):
        if pattern in line:
            return i
    raise AssertionError(f"not found in main.py: {pattern!r}")


def test_starlette_matches_in_registration_order():
    """The framework behaviour the ordering below relies on."""
    app = FastAPI()

    @app.get("/api/alerts/surges")
    def surges():
        return {"who": "surges"}

    @app.get("/api/alerts/{alert_id}")
    def one(alert_id: str):
        return {"who": "catch-all", "id": alert_id}

    c = TestClient(app)
    assert c.get("/api/alerts/surges").json()["who"] == "surges"
    assert c.get("/api/alerts/ABC-1").json()["who"] == "catch-all"


def test_the_catch_all_wins_if_it_is_registered_first():
    """Stated explicitly so the guard below reads as a real constraint rather
    than a coincidence of line numbers."""
    app = FastAPI()

    @app.get("/api/alerts/{alert_id}")
    def one(alert_id: str):
        return {"who": "catch-all"}

    @app.get("/api/alerts/surges")
    def surges():
        return {"who": "surges"}

    assert TestClient(app).get("/api/alerts/surges").json()["who"] == "catch-all"


def test_main_registers_the_derived_router_before_the_catch_all():
    router_line = _line_of("app.include_router(_alerts_derived_router.router)")
    catch_all_line = _line_of('@app.get("/api/alerts/{alert_id}")')
    assert router_line < catch_all_line, (
        f"/api/alerts/{{alert_id}} (line {catch_all_line}) is registered before the "
        f"derived-alerts router (line {router_line}), so /api/alerts/surges and "
        f"/api/alerts/fusions will 404 as 'Alert not found'."
    )
