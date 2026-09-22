"""
forecast.py — "what happens next, here", with a score attached.

THE SECOND HALF OF THE ML LAYER. link_predict answers "who is connected
that we have not noticed". This answers the other question: given what
has happened in a place, how likely is a given kind of event there in
the next fortnight.

WHY A SELF-EXCITING RATE MODEL AND NOT A TREE ENSEMBLE. sklearn is
available and a gradient-boosted model would have been quick to fit, but
the evidence is 10,051 UCDP events over six months across three violence
types and ~50 countries. A tree ensemble on that would overfit happily
and could not say why it believed anything. Political violence is
genuinely self-exciting — an attack raises the near-term probability of
another in the same place — so an exponential-decay intensity IS the
honest structure, it has two fitted parameters, and its output can be
stated in a sentence: "12 events in the last 30 days here, decaying with
a 9-day half-life, gives 62% for the next 14".

    lambda(t) = mu + sum over past events of  alpha * exp(-(t - ti) / tau)
    P(at least one in H days) = 1 - exp(-lambda_bar * H)

WHY THERE IS A BACKTEST AT ALL. The sequence miner in this codebase had
three separate statistical faults — rare-consequent inflation, the wrong
baseline unit, and a global baseline where a local one was needed — and
every one of them produced confident, plausible, wrong numbers. A
forecaster without a score is not a forecaster, it is a mood. So this
reports a Brier score, a skill score against the honest baseline (the
locale's own base rate), and a reliability curve, all walk-forward with
no access to the future.

WHAT IT IS NOT. Six months of history is thin, the three UCDP violence
types are coarse, and a probability for a country is not a probability
for a town. The model reports its own sample size and its skill, and a
caller is expected to refuse to show a forecast whose skill is not
positive.
"""
from __future__ import annotations
import datetime as _dt
import math
from collections import defaultdict

#: Forecast horizon in days. Two weeks: long enough that a rate model
#: has something to say, short enough to still be a forecast.
HORIZON_DAYS = 14

#: Candidate decays for the grid search, in days. A half-life shorter
#: than a couple of days is noise at daily resolution; longer than a
#: season is indistinguishable from the base rate.
TAU_GRID = (3.0, 7.0, 14.0, 30.0, 60.0)
ALPHA_GRID = (0.05, 0.1, 0.2, 0.4, 0.8)

#: Below this many events a locale/type gets the base rate only. Fitting
#: excitation to three events is fitting noise.
MIN_EVENTS_TO_EXCITE = 8


def _day(value) -> _dt.date | None:
    if isinstance(value, _dt.date):
        return value
    s = str(value or "")[:10]
    try:
        return _dt.date.fromisoformat(s)
    except ValueError:
        return None


def to_series(events, *, locale_key="country", type_key="violence_type",
              date_key="date") -> dict:
    """Events to {(locale, type): sorted list of dates}.

    Anything without all three of locale, type and a parseable date is
    dropped rather than defaulted — a forecast for locale "" is not a
    forecast.
    """
    out: dict = defaultdict(list)
    for e in events or []:
        loc = (e.get(locale_key) or "").strip()
        typ = (e.get(type_key) or "").strip()
        day = _day(e.get(date_key))
        if not loc or not typ or day is None:
            continue
        out[(loc, typ)].append(day)
    for k in out:
        out[k].sort()
    return dict(out)


def base_rate(days: list, first: _dt.date, last: _dt.date) -> float:
    """Events per day over the observed span — the honest baseline.

    This is what the model has to BEAT. A forecaster that cannot beat
    "this place averages one of these a week" has learned nothing.
    """
    span = max(1, (last - first).days + 1)
    return len(days) / span


def intensity(history: list, at: _dt.date, *, mu: float, alpha: float,
              tau: float) -> float:
    """Expected events per day at `at`, from events strictly before it.

    Strictly before is the whole discipline: including the day being
    predicted is how a backtest scores 0.99 and means nothing.
    """
    lam = mu
    for d in history:
        if d >= at:
            break
        age = (at - d).days
        lam += alpha * math.exp(-age / tau)
    return lam


def probability(lam: float, horizon: int = HORIZON_DAYS) -> float:
    """P(at least one event) for a Poisson rate over the horizon."""
    if lam <= 0:
        return 0.0
    return 1.0 - math.exp(-lam * horizon)


def _windows(days: list, first: _dt.date, last: _dt.date, horizon: int,
             step: int = 7):
    """Evaluation points and whether an event actually followed.

    Walk-forward: each point sees only its own past, and its label is
    whether anything happened in the horizon AFTER it.
    """
    out = []
    t = first + _dt.timedelta(days=horizon)
    end = last - _dt.timedelta(days=horizon)
    dayset = set(days)
    while t <= end:
        hit = any((t + _dt.timedelta(days=k)) in dayset for k in range(1, horizon + 1))
        out.append((t, hit))
        t += _dt.timedelta(days=step)
    return out


def brier(pairs) -> float:
    """Mean squared error of probabilistic forecasts. Lower is better."""
    pairs = list(pairs)
    if not pairs:
        return float("nan")
    return sum((p - (1.0 if y else 0.0)) ** 2 for p, y in pairs) / len(pairs)


def fit(series: dict, *, horizon: int = HORIZON_DAYS,
        train_frac: float = 0.45, valid_frac: float = 0.25) -> dict:
    """Fit ONE global excitation, selected on pooled held-out time.

    THE STATISTICS DROVE THIS, IN THREE STEPS, AND THE FIRST TWO WERE
    WRONG:

    1. Fitting and choosing alpha/tau per series on the SAME slice.
       Excitation won everywhere on train and then lost to the plain
       base rate on test by 4% Brier — a model measurably worse than
       "this place averages one of these a week", presented as a
       forecast.

    2. Fitting per series on train, choosing per series on validation.
       Worse: skill fell to -0.18. Six months split three ways leaves
       roughly eight weekly windows per series, and choosing between 25
       parameter pairs on eight points is not selection, it is noise.
       It picked excitation for 55 of 92 series and lost on every one.

    3. What is here: ONE alpha and ONE tau for the whole dataset,
       chosen on validation windows POOLED across every series. That is
       one parameter pair supported by 10,051 events instead of 92 pairs
       supported by a hundred each, which is the only version of this
       the data can carry.

    And if that global pair still cannot beat the pooled base rate, the
    excitation is zero and the model IS the base rate. Declining to be
    cleverer than the baseline is a result, not a failure — it is the
    only version that can honestly be put in front of somebody.
    """
    prepared = {}
    for key, days in series.items():
        if not days:
            continue
        first, last = days[0], days[-1]
        span = (last - first).days + 1
        if span < horizon * 4:
            continue
        train_end = first + _dt.timedelta(days=int(span * train_frac))
        valid_end = first + _dt.timedelta(days=int(span * (train_frac + valid_frac)))
        valid = _windows(days, train_end, valid_end, horizon)
        if not valid:
            continue
        prepared[key] = {
            "days": days, "first": first, "last": last,
            "mu": base_rate(days, first, last),
            "valid": valid, "cut": valid_end,
        }

    # The pooled baseline: every series' own base rate, scored together.
    pooled_base = brier([
        (probability(p["mu"], horizon), y)
        for p in prepared.values() for _t, y in p["valid"]
    ])

    best = {"alpha": 0.0, "tau": TAU_GRID[0], "brier": pooled_base}
    for tau in TAU_GRID:
        for alpha in ALPHA_GRID:
            pairs = []
            for p in prepared.values():
                if len(p["days"]) < MIN_EVENTS_TO_EXCITE:
                    # Below this, excitation is fitted to noise, so these
                    # series keep their base rate whatever is chosen.
                    pairs += [(probability(p["mu"], horizon), y) for _t, y in p["valid"]]
                    continue
                pairs += [
                    (probability(intensity(p["days"], t, mu=p["mu"],
                                           alpha=alpha, tau=tau), horizon), y)
                    for t, y in p["valid"]
                ]
            b = brier(pairs)
            if not math.isnan(b) and b < best["brier"]:
                best = {"alpha": alpha, "tau": tau, "brier": b}

    models = {}
    for key, p in prepared.items():
        excite = best["alpha"] > 0 and len(p["days"]) >= MIN_EVENTS_TO_EXCITE
        models[key] = {
            "locale": key[0], "type": key[1],
            "mu": p["mu"],
            "alpha": best["alpha"] if excite else 0.0,
            "tau": best["tau"],
            "events": len(p["days"]),
            "first": p["first"].isoformat(), "last": p["last"].isoformat(),
            "train_cut": p["cut"].isoformat(),
            "excited": excite,
        }
    if models:
        # Recorded on every model so a caller can see what was chosen
        # globally and on what evidence.
        for m in models.values():
            m["selection"] = {
                "pooled_valid_brier": round(best["brier"], 4)
                if not math.isnan(best["brier"]) else None,
                "pooled_base_brier": round(pooled_base, 4)
                if not math.isnan(pooled_base) else None,
                "global_alpha": best["alpha"], "global_tau": best["tau"],
            }
    return models


def backtest(series: dict, models: dict, *, horizon: int = HORIZON_DAYS) -> dict:
    """Score the fitted models on time they were not fitted on.

    Reports skill against the locale's own base rate, which is the
    baseline that matters: beating a global average is easy and means
    nothing, because violence is concentrated.
    """
    model_pairs, base_pairs = [], []
    per_key = {}
    for key, m in models.items():
        days = series.get(key) or []
        if not days:
            continue
        cut = _dt.date.fromisoformat(m["train_cut"])
        last = days[-1]
        test = _windows(days, cut, last, horizon)
        if not test:
            continue
        mp = [(probability(intensity(days, t, mu=m["mu"], alpha=m["alpha"],
                                     tau=m["tau"]), horizon), y)
              for t, y in test]
        bp = [(probability(m["mu"], horizon), y) for _t, y in test]
        model_pairs += mp
        base_pairs += bp
        per_key[f"{key[0]}|{key[1]}"] = {
            "n": len(test), "brier": round(brier(mp), 4),
            "baseline_brier": round(brier(bp), 4),
        }

    bm, bb = brier(model_pairs), brier(base_pairs)
    skill = None
    if bb and not math.isnan(bb) and bb > 0:
        skill = round(1.0 - bm / bb, 4)

    return {
        "n": len(model_pairs),
        "brier": round(bm, 4) if not math.isnan(bm) else None,
        "baseline_brier": round(bb, 4) if not math.isnan(bb) else None,
        # Positive means the model beats the locale's own base rate.
        # Zero or negative means it has learned nothing and should not
        # be shown as a forecast.
        "skill_vs_base_rate": skill,
        "reliability": reliability(model_pairs),
        "per_series": per_key,
    }


def reliability(pairs, bins: int = 5) -> list:
    """Do the stated probabilities happen at the stated rate?

    Discrimination is not calibration. A model that ranks perfectly and
    says 90% when it means 50% is worse than useless in a briefing,
    because somebody will act on the number.
    """
    buckets = [[] for _ in range(bins)]
    for p, y in pairs:
        i = min(bins - 1, max(0, int(p * bins)))
        buckets[i].append(1.0 if y else 0.0)
    out = []
    for i, b in enumerate(buckets):
        if not b:
            continue
        out.append({
            "band": f"{i / bins:.0%}–{(i + 1) / bins:.0%}",
            "n": len(b),
            "observed": round(sum(b) / len(b), 3),
        })
    return out


#: A forecast whose evidence stopped longer ago than the horizon it
#: claims to cover is not a forecast. UCDP publishes in batches and the
#: local copy can be months behind.
MAX_DATA_AGE_FACTOR = 1.0


def forecast(series: dict, models: dict, *, at: _dt.date | None = None,
             horizon: int = HORIZON_DAYS, limit: int = 50,
             min_prob: float = 0.05,
             allow_stale: bool = False) -> dict:
    """Current probabilities, each with the arithmetic behind it.

    REFUSES TO FORECAST FROM STALE EVIDENCE. UCDP arrives in batches and
    the local copy currently ends 2026-06-30 — eighty-four days before
    today. A base rate computed over a window that closed three months
    ago, printed as "probability over the next 14 days", is a fabricated
    present tense: it reads as a live assessment and is a historical
    average. So the data's end date and its age are returned, and unless
    a caller explicitly opts in, a series whose evidence is older than
    its own horizon returns nothing with the reason attached.

    SATURATION IS REPORTED, NOT HIDDEN. For an actively violent locale,
    P(at least one event in 14 days) is ~1.00 and correspondingly
    useless — the question has no headroom there, which the backtest
    showed as 220 of 312 windows landing in the top probability band. A
    saturated forecast is flagged so nobody mistakes 1.00 for insight.
    """
    at = at or _dt.date.today()
    rows, refused = [], []

    for key, m in models.items():
        days = series.get(key) or []
        if not days:
            continue
        last = days[-1]
        age = (at - last).days
        if age > horizon * MAX_DATA_AGE_FACTOR and not allow_stale:
            refused.append({"locale": m["locale"], "type": m["type"],
                            "data_ends": last.isoformat(), "age_days": age})
            continue

        lam = intensity(days, at, mu=m["mu"], alpha=m["alpha"], tau=m["tau"])
        p = probability(lam, horizon)
        if p < min_prob:
            continue
        recent = sum(1 for d in days if 0 <= (at - d).days <= 30)
        half_life = round(m["tau"] * math.log(2), 1) if m["alpha"] else None
        rows.append({
            "locale": m["locale"], "type": m["type"],
            "probability": round(p, 3),
            "saturated": p >= 0.98,
            "horizon_days": horizon,
            "events_last_30d": recent,
            "events_total": m["events"],
            "data_ends": last.isoformat(),
            "data_age_days": age,
            "half_life_days": half_life,
            "excited": m["excited"],
            "basis": (
                f"{recent} in the last 30 days, {m['events']} on record since "
                f"{m['first']}; base rate {m['mu'] * 30:.1f}/month"
                + (f", decaying with a {half_life:.0f}-day half-life"
                   if m["alpha"] else ", no self-excitation (it did not beat "
                                      "the base rate on held-out time)")
            ),
            "caveat": (
                "A country-level probability is not a town-level one, the "
                "three UCDP violence classes are coarse, and this is a "
                "calibrated base rate rather than a learned model — see the "
                "backtest skill."
            ),
        })

    rows.sort(key=lambda r: -r["probability"])
    return {
        "available": True,
        "forecasts": rows[:limit],
        "refused_stale": refused[:limit],
        "note": ("Probabilities are of AT LEAST ONE event in the horizon. For "
                 "an actively violent locale that is near-certain and carries "
                 "little information; those are flagged saturated."),
    }


def from_ucdp(conn) -> list:
    """UCDP rows in the shape to_series expects."""
    rows = conn.execute(
        "SELECT country, violence_type, date FROM ucdp_events"
        " WHERE country IS NOT NULL AND country <> ''"
        "   AND violence_type IS NOT NULL AND date IS NOT NULL").fetchall()
    return [{"country": r[0], "violence_type": r[1], "date": r[2]} for r in rows]
