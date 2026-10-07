"""
reset_user_data.py — every account back to a clean sheet; the system untouched.

The owner, 2026-10-07: "everyone starts from zero and must first build up
their interests … no layers, no pfp, no desk posts, no messages, just the
users and the system". Kept: the accounts themselves (email, name, password,
role, approval, team) and everything the system collects (alerts, fusions,
Telegram, GeoConfirmed, AIS/ADS-B history, news, the ontology's own data,
system forecasts). Removed: everything a person made or set.

  python reset_user_data.py            dry run — counts only, changes nothing
  python reset_user_data.py --apply    copies the database to
                                        akili.db.before-reset-<time> first,
                                        then clears

After it, each account's next login is a first login: no settings (so the
map opens with every layer off and the v1.1 welcome and the walkthrough show
once), no picture or header, no theaters, assets, imagery areas, posts,
messages, cases, reports or briefings.
"""
from __future__ import annotations

import datetime as _dt
import shutil
import sqlite3
import sys
from pathlib import Path

try:
    from paths import DATA_DIR
except Exception:                                            # noqa: BLE001
    DATA_DIR = Path(__file__).resolve().parent / "data"

DB = Path(DATA_DIR) / "akili.db"

# Tables whose every row was made by a person.
TABLES = [
    "theaters", "owned_assets", "owned_asset_briefs", "assets",
    "briefing_profiles", "briefing_runs",
    "posts", "post_acks", "comments",
    "chat_messages", "direct_messages", "conversation_members", "conversations",
    "desk_sessions", "desk_views", "desk_notes",
    "cases", "case_nodes", "case_shares", "rfis",
    "reports", "report_snapshots", "report_tasks",
    "forecast_proposals",
    "push_subscriptions",
    # imagery areas are personal, and so are the scans of them
    "sentinel_detections", "sentinel_scans", "watch_zones",
]
# Rows of a shared table that belong to the above.
EXTRA = [
    ("ontology_entities (imagery areas)", "DELETE FROM ontology_entities WHERE infra_type = 'SENTINEL_ZONE'",
     "SELECT COUNT(*) FROM ontology_entities WHERE infra_type = 'SENTINEL_ZONE'"),
]
# What a person set on their own account; the account itself stays.
USER_RESET = ("UPDATE users SET settings = NULL, avatar = NULL, cover = NULL, avatar_pos = NULL, cover_pos = NULL, "
              "bio = NULL, current_view = NULL, last_login = NULL")
# Files people made (under DATA_DIR).
FILES = ["documents", "chat_files", "case_files", "briefings", "annotations.json", "situations.json", "briefings.json"]


def _exists(con, t):
    return con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (t,)).fetchone() is not None


def plan(con) -> list[tuple[str, int]]:
    out = []
    for t in TABLES:
        if _exists(con, t):
            out.append((t, con.execute(f"SELECT COUNT(*) FROM '{t}'").fetchone()[0]))
    for label, _sql, count in EXTRA:
        try:
            out.append((label, con.execute(count).fetchone()[0]))
        except sqlite3.Error:
            pass
    out.append(("users: settings, picture, header, bio (accounts kept)", con.execute(
        "SELECT COUNT(*) FROM users WHERE settings IS NOT NULL OR avatar IS NOT NULL OR cover IS NOT NULL").fetchone()[0]))
    return out


def main(apply: bool) -> None:
    con = sqlite3.connect(DB, timeout=120)
    rows = plan(con)
    print(f"database: {DB}")
    for name, n in rows:
        print(f"  {name:55s} {n:8d}")
    files = [f for f in FILES if (Path(DATA_DIR) / f).exists()]
    print("  files:", ", ".join(files) or "none")
    print(f"  accounts kept: {con.execute('SELECT COUNT(*) FROM users').fetchone()[0]}")
    if not apply:
        print("\ndry run — nothing changed. Run with --apply to clear.")
        return
    con.close()
    stamp = _dt.datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    backup = DB.with_name(f"akili.db.before-reset-{stamp}")
    src = sqlite3.connect(DB, timeout=120)
    dst = sqlite3.connect(backup)
    src.backup(dst)                                         # consistent copy, WAL included
    dst.close()
    src.close()
    print(f"\nbackup: {backup}")
    con = sqlite3.connect(DB, timeout=120)
    con.execute("PRAGMA foreign_keys = OFF")
    for t in TABLES:
        if _exists(con, t):
            con.execute(f"DELETE FROM '{t}'")
    for _label, sql, _count in EXTRA:
        try:
            con.execute(sql)
        except sqlite3.Error as e:
            print(f"  skipped: {e}")
    con.execute(USER_RESET)
    con.commit()
    con.close()
    bin_ = Path(DATA_DIR) / f"reset-{stamp}"
    for f in files:
        bin_.mkdir(exist_ok=True)
        shutil.move(str(Path(DATA_DIR) / f), str(bin_ / f))   # moved aside, not destroyed
    print("cleared." + (f" Files moved to {bin_}." if files else ""))


if __name__ == "__main__":
    main("--apply" in sys.argv)
