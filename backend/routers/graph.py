"""
routers/graph.py — the entity graph, queryable.

Endpoints the console can ask real questions of: what is this vessel in the
sanctions graph, who owns it, what else do they own, and what is waiting for a
human to decide.
"""
from __future__ import annotations

import json
import sqlite3
import os

from fastapi import APIRouter, HTTPException, Query

router = APIRouter(tags=["graph"])


def _db():
    from paths import DB_PATH
    path = str(DB_PATH)
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _thing(row) -> dict:
    return {
        "id": row["id"], "schema": row["schema"], "caption": row["caption"],
        "country": row["country"], "imo": row["imo"], "mmsi": row["mmsi"],
        "topics": json.loads(row["topics_json"] or "[]"),
        "names": json.loads(row["names_json"] or "[]"),
        "datasets": json.loads(row["datasets_json"] or "[]"),
        "origin_class": row["origin_class"], "licence_tier": row["licence_tier"],
    }


@router.get("/api/graph/stats")
def graph_stats():
    with _db() as db:
        def n(sql):
            try:
                return db.execute(sql).fetchone()[0]
            except sqlite3.OperationalError:
                return 0
        things = [dict(r) for r in db.execute(
            "SELECT schema, COUNT(*) AS n FROM ftm_things GROUP BY 1 ORDER BY 2 DESC")]
        edges = [dict(r) for r in db.execute(
            "SELECT schema, COUNT(*) AS n FROM ftm_edges GROUP BY 1 ORDER BY 2 DESC")]
        return {
            "things": n("SELECT COUNT(*) FROM ftm_things"),
            "edges": n("SELECT COUNT(*) FROM ftm_edges"),
            "resolved": n("SELECT COUNT(*) FROM ftm_resolution WHERE decided_by IS NOT NULL"),
            "awaiting_review": n("SELECT COUNT(*) FROM ftm_resolution WHERE decided_by IS NULL"),
            "by_thing_schema": things, "by_edge_schema": edges,
        }


@router.get("/api/graph/vessel/{mmsi}")
def vessel_graph(mmsi: str):
    """Everything the graph knows about a vessel we track.

    Resolutions carry their method, score and evidence, and an unreviewed
    fuzzy candidate is returned separately from a decided link — the console
    must never present "probably this sanctioned tanker" as a finding.
    """
    with _db() as db:
        res = db.execute(
            "SELECT * FROM ftm_resolution WHERE local_kind='vessel' AND local_id=?"
            " ORDER BY score DESC", (str(mmsi),)).fetchall()
        if not res:
            return {"mmsi": mmsi, "resolved": [], "candidates": [], "owners": [], "fleet": []}

        out_res, out_cand = [], []
        for r in res:
            t = db.execute("SELECT * FROM ftm_things WHERE id=?", (r["ftm_id"],)).fetchone()
            item = {"entity": _thing(t) if t else None, "method": r["method"],
                    "score": r["score"], "evidence": r["evidence"],
                    "decided_by": r["decided_by"]}
            (out_res if r["decided_by"] else out_cand).append(item)

        owners, fleet = [], []
        for item in out_res:
            vid = (item["entity"] or {}).get("id")
            if not vid:
                continue
            for e in db.execute(
                "SELECT e.id, e.schema, e.start_date, e.end_date, o.id AS oid, o.caption, o.schema AS oschema"
                " FROM ftm_edges e JOIN ftm_things o ON o.id=e.source_id"
                " WHERE e.target_id=? AND e.schema='Ownership'", (vid,)):
                owners.append({"owner_id": e["oid"], "owner": e["caption"], "schema": e["oschema"],
                               "start_date": e["start_date"], "end_date": e["end_date"]})
        seen = set()
        for o in owners:
            if o["owner_id"] in seen:
                continue
            seen.add(o["owner_id"])
            others = db.execute(
                "SELECT t.id, t.caption, t.imo FROM ftm_edges e JOIN ftm_things t ON t.id=e.target_id"
                " WHERE e.source_id=? AND e.schema='Ownership' AND t.schema='Vessel' LIMIT 200",
                (o["owner_id"],)).fetchall()
            fleet.append({"owner": o["owner"], "owner_id": o["owner_id"],
                          "hulls": [dict(x) for x in others], "count": len(others)})
        return {"mmsi": mmsi, "resolved": out_res, "candidates": out_cand,
                "owners": owners, "fleet": fleet}


@router.get("/api/graph/review")
def review_queue(limit: int = Query(50, le=500)):
    """Fuzzy candidates awaiting a human decision.

    These exist because name alone cannot separate a misspelling from a
    different ship — "PERSERVERANCE"/"PERSEVERANCE" and "HANSA"/"HANA" are
    structurally identical. That is a real limit, not a tuning problem, so a
    person decides.
    """
    with _db() as db:
        rows = db.execute(
            "SELECT r.*, t.caption, t.topics_json FROM ftm_resolution r"
            " LEFT JOIN ftm_things t ON t.id=r.ftm_id"
            " WHERE r.decided_by IS NULL ORDER BY r.score DESC LIMIT ?", (limit,)).fetchall()
        return {"total": db.execute(
            "SELECT COUNT(*) FROM ftm_resolution WHERE decided_by IS NULL").fetchone()[0],
            "items": [{"local_id": r["local_id"], "ftm_id": r["ftm_id"], "caption": r["caption"],
                       "method": r["method"], "score": r["score"], "evidence": r["evidence"],
                       "topics": json.loads(r["topics_json"] or "[]")} for r in rows]}


# ── FIRMS: active fires as a scan trigger ────────────────────────────────
@router.get("/api/firms/status")
def firms_status():
    """Is the fire feed running, and what would it do?"""
    import firms
    return {
        "available": firms.available(),
        "reason": None if firms.available() else
                  "no FIRMS_MAP_KEY set — a free key comes from "
                  "https://firms.modaps.eosdis.nasa.gov/api/map_key/",
        "source": firms.DEFAULT_SOURCE,
        "sources": list(firms.SOURCES),
        "relevance_radius_km": firms.RELEVANCE_RADIUS_KM,
        "repeat_suppress_hours": firms.REPEAT_SUPPRESS_HOURS,
        "min_brightness_k": firms.MIN_BRIGHTNESS_K,
    }


@router.get("/api/firms/fires")
def firms_fires(west: float, south: float, east: float, north: float,
                days: int = Query(1, ge=1, le=10)):
    """Active fires in a bbox, with which ones would earn a satellite tasking.

    Returns every credible detection AND the subset that would trigger, so the
    filtering is inspectable rather than something the scheduler does silently.
    """
    import firms
    res = firms.fetch_area((west, south, east, north), days=days)
    if res.get("status") != "ok":
        return {**res, "credible": [], "would_trigger": []}
    credible = [f for f in res["fires"] if firms.is_credible(f)]
    centre = {"lat": (south + north) / 2, "lon": (west + east) / 2, "label": "bbox centre"}
    span = firms.haversine_km(south, west, north, east)
    return {
        "status": "ok", "source": res.get("source"),
        "total": len(res["fires"]), "credible": len(credible),
        "fires": credible[:500],
        "would_trigger": firms.triggers(res["fires"], [centre], [],
                                        radius_km=max(firms.RELEVANCE_RADIUS_KM, span))[:100],
    }
