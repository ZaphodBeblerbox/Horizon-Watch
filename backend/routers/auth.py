"""routers/auth.py — All /api/auth/* and /api/users/* endpoints."""

from __future__ import annotations
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from pydantic import BaseModel

from app_shared import (
    HAS_AUTH, pwd_context, make_jwt, send_email,
    require_approved_user, FRONTEND_URL, user_dict,
    log_activity, append_location_history,
)

router = APIRouter(tags=["auth"])


# ── Pydantic models ───────────────────────────────────────────────────────────

class LoginBody(BaseModel):
    email: str
    password: str


class RegisterBody(BaseModel):
    email: str
    password: str
    name: str = ""


class ChangePwBody(BaseModel):
    current_password: str
    new_password: str


class ForgotBody(BaseModel):
    email: str


class ResetBody(BaseModel):
    token: str
    new_password: str


class SessionBody(BaseModel):
    lat:   float = None
    lon:   float = None
    zoom:  float = None
    event: str   = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/api/auth/login")
def auth_login(body: LoginBody, request: Request):
    if not HAS_AUTH:
        raise HTTPException(status_code=503, detail="Auth not available")
    import datetime as _dt
    from database import SessionLocal, User as DbUser
    db = SessionLocal()
    try:
        user = db.query(DbUser).filter(DbUser.email == body.email.lower().strip()).first()
        if not user or not pwd_context.verify(body.password, user.password_hash):
            raise HTTPException(status_code=401, detail="Invalid credentials")
        if not user.approved:
            raise HTTPException(status_code=401, detail="Account pending approval")
        user.last_login = _dt.datetime.utcnow()
        db.commit()
        ip = (request.headers.get("X-Forwarded-For") or request.client.host or "").split(",")[0].strip()
        log_activity(user.id, user.email, "login", {"method": "password"}, ip)
        token = make_jwt(user.id)
        return {
            "access_token": token,
            "token_type":   "bearer",
            "user": {
                "id":             user.id,
                "email":          user.email,
                "name":           user.name,
                "role":           user.role,
                "is_super_admin": user.is_super_admin,
            },
        }
    finally:
        db.close()


@router.post("/api/auth/register")
def auth_register(body: RegisterBody):
    if not HAS_AUTH:
        raise HTTPException(status_code=503, detail="Auth not available")
    from database import SessionLocal, User as DbUser
    db = SessionLocal()
    try:
        email = body.email.lower().strip()
        if db.query(DbUser).filter(DbUser.email == email).first():
            raise HTTPException(status_code=400, detail="Email already registered")
        user = DbUser(
            email         = email,
            name          = body.name.strip(),
            password_hash = pwd_context.hash(body.password),
            role          = "observer",
            approved      = False,
        )
        db.add(user)
        db.commit()
        admins = db.query(DbUser).filter(DbUser.is_super_admin == True).all()
        for admin in admins:
            send_email(
                admin.email,
                "New Horizon Watch access request",
                f"<p><b>{body.name or email}</b> ({email}) has requested access to Horizon Watch.</p>"
                f"<p>Log in to the admin panel to approve or deny.</p>",
            )
        return {"message": "Registration pending approval"}
    finally:
        db.close()


@router.get("/api/auth/me")
def auth_me(current_user=Depends(require_approved_user)):
    return {
        "id":             current_user.id,
        "email":          current_user.email,
        "name":           current_user.name,
        "role":           current_user.role,
        "is_super_admin": current_user.is_super_admin,
        "approved":       current_user.approved,
    }


@router.post("/api/auth/change-password")
def auth_change_password(body: ChangePwBody, current_user=Depends(require_approved_user)):
    if not HAS_AUTH:
        raise HTTPException(status_code=503, detail="Auth not available")
    from database import SessionLocal, User as DbUser
    db = SessionLocal()
    try:
        user = db.query(DbUser).filter(DbUser.id == current_user.id).first()
        if not user or not pwd_context.verify(body.current_password, user.password_hash):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        user.password_hash = pwd_context.hash(body.new_password)
        db.commit()
        return {"ok": True}
    finally:
        db.close()


@router.post("/api/auth/forgot-password")
def auth_forgot_password(body: ForgotBody):
    if not HAS_AUTH:
        raise HTTPException(status_code=503, detail="Auth not available")
    import uuid as _uuid
    import datetime as _dt
    from database import SessionLocal, User as DbUser
    db = SessionLocal()
    try:
        user = db.query(DbUser).filter(DbUser.email == body.email.lower().strip()).first()
        if user:
            token = str(_uuid.uuid4())
            user.reset_token         = token
            user.reset_token_expires = _dt.datetime.utcnow() + _dt.timedelta(hours=1)
            db.commit()
            reset_url = f"{FRONTEND_URL}/reset-password?token={token}"
            send_email(
                user.email,
                "Horizon Watch — Password Reset",
                f"<p>Click the link below to reset your password (valid 1 hour):</p>"
                f"<p><a href='{reset_url}'>{reset_url}</a></p>",
            )
            print(f"[auth] password reset token for {user.email}: {token}")
        return {"message": "If this email is registered, a reset link has been sent."}
    finally:
        db.close()


@router.post("/api/auth/reset-password")
def auth_reset_password(body: ResetBody):
    if not HAS_AUTH:
        raise HTTPException(status_code=503, detail="Auth not available")
    import datetime as _dt
    from database import SessionLocal, User as DbUser
    db = SessionLocal()
    try:
        user = db.query(DbUser).filter(DbUser.reset_token == body.token).first()
        if not user or not user.reset_token_expires or _dt.datetime.utcnow() > user.reset_token_expires:
            raise HTTPException(status_code=400, detail="Invalid or expired reset token")
        user.password_hash       = pwd_context.hash(body.new_password)
        user.reset_token         = None
        user.reset_token_expires = None
        db.commit()
        return {"ok": True}
    finally:
        db.close()


@router.post("/api/auth/session")
def update_session(body: SessionBody, request: Request, current_user=Depends(require_approved_user)):
    import json as _j
    from database import SessionLocal, User as DbUser
    db = SessionLocal()
    try:
        u = db.query(DbUser).filter(DbUser.id == current_user.id).first()
        if u:
            lat = float(body.lat) if body.lat is not None else None
            lon = float(body.lon) if body.lon is not None else None
            u.last_seen    = datetime.utcnow()
            u.last_ip      = (request.headers.get("X-Forwarded-For") or request.client.host or "").split(",")[0].strip()
            u.current_view = _j.dumps({"lat": lat, "lon": lon, "zoom": body.zoom, "event": body.event})
            if lat is not None and lon is not None:
                u.location_lat     = lat
                u.location_lon     = lon
                u.location_updated = datetime.utcnow()
            db.commit()
        return {"ok": True}
    finally:
        db.close()


@router.get("/api/users/search")
def users_search(q: str = Query(""), current_user=Depends(require_approved_user)):
    from database import SessionLocal, User as DbUser
    db = SessionLocal()
    try:
        q = q.strip()
        if not q:
            return []
        like = f"%{q}%"
        results = db.query(DbUser).filter(
            DbUser.approved == True,
            DbUser.id != current_user.id,
            (DbUser.name.ilike(like) | DbUser.email.ilike(like)),
        ).limit(10).all()
        return [{"id": u.id, "name": u.name, "email": u.email, "role": u.role} for u in results]
    finally:
        db.close()


class LocationBody(BaseModel):
    lat: float
    lon: float


@router.post("/api/user/location")
def update_user_location(body: LocationBody, request: Request, current_user=Depends(require_approved_user)):
    from database import SessionLocal, User as DbUser
    db = SessionLocal()
    try:
        u = db.query(DbUser).filter(DbUser.id == current_user.id).first()
        if u:
            u.location_lat     = body.lat
            u.location_lon     = body.lon
            u.location_updated = datetime.utcnow()
            db.commit()
        ip = (request.headers.get("X-Forwarded-For") or request.client.host or "").split(",")[0].strip()
        append_location_history(current_user.id, body.lat, body.lon)
        log_activity(current_user.id, current_user.email, "location_update", {"lat": body.lat, "lon": body.lon}, ip)
        return {"status": "ok"}
    finally:
        db.close()
