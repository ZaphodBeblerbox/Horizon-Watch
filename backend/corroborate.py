"""
corroborate.py — four weak sources agreeing on a place and a time.

WHY THIS IS THE CENTRE OF THE SYSTEM. Every feed here is individually
inadequate, and the inadequacies are different:

  FIRMS        precise, global, near-real-time — but only ever says "hot"
  GeoConfirmed exact and human-verified — but 2,652 of 3,000 recent events
               are Ukraine; Yemen gets 0.4 a day
  GDELT        global and 15-minute — but geocoded to a place NAMED IN THE
               ARTICLE, and only kinetic city-level events can be trusted
  SAR change   sees through cloud and darkness — but cannot say what changed
  Imagery      says what a thing is — but only when the sky is clear
  AIS          exact vessel identity — until the transponder goes off

None of them is an answer. Two of them agreeing on a coordinate within a
few hours is a much better one, and that is obtainable today, for free,
from feeds this system already runs and which currently never speak to each
other.

WHAT AGREEMENT IS WORTH. Not all pairs are equal, and pretending otherwise
would be the whole failure mode. Two sources derived from the SAME
observation are one witness counted twice: GDELT and a news-derived event
reporting the same wire story agree by construction. Independence is what
carries weight, so it is scored explicitly rather than assumed — a thermal
satellite and a human watching a video are genuinely independent; two
machine readings of one article are not.

WHAT THIS REFUSES TO DO. It does not decide what happened. It says that
several sources place something at one point in space and time, names them,
and leaves the interpretation to a person. A cluster is a reason to look,
not a finding.
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timedelta, timezone

# How close in space two observations must be to be talking about the same
# thing. FIRMS pixels are 375m and GDELT is city-level at best, so this is
# set by the coarsest member rather than the finest.
DEFAULT_RADIUS_KM = 5.0

# And how close in time. A fire, a strike report and a radar change do not
# arrive together: the satellite passes when it passes, and reporting lags.
DEFAULT_WINDOW_HOURS = 36.0

# Sources that observe the world directly, and what they observe WITH.
# Two sources sharing a modality are not independent witnesses.
SOURCE_MODALITY = {
    "firms": "thermal_satellite",
    "viirs": "thermal_satellite",
    "sar_change": "radar_satellite",
    "sar_vessel": "radar_satellite",
    "imagery": "optical_satellite",
    "sentinel2_optical": "optical_satellite",
    "geoconfirmed": "human_verified_media",
    "gdelt": "news_text",
    "news": "news_text",
    "ucdp": "human_coded_report",
    "ais": "transponder",
    "adsb": "transponder",
}

# How much a source's word is worth on its own, before corroboration.
# Not a probability — a weight, and it is stated so nobody reads it as one.
SOURCE_WEIGHT = {
    "geoconfirmed": 1.0,      # a human found the building in the video
    "ucdp": 0.9,              # human-coded, but months late
    "firms": 0.8,             # an instrument, precise, but only "hot"
    "viirs": 0.8,
    "sar_change": 0.7,        # an instrument, but cannot say what
    "sar_vessel": 0.8,
    "imagery": 0.7,           # a model on a real picture
    "ais": 0.8,
    "adsb": 0.8,
    "gdelt": 0.4,             # a machine that read a wire story
    "news": 0.4,
}


def haversine_km(lat1, lon1, lat2, lon2) -> float:
    R = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _parse_ts(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    s = str(value).strip()
    if not s:
        return None
    try:
        if len(s) == 8 and s.isdigit():                 # GDELT YYYYMMDD
            return datetime(int(s[:4]), int(s[4:6]), int(s[6:8]), tzinfo=timezone.utc)
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def normalise(obs: dict) -> dict | None:
    """One shape for every feed. Returns None if it cannot be placed in
    space and time, because an observation without both cannot corroborate
    anything."""
    lat = obs.get("lat", obs.get("centroid_lat", obs.get("latitude")))
    lon = obs.get("lon", obs.get("centroid_lon", obs.get("longitude")))
    if lat is None or lon is None:
        return None
    ts = _parse_ts(obs.get("ts") or obs.get("date") or obs.get("timestamp")
                   or obs.get("event_date") or obs.get("acq_date"))
    if ts is None:
        return None
    src = (obs.get("source") or obs.get("provenance") or "unknown").lower()
    return {
        "source": src,
        "modality": SOURCE_MODALITY.get(src, src),
        "weight": SOURCE_WEIGHT.get(src, 0.5),
        "lat": float(lat), "lon": float(lon), "ts": ts,
        "label": obs.get("label") or obs.get("title") or obs.get("object_type")
                 or obs.get("event_type") or src,
        "url": obs.get("source_url") or obs.get("url"),
        "raw": obs,
    }


def cluster(observations: list[dict], *,
            radius_km: float = DEFAULT_RADIUS_KM,
            window_hours: float = DEFAULT_WINDOW_HOURS) -> list[dict]:
    """Group observations that place something at the same point in
    space and time.

    Single-link agglomeration: an observation joins a cluster if it is close
    to ANY member, not to the cluster's centroid. Two sightings a few
    hundred metres apart on opposite sides of a growing cluster belong
    together, and centroid linkage would split them.
    """
    obs = [o for o in (normalise(o) for o in observations) if o]
    obs.sort(key=lambda o: o["ts"])
    window = timedelta(hours=window_hours)

    clusters: list[list[dict]] = []
    for o in obs:
        joined = None
        for c in clusters:
            for m in c:
                if abs((o["ts"] - m["ts"]).total_seconds()) <= window.total_seconds() \
                        and haversine_km(o["lat"], o["lon"], m["lat"], m["lon"]) <= radius_km:
                    joined = c
                    break
            if joined is not None:
                break
        if joined is None:
            clusters.append([o])
        else:
            joined.append(o)

    return [summarise(c) for c in clusters]


def independence(members: list[dict]) -> int:
    """How many genuinely independent ways of looking agree.

    Counted by MODALITY, not by source. Two machine readings of the same
    wire story are one witness; a thermal satellite and a human watching a
    video are two. This is the number that makes a cluster worth believing,
    and conflating it with the member count is how a system talks itself
    into confidence it has not earned.
    """
    return len({m["modality"] for m in members})


def summarise(members: list[dict]) -> dict:
    lat = sum(m["lat"] for m in members) / len(members)
    lon = sum(m["lon"] for m in members) / len(members)
    first = min(m["ts"] for m in members)
    last = max(m["ts"] for m in members)
    modalities = sorted({m["modality"] for m in members})
    sources = sorted({m["source"] for m in members})
    indep = len(modalities)

    # Confidence rises with INDEPENDENCE, not with volume. Ten GDELT rows
    # about one wire story must not outrank one human-verified placemark.
    best = max(m["weight"] for m in members)
    conf = min(1.0, best + 0.2 * (indep - 1))

    return {
        "lat": round(lat, 5), "lon": round(lon, 5),
        "first_seen": first.isoformat(), "last_seen": last.isoformat(),
        "span_hours": round((last - first).total_seconds() / 3600.0, 1),
        "members": len(members),
        "sources": sources,
        "modalities": modalities,
        "independent_modalities": indep,
        "corroborated": indep >= 2,
        "confidence": round(conf, 2),
        "labels": sorted({m["label"] for m in members if m["label"]}),
        "urls": [m["url"] for m in members if m.get("url")][:5],
        "headline": headline(sources, modalities, members),
        "detail": [{"source": m["source"], "label": m["label"],
                    "lat": m["lat"], "lon": m["lon"],
                    "ts": m["ts"].isoformat(), "url": m.get("url")}
                   for m in sorted(members, key=lambda m: m["ts"])],
    }


_READABLE = {
    "firms": "a thermal hotspot", "viirs": "a thermal hotspot",
    "sar_change": "a change in radar backscatter",
    "sar_vessel": "a radar vessel contact",
    "imagery": "an object in optical imagery",
    "sentinel2_optical": "an object in optical imagery",
    "geoconfirmed": "a geolocated, human-verified report",
    "gdelt": "news reporting", "news": "news reporting",
    "ucdp": "a coded conflict event",
    "ais": "a vessel transponder", "adsb": "an aircraft transponder",
}


def headline(sources, modalities, members) -> str:
    """A sentence naming what agrees, not a score.

    "confidence 0.8" tells a reader nothing they can act on. "A thermal
    hotspot and a geolocated report, 2.4 hours apart" tells them exactly
    what they have and lets them judge it.
    """
    names = [_READABLE.get(s, s) for s in sources]
    if len(names) == 1:
        return f"{names[0].capitalize()} — uncorroborated"
    span = round((max(m["ts"] for m in members)
                  - min(m["ts"] for m in members)).total_seconds() / 3600.0, 1)
    joined = ", ".join(names[:-1]) + f" and {names[-1]}"
    indep = len(set(modalities))
    qual = (f"{indep} independent kinds of observation"
            if indep >= 2 else "the same kind of source twice")
    return f"{joined.capitalize()} within {span}h — {qual}"


def corroborated_only(clusters: list[dict], min_modalities: int = 2) -> list[dict]:
    """The clusters worth waking someone for, strongest first."""
    out = [c for c in clusters if c["independent_modalities"] >= min_modalities]
    out.sort(key=lambda c: (-c["independent_modalities"], -c["confidence"], -c["members"]))
    return out
