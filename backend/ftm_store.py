"""
ftm_store.py — the FollowTheMoney graph, stored.

Two tables, mirroring the model's own distinction (see ftm.py):

  ftm_things   Person, Organization, Vessel, Address …
  ftm_edges    Ownership, Directorship, Sanction, UnknownLink …

The edge table carries validity dates and provenance per row, because an
edge's lifetime is part of the fact. "A owned B" with no dates is a claim
about the present that may be years stale, and in this domain that is the
difference between a current beneficial owner and a divested one.

PROVENANCE, on the two axes used everywhere else in this system.
OpenSanctions is origin_class B — an authoritative registry, aggregated and
republished — at licence tier T1. It is NOT class A: we did not observe any
of it, we are reading someone else's compilation of official listings, and
the distinction matters when a claim built on it goes into a deliverable.
"""
from __future__ import annotations

import json
import sqlite3
import time

import ftm

SCHEMA = """
CREATE TABLE IF NOT EXISTS ftm_things (
    id            TEXT PRIMARY KEY,
    schema        TEXT NOT NULL,
    caption       TEXT,
    names_json    TEXT,          -- every name, alias and previous name
    country       TEXT,
    imo           TEXT,          -- normalised, vessels only
    mmsi          TEXT,          -- normalised, vessels only
    topics_json   TEXT,          -- sanction / role.pep / crime.* …
    datasets_json TEXT,
    props_json    TEXT NOT NULL,
    first_seen    TEXT,
    last_seen     TEXT,
    origin_class  TEXT DEFAULT 'B',
    licence_tier  TEXT DEFAULT 'T1',
    loaded_at     REAL
);
CREATE INDEX IF NOT EXISTS ix_ftm_things_schema  ON ftm_things(schema);
CREATE INDEX IF NOT EXISTS ix_ftm_things_imo     ON ftm_things(imo);
CREATE INDEX IF NOT EXISTS ix_ftm_things_mmsi    ON ftm_things(mmsi);
CREATE INDEX IF NOT EXISTS ix_ftm_things_caption ON ftm_things(caption);

CREATE TABLE IF NOT EXISTS ftm_edges (
    id            TEXT PRIMARY KEY,
    schema        TEXT NOT NULL,
    source_id     TEXT NOT NULL,
    target_id     TEXT NOT NULL,
    start_date    TEXT,
    end_date      TEXT,
    props_json    TEXT NOT NULL,
    datasets_json TEXT,
    origin_class  TEXT DEFAULT 'B',
    licence_tier  TEXT DEFAULT 'T1',
    loaded_at     REAL
);
CREATE INDEX IF NOT EXISTS ix_ftm_edges_source ON ftm_edges(source_id);
CREATE INDEX IF NOT EXISTS ix_ftm_edges_target ON ftm_edges(target_id);
CREATE INDEX IF NOT EXISTS ix_ftm_edges_schema ON ftm_edges(schema);

-- Resolution: which of OUR records is which FtM thing, and on what evidence.
-- A link with no stated basis is an accusation with no argument, and in this
-- domain that means naming the wrong ship in a client deliverable.
CREATE TABLE IF NOT EXISTS ftm_resolution (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    local_kind  TEXT NOT NULL,     -- 'vessel' | 'aircraft' | 'article' …
    local_id    TEXT NOT NULL,     -- MMSI, ICAO24, article id …
    ftm_id      TEXT NOT NULL,
    method      TEXT NOT NULL,     -- imo | mmsi | name_exact | name_fuzzy | manual
    score       REAL,              -- 0..1
    evidence    TEXT,              -- the actual strings compared
    decided_by  TEXT,              -- 'system' | a user id
    decided_at  REAL,
    UNIQUE(local_kind, local_id, ftm_id)
);
CREATE INDEX IF NOT EXISTS ix_ftm_res_local ON ftm_resolution(local_kind, local_id);
CREATE INDEX IF NOT EXISTS ix_ftm_res_ftm   ON ftm_resolution(ftm_id);
"""


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


def upsert_entity(conn: sqlite3.Connection, entity: dict, *,
                  origin_class: str = "B", licence_tier: str = "T1") -> str | None:
    """Store one FtM entity as a thing or an edge. Returns what it was stored
    as, or None if the entity is neither (unknown schema), which is recorded
    by the caller rather than silently dropped — that silent drop is what
    emptied the graph in the first place."""
    eid = entity.get("id")
    schema = entity.get("schema")
    if not eid or not schema:
        return None
    props = entity.get("properties") or {}
    now = time.time()
    datasets = json.dumps(entity.get("datasets") or [])

    if ftm.is_edge(schema):
        src, tgt = ftm.edge_endpoints(schema, props)
        if not src or not tgt:
            return None
        conn.execute(
            "INSERT INTO ftm_edges (id, schema, source_id, target_id, start_date, end_date,"
            " props_json, datasets_json, origin_class, licence_tier, loaded_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?)"
            " ON CONFLICT(id) DO UPDATE SET props_json=excluded.props_json,"
            " start_date=excluded.start_date, end_date=excluded.end_date, loaded_at=excluded.loaded_at",
            (eid, schema, src, tgt,
             ftm.first(props, "startDate") or ftm.first(props, "date"),
             ftm.first(props, "endDate"),
             json.dumps(props), datasets, origin_class, licence_tier, now),
        )
        return "edge"

    if ftm.is_thing(schema):
        names = ftm.names(props)
        imo = mmsi = None
        if schema == "Vessel":
            imo = ftm.normalise_imo(ftm.first(props, "imoNumber") or ftm.first(props, "imo"))
            mmsi = ftm.normalise_mmsi(ftm.first(props, "mmsi"))
        conn.execute(
            "INSERT INTO ftm_things (id, schema, caption, names_json, country, imo, mmsi,"
            " topics_json, datasets_json, props_json, first_seen, last_seen,"
            " origin_class, licence_tier, loaded_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
            " ON CONFLICT(id) DO UPDATE SET caption=excluded.caption, names_json=excluded.names_json,"
            " props_json=excluded.props_json, topics_json=excluded.topics_json,"
            " imo=excluded.imo, mmsi=excluded.mmsi, last_seen=excluded.last_seen,"
            " loaded_at=excluded.loaded_at",
            (eid, schema, entity.get("caption") or (names[0] if names else None),
             json.dumps(names),
             ftm.first(props, "country") or ftm.first(props, "jurisdiction"),
             imo, mmsi,
             json.dumps(props.get("topics") or []),
             datasets, json.dumps(props),
             ftm.first(props, "createdAt"), ftm.first(props, "modifiedAt"),
             origin_class, licence_tier, now),
        )
        return "thing"
    return None


def counts(conn: sqlite3.Connection) -> dict:
    def one(sql):
        try:
            return conn.execute(sql).fetchone()[0]
        except sqlite3.OperationalError:
            return 0
    return {
        "things": one("SELECT COUNT(*) FROM ftm_things"),
        "edges": one("SELECT COUNT(*) FROM ftm_edges"),
        "resolutions": one("SELECT COUNT(*) FROM ftm_resolution"),
    }
