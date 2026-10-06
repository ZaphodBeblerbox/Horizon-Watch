"""
imagery_signals.py — when a satellite pass becomes a signal.

Owner's rule (2026-10-06): what counts depends on what the place is. A mass
of tankers at Kharg Island is a signal; the same number at Jebel Ali is a
normal day, counted but not reported. Every vessel arriving at or leaving a
naval base matters. Heat appearing at an oil station matters; a station
that has been burning for days does not keep raising it.

So each watched area has a KIND, and each kind its own rules, applied to
confirmed objects only (both detection models agree — obb_detect.ENSEMBLE):

  naval_base       any vessel arriving or leaving
  airbase          any aircraft arriving or leaving
  oil_terminal     vessels above their normal range (mean + 2 sd of earlier
                   passes, and at least 3 more than the mean)
  energy_site      new heat (a fire detection with none in the 48 h before)
  commercial_port  only an extreme swing: outside mean ± 3 sd AND ±50%
  other            vessels or aircraft outside mean ± 3 sd
  every kind       a confirmed storage tank or structure gone — possible damage;
                   a new smoke plume (smoke.py), critical at energy sites and oil terminals

Pure functions; sentinel_scanner.py feeds them and writes the alerts.
"""
from __future__ import annotations

import statistics

KINDS = ("naval_base", "airbase", "oil_terminal", "energy_site", "commercial_port", "other")
KIND_WORD = {
    "naval_base": "naval base", "airbase": "airbase", "oil_terminal": "oil terminal",
    "energy_site": "energy site", "commercial_port": "commercial port", "other": "area",
}
NOUN = {"vessel": ("vessel", "vessels"), "aircraft": ("aircraft", "aircraft"),
        "storage_tank": ("storage tank", "storage tanks"), "port_infrastructure": ("port structure", "port structures"),
        "bridge": ("bridge", "bridges"), "vehicle": ("vehicle", "vehicles")}
FIXED = {"storage_tank", "port_infrastructure", "bridge"}


def noun(kind: str, n: int) -> str:
    one, many = NOUN.get(kind, (kind.replace("_", " "), kind.replace("_", " ") + "s"))
    return one if n == 1 else many


def normal_range(history: list[int]) -> tuple[float, float] | None:
    """(mean, sd) of a kind's count over earlier passes, or None if too few."""
    if len(history) < 3:
        return None
    return statistics.mean(history), statistics.pstdev(history)


def evaluate(*, kind: str, place: str, counts: dict, history: dict, new_by_type: dict,
             gone_by_type: dict, new_heat: int = 0, when: str | None = None,
             new_plumes: list | None = None) -> list[dict]:
    """The signals one pass raises. counts: kind -> confirmed count now;
    history: kind -> [counts at earlier passes]; new/gone_by_type from the
    change detection (confirmed objects only)."""
    out = []
    kind = kind if kind in KINDS else "other"

    def sig(title, severity, reason, focus=None):
        out.append({"title": f"{place}: {title}", "severity": severity, "reason": reason, "focus": focus})

    # Every kind: a new smoke plume (smoke.py) — critical where energy burns.
    # One event, one signal: plumes from sources within 1.5 km are the same
    # fire, and the fire under a plume belongs to that plume's signal.
    kept = []
    for p in sorted(new_plumes or [], key=lambda x: -(x.get("area_km2") or 0)):
        if any(abs(p["source_lat"] - k["source_lat"]) * 111 < 1.5 and abs(p["source_lon"] - k["source_lon"]) * 111 < 1.5
               for k in kept):
            continue
        kept.append(p)
    for p in kept:
        fire = " with active fire at its source" if p.get("fire_px") else ""
        sig(p.get("description") or "smoke plume", "critical" if kind in ("energy_site", "oil_terminal") else "high",
            f"A plume not there on the previous pass{fire}: a strike, an accident or a large fire. "
            f"Source {p.get('source_lat')}, {p.get('source_lon')}.", "smoke_plume")
    if any(p.get("fire_px") for p in kept):
        new_heat = 0

    # Every kind: something fixed is gone.
    for k in FIXED:
        g = gone_by_type.get(k, 0)
        if g:
            sig(f"{g} {noun(k, g)} gone since the last pass", "high",
                "A confirmed fixed structure is no longer detected — possible damage, demolition or cloud; check the image.", k)

    def moved(k):
        a, g = new_by_type.get(k, 0), gone_by_type.get(k, 0)
        return a, g

    if kind in ("naval_base", "airbase"):
        k = "vessel" if kind == "naval_base" else "aircraft"
        a, g = moved(k)
        if a or g:
            parts = ([f"{a} {noun(k, a)} arrived"] if a else []) + ([f"{g} left"] if g else [])
            sig(", ".join(parts) + f" — {counts.get(k, 0)} there now", "high",
                f"Every movement at a {KIND_WORD[kind]} is reported.", k)

    def outside(k, sds, min_abs=3, min_rel=0.0):
        nr = normal_range(history.get(k, []))
        if not nr:
            return None
        mean, sd = nr
        now = counts.get(k, 0)
        lo, hi = mean - sds * max(sd, 0.5), mean + sds * max(sd, 0.5)
        if now > hi and now - mean >= min_abs and (mean == 0 or (now - mean) / mean >= min_rel):
            return "above", now, mean, sd
        if now < lo and mean - now >= min_abs and (mean == 0 or (mean - now) / mean >= min_rel):
            return "below", now, mean, sd
        return None

    def rng(mean, sd):
        return f"{max(0, round(mean - sd))}–{round(mean + sd)}"

    if kind == "oil_terminal":
        o = outside("vessel", 2)
        if o and o[0] == "above":
            _, now, mean, sd = o
            sig(f"{now} vessels at the terminal — normal {rng(mean, sd)}", "high",
                "Vessels massing at an oil terminal: loading surge, a backlog, or ships sheltering.", "vessel")
        elif o:
            _, now, mean, sd = o
            sig(f"only {now} vessels at the terminal — normal {rng(mean, sd)}", "moderate",
                "An oil terminal emptying: halted exports, a closure, or a threat to shipping.", "vessel")

    if kind == "energy_site" and new_heat:
        sig(f"new heat detected ({new_heat} fire detection{'s' if new_heat != 1 else ''})", "critical",
            "Heat at an energy site with none in the two days before: a strike, an accident or flaring.", None)

    if kind in ("commercial_port", "other"):
        for k in ("vessel", "aircraft"):
            o = outside(k, 3, min_abs=5, min_rel=0.5 if kind == "commercial_port" else 0.0)
            if o:
                d, now, mean, sd = o
                sig(f"{now} {noun(k, now)} — {'far above' if d == 'above' else 'far below'} the normal {rng(mean, sd)}",
                    "moderate", "Only an extreme swing is reported here; normal traffic is counted, not signalled.", k)

    for s in out:
        s["when"] = when
    return out
