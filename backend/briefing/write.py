"""
briefing/write.py — the issue, written by Claude (spec.MODEL, Opus).

Four steps, each a call that returns JSON in the shape the renderer prints
(sample.py is the reference document):

  plan      key judgments, the exposure register, decisions, the section
            plan (which vector, which events and findings, which figure),
            the chronology and a line per asset.
  sections  one call per section, its blocks: paragraphs with a statement
            tag, signal call-outs, tables, figures — and it ends with what
            it means for the reader. Word budget from spec.BUDGET.
  back      scenarios, indicators, calendar, gaps, (monthly) the analyst
            desk and exposure cards, the imagery part's words, method.
  repair    once, for what validate.py could not fix by itself: a missing
            meaning box, an undefined abbreviation, a forecast without a
            date or criterion.

The profile, the evidence, the findings and the plan travel in the system
prompt and are cached: every call after the first reads them at the cached
price. The prose is in the issue's language; keys, ids, tags and bands stay
in their canonical English form (report_language.py learned that the hard
way — a model asked to "write in German" translates the keys too).
"""
from __future__ import annotations

import json

from . import assemble, llm, research, spec, validate
from .countries import name as cname

LANG_NAME = {"de": "German", "en": "English", "fr": "French"}

RULES = """You write Parallax situation reports for one client organisation: the {cadence} issue, in {language}.

The bar is a professional corporate-security intelligence report (a German "Lagebericht"): detailed and concise at once,
easy to understand for a security manager who is not an analyst, every paragraph earning its place.

Rules — all of them, always:
1. Write every word of prose in {language}. JSON keys, ids (S-07, Q-03, V2, KJ-1, I-4), statement tags and band keys stay
   exactly as specified, in English.
2. Every factual sentence cites its evidence: our own signals as [S-07], web findings as [Q-03], several as [S-07, Q-03].
   Cite only ids that exist in the evidence below. Never cite anything else, never invent a source.
3. Every paragraph carries one statement tag: FACT (two independent sources — our corroboration count ≥ 2, or one of ours
   plus an independent finding), REPORTED (one source), REPORTED_INTERESTED (only from a party to the matter),
   OBSERVATION (recorded by our own sensors, without assessment), ASSESSMENT (our conclusion), ASSUMPTION (load-bearing,
   unproven), GAP (needed, not establishable), FORECAST (falsifiable: actor, place, act, a criterion and a date by which
   it is true or false, and the indicator I-xx that would show it first).
4. Probabilities only as one of the named bands with its numbers: remote 1–5, very_unlikely 5–20, unlikely 20–45,
   even 45–55, likely 55–80, very_likely 80–95, almost_certain 95–99. Confidence (low / medium / high) is separate and
   describes the evidence, never the likelihood. Never write a bare percentage or a category rate.
5. Explain every abbreviation at its first use in the text ("AIS (das Selbstmeldeverfahren von Schiffen)") and list it in
   the glossary you return. No jargon without a plain-language gloss.
6. Relevance is the client's: say why each event bears on THIS client's site, people or business — distance, the same
   kind of target, the same supply chain. Leave out what does not. Never generic advice ("stay vigilant"); a measure names
   who does what, where, by when.
7. Every section ends with a block of type "meaning": what it means for {org}, in two to four sentences, concrete.
8. Place names are real places. Never write "Unknown Location"; if a place is not known, say what is known (the sea area,
   the country, the distance from the site).
9. Short sentences. Active voice. Numbers as digits. Dates in the {language} convention.
10. Answer with exactly one JSON object and nothing else."""

BLOCKS = """Block types (a section's "blocks" list, in reading order):
  {"type": "p", "tag": "<TAG>", "text": "..."}                        a paragraph; **bold** allowed; references in [ ]
  {"type": "h3", "text": "..."}                                        a minor heading inside a subsection
  {"type": "list", "items": ["...", "..."]}                            a short list (measures, indicators)
  {"type": "table", "columns": ["..",".."], "rows": [["..",".."]], "caption": ".."}
  {"type": "signal", "id": "S-07", "text": "what the signal says", "meta": "date · place · source"}   a call-out of one of our signals
  {"type": "figure", "figure": "F1"}                                   a figure from the list below
  {"type": "org_card", "code": "GRU", "name": "...", "subtitle": "...", "tag": "ORG", "rows": [["Auftrag", "..."], ["Vorgehen", "..."], ["Nachweis", "... [Q-03]"]]}
  {"type": "meaning", "text": "..."}                                   what it means for the client — last block of every section"""


def context(profile: dict, evidence: dict, res: dict, cadence: str, lang: str) -> str:
    """The run's shared context: who, what we saw, what the web added."""
    sites = []
    for s in evidence.get("sites") or []:
        sites.append(f"- {s['id']} {s['name']} | {s['kind_label']} | {s.get('place') or ''} | importance {s.get('importance')} | "
                     f"events at site {s['events']}, precedents {s['precedents']}"
                     + (f" | console's latest note (background, not citable): {s['brief'][:300]}" if s.get("brief") else ""))
    vectors = [f"- {v['id']} {v['name']} | takes: {', '.join(v.get('categories') or [])} | sites: {', '.join(v.get('sites') or []) or '—'} | "
               f"countries: {', '.join(cname(c, lang) for c in v.get('countries') or []) or '—'} | decision area: {v.get('decision_area') or '—'}"
               for v in profile.get("vectors") or []]
    ev = []
    for e in evidence.get("events") or []:
        line = (f"{e['sid']} | {e['when'][:16]} | {e['vector']} | {e['category']} | reach: {e['reach']}"
                + (f" ({e['km']} km from {e['site']})" if e.get("km") is not None and e.get("site") else "")
                + f" | {e.get('place') or cname(e.get('country'), 'en') or ''} | {e['title']}"
                + (f" — {e['detail'][:260]}" if e.get("detail") else "")
                + f" | sources: {', '.join(e['sources'][:4])} | corroboration {e['corroboration']}"
                + (" | ONLY INTERESTED PARTIES" if e.get("interested_only") else "")
                + (f" | standing condition: {e['days_active']} days, {e['reports']} reports, places {', '.join(e.get('places') or [])}" if e.get("pattern") else "")
                + (f" | recurred on {', '.join(e['recurring'])}" if e.get("recurring") else "")
                + (" | IMAGE CROP AVAILABLE" if e.get("image") else ""))
        ev.append(line)
    f = evidence.get("funnel") or {}
    figs = ["F1 — map of the period's events, numbered by S-id"] + (["F2 — signals per day (bar chart)"] if cadence != "daily" else [])
    return "\n".join([
        f"CLIENT: {profile.get('org') or '—'} · addressee: {profile.get('addressee') or '—'}",
        f"Sectors: {', '.join(profile.get('sectors') or []) or '—'} · products: {', '.join(profile.get('products') or []) or '—'} · "
        f"partners: {', '.join(profile.get('partners') or []) or '—'} · policy areas: {', '.join(profile.get('policy_areas') or []) or '—'}",
        f"Notes from the client: {profile.get('notes') or '—'}",
        "", "SITES AND ASSETS:", *sites,
        "", "EXPOSURE VECTORS:", *vectors,
        "", f"PERIOD: {evidence['start'][:16]} to {evidence['end'][:16]} ({evidence.get('days')} days)",
        f"Collection: {f.get('read', 0)} signals read, {f.get('reached', 0)} reached a vector, {f.get('events', 0)} events after merging "
        f"({f.get('corroborated', 0)} corroborated), {f.get('used', 0)} below.",
        "", "OUR SIGNALS (S-ids; cite these):", *ev,
        "", "WEB FINDINGS (Q-ids; cite these):", research.findings_block(res),
        "", "FIGURES AVAILABLE:", *figs,
    ])


def _system(profile, evidence, res, cadence, lang, extra: str = "") -> list[dict]:
    rules = RULES.format(cadence=cadence, language=LANG_NAME[lang], org=profile.get("org") or "the client") + "\n\n" + BLOCKS
    return llm.cached_system(rules, context(profile, evidence, res, cadence, lang) + (("\n\nPLAN:\n" + extra) if extra else ""))


def _ask(ledger, label, system, user, max_tokens, cli):
    r = llm.call(ledger, label, system, user, max_tokens=max_tokens, cli=cli)
    data = llm.json_of(r["text"])
    if not isinstance(data, dict):
        raise ValueError(f"{label}: no JSON in the reply (stop={r['stop']})")
    return data


PLAN_ASK = """Plan the {cadence} issue. Return:
{{
 "key_judgments": [ {kj} items: {{"id": "KJ-1", "title": "one sentence, the consequence first", "body": "3–5 sentences with references",
                    "band": "<band key>", "low": n, "high": n, "confidence": "low|medium|high", "change": "new | unchanged | up from … | down from …"}} ],
 "exposure": {{"lead": "...", "vectors": [{{"id": "V1", "name": "...", "level": 1-5, "prev": "—" or 1-5, "delta": "▲ | ▲▲ | ▼ | —",
              "drivers": "what moved it, with references", "decision": "the decision it touches"}}], "movement": "a paragraph"}},
 "decisions": {{"lead": "...", "items": [{{"id": "E-1", "what": "...", "vector": "V1", "owner": "a role in the client", "due": "a date",
                "urgency": "high|medium|low", "rationale": "why, with references"}}], "footnote": "..."}},
 "sections": [ {sections} items: {{"id": "s1", "number": "1", "kicker": "SECTION 1 in {language}", "title": "...", "lead": "one sentence",
               "vectors": ["V1"], "subsections": [{{"title": "...", "covers": "what it says", "sids": ["S-01"], "qids": ["Q-02"],
               "figure": "F1 or null"}}]}} ],
 "chronology": {{"lead": "...", "rows": [ up to {chrono}: {{"date": "...", "event": "one line with reference", "vector": "V1", "tag": "<TAG>"}} ], "meaning": "..."}},
 "sites": {{"<asset id>": "two or three sentences: what the period held for this asset and what follows, with references"}},
 "glossary": [{{"term": "...", "meaning": "..."}}]
}}
Order key judgments and sections by consequence for the client. One section per vector that matters (merge thin ones);
{subs} subsections per section. A vector without relevant events gets level 1 and no section. {daily_note}"""

SECTION_ASK = """Write section {id} "{title}" as planned. About {words} words of prose in total, in {language}.
Return {{"lead": "one sentence", "subsections": [{{"title": "...", "blocks": [...]}}]{flat}}}.
Use the planned events and findings; quote what our signals recorded (with S-ids) and add what the findings say (Q-ids).
Use a "signal" block for the one or two signals the section turns on. Put the planned figure where it belongs.
The last block of the last subsection is the "meaning" block."""

BACK_ASK = """Write the back matter of the {cadence} issue in {language}. Return:
{{
 {scen}"indicators": {{"lead": "...", "rows": [ {ind} items: {{"id": "I-1", "name": "...", "threshold": "...", "current": "...", "trend": "rising|falling|flat",
                 "lead": "lead time"}} ], "note": "..."}},
 {cal}"gaps": {{"rows": [{{"id": "L-1", "what": "what we could not establish", "why": "why it matters", "clarify": "how it could be clarified"}}],
          "excluded": [{{"title": "...", "text": "what was left out and why"}}]}},
 "imagery": {{"lead": "one sentence", "meaning": "what our own imagery shows for the client"}},
 "method": {{"procedure": "how this issue was made: collection, merging, research, writing", "checks": [["check", "yes|no"]],
           "weakest": "the weakest point of this issue", "internal": "what to check internally before deciding", "limits": "..."}},
 {desk}"glossary": [{{"term": "...", "meaning": "..."}}]
}}
Indicators are measurable and tied to the forecasts (FORECAST paragraphs name them by id)."""

SCEN = """"scenarios": {"lead": "...", "items": [4 items: {"key": "A", "title": "...", "p": percent as integer (the four sum to 100), "text": "...",
              "trigger": "what would show this branch", "measure": "what to do then"}], "note_title": "...", "note": "..."},
 """
CAL = """"calendar": {"rows": [{"when": "date", "what": "...", "vector": "V1", "why": "...  [Q-xx]"}],
              "wildcards": [{"title": "...", "p": "band numbers, e.g. 5–20 %", "text": "...", "precaution": "the cheapest precaution"}]},
 """
DESK = """"analyst_desk": {"kicker": "...", "question": "the one question this month turns on", "why": "...",
     "hypotheses": [{"id": "H1", "text": "...", "consequence": "..."}], "matrix": [{"label": "E1 evidence with reference", "diagnostic": true|false,
     "scores": ["++|+|o|-|--" per hypothesis]}], "evaluation": "...", "assessment": "...",
     "assumptions": [{"id": "A1", "text": "...", "confidence": "low|medium|high", "breaks": "what would break it"}],
     "counter": "the strongest argument against our assessment", "counter_reply": "...",
     "would_change": [{"id": "W1", "event": "...", "deadline": "...", "effect": "..."}], "analogues": [{"title": "...", "text": "..."}]},
 "exposure_cards": [one per vector at level 3 or more: {"id": "K1", "title": "vector name", "sub": "previous level · driver", "tag": "V1 · LEVEL n in the language",
     "rows": [["what changed", "..."], ["why it matters", "..."], ["decision", "E-x by date"], ["trigger", "..."]]}],
 """

REPAIR_ASK = """Validation found these problems in the issue. Fix them, in {language}. Return:
{{"meanings": {{"<section id>": "the missing meaning paragraph"}},
  "glossary": [{{"term": "...", "meaning": "plain-language explanation"}}],
  "forecasts": [{{"old_start": "the first 60 characters of the paragraph", "text": "the rewritten FORECAST paragraph with actor, place, act, criterion, date and I-id"}}]}}
Problems:
{problems}"""


def build(profile: dict, evidence: dict, res: dict, cadence: str, lang: str, start, end, ledger: llm.Ledger,
          cli=None, run_id: str = "", progress=None) -> dict:
    B = spec.BUDGET[cadence]
    parts = set(spec.parts_for(cadence))
    from .profile import localise
    import copy
    profile = localise(copy.deepcopy(profile), lang)
    language = LANG_NAME[lang]
    say = progress or (lambda m: None)

    say("plan")
    sys0 = _system(profile, evidence, res, cadence, lang)
    plan = _ask(ledger, "plan", sys0, PLAN_ASK.format(
        cadence=cadence, kj=B["kj"], sections=B["sections"], language=language, chrono=B["chrono"],
        subs={"daily": "no", "weekly": "two or three", "monthly": "three or four"}[cadence],
        daily_note="Daily: sections have no subsections — give each one subsection entry only to list its sids and qids." if cadence == "daily" else ""),
        max_tokens=16000, cli=cli)

    system = _system(profile, evidence, res, cadence, lang, extra=json.dumps(plan, ensure_ascii=False))
    sections = []
    for i, sp in enumerate(plan.get("sections") or [], 1):
        say(f"section {i}/{len(plan.get('sections') or [])}: {sp.get('title')}")
        flat = ', "blocks": [] (daily: put all blocks here and leave subsections empty)' if cadence == "daily" else ""
        sec = _ask(ledger, f"section:{sp.get('id')}", system,
                   SECTION_ASK.format(id=sp.get("id"), title=sp.get("title"), words=B["words"], language=language, flat=flat),
                   max_tokens=min(32000, B["words"] * 6 + 4000), cli=cli)
        subs = []
        for j, sub in enumerate(sec.get("subsections") or [], 1):
            subs.append({"id": f"s{i}_{j}", "number": f"{i}.{j}", "title": sub.get("title") or "", "blocks": sub.get("blocks") or []})
        sections.append({"id": f"s{i}", "number": str(i), "kicker": sp.get("kicker") or "", "title": sp.get("title") or "",
                         "lead": sec.get("lead") or sp.get("lead") or "", "subsections": subs if cadence != "daily" else [],
                         "blocks": (sec.get("blocks") or [b for s in subs for b in s["blocks"]]) if cadence == "daily" else []})

    back = {}
    if parts & {"scenarios", "indicators", "calendar", "gaps", "method", "analyst_desk"}:
        say("back matter")
        back = _ask(ledger, "back", system, BACK_ASK.format(
            cadence=cadence, language=language, ind=B["indicators"],
            scen=SCEN if "scenarios" in parts else "", cal=CAL if "calendar" in parts else "",
            desk=DESK if "analyst_desk" in parts else ""), max_tokens=24000, cli=cli)

    m = assemble.meta(profile, cadence, lang, start, end, run_id)
    m["domains"] = assemble.domains(evidence)
    figs = assemble.figure_set(evidence, lang)
    site_text = plan.get("sites") or {}
    doc = {"meta": m, "key_judgments": plan.get("key_judgments") or [], "sections": sections, "figures": figs,
           "sites": [{**s, "text": site_text.get(s["id"], "")} for s in evidence.get("sites") or []]}
    for k in ("exposure", "decisions", "chronology"):
        if k in parts and plan.get(k):
            doc[k] = plan[k]
    for k in ("scenarios", "indicators", "calendar", "gaps", "method", "analyst_desk", "exposure_cards"):
        if k in parts and back.get(k):
            doc[k] = back[k]
    if "how_to_read" in parts:
        from .rehearsal import P
        h = P[lang]["htr"]
        doc["how_to_read"] = {"bands": h[0], "confidence": h[1], "layout_title": h[2], "layout": h[3], "provenance_title": h[4], "provenance": h[5]}
    if "imagery" in parts:
        im = assemble.imagery_part(evidence, lang, first_number=len(figs) + 1)
        if im["items"]:
            im.update({k: v for k, v in (back.get("imagery") or {}).items() if k in ("lead", "meaning")})
            doc["imagery"] = im
    doc["glossary"] = (plan.get("glossary") or []) + (back.get("glossary") or [])
    doc["sources"] = assemble.sources(res.get("register") or [], evidence, doc, lang)

    # validate, then one repair pass for what needs words
    sids = {e["sid"] for e in evidence.get("events") or []}
    issues = validate.fix(doc, sids)
    todo = validate.needs_words(issues)
    if todo:
        say("repair")
        try:
            fix = _ask(ledger, "repair", system, REPAIR_ASK.format(language=language, problems=json.dumps(todo, ensure_ascii=False)),
                       max_tokens=8000, cli=cli)
            apply_repair(doc, fix)
            issues = validate.fix(doc, sids)
        except (llm.CapReached, ValueError) as e:
            issues.append({"kind": "repair_skipped", "reason": str(e), "auto": True})
    doc["sources"] = assemble.sources(res.get("register") or [], evidence, doc, lang)
    doc["meta"]["qa_issues"] = issues
    return doc


def apply_repair(doc: dict, fix: dict) -> None:
    for sid, text in (fix.get("meanings") or {}).items():
        s = next((x for x in doc.get("sections") or [] if x["id"] == sid), None)
        if not s or not text:
            continue
        target = s["subsections"][-1]["blocks"] if s.get("subsections") else s.setdefault("blocks", [])
        target.append({"type": "meaning", "text": text})
    gl = {g["term"]: g for g in doc.get("glossary") or []}
    for g in fix.get("glossary") or []:
        if g.get("term") and g.get("meaning"):
            gl[g["term"]] = {"term": g["term"], "meaning": g["meaning"]}
    doc["glossary"] = list(gl.values())
    for f in fix.get("forecasts") or []:
        start = (f.get("old_start") or "")[:40]
        if not start or not f.get("text"):
            continue
        for s in doc.get("sections") or []:
            for b in list(s.get("blocks") or []) + [b for sub in s.get("subsections") or [] for b in sub["blocks"]]:
                if b.get("type") == "p" and b.get("tag") == "FORECAST" and (b.get("text") or "").startswith(start):
                    b["text"] = f["text"]
