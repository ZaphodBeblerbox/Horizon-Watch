"""
vessel_threat.py — how worried to be about a Russia-linked ship off Europe.

THE THREAT (owner, 2026-10-11): a Russia-linked vessel loitering off a
European coast as a launch platform for fixed-wing Shahed-136/Geran-2-class
drones fired from containers. russia_loiter_watch.py decides WHETHER a ship
qualifies (an identifier-confirmed Russia link, hours of loitering, within
drone range of a European coast); this module says HOW MUCH it matters and
WHY, in lines a person can check:

  * Russia link strength — flag, sanctions (how many authorities, shadow
    fleet), Ukraine's GUR register.
  * Behaviour — loitering now (live AIS: hours, speed), and supporting
    history from Global Fishing Watch (90 days, published days late): port
    calls in Russia, meetings at sea, dark periods GFW judges intentional,
    earlier loitering.
  * Position — distance to the European coast, and what is in reach: the
    weighted coastal targets (coastal_targets.py) within the in-range ring,
    ranked by weight x importance x proximity, with flight time at the
    configured cruise speed.

Output: score 0..100, a tier, the alert severity, explanation lines, and
the top targets. Severity: "critical" only when the link is strong, the
loitering is long AND many high-weight targets are in range; otherwise
"high" (thresholds in target_weights.json "alert").

CONFIG-DRIVEN. Target weights, drone figures (public open-source estimates)
and thresholds are read from backend/data/target_weights.json (DATA_DIR copy
first), and the weights from the ```json block of
docs/research/russia_hybrid_targeting.md when that brief exists. Both are
re-read when they change; nothing here needs a code change to retune.
Pure apart from load_config() and update_alert().
"""
from __future__ import annotations

import copy
import json
import math
import os
import re
import threading
from typing import Callable, Optional

WEIGHT_KEYS = (
    "airport_civil", "airport_military", "military_base", "arms_industry", "logistics_aid_hub",
    "power_plant", "substation", "lng_terminal", "oil_terminal", "port", "cable_landing",
    "rail_hub", "government", "stadium_venue", "shopping_centre", "data_centre",
)

# The fallback when no config file can be read — the same values as the
# shipped backend/data/target_weights.json.
DEFAULTS: dict = {
    # docs/research/russia_hybrid_targeting.md (2026-10-11): air bases,
    # nuclear-sharing and naval bases, aid logistics and civil airports
    # were the targets — not stadiums (kept low, raised during events).
    "weights": {
        "airport_military": 0.95, "military_base": 0.85, "logistics_aid_hub": 0.85, "arms_industry": 0.70,
        "airport_civil": 0.65, "port": 0.55, "lng_terminal": 0.55, "power_plant": 0.50, "government": 0.40,
        "oil_terminal": 0.40, "cable_landing": 0.35, "substation": 0.30, "rail_hub": 0.30,
        "shopping_centre": 0.15, "stadium_venue": 0.15, "data_centre": 0.15,
    },
    # Shahed-136 / Geran-2 class — PUBLIC OPEN-SOURCE ESTIMATES (range
    # ~1,500-2,500 km, cruise ~150-185 km/h, low approach ~100-500 m).
    "drone": {"class": "Shahed-136 / Geran-2 class (fixed-wing, container-launched)",
              "cruise_kmh": 170, "altitude_m": [100, 500], "ring_km": [100, 300, 1000],
              "max_range_km": 2000, "in_range_km": 300},
    "targets": {"coastal_band_km": 300, "per_country_per_type": {k: 10 for k in WEIGHT_KEYS},
                "stadium_min_capacity": 20000, "power_plant_min_mw": 200, "refresh_days": 7, "top_n": 10},
    "alert": {"strong_link": 0.75, "long_loiter_hours": 6, "high_weight": 0.65, "many_targets": 5},
    # Time multipliers (brief, section 5): raise the targets component.
    "multipliers": {"night_factor": 1.5, "night_hours": [18, 4], "event_factor": 1.5,
                    "mass_event_weight": 0.35, "election_factor": 1.2, "wave_factor": 1.3,
                    "wave_days": 7, "wave_radius_km": 600, "events": [], "incidents": []},
    # Precursor indicators (brief, section 6): points toward one component.
    "precursors": {"near_site_km": [10, 100], "near_site": 0.3, "ais_gap_live": 0.2, "ais_gap_min_h": 1.0,
                   "name_flag_change": 0.25, "name_flag_change_days": 365, "russian_navy": 0.35,
                   "gnss_interference": 0.2, "gnss_radius_km": 150},
}

_CFG: Optional[dict] = None
_CFG_KEY = None
_CFG_LOCK = threading.Lock()


def _deep_merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if k.startswith("_"):
            continue
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def research_weights(text: str) -> Optional[dict]:
    """Target-type weights from the research brief's ```json block(s): the
    first block that names at least three known types, at the top level or
    under "weights"/"target_weights"/"target_type_weights". A value may be a
    number or {"weight": n}. Weights on a larger scale (0..10, 0..100) are
    normalised so the largest is 1."""
    for block in re.findall(r"```json\s*(.*?)```", text or "", re.S | re.I):
        try:
            obj = json.loads(block)
        except ValueError:
            continue
        if not isinstance(obj, dict):
            continue
        cands = [obj] + [obj.get(k) for k in ("weights", "target_weights", "target_type_weights")
                         if isinstance(obj.get(k), dict)]
        for c in cands:
            got = {}
            for k in WEIGHT_KEYS:
                v = c.get(k)
                if isinstance(v, dict):
                    v = v.get("weight", v.get("value"))
                try:
                    if v is not None:
                        got[k] = float(v)
                except (TypeError, ValueError):
                    continue
            if len(got) >= 3:
                top = max(got.values())
                if top > 1.0:
                    got = {k: v / top for k, v in got.items()}
                return {k: round(max(0.0, min(1.0, v)), 4) for k, v in got.items()}
    return None


def config_paths() -> tuple[list[str], str]:
    import paths
    files = [str(paths.DATA_DIR / "target_weights.json"), str(paths.CODE_DIR / "data" / "target_weights.json")]
    research = str(paths.CODE_DIR.parent / "docs" / "research" / "russia_hybrid_targeting.md")
    return files, research


def load_config(files: Optional[list[str]] = None, research: Optional[str] = None) -> dict:
    """The merged configuration, cached until one of its files changes."""
    global _CFG, _CFG_KEY
    if files is None or research is None:
        f0, r0 = config_paths()
        files = f0 if files is None else files
        research = r0 if research is None else research

    def mt(p):
        try:
            return os.path.getmtime(p)
        except OSError:
            return None
    key = (tuple(files), tuple(mt(p) for p in files), research, mt(research))
    with _CFG_LOCK:
        if _CFG is not None and key == _CFG_KEY:
            return _CFG
        cfg = copy.deepcopy(DEFAULTS)
        cfg["weights_source"] = "built-in defaults"
        for p in files:
            if not os.path.exists(p):
                continue
            try:
                with open(p, encoding="utf-8") as fh:
                    cfg = _deep_merge(cfg, json.load(fh))
                cfg["weights_source"] = os.path.basename(p)
                break
            except (OSError, ValueError) as e:
                print(f"[vessel-threat] error: config {p} unreadable ({type(e).__name__}: {e}); using defaults")
        if research and os.path.exists(research):
            try:
                with open(research, encoding="utf-8") as fh:
                    rw = research_weights(fh.read())
                if rw:
                    cfg["weights"] = {**cfg["weights"], **rw}
                    cfg["weights_source"] = "docs/research/russia_hybrid_targeting.md"
                else:
                    print("[vessel-threat] research brief has no usable ```json weights block yet; "
                          "using target_weights.json")
            except OSError as e:
                print(f"[vessel-threat] error: research brief unreadable: {e}")
        _CFG, _CFG_KEY = cfg, key
        return cfg


# ── pieces ────────────────────────────────────────────────────────────────

def flight_minutes(km: float, cruise_kmh: float) -> float:
    return km / max(1e-6, cruise_kmh) * 60.0


def fmt_minutes(m: float) -> str:
    if m < 60:
        return f"{max(1, round(m))} min"
    h, mm = divmod(round(m), 60)
    return f"{h} h {mm:02d} min"


def _parse_day(v) -> Optional[float]:
    import datetime as _dt
    try:
        d = _dt.datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=_dt.timezone.utc)
        return d.timestamp()
    except (TypeError, ValueError):
        return None


def active_events(cfg: dict, now: float) -> list[dict]:
    """Calendar entries (multipliers.events) running now. A date-only end
    covers that whole day."""
    out = []
    for e in (cfg.get("multipliers") or {}).get("events") or []:
        s, t = _parse_day(e.get("start")), _parse_day(e.get("end") or e.get("start"))
        if s is None or t is None:
            continue
        if len(str(e.get("end") or e.get("start"))) <= 10:
            t += 86400
        if s <= now <= t:
            out.append(e)
    return out


def recent_incidents(cfg: dict, now: float) -> list[dict]:
    m = cfg.get("multipliers") or {}
    days = float(m.get("wave_days", 7))
    out = []
    for i in m.get("incidents") or []:
        t = _parse_day(i.get("date"))
        if t is not None and 0 <= now - t <= days * 86400:
            out.append(i)
    return out


def local_hour(lon: float, now: float) -> float:
    """Local solar time from longitude — close enough for "is it night"."""
    return ((now % 86400) / 3600.0 + lon / 15.0) % 24.0


def is_night(lon: float, now: float, cfg: dict) -> bool:
    h0, h1 = (cfg.get("multipliers") or {}).get("night_hours", [18, 4])
    h = local_hour(lon, now)
    return h >= h0 or h < h1 if h0 > h1 else h0 <= h < h1


def target_weight(it: dict, cfg: dict, events: list[dict]) -> tuple[float, float, list[str]]:
    """(weight, multiplier, why) for one target under the running events:
    a mass event raises a stadium/venue to mass_event_weight, an election
    multiplies government sites, any other event (summit, VIP visit,
    exercise, port call, aid delivery) multiplies the targets in its radius."""
    import coastal_targets as ct
    m = cfg.get("multipliers") or {}
    w = float(cfg["weights"].get(it["type"], 0.3))
    mult, why = 1.0, []
    for e in events:
        try:
            if ct.haversine_km(it["lat"], it["lon"], float(e["lat"]), float(e["lon"])) > float(e.get("radius_km", 50)):
                continue
        except (KeyError, TypeError, ValueError):
            continue
        kind = str(e.get("kind") or "").lower()
        types = e.get("types")
        if kind == "mass_event":
            if it["type"] == "stadium_venue":
                w = max(w, float(m.get("mass_event_weight", 0.35)))
                why.append(e.get("name") or "major event")
            continue
        if kind == "election":
            if it["type"] == "government":
                mult *= float(e.get("factor") or m.get("election_factor", 1.2))
                why.append(e.get("name") or "election")
            continue
        if types and it["type"] not in types:
            continue
        mult *= float(e.get("factor") or m.get("event_factor", 1.5))
        why.append(e.get("name") or kind or "event")
    return w, mult, why


def rank_targets(lat: float, lon: float, index, cfg: dict, radius_km: Optional[float] = None,
                 top_n: Optional[int] = None, now: Optional[float] = None) -> list[dict]:
    """Targets within radius_km (default: the in-range ring), ranked by
    weight x importance x proximity (x any running event's multiplier);
    each with distance and flight time."""
    import time as _t
    now = _t.time() if now is None else now
    radius = float(radius_km or cfg["drone"]["in_range_km"])
    cruise = float(cfg["drone"]["cruise_kmh"])
    events = active_events(cfg, now)
    import coastal_targets as ct
    out = []
    for d, it in (index.within(lat, lon, radius) if index is not None else []):
        w, mult, why = target_weight(it, cfg, events)
        prox = 1.0 - 0.7 * (d / radius)
        score = w * mult * (0.6 + 0.4 * float(it.get("importance", 0.5))) * prox
        out.append({
            "name": it["name"], "type": it["type"], "type_label": ct.TYPE_LABEL.get(it["type"], it["type"]),
            "lat": it["lat"], "lon": it["lon"], "country": it.get("country"), "iso2": it.get("iso2"),
            "distance_km": round(d, 1), "flight_min": round(flight_minutes(d, cruise), 1),
            "weight": round(w, 3), "importance": it.get("importance"), "score": round(score, 4),
            "source": it.get("source"),
            **({"multiplier": round(mult, 2), "events": why} if why else {}),
            **({"capacity": it["capacity"]} if it.get("capacity") else {}),
            **({"capacity_mw": it["capacity_mw"]} if it.get("capacity_mw") else {}),
        })
    out.sort(key=lambda x: -x["score"])
    return out[: top_n] if top_n else out


def link_strength(links: list[dict]) -> tuple[float, list[str]]:
    """0..1 and the lines saying why."""
    flag = next((l for l in links if l.get("kind") == "flag"), None)
    sanc = next((l for l in links if l.get("kind") == "sanctions"), None)
    s, lines = 0.0, []
    if sanc:
        auths = [a for a in (sanc.get("authorities") or []) if "GUR" not in a]
        gur = any("GUR" in a for a in (sanc.get("authorities") or []))
        if auths:
            s = 0.6 + 0.1 * min(2, len(auths) - 1) + (0.1 if sanc.get("shadow") else 0.0) + (0.05 if gur else 0.0)
        else:
            s = 0.55 + (0.1 if sanc.get("shadow") else 0.0)
        lines.append(f"Russia link: {sanc.get('reason')} ({sanc.get('basis')})")
    if flag:
        s = min(1.0, s + 0.15) if sanc else 0.45
        lines.insert(0, f"Russia link: Russian flag ({flag.get('basis')})")
    return round(min(1.0, s), 3), lines


_RU = {"RUS", "RU"}


def history_signal(history: Optional[dict]) -> tuple[float, list[str]]:
    """GFW pattern of life (vessel_history.pattern_of_life) -> 0..1 and lines."""
    if not history or not history.get("available"):
        reason = (history or {}).get("reason") or "not fetched"
        return 0.0, [f"History (Global Fishing Watch): unavailable — {reason}"]
    s, bits = 0.0, []
    ru_calls = [p for p in history.get("port_calls") or [] if str(p.get("country_code") or "").upper() in _RU]
    if ru_calls:
        s += 0.3 if len(ru_calls) >= 3 else 0.2
        bits.append(f"{len(ru_calls)} port call{'s' if len(ru_calls) != 1 else ''} in Russia "
                    f"(last {ru_calls[0].get('port')})")
    meets = history.get("encounters") or []
    if meets:
        risky = sum(1 for m in meets if m.get("gfw_potential_risk"))
        s += min(0.3, 0.1 * len(meets)) + (0.05 if risky else 0.0)
        bits.append(f"{len(meets)} meeting{'s' if len(meets) != 1 else ''} at sea (ship-to-ship)"
                    + (f", {risky} flagged by GFW" if risky else ""))
    dark = [d for d in history.get("dark_periods") or [] if d.get("gfw_intentional")]
    if dark:
        s += min(0.3, 0.15 * len(dark))
        bits.append(f"went dark {len(dark)}x (GFW: likely intentional)")
    holds = history.get("loitering") or []
    if holds:
        s += min(0.15, 0.05 * len(holds))
        bits.append(f"{len(holds)} earlier loitering event{'s' if len(holds) != 1 else ''}")
    lag = history.get("lag_days")
    head = f"History (Global Fishing Watch, {history.get('window_days', 90)} days"
    head += f", newest event {lag:g} days old)" if lag is not None else ")"
    return round(min(1.0, s), 3), [f"{head}: " + ("; ".join(bits) if bits else "nothing notable")]


def severity_for(link: float, hours: float, high_count: int, cfg: dict) -> str:
    a = cfg["alert"]
    if link >= float(a["strong_link"]) and hours >= float(a["long_loiter_hours"]) \
            and high_count >= int(a["many_targets"]):
        return "critical"
    return "high"


TIERS = ((70, "critical", "Critical concern"), (50, "high", "High concern"),
         (30, "elevated", "Elevated concern"), (0, "watch", "Watch"))


def tier_of(score: float) -> tuple[str, str]:
    for lo, key, label in TIERS:
        if score >= lo:
            return key, label
    return "watch", "Watch"


def precursor_signal(*, ranked: list[dict], ais_gaps: Optional[list] = None, history: Optional[dict] = None,
                     russian_navy: bool = False, gnss: Optional[list] = None, events: Optional[list] = None,
                     lat: float = 0.0, lon: float = 0.0, cfg: dict, now: float) -> tuple[float, list[str]]:
    """The brief's precursor indicators (section 6) -> 0..1 and lines."""
    p = cfg.get("precursors") or {}
    hw = float(cfg["alert"]["high_weight"])
    s, lines = 0.0, []
    lo, hi = (p.get("near_site_km") or [10, 100])[:2]
    near = [t for t in ranked if lo <= t["distance_km"] <= hi and t["weight"] >= hw]
    if near:
        s += float(p.get("near_site", 0.3))
        lines.append(f"Precursor: holding {near[0]['distance_km']:.0f} km from {near[0]['name']} "
                     f"({near[0]['type_label'].lower()}) — the {lo:g}-{hi:g} km stand-off seen before past incidents")
    gaps = [g for g in (ais_gaps or []) if (g.get("hours") or 0) >= float(p.get("ais_gap_min_h", 1.0))]
    if gaps:
        s += float(p.get("ais_gap_live", 0.2))
        longest = max(g["hours"] for g in gaps)
        lines.append(f"Precursor: AIS went silent {len(gaps)}x in the last 24 h (longest {longest:.1f} h)")
    if history and history.get("available"):
        idents = history.get("identities") or []
        names = {i.get("name") for i in idents if i.get("name")}
        flags = {i.get("flag") for i in idents if i.get("flag")}
        if len(names) > 1 or len(flags) > 1:
            days = float(p.get("name_flag_change_days", 365))
            starts = [_parse_day(i.get("from")) for i in idents[1:]]
            recent = any(t is not None and now - t <= days * 86400 for t in starts)
            if recent or not any(starts):
                s += float(p.get("name_flag_change", 0.25))
                lines.append(f"Precursor: {'recent ' if recent else ''}name or flag change — "
                             f"{len(names)} names, {len(flags)} flags (GFW identity record)")
    if russian_navy:
        pts = float(p.get("russian_navy", 0.35))
        ex = [e for e in (events or []) if str(e.get("kind") or "").lower() in ("exercise", "port_call")]
        s += pts
        lines.append("Precursor: Russian Navy vessel" + (f" near {ex[0].get('name') or 'an exercise'}" if ex else ""))
    if gnss:
        g = gnss[0]
        s += float(p.get("gnss_interference", 0.2))
        lines.append(f"Precursor: GNSS interference nearby — {g.get('pct', 0):.0f}% of aircraft degraded "
                     f"({g.get('level')}) about {g.get('km', 0):.0f} km away")
    return round(min(1.0, s), 3), lines


def assess(*, links: list[dict], hours: float, speed: Optional[float], dist_km: Optional[float],
           country_phrase: Optional[str], lat: float, lon: float, index, cfg: dict,
           history: Optional[dict] = None, ais_gaps: Optional[list] = None, russian_navy: bool = False,
           gnss: Optional[list] = None, now: Optional[float] = None) -> dict:
    """The vessel-of-concern reading. Pure given its inputs (and `now`)."""
    import time as _t
    import coastal_targets as ct
    now = _t.time() if now is None else now
    drone = cfg["drone"]
    m = cfg.get("multipliers") or {}
    in_range = float(drone["in_range_km"])
    hw = float(cfg["alert"]["high_weight"])
    link, link_lines = link_strength(links)
    loiter = min(1.0, max(0.0, hours) / 12.0)
    hist, hist_lines = history_signal(history)
    behaviour = 0.6 * loiter + 0.4 * hist
    coast = 0.0 if dist_km is None else max(0.0, 1.0 - min(float(dist_km), 100.0) / 100.0)
    ranked = rank_targets(lat, lon, index, cfg, in_range, now=now)
    high = [t for t in ranked if t["weight"] >= hw]
    exposure = min(1.0, sum(t["score"] for t in ranked[:10]) / 4.0)

    # Time multipliers on the targets component (brief, section 5).
    time_mult, time_lines = 1.0, []
    if is_night(lon, now, cfg):
        time_mult *= float(m.get("night_factor", 1.5))
        h = local_hour(lon, now)
        time_lines.append(f"Night at sea (local ~{int(h):02d}:{int(h % 1 * 60):02d}): most incidents came "
                          f"evening or night, x{float(m.get('night_factor', 1.5)):g}")
    waves = [i for i in recent_incidents(cfg, now)
             if ct.haversine_km(lat, lon, float(i.get("lat", 0)), float(i.get("lon", 0)))
             <= float(i.get("radius_km") or m.get("wave_radius_km", 600))]
    if waves:
        time_mult *= float(m.get("wave_factor", 1.3))
        time_lines.append(f"Within {m.get('wave_days', 7)} days of {waves[0].get('name') or 'a confirmed incident'} "
                          f"(incidents came in waves), x{float(m.get('wave_factor', 1.3)):g}")
    boosted = [t for t in ranked[:10] if t.get("events")]
    if boosted:
        time_lines.append(f"Running event: {boosted[0]['events'][0]} raises {boosted[0]['name']}")
    targets_c = min(1.0, exposure * time_mult)

    events = active_events(cfg, now)
    prec, prec_lines = precursor_signal(ranked=ranked, ais_gaps=ais_gaps, history=history,
                                        russian_navy=russian_navy, gnss=gnss, events=events,
                                        lat=lat, lon=lon, cfg=cfg, now=now)
    score = round(100 * (0.25 * link + 0.20 * behaviour + 0.10 * coast + 0.30 * targets_c + 0.15 * prec))
    tier, tier_label = tier_of(score)
    severity = severity_for(link, hours, len(high), cfg)

    lines = list(link_lines)
    where = f", {dist_km:.0f} km off {country_phrase}" if dist_km is not None and country_phrase else ""
    if hours > 0:
        lines.append(f"Loitering {hours:.1f} h" + (f" at {speed:.1f} kn" if speed is not None else "") + where)
    elif where:
        lines.append("Not loitering now" + where)
    lines += hist_lines
    cruise = float(drone["cruise_kmh"])
    if ranked:
        top = ranked[0]
        lines.append(
            f"In reach: {len(ranked)} target{'s' if len(ranked) != 1 else ''} within {in_range:.0f} km, "
            f"{len(high)} high-value (weight >= {hw:g}); top: {top['name']} ({top['type_label'].lower()}), "
            f"{top['distance_km']:.0f} km, ~{fmt_minutes(top['flight_min'])} at {cruise:.0f} km/h")
        near = [t for t in ranked if t["distance_km"] <= 100]
        if near:
            lines.append(f"Within 100 km: {len(near)} target{'s' if len(near) != 1 else ''}"
                         f" — {', '.join(t['name'] for t in near[:3])}")
    else:
        lines.append(f"No mapped targets within {in_range:.0f} km")
    lines += prec_lines + time_lines
    lines.append(f"Score {score}/100 ({tier_label}): link {link:.2f}, behaviour {behaviour:.2f}, "
                 f"coast {coast:.2f}, targets {targets_c:.2f}" + (f" (x{time_mult:g})" if time_mult != 1 else "")
                 + f", precursors {prec:.2f}")
    return {
        "score": score, "tier": tier, "tier_label": tier_label, "severity": severity,
        "components": {"link": link, "behaviour": round(behaviour, 3), "loiter": round(loiter, 3),
                       "history": hist, "coast": round(coast, 3), "targets": round(targets_c, 3),
                       "time_multiplier": round(time_mult, 3), "precursors": prec},
        "lines": lines,
        "targets": ranked[: int(cfg["targets"].get("top_n", 10))],
        "in_range_count": len(ranked), "high_value_count": len(high),
        "drone": {k: v for k, v in drone.items() if not k.startswith("_")},
        "weights_source": cfg.get("weights_source"),
    }


def gnss_near(lat: float, lon: float, radius_km: float = 150.0) -> list[dict]:
    """Degraded/severe GNSS cells near a point from the in-process
    gps_interference grid (fed by the ADS-B loop), nearest first."""
    try:
        import gps_interference as gi
        import coastal_targets as ct
        out = []
        for c in gi.cells():
            if c.get("level") in ("degraded", "severe"):
                d = ct.haversine_km(lat, lon, c["lat"], c["lon"])
                if d <= radius_km:
                    out.append({**c, "km": round(d, 1)})
        return sorted(out, key=lambda c: c["km"])
    except Exception as e:                                   # noqa: BLE001
        print(f"[vessel-threat] error: GNSS lookup: {type(e).__name__}: {e}")
        return []


def reason_tail(a: dict) -> str:
    """The notification's context: what is in reach."""
    t = a.get("targets") or []
    if not t:
        return f"no mapped targets within {a['drone']['in_range_km']:.0f} km"
    top = t[0]
    return (f"{a['high_value_count']} high-value targets within {a['drone']['in_range_km']:.0f} km, "
            f"top {top['name']} {top['distance_km']:.0f} km (~{fmt_minutes(top['flight_min'])} drone flight)")


# ── the record ────────────────────────────────────────────────────────────

def update_alert(alert_id: str, *, severity: str, title: str, message: str, reason: str,
                 raw: dict) -> bool:
    """Escalate an episode's alert IN PLACE (same id: one alert per episode).
    Blocking — call from a worker thread."""
    from database import Alert, get_db
    with get_db() as db:
        row = db.query(Alert).filter(Alert.alert_id == alert_id).first()
        if row is None:
            return False
        try:
            stored = json.loads(row.raw_json or "{}")
        except ValueError:
            stored = {}
        stored.update({"severity": severity, "title": title, "message": message, "reason": reason, "raw": raw})
        row.severity = severity
        row.title = title
        row.raw_json = json.dumps(stored, default=str)
        db.commit()
    return True


def history_provider() -> Callable[[str], Optional[dict]]:
    def get(mmsi: str) -> Optional[dict]:
        try:
            import vessel_history
            return vessel_history.pattern_of_life(mmsi)
        except Exception as e:                               # noqa: BLE001
            print(f"[vessel-threat] error: GFW history for {mmsi}: {type(e).__name__}: {e}")
            return {"available": False, "reason": f"{type(e).__name__}"}
    return get


def ring_geojson(lat: float, lon: float, radii_km: list[float], n: int = 128) -> list[dict]:
    """Rings as closed [lat, lon] lists (for clients without geodesic circles)."""
    out = []
    p1, l1 = math.radians(lat), math.radians(lon)
    for r in radii_km:
        d = r / 6371.0088
        pts = []
        for i in range(n + 1):
            b = 2 * math.pi * i / n
            p2 = math.asin(math.sin(p1) * math.cos(d) + math.cos(p1) * math.sin(d) * math.cos(b))
            l2 = l1 + math.atan2(math.sin(b) * math.sin(d) * math.cos(p1), math.cos(d) - math.sin(p1) * math.sin(p2))
            pts.append([round(math.degrees(p2), 5), round((math.degrees(l2) + 540) % 360 - 180, 5)])
        out.append({"km": r, "points": pts})
    return out


# ── the live view and the snapshot (endpoints in main.py) ─────────────────

def trail_24h(db_path: str, mmsi: str, now: float, max_points: int = 400) -> list[list]:
    """[[lat, lon, epoch], …] from vessel_history over the last 24 h, thinned."""
    import datetime as _dt
    import sqlite3
    since = _dt.datetime.fromtimestamp(now - 86400, _dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=10)
    try:
        rows = con.execute("SELECT lat, lon, timestamp FROM vessel_history WHERE mmsi = ? AND timestamp >= ? "
                           "AND lat IS NOT NULL AND lon IS NOT NULL ORDER BY timestamp", (str(mmsi), since)).fetchall()
    finally:
        con.close()
    out = []
    for la, lo, ts in rows:
        try:
            t = _dt.datetime.fromisoformat(str(ts).replace(" ", "T")[:19]).replace(tzinfo=_dt.timezone.utc).timestamp()
        except ValueError:
            continue
        out.append([round(float(la), 5), round(float(lo), 5), int(t)])
    if len(out) > max_points:
        step = len(out) / max_points
        out = [out[int(i * step)] for i in range(max_points)] + [out[-1]]
    return out


def last_alert(db_path: str, mmsi: str) -> Optional[dict]:
    import sqlite3
    import russia_loiter_watch as rlw
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=10)
    try:
        r = con.execute("SELECT alert_id, title, severity, lat, lon, created_at, raw_json FROM alerts "
                        "WHERE entity_id = ? AND alert_type = ? ORDER BY created_at DESC LIMIT 1",
                        (str(mmsi), rlw.ALERT_TYPE)).fetchone()
    finally:
        con.close()
    if not r:
        return None
    try:
        raw = (json.loads(r[6] or "{}") or {}).get("raw") or {}
    except ValueError:
        raw = {}
    return {"id": r[0], "title": r[1], "severity": r[2], "lat": r[3], "lon": r[4], "created_at": r[5],
            "raw": raw}


def live_view(mmsi: str, *, live: Optional[dict], watch, db_path: str, now: float,
              lat: Optional[float] = None, lon: Optional[float] = None, synthetic: bool = False) -> dict:
    """Everything the vessel's live view draws: position (live AIS, else
    the last alert, else the given point), the last 24 h trail, the rings,
    the ranked targets in reach and the vessel-of-concern reading. Blocking."""
    import russia_loiter_watch as rlw
    cfg = load_config()
    alert = None if synthetic else last_alert(db_path, mmsi)
    v = dict(live or {})
    source = "live AIS" if live else None
    if not live and alert and alert.get("lat") is not None:
        v = {"mmsi": mmsi, "lat": alert["lat"], "lon": alert["lon"], "name": alert["raw"].get("name"),
             "imo": alert["raw"].get("imo")}
        source = "last alert position (not in the live AIS picture now)"
    if lat is not None and lon is not None and (synthetic or not v.get("lat")):
        v = {**v, "mmsi": mmsi, "lat": float(lat), "lon": float(lon)}
        source = "synthetic position (demonstration, not a real vessel)" if synthetic else "given position"
    if v.get("lat") is None:
        return {"available": False, "mmsi": mmsi, "reason": "No live AIS position, no alert and no position given."}
    vlat, vlon = float(v["lat"]), float(v.get("lon", v.get("lng")))
    links, hours, speed = [], 0.0, None
    try:
        speed = None if v.get("speed") is None else float(v["speed"])
    except (TypeError, ValueError):
        speed = None
    if not synthetic and watch is not None:
        try:
            links = rlw.russia_links(v, watch.index(now))
        except Exception as e:                               # noqa: BLE001
            print(f"[vessel-threat] error: links for {mmsi}: {type(e).__name__}: {e}")
        st = watch.state.get(str(mmsi)) or {}
        if st.get("start"):
            hours = max(0.0, (float(st.get("last_t") or now) - st["start"]) / 3600.0)
        if not links and alert:
            links = alert["raw"].get("links") or []
    elif synthetic:
        links = [{"kind": "synthetic", "reason": "synthetic demonstration vessel", "basis": "none"}]
    geo = watch.where(vlat, vlon) if watch is not None else {}
    history = None
    if not synthetic:
        history = (history_provider())(mmsi)
    import coastal_targets as ct
    idx = ct.index(cfg)
    a = assess(links=[l for l in links if l.get("kind") != "synthetic"], hours=hours, speed=speed,
               dist_km=geo.get("dist_km"), country_phrase=geo.get("phrase"), lat=vlat, lon=vlon, index=idx,
               cfg=cfg, history=history, ais_gaps=(watch.gaps.get(str(mmsi)) if watch is not None else None),
               gnss=gnss_near(vlat, vlon), now=now)
    markers = rank_targets(vlat, vlon, idx, cfg, float(cfg["drone"]["in_range_km"]), top_n=40, now=now)
    name = rlw._clean_name(v) or (alert or {}).get("raw", {}).get("name") or None
    return {
        "available": True, "mmsi": mmsi, "synthetic": bool(synthetic),
        "vessel": {"mmsi": mmsi, "name": name, "lat": vlat, "lon": vlon, "speed": speed,
                   "cog": v.get("cog", v.get("heading")), "ship_type": rlw.ship_word(v),
                   "last_update": v.get("last_update"), "position_source": source,
                   "links": [l.get("reason") for l in links]},
        "trail": [] if synthetic else trail_24h(db_path, mmsi, now),
        "rings_km": list(cfg["drone"]["ring_km"]),
        "drone": a["drone"],
        "assessment": {k: a[k] for k in ("score", "tier", "tier_label", "severity", "components", "lines",
                                         "in_range_count", "high_value_count", "weights_source")},
        "targets": a["targets"],
        "markers": markers,
        "alert": {k: alert[k] for k in ("id", "title", "severity", "created_at")} if alert else None,
        "where": {k: geo.get(k) for k in ("country", "phrase", "dist_km")} if geo.get("eligible") else None,
        "note": "Targets are what is in reach of a Shahed-136/Geran-2-class drone at public open-source "
                "figures — not a prediction of intent.",
    }


def score_snapshot(vessels: list[dict], watch, now: float, limit: int = 20) -> list[dict]:
    """Every Russia-linked vessel in an AIS snapshot, scored — GFW history
    is NOT fetched here (that is per vessel and slow); loitering hours come
    from the watch's live state. Blocking."""
    import russia_loiter_watch as rlw
    import coastal_targets as ct
    cfg = load_config()
    idx = ct.index(cfg)
    rindex = watch.index(now) if watch is not None else None
    out = []
    for v in vessels:
        try:
            lat, lon = float(v.get("lat")), float(v.get("lon", v.get("lng")))
        except (TypeError, ValueError):
            continue
        links = rlw.russia_links(v, rindex)
        if not links:
            continue
        mmsi = str(v.get("mmsi"))
        st = (watch.state.get(mmsi) if watch is not None else None) or {}
        hours = max(0.0, (float(st.get("last_t") or now) - st["start"]) / 3600.0) if st.get("start") else 0.0
        geo = watch.where(lat, lon) if watch is not None else {}
        try:
            speed = None if v.get("speed") is None else float(v["speed"])
        except (TypeError, ValueError):
            speed = None
        a = assess(links=links, hours=hours, speed=speed, dist_km=geo.get("dist_km"),
                   country_phrase=geo.get("phrase"), lat=lat, lon=lon, index=idx, cfg=cfg,
                   ais_gaps=watch.gaps.get(mmsi) if watch is not None else None, now=now)
        out.append({"mmsi": mmsi, "name": rlw._clean_name(v) or None, "lat": lat, "lon": lon, "speed": speed,
                    "hours_loitering": round(hours, 2), "off": geo.get("phrase") if geo.get("eligible") else None,
                    "not_eligible": None if geo.get("eligible") else geo.get("why"),
                    "dist_km": round(geo["dist_km"], 1) if geo.get("eligible") else None,
                    "links": [l["reason"] for l in links], "score": a["score"], "tier": a["tier_label"],
                    "severity_if_alerted": a["severity"], "in_range": a["in_range_count"],
                    "high_value": a["high_value_count"],
                    "top_target": (f"{a['targets'][0]['name']} {a['targets'][0]['distance_km']:.0f} km"
                                   if a["targets"] else None)})
    out.sort(key=lambda x: -x["score"])
    return out[:limit]
