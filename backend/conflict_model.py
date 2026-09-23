"""
conflict_model.py — a conflict forecaster that can be scored.

WHAT IT PREDICTS, AND WHY NOT THE OBVIOUS THING. The obvious target is
"will there be a conflict event in this country in the next N days".
Measured on this system's own data, that target SATURATES: 220 of 312
backtest windows landed in the top probability band, because for any
actively violent country the answer is always yes. A forecaster with no
headroom cannot be skilful no matter how it is built.

So the target is ESCALATION: more violence in the coming window than the
locale has been running at. That is a question with two real answers,
it is the question an analyst actually has, and it is falsifiable
against the locale's own recent history rather than against zero.

FEATURES COME ONLY FROM THE PAST. Every feature for month t is computed
from months <= t, and the split is by TIME, never at random. A random
split lets the model see next year while predicting last year, which is
the easiest way there is to produce a beautiful score and a useless
model. This is the same discipline the earlier base-rate forecaster
needed, and it is the reason this one can be believed.

IT IS ALLOWED TO FAIL. If the fitted model cannot beat the base rate on
held-out time, `train()` says so and the caller is expected to refuse to
show it. An unskilled forecast presented as a forecast is worse than no
forecast: it launders a guess into a number.
"""
from __future__ import annotations
import math
from collections import defaultdict

#: Forecast horizon in months. Three matches the spec's 90-day board and
#: is long enough that a monthly series has something to say.
HORIZON_M = 3

#: Trailing window the baseline is measured over. Twelve months absorbs
#: a fighting season, which a shorter window mistakes for a trend.
BASELINE_M = 12

#: A locale needs this many months of history before it is modelled at
#: all. Below it, the baseline is noise and so is anything built on it.
MIN_MONTHS = 24

FEATURES = (
    "ev_1", "ev_3", "ev_6", "ev_12",
    "de_1", "de_3", "de_12",
    "trend_3", "ratio_3_12",
    "months_since", "mean_12", "std_12", "active_12",
)


def month_index(ym: str) -> int:
    """'2019-06' -> a comparable integer, so month arithmetic is trivial."""
    y, m = ym.split("-")
    return int(y) * 12 + int(m) - 1


def month_label(i: int) -> str:
    """The inverse of month_index: 24319 -> '2026-08'.

    The board reported the raw index as its as-of date, which reads as a
    serial number rather than a month. The whole purpose of that field is
    to tell a reader how current the forecast is, so an unreadable one
    was worse than none.
    """
    return f"{i // 12:04d}-{i % 12 + 1:02d}"


def to_panel(rows) -> dict:
    """UCDP monthly aggregates to a dense per-locale monthly panel.

    Dense matters: a month with no events is a REAL zero and the most
    informative observation there is. Left sparse, "quiet" and "not
    recorded" become the same thing.
    """
    by_key: dict = defaultdict(dict)
    for country, violence, ym, events, deaths in rows:
        if not ym or len(ym) != 7:
            continue
        by_key[(country, violence)][month_index(ym)] = (int(events or 0), int(deaths or 0))

    panel = {}
    for key, months in by_key.items():
        lo, hi = min(months), max(months)
        series = []
        for i in range(lo, hi + 1):
            ev, de = months.get(i, (0, 0))
            series.append({"m": i, "events": ev, "deaths": de})
        panel[key] = series
    return panel


def _window(series, end_i, n):
    """Events and deaths over the n months ending at index end_i inclusive."""
    lo = end_i - n + 1
    ev = de = 0
    for row in series:
        if lo <= row["m"] <= end_i:
            ev += row["events"]
            de += row["deaths"]
    return ev, de


def features_at(series, i_pos) -> dict | None:
    """Features for the month at position `i_pos`, using only months <= it."""
    if i_pos < MIN_MONTHS:
        return None
    end = series[i_pos]["m"]
    ev1, de1 = _window(series, end, 1)
    ev3, de3 = _window(series, end, 3)
    ev6, _ = _window(series, end, 6)
    ev12, de12 = _window(series, end, 12)
    prev3, _ = _window(series, end - 3, 3)

    past = [r["events"] for r in series[:i_pos + 1]][-BASELINE_M:]
    mean12 = sum(past) / len(past) if past else 0.0
    var = sum((x - mean12) ** 2 for x in past) / len(past) if past else 0.0
    active = sum(1 for x in past if x > 0)

    since = 0
    for r in reversed(series[:i_pos + 1]):
        if r["events"] > 0:
            break
        since += 1

    return {
        "ev_1": ev1, "ev_3": ev3, "ev_6": ev6, "ev_12": ev12,
        "de_1": de1, "de_3": de3, "de_12": de12,
        "trend_3": ev3 - prev3,
        "ratio_3_12": (ev3 / (ev12 / 4.0)) if ev12 else 0.0,
        "months_since": since,
        "mean_12": mean12, "std_12": math.sqrt(var), "active_12": active,
    }


def label_at(series, i_pos, horizon=HORIZON_M) -> int | None:
    """1 if the next `horizon` months exceed the trailing baseline.

    The comparison is against the locale's OWN recent rate, which is
    what makes this a question about change rather than about whether a
    war is ongoing.
    """
    if i_pos + horizon >= len(series):
        return None
    past = [r["events"] for r in series[:i_pos + 1]][-BASELINE_M:]
    if not past:
        return None
    baseline = sum(past) / len(past) * horizon
    future = sum(r["events"] for r in series[i_pos + 1:i_pos + 1 + horizon])
    return 1 if future > baseline else 0


def build_dataset(panel: dict, horizon=HORIZON_M) -> tuple:
    """(X, y, meta) over every locale-month that has past and future."""
    X, y, meta = [], [], []
    for (country, violence), series in panel.items():
        if len(series) < MIN_MONTHS + horizon + 1:
            continue
        for i_pos in range(MIN_MONTHS, len(series) - horizon):
            f = features_at(series, i_pos)
            lab = label_at(series, i_pos, horizon)
            if f is None or lab is None:
                continue
            X.append([f[k] for k in FEATURES])
            y.append(lab)
            meta.append({"country": country, "violence": violence,
                         "m": series[i_pos]["m"]})
    return X, y, meta


def temporal_split(meta, frac=0.75) -> tuple:
    """Index sets split by calendar month, never at random.

    Every training row precedes every test row. A random split lets the
    model see 2024 while predicting 2019.
    """
    if not meta:
        return [], []
    months = sorted({m["m"] for m in meta})
    cut = months[int(len(months) * frac)] if len(months) > 1 else months[0]
    train = [i for i, m in enumerate(meta) if m["m"] < cut]
    test = [i for i, m in enumerate(meta) if m["m"] >= cut]
    return train, test


def brier(pairs) -> float:
    pairs = list(pairs)
    if not pairs:
        return float("nan")
    return sum((p - y) ** 2 for p, y in pairs) / len(pairs)


def reliability(pairs, bins: int = 5) -> list:
    buckets = [[] for _ in range(bins)]
    for p, y in pairs:
        buckets[min(bins - 1, max(0, int(p * bins)))].append(y)
    out = []
    for i, b in enumerate(buckets):
        if b:
            out.append({"band": f"{i / bins:.0%}-{(i + 1) / bins:.0%}",
                        "n": len(b), "observed": round(sum(b) / len(b), 3)})
    return out


def train(panel: dict, *, horizon=HORIZON_M, frac=0.75) -> dict:
    """Fit, score on held-out time, and report honestly.

    The baseline it must beat is the TRAINING-SET base rate of
    escalation — the honest "how often does this happen at all" answer,
    predicted constantly. Beating a global average is easy; beating the
    actual frequency of the thing is the test.
    """
    X, y, meta = build_dataset(panel, horizon)
    if len(X) < 500:
        return {"available": False, "reason": f"only {len(X)} training rows"}

    tr, te = temporal_split(meta, frac)
    if not tr or not te:
        return {"available": False, "reason": "no temporal split possible"}

    try:
        from sklearn.ensemble import HistGradientBoostingClassifier
    except ImportError:
        return {"available": False, "reason": "scikit-learn not installed"}

    Xtr = [X[i] for i in tr]
    ytr = [y[i] for i in tr]
    Xte = [X[i] for i in te]
    yte = [y[i] for i in te]

    clf = HistGradientBoostingClassifier(
        max_depth=4, max_iter=200, learning_rate=0.06,
        l2_regularization=1.0, random_state=0)
    clf.fit(Xtr, ytr)
    probs = [float(p) for p in clf.predict_proba(Xte)[:, 1]]

    base = sum(ytr) / len(ytr)
    model_pairs = list(zip(probs, yte))
    base_pairs = [(base, v) for v in yte]
    bm, bb = brier(model_pairs), brier(base_pairs)
    skill = round(1 - bm / bb, 4) if bb else None

    return {
        "available": True,
        "model": clf,
        "features": list(FEATURES),
        "horizon_months": horizon,
        "n_train": len(tr), "n_test": len(te),
        "base_rate": round(base, 4),
        "brier": round(bm, 4),
        "baseline_brier": round(bb, 4),
        # Positive means it beat the base rate on time it had not seen.
        # Zero or below means it learned nothing and must not be shown.
        "skill": skill,
        "skilful": bool(skill is not None and skill > 0.01),
        "reliability": reliability(model_pairs),
    }


def predict_latest(panel: dict, fitted: dict, *, limit: int = 100,
                   horizon=HORIZON_M) -> list:
    """Current escalation probability per locale, with its own arithmetic."""
    if not fitted.get("available") or not fitted.get("model"):
        return []
    clf = fitted["model"]
    rows, keys = [], []
    for (country, violence), series in panel.items():
        if len(series) < MIN_MONTHS + 1:
            continue
        f = features_at(series, len(series) - 1)
        if f is None:
            continue
        rows.append([f[k] for k in FEATURES])
        keys.append((country, violence, series, f))
    if not rows:
        return []

    probs = clf.predict_proba(rows)[:, 1]
    out = []
    for (country, violence, series, f), p in zip(keys, probs):
        recent = f["ev_3"]
        baseline = f["mean_12"] * horizon
        out.append({
            "country": country, "violence": violence,
            "probability": round(float(p), 3),
            "horizon_months": horizon,
            "events_last_3m": int(recent),
            "baseline_3m": round(baseline, 1),
            "months_since_last": int(f["months_since"]),
            "basis": (f"{int(recent)} events in the last 3 months against a "
                      f"12-month baseline of {baseline:.1f} per 3 months"),
        })
    out.sort(key=lambda r: -r["probability"])
    return out[:limit]
