"""
Verification script for Workstation Part 5 — the real 7 My Work queues
(GET /api/workstation/queues) and the real calendar/activity sidebar
(GET /api/workstation/sidebar).

Creates real throwaway Team/User/Case/RFI/Alert/WatchZone rows shaped
exactly like real production data, confirms each queue picks up a real
record made for it, and confirms the mine/team/unassigned scope segment
actually changes each queue's result set. Runs against the REAL
backend/data directory (gitignored), same pattern as
test_theme_persistence.py / test_settings_persistence.py. Cleans up
everything it creates.

Usage:
    cd backend
    python3 test_workstation_queues.py
"""
import os, sys, uuid, json
from datetime import datetime, timedelta
os.environ.setdefault("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
sys.path.insert(0, os.path.dirname(__file__))

FAILURES = []

def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)

print("=" * 70)
print("  Workstation Part 5 — My Work queues + sidebar — verification")
print("=" * 70)

import database  # noqa: E402
database.migrate_db()

from fastapi.testclient import TestClient
import main  # noqa: E402
from database import User, Team, Case, RFI, Alert, WatchZone, get_db

suffix = uuid.uuid4().hex[:8]
team_id = f"team-{suffix}"
user_a_id = str(uuid.uuid4())   # "mine" — owns a case, has an open RFI, security_lead capability
user_b_id = str(uuid.uuid4())   # same team as A — for the "team" scope
case_mine_id = f"CS-TEST-{suffix}-1"
case_review_id = f"CS-TEST-{suffix}-2"
case_unassigned_id = f"CS-TEST-{suffix}-3"
rfi_id = f"RFI-TEST-{suffix}"
alert_id = f"ALT-TEST-{suffix}"
zone_id = f"AOI-TEST-{suffix}"

with get_db() as db:
    db.add(Team(id=team_id, name=f"Test Team {suffix}"))
    db.add(User(id=user_a_id, email=f"a-{suffix}@trifecta-technologies.com", password_hash="x",
                name="Alice Analyst", role="analyst", approved=True, team_id=team_id, capability_role="security_lead"))
    db.add(User(id=user_b_id, email=f"b-{suffix}@trifecta-technologies.com", password_hash="x",
                name="Bob Analyst", role="analyst", approved=True, team_id=team_id))
    due_soon = datetime.utcnow() + timedelta(days=2)
    db.add(Case(id=str(uuid.uuid4()), case_id=case_mine_id, title="Owned by A", owner_user_id=user_a_id,
                due_at=due_soon, approval_stage="draft"))
    db.add(Case(id=str(uuid.uuid4()), case_id=case_review_id, title="Awaiting A's review", owner_user_id=user_b_id,
                approval_stage="review"))
    db.add(Case(id=str(uuid.uuid4()), case_id=case_unassigned_id, title="No owner yet", owner_user_id=None))
    db.add(RFI(id=str(uuid.uuid4()), rfi_id=rfi_id, case_id=case_mine_id, from_user_id=user_b_id,
               to_user_id=user_a_id, question="What is the vessel's real flag state?", status="open", due_at=due_soon))
    db.add(Alert(alert_id=alert_id, source="manual", alert_type="test_signal", title="Test unreviewed signal",
                  severity="high", status="active", acknowledged_by=None))
    db.add(WatchZone(system_id=zone_id, name="Test AOI", polygon_geojson="{}",
                      bbox_min_lon=0, bbox_min_lat=0, bbox_max_lon=1, bbox_max_lat=1,
                      enabled=True, next_scan_at=datetime.utcnow() + timedelta(hours=6)))
    db.commit()

token = main._create_session_token(user_a_id)

with TestClient(main.app) as client:
    client.cookies.set("hw_session", token)

    r_mine = client.get("/api/workstation/queues", params={"scope": "mine"})
    check("GET /api/workstation/queues?scope=mine succeeds", r_mine.status_code == 200, str(r_mine.status_code))
    q = r_mine.json().get("queues", {})

    my_case_refs = [i["ref"] for i in q.get("my_cases", {}).get("items", [])]
    check("my_cases (mine) contains the real case A owns", f"case:{case_mine_id}" in my_case_refs, str(my_case_refs))
    check("my_cases (mine) does NOT contain B's unrelated case", f"case:{case_review_id}" not in my_case_refs)

    assigned_refs = [i["ref"] for i in q.get("assigned_to_me", {}).get("items", [])]
    check("assigned_to_me (mine) contains A's owned case", f"case:{case_mine_id}" in assigned_refs)
    check("assigned_to_me (mine) contains A's open RFI", f"rfi:{rfi_id}" in assigned_refs, str(assigned_refs))

    rfi_refs = [i["ref"] for i in q.get("rfis_to_answer", {}).get("items", [])]
    check("rfis_to_answer (mine) contains the real open RFI addressed to A", f"rfi:{rfi_id}" in rfi_refs, str(rfi_refs))

    review_refs = [i["ref"] for i in q.get("awaiting_my_review", {}).get("items", [])]
    check("awaiting_my_review (mine) contains B's case at 'review' stage (A's security_lead role has 'approve')",
          f"case:{case_review_id}" in review_refs, str(review_refs))

    check("urgent_mail is real, honest zero (no Mail model exists)", q.get("urgent_mail", {}).get("total") == 0)

    unreviewed_refs = [i["ref"] for i in q.get("unreviewed_signals", {}).get("items", [])]
    check("unreviewed_signals contains the real unacknowledged test alert", f"sig:{alert_id}" in unreviewed_refs, str(unreviewed_refs)[:200])

    # ── Scope actually changes results ──
    r_unassigned = client.get("/api/workstation/queues", params={"scope": "unassigned"})
    q_un = r_unassigned.json().get("queues", {})
    unassigned_case_refs = [i["ref"] for i in q_un.get("my_cases", {}).get("items", [])]
    check("my_cases (unassigned) contains the real ownerless case", f"case:{case_unassigned_id}" in unassigned_case_refs, str(unassigned_case_refs))
    check("my_cases result actually changes between mine and unassigned scope",
          set(i["ref"] for i in q.get("my_cases", {}).get("items", [])) != set(unassigned_case_refs))

    r_team = client.get("/api/workstation/queues", params={"scope": "team"})
    q_team = r_team.json().get("queues", {})
    team_case_refs = [i["ref"] for i in q_team.get("my_cases", {}).get("items", [])]
    check("my_cases (team) contains BOTH A's and B's real cases", f"case:{case_mine_id}" in team_case_refs and f"case:{case_review_id}" in team_case_refs, str(team_case_refs))
    check("my_cases result actually changes between mine and team scope",
          set(i["ref"] for i in q.get("my_cases", {}).get("items", [])) != set(team_case_refs))

    bad_scope = client.get("/api/workstation/queues", params={"scope": "bogus"})
    check("a bogus scope value is rejected (400)", bad_scope.status_code == 400, str(bad_scope.status_code))

    anon = TestClient(main.app)
    unauth = anon.get("/api/workstation/queues")
    check("GET /api/workstation/queues requires a real session (401 without one)", unauth.status_code == 401, str(unauth.status_code))

    # ── Sidebar ──
    sb = client.get("/api/workstation/sidebar")
    check("GET /api/workstation/sidebar succeeds", sb.status_code == 200, str(sb.status_code))
    sb_json = sb.json()
    cal_refs = [e["ref"] for e in sb_json.get("calendar", [])]
    check("calendar contains the real case due date", f"case:{case_mine_id}" in cal_refs, str(cal_refs))
    check("calendar contains the real RFI due date", f"rfi:{rfi_id}" in cal_refs, str(cal_refs))
    check("calendar contains the real scheduled scan (WatchZone.next_scan_at)", f"aoi:{zone_id}" in cal_refs, str(cal_refs))

# ── Cleanup ──
with get_db() as db:
    db.query(Alert).filter(Alert.alert_id == alert_id).delete(synchronize_session=False)
    db.query(WatchZone).filter(WatchZone.system_id == zone_id).delete(synchronize_session=False)
    db.query(RFI).filter(RFI.rfi_id == rfi_id).delete(synchronize_session=False)
    db.query(Case).filter(Case.case_id.in_([case_mine_id, case_review_id, case_unassigned_id])).delete(synchronize_session=False)
    db.query(User).filter(User.id.in_([user_a_id, user_b_id])).delete(synchronize_session=False)
    db.query(Team).filter(Team.id == team_id).delete(synchronize_session=False)
    db.commit()
    check("cleanup removed every real throwaway row", db.query(User).filter(User.id.in_([user_a_id, user_b_id])).count() == 0)

print("=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    sys.exit(1)
print(f"  RESULT: all checks passed")
sys.exit(0)
