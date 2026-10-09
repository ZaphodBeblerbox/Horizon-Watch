"""theaters.py — the regions somebody watches.

A theater is where the camera goes and what is switched on when you select
it. They were three literals in a React useState, so there was no way to
add one, edit one, or keep one across browsers.

EACH USER'S OWN. A new account starts with no theaters and makes its own
(the owner, 2026-10-07: theaters are personal unless shared). The three
DEFAULTS were seeded into every account until then; accounts that have them
keep them as ordinary rows to rename, move or delete.
"""

import datetime

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api/theaters", tags=["theaters"])

SEVERITIES = ("critical", "elevated", "steady")
MAX_NAME = 60
MAX_THEATERS = 40

# What used to be in app.jsx. Kept here verbatim so an existing user sees
# exactly the tab strip they had yesterday.
DEFAULTS = [
    {"name": "Red Sea watch", "sev": "critical",
     "view": {"lat": 13.6, "lon": 43.3, "height": 2_400_000},
     "layers": {"groups": ["maritime", "news"],
                "infra": ["chokepoints", "ports", "cables"],
                "tracks": ["vessels"]}},
    {"name": "Hormuz transit", "sev": "elevated",
     "view": {"lat": 26.6, "lon": 56.4, "height": 2_000_000},
     "layers": {"groups": ["maritime", "news"],
                "infra": ["chokepoints", "ports"],
                "tracks": ["vessels"]}},
    {"name": "Taiwan Strait", "sev": "steady",
     "view": {"lat": 24.3, "lon": 119.6, "height": 2_600_000},
     "layers": {"groups": ["maritime", "air", "news"],
                "infra": ["chokepoints", "ports", "airfields"],
                "tracks": ["vessels", "aircraft"]}},
]


def _me(request: Request) -> dict:
    from main import _require_current_user
    return _require_current_user(request)


def _dict(t):
    return {
        "id": t.id, "name": t.name, "sev": t.sev,
        "view": t.view or {}, "layers": t.layers or {},
        "sort_index": t.sort_index,
        # The tab strip shows a count beside each name. It is the number of
        # layers the theater turns on — the only honest number available
        # until scan areas are per-theater.
        "n": sum(len(v) for v in (t.layers or {}).values() if isinstance(v, list)),
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }


def _clean_view(v):
    if not isinstance(v, dict):
        return None
    try:
        lat, lon = float(v.get("lat")), float(v.get("lon"))
        height = float(v.get("height") or 2_000_000)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="the view needs a lat, a lon and a height")
    if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
        raise HTTPException(status_code=400, detail="that is not a point on Earth")
    # A camera below the ground or beyond the moon is a view of nothing.
    height = max(1_000.0, min(40_000_000.0, height))
    return {"lat": lat, "lon": lon, "height": height}


def _names(raw, key, cap=60):
    if not isinstance(raw, list):
        raise HTTPException(status_code=400, detail=f"{key} must be a list of layer names")
    # The names are the map's own keys and change as layers are added,
    # so they are not matched against a list here — the shape is
    # checked, and a key the map does not know simply does not light up.
    return [str(x)[:40] for x in raw][:cap]


def _clean_layers(v):
    """Everything the map's Layers panel can switch, as the map names it.

    groups/infra/tracks are always written. The rest came later and are
    kept only when sent: a theater that does not name them leaves them as
    they are when selected, which an empty list stored here would turn
    into "all off".
    """
    if not isinstance(v, dict):
        return {}
    out = {}
    for key in ("groups", "infra", "tracks"):
        out[key] = _names(v.get(key) or [], key)
    for key in ("context", "subs", "gdeltTypes", "theatres"):
        if key in v and v[key] is not None:
            out[key] = _names(v[key], key)
    for key in ("severityFloor", "timeWindow"):
        if isinstance(v.get(key), str) and v[key]:
            out[key] = v[key][:12]
    # Track filters: each axis a list of values, or None for "no filter".
    for key, axes in (("vessel", ("types", "flags")), ("aircraft", ("kinds", "airlines", "countries"))):
        f = v.get(key)
        if isinstance(f, dict):
            out[key] = {a: (None if f.get(a) is None else _names(f[a], f"{key}.{a}", 300)) for a in axes}
    return out


@router.get("")
def list_theaters(request: Request):
    from database import Theater, get_db
    me = _me(request)
    with get_db() as db:
        # NOT SEEDED any more: each user chooses their own theaters, and a
        # new account starts with none (the owner, 2026-10-07). DEFAULTS
        # stays as the suggestions the "new theater" form can offer.
        rows = db.query(Theater).filter(Theater.owner_user_id == me["id"]).all()
        rows.sort(key=lambda t: (t.sort_index, t.created_at or datetime.datetime.min))
        return [_dict(t) for t in rows]


@router.post("")
async def create_theater(request: Request):
    from database import Theater, get_db
    me = _me(request)
    body = await request.json()
    name = (body.get("name") or "").strip()[:MAX_NAME]
    if not name:
        raise HTTPException(status_code=400, detail="a theater needs a name")
    sev = (body.get("sev") or "steady").strip().lower()
    if sev not in SEVERITIES:
        raise HTTPException(status_code=400, detail=f"sev must be one of {', '.join(SEVERITIES)}")

    with get_db() as db:
        n = db.query(Theater).filter(Theater.owner_user_id == me["id"]).count()
        if n >= MAX_THEATERS:
            raise HTTPException(status_code=400, detail=f"that is more than {MAX_THEATERS} theaters")
        t = Theater(owner_user_id=me["id"], name=name, sev=sev,
                    view=_clean_view(body.get("view")),
                    layers=_clean_layers(body.get("layers")),
                    sort_index=n)
        db.add(t); db.commit(); db.refresh(t)
        return _dict(t)


def _own(db, theater_id, user_id):
    from database import Theater
    t = db.query(Theater).filter(Theater.id == theater_id,
                                 Theater.owner_user_id == user_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="no such theater")
    return t


@router.put("/{theater_id}")
async def update_theater(theater_id: str, request: Request):
    from database import get_db
    me = _me(request)
    body = await request.json()
    with get_db() as db:
        t = _own(db, theater_id, me["id"])
        if "name" in body:
            name = (body["name"] or "").strip()[:MAX_NAME]
            if not name:
                raise HTTPException(status_code=400, detail="a theater needs a name")
            t.name = name
        if "sev" in body:
            sev = (body["sev"] or "").strip().lower()
            if sev not in SEVERITIES:
                raise HTTPException(status_code=400, detail=f"sev must be one of {', '.join(SEVERITIES)}")
            t.sev = sev
        if "view" in body:
            t.view = _clean_view(body["view"])
        if "layers" in body:
            t.layers = _clean_layers(body["layers"])
        if "sort_index" in body:
            try:
                t.sort_index = int(body["sort_index"])
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="sort_index must be a number")
        db.commit()
        return _dict(t)


@router.delete("/{theater_id}")
def delete_theater(theater_id: str, request: Request):
    """Remove a theater.

    What was FILED while standing in it stays where it is. A theater is a
    way of looking, and deleting the viewfinder does not delete what you
    photographed through it.
    """
    from database import Theater, get_db
    me = _me(request)
    with get_db() as db:
        t = _own(db, theater_id, me["id"])
        left = db.query(Theater).filter(Theater.owner_user_id == me["id"]).count()
        if left <= 1:
            raise HTTPException(status_code=400,
                                detail="that is your last theater — the tab strip cannot be empty")
        db.delete(t); db.commit()
    return {"ok": True, "deleted": theater_id}


@router.post("/order")
async def reorder(request: Request):
    """Body: {ids: [...]} in the order they should appear."""
    from database import Theater, get_db
    me = _me(request)
    body = await request.json()
    ids = [str(i) for i in (body.get("ids") or [])]
    with get_db() as db:
        rows = {t.id: t for t in db.query(Theater).filter(
            Theater.owner_user_id == me["id"]).all()}
        for i, tid in enumerate(ids):
            if tid in rows:
                rows[tid].sort_index = i
        db.commit()
        out = sorted(rows.values(), key=lambda t: t.sort_index)
        return [_dict(t) for t in out]


def prune_seeded() -> dict:
    """Remove the seeded defaults nobody chose (the owner, 2026-10-07: every
    user starts with no theaters and makes their own).

    Only rows still exactly as seeded — a default's name, view and layers,
    never edited (updated within two seconds of creation) — are touched:
    on an ordinary account they go; on an admin account (the people who set
    the system up, who have used them) only duplicates go, from the race that
    seeded some accounts twice. Anything a user renamed, moved or re-layered
    is theirs and stays. Safe to run at every start: nothing seeds any more.
    """
    from database import Theater, User, get_db
    removed = {"seeded": 0, "duplicates": 0}
    defaults = {(d["name"], tuple(sorted(d["view"].items()))): d for d in DEFAULTS}
    with get_db() as db:
        admins = {u.id for u in db.query(User).filter(User.is_super_admin == True).all()}  # noqa: E712
        seen = set()
        rows = db.query(Theater).order_by(Theater.owner_user_id, Theater.created_at).all()
        for t in rows:
            view = tuple(sorted((t.view or {}).items()))
            d = defaults.get((t.name, view))
            if not d or (t.layers or {}) != d["layers"]:
                continue
            if t.created_at and t.updated_at and abs((t.updated_at - t.created_at).total_seconds()) > 2:
                continue                                   # edited since: the user's own
            if t.owner_user_id not in admins:
                db.delete(t)
                removed["seeded"] += 1
            elif (t.owner_user_id, t.name) in seen:
                db.delete(t)
                removed["duplicates"] += 1
            else:
                seen.add((t.owner_user_id, t.name))
        db.commit()
    return removed
