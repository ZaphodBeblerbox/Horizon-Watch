"""case_workspace.py — the contents of a case: folders, files and documents.

TWO RULES SHAPE EVERYTHING HERE.

1. Nothing is global. Every read resolves the caller's identity from the
   session cookie and filters to cases they own or have been explicitly
   shared. There is no "list all cases" path for a normal user, because the
   moment one exists every later feature is written on top of it and the
   boundary is gone.

2. Sharing is an explicit row. A CaseShare or nothing. No team-wide flag, no
   role that implies read-everything. "My detections are mine unless I
   share" is only true if the absence of a share row is the only default.

Binary content lives on disk under DATA_DIR/case_files/<case_id>/<node_id>;
the row carries the pointer. Storing a satellite crop in a TEXT column makes
every folder listing drag the bytes along with it.
"""

import datetime
import json
import os
import re
import uuid

from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import FileResponse

router = APIRouter(prefix="/api/cases", tags=["case-workspace"])


def _data_root():
    from main import DATA_DIR
    root = os.path.join(DATA_DIR, "case_files")
    os.makedirs(root, exist_ok=True)
    return root


def _me(request: Request) -> dict:
    from main import _require_current_user
    return _require_current_user(request)


def _case_access(db, case_id: str, user_id: str, need_edit: bool = False):
    """Returns the Case, or raises. Owner always; sharee per can_edit.

    404 rather than 403 when there is no access at all: telling an
    unauthorised caller that a case exists is itself a disclosure.
    """
    from database import Case, CaseShare
    c = db.query(Case).filter(Case.case_id == case_id).first()
    if not c:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found")
    if c.owner_user_id == user_id:
        return c
    share = db.query(CaseShare).filter(
        CaseShare.case_id == case_id, CaseShare.user_id == user_id).first()
    if not share:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found")
    if need_edit and not share.can_edit:
        raise HTTPException(status_code=403, detail="shared read-only")
    return c


def _node_dict(n):
    return {
        "id": n.id, "case_id": n.case_id, "parent_id": n.parent_id,
        "kind": n.kind, "name": n.name, "owner_user_id": n.owner_user_id,
        "mime": n.mime, "size_bytes": n.size_bytes,
        "sort_index": n.sort_index,
        "created_at": n.created_at.isoformat() if n.created_at else None,
        "updated_at": n.updated_at.isoformat() if n.updated_at else None,
    }


# ── tree ─────────────────────────────────────────────────────────────────

@router.get("/{case_id}/nodes")
def list_nodes(case_id: str, request: Request):
    """The whole tree for a case, flat. The client assembles it.

    Flat-and-assemble rather than a nested response because the same list
    also answers "where can I move this to" and "what is the path of that",
    and a nested payload has to be walked to answer either.
    """
    from database import CaseNode, get_db
    me = _me(request)
    with get_db() as db:
        _case_access(db, case_id, me["id"])
        rows = (db.query(CaseNode)
                  .filter(CaseNode.case_id == case_id)
                  .order_by(CaseNode.sort_index, CaseNode.name).all())
        return [_node_dict(n) for n in rows]


@router.post("/{case_id}/nodes")
async def create_node(case_id: str, request: Request):
    """A folder, or an empty document. Files come in through /files."""
    from database import CaseNode, get_db
    me = _me(request)
    body = await request.json()
    kind = (body.get("kind") or "").strip()
    if kind not in ("folder", "doc"):
        raise HTTPException(status_code=400, detail="kind must be 'folder' or 'doc'")
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    with get_db() as db:
        _case_access(db, case_id, me["id"], need_edit=True)
        parent_id = body.get("parent_id")
        if parent_id:
            parent = db.query(CaseNode).filter(
                CaseNode.id == parent_id, CaseNode.case_id == case_id).first()
            if not parent:
                raise HTTPException(status_code=400, detail="parent not found in this case")
            if parent.kind != "folder":
                raise HTTPException(status_code=400, detail="parent must be a folder")
        n = CaseNode(
            case_id=case_id, parent_id=parent_id or None, kind=kind, name=name,
            owner_user_id=me["id"],
            body_html=("" if kind == "doc" else None),
            sort_index=int(body.get("sort_index") or 0),
        )
        db.add(n); db.commit(); db.refresh(n)
        return _node_dict(n)


@router.patch("/{case_id}/nodes/{node_id}")
async def update_node(case_id: str, node_id: str, request: Request):
    """Rename, move, or save a document's body."""
    from database import CaseNode, get_db
    me = _me(request)
    body = await request.json()
    with get_db() as db:
        _case_access(db, case_id, me["id"], need_edit=True)
        n = db.query(CaseNode).filter(
            CaseNode.id == node_id, CaseNode.case_id == case_id).first()
        if not n:
            raise HTTPException(status_code=404, detail="node not found")
        if "name" in body:
            nm = (body["name"] or "").strip()
            if not nm:
                raise HTTPException(status_code=400, detail="name cannot be empty")
            n.name = nm
        if "parent_id" in body:
            new_parent = body["parent_id"] or None
            if new_parent == n.id:
                raise HTTPException(status_code=400, detail="a folder cannot contain itself")
            if new_parent:
                # Walk up from the target. Without this a folder can be
                # dropped into its own descendant and that whole subtree
                # detaches from the root — invisible, undeletable, still
                # counted.
                seen, cur = set(), new_parent
                while cur:
                    if cur == n.id:
                        raise HTTPException(status_code=400, detail="cannot move a folder into its own subtree")
                    if cur in seen:
                        break
                    seen.add(cur)
                    p = db.query(CaseNode).filter(CaseNode.id == cur).first()
                    cur = p.parent_id if p else None
            n.parent_id = new_parent
        if "body_html" in body and n.kind == "doc":
            n.body_html = body["body_html"] or ""
        if "sort_index" in body:
            n.sort_index = int(body["sort_index"] or 0)
        db.commit(); db.refresh(n)
        return _node_dict(n)


@router.get("/{case_id}/nodes/{node_id}/doc")
def get_doc(case_id: str, node_id: str, request: Request):
    from database import CaseNode, get_db
    me = _me(request)
    with get_db() as db:
        _case_access(db, case_id, me["id"])
        n = db.query(CaseNode).filter(
            CaseNode.id == node_id, CaseNode.case_id == case_id, CaseNode.kind == "doc").first()
        if not n:
            raise HTTPException(status_code=404, detail="document not found")
        d = _node_dict(n); d["body_html"] = n.body_html or ""
        return d


@router.delete("/{case_id}/nodes/{node_id}")
def delete_node(case_id: str, node_id: str, request: Request):
    """Deletes the node and everything under it, files included."""
    from database import CaseNode, get_db
    me = _me(request)
    with get_db() as db:
        _case_access(db, case_id, me["id"], need_edit=True)
        rows = db.query(CaseNode).filter(CaseNode.case_id == case_id).all()
        by_parent = {}
        for r in rows:
            by_parent.setdefault(r.parent_id, []).append(r)
        target = next((r for r in rows if r.id == node_id), None)
        if not target:
            raise HTTPException(status_code=404, detail="node not found")

        doomed, stack = [], [target]
        while stack:
            cur = stack.pop()
            doomed.append(cur)
            stack.extend(by_parent.get(cur.id, []))

        for d in doomed:
            # Remove the bytes before the row. The other order can leave a
            # file on disk with nothing pointing at it, which is invisible
            # and grows forever.
            if d.storage_path:
                try:
                    os.remove(os.path.join(_data_root(), d.storage_path))
                except OSError:
                    pass
            db.delete(d)
        db.commit()
        return {"ok": True, "deleted": len(doomed)}


# ── files ────────────────────────────────────────────────────────────────

# Allowlist. An upload surface that accepts anything is a file-serving
# surface that serves anything, including active content back to the
# browser under this origin.
ALLOWED_MIME = {
    "application/pdf": ".pdf",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/tiff": ".tif",
    "text/csv": ".csv",
    "text/plain": ".txt",
    "application/geo+json": ".geojson",
    "application/json": ".json",
}
MAX_BYTES = 64 * 1024 * 1024


@router.post("/{case_id}/files")
async def upload_file(
    case_id: str,
    request: Request,
    file: UploadFile = File(...),
    parent_id: str = Form(None),
    name: str = Form(None),
):
    from database import CaseNode, get_db
    me = _me(request)
    mime = (file.content_type or "").split(";")[0].strip().lower()
    if mime not in ALLOWED_MIME:
        raise HTTPException(status_code=415, detail=f"unsupported file type: {mime or 'unknown'}")

    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="file larger than 64MB")

    with get_db() as db:
        _case_access(db, case_id, me["id"], need_edit=True)
        if parent_id:
            parent = db.query(CaseNode).filter(
                CaseNode.id == parent_id, CaseNode.case_id == case_id,
                CaseNode.kind == "folder").first()
            if not parent:
                raise HTTPException(status_code=400, detail="parent folder not found in this case")

        node_id = str(uuid.uuid4())
        # The stored name is derived, never the client's. A filename is
        # attacker-controlled and "../" in one is how an upload escapes its
        # directory.
        rel = os.path.join(_safe_seg(case_id), node_id + ALLOWED_MIME[mime])
        dest = os.path.join(_data_root(), rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as fh:
            fh.write(data)

        n = CaseNode(
            id=node_id, case_id=case_id, parent_id=parent_id or None, kind="file",
            name=(name or file.filename or "file").strip()[:255],
            owner_user_id=me["id"], mime=mime, size_bytes=len(data), storage_path=rel,
        )
        db.add(n); db.commit(); db.refresh(n)
        return _node_dict(n)


def _safe_seg(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", s or "")[:64] or "_"


@router.get("/{case_id}/files/{node_id}")
def download_file(case_id: str, node_id: str, request: Request):
    from database import CaseNode, get_db
    me = _me(request)
    with get_db() as db:
        _case_access(db, case_id, me["id"])
        n = db.query(CaseNode).filter(
            CaseNode.id == node_id, CaseNode.case_id == case_id, CaseNode.kind == "file").first()
        if not n or not n.storage_path:
            raise HTTPException(status_code=404, detail="file not found")
        root = _data_root()
        path = os.path.normpath(os.path.join(root, n.storage_path))
        # Even though the path is server-generated, verify it resolves
        # inside the root — a bad row must not become a read of /etc.
        if not path.startswith(os.path.realpath(root) + os.sep) and not path.startswith(root + os.sep):
            raise HTTPException(status_code=404, detail="file not found")
        if not os.path.exists(path):
            raise HTTPException(status_code=404, detail="file missing from storage")
        return FileResponse(path, media_type=n.mime or "application/octet-stream", filename=n.name)


# ── sharing ──────────────────────────────────────────────────────────────

@router.get("/{case_id}/shares")
def list_shares(case_id: str, request: Request):
    from database import CaseShare, User, get_db
    me = _me(request)
    with get_db() as db:
        c = _case_access(db, case_id, me["id"])
        rows = db.query(CaseShare).filter(CaseShare.case_id == case_id).all()
        out = []
        for r in rows:
            u = db.query(User).filter(User.id == r.user_id).first()
            out.append({
                "user_id": r.user_id,
                "name": (u.name or u.email) if u else r.user_id,
                "email": u.email if u else None,
                "can_edit": bool(r.can_edit),
                "shared_by": r.shared_by,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            })
        return {"owner_user_id": c.owner_user_id, "shares": out}


@router.post("/{case_id}/shares")
async def add_share(case_id: str, request: Request):
    """Only the owner may share. A sharee who could re-share would make the
    owner's list of who can see their work incomplete and wrong."""
    from database import CaseShare, User, get_db
    me = _me(request)
    body = await request.json()
    target = (body.get("user_id") or "").strip()
    if not target:
        raise HTTPException(status_code=400, detail="user_id is required")
    with get_db() as db:
        c = _case_access(db, case_id, me["id"])
        if c.owner_user_id != me["id"]:
            raise HTTPException(status_code=403, detail="only the owner can share this case")
        if target == c.owner_user_id:
            raise HTTPException(status_code=400, detail="the owner already has access")
        if not db.query(User).filter(User.id == target).first():
            raise HTTPException(status_code=404, detail="no such user")
        existing = db.query(CaseShare).filter(
            CaseShare.case_id == case_id, CaseShare.user_id == target).first()
        if existing:
            existing.can_edit = bool(body.get("can_edit", existing.can_edit))
        else:
            db.add(CaseShare(case_id=case_id, user_id=target, shared_by=me["id"],
                             can_edit=bool(body.get("can_edit", False))))
        db.commit()

    _notify_shared(case_id, target, me)
    return {"ok": True}


@router.delete("/{case_id}/shares/{user_id}")
def remove_share(case_id: str, user_id: str, request: Request):
    from database import CaseShare, get_db
    me = _me(request)
    with get_db() as db:
        c = _case_access(db, case_id, me["id"])
        if c.owner_user_id != me["id"]:
            raise HTTPException(status_code=403, detail="only the owner can change sharing")
        db.query(CaseShare).filter(
            CaseShare.case_id == case_id, CaseShare.user_id == user_id).delete()
        db.commit()
        return {"ok": True}


def _notify_shared(case_id: str, target_user_id: str, sharer: dict):
    """Best-effort push. A share that succeeded must not be reported as
    failed because a notification could not be delivered."""
    try:
        from main import _send_push
        who = sharer.get("name") or sharer.get("email") or "Someone"
        _send_push(
            target_user_id,
            f"{who} shared a case with you",
            f"Case {case_id}",
            {"url": f"/?case={case_id}", "kind": "case-share", "case_id": case_id},
        )
    except Exception as e:  # noqa: BLE001
        print(f"[case-share] push notify failed for {target_user_id}: {e}")
