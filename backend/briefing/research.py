"""
briefing/research.py — what the internet adds to our own signals.

One call per exposure vector (Claude with the web_search server tool): the
vector, the recipient, the period, and the strongest events we collected
for it. The model searches for corroboration of those events, attribution,
official statements, precedents of the same kind and dated things ahead,
and returns findings as JSON — each a dated claim with its URL, publisher,
source tier (1–5) and whether the publisher is a party.

A finding is kept only if its URL was among the results the search really
returned in that call: a source the model remembered or made up is dropped.
Kept findings are numbered Q-01, Q-02 … by first appearance, one number per
URL, and become the issue's source register next to our own S-ids.

A horizon call (weekly and monthly) looks for dated events in the next 30
to 90 days that touch the recipient — the calendar part.
"""
from __future__ import annotations

import json
import re

from . import llm, spec

SEARCHES = {"daily": 3, "weekly": 5, "monthly": 8}      # per vector
HORIZON_SEARCHES = {"daily": 0, "weekly": 4, "monthly": 8}
EVENTS_PER_VECTOR = {"daily": 6, "weekly": 10, "monthly": 16}

RULES = """You are the research desk of Parallax, a security intelligence service. You search the web to support a
client briefing. You never write the briefing; you return findings.

A finding is one dated, checkable claim from one source you actually opened in this session's searches:
- claim: one or two sentences, in English, specific (who, what, where, when, how many); no opinion of yours
- date: the date the claim refers to (YYYY-MM-DD; the publication date if the event date is not given)
- url, publisher, title: of the page you read; the url exactly as the search returned it
- tier: 1 official document, register or government statement; 2 international agency or leading media; 3 regional or
  foreign-language press; 4 specialist press, analysis, aggregation; 5 institute or vendor (framing only)
- interested: true if the publisher is a party to the matter (a state's ministry or state-aligned media on its own conflict,
  a company on itself, a militant group's channel)
- kind: corroboration (confirms or contradicts one of our events — name its S-id in "sid"), context (explains why
  something happened or what it connects to), precedent (the same kind of act against the same kind of target, earlier),
  attribution (who is assessed to be behind it, by whom), horizon (a dated future event: a trial, a vote, a deadline,
  an announced demonstration, a sanctions date)
- relevance: one sentence on why this matters to the client's exposure vector

Prefer primary and official sources, then leading media. Do not cite aggregators when the original is available.
Never invent a URL. If the searches find nothing useful, return an empty list — that is a valid answer.
Answer with one JSON object only: {"findings": [...]}"""


def _event_line(e: dict) -> str:
    return (f"{e['sid']} | {e['when'][:10]} | {e['category']} | {e.get('place') or e.get('country') or ''} | {e['title']}"
            + (f" — {e['detail'][:200]}" if e.get("detail") else "") + f" | sources: {', '.join(e['sources'][:3])}")


def _profile_lines(profile: dict) -> str:
    sites = "; ".join(f"{s['name']} ({s['kind']}, {s.get('address') or s.get('country') or ''})" for s in profile.get("sites") or [])
    return (f"Client: {profile.get('org') or '—'}. Sectors: {', '.join(profile.get('sectors') or []) or '—'}. "
            f"Products: {', '.join(profile.get('products') or []) or '—'}. Partners: {', '.join(profile.get('partners') or []) or '—'}.\n"
            f"Sites: {sites or '—'}.\nCountries watched: {', '.join(profile.get('countries') or []) or '—'}.")


def _norm_url(u: str) -> str:
    return re.sub(r"[#?].*$", "", (u or "").strip().lower()).rstrip("/").replace("://www.", "://")


def run(profile: dict, evidence: dict, cadence: str, ledger: llm.Ledger, cli=None, progress=None) -> dict:
    """Findings for every active vector (and the horizon). Returns
    {findings: [... with qid], dropped: n, calls: [...]}."""
    events = evidence.get("events") or []
    by_vec: dict[str, list] = {}
    for e in events:
        by_vec.setdefault(e["vector"], []).append(e)
    vectors = [v for v in profile.get("vectors") or [] if by_vec.get(v["id"])]
    vectors.sort(key=lambda v: -sum(e["score"] for e in by_vec[v["id"]]))
    vectors = vectors[:spec.BUDGET[cadence]["sections"]]
    period = f"{evidence['start'][:10]} to {evidence['end'][:10]}"
    raw, dropped, calls = [], 0, []
    jobs = [("vector", v) for v in vectors]
    if HORIZON_SEARCHES[cadence]:
        jobs.append(("horizon", None))
    for i, (kind, v) in enumerate(jobs, 1):
        if progress:
            progress(f"research {i}/{len(jobs)}: {v['name'] if v else 'horizon'}")
        if kind == "vector":
            evs = sorted(by_vec[v["id"]], key=lambda e: -e["score"])[:EVENTS_PER_VECTOR[cadence]]
            user = (f"{_profile_lines(profile)}\n\nExposure vector {v['id']}: {v['name']}"
                    f"{' — keywords: ' + ', '.join(v['keywords']) if v.get('keywords') else ''}.\nReporting period: {period}.\n\n"
                    f"Our own signals for this vector (strongest first):\n" + "\n".join(_event_line(e) for e in evs) +
                    "\n\nSearch for: corroboration or contradiction of the strongest of these events; who is assessed to be behind them; "
                    "official statements; earlier acts of the same kind against the same kind of target in the same country "
                    "(precedents); and what in the period explains them. Return findings.")
            n = SEARCHES[cadence]
        else:
            user = (f"{_profile_lines(profile)}\n\nReporting period: {period}.\n\nSearch for dated events in the next 90 days that "
                    "bear on this client's sites, countries and sectors: court dates, elections and votes, sanctions and export-control "
                    "deadlines, announced strikes and demonstrations, summits, military exercises near their sites. Return findings of "
                    "kind 'horizon' only, each with the date of the future event.")
            n = HORIZON_SEARCHES[cadence]
        try:
            r = llm.call(ledger, f"research:{v['id'] if v else 'horizon'}", RULES, user, max_tokens=6000, web_search=n, cli=cli)
        except llm.CapReached:
            break
        seen = {_norm_url(s["url"]): s for s in r["sources"]}
        data = llm.json_of(r["text"]) or {}
        kept = 0
        for f in data.get("findings") or []:
            if not isinstance(f, dict) or not f.get("url") or not f.get("claim"):
                continue
            if _norm_url(f["url"]) not in seen:
                dropped += 1
                continue
            f["vector"] = v["id"] if v else None
            f["tier"] = int(f.get("tier") or 3) if str(f.get("tier") or "3").isdigit() else 3
            raw.append(f)
            kept += 1
        calls.append({"for": v["id"] if v else "horizon", "kept": kept, "results": len(seen)})
    # one Q-number per URL, in order of first appearance
    by_url: dict[str, dict] = {}
    findings = []
    for f in raw:
        k = _norm_url(f["url"])
        if k not in by_url:
            by_url[k] = {"qid": f"Q-{len(by_url) + 1:02d}", "url": f["url"], "title": f.get("title") or f.get("publisher") or f["url"],
                         "publisher": f.get("publisher") or "", "tier": max(1, min(5, f["tier"])), "interested": bool(f.get("interested")),
                         "reliability": {1: "high", 2: "high", 3: "medium", 4: "medium", 5: "low"}[max(1, min(5, f["tier"]))]}
        findings.append({**f, "qid": by_url[k]["qid"]})
    return {"findings": findings, "register": list(by_url.values()), "dropped": dropped, "calls": calls}


def findings_block(res: dict) -> str:
    """The findings as the writer reads them."""
    lines = []
    for f in res.get("findings") or []:
        lines.append(f"{f['qid']} | {f.get('date') or ''} | {f.get('kind') or ''}{' ' + f['sid'] if f.get('sid') else ''} | "
                     f"tier {f['tier']}{' | INTERESTED PARTY' if f.get('interested') else ''} | {f.get('publisher') or ''} | "
                     f"{f['claim']} | why: {f.get('relevance') or ''}")
    return "\n".join(lines) or "(no findings)"


def as_json(res: dict) -> str:
    return json.dumps(res, ensure_ascii=False)
