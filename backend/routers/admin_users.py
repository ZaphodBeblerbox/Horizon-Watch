"""admin_users.py — who gets in, and who decides.

THE GAP THIS CLOSES. The User row has carried `approved` and
`is_super_admin` since the table was created, and nothing has ever read
either one. There was no way to ask for an account, no way to grant one,
and — because login never looked at `approved` — an unapproved row was a
fully working account. The column was documentation of an intention, not a
boundary.

THREE RULES.

1. ACCESS IS GRANTED, NEVER TAKEN. Requesting an account creates a row that
   cannot log in. A superadmin turns it on. Revoking turns it off again and
   the next request from that session is refused, so revocation is not a
   thing that takes effect "at next login" — which, for someone who leaves
   under a cloud, is the only moment that matters.

2. A SUPERADMIN CANNOT LOCK THE ORGANISATION OUT. You cannot demote or
   delete yourself, and the last superadmin cannot be demoted or deleted by
   anyone. Otherwise one mis-click leaves a console nobody can administer
   and no way back in but the database.

3. THE REQUEST FORM TELLS AN OUTSIDER NOTHING. The same answer whether or
   not the email is already registered. A signup form that says "already
   taken" is an account-enumeration oracle pointed at a staff directory.
"""

import datetime
import re

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(tags=["admin-users"])

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s.]+\.[^@\s]+$")
MIN_PASSWORD = 10
ROLES = ("observer", "analyst", "admin")


def _superadmin(request: Request) -> dict:
    from main import _require_current_user
    me = _require_current_user(request)
    if not me.get("is_super_admin"):
        # 403 and not 404: the caller is a known, logged-in user, and
        # pretending the admin console does not exist to someone who can
        # see the button is just confusing.
        raise HTTPException(status_code=403, detail="superadmin only")
    return me


def _admin_user_dict(u) -> dict:
    """Everything the console shows. More than _user_to_dict, because this
    is the one screen whose job is the account itself."""
    from main import _user_to_dict
    d = _user_to_dict(u)
    d.update({
        "approved": bool(u.approved),
        "is_super_admin": bool(u.is_super_admin),
        "created_at": u.created_at.isoformat() if u.created_at else None,
        "last_login": u.last_login.isoformat() if u.last_login else None,
        "last_seen": u.last_seen.isoformat() if u.last_seen else None,
        # What they wrote when they asked for an account. Kept so the
        # decision is made against a reason rather than an address.
        "request_note": u.notes or "",
    })
    return d


def _superadmin_count(db) -> int:
    from database import User
    return db.query(User).filter(User.is_super_admin == True).count()  # noqa: E712


# ── asking for an account ────────────────────────────────────────────────

@router.post("/api/auth/request-access")
async def request_access(request: Request):
    """Create a pending account. Public, by necessity.

    The response is identical whether this created anything or not.
    """
    from database import User, get_db
    from passlib.context import CryptContext

    body = await request.json()
    email = (body.get("email") or "").strip().lower()[:200]
    name = (body.get("name") or "").strip()[:120]
    password = body.get("password") or ""
    note = (body.get("note") or "").strip()[:1000]

    # The shape of the request IS checked and IS reported — a typo in your
    # own email address is not something to be silent about.
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="that does not look like an email address")
    if not name:
        raise HTTPException(status_code=400, detail="a name is required")
    if len(password) < MIN_PASSWORD:
        raise HTTPException(status_code=400,
                            detail=f"the password must be at least {MIN_PASSWORD} characters")

    quiet = {"ok": True, "status": "pending",
             "message": "Your request has been recorded. You will be able to sign in once it is approved."}

    with get_db() as db:
        if db.query(User).filter(User.email == email).first():
            # Already registered, pending, or rejected — all the same
            # answer. See rule 3.
            return quiet
        pwd = CryptContext(schemes=["bcrypt"])
        u = User(
            email=email, name=name, password_hash=pwd.hash(password),
            role="observer", approved=False, is_super_admin=False, notes=note,
        )
        db.add(u)
        db.commit()
    return quiet


@router.get("/api/auth/access-state")
def access_state(request: Request):
    """Whether this session's account is live, so the app can say why it is
    not rather than showing an empty console."""
    from main import _get_current_user
    me = _get_current_user(request)
    if not me:
        return {"signed_in": False}
    return {
        "signed_in": True,
        "approved": bool(me.get("approved", True)),
        "is_super_admin": bool(me.get("is_super_admin")),
    }


# ── the console ──────────────────────────────────────────────────────────

@router.get("/api/admin/users")
def list_users(request: Request):
    """Every account, pending first.

    Pending first because this screen exists for one recurring job —
    somebody is waiting — and a queue that is sorted alphabetically buries
    it among forty colleagues.
    """
    from database import User, get_db
    _superadmin(request)
    with get_db() as db:
        rows = db.query(User).all()
        out = [_admin_user_dict(u) for u in rows]
    out.sort(key=lambda d: (
        bool(d["approved"]),                      # pending first
        d["created_at"] is None,
        -(_epoch(d["created_at"]) if not d["approved"] else 0),  # newest request first
        (d["name"] or d["email"]).lower(),
    ))
    return out


def _epoch(iso):
    if not iso:
        return 0
    try:
        return datetime.datetime.fromisoformat(iso).timestamp()
    except ValueError:
        return 0


def _load(db, user_id: str):
    from database import User
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="no such user")
    return u


@router.post("/api/admin/users/{user_id}/approve")
def approve_user(user_id: str, request: Request):
    from database import get_db
    _superadmin(request)
    with get_db() as db:
        u = _load(db, user_id)
        u.approved = True
        db.commit()
        return _admin_user_dict(u)


@router.post("/api/admin/users/{user_id}/revoke")
def revoke_user(user_id: str, request: Request):
    """Turn an account off without deleting what it owns.

    Their cases, documents and uploads stay where they are — revoking
    access is not the same decision as destroying a colleague's work, and
    conflating the two means nobody dares do the first one.
    """
    from database import get_db
    me = _superadmin(request)
    with get_db() as db:
        u = _load(db, user_id)
        if u.id == me["id"]:
            raise HTTPException(status_code=400, detail="you cannot revoke your own access")
        if u.is_super_admin and _superadmin_count(db) <= 1:
            raise HTTPException(status_code=400, detail="that is the last superadmin")
        u.approved = False
        db.commit()
        return _admin_user_dict(u)


@router.delete("/api/admin/users/{user_id}")
def delete_user(user_id: str, request: Request):
    from database import get_db
    me = _superadmin(request)
    with get_db() as db:
        u = _load(db, user_id)
        if u.id == me["id"]:
            raise HTTPException(status_code=400, detail="you cannot delete your own account")
        if u.is_super_admin and _superadmin_count(db) <= 1:
            raise HTTPException(status_code=400, detail="that is the last superadmin")
        db.delete(u)
        db.commit()
    return {"ok": True, "deleted": user_id}


@router.put("/api/admin/users/{user_id}")
async def update_user(user_id: str, request: Request):
    """Role, capability, team, title, and the superadmin flag itself."""
    from database import get_db
    me = _superadmin(request)
    body = await request.json()

    with get_db() as db:
        u = _load(db, user_id)

        if "is_super_admin" in body:
            want = bool(body["is_super_admin"])
            if not want:
                if u.id == me["id"]:
                    raise HTTPException(status_code=400,
                                        detail="you cannot remove your own superadmin access")
                if u.is_super_admin and _superadmin_count(db) <= 1:
                    raise HTTPException(status_code=400, detail="that is the last superadmin")
            u.is_super_admin = want

        if "role" in body:
            role = (body["role"] or "").strip().lower()
            if role not in ROLES:
                raise HTTPException(status_code=400, detail=f"role must be one of {', '.join(ROLES)}")
            u.role = role

        if "capability_role" in body:
            from main import _ACCESS_ROLE_CAPS
            cap = (body["capability_role"] or "").strip() or None
            if cap and cap not in _ACCESS_ROLE_CAPS:
                raise HTTPException(status_code=400,
                                    detail=f"unknown capability role: {cap}")
            u.capability_role = cap

        # Company is editable HERE as well as on the person's own page,
        # because the roster is grouped by it: an admin who can group by
        # company but cannot set one is looking at a list of "No company
        # set" and can do nothing about it.
        for field, limit in (("name", 120), ("title", 80), ("team_id", 64),
                             ("company", 120), ("location", 120)):
            if field in body:
                v = body[field]
                setattr(u, field, (str(v).strip()[:limit] or None) if v is not None else None)

        db.commit()
        return _admin_user_dict(u)
