"""loadtest_seed.py — prepare an EMPTY data directory for tools/loadtest.py.

Synthetic only (never a copy of real data):
  · load-test users loadtest1..N@test.local / password "loadtest-pw",
    approved, with an avatar and (for the first) a cover of production's
    sizes (2026-10-19: avatars up to 63 KB, one cover of 370 KB, as data
    URLs on the user row);
  · ~4,500 Telegram posts in the last 6 hours (tools/synth_telegram.py),
    the size of production's street-report window that day.

Run from backend/ with DATA_DIR pointing at a scratch directory, before
starting the server on it:
    DATA_DIR=/tmp/lt python tools/loadtest_seed.py --users 6
Refuses to touch a directory whose akili.db already holds non-load-test users.
"""
from __future__ import annotations

import argparse
import base64
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

PASSWORD = "loadtest-pw"


def email(i: int) -> str:
    return f"loadtest{i}@test.local"


def _data_url(n_bytes: int, seed: int) -> str:
    raw = bytes((seed * 31 + i * 7) % 256 for i in range(n_bytes * 3 // 4))
    return "data:image/jpeg;base64," + base64.b64encode(raw).decode()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--users", type=int, default=6)
    ap.add_argument("--posts", type=int, default=4500)
    args = ap.parse_args()
    if not os.getenv("DATA_DIR"):
        raise SystemExit("set DATA_DIR to a scratch directory (never the real data)")
    db_file = os.path.join(os.environ["DATA_DIR"], "akili.db")
    if os.path.exists(db_file):
        con = sqlite3.connect(db_file)
        try:
            seen = con.execute("SELECT COUNT(*) FROM users WHERE last_login IS NOT NULL"
                               " AND email NOT LIKE '%@test.local'").fetchone()[0]
        except sqlite3.OperationalError:
            seen = 0
        con.close()
        if seen:
            raise SystemExit(f"{seen} users here have signed in: a real database, refusing to seed it")
    from database import User, get_db, init_db
    from passlib.context import CryptContext
    init_db()
    pwd = CryptContext(schemes=["bcrypt"])
    with get_db() as db:
        h = pwd.hash(PASSWORD)
        for i in range(1, args.users + 1):
            if db.query(User).filter(User.email == email(i)).first():
                continue
            db.add(User(email=email(i), password_hash=h, name=f"Load Test {i}", role="analyst", approved=True,
                        avatar=_data_url(60_000 if i % 2 else 20_000, i),
                        cover=_data_url(370_000, i) if i == 1 else None,
                        settings={"startupLayers": {"clean": True}}))
        db.commit()
    import telegram_ingest as tg
    import synth_telegram
    con = tg._con()                      # creates the Telegram tables
    n = con.execute("SELECT COUNT(*) FROM telegram_posts").fetchone()[0]
    if n < args.posts:
        synth_telegram.make(con, n=args.posts)
    con.close()
    print(f"seeded {args.users} users ({email(1)} … / {PASSWORD}) and {max(n, args.posts)} synthetic posts "
          f"in {os.environ['DATA_DIR']}")


if __name__ == "__main__":
    main()
