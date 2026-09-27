"""
gps_interference.py — where satellite navigation is being denied, measured
from the aircraft already flying through it.

WHY THIS IS MEASURABLE AT ALL. Every ADS-B message carries the transmitting
aircraft's own assessment of how good its position fix is:

    NIC    Navigation Integrity Category — how far the reported position
           could be from the truth before the aircraft would notice
    NACp   Navigation Accuracy Category (position) — the same claim about
           accuracy rather than integrity

A modern airliner with a healthy GNSS fix reports NIC 8-11 and NACp 9-11
continuously. When its receiver is jammed or spoofed it cannot substantiate
any containment radius and reports NIC 0. So the aircraft tell you, in their
own words, that they have lost GPS — and they do it over the exact patch of
sky where it happened.

WHAT THIS COSTS: nothing. The ADS-B poll loop already fetches these records
every sixty seconds for ten global regions and throws the integrity fields
away. This reads them on the way past. There is no second API, no key, and
no rate limit to respect beyond the one already being respected.

THE ALTITUDE FLOOR IS THE WHOLE TRICK, and leaving it out is how this kind
of detector gets a reputation for crying wolf. Measured against live data:

    floor        Kaliningrad   Finland   Tokyo   Madrid   Chicago
    3,000 ft        23.9%       17.8%    10.0%    1.1%     0.0%
    10,000 ft       25.8%       16.7%     5.7%    0.0%     0.0%
    20,000 ft       27.6%       10.5%     4.2%    0.0%     0.0%

At 3,000 ft Tokyo looks jammed. It is not: its low readings are regional
jets — E190, Dash 8, CRJ7 — whose older transponders genuinely report poor
integrity near the ground. The Baltic's are A321s and 737s, aircraft that
have no business losing GPS. Raising the floor removes the equipment
artefact and leaves the denial, because a jammer on the ground reaches
cruise altitude by line of sight while terminal-area noise does not.

WHAT THIS IS NOT. It cannot separate jamming (drowning the signal) from
spoofing (forging it), and it does not name who is doing it. An aircraft
that has been successfully spoofed may report an excellent fix for a
position that is wrong, which this method cannot see at all. It says: over
this patch of sky, aircraft are failing to hold a fix, at this rate, out of
this many. Every consumer is given the denominator so nobody has to trust
the percentage alone.
"""
from __future__ import annotations

import datetime
import math
import time

# ── Detection thresholds ─────────────────────────────────────────────────

# Below this an aircraft's integrity reading says more about its avionics
# than about the sky it is in. See the table above.
MIN_ALT_FT = 10_000

# The aircraft's own verdict on its fix. NIC < 7 means it cannot substantiate
# a containment radius better than 0.2 nm; NACp < 8 the equivalent for
# accuracy. Either is a receiver that is not doing its job.
BAD_NIC = 7
BAD_NACP = 8

# TWO RESOLUTIONS, AND THE DIFFERENCE BETWEEN THEM IS THE WHOLE DESIGN.
#
# Observations are stored in fine cells, but a cell's rate is computed over
# a larger neighbourhood around it. That separates "how precisely can I draw
# this" from "how many aircraft do I need before the number means anything",
# which are different questions that a single grid size has to answer badly.
#
# Measured against the Kaliningrad probe, which independently measured 25.8%
# of aircraft without a fix, using one grid for both:
#
#     1.0 deg   no cell reaches the minimum aircraft bar — invisible
#     2.0 deg   55.0N 23.0E, 8 aircraft, 7 degraded, 88% — severe
#
# At one degree the cells were finer than the traffic is dense, so real
# jamming split across cells that each fell under the minimum and every one
# of them reported nothing. Rather than accept coarse tiles, the store is
# now 0.5 degrees and each tile is scored over the aircraft within
# NEIGHBOURHOOD_DEG of it. Sixteen times the tiles, and the statistics are
# computed over the same amount of evidence as before.
CELL_DEG = 0.5

# The radius the rate is computed over, in degrees. A tile reports on the
# aircraft within this distance of it, so adjacent tiles share evidence and
# the field is smooth rather than a mosaic of independent small samples.
NEIGHBOURHOOD_DEG = 1.0

# A cell is only reported when enough aircraft crossed it to mean anything.
# Three aircraft, two of them with old radios, is 66% and is noise.
MIN_AIRCRAFT = 8

# Above this share of aircraft without a usable fix, the cell is called
# degraded. Controls measured 0.0% and known-disputed airspace 16-26%, so
# this sits well clear of both.
DEGRADED_PCT = 10.0

# And above this it is severe enough to raise a signal on its own.
SEVERE_PCT = 25.0

# A PERCENTAGE ALONE IS NOT ENOUGH, and this is the second way this
# detector would otherwise cry wolf. A cell holding nine aircraft, one of
# them an old regional jet, is 11% and trips DEGRADED_PCT on the strength
# of a single radio. Requiring several aircraft to fail independently is
# what separates "one aeroplane has a problem" from "this airspace has a
# problem" — jamming is a property of the sky and affects everyone in it.
MIN_DEGRADED = 3

# How long a cell's observations stay in the window. Aircraft are sparse
# over open sea, so a short window would never reach MIN_AIRCRAFT there.
WINDOW_S = 30 * 60

# Cells are dropped once they have not been touched for this long, so the
# store cannot grow without bound in a long-lived process.
EVICT_S = 2 * 60 * 60


def _cell_key(lat: float, lon: float) -> tuple[int, int]:
    return (int(math.floor(lat / CELL_DEG)), int(math.floor(lon / CELL_DEG)))


def _cell_centre(key: tuple[int, int]) -> tuple[float, float]:
    return ((key[0] + 0.5) * CELL_DEG, (key[1] + 0.5) * CELL_DEG)


def reads_fix(ac: dict) -> bool | None:
    """Did this aircraft report a usable GNSS fix?

    None when the aircraft cannot be assessed — on the ground, too low,
    no position, or a transponder that does not send integrity at all.
    Those are excluded from both sides of the ratio rather than counted
    as healthy, because a silent aircraft is not evidence of good GPS.
    """
    alt = ac.get("alt_baro")
    if alt == "ground" or not isinstance(alt, (int, float)) or alt < MIN_ALT_FT:
        return None
    if ac.get("lat") is None or ac.get("lon") is None:
        return None
    nic, nacp = ac.get("nic"), ac.get("nac_p")
    if nic is None and nacp is None:
        return None
    if (nic is not None and nic < BAD_NIC) or (nacp is not None and nacp < BAD_NACP):
        return False
    return True


class InterferenceGrid:
    """A rolling window of fix quality, by cell, counted in AIRCRAFT.

    THE DEDUPLICATION IS NOT AN OPTIMISATION, it is what makes the number
    mean what it says. The poll runs every sixty seconds and a jet crossing
    one cell is seen in several consecutive polls, so counting raw
    observations would report "thirty aircraft, eight degraded" for what was
    really three aircraft, one of them degraded, seen ten times each. The
    denominator would then be a function of how long aircraft linger, which
    is a function of the wind.

    So each aircraft holds one slot per cell, carrying its most recent
    verdict. "Eight aircraft, two degraded" means eight aeroplanes.
    """

    def __init__(self):
        # cell -> hex -> (last_seen, ok)
        self._cells: dict[tuple[int, int], dict[str, tuple[float, bool]]] = {}
        self.last_update: float | None = None
        self.total_observed = 0

    def observe(self, aircraft: list[dict], now: float | None = None) -> int:
        now = now or time.time()
        seen = 0
        for ac in aircraft or []:
            ok = reads_fix(ac)
            if ok is None:
                continue
            ident = (ac.get("hex") or ac.get("icao") or "").strip().upper()
            if not ident:
                # Without an identity this aircraft cannot be deduplicated,
                # and including it would reintroduce exactly the inflation
                # this class exists to avoid.
                continue
            key = _cell_key(float(ac["lat"]), float(ac["lon"]))
            self._cells.setdefault(key, {})[ident] = (now, ok)
            seen += 1
        if seen:
            self.last_update = now
            self.total_observed += seen
        self._evict(now)
        return seen

    def _evict(self, now: float) -> None:
        cutoff = now - WINDOW_S
        dead = []
        for key, birds in self._cells.items():
            for ident in [i for i, (t, _) in birds.items() if t < cutoff]:
                birds.pop(ident, None)
            if not birds:
                dead.append(key)
        for key in dead:
            self._cells.pop(key, None)

    def cells(self, now: float | None = None, min_aircraft: int = MIN_AIRCRAFT) -> list[dict]:
        """Every tile with enough traffic around it to be worth reporting.

        A tile's numbers describe its NEIGHBOURHOOD, not the tile alone, and
        the payload says so — `radius_deg` is carried through so the reader
        is never shown a precise-looking square built from a wider sample
        without being told.

        Healthy tiles are included deliberately. A map that only draws
        trouble cannot distinguish "no interference here" from "nothing
        looked here", and over open ocean that difference is the whole
        story.
        """
        now = now or time.time()
        cutoff = now - WINDOW_S
        reach = int(round(NEIGHBOURHOOD_DEG / CELL_DEG))

        # Fresh aircraft per stored cell, once, so the neighbourhood sweep
        # below is not re-filtering the same lists for every neighbour.
        fresh: dict[tuple[int, int], list[bool]] = {}
        for key, birds in self._cells.items():
            vals = [ok for (t, ok) in birds.values() if t >= cutoff]
            if vals:
                fresh[key] = vals

        out = []
        for key in fresh:
            total = bad = 0
            for dy in range(-reach, reach + 1):
                for dx in range(-reach, reach + 1):
                    vals = fresh.get((key[0] + dy, key[1] + dx))
                    if not vals:
                        continue
                    total += len(vals)
                    bad += sum(1 for ok in vals if not ok)
            if total < min_aircraft:
                continue
            pct = bad / total * 100.0
            lat, lon = _cell_centre(key)
            out.append({
                "lat": round(lat, 3),
                "lon": round(lon, 3),
                "cell": f"{key[0]}:{key[1]}",
                "aircraft": total,
                "degraded": bad,
                "pct": round(pct, 1),
                # Both tests must pass: a high enough share, AND enough
                # aircraft independently failing to make it about the sky
                # rather than about one aeroplane.
                "level": (("severe" if pct >= SEVERE_PCT else "degraded")
                          if (pct >= DEGRADED_PCT and bad >= MIN_DEGRADED)
                          else "clear"),
                "cell_deg": CELL_DEG,
                "radius_deg": NEIGHBOURHOOD_DEG,
            })
        out.sort(key=lambda c: (-c["pct"], -c["aircraft"]))
        return out

    def stats(self) -> dict:
        return {
            "cells_tracked": len(self._cells),
            "aircraft_tracked": sum(len(v) for v in self._cells.values()),
            "total_observed": self.total_observed,
            "last_update": (datetime.datetime.utcfromtimestamp(self.last_update).isoformat() + "Z"
                            if self.last_update else None),
            "window_minutes": WINDOW_S // 60,
            "min_altitude_ft": MIN_ALT_FT,
            "min_aircraft": MIN_AIRCRAFT,
            "cell_deg": CELL_DEG,
            "neighbourhood_deg": NEIGHBOURHOOD_DEG,
            "min_degraded": MIN_DEGRADED,
            "degraded_pct": DEGRADED_PCT,
            "severe_pct": SEVERE_PCT,
        }


# The one grid the app shares. Populated by the ADS-B poll loop in main.py.
GRID = InterferenceGrid()


def observe(aircraft: list[dict], now: float | None = None) -> int:
    return GRID.observe(aircraft, now=now)


def cells(**kw) -> list[dict]:
    return GRID.cells(**kw)


def stats() -> dict:
    return GRID.stats()


# ── Raising a signal ─────────────────────────────────────────────────────
#
# A cell that crosses the threshold becomes an Alert row like any other, so
# it reaches analytics, the briefings, the editor and the ontology through
# the paths those already use. Nothing downstream needs to know that this
# particular signal came from aircraft integrity fields rather than from a
# vessel or a wire report.
#
# THE COOLDOWN IS THE POINT. Jamming persists for days, and a loop that
# emitted on every pass would write a row a minute and bury the feed in one
# event — the same failure the surge and fusion engines already learned. A
# cell reports when it first crosses, and then at most once per cooldown
# while it stays crossed.

ALERT_COOLDOWN_S = 6 * 3600

_emitted: dict[str, float] = {}


def due_for_alert(cells_now: list[dict], now: float | None = None) -> list[dict]:
    """The affected cells that should raise a signal on this pass."""
    now = now or time.time()
    out = []
    for c in cells_now:
        if c["level"] == "clear":
            # Recovered: forget it, so a genuine recurrence reports again
            # rather than being swallowed by a stale cooldown.
            _emitted.pop(c["cell"], None)
            continue
        last = _emitted.get(c["cell"])
        if last is not None and now - last < ALERT_COOLDOWN_S:
            continue
        _emitted[c["cell"]] = now
        out.append(c)
    return out


def alert_payload(c: dict, place: str | None = None) -> dict:
    """The row a crossed cell becomes, in the shape the Alert table wants."""
    where = place or f"{abs(c['lat']):.1f}°{'N' if c['lat'] >= 0 else 'S'} " \
                     f"{abs(c['lon']):.1f}°{'E' if c['lon'] >= 0 else 'W'}"
    return {
        "source": "gps",
        "alert_type": "gps_interference",
        "severity": "high" if c["level"] == "severe" else "medium",
        "title": (f"Satellite navigation degraded over {where} — "
                  f"{c['degraded']} of {c['aircraft']} aircraft without a fix "
                  f"({c['pct']:.0f}%)"),
        "lat": c["lat"],
        "lon": c["lon"],
        "entity_type": "airspace",
        "entity_id": f"gps:{c['cell']}",
        "raw": {
            "cell": c["cell"],
            "aircraft": c["aircraft"],
            "degraded": c["degraded"],
            "pct": c["pct"],
            "level": c["level"],
            "method": f"ADS-B navigation integrity above {MIN_ALT_FT:,} ft",
            "caveat": ("Jamming and spoofing are not separated. Counts are "
                       "aircraft, not sightings."),
        },
    }
