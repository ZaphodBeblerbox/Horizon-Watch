"""voice_ai.py — the sentence the rules could not place.

CHEAP BY STRUCTURE, NOT BY HOPE. Four things keep this inside ten euros a
month, in the order they matter:

1. THE RULES GO FIRST AND THE MODEL NEVER SEES MOST SENTENCES.
   voiceCommands.js resolves the ordinary phrasings — "fly to Yemen",
   "message Hannes", "file this under vessels" — for nothing. This is only
   reached when the parser says it is not confident, which on a normal day
   is a handful of sentences.

2. THE PROMPT IS SMALL AND FIXED. The model gets the sentence, the list of
   intents it may choose from, and the few names it might need to match.
   Not the app state, not the roster's emails, not the signal. A short,
   unchanging system prompt is also the part a provider can cache.

3. THE ANSWER IS SHORT. max_tokens is 150 and the format is JSON. Output
   costs four times input, so the cheapest thing a model can do is stop.

4. IDENTICAL SENTENCES COST ONCE. The same command said twice in an hour
   is answered from a small in-process cache.

THE MODEL PROPOSES, THE SERVER DISPOSES. It returns an intent name and
slots, never an action. The intent is checked against an allowlist and the
slots are coerced here, so a model that invents "delete_everything" gets a
refusal rather than a dispatch. It also never receives an id it could not
already see, and cannot return one it was not given.
"""
from __future__ import annotations

import json
import time

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api/voice", tags=["voice"])

MAX_UTTERANCE = 400
MAX_TOKENS = 150
CACHE_TTL = 3600
_cache: dict[str, tuple[float, dict]] = {}

# What the model may choose. Deliberately a SUBSET of what the rule parser
# can do: the destructive and the irreversible are not on the list, because
# a guessed "delete" is a different kind of wrong from a guessed "fly to".
INTENTS = {
    "navigate":   "fly the map to a place (country, city, strait, port, base, coordinates). slots: place",
    "search": ("look something up in the search box and open the best match — a place, a ship or aircraft by "
               "name, a signal, a theater. Use for 'search for X', 'find X', 'look up X', 'where is X', and for a "
               "named vessel or aircraft. slots: query"),
    "explain": ("explain what is happening in a place, from the signals we hold — 'what is going on in X', "
                "'the latest in X', 'brief me on X'. slots: place"),
    "risk":       "show the risk index for a place. slots: place",
    "open_page":  "open a page of the console. slots: page (one of the pages listed)",
    "layer": ("switch a map layer on or off. slots: layer (one of the layers listed), on (true to show, false to "
              "hide, null to flip)"),
    "zoom":       "zoom the map. slots: direction ('in' or 'out')",
    "send_situation": ("send somebody the current picture for a place — 'send the situation in X to Y'. "
                       "slots: place, recipient"),
    "message":    "send a written message to a person or group. slots: recipient, text",
    "note":       "write a note. slots: text",
    "create_folder": "make a folder in the case files. slots: name",
    "file_to":    "file the selected thing into a named folder. slots: folder",
    "add_to_basket": "add the selected thing to the briefing basket. slots: none",
    "generate_briefing": "open the briefing generator. slots: none",
    "none":       "nothing in this sentence is an instruction to the console",
}

# The pages and map layers a sentence may name — the console's own keys.
PAGES = {
    "home": "Home (the day's overview)", "situation": "the Map", "inbox": "Inbox (all signals)",
    "dossiers": "Dossiers", "analytics": "Analytics", "replay": "Replay (history)", "imagery": "Imagery (satellite)",
    "briefings": "Briefings", "cases": "Cases (files)", "ontology": "Ontology (the graph)", "forecast": "Forecast",
    "team": "Team",
}
LAYERS = {
    "vessels": "ships (AIS)", "aircraft": "aircraft (ADS-B)", "sanctioned_only": "only sanctioned ships",
    "heat": "fires / heat (FIRMS)", "imagery_signals": "imagery signals", "satellite_image": "the satellite base image",
    "gdelt": "news events (GDELT)", "telegram": "Telegram reports", "geoconfirmed": "GeoConfirmed (verified footage)",
    "gps_interference": "GPS jamming", "airspace": "airspace closures", "risk": "country risk shading",
    "frontlines": "frontlines", "flows": "trade and energy flows", "aois": "areas of interest", "labels": "place labels",
    "cables": "undersea cables", "ports": "ports", "airfields": "airports and airfields", "chokepoints": "chokepoints",
    "power": "power plants", "military_sites": "military facilities", "alerts": "alerts", "zones": "zones",
}
MAX_STEPS = 3

SYSTEM = (
    "You turn one spoken sentence from an intelligence analyst into what the console should do: one to three "
    "steps, in order. The sentence is dictated, so expect filler words, run-ons and misheard names; read the intent.\n"
    "Reply with JSON only: {\"steps\": [{\"intent\": <name>, \"slots\": {...}}], \"confidence\": 0-1}.\n"
    "Choose intents ONLY from the list given, pages and layers ONLY from their lists. 'Show me fires in Yemen' is "
    "two steps: layer heat on, then navigate Yemen. 'Search for Dubai' is search. A ship or aircraft name is search. "
    "If the sentence is not an instruction, or you cannot tell what it asks, answer {\"steps\": []}.\n"
    "Never invent a name, place or folder that is not in the sentence; fix only obvious dictation misspellings of "
    "place names (\"hormoose\" -> \"Hormuz\")."
)


def _me(request: Request) -> dict:
    from main import _require_current_user
    return _require_current_user(request)


def _clean(intent: str, slots: dict, ctx: dict) -> dict | None:
    """Coerce what came back into something safe, or None.

    Every slot is a string the model copied out of the sentence. A
    recipient is matched against the names the CALLER already supplied, so
    the model cannot address somebody it was never shown.
    """
    if intent not in INTENTS or intent == "none":
        return None
    slots = {k: (str(v)[:200] if v is not None else None) for k, v in (slots or {}).items()}

    if intent == "send_situation":
        place = (slots.get("place") or "").strip()
        want = (slots.get("recipient") or "").strip().lower()
        if not place or not want:
            return None
        for p in (ctx.get("people") or []):
            name = str(p.get("name") or "")
            if want in name.lower() or name.lower().split(" ")[0] == want:
                return {"intent": intent, "slots": {
                    "place": place, "id": p.get("id"),
                    "kind": p.get("kind") or "user", "name": name,
                }}
        return None

    if intent == "message":
        want = (slots.get("recipient") or "").strip().lower()
        text = (slots.get("text") or "").strip()
        if not want or not text:
            return None
        for p in (ctx.get("people") or []):
            name = str(p.get("name") or "")
            if want and (want in name.lower() or name.lower().split(" ")[0] == want):
                return {"intent": intent, "slots": {
                    "id": p.get("id"), "kind": p.get("kind") or "user",
                    "name": name, "text": text,
                }}
        return None

    if intent == "open_page":
        page = (slots.get("page") or "").strip().lower()
        page = {"map": "situation"}.get(page, page)
        return {"intent": intent, "slots": {"page": page}} if page in PAGES else None

    if intent == "layer":
        layer = (slots.get("layer") or "").strip().lower().replace(" ", "_")
        if layer not in LAYERS:
            return None
        on = str(slots.get("on")).strip().lower()             # "True"/"False"/"None" after coercion
        return {"intent": intent, "slots": {"layer": layer,
                                            "on": True if on == "true" else False if on == "false" else None}}

    if intent == "zoom":
        d = (slots.get("direction") or "").strip().lower()
        return {"intent": intent, "slots": {"direction": d}} if d in ("in", "out") else None

    for required in {"navigate": ["place"], "risk": ["place"], "explain": ["place"], "search": ["query"],
                     "create_folder": ["name"], "file_to": ["folder"],
                     "note": ["text"], "filter": ["text"]}.get(intent, []):
        if not (slots.get(required) or "").strip():
            return None
    return {"intent": intent, "slots": slots}


def read_answer(parsed: dict, ctx: dict) -> dict:
    """The model's steps, each checked; a single-intent answer is one step.
    The first step stays at the top level for older callers."""
    raw = parsed.get("steps")
    if not isinstance(raw, list):
        raw = [{"intent": parsed.get("intent"), "slots": parsed.get("slots")}] if parsed.get("intent") else []
    steps = []
    for st in raw[:MAX_STEPS]:
        if isinstance(st, dict):
            c = _clean(str(st.get("intent") or ""), st.get("slots") if isinstance(st.get("slots"), dict) else {}, ctx)
            if c:
                steps.append(c)
    if not steps:
        return {"ok": False, "intent": None, "steps": [],
                "why": "That did not resolve to anything this console can do."}
    try:
        conf = float(parsed.get("confidence") or 0.0)
    except (TypeError, ValueError):
        conf = 0.0
    return {"ok": True, **steps[0], "steps": steps, "confidence": conf}


@router.get("/ai-status")
def ai_status(request: Request):
    """Whether the fallback is available, and what is left of the budget."""
    _me(request)
    import openai_gate
    return openai_gate.status()


@router.post("/interpret")
async def interpret(request: Request):
    """One sentence in, one intent out.

    Body: {text, people?: [{id, name, kind}], selected?: bool}
    """
    import openai_gate
    _me(request)
    body = await request.json()
    text = (body.get("text") or "").strip()[:MAX_UTTERANCE]
    if not text:
        raise HTTPException(status_code=400, detail="nothing was said")

    ctx = {
        # Names only. The model has no use for an email and no business
        # with one.
        "people": [{"id": p.get("id"), "name": str(p.get("name") or "")[:60],
                    "kind": p.get("kind") or "user"}
                   for p in (body.get("people") or [])][:40],
        "selected": bool(body.get("selected")),
        "page": str(body.get("page") or "")[:30] or None,
    }

    key = f"{text.lower()}|{ctx['page']}|{','.join(sorted(p['name'] for p in ctx['people']))}"
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return {**hit[1], "cached": True}

    client = openai_gate.get_client(openai_gate.VOICE)
    if client is None:
        st = openai_gate.status()
        return {
            "ok": False, "intent": None,
            "why": ("The month's model budget is spent."
                    if st["over_budget"] else
                    "The spoken-command fallback is not configured."),
            "status": st,
        }

    model = openai_gate.model_for(openai_gate.VOICE)
    menu = "\n".join(f"- {k}: {v}" for k, v in INTENTS.items())
    pages = ", ".join(f"{k} ({v})" for k, v in PAGES.items())
    layers = ", ".join(f"{k} ({v})" for k, v in LAYERS.items())
    who = ", ".join(p["name"] for p in ctx["people"]) or "nobody"
    user = (f"Sentence: {text}\n\n"
            f"Intents:\n{menu}\n\n"
            f"Pages: {pages}\n"
            f"Map layers: {layers}\n"
            f"Page open now: {ctx['page'] or 'unknown'}\n"
            f"People and groups that can be addressed: {who}\n"
            f"Something is selected on the map: {'yes' if ctx['selected'] else 'no'}")

    try:
        resp = client.chat.completions.create(
            model=model,
            max_tokens=MAX_TOKENS + 100,
            temperature=0,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": SYSTEM},
                      {"role": "user", "content": user}],
        )
    except Exception as e:
        return {"ok": False, "intent": None, "why": f"The model did not answer: {e}"}

    usage = getattr(resp, "usage", None)
    if usage:
        try:
            import usage_tracker
            usage_tracker.record_call(
                input_tokens=usage.prompt_tokens, output_tokens=usage.completion_tokens,
                call_type="voice", model=model, headline=text[:80])
        except Exception:
            pass   # accounting must never break the thing it is accounting for

    try:
        parsed = json.loads(resp.choices[0].message.content or "{}")
    except (json.JSONDecodeError, IndexError, AttributeError):
        return {"ok": False, "intent": None, "why": "The model did not answer in the agreed format."}

    out = read_answer(parsed, ctx)

    _cache[key] = (time.time(), out)
    if len(_cache) > 500:
        for k in sorted(_cache, key=lambda k: _cache[k][0])[:200]:
            _cache.pop(k, None)
    return out


# ── "send the current situation in Niger to Hannes" ──────────────────────
#
# A compound sentence: a place, a recipient, and an implied verb that means
# "gather what we have and hand it over". Doing it in one step matters —
# the alternative is open the map, filter to Niger, read, write a summary,
# find the chat, paste. That is the work the sentence replaces.

SITUATION_LIMIT = 40


def _match_place(location: str, place: str) -> bool:
    """Does this item's location string name this place?

    The pool stores "City, Region, Country", so a country matches on the
    tail and a city on the head. Matched on whole comma-separated parts
    rather than as a substring, because "Niger" is inside "Nigeria" and
    those are different countries with a shared border and a war near it.
    """
    if not location or not place:
        return False
    want = place.strip().lower()
    parts = [p.strip().lower() for p in location.split(",")]
    return any(part == want or part.endswith(" " + want) or part.startswith(want + " ")
               for part in parts)


def gather_situation(place: str, limit: int = SITUATION_LIMIT) -> list[dict]:
    """What the console currently holds for a place, most severe first."""
    import main as _main
    with _main._SURFACE_POOL_LOCK:
        pool = list(_main._SURFACE_POOL)
    hits = [i for i in pool if _match_place(str(i.get("location") or ""), place)]
    rank = {"critical": 0, "significant": 1, "high": 1, "elevated": 2, "routine": 3}
    hits.sort(key=lambda i: (rank.get(str(i.get("severity_tier") or "").lower(), 4),
                             str(i.get("published_at") or "")), reverse=False)
    return hits[:limit]


def render_situation(place: str, items: list[dict], author: str) -> str:
    """The digest, as plain text.

    Text and not HTML: this is read in a chat window by somebody who wants
    to know what is happening in Niger, and a styled document is a worse
    answer to that than twelve lines they can read where they are.
    """
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%MZ")
    out = [f"SITUATION — {place.upper()}",
           f"As at {now} · compiled by {author} · PARALLAX",
           ""]
    if not items:
        out.append("Nothing in the current surface pool names this place.")
        out.append("That is an absence of reporting, not an absence of events.")
        return "\n".join(out)

    out.append(f"{len(items)} item{'' if len(items) == 1 else 's'} currently held:")
    out.append("")
    for i in items:
        sev = str(i.get("severity_tier") or "routine").upper()
        when = str(i.get("published_at") or "")[:16].replace("T", " ")
        out.append(f"[{sev}] {i.get('headline') or 'Untitled'}")
        meta = " · ".join(x for x in (i.get("location"), i.get("source"), when) if x)
        if meta:
            out.append(f"    {meta}")
        if i.get("url"):
            out.append(f"    {i['url']}")
        out.append("")
    out.append("— Compiled from the live surface pool. Nothing here is an assessment.")
    return "\n".join(out)


@router.post("/send-situation")
async def send_situation(request: Request):
    """Gather a place's current picture and send it to somebody.

    Body: {place, user_id?|conversation_id?, as_file?}
    """
    from database import get_db
    from routers.chat import (_attachment_message, _membership, _people,
                              _msg_dict, _now)
    me = _me(request)
    body = await request.json()
    place = (body.get("place") or "").strip()[:80]
    if not place:
        raise HTTPException(status_code=400, detail="which place?")
    user_id = (body.get("user_id") or "").strip() or None
    conversation_id = (body.get("conversation_id") or "").strip() or None
    if not user_id and not conversation_id:
        raise HTTPException(status_code=400, detail="who should receive it?")
    as_file = body.get("as_file", True)

    items = gather_situation(place)
    author = me.get("name") or me.get("email") or "an analyst"
    text = render_situation(place, items, author)

    with get_db() as db:
        if conversation_id:
            _membership(db, conversation_id, me["id"])
            cid = conversation_id
        else:
            # The direct chat, created on the spot if this is the first
            # thing said to them — the same get-or-create the chat uses, so
            # this cannot make a second thread.
            from database import Conversation, ConversationMember, User
            if not db.query(User).filter(User.id == user_id,
                                         User.approved == True).first():  # noqa: E712
                raise HTTPException(status_code=400, detail="that is not an active account")
            mine = {r.conversation_id for r in db.query(ConversationMember).filter(
                ConversationMember.user_id == me["id"]).all()}
            theirs = {r.conversation_id for r in db.query(ConversationMember).filter(
                ConversationMember.user_id == user_id).all()}
            cid = None
            for c in db.query(Conversation).filter(Conversation.id.in_(mine & theirs)).all() if (mine & theirs) else []:
                if c.kind == "direct":
                    cid = c.id
                    break
            if not cid:
                c = Conversation(kind="direct", created_by=me["id"], last_message_at=_now())
                db.add(c); db.flush()
                db.add(ConversationMember(conversation_id=c.id, user_id=me["id"], last_read_at=_now()))
                db.add(ConversationMember(conversation_id=c.id, user_id=user_id))
                cid = c.id

        headline = (f"Situation in {place} — {len(items)} item"
                    f"{'' if len(items) == 1 else 's'} as at "
                    f"{_now().strftime('%H:%MZ')}")
        if as_file:
            from datetime import datetime, timezone
            name = f"{place} situation {datetime.now(timezone.utc):%Y-%m-%d %H%MZ}.txt"
            m = _attachment_message(db, cid, me["id"], text.encode("utf-8"),
                                    name, "text/plain")
            m.body = headline
        else:
            from database import ChatMessage, Conversation as _C
            m = ChatMessage(conversation_id=cid, sender_id=me["id"], kind="text",
                            body=f"{headline}\n\n{text}"[:8000])
            db.add(m)
            conv = db.query(_C).filter(_C.id == cid).first()
            if conv:
                conv.last_message_at = _now()
        db.commit()
        return {"ok": True, "count": len(items), "conversation_id": cid,
                "message": _msg_dict(m, _people(db, [me["id"]]))}


# ── "explain the current situation in Mali" ──────────────────────────────
#
# The gather is the same as send-situation's. The difference is who writes:
# a formatter lists what is held, and this says what it amounts to.
#
# IT IS GIVEN ONLY WHAT WE HOLD, and told to say so when that is thin. An
# explanation that reads as confident about a place with two wire reports
# is worse than no explanation, because somebody will act on it.

EXPLAIN_SYSTEM = (
    "You are an intelligence analyst writing for a colleague who will act on this.\n"
    "You are given every signal the console currently holds for one place. "
    "Explain what it amounts to, in three short paragraphs at most:\n"
    "1. what is happening, 2. what it bears on, 3. what is NOT known.\n\n"
    "RULES. Use only the signals given — never outside knowledge, never a "
    "figure that is not in them. Say plainly when the picture is thin: "
    "'three wire reports, all from one source' is the honest description of "
    "three wire reports from one source. Do not forecast. Do not recommend. "
    "No preamble, no headings, no bullet points."
)
EXPLAIN_MAX_TOKENS = 420
EXPLAIN_MAX_SIGNALS = 30


@router.post("/explain")
async def explain_place(request: Request):
    """Body: {place}. Returns prose, or says why it cannot."""
    import openai_gate
    me = _me(request)
    body = await request.json()
    place = (body.get("place") or "").strip()[:80]
    if not place:
        raise HTTPException(status_code=400, detail="which place?")

    items = gather_situation(place, limit=EXPLAIN_MAX_SIGNALS)
    if not items:
        # No model call at all. There is nothing to explain, and asking a
        # model to explain an empty set is how prose about nothing gets
        # written.
        return {"ok": True, "place": place, "count": 0, "explanation": None,
                "note": f"Nothing the console currently holds names {place}. "
                        f"That is an absence of reporting, not an absence of events."}

    client = openai_gate.get_client(openai_gate.EXPLAIN)
    if client is None:
        st = openai_gate.status()
        return {"ok": False, "place": place, "count": len(items),
                "why": ("The month's model budget is spent."
                        if st["over_budget"] else "Explanations are not configured."),
                "status": st}

    # Only the fields that carry meaning. Sending the whole record would
    # spend tokens on ids, colours and icon names.
    lines = []
    for i in items:
        lines.append(" | ".join(str(x) for x in (
            str(i.get("severity_tier") or "routine").upper(),
            i.get("headline") or "",
            i.get("location") or "",
            i.get("source") or "",
            str(i.get("published_at") or "")[:16],
        ) if x))
    model = openai_gate.model_for(openai_gate.EXPLAIN)
    try:
        resp = client.chat.completions.create(
            model=model, max_tokens=EXPLAIN_MAX_TOKENS, temperature=0.2,
            messages=[{"role": "system", "content": EXPLAIN_SYSTEM},
                      {"role": "user", "content":
                       f"Place: {place}\nSignals the console holds ({len(items)}):\n"
                       + "\n".join(lines)}],
        )
    except Exception as e:
        return {"ok": False, "place": place, "count": len(items),
                "why": f"The model did not answer: {e}"}

    usage = getattr(resp, "usage", None)
    if usage:
        try:
            import usage_tracker
            usage_tracker.record_call(
                input_tokens=usage.prompt_tokens, output_tokens=usage.completion_tokens,
                call_type="explain", model=model, headline=f"explain {place}")
        except Exception:
            pass

    text = (resp.choices[0].message.content or "").strip()
    sources = sorted({str(i.get("source") or "") for i in items if i.get("source")})
    return {
        "ok": True, "place": place, "count": len(items),
        "explanation": text,
        # WHAT IT READ, returned with it. An explanation whose evidence the
        # reader cannot see is an opinion.
        "sources": sources,
        "signals": [{"headline": i.get("headline"), "location": i.get("location"),
                     "severity": i.get("severity_tier"), "source": i.get("source"),
                     "lat": i.get("lat"), "lon": i.get("lon"), "url": i.get("url")}
                    for i in items],
    }
