"""
briefing/llm.py — every model call a briefing makes, metered.

Claude (spec.MODEL, Opus by default) writes the briefing; nothing else in
the engine calls a model. Each run keeps a Ledger: tokens in (fresh and
cached), tokens out, web searches, and dollars at spec's prices. A call that
would start with the run already at its cap raises CapReached — the run then
finishes what it has with the rehearsal writer instead of overspending.

Calls are streamed (a long section can take minutes; the SDK refuses a
non-streaming request that might). The big shared context — profile,
evidence, findings, plan — goes in the system prompt with cache_control, so
the second and later calls of a run read it at the cached price.
"""
from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field

from . import spec


class CapReached(RuntimeError):
    pass


class Unavailable(RuntimeError):
    """No client: no key, the purpose is off, the monthly budget is spent, or no SDK."""


@dataclass
class Ledger:
    cap_usd: float
    tokens_in: int = 0
    tokens_cached: int = 0
    tokens_cache_write: int = 0
    tokens_out: int = 0
    searches: int = 0
    calls: int = 0
    log: list = field(default_factory=list)

    @property
    def usd(self) -> float:
        return round(self.tokens_in * spec.PRICE_IN / 1e6 + self.tokens_cache_write * spec.PRICE_IN * 1.25 / 1e6
                     + self.tokens_cached * spec.PRICE_CACHED / 1e6 + self.tokens_out * spec.PRICE_OUT / 1e6
                     + self.searches * spec.PRICE_SEARCH, 4)

    def as_dict(self) -> dict:
        return {"usd": self.usd, "cap_usd": self.cap_usd, "tokens_in": self.tokens_in, "tokens_cached": self.tokens_cached,
                "tokens_cache_write": self.tokens_cache_write, "tokens_out": self.tokens_out, "searches": self.searches,
                "calls": self.calls, "log": self.log[-60:]}


_REFUSED: dict = {}          # {"at": epoch, "why": str} — the API said no; believed for 15 minutes


def refused(why: str) -> None:
    _REFUSED.update({"at": time.time(), "why": why})


def client():
    """The Anthropic client for briefings (llm_gate), or raise Unavailable with the reason."""
    import os
    if _REFUSED and time.time() - _REFUSED["at"] < 900:
        raise Unavailable(_REFUSED["why"])
    try:
        import llm_gate
    except Exception as e:                                   # noqa: BLE001
        raise Unavailable(f"llm_gate not importable: {e}")
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise Unavailable("no ANTHROPIC_API_KEY is set")
    if not llm_gate.is_enabled(llm_gate.BRIEFING):
        raise Unavailable("the briefing purpose is switched off (HW_LLM_PURPOSES)")
    if llm_gate.over_budget():
        raise Unavailable(f"the month's Claude budget (HW_LLM_BUDGET_USD = ${llm_gate.BUDGET_USD:.0f}) is spent")
    c = llm_gate.get_client(llm_gate.BRIEFING)
    if c is None:
        raise Unavailable("no client (SDK missing)")
    return c


def call(ledger: Ledger, label: str, system: list[dict] | str, user: str, max_tokens: int = 16000,
         web_search: int = 0, cli=None, allowed_domains: list[str] | None = None) -> dict:
    """One streamed call. Returns {text, sources (web results seen), stop}."""
    if ledger.usd >= ledger.cap_usd:
        raise CapReached(f"cost cap ${ledger.cap_usd:.2f} reached before '{label}'")
    cli = cli or client()
    kw = {"model": spec.MODEL, "max_tokens": max_tokens, "system": system,
          "messages": [{"role": "user", "content": user}]}
    if web_search:
        tool = {"type": "web_search_20250305", "name": "web_search", "max_uses": int(web_search)}
        if allowed_domains:
            tool["allowed_domains"] = allowed_domains
        kw["tools"] = [tool]
    t0 = time.time()
    try:
        with cli.messages.stream(**kw) as stream:
            resp = stream.get_final_message()
    except Exception as e:                                   # noqa: BLE001
        status = getattr(e, "status_code", None)
        msg = str(e)
        if status == 401:
            refused("the Anthropic API key was refused (401: invalid, revoked or for another account)")
            raise Unavailable(_REFUSED["why"]) from e
        if status in (400, 402, 403) and re.search(r"credit|billing|balance|payment", msg, re.I):
            refused("the Anthropic account has no credit left (add credit in the Console)")
            raise Unavailable(_REFUSED["why"]) from e
        raise
    parts, sources = [], []
    for block in resp.content or []:
        bt = getattr(block, "type", None)
        if bt == "text":
            parts.append(block.text or "")
        elif bt == "web_search_tool_result":
            for item in (getattr(block, "content", None) or []):
                url = getattr(item, "url", None)
                if url:
                    sources.append({"url": url, "title": getattr(item, "title", None) or url,
                                    "page_age": getattr(item, "page_age", None)})
    u = resp.usage
    fresh = int(getattr(u, "input_tokens", 0) or 0)
    cached = int(getattr(u, "cache_read_input_tokens", 0) or 0)
    wrote = int(getattr(u, "cache_creation_input_tokens", 0) or 0)
    out = int(getattr(u, "output_tokens", 0) or 0)
    stu = getattr(u, "server_tool_use", None)
    n_search = int(getattr(stu, "web_search_requests", 0) or 0) if stu else 0
    ledger.tokens_in += fresh
    ledger.tokens_cached += cached
    ledger.tokens_cache_write += wrote
    ledger.tokens_out += out
    ledger.searches += n_search
    ledger.calls += 1
    ledger.log.append({"label": label, "in": fresh, "cached": cached, "cache_write": wrote, "out": out, "searches": n_search,
                       "seconds": round(time.time() - t0, 1), "stop": getattr(resp, "stop_reason", None)})
    try:
        import usage_tracker
        usage_tracker.record_call(fresh + cached + wrote, out, call_type="briefing", headline=f"briefing: {label}", model=spec.MODEL)
    except Exception:                                        # noqa: BLE001
        pass
    return {"text": "\n".join(parts), "sources": sources, "stop": getattr(resp, "stop_reason", None)}


def cached_system(rules: str, context: str) -> list[dict]:
    """System prompt: the rules, then the run's shared context, cached together."""
    return [{"type": "text", "text": rules}, {"type": "text", "text": context, "cache_control": {"type": "ephemeral"}}]


def json_of(text: str):
    """The JSON object in a reply (the last fenced block, else the outermost braces)."""
    fences = re.findall(r"```(?:json)?\s*(\{.*?\})\s*```", text or "", re.S)
    for cand in reversed(fences):
        try:
            return json.loads(cand)
        except ValueError:
            continue
    s, e = (text or "").find("{"), (text or "").rfind("}")
    if s >= 0 and e > s:
        try:
            return json.loads(text[s:e + 1])
        except ValueError:
            return None
    return None
