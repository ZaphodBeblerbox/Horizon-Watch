"""
rhetoric_trend.py — noticing when the talking changes.

WHY. Through September 2026 Western leaders shifted markedly in how they
spoke about Russia and this system said nothing. Two reasons, and only the
first was a missing feed: the GDELT ingest discarded every verbal CAMEO code
before storage (fixed in gdelt_events.py), and nothing anywhere looked for a
CHANGE in tone.

The second is the harder one. Admitting rhetoric to the database does not by
itself produce a finding, because any given statement is unremarkable.
Ministers disapprove of things daily. What matters is that a pair of actors
who normally exchange 3 disapprovals a week are suddenly exchanging 30, or
that the tone of coverage between them has moved two standard deviations in
a fortnight. That is a question about a baseline, not about an event.

WHAT THIS DELIBERATELY DOES NOT DO. It does not judge whether the rhetoric is
justified, nor predict what follows. It reports that the pattern between two
actors has departed from its own recent norm, with the numbers that say so.
Escalation in words often precedes escalation in force, and often does not;
claiming otherwise from this data would be invention.
"""
from __future__ import annotations

import math
import statistics
from collections import defaultdict
from datetime import datetime, timedelta, timezone

# CAMEO root codes that are speech rather than action.
VERBAL_ROOT_CODES = {"10", "11", "12", "13", "16"}

# How far back the "normal" is measured, and what counts as recent.
BASELINE_DAYS = 28
RECENT_DAYS = 7

# A pair must have enough history for "normal" to mean anything. Below this
# the baseline is noise and any comparison against it is theatre.
MIN_BASELINE_EVENTS = 8

# How many standard deviations above its own baseline a pair must sit before
# it is worth reporting.
Z_THRESHOLD = 2.0


def _parse_day(value) -> datetime | None:
    """GDELT dates arrive as YYYYMMDD strings or ISO timestamps."""
    if not value:
        return None
    s = str(value)
    try:
        if len(s) == 8 and s.isdigit():
            return datetime(int(s[:4]), int(s[4:6]), int(s[6:8]), tzinfo=timezone.utc)
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def pair_key(ev: dict) -> tuple[str, str] | None:
    """Who is talking about whom.

    Keyed on country where GDELT resolved one, because "GERMANY -> RUSSIA" is
    a relationship that persists while the named minister does not.
    """
    a = (ev.get("actor1_country") or ev.get("actor1") or "").strip().upper()
    b = (ev.get("actor2_country") or ev.get("actor2") or "").strip().upper()
    if not a or not b or a == b:
        return None
    return (a, b)


def is_verbal(ev: dict) -> bool:
    return str(ev.get("event_root_code") or "").strip().zfill(2) in VERBAL_ROOT_CODES


def detect_shifts(events: list[dict], *, now: datetime | None = None,
                  baseline_days: int = BASELINE_DAYS,
                  recent_days: int = RECENT_DAYS,
                  z_threshold: float = Z_THRESHOLD) -> list[dict]:
    """Actor pairs whose rhetoric has departed from their own recent norm.

    Each pair is compared ONLY against itself. A global threshold would
    surface the loudest relationships in the world every single day —
    Israel/Palestine, India/Pakistan — and never the quiet pair that just got
    loud, which is the only interesting case.
    """
    now = now or datetime.now(timezone.utc)
    recent_cut = now - timedelta(days=recent_days)
    base_cut = now - timedelta(days=baseline_days)

    # daily counts and tones per pair
    per_pair_daily: dict[tuple, dict[str, list]] = defaultdict(
        lambda: defaultdict(list))
    for ev in events:
        if not is_verbal(ev):
            continue
        d = _parse_day(ev.get("date"))
        if d is None or d < base_cut:
            continue
        key = pair_key(ev)
        if key is None:
            continue
        per_pair_daily[key][d.strftime("%Y-%m-%d")].append(ev)

    out = []
    for key, by_day in per_pair_daily.items():
        recent_days_keys = [k for k in by_day
                            if _parse_day(k.replace("-", "")) >= recent_cut]
        base_days_keys = [k for k in by_day if k not in recent_days_keys]

        baseline_counts = [len(by_day[k]) for k in base_days_keys]
        recent_events = [e for k in recent_days_keys for e in by_day[k]]
        baseline_events = [e for k in base_days_keys for e in by_day[k]]

        if len(baseline_events) < MIN_BASELINE_EVENTS or not recent_events:
            # Not enough history to say what normal is. Saying nothing is
            # the honest output; a "shift" measured against two data points
            # is a coin flip with a decimal place.
            continue

        # Volume: how many verbal events a day, recent vs baseline.
        base_mean = statistics.mean(baseline_counts) if baseline_counts else 0.0
        base_sd = statistics.pstdev(baseline_counts) if len(baseline_counts) > 1 else 0.0
        recent_rate = len(recent_events) / max(1, recent_days)
        # A flat baseline has zero deviation, which would divide by zero and
        # call any change infinite. Poisson counting noise is the floor.
        sd = max(base_sd, math.sqrt(max(base_mean, 1.0)))
        z_volume = (recent_rate - base_mean) / sd if sd else 0.0

        # Tone: GDELT's own average tone of the coverage, recent vs baseline.
        def _tone(evs):
            vals = [float(e["avg_tone"]) for e in evs if e.get("avg_tone") is not None]
            return statistics.mean(vals) if vals else None

        base_tone, recent_tone = _tone(baseline_events), _tone(recent_events)
        tone_delta = (recent_tone - base_tone) if (base_tone is not None and recent_tone is not None) else None

        # Severity of the language: the most conflictual verbal code used.
        worst = min((float(e.get("goldstein") or 0.0) for e in recent_events),
                    default=0.0)

        if z_volume < z_threshold:
            continue

        a, b = key
        out.append({
            "actor_a": a, "actor_b": b,
            "recent_events": len(recent_events),
            "recent_per_day": round(recent_rate, 2),
            "baseline_per_day": round(base_mean, 2),
            "z_volume": round(z_volume, 2),
            "baseline_tone": round(base_tone, 2) if base_tone is not None else None,
            "recent_tone": round(recent_tone, 2) if recent_tone is not None else None,
            "tone_delta": round(tone_delta, 2) if tone_delta is not None else None,
            "worst_goldstein": worst,
            "codes": sorted({str(e.get("event_root_code")).zfill(2) for e in recent_events}),
            "headline": headline(a, b, recent_rate, base_mean, tone_delta),
        })

    out.sort(key=lambda r: -r["z_volume"])
    return out


_CODE_WORD = {
    "10": "demands", "11": "criticism", "12": "rejections",
    "13": "threats", "16": "moves to downgrade relations",
}


def headline(a: str, b: str, recent_rate: float, base_rate: float,
             tone_delta: float | None) -> str:
    """One sentence naming who, toward whom, and by how much.

    Never a bare z-score: the reader needs the relationship and the size of
    the change, not a statistic they have to interpret.
    """
    times = (recent_rate / base_rate) if base_rate > 0 else None
    scale = (f"{times:.1f}× its usual rate" if times and times >= 1.5
             else f"up from {base_rate:.1f} to {recent_rate:.1f} a day")
    line = f"{a} → {b}: hostile statements at {scale}"
    if tone_delta is not None and tone_delta < -1.0:
        line += f", and coverage {abs(tone_delta):.1f} points more negative"
    return line
