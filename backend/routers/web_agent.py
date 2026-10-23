"""GET /api/web-agent/status — what the web agent (web_agent.py) did today: calls and spend by kind, caps,
incidents enriched, web signals placed, the last pass and the last error. Signed-in only: it shows spend."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Request

router = APIRouter()


def _me(request: Request) -> dict:
    from main import _require_current_user
    return _require_current_user(request)


@router.get("/api/web-agent/status")
async def web_agent_status(request: Request):
    _me(request)
    import web_agent
    return await asyncio.get_running_loop().run_in_executor(None, web_agent.status)
