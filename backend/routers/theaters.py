"""theaters.py — the regions somebody watches.

A theater is where the camera goes and what is switched on when you select
it. They were three literals in a React useState, so there was no way to
add one, edit one, or keep one across browsers.

THE DEFAULTS ARE SEEDED, NOT HARDCODED. A new account's first read creates
the three that used to be in the code, as real rows it then owns. After
that they are ordinary data: rename them, move them, delete them. Seeding
on read rather than at sign-up means accounts that already exist get them
too, without a migration that has to guess who needs what.
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


def _clean_layers(v):
    if not isinstance(v, dict):
        return {}
    out = {}
    for key in ("groups", "infra", "tracks"):
        raw = v.get(key) or []
        if not isinstance(raw, list):
            raise HTTPException(status_code=400, detail=f"{key} must be a list of layer names")
        # The names are the map's own keys and change as layers are added,
        # so they are not matched against a list here — the shape is
        # checked, and a key the map does not know simply does not light up.
        out[key] = [str(x)[:40] for x in raw][:60]
    return out


@router.get("")
def list_theaters(request: Request):
    from database import Theater, get_db
    me = _me(request)
    with get_db() as db:
        rows = db.query(Theater).filter(Theater.owner_user_id == me["id"]).all()
        if not rows:
            for i, d in enumerate(DEFAULTS):
                db.add(Theater(owner_user_id=me["id"], name=d["name"], sev=d["sev"],
                               view=d["view"], layers=d["layers"], sort_index=i))
            db.commit()
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
