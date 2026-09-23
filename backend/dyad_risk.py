"""
dyad_risk.py — how likely is it that A attacks B at all?

WHY THIS EXISTS. A scenario builder that will animate any pairing must
say what the pairing is worth. Without it, "Russia attacks Estonia" and
"Russia attacks Burundi" render with identical confidence, and the second
one makes the first one worthless.

EVERY NUMBER HERE IS MEASURED FROM THE CORPUS, not chosen. Interstate
dyads are extracted from UCDP's own actor names — both sides matching
"Government of X" — over 1989-2026:

    base rate of interstate fighting     0.0384% per dyad-year
                                         (112 dyad-years of fighting out
                                          of 291,375 possible)
    contiguity                           90% of dyads that fought share a
                                         border, against 2.3% of random
                                         pairs -> about 39x
    having fought before                 P(fight next year | fought this
                                         year) = 0.589, and it decays
                                         slowly: 0.61 at two years, 0.49
                                         at three, 0.46 at five, 0.40 at
                                         ten

That last row is the important one and it is not intuition: interstate
conflict is STICKY. A dyad with history is not slightly more likely to
fight again, it is three orders of magnitude more likely, and the decay
over a decade is shallow.

WHAT THIS IS NOT. It is not a prediction that an attack will happen on a
date. It is the prior for a pairing — the answer to "is this scenario
worth drawing at all" — and it is deliberately coarse, because the data
supports a coarse answer. Anything finer would be a precision the 112
observed dyad-years cannot carry.
"""
from __future__ import annotations
import re
import sqlite3

#: Measured. See the module docstring for the derivation of each.
BASE_ANNUAL = 0.000384
CONTIGUITY_LIFT = 39.0

#: P(fighting in a year | last fought N years ago), measured directly.
#: Interpolated between these, flat after the last.
RECURRENCE = [(1, 0.63), (2, 0.61), (3, 0.49), (5, 0.46), (10, 0.40)]

#: A tension signal can move the prior, but only within reason: our risk
#: index is a nowcast of unrest, not a measure of interstate intent, and
#: letting it dominate would turn a busy news week into an invasion
#: warning.
TENSION_MAX_LIFT = 4.0

#: Nothing is ever certain here, and nothing is ever zero. A pairing with
#: no border and no history is not impossible — it is Iran/Israel, which
#: is one of the 23 dyads that actually fought.
#:
#: The floor must sit BELOW the measured base rate. It was 0.0005 against
#: a base of 0.000384, so the floor silently overrode the measurement and
#: every unfought, non-contiguous pairing was quietly marked up by a
#: third — which is exactly the kind of invisible thumb on the scale this
#: module exists to avoid.
P_FLOOR, P_CEILING = 0.00005, 0.85

_GOV = re.compile(r"^Government of (.+)$")


def _sides(dyad: str):
    """Both sides as government lists, or None when it is not interstate."""
    parts = [p.strip() for p in (dyad or "").split(" - ")]
    if len(parts) != 2:
        return None
    out = []
    for p in parts:
        subs = [s.strip() for s in p.split(",")]
        matches = [_GOV.match(s) for s in subs]
        if not all(matches):
            return None
        out.append([m.group(1) for m in matches])
    return out


def interstate_years(conn: sqlite3.Connection) -> dict:
    """{(a, b): {years}} for every interstate dyad in the corpus."""
    try:
        rows = conn.execute(
            "SELECT dyad, substr(date,1,4) FROM ucdp_history"
            " WHERE violence='state-based conflict' AND dyad IS NOT NULL"
            " GROUP BY 1,2").fetchall()
    except sqlite3.Error:
        return {}
    out: dict = {}
    for dyad, year in rows:
        g = _sides(dyad)
        if not g:
            continue
        try:
            y = int(year)
        except (TypeError, ValueError):
            continue
        for a in g[0]:
            for b in g[1]:
                if a == b:
                    continue
                out.setdefault(tuple(sorted((a, b))), set()).add(y)
    return out


def _recurrence(gap_years: int) -> float:
    if gap_years <= RECURRENCE[0][0]:
        return RECURRENCE[0][1]
    for i in range(1, len(RECURRENCE)):
        g0, p0 = RECURRENCE[i - 1]
        g1, p1 = RECURRENCE[i]
        if gap_years <= g1:
            f = (gap_years - g0) / (g1 - g0)
            return p0 + (p1 - p0) * f
    return RECURRENCE[-1][1]


def annual_probability(*, contiguous: bool, years_since_conflict: int | None,
                       tension: float = 0.0) -> dict:
    """P(interstate fighting in this dyad in a year), and why.

    `tension` is 0..1, normalised by the caller from whatever nowcast it
    has. It multiplies, it does not decide.
    """
    reasons = []
    if years_since_conflict is not None:
        p = _recurrence(max(1, years_since_conflict))
        reasons.append(f"fought {years_since_conflict}y ago; dyads that have fought "
                       f"recur at {p:.0%} a year")
    else:
        p = BASE_ANNUAL
        reasons.append(f"no interstate fighting on record; base rate {BASE_ANNUAL:.4%}")
        if contiguous:
            p *= CONTIGUITY_LIFT
            reasons.append(f"share a border (x{CONTIGUITY_LIFT:.0f}: 90% of dyads that "
                           f"fought are contiguous, against 2.3% of all pairs)")
        else:
            reasons.append("no shared border")

    t = max(0.0, min(1.0, float(tension or 0.0)))
    if t > 0:
        lift = 1.0 + t * (TENSION_MAX_LIFT - 1.0)
        p *= lift
        reasons.append(f"current tension x{lift:.1f}")

    p = max(P_FLOOR, min(P_CEILING, p))
    return {"annual": p, "why": reasons}


def over_months(annual: float, months: int) -> float:
    """Annual probability converted to a shorter window."""
    a = max(0.0, min(1.0, float(annual or 0.0)))
    return 1.0 - (1.0 - a) ** (max(1, months) / 12.0)


def assess(conn: sqlite3.Connection, a: str, b: str, *, contiguous: bool,
           tension: float = 0.0, months: int = 3, now_year: int | None = None) -> dict:
    """The prior for a pairing, with its reasoning."""
    import datetime as _dt
    now_year = now_year or _dt.date.today().year
    hist = interstate_years(conn)
    years = hist.get(tuple(sorted((a or "", b or ""))))
    since = (now_year - max(years)) if years else None
    out = annual_probability(contiguous=contiguous, years_since_conflict=since,
                             tension=tension)
    out["p"] = over_months(out["annual"], months)
    out["months"] = months
    out["a"], out["b"] = a, b
    out["ever_fought"] = bool(years)
    out["last_year"] = max(years) if years else None
    return out
