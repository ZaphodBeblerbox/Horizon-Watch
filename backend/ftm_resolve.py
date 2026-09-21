"""
ftm_resolve.py — which of our vessels is which entity in the graph.

This is the step that turns a lookup table into a graph. Before it, an AIS
contact is an MMSI and a sanctions listing is a name, and nothing joins them:
of 334,468 rows in the old sanctions table only 1,947 carried an MMSI at all,
so MMSI-only matching was always going to miss almost everything.

EVERY LINK CARRIES ITS EVIDENCE. A resolution with no stated basis is an
accusation with no argument, and in this domain the consequence of a wrong
link is naming the wrong ship in a client deliverable. So each row records
the method, a score, and the actual strings compared — and a fuzzy match is
never silently promoted to the same standing as an IMO match.

METHOD STRENGTH, strongest first:

  imo         A hull's IMO number is assigned for the life of the hull and
              survives renaming and reflagging — which is exactly what
              shadow-fleet vessels do to break the link to their listing.
  mmsi        Reassigned when a vessel changes flag, and routinely spoofed.
              Good evidence, not proof.
  name_exact  Strong for unusual names, weak for "OCEAN STAR". Scored by how
              distinctive the name is across the corpus, not by length.
  name_fuzzy  A candidate for review, never an automatic assertion.
"""
from __future__ import annotations

import json
import sqlite3
import time
import re

from rapidfuzz import fuzz, process

import ftm

# Above this a fuzzy name match is worth showing a human. Below it, noise.
FUZZY_FLOOR = 88.0
# A fuzzy match is NEVER auto-accepted, whatever the score — see accept().
AUTO_ACCEPT = {"imo", "mmsi", "name_exact"}

_NOISE = re.compile(r"\b(M/?V|M/?T|MS|MV|SS|THE)\b|[^A-Z0-9 ]", re.I)


def norm_name(value) -> str:
    """Vessel names arrive with prefixes, punctuation and spacing noise."""
    if not value:
        return ""
    s = _NOISE.sub(" ", str(value).upper())
    return re.sub(r"\s+", " ", s).strip()


def name_distinctiveness(name: str, counts: dict) -> float:
    """How much a name match is worth.

    "LADY R" appearing once in the corpus is strong evidence; "OCEAN STAR"
    appearing forty times is nearly none. Scoring by frequency rather than by
    string length is the difference between a match that means something and
    one that merely looks specific.
    """
    n = counts.get(name, 1)
    if n <= 1:
        return 1.0
    if n <= 3:
        return 0.8
    if n <= 10:
        return 0.55
    return 0.3


def same_shape(a: str, b: str) -> bool:
    """Is this a SPELLING variant, or a different ship?

    Fleet operators name vessels in series — VB VICTORY, VB EMERALD, CEDAR 4
    — so a missing or extra token is the NORM in this corpus, not noise. A
    plain similarity score treats that as a near-match and produces exactly
    the wrong answer:

        "VB VICTORY"     ~ "VICTORY"        95%   different ships
        "CEDAR"          ~ "CEDAR 4"        95%   different ships
        "NSL CHALLENGER" ~ "NS CHALLENGER"  96%   different ships
        "PERSERVERANCE"  ~ "PERSEVERANCE"   96%   the SAME ship, misspelt

    Only the last is a resolution. So a fuzzy match must keep the same number
    of tokens, and differ within tokens rather than by whole ones — which is
    what separates a typo from a sister ship.
    """
    ta, tb = a.split(), b.split()
    if len(ta) != len(tb):
        return False
    # Every token must be recognisably the same token, not merely the whole
    # string being similar on average.
    return all(fuzz.ratio(x, y) >= 80 for x, y in zip(ta, tb))


def build_index(conn: sqlite3.Connection) -> dict:
    """Every name each FtM vessel is known by, including previous names."""
    by_imo, by_mmsi, by_name = {}, {}, {}
    counts: dict[str, int] = {}
    rows = conn.execute(
        "SELECT id, caption, names_json, imo, mmsi FROM ftm_things WHERE schema='Vessel'"
    ).fetchall()
    for fid, caption, names_json, imo, mmsi in rows:
        if imo:
            by_imo.setdefault(imo, fid)
        if mmsi:
            by_mmsi.setdefault(mmsi, fid)
        try:
            names = json.loads(names_json or "[]")
        except Exception:
            names = []
        if caption:
            names = names or [caption]
        for nm in names:
            k = norm_name(nm)
            if not k:
                continue
            by_name.setdefault(k, set()).add(fid)
            counts[k] = counts.get(k, 0) + 1
    return {"imo": by_imo, "mmsi": by_mmsi, "name": by_name,
            "counts": counts, "keys": list(by_name.keys())}


def resolve_vessel(mmsi: str | None, name: str | None, imo: str | None, index: dict) -> list[dict]:
    """Candidate resolutions for one of our vessels, best first."""
    out = []
    nimo = ftm.normalise_imo(imo)
    if nimo and nimo in index["imo"]:
        out.append({"ftm_id": index["imo"][nimo], "method": "imo", "score": 1.0,
                    "evidence": f"IMO {nimo}"})
    nmmsi = ftm.normalise_mmsi(mmsi)
    if nmmsi and nmmsi in index["mmsi"]:
        fid = index["mmsi"][nmmsi]
        if not any(o["ftm_id"] == fid for o in out):
            out.append({"ftm_id": fid, "method": "mmsi", "score": 0.9,
                        "evidence": f"MMSI {nmmsi}"})
    key = norm_name(name)
    if key:
        for fid in index["name"].get(key, ()):
            if any(o["ftm_id"] == fid for o in out):
                continue
            out.append({"ftm_id": fid, "method": "name_exact",
                        "score": round(0.55 + 0.35 * name_distinctiveness(key, index["counts"]), 3),
                        "evidence": f'name "{key}"'})
        if not out and len(key) >= 5:
            for matched, score, _ in process.extract(key, index["keys"], scorer=fuzz.WRatio,
                                                     score_cutoff=FUZZY_FLOOR, limit=5):
                if not same_shape(key, matched):
                    continue
                for fid in index["name"].get(matched, ()):
                    out.append({"ftm_id": fid, "method": "name_fuzzy",
                                "score": round(score / 100.0 * name_distinctiveness(matched, index["counts"]), 3),
                                "evidence": f'"{key}" ~ "{matched}" ({score:.0f}%)'})
                break
    return out


def accept(candidate: dict) -> bool:
    """A fuzzy name match is a CANDIDATE FOR REVIEW, never an assertion. It is
    stored — losing it would waste the work — but it is not decided by the
    system, because "probably the sanctioned tanker" is not a finding."""
    return candidate["method"] in AUTO_ACCEPT


def resolve_all(db_path: str, *, limit: int | None = None) -> dict:
    conn = sqlite3.connect(db_path)
    index = build_index(conn)
    # EVERY VESSEL WE HAVE SEEN, NAMED OR NOT.
    #
    # This used to require a name, which threw away 22,029 of 30,231
    # distinct vessels — and an MMSI match does not need a name at all.
    # Measured against the live store: 28 vessels we have tracked carry
    # an MMSI belonging to a sanctioned vessel, and only 7 were linked,
    # because the other 21 had never reported a name to us. The cheapest
    # and most certain link in the product was gated behind the one field
    # AIS most often omits.
    #
    # The name is still selected, because it is what the exact and fuzzy
    # name methods work on; it is simply no longer a precondition.
    sql = ("SELECT mmsi, name FROM ("
           " SELECT mmsi, MAX(name) AS name, MAX(timestamp) FROM vessel_history"
           " GROUP BY mmsi)")
    if limit:
        sql += f" LIMIT {int(limit)}"
    stats = {"examined": 0, "linked": 0, "for_review": 0,
             "by_method": {}, "seconds": 0.0}
    t0 = time.time()
    now = time.time()
    for mmsi, name in conn.execute(sql).fetchall():
        stats["examined"] += 1
        for cand in resolve_vessel(mmsi, name, None, index):
            decided = "system" if accept(cand) else None
            conn.execute(
                "INSERT OR IGNORE INTO ftm_resolution"
                " (local_kind, local_id, ftm_id, method, score, evidence, decided_by, decided_at)"
                " VALUES ('vessel',?,?,?,?,?,?,?)",
                (str(mmsi), cand["ftm_id"], cand["method"], cand["score"],
                 cand["evidence"], decided, now if decided else None),
            )
            stats["by_method"][cand["method"]] = stats["by_method"].get(cand["method"], 0) + 1
            if decided:
                stats["linked"] += 1
            else:
                stats["for_review"] += 1
    conn.commit()
    stats["seconds"] = round(time.time() - t0, 1)
    conn.close()
    return stats


# ── reading the resolutions back ──────────────────────────────────────
#
# THE BRIDGE WAS DEAD AT BOTH ENDS. resolve_all() was never called by
# anything, and ftm_resolution was never read by anything either, so the
# join between what we track and who is sanctioned existed only as
# schema. These are the read side.


def _thing(conn: sqlite3.Connection, ftm_id: str) -> dict | None:
    row = conn.execute(
        "SELECT id, schema, caption, country, imo, mmsi, topics_json, datasets_json"
        " FROM ftm_things WHERE id = ?", (ftm_id,)).fetchone()
    if not row:
        return None
    import json as _json

    def arr(v):
        try:
            return _json.loads(v) if v else []
        except Exception:                                   # noqa: BLE001
            return []

    return {"ftm_id": row[0], "schema": row[1], "name": row[2], "country": row[3],
            "imo": row[4], "mmsi": row[5],
            "topics": arr(row[6]), "datasets": arr(row[7])}


def links_for(db_path: str, local_kind: str, local_id: str) -> list[dict]:
    """Every sanctions entity one of our records has been matched to.

    Fuzzy matches come back too, flagged `decided: false`, because a
    candidate awaiting review is information — it is just not a finding,
    and the caller must be able to tell the difference.
    """
    conn = sqlite3.connect(db_path)
    try:
        rows = conn.execute(
            "SELECT ftm_id, method, score, evidence, decided_by FROM ftm_resolution"
            " WHERE local_kind = ? AND local_id = ? ORDER BY score DESC",
            (local_kind, str(local_id))).fetchall()
        out = []
        for ftm_id, method, score, evidence, decided_by in rows:
            thing = _thing(conn, ftm_id)
            if not thing:
                continue
            out.append({**thing, "method": method, "score": score,
                        "evidence": evidence,
                        "decided": decided_by is not None,
                        "decided_by": decided_by})
        return out
    finally:
        conn.close()


def resolution_summary(db_path: str) -> dict:
    """How much of the bridge is actually built, by method."""
    conn = sqlite3.connect(db_path)
    try:
        by_method = dict(conn.execute(
            "SELECT method, COUNT(*) FROM ftm_resolution GROUP BY method").fetchall())
        decided = conn.execute(
            "SELECT COUNT(*) FROM ftm_resolution WHERE decided_by IS NOT NULL").fetchone()[0]
        pending = conn.execute(
            "SELECT COUNT(*) FROM ftm_resolution WHERE decided_by IS NULL").fetchone()[0]
        locals_ = conn.execute(
            "SELECT COUNT(DISTINCT local_id) FROM ftm_resolution").fetchone()[0]
        return {"by_method": by_method, "decided": decided,
                "awaiting_review": pending, "distinct_local_records": locals_,
                # Named so nobody reads a fuzzy candidate as a finding.
                "note": "decided links used exact identifiers or an exact name; "
                        "the rest are candidates for review, not findings."}
    finally:
        conn.close()
