"""enrichment.py — enriching the signals the console already holds.

ONE PASS, OVER WHAT IS ON SCREEN. Not a crawler over everything ever
ingested: the signals worth the spend are the ones somebody is looking at,
and the surface pool is exactly those.

CACHED BY CONTENT. The key is the text, so re-enriching the same headline
is free and the pool refreshing does not re-bill for the signals that did
not change. That is what makes "enrich continuously" affordable rather than
a thing to be scheduled carefully.

THE ORIGINAL IS NEVER OVERWRITTEN. An improved headline is returned
alongside what arrived, under its own key, so anything that reads a signal
can choose and nothing silently loses the source text.
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
import time

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api/enrich", tags=["enrichment"])

_CACHE_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           "data", "enrichment_cache.json")
_lock = threading.Lock()
_cache: dict | None = None
CACHE_MAX = 20_000


def _key(text: str) -> str:
    return hashlib.sha1(text.strip().lower().encode("utf-8")).hexdigest()[:16]


def _load() -> dict:
    global _cache
    if _cache is not None:
        return _cache
    try:
        with open(_CACHE_PATH) as fh:
            _cache = json.load(fh)
    except (OSError, json.JSONDecodeError):
        _cache = {}
    return _cache


def _save() -> None:
    try:
        data = _load()
        if len(data) > CACHE_MAX:
            # Oldest out. A cache that grows without bound becomes the
            # thing it was meant to avoid.
            for k in sorted(data, key=lambda k: data[k].get("at", 0))[:len(data) - CACHE_MAX]:
                data.pop(k, None)
        tmp = _CACHE_PATH + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(data, fh)
        os.replace(tmp, _CACHE_PATH)
    except OSError:
        pass   # a cache that cannot be written is slow, not broken


def _me(request: Request) -> dict:
    from main import _require_current_user
    return _require_current_user(request)


def signal_text(item: dict) -> str:
    """What the model is shown for one signal: the words, and where."""
    return " — ".join(str(x) for x in (item.get("headline"), item.get("location")) if x)


_enriching = threading.Event()


def enrich_items(items: list[dict], budget: int = 40, blocking: bool = True) -> dict:
    """Enrich a list of signal dicts, using the cache where it can.

    Returns {key: enrichment}. `budget` caps how many UNCACHED signals one
    call will pay for, so a pool that has entirely turned over cannot bill
    for hundreds in a single request.

    `blocking=False` returns ONLY what is already cached and starts a
    background pass for the rest. Every caller that serves an HTTP request
    uses that: a model reading forty signals takes one to three minutes,
    and a sync FastAPI endpoint holds a threadpool slot for its whole
    duration — so two or three of these at once starved the pool and made
    unrelated requests time out, which is how this presented ("the server
    did not respond within 30s" on a backend that was perfectly healthy).
    """
    import enrich as _enrich
    data = _load()
    out: dict[str, dict] = {}
    todo: list[dict] = []

    for it in items:
        text = signal_text(it)
        if not text:
            continue
        k = _key(text)
        hit = data.get(k)
        if hit:
            out[k] = hit
        elif len(todo) < budget:
            todo.append({"id": k, "text": text})

    if not blocking:
        if todo and not _enriching.is_set():
            # Set BEFORE the thread starts. Setting it inside the thread
            # leaves a window in which a second request also sees it clear
            # and pays for the same batch twice.
            _enriching.set()

            def _fill():
                try:
                    enrich_items(items, budget=budget, blocking=True)
                finally:
                    _enriching.clear()
            threading.Thread(target=_fill, daemon=True).start()
        return _fold(out)

    fresh = 0
    for i in range(0, len(todo), _enrich.BATCH):
        batch = todo[i:i + _enrich.BATCH]
        for r in _enrich.enrich_batch(batch):
            if not r.get("enriched"):
                continue
            ents = r.get("entities") or []
            rec = {
                "headline": r.get("headline"),
                "entities": ents,
                "keys": r.get("keys") or [],
                "at": time.time(),
            }
            out[r["id"]] = rec
            with _lock:
                data[r["id"]] = rec
            fresh += 1
    if fresh:
        with _lock:
            _save()

    return _fold(out)


def _fold(out: dict) -> dict:
    """Fold name-only mentions onto identifier-backed ones.

    Across the WHOLE set, not within a batch — the mention carrying the
    MMSI is usually in a different signal from the one carrying only the
    name, and that is the entire point.

    KEYS ARE RECOMPUTED FROM THE ENTITIES, not read from the cache. They
    are derived values, and the rules that derive them change: adding the
    role-word stoplist stopped "Pastor" from being an entity, but every
    signal already in the cache kept its stale `org:name:pastor` key and
    went on proposing "Pastor → Nigeria". Deriving on read makes a change
    to resolution apply to everything at once instead of only to whatever
    happens to be enriched next.
    """
    import enrich as _enrich
    all_ents = [e for rec in out.values() for e in (rec.get("entities") or [])]
    folded = _enrich.link_mentions(all_ents)
    for rec in out.values():
        ents = rec.get("entities") or []
        # Entities whose key is now None are dropped from the record, so a
        # caller zipping entities against resolved keys stays aligned.
        keyed = [(e, _enrich.resolution_key(e)) for e in ents]
        keyed = [(e, k) for e, k in keyed if k]
        rec["entities"] = [e for e, _ in keyed]
        rec["keys"] = [k for _, k in keyed]
        rec["resolved"] = [folded.get(k, k) for k in rec["keys"]]
    return out


@router.get("/surface")
def enrich_surface(request: Request, limit: int = 40):
    """Enrich the current surface pool and return what it found.

    The pool is what the Home and Situation screens read, so this is the
    enrichment of what somebody is actually looking at.
    """
    import main as _main
    _me(request)
    limit = max(1, min(120, limit))
    with _main._SURFACE_POOL_LOCK:
        pool = list(_main._SURFACE_POOL)[:limit]
    found = enrich_items(pool, blocking=False)

    improved, entities = 0, {}
    items = []
    for it in pool:
        text = signal_text(it)
        rec = found.get(_key(text)) if text else None
        if rec and rec.get("headline"):
            improved += 1
        for e, k in zip((rec or {}).get("entities") or [],
                        (rec or {}).get("resolved") or []):
            entities.setdefault(k, {"key": k, "kind": e.get("kind"),
                                    "name": e.get("name"), "mentions": 0})
            entities[k]["mentions"] += 1
        items.append({
            "id": it.get("id"),
            "headline": it.get("headline"),
            # Alongside, never instead of. See the module note.
            "headline_improved": (rec or {}).get("headline"),
            "entities": (rec or {}).get("entities") or [],
            "resolved": (rec or {}).get("resolved") or [],
        })

    return {
        "count": len(pool),
        "headlines_improved": improved,
        "entities": sorted(entities.values(), key=lambda e: -e["mentions"]),
        "items": items,
        # So the UI can say "still reading" rather than implying that a
        # partially-enriched pool is all there is.
        "enriched": sum(1 for i in items if i.get("entities") or i.get("headline_improved")),
        "building": _enriching.is_set(),
    }


@router.post("/text")
async def enrich_text(request: Request):
    """Enrich arbitrary text. Body: {texts: [...]} — for trying it out."""
    _me(request)
    body = await request.json()
    texts = [str(t)[:400] for t in (body.get("texts") or []) if str(t).strip()][:20]
    if not texts:
        raise HTTPException(status_code=400, detail="nothing to enrich")
    found = enrich_items([{"headline": t} for t in texts])
    return {"results": [{"text": t, **(found.get(_key(t)) or {"headline": None, "entities": []})}
                        for t in texts]}


@router.get("/status")
def enrichment_status(request: Request):
    _me(request)
    import openai_gate
    return {**openai_gate.status(), "cached": len(_load())}


# ── the empty WHO column ─────────────────────────────────────────────────
#
# Constellation's WHO column is empty because no faction, organisation or
# person in the graph links to a country, even at two hops. The links are
# not missing from the world — they are sitting in the signal text, which
# nothing was reading.
#
# A signal that names an organisation AND a place is evidence that the two
# are connected. Not proof: "Houthi forces" and "Saudi Arabia" in one
# headline might be an attack, a negotiation or a denial. So these are
# PROPOSED, with the sentence that produced each one, for a person to
# accept — the graph is what the product reasons from, and a graph filled
# with guesses is worse than one with a gap.

ACTORS = ("org", "faction", "person", "facility")


def _enrich_name(e: dict) -> str:
    """An entity's name in the canonical form identity is compared in."""
    import enrich as _e
    return _e.norm_name(e.get("name"))


@router.get("/graph-links")
def propose_graph_links(request: Request, limit: int = 60):
    """Actor-to-place links the current signals imply, for review.

    Each proposal carries the headline it came from. A link whose evidence
    cannot be read is a link nobody should accept.
    """
    import main as _main
    _me(request)
    limit = max(1, min(120, limit))
    with _main._SURFACE_POOL_LOCK:
        pool = list(_main._SURFACE_POOL)[:limit]
    found = enrich_items(pool, blocking=False)

    proposals: dict[tuple[str, str], dict] = {}
    for it in pool:
        text = signal_text(it)
        rec = found.get(_key(text)) if text else None
        if not rec:
            continue
        # A PLACE ANOTHER COPY OF THIS STORY CONTRADICTS IS NOT EVIDENCE.
        # The surface pool marks a survivor whose geocode disagreed with a
        # duplicate's; proposing a link from one of those produced
        # "Palestinian ministry → Pakistan", which is a faithful reading of
        # a wrongly-placed signal and still wrong.
        if it.get("contested_locations"):
            continue

        ents = rec.get("entities") or []
        resolved = rec.get("resolved") or []
        pairs = list(zip(ents, resolved + [None] * len(ents)))
        actors = [(e, k) for e, k in pairs if (e.get("kind") or "").lower() in ACTORS]
        places = [(e, k) for e, k in pairs if (e.get("kind") or "").lower() == "place"]
        if not actors or not places:
            continue
        for ae, ak in actors:
            for pe, pk in places:
                if not ak or not pk:
                    continue
                # "Israel → Israel". A state is both an actor and a place,
                # and an edge from a thing to itself adds nothing to a graph
                # while looking like a finding.
                if _enrich_name(ae) == _enrich_name(pe):
                    continue
                key = (ak, pk)
                p = proposals.setdefault(key, {
                    "actor": {"key": ak, "kind": ae.get("kind"), "name": ae.get("name")},
                    "place": {"key": pk, "name": pe.get("name")},
                    "mentions": 0, "evidence": [],
                })
                p["mentions"] += 1
                # At most three sentences each. The fourth adds nothing to
                # a decision and a lot to the payload.
                if len(p["evidence"]) < 3:
                    p["evidence"].append({
                        "headline": it.get("headline"),
                        "source": it.get("source"),
                        "at": it.get("published_at"),
                    })

    out = sorted(proposals.values(), key=lambda p: -p["mentions"])
    return {
        "count": len(pool),
        "proposed": out,
        "building": _enriching.is_set(),
        # Said in the payload, not only in the UI: anything reading this
        # endpoint should know these are not facts yet.
        "note": ("Each link is a co-occurrence in one signal, not a verified "
                 "relationship. Accept them individually against the evidence."),
    }


# ── the day's outlook ────────────────────────────────────────────────────

# The outlook is slow — a model reading forty signals takes a minute or two
# — so it is NEVER computed inside a request. It is refreshed on a timer and
# the endpoint serves whatever the last refresh produced. A Home screen that
# waits two and a half minutes on a model is a Home screen nobody opens.
OUTLOOK_KEY = "outlook:current"
_outlook_building = threading.Event()


def refresh_outlook(limit: int = 45) -> dict:
    """Rebuild the outlook and store it. Safe to call from a thread.

    Guarded by an Event rather than a Lock: a second caller arriving while
    one is in flight should leave immediately, not queue up behind it and
    pay for a second identical answer.
    """
    if _outlook_building.is_set():
        return {"ok": True, "skipped": "already building"}
    _outlook_building.set()
    try:
        import main as _main
        import outlook as _outlook
        with _main._SURFACE_POOL_LOCK:
            pool = list(_main._SURFACE_POOL)[:max(5, min(60, limit))]

        # AN EMPTY POOL IS NOT A QUIET DAY. Right after a restart the pool
        # has not filled yet, and caching "nothing specific today" from zero
        # signals would show that answer for the next twenty minutes while
        # the console was in fact holding plenty. Not cached, so the next
        # pass tries again.
        if not pool:
            print("[outlook] surface pool is still empty — not building yet", flush=True)
            return {"ok": True, "outlook": [], "count": 0, "skipped": "pool empty"}

        # The category-level rates, as context for what is ORDINARY. Read
        # from the board store directly rather than through the endpoint,
        # because an endpoint call from inside a request handler is a
        # request to ourselves.
        base = []
        try:
            import forecast_board as _fb
            conn = _main._fc_conn()
            try:
                for b in (_fb.list_boards(conn, limit=8) or []):
                    sc = (b.get("scenarios") or [{}])[0]
                    if sc.get("p") is not None:
                        base.append({"label": sc.get("label") or b.get("question"),
                                     "p": sc.get("p"), "base": sc.get("base")})
            finally:
                conn.close()
        except Exception:
            base = []   # context, not the answer — its absence changes nothing

        out = _outlook.build_outlook(pool, base)
        if out.get("ok"):
            out["at"] = time.time()
            # The signal set it was built from, so the UI can say how stale
            # it is rather than implying it is live.
            out["signal_stamp"] = _key("|".join(
                str(s.get("id") or s.get("headline") or "") for s in pool))
            data = _load()
            with _lock:
                data[OUTLOOK_KEY] = out
                _save()
        return out
    finally:
        _outlook_building.clear()


@router.get("/outlook")
def daily_outlook(request: Request, limit: int = 45):
    """The last outlook built. Never builds one inside the request."""
    _me(request)
    hit = _load().get(OUTLOOK_KEY)
    if hit:
        age = int(time.time() - (hit.get("at") or 0))
        return {**hit, "cached": True, "age_seconds": age,
                "building": _outlook_building.is_set()}
    # Nothing yet. Say so plainly and start one, rather than holding the
    # request open for two minutes.
    threading.Thread(target=refresh_outlook, args=(limit,), daemon=True).start()
    return {"ok": True, "outlook": [], "count": 0, "building": True,
            "note": "The first outlook is being built. It takes a minute or "
                    "two; this page does not wait for it."}


@router.post("/outlook/refresh")
def force_outlook(request: Request, limit: int = 45):
    """Rebuild now, in the background. Returns immediately."""
    _me(request)
    if _outlook_building.is_set():
        return {"ok": True, "building": True, "note": "already building"}
    threading.Thread(target=refresh_outlook, args=(limit,), daemon=True).start()
    return {"ok": True, "building": True}


# ── forecasts that can be marked ─────────────────────────────────────────
#
# The old Home block showed a percentage against a base rate and could
# never be wrong. These carry a criterion and a date, so they resolve —
# and a Brier score becomes arithmetic instead of an aspiration.

@router.post("/outlook/record")
def record_outlook(request: Request, limit: int = 45):
    """Build today's outlook and store it for later marking."""
    import openai_gate
    import outlook_store
    me = _me(request)
    built = _load().get(OUTLOOK_KEY)
    if not built:
        # Nothing to record. Building one here would make this request wait
        # on a model, which is the thing the refresh loop exists to avoid.
        threading.Thread(target=refresh_outlook, args=(limit,), daemon=True).start()
        return {"ok": False, "why": "No outlook has been built yet — one is "
                                    "being built now. Try again in a minute."}
    saved = outlook_store.record(built.get("outlook") or [],
                                 model=openai_gate.model_for(openai_gate.OUTLOOK))
    return {**built, **saved, "by": me.get("name")}


@router.get("/outlook/forecasts")
def list_forecasts(request: Request, outcome: str | None = None, limit: int = 100):
    import outlook_store
    _me(request)
    return {"forecasts": outlook_store.listing(outcome, max(1, min(300, limit)))}


@router.get("/outlook/due")
def due_forecasts(request: Request):
    """Open forecasts whose date has passed — waiting on a verdict.

    Surfaced, because an unresolved forecast quietly left open is what
    turns a scorecard into a lie by omission.
    """
    import outlook_store
    _me(request)
    return {"due": outlook_store.due()}


@router.post("/outlook/forecasts/{fid}/resolve")
async def resolve_forecast(fid: str, request: Request):
    """Body: {outcome: happened|did_not|void, note?}

    A PERSON MARKS IT. Nothing here decides whether its own forecast came
    true — a system that marks its own homework produces a score that
    measures nothing.
    """
    import outlook_store
    me = _me(request)
    body = await request.json()
    out = outlook_store.resolve(fid, str(body.get("outcome") or ""),
                                by=me.get("name") or me.get("email") or "",
                                note=str(body.get("note") or ""))
    if not out.get("ok"):
        raise HTTPException(status_code=400, detail=out.get("why"))
    return out


@router.get("/outlook/scorecard")
def outlook_scorecard(request: Request):
    import outlook_store
    _me(request)
    return outlook_store.scorecard()
