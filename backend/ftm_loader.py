"""
ftm_loader.py — ingest OpenSanctions as a GRAPH, not a vessel list.

The previous loader (sanctions_loader.py) parsed the same file and kept
`schema == "Vessel"`. In the first 60,000 entities of the maritime dataset
that is 300 rows out of 60,000 — 0.5% — and it discarded 9,702 Persons,
21,032 Sanctions, 1,071 Organizations and 765 links. The owner_chain and
topics columns it wrote were empty in all 334,468 rows, for two separate
reasons: topics were read from the wrong path (they live under `properties`,
and the code had already read them correctly four lines earlier), and
ownership is not a Vessel property at all — in FollowTheMoney it is its own
Ownership entity, which the schema filter dropped before it could be seen.

DATASETS. Maritime is the sanctions-evasion picture. The others are the
conflict picture: who the players are, who they answer to, and who owns what.
Both were asked for and they are the same graph.
"""
from __future__ import annotations

import json
import sqlite3
import time
import urllib.request

import ftm
import ftm_store

BASE = "https://data.opensanctions.org/datasets/latest"

DATASETS = {
    # id                  url slug          what it is for
    "maritime":           ("maritime", "vessels, owners and their listings"),
    "sanctions":          ("sanctions", "consolidated sanctions — the players"),
}

_UA = "HorizonWatch/2.0 (+https://github.com/ZaphodBeblerbox/Horizon-Watch)"


def _stream(url: str, timeout: int = 180):
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        for line in resp:
            line = line.strip()
            if line:
                yield line


def load_dataset(conn: sqlite3.Connection, slug: str, *, limit: int | None = None,
                 progress_every: int = 25_000) -> dict:
    """Load one OpenSanctions dataset in FtM form. Every entity is stored as a
    thing or an edge; anything that is neither is COUNTED, not dropped in
    silence, because a silent drop is what produced an empty graph."""
    url = f"{BASE}/{slug}/entities.ftm.json"
    stats = {"dataset": slug, "things": 0, "edges": 0, "skipped": 0,
             "unknown_schema": {}, "seconds": 0.0}
    t0 = time.time()
    n = 0
    for raw in _stream(url):
        try:
            entity = json.loads(raw)
        except Exception:
            stats["skipped"] += 1
            continue
        kind = ftm_store.upsert_entity(conn, entity)
        if kind == "thing":
            stats["things"] += 1
        elif kind == "edge":
            stats["edges"] += 1
        else:
            stats["skipped"] += 1
            sch = entity.get("schema") or "?"
            stats["unknown_schema"][sch] = stats["unknown_schema"].get(sch, 0) + 1
        n += 1
        if n % progress_every == 0:
            conn.commit()
            print(f"  [{slug}] {n:,} entities — {stats['things']:,} things, {stats['edges']:,} edges")
        if limit and n >= limit:
            break
    conn.commit()
    stats["seconds"] = round(time.time() - t0, 1)
    return stats


def load_all(db_path: str, *, slugs=None, limit=None) -> list[dict]:
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    ftm_store.ensure_schema(conn)
    out = []
    for key, (slug, _why) in DATASETS.items():
        if slugs and key not in slugs:
            continue
        out.append(load_dataset(conn, slug, limit=limit))
    conn.close()
    return out
