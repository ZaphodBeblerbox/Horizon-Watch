"""routers/admin.py — All /api/admin/* and /api/chat/* endpoints."""

from __future__ import annotations
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app_shared import require_approved_user, require_admin_user, require_superadmin_user, send_email, user_dict, FRONTEND_URL, ACTIVITY_LOG

router = APIRouter(tags=["admin"])


# ── Pydantic models ───────────────────────────────────────────────────────────

class UpdateUserBody(BaseModel):
    approved: Optional[bool] = None
    role:     Optional[str]  = None
    notes:    Optional[str]  = None


class MsgBody(BaseModel):
    content:       str
    message_type:  str = "text"
    attachment_id: str = None


# ── Admin user management ─────────────────────────────────────────────────────

@router.get("/api/admin/users")
def admin_list_users(current_user=Depends(require_admin_user)):
    from database import SessionLocal, User as DbUser
    db = SessionLocal()
    try:
        users = db.query(DbUser).order_by(DbUser.created_at.desc()).all()
        return {"users": [user_dict(u) for u in users]}
    finally:
        db.close()


@router.put("/api/admin/users/{user_id}")
def admin_update_user(user_id: str, body: UpdateUserBody, current_user=Depends(require_admin_user)):
    from database import SessionLocal, User as DbUser
    db = SessionLocal()
    try:
        target = db.query(DbUser).filter(DbUser.id == user_id).first()
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        if target.is_super_admin and not current_user.is_super_admin:
            raise HTTPException(status_code=403, detail="Cannot modify super admin accounts")
        if body.role == "admin" and not current_user.is_super_admin:
            raise HTTPException(status_code=403, detail="Only super admins can promote to admin")
        if body.approved is not None:
            target.approved = body.approved
        if body.role is not None:
            target.role = body.role
        if body.notes is not None:
            target.notes = body.notes
        db.commit()
        return user_dict(target)
    finally:
        db.close()


@router.delete("/api/admin/users/{user_id}")
def admin_delete_user(user_id: str, current_user=Depends(require_admin_user)):
    from database import SessionLocal, User as DbUser
    db = SessionLocal()
    try:
        target = db.query(DbUser).filter(DbUser.id == user_id).first()
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        if target.id == current_user.id:
            raise HTTPException(status_code=400, detail="Cannot delete your own account")
        if target.is_super_admin and not current_user.is_super_admin:
            raise HTTPException(status_code=403, detail="Cannot delete super admin accounts")
        db.delete(target)
        db.commit()
        return {"ok": True}
    finally:
        db.close()


@router.post("/api/admin/users/{user_id}/approve")
def admin_approve_user(user_id: str, current_user=Depends(require_admin_user)):
    from database import SessionLocal, User as DbUser
    db = SessionLocal()
    try:
        target = db.query(DbUser).filter(DbUser.id == user_id).first()
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        target.approved = True
        db.commit()
        send_email(
            target.email,
            "Horizon Watch — Access Approved",
            f"<p>Your Horizon Watch account has been approved. You can now log in at <a href='{FRONTEND_URL}'>{FRONTEND_URL}</a>.</p>",
        )
        return user_dict(target)
    finally:
        db.close()


@router.post("/api/admin/users/{user_id}/make-admin")
def admin_make_admin(user_id: str, current_user=Depends(require_admin_user)):
    if not current_user.is_super_admin:
        raise HTTPException(status_code=403, detail="Only super admins can promote to admin")
    from database import SessionLocal, User as DbUser
    db = SessionLocal()
    try:
        target = db.query(DbUser).filter(DbUser.id == user_id).first()
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        target.role = "admin"
        db.commit()
        return user_dict(target)
    finally:
        db.close()


@router.get("/api/admin/active-users")
def admin_active_users(current_user=Depends(require_admin_user)):
    import json as _j
    from database import SessionLocal, User as DbUser
    db = SessionLocal()
    try:
        cutoff = datetime.utcnow() - timedelta(minutes=10)
        users  = db.query(DbUser).filter(
            DbUser.last_seen >= cutoff,
            DbUser.approved  == True,
        ).all()
        result = []
        for u in users:
            cv = {}
            if u.current_view:
                try:
                    cv = _j.loads(u.current_view)
                except Exception:
                    pass
            result.append({
                "id":            u.id,
                "name":          u.name,
                "email":         u.email,
                "role":          u.role,
                "is_super_admin": u.is_super_admin,
                "last_seen":     u.last_seen.isoformat() if u.last_seen else None,
                "last_ip":       u.last_ip or "",
                "created_at":    u.created_at.isoformat() if u.created_at else None,
                "last_login":    u.last_login.isoformat() if u.last_login else None,
                "location_lat":  u.location_lat if getattr(u, "location_lat", None) is not None else cv.get("lat"),
                "location_lon":  u.location_lon if getattr(u, "location_lon", None) is not None else cv.get("lon"),
                "location_city": getattr(u, "location_city", None),
                "current_view":  cv,
            })
        return result
    finally:
        db.close()


# ── Chat ──────────────────────────────────────────────────────────────────────

@router.get("/api/chat/conversations")
def chat_conversations(current_user=Depends(require_approved_user)):
    from database import SessionLocal, DirectMessage as DM, User as DbUser
    from sqlalchemy import or_, and_
    db = SessionLocal()
    try:
        uid       = current_user.id
        sent_to   = db.query(DM.recipient_id).filter(DM.sender_id    == uid).distinct()
        recv_from = db.query(DM.sender_id   ).filter(DM.recipient_id == uid).distinct()
        partner_ids = {r[0] for r in sent_to} | {r[0] for r in recv_from}
        convs = []
        for pid in partner_ids:
            partner = db.query(DbUser).filter(DbUser.id == pid).first()
            if not partner:
                continue
            last_msg = (
                db.query(DM)
                .filter(or_(
                    and_(DM.sender_id == uid, DM.recipient_id == pid),
                    and_(DM.sender_id == pid, DM.recipient_id == uid),
                ))
                .order_by(DM.timestamp.desc())
                .first()
            )
            unread = db.query(DM).filter(
                DM.sender_id    == pid,
                DM.recipient_id == uid,
                DM.read_at.is_(None),
            ).count()
            convs.append({
                "partner": {"id": partner.id, "name": partner.name, "email": partner.email, "role": partner.role},
                "last_message": {
                    "content":   last_msg.content if last_msg else "",
                    "timestamp": last_msg.timestamp.isoformat() if last_msg else None,
                    "is_mine":   last_msg.sender_id == uid if last_msg else False,
                },
                "unread_count": unread,
            })
        convs.sort(key=lambda c: c["last_message"]["timestamp"] or "", reverse=True)
        return convs
    finally:
        db.close()


@router.get("/api/chat/conversations/{partner_id}/messages")
def chat_get_messages(partner_id: str, current_user=Depends(require_approved_user)):
    from database import SessionLocal, DirectMessage as DM
    from sqlalchemy import or_, and_
    db = SessionLocal()
    try:
        uid  = current_user.id
        msgs = (
            db.query(DM)
            .filter(or_(
                and_(DM.sender_id == uid, DM.recipient_id == partner_id),
                and_(DM.sender_id == partner_id, DM.recipient_id == uid),
            ))
            .order_by(DM.timestamp.asc())
            .limit(200)
            .all()
        )
        for m in msgs:
            if m.recipient_id == uid and m.read_at is None:
                m.read_at = datetime.utcnow()
        db.commit()
        return [
            {
                "id":            m.id,
                "sender_id":     m.sender_id,
                "content":       m.content,
                "message_type":  m.message_type,
                "attachment_id": m.attachment_id,
                "timestamp":     m.timestamp.isoformat(),
                "read_at":       m.read_at.isoformat() if m.read_at else None,
            }
            for m in msgs
        ]
    finally:
        db.close()


@router.post("/api/chat/conversations/{partner_id}/messages")
def chat_send_message(partner_id: str, body: MsgBody, current_user=Depends(require_approved_user)):
    from database import SessionLocal, DirectMessage as DM, User as DbUser
    db = SessionLocal()
    try:
        partner = db.query(DbUser).filter(DbUser.id == partner_id).first()
        if not partner:
            raise HTTPException(status_code=404, detail="User not found")
        msg = DM(
            sender_id     = current_user.id,
            recipient_id  = partner_id,
            content       = body.content,
            message_type  = body.message_type,
            attachment_id = body.attachment_id,
        )
        db.add(msg)
        db.commit()
        db.refresh(msg)
        return {
            "id":            msg.id,
            "sender_id":     msg.sender_id,
            "content":       msg.content,
            "message_type":  msg.message_type,
            "attachment_id": msg.attachment_id,
            "timestamp":     msg.timestamp.isoformat(),
            "read_at":       None,
        }
    finally:
        db.close()


# ── User location tracking ────────────────────────────────────────────────────

@router.get("/api/admin/user-locations")
def get_user_locations(current_user=Depends(require_superadmin_user)):
    from database import SessionLocal, User as DbUser
    db = SessionLocal()
    try:
        cutoff = datetime.utcnow() - timedelta(hours=24)
        users = db.query(DbUser).filter(
            DbUser.approved == True,
            DbUser.location_updated >= cutoff,
            DbUser.location_lat != None,
            DbUser.location_lon != None,
        ).all()
        now = datetime.utcnow()
        result = []
        for u in users:
            age_minutes = round((now - u.location_updated).total_seconds() / 60) if u.location_updated else 9999
            result.append({
                "user_id":     u.id,
                "lat":         u.location_lat,
                "lon":         u.location_lon,
                "timestamp":   u.location_updated.isoformat() if u.location_updated else None,
                "email":       u.email,
                "name":        u.name or u.email,
                "role":        u.role,
                "is_live":     age_minutes < 5,
                "age_minutes": age_minutes,
            })
        return result
    finally:
        db.close()


@router.get("/api/admin/activity-log")
def get_activity_log(
    limit: int = 200,
    action_type: str = None,
    current_user=Depends(require_superadmin_user),
):
    logs = list(reversed(ACTIVITY_LOG))
    if action_type:
        logs = [l for l in logs if l["action"] == action_type]
    return logs[:limit]
