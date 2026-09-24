"""
imminence.py — is something about to happen HERE, now?

DIFFERENT QUESTION FROM THE BOARD. The forecast board answers "does this
locale escalate beyond its own rate in three months". That is the right
horizon for planning and the wrong one for a notification: nobody is
interrupted by a quarter. This asks whether the last month looks like the
run-up to something, which is a claim about days.

WHY THE BAR IS DELIBERATELY BRUTAL. A false "attack imminent" at the top
of someone's notifications is the most expensive thing this system can
emit. It is acted on, it is remembered, and the next twenty true ones are
discounted because of it. So an alert requires ALL of:

    · the model already rates escalation high for the locale
    · the most recent month is far above the locale's own trailing rate
    · that surge is not just the locale being permanently busy — it is
      measured against its OWN twelve-month mean, not a global one

and it carries a falsifier, because a warning that cannot be wrong is
not a warning.

WHAT IT IS NOT. It is not a claim that an attack will occur on a date.
It is "this looks like a run-up", with the arithmetic shown, and the
reader decides.
"""
from __future__ import annotations
import sqlite3

import conflict_model as cm

#: The model's own escalation probability must already be this high.
MIN_P = 0.55

#: The latest month must be at least this many times the trailing mean.
MIN_SURGE = 2.5

#: ...and this many events in absolute terms, so a locale that normally
#: records one event a month cannot surge to three and trip a warning.
MIN_EVENTS = 12

#: A locale needs this much history for its own baseline to mean anything.
MIN_MONTHS = 18


def assess_locale(series: list, p: float) -> dict | None:
    """One locale-violence series, or None when nothing is imminent."""
    if len(series) < MIN_MONTHS or p is None or p < MIN_P:
        return None
    recent = series[-1]
    ev = int(recent.get("events") or 0)
    if ev < MIN_EVENTS:
        return None
    base = [int(s.get("events") or 0) for s in series[-13:-1]]
    if not base:
        return None
    mean = sum(base) / len(base)
    if mean <= 0:
        # Going from nothing to something is real, but a ratio against
        # zero is not a number — require the absolute floor to carry it.
        surge = float("inf") if ev >= MIN_EVENTS * 2 else 0.0
    else:
        surge = ev / mean
    if surge < MIN_SURGE:
        return None
    return {
        "events_last_month": ev,
        "baseline_monthly": round(mean, 1),
        "surge": round(surge, 2) if surge != float("inf") else None,
        "p": round(float(p), 3),
    }


def scan(panel: dict, fit: dict, *, limit: int = 8) -> list:
    """Every locale that currently looks like a run-up, worst first."""
    model = fit.get("model") if isinstance(fit, dict) else None
    if model is None or not panel:
        return []

    rows, keys = [], []
    for (country, violence), series in panel.items():
        if len(series) < cm.MIN_MONTHS + 1:
            continue
        f = cm.features_at(series, len(series) - 1)
        if f is None:
            continue
        rows.append([f[k] for k in cm.FEATURES])
        keys.append((country, violence, series))
    if not rows:
        return []

    probs = model.predict_proba(rows)[:, 1]
    out = []
    for (country, violence, series), p in zip(keys, probs):
        hit = assess_locale(series, float(p))
        if not hit:
            continue
        out.append({
            "country": country, "violence": violence, **hit,
            "headline": f"{country}: {violence} running {hit['surge'] or 'far'}x "
                        f"its own recent rate",
            "why": (f"{hit['events_last_month']} events last month against a "
                    f"{hit['baseline_monthly']}/month baseline, with the model "
                    f"rating escalation at {hit['p']:.0%}"),
            "falsifier": (f"Monthly {violence} events in {country} fall back to "
                          f"{max(1, round(hit['baseline_monthly'] * 1.5))} or "
                          f"below for two consecutive months."),
        })
    out.sort(key=lambda r: (-(r["surge"] or 99), -r["p"]))
    return out[:limit]


def publish(conn: sqlite3.Connection, fitted, write_alert, *, limit: int = 8) -> dict:
    """Write imminence warnings as critical alerts. Rare by construction."""
    try:
        built = fitted(conn)
        found = scan(built.get("panel") or {}, built.get("fit") or {}, limit=limit)
    except Exception as e:                                   # noqa: BLE001
        return {"ok": False, "error": str(e), "written": 0}

    written = 0
    for r in found:
        try:
            write_alert({
                "domain": "FORECAST",
                "source": "forecast",
                "alert_type": "imminence",
                # Critical on purpose: the whole point is that it reaches
                # the top of the tray. The bar above is what earns it.
                "severity": "critical",
                "title": r["headline"],
                "message": r["why"] + " — " + r["falsifier"],
                "confidence": r["p"],
                "relevance_score": 100,
                "country": r["country"],
            })
            written += 1
        except Exception:                                    # noqa: BLE001
            continue
    return {"ok": True, "written": written, "found": len(found)}
