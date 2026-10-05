"""
track_detail.py — the fields the live feeds already send and we dropped.

AIS: the ingest kept name, destination, type and callsign from
ShipStaticData and lat/lon/heading/speed from PositionReport. Each message
carries more: the IMO number, the hull's dimensions, its DRAUGHT (how deep
it sits — a tanker that leaves port deeper than it arrived has loaded),
the master's ETA, the navigational status (anchored, moored, not under
command), rate of turn, and course over ground separately from heading.

ADS-B: the poll kept nine fields of some fifty. Registration, squawk,
climb/descent and the altitude the autopilot is set to, airspeeds, the
aircraft's own GPS-integrity verdict, how the position was obtained, and
the database flags (military, privacy programme) were all discarded.

EVERY SENTINEL BECOMES ABSENT, NEVER A VALUE. AIS encodes "not available"
as numbers: heading 511, rate of turn -128, draught 0, ETA month 0,
dimensions 0, nav status 15. Passed through, a moored hull would report a
heading of 511° and an ETA of 0 Jan. Pure functions, so the rules are
tested rather than trusted.
"""
from __future__ import annotations

import datetime as _dt

NAV_STATUS = {
    0: "under way using engine", 1: "at anchor", 2: "not under command",
    3: "restricted manoeuvrability", 4: "constrained by draught", 5: "moored",
    6: "aground", 7: "engaged in fishing", 8: "under way sailing",
    14: "AIS-SART active",
}

SQUAWK_MEANING = {"7500": "unlawful interference", "7600": "radio failure", "7700": "emergency"}


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f


def eta_iso(eta: dict | None, now: _dt.datetime) -> str | None:
    """AIS ETA has month/day/hour/minute and no year: the occurrence
    NEAREST now. Month 0, day 0, hour 24 or minute 60 mean "not available".

    Not "the next occurrence": crews leave the ETA field untouched for
    months, and a moored ship still sending "10 May" is not arriving next
    May — it has an old value. The nearest reading keeps it in the past,
    where eta_stale() can say so.
    """
    if not isinstance(eta, dict):
        return None
    mo, d, h, mi = (int(eta.get(k) or 0) for k in ("Month", "Day", "Hour", "Minute"))
    if not (1 <= mo <= 12 and 1 <= d <= 31) or h > 23 or mi > 59:
        return None
    cands = []
    for year in (now.year - 1, now.year, now.year + 1):
        try:
            cands.append(_dt.datetime(year, mo, d, h, mi, tzinfo=_dt.timezone.utc))
        except ValueError:
            pass
    if not cands:
        return None
    t = min(cands, key=lambda c: abs((c - now).total_seconds()))
    return t.isoformat().replace("+00:00", "Z")


def eta_stale(eta: str | None, now: _dt.datetime) -> bool:
    """An ETA more than a week behind us is a field nobody updated."""
    if not eta:
        return False
    t = _dt.datetime.fromisoformat(eta.replace("Z", "+00:00"))
    return t < now - _dt.timedelta(days=7)


def ais_static(sd: dict, now: _dt.datetime) -> dict:
    """Extra fields from a ShipStaticData message, sentinels removed."""
    out: dict = {}
    imo = sd.get("ImoNumber")
    if isinstance(imo, int) and 1_000_000 <= imo <= 9_999_999:
        out["imo"] = str(imo)
    dim = sd.get("Dimension") or {}
    a, b, c, d = (int(dim.get(k) or 0) for k in ("A", "B", "C", "D"))
    if a + b > 0 and a and b:
        out["length"] = a + b
    if c + d > 0 and c and d:
        out["beam"] = c + d
    dr = _num(sd.get("MaximumStaticDraught"))
    if dr and 0 < dr < 25.5:
        out["draught"] = round(dr, 1)
    eta = eta_iso(sd.get("Eta"), now)
    if eta:
        out["eta"] = eta
        out["eta_stale"] = eta_stale(eta, now)
    return out


def ais_position(pr: dict) -> dict:
    """Extra fields from a PositionReport, sentinels removed."""
    out: dict = {}
    st = pr.get("NavigationalStatus")
    if isinstance(st, int) and st in NAV_STATUS:
        out["nav_status"] = NAV_STATUS[st]
    cog = _num(pr.get("Cog"))
    if cog is not None and 0 <= cog < 360:
        out["cog"] = round(cog, 1)
    hdg = _num(pr.get("TrueHeading"))
    if hdg is not None and 0 <= hdg < 360:
        out["true_heading"] = int(hdg)
    rot = _num(pr.get("RateOfTurn"))
    if rot is not None and -127 <= rot <= 127:
        out["rot"] = int(rot)
    if pr.get("PositionAccuracy") is not None:
        out["pos_accuracy"] = "high" if pr.get("PositionAccuracy") else "low"
    return out


def adsb_detail(ac: dict) -> dict:
    """Extra fields from one adsb.lol aircraft, renamed to say what they are."""
    out: dict = {}
    for src, dst in (("r", "registration"), ("desc", "type_description"), ("ownOp", "owner_operator"),
                     ("year", "year_built"), ("squawk", "squawk"), ("emergency", "emergency"),
                     ("baro_rate", "vertical_rate"), ("nav_altitude_mcp", "selected_altitude"),
                     ("ias", "ias"), ("tas", "tas"), ("mach", "mach"),
                     ("wd", "wind_dir"), ("ws", "wind_speed"), ("oat", "outside_temp"),
                     ("nic", "nic"), ("nac_p", "nac_p"), ("seen_pos", "seen_pos"),
                     ("alt_geom", "alt_geom")):
        v = ac.get(src)
        if v is not None and v != "" and v != "none":
            out[dst] = v.strip() if isinstance(v, str) else v
    if out.get("vertical_rate") is None and ac.get("geom_rate") is not None:
        out["vertical_rate"] = ac["geom_rate"]
    # How the position was obtained: MLAT and TIS-B list the fields they
    # supplied; a position among them is not the aircraft's own broadcast.
    if "lat" in (ac.get("mlat") or []):
        out["position_source"] = "multilateration"
    elif "lat" in (ac.get("tisb") or []):
        out["position_source"] = "TIS-B relay"
    elif ac.get("lat") is not None:
        out["position_source"] = "ADS-B"
    flags = int(ac.get("dbFlags") or 0)
    if flags & 4:
        out["privacy"] = "PIA (privacy ICAO address)"
    elif flags & 8:
        out["privacy"] = "LADD (blocked from public display)"
    sq = str(out.get("squawk") or "")
    if sq in SQUAWK_MEANING:
        out["squawk_meaning"] = SQUAWK_MEANING[sq]
    return out
