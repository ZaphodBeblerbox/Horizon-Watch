"""
app_shared.py — Shared auth utilities and dependencies for Horizon Watch routers.

Imported by main.py (for backwards-compatibility aliases) and by all router
modules that need auth, so none of them import from main.py at module level.
"""

from __future__ import annotations
import os
from datetime import datetime, timedelta
from typing import Optional

import uuid as _uuid_mod
from fastapi import HTTPException, Depends

# ── JWT / auth config ─────────────────────────────────────────────────────────
JWT_SECRET      = os.getenv("JWT_SECRET", "hw-dev-secret-change-in-prod")
JWT_ALGORITHM   = "HS256"
JWT_EXPIRE_DAYS = 7
FRONTEND_URL    = os.getenv("FRONTEND_URL", "http://localhost:5173")
RESEND_API_KEY  = os.getenv("RESEND_API_KEY", "")

# ── Optional auth deps (gracefully degrade if packages missing) ───────────────
try:
    from jose import jwt as _jose_jwt
    from passlib.context import CryptContext as _CryptContext
    from fastapi.security import (
        HTTPBearer as _HTTPBearer,
        HTTPAuthorizationCredentials as _HTTPCreds,
    )
    HAS_AUTH    = True
    pwd_context = _CryptContext(schemes=["bcrypt"], deprecated="auto")
    auth_bearer = _HTTPBearer(auto_error=False)
except ImportError:
    HAS_AUTH    = False
    _jose_jwt   = None  # type: ignore
    _HTTPCreds  = None  # type: ignore
    pwd_context = None
    auth_bearer = None


# ── JWT helpers ───────────────────────────────────────────────────────────────

def make_jwt(user_id: str) -> str:
    expire = datetime.utcnow() + timedelta(days=JWT_EXPIRE_DAYS)
    return _jose_jwt.encode({"sub": user_id, "exp": expire}, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_jwt(token: str):
    try:
        return _jose_jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception:
        return None


def get_user_from_token(credentials) -> Optional[object]:
    """Extract an approved user from a Bearer token. Returns None if invalid/absent."""
    if not credentials or not HAS_AUTH:
        return None
    token = credentials.credentials if hasattr(credentials, "credentials") else credentials
    payload = decode_jwt(token)
    if not payload:
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    from database import SessionLocal, User as DbUser
    db = SessionLocal()
    try:
        user = db.query(DbUser).filter(DbUser.id == user_id).first()
        return user if (user and user.approved) else None
    finally:
        db.close()


# ── FastAPI dependencies ──────────────────────────────────────────────────────

def get_optional_user(credentials: Optional[_HTTPCreds] = Depends(auth_bearer) if HAS_AUTH else None):
    """Returns user or None — never raises."""
    return get_user_from_token(credentials)


def require_approved_user(credentials: Optional[_HTTPCreds] = Depends(auth_bearer) if HAS_AUTH else None):
    """Raises 401 if no valid approved-user token."""
    user = get_user_from_token(credentials)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


def require_admin_user(credentials: Optional[_HTTPCreds] = Depends(auth_bearer) if HAS_AUTH else None):
    """Raises 403 if not admin/super-admin."""
    user = get_user_from_token(credentials)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    if user.role != "admin" and not user.is_super_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def require_superadmin_user(credentials: Optional[_HTTPCreds] = Depends(auth_bearer) if HAS_AUTH else None):
    """Raises 403 if not super-admin."""
    user = get_user_from_token(credentials)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not user.is_super_admin:
        raise HTTPException(status_code=403, detail="Superadmin only")
    return user


# ── Activity log (in-memory) ──────────────────────────────────────────────────

ACTIVITY_LOG: list = []
_ACTIVITY_LOG_MAX = 10000


def log_activity(user_id: str, email: str, action: str, details: dict = None, ip: str = None):
    ACTIVITY_LOG.append({
        "id":        str(_uuid_mod.uuid4()),
        "user_id":   user_id,
        "email":     email,
        "action":    action,
        "details":   details or {},
        "ip":        ip or "",
        "timestamp": datetime.utcnow().isoformat(),
    })
    if len(ACTIVITY_LOG) > _ACTIVITY_LOG_MAX:
        ACTIVITY_LOG.pop(0)


# ── Email helper ──────────────────────────────────────────────────────────────

def send_email(to: str, subject: str, html: str) -> None:
    """Send email via Resend if API key is configured, else log to console."""
    if not RESEND_API_KEY:
        print(f"[email] Would send to {to}: {subject}")
        return
    try:
        import resend
        resend.api_key = RESEND_API_KEY
        resend.Emails.send({
            "from":    "Horizon Watch <noreply@trifecta-technologies.com>",
            "to":      [to],
            "subject": subject,
            "html":    html,
        })
    except Exception as e:
        print(f"[email] Send failed: {e}")


# ── User serialisation ────────────────────────────────────────────────────────

def user_dict(u) -> dict:
    return {
        "id":             u.id,
        "email":          u.email,
        "name":           u.name,
        "role":           u.role,
        "is_super_admin": u.is_super_admin,
        "approved":       u.approved,
        "created_at":     u.created_at.isoformat() if u.created_at else None,
        "last_login":     u.last_login.isoformat() if u.last_login else None,
        "notes":          u.notes or "",
    }
