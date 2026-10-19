"""synth_telegram.py — synthetic Telegram posts (never real data) for timing
the street-report reader and for the load test.

Production on 2026-10-19 held ~4,500 posts in the street reader's 6-hour
window; street_reports.read took 2.6-3.5 s over them in a quiet process.
This makes a window of the same size: chat-like French text, a few percent
carrying the street cues the reader looks for, a share with photo/video.
"""
from __future__ import annotations

import datetime as dt
import random
import sqlite3

WORDS = ("le la les un une des et mais donc or ni car on est à au aux pour avec sans sur sous dans très bien "
         "gouvernement macron réforme retraite grève demain rendez-vous rassemblement place république bastille "
         "nation châtelet paris lyon marseille police crs flics gaz lacrymo manif cortège camarades solidarité "
         "vidéo photo regardez incroyable honte scandale merci partagez info direct live ça bouge").split()
CUES = ["ça gaze à Répu", "les CRS chargent bd Voltaire", "on est à Bastoche", "les flics arrivent à Nation",
        "nasse à Châtelet", "lacrymo place de la République", "barricades rue de Rivoli"]

COLUMNS = ("channel TEXT, msg_id INTEGER, channel_title TEXT, posted_at TEXT, text TEXT, media TEXT, thumb TEXT, "
           "summary_en TEXT, lat REAL, lon REAL, precision TEXT, place TEXT, country_code TEXT, role TEXT, "
           "reply_to INTEGER")


def make(con: sqlite3.Connection, n: int = 4500, hours: float = 6, seed: int = 1, start_id: int = 0) -> None:
    """Insert `n` posts spread over the last `hours` (creates the table if absent)."""
    rnd = random.Random(seed)
    con.execute(f"CREATE TABLE IF NOT EXISTS telegram_posts ({COLUMNS}, PRIMARY KEY (channel, msg_id))")
    now = dt.datetime.now(dt.timezone.utc)
    rows = []
    for i in range(start_id, start_id + n):
        at = now - dt.timedelta(seconds=rnd.random() * hours * 3600)
        txt = " ".join(rnd.choice(WORDS) for _ in range(rnd.randint(4, 60)))
        if rnd.random() < 0.03:
            txt = rnd.choice(CUES) + " " + txt[:40]
        media = rnd.choice(["none"] * 6 + ["photo", "video"])
        rows.append((f"synth{i % 40}", i, f"Synthetic chat {i % 40}", at.isoformat(), txt, media, None, None,
                     None, None, None, None, "fr", "group", None))
    con.executemany(f"INSERT OR REPLACE INTO telegram_posts (channel, msg_id, channel_title, posted_at, text, media, "
                    f"thumb, summary_en, lat, lon, precision, place, country_code, role, reply_to) "
                    f"VALUES ({','.join('?' * 15)})", rows)
    con.commit()
