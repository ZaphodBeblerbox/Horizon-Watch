"""
zone_change.py — what a radar change pass over a watch zone FOUND, and
whether a scan of a zone counts as a finding.

WHY (owner, 2026-10-11): "on all our automatically created detection
zones we detect nothing — and we should have some kind of indicator where
something was detected." The overwatch zones are front lines, power
plants, air bases and report clusters. At 10 m the optical detectors find
little there; what those places show is CHANGE between radar passes
(pwtt.py). This module turns one PWTT result into a verdict a person can
read and a notification can carry:

  changed       significant regions that the previous comparison of this
                zone did not have (new since the last look)
  no_change     compared, nothing significant, or only what was already
                reported last time
  inconclusive  the whole scene shifted (rain, harvest, another orbit)
  error         the pass could not be run, with the reason

Pure functions only — unit-tested in test_zone_change.py; main.py does
the I/O. Derived on read where it can be (`scan_finding`), so a later
fix to the rule applies to old scans too instead of being frozen into
stored flags.
"""
from __future__ import annotations

import datetime as _dt
import math

import finding_boxes as _fb

# A region counts when it is strong AND big enough to be a structure or a
# vehicle park rather than speckle: |t| ≥ 4 (the same line main.py uses to
# mark a region "medium") and at least half a hectare.
SITE_MIN_T = 4.0
SITE_MIN_AREA_M2 = 5_000.0
# More than this share of the zone changed = a whole-scene shift, not an event.
WIDESPREAD_FRACTION = 0.08
# A region within this of one reported by the previous comparison is the
# same change seen again, not a new one.
SAME_PLACE_M = 300.0
# A scan is "fresh" on the map and in the list for this long.
FRESH_HOURS = 72


def _km(a_lat, a_lon, b_lat, b_lon) -> float:
    dy = (a_lat - b_lat) * 110.574
    dx = (a_lon - b_lon) * 111.320 * math.cos(math.radians((a_lat + b_lat) / 2))
    return math.hypot(dx, dy)


def significant(regions: list[dict], m_per_px: float | None = None) -> list[dict]:
    """The regions worth telling someone about."""
    out = []
    px_area = float(m_per_px or 10.0) ** 2
    for r in regions or []:
        t = abs(float(r.get("t_peak") or 0))
        area = float(r.get("area_m2") or 0) or float(r.get("pixels") or 0) * px_area
        if t >= SITE_MIN_T and area >= SITE_MIN_AREA_M2:
            out.append({**r, "area_m2": area})
    return out


def new_regions(current: list[dict], previous: list[dict] | None) -> list[dict]:
    """Regions of `current` with no region of the same direction near them
    in `previous` (None = no previous comparison: everything is new)."""
    if previous is None:
        return list(current)
    out = []
    for r in current:
        seen = any(p.get("change_direction") == r.get("change_direction")
                   and _km(r["centroid_lat"], r["centroid_lon"], p["centroid_lat"], p["centroid_lon"]) * 1000 <= SAME_PLACE_M
                   for p in previous if p.get("centroid_lat") is not None)
        if not seen:
            out.append(r)
    return out


def _fmt_day(iso: str | None) -> str | None:
    if not iso:
        return None
    try:
        d = _dt.date.fromisoformat(str(iso)[:10])
    except ValueError:
        return None
    return f"{d.day} {d.strftime('%b')}"


def _ha(m2: float) -> str:
    ha = m2 / 10_000
    return f"{ha:.1f}" if ha < 10 else f"{ha:.0f}"


def summarize(out: dict, previous: list[dict] | None, previous_until: str | None = None) -> dict:
    """The "what changed" block stored in the change scan's result_summary.

    out            a pwtt job result (status, detections, dates_*, …)
    previous       significant regions of this zone's previous change scan,
                   or None when there is none
    previous_until the last "after" date that previous comparison used
    """
    out = out or {}
    if out.get("status") != "completed":
        return {"verdict": "error", "reason": str(out.get("error") or "no result")[:300], "new_regions": 0}
    frac = float(out.get("changed_fraction") or 0)
    if out.get("suspect_wholesale_shift") or frac > WIDESPREAD_FRACTION:
        return {"verdict": "inconclusive", "new_regions": 0, "changed_fraction": frac,
                "reason": f"{frac * 100:.1f}% of the area changed — a whole-scene shift (rain, harvest, "
                          "another orbit), not an event"}
    sig = significant(out.get("detections") or [], out.get("m_per_px"))
    fresh = new_regions(sig, previous)
    brighter = sum(r["area_m2"] for r in fresh if r.get("change_direction") == "appeared")
    darker = sum(r["area_m2"] for r in fresh if r.get("change_direction") == "removed")
    before = list(out.get("dates_before") or [])
    since = previous_until or (before[0] if before else None)
    after = list(out.get("dates_after") or [])
    block = {
        "verdict": "changed" if fresh else "no_change",
        "first_comparison": previous is None,
        "regions": len(out.get("detections") or []),
        "significant_regions": len(sig),
        "new_regions": len(fresh),
        "brighter_m2": round(brighter), "darker_m2": round(darker),
        "since": since, "until": after[0] if after else None,
        "strongest_t": round(max((abs(float(r.get("t_peak") or 0)) for r in fresh), default=0.0), 2),
        # Each with its real extent on the ground (finding_boxes.py): the
        # region's pixel box put on the scene's bounds, so the notification
        # can draw what changed instead of a dot (owner, 2026-10-12).
        "where": [{"lat": r["centroid_lat"], "lon": r["centroid_lon"], "direction": r.get("change_direction"),
                   "area_m2": round(r["area_m2"]), "t_peak": r.get("t_peak"),
                   "box": _fb.region_box(r, out.get("bounds"))[0]} for r in
                  # Every new region, largest first — it was the largest 5;
                  # no cap (owner, 2026-10-17: "no cap on how many things we can actually recognise on the map")
                  sorted(fresh, key=lambda r: -r["area_m2"])],
        "changed_fraction": frac,
    }
    block["headline"] = headline(block)
    return block


def headline(block: dict) -> str:
    """"radar, 12 ha brighter since 2 Oct" — the part after the place."""
    v = block.get("verdict")
    if v == "error":
        return f"radar change could not be run — {block.get('reason') or 'no result'}"
    if v == "inconclusive":
        return "radar compared — whole-scene shift, inconclusive"
    if v != "changed":
        since = _fmt_day(block.get("since"))
        return f"radar compared — nothing new{' since ' + since if since else ''}"
    parts = []
    if block.get("brighter_m2"):
        parts.append(f"{_ha(block['brighter_m2'])} ha brighter")
    if block.get("darker_m2"):
        parts.append(f"{_ha(block['darker_m2'])} ha darker")
    since = _fmt_day(block.get("since"))
    return f"radar, {' and '.join(parts) or 'new change'}{' since ' + since if since else ''}"


def alert_title(place: str, block: dict) -> str:
    """"Change detected at Vuglegirska power station — radar, 12 ha brighter since 2 Oct"."""
    return f"Change detected at {place} — {headline(block)}"


def scan_finding(summary: dict | None, triggered_by: str | None = None) -> dict | None:
    """Did this scan find something? Derived on read from what the scan stored.

    Returns {kind, count, text} or None. Radar change: a "changed" verdict.
    An object scan: objects NEW since the previous pass of the same sensor
    (what_changed.new), or — on a first pass with no baseline — any object.
    """
    if not isinstance(summary, dict):
        return None
    ch = summary.get("change")
    if isinstance(ch, dict) and (triggered_by == "change-detect" or summary.get("method") == "PWTT"):
        if ch.get("verdict") == "changed":
            return {"kind": "radar_change", "count": int(ch.get("new_regions") or 0), "text": ch.get("headline") or headline(ch)}
        return None
    wc = summary.get("what_changed")
    if not isinstance(wc, dict):
        # Stored before scans recorded what changed: the count alone cannot
        # say whether anything is new (a port shows 27 ships every pass).
        return None
    if wc.get("baseline"):
        total = int(summary.get("total_detections") or 0)
        return {"kind": "objects", "count": total, "text": f"first pass: {total} object(s) detected"} if total else None
    n = int(sum((wc.get("new_by_type") or {}).values()))
    if n <= 0:
        return None
    kinds = ", ".join(f"{v} {k.replace('_', ' ')}" for k, v in
                      sorted((wc.get("new_by_type") or {}).items(), key=lambda kv: -kv[1])[:3])
    return {"kind": "new_objects", "count": n, "text": f"new since the last pass: {kinds}"}


def zone_findings(scans: list[dict], now: _dt.datetime | None = None) -> dict:
    """Roll one zone's recent scans into the badge the list and map draw.

    scans: dicts with created_at (datetime), status, triggered_by,
    result_summary (dict), newest first or in any order.
    """
    now = now or _dt.datetime.utcnow()
    done = sorted([s for s in scans if s.get("status") == "completed" and s.get("created_at")],
                  key=lambda s: s["created_at"], reverse=True)
    week = [s for s in done if now - s["created_at"] <= _dt.timedelta(days=7)]
    last = done[0] if done else None
    # Objects are counted from object scans only: a radar change run's
    # "detections" are change regions (raw, most of them weak), reported
    # through its verdict instead of inflating the object count.
    objs = [s for s in done if s.get("triggered_by") != "change-detect"]
    last_obj = objs[0] if objs else None
    last_det = int((last_obj.get("result_summary") or {}).get("total_detections") or 0) if last_obj else 0
    det_7d = sum(int((s.get("result_summary") or {}).get("total_detections") or 0) for s in week
                 if s.get("triggered_by") != "change-detect")
    fresh = None
    for s in done:
        if now - s["created_at"] > _dt.timedelta(hours=FRESH_HOURS):
            break
        f = scan_finding(s.get("result_summary"), s.get("triggered_by"))
        if f:
            fresh = {**f, "scan_id": s.get("scan_id"), "at": s["created_at"].isoformat(timespec="seconds")}
            break
    findings_7d = sum(1 for s in week if scan_finding(s.get("result_summary"), s.get("triggered_by")))
    radar = next((s for s in done if s.get("triggered_by") == "change-detect"), None)
    rc = ((radar or {}).get("result_summary") or {}).get("change") if radar else None
    return {
        "last_scan_at": last["created_at"].isoformat(timespec="seconds") if last else None,
        "last_detections": last_det,
        "detections_7d": det_7d,
        "findings_7d": findings_7d,
        "fresh": fresh,
        "radar_change": ({"verdict": rc.get("verdict"), "headline": rc.get("headline"),
                          "at": radar["created_at"].isoformat(timespec="seconds")} if isinstance(rc, dict) else None),
    }
