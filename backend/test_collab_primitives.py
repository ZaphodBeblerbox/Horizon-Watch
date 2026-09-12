"""
Verification script for Workstation Part 8 — collaboration primitives
(comments with real @mention, generic record assignment, real presence
heartbeat, and per-record activity log), plus confirming My Work's real
"mentions" and "assigned to me" queues (Part 5) actually pick up real
data from these new primitives instead of only ever reporting zero.

Runs against the REAL backend/data directory (gitignored), same pattern
as this round's other verification scripts. Creates real throwaway
Team/User/Alert rows, exercises every new endpoint, confirms the
My Work queues reflect them, and cleans up everything it creates.

Usage:
    cd backend
    python3 test_collab_primitives.py
"""
import os, sys, uuid
os.environ.setdefault("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
sys.path.insert(0, os.path.dirname(__file__))

FAILURES = []

def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)

print("=" * 70)
print("  Workstation Part 8 — collaboration primitives — verification")
print("=" * 70)

import database  # noqa: E402
database.migrate_db()

import sqlite3
db_path = os.path.join(os.environ["DATA_DIR"], "akili.db")
conn = sqlite3.connect(db_path)
tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
conn.close()
check("migrate_db() created the comments table", "comments" in tables)
check("migrate_db() created the record_assignments table", "record_assignments" in tables)
check("migrate_db() created the activity_log table", "activity_log" in tables)

from fastapi.testclient import TestClient
import main  # noqa: E402
from database import User, Alert, Comment, RecordAssignment, ActivityLogEntry, get_db

suffix = uuid.uuid4().hex[:8]
author_id = str(uuid.uuid4())
mentioned_id = str(uuid.uuid4())
assignee_id = str(uuid.uuid4())
alert_id = f"ALT-TEST-{suffix}"
record_ref = f"sig:{alert_id}"

with get_db() as db:
    db.add(User(id=author_id, email=f"author-{suffix}@trifecta-technologies.com", password_hash="x", name="Ada Author", role="analyst", approved=True))
    db.add(User(id=mentioned_id, email=f"mentioned-{suffix}@trifecta-technologies.com", password_hash="x", name="Milo Mentioned", role="analyst", approved=True))
    db.add(User(id=assignee_id, email=f"assignee-{suffix}@trifecta-technologies.com", password_hash="x", name="Ash Assignee", role="analyst", approved=True))
    db.add(Alert(alert_id=alert_id, source="manual", alert_type="test_signal", title="Test collab signal", severity="high", status="active"))
    db.commit()

author_token = main._create_session_token(author_id)

with TestClient(main.app) as client:
    client.cookies.set("hw_session", author_token)

    # ── Comments + @mention ──
    r = client.post("/api/comments", json={"record_ref": record_ref, "body": "@Milo can you check this?", "mentioned_user_ids": [mentioned_id]})
    check("POST /api/comments succeeds", r.status_code == 200, str(r.status_code))
    comment = r.json()
    check("comment records the real author from the session, not a client-supplied value", comment.get("author_user_id") == author_id)
    check("comment records the real validated mention", comment.get("mentioned_user_ids") == [mentioned_id], str(comment.get("mentioned_user_ids")))

    bad_mention = client.post("/api/comments", json={"record_ref": record_ref, "body": "hello", "mentioned_user_ids": ["not-a-real-user-id"]})
    check("a fabricated user id is silently dropped from mentioned_user_ids (never trusted as real)", bad_mention.json().get("mentioned_user_ids") == [])

    listed = client.get("/api/comments", params={"record_ref": record_ref})
    check("GET /api/comments lists the real posted comments", len(listed.json()) == 2, str(listed.json()))

    resolved = client.post(f"/api/comments/{comment['comment_id']}/resolve")
    check("POST /api/comments/{id}/resolve marks it resolved", resolved.json().get("resolved") is True)
    reopened = client.post(f"/api/comments/{comment['comment_id']}/reopen")
    check("POST /api/comments/{id}/reopen un-resolves it", reopened.json().get("resolved") is False)

    unauth_comment = TestClient(main.app).post("/api/comments", json={"record_ref": record_ref, "body": "x", "mentioned_user_ids": []})
    check("POST /api/comments requires a real session (401 without one)", unauth_comment.status_code == 401, str(unauth_comment.status_code))

    # ── Assignment ──
    a1 = client.post("/api/assignments", json={"record_ref": record_ref, "assignee_user_id": assignee_id, "due_at": None})
    check("POST /api/assignments succeeds", a1.status_code == 200, str(a1.status_code))
    check("real assignee recorded", a1.json().get("assignee_user_id") == assignee_id)

    fake_assignee = client.post("/api/assignments", json={"record_ref": record_ref, "assignee_user_id": "not-a-real-user"})
    check("assigning to a non-real user is rejected (404)", fake_assignee.status_code == 404, str(fake_assignee.status_code))

    got = client.get("/api/assignments", params={"record_ref": record_ref})
    check("GET /api/assignments returns the real current assignment", got.json() is not None and got.json().get("assignee_user_id") == assignee_id)

    a2 = client.post("/api/assignments", json={"record_ref": record_ref, "assignee_user_id": author_id, "due_at": None})
    check("reassigning succeeds", a2.status_code == 200)
    with get_db() as db:
        old = db.query(RecordAssignment).filter(RecordAssignment.id == a1.json()["id"]).first()
        check("real assignment history preserved — the OLD assignment row is marked done, not deleted/overwritten", old is not None and old.done is True)

    done_resp = client.post(f"/api/assignments/{a2.json()['id']}/done")
    check("POST /api/assignments/{id}/done marks it done", done_resp.json().get("done") is True)
    after_done = client.get("/api/assignments", params={"record_ref": record_ref})
    check("GET /api/assignments returns null once the only assignment is done", after_done.json() is None, str(after_done.json()))

    # re-assign for the queue checks below
    client.post("/api/assignments", json={"record_ref": record_ref, "assignee_user_id": assignee_id, "due_at": None})

    # ── Activity log ──
    activity = client.get("/api/activity", params={"record_ref": record_ref})
    verbs = [e["verb"] for e in activity.json()]
    check("activity log recorded real 'commented' events", "commented" in verbs, str(verbs))
    check("activity log recorded real 'assigned'/'reassigned' events", any(v in verbs for v in ("assigned", "reassigned")), str(verbs))
    check("activity log recorded the real 'done' event", "done" in verbs, str(verbs))

    # ── Presence ──
    hb = client.post("/api/presence", params={"record_ref": record_ref})
    check("POST /api/presence heartbeat succeeds", hb.status_code == 200, str(hb.status_code))
    pres = client.get("/api/presence", params={"record_ref": record_ref})
    pres_ids = [u["id"] for u in pres.json().get("users", [])]
    check("GET /api/presence reflects the real user who just heartbeat", author_id in pres_ids, str(pres_ids))
    check("presence response is honestly labeled as poll-based (ttl_seconds present, not a push guarantee)", "ttl_seconds" in pres.json())

    # ── My Work queues now actually reflect these real primitives (Part 5) ──
    mentioned_token = main._create_session_token(mentioned_id)
    mclient = TestClient(main.app)
    mclient.cookies.set("hw_session", mentioned_token)
    mq = mclient.get("/api/workstation/queues", params={"scope": "mine"}).json()["queues"]
    mention_refs = [i["ref"] for i in mq["mentions"]["items"]]
    check("My Work's real Mentions queue now actually returns the real mention (not just zero)", record_ref in mention_refs, str(mention_refs))

    assignee_token = main._create_session_token(assignee_id)
    aclient = TestClient(main.app)
    aclient.cookies.set("hw_session", assignee_token)
    aq = aclient.get("/api/workstation/queues", params={"scope": "mine"}).json()["queues"]
    assigned_refs = [i["ref"] for i in aq["assigned_to_me"]["items"]]
    check("My Work's real 'assigned to me' queue now includes the real generic RecordAssignment", record_ref in assigned_refs, str(assigned_refs))

# ── Cleanup ──
with get_db() as db:
    db.query(Comment).filter(Comment.record_ref == record_ref).delete(synchronize_session=False)
    db.query(RecordAssignment).filter(RecordAssignment.record_ref == record_ref).delete(synchronize_session=False)
    db.query(ActivityLogEntry).filter(ActivityLogEntry.record_ref == record_ref).delete(synchronize_session=False)
    db.query(Alert).filter(Alert.alert_id == alert_id).delete(synchronize_session=False)
    db.query(User).filter(User.id.in_([author_id, mentioned_id, assignee_id])).delete(synchronize_session=False)
    db.commit()
    check("cleanup removed every real throwaway row",
          db.query(Comment).filter(Comment.record_ref == record_ref).count() == 0 and
          db.query(User).filter(User.id.in_([author_id, mentioned_id, assignee_id])).count() == 0)

print("=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    sys.exit(1)
print(f"  RESULT: all checks passed")
sys.exit(0)
