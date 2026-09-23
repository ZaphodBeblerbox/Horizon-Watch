"""
forecast_board.py — scenario boards, built from a scored model.

THE SPEC'S FOUR RULES (addendum F1) ARE THE SPECIFICATION; this is where
they are enforced rather than described:

  1. The set must include "none of these"  -> residual, COMPUTED
  2. A probability without a base rate is a mood -> every scenario
     carries a base rate measured over 37 years of history
  3. A forecast must be falsifiable before it resolves -> indicators and
     a stated falsifier on every scenario
  4. The model shows its own record -> Brier and calibration from
     resolutions, and it reports n=0 honestly until there are some

WHAT THE MODEL CAN AND CANNOT SAY. The spec's example boards name
outcomes like "Ground incursion across the Narva river" at 7%. No model
produces that: there is no labelled history of that event, and inventing
a number for it would be exactly the laundering rule 1 exists to stop.
What conflict_model does produce, with measured skill of 0.178 against
the base rate, is the probability that a locale ESCALATES beyond its own
recent rate. So model scenarios are escalations, and narrative scenarios
are authored by analysts and scored separately — which is the separation
the spec already requires in F7.

THE RESIDUAL IS THE POINT. Three named scenarios summing to 100% is a
lie, and a board that cannot say "something nobody listed" trains people
to pick from a menu. Here the residual is usually the largest row, and
that is the correct reading of the evidence rather than a failure of the
model.
"""
from __future__ import annotations
import hashlib
import json
import sqlite3
import threading
import time

import conflict_model as cm
import ucdp_history as uh
import ucdp_candidate as uc

#: Fitting takes ~11s over 65,000 rows. It must never happen on a
#: request — see tonight's notification endpoint, which recomputed a
#: whole-world index per call. Build-then-swap, single flight, and a TTL
#: longer than any warmer's interval.
_FIT_TTL_S = 21600           # 6h; the corpus changes monthly at most
_fit_cache: dict = {}
_fit_lock = threading.Lock()

#: A locale needs this much recent activity to be worth a board. Below
#: it the model is extrapolating from silence.
MIN_RECENT_EVENTS = 3

#: The doctrinal templates the console can actually draw. Declared
#: here so an unknown key is refused at the door rather than
#: rendering an empty frame, which reads as 'no doctrine' instead of
#: 'typo'. Kept in step with src/destinations/forecastTemplate.js.
TEMPLATES = ("incursion", "hybrid", "demo", "reroute", "strike", "reprisal")

#: Which doctrine illustrates which kind of violence.
#:
#: This is NOT the model predicting a movement. The model produces a
#: probability from counts and knows nothing about axes of advance. What
#: it does know is the KIND of violence it is forecasting, and each kind
#: has a shape in doctrine — that shape is a fact about the category, not
#: a claim about this country. Drawing it lets a reader ask "would that
#: even be possible here", which is the question the terrain face exists
#: to answer, and the stamp on every frame says the rest.
VIOLENCE_TEMPLATE = {
    "state-based conflict": "incursion",
    "non-state conflict": "hybrid",
    "one-sided violence against civilians": "reprisal",
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS forecast_proposals (
    id          TEXT PRIMARY KEY,
    board       TEXT NOT NULL,
    label       TEXT NOT NULL,
    p           REAL NOT NULL,
    window      TEXT,
    indicators  TEXT,          -- JSON list of observables
    falsifier   TEXT,
    author      TEXT,
    created_at  TEXT NOT NULL,
    template    TEXT           -- doctrinal template key, or NULL
);
CREATE TABLE IF NOT EXISTS forecast_resolutions (
    scenario_id TEXT PRIMARY KEY,
    board       TEXT NOT NULL,
    p           REAL NOT NULL,   -- what was claimed, frozen at resolution
    origin      TEXT NOT NULL,   -- 'model' | 'analyst'
    outcome     INTEGER NOT NULL,-- 1 happened, 0 did not
    resolved_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_fcres_board ON forecast_resolutions(board);
"""


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    # The column arrived after the table shipped; CREATE TABLE IF NOT
    # EXISTS silently leaves an existing table alone, so the ALTER is
    # the only thing that reaches a deployed database.
    cols = {r[1] for r in conn.execute("PRAGMA table_info(forecast_proposals)")}
    if "template" not in cols:
        conn.execute("ALTER TABLE forecast_proposals ADD COLUMN template TEXT")
    conn.commit()


# ── The fitted model, cached ──────────────────────────────────────────

def _panel(conn: sqlite3.Connection) -> dict:
    """The panel the model is TRAINED on: revised GED only.

    Candidate rows are deliberately absent. Revision removes about a
    third of one-sided violence, so a corpus with a candidate tail would
    teach the model that the right-hand edge of every series is busier
    than it really is — and the model's whole job is to judge the
    right-hand edge.
    """
    return cm.to_panel(uh.monthly_counts(conn))


def _predict_panel(conn: sqlite3.Connection, train_panel: dict) -> tuple:
    """The panel the model PREDICTS from: revised, plus the live tail.

    Returns (panel, meta). The revised corpus lags its own subject by the
    better part of a year — 2025-12-31 while this was running in
    September 2026 — and a board built on it answers "the next three
    months" with a distribution about last January. That is a mislabelled
    window rather than a stale number, and a mislabelled one invites no
    suspicion at all.

    Falls back to the training panel, and says so in `meta`, whenever the
    tail is missing or unusable. A board nine months behind and honest
    about it beats a board that is current and quietly wrong.
    """
    meta = {"tail": False, "tail_months": 0, "calibrated": False,
            "factors": {}, "as_of": None, "corpus_to": None}
    try:
        last = conn.execute("SELECT MAX(substr(date,1,7)) FROM ucdp_history").fetchone()[0]
    except sqlite3.Error:
        last = None
    meta["corpus_to"] = meta["as_of"] = last
    if not last:
        return train_panel, meta
    try:
        factors = uc.calibration(conn)
        rows = uc.monthly_counts(conn, after=last, calibrate=True) if factors else []
    except sqlite3.Error:
        return train_panel, meta
    if not factors:
        # REFUSED, not used-and-disclaimed. An uncorrected tail is not a
        # slightly worse tail: candidate data runs 1.42x heavy on
        # one-sided violence, which put the United States at p=0.546 for
        # escalation in a category it is not escalating in. A footnote
        # does not make that number safe to publish, and this function's
        # own rule is that a board nine months behind and honest about it
        # beats one that is current and quietly wrong.
        meta["reason"] = ("no overlap with the revised corpus, so the live "
                          "tail cannot be put on the same scale and is not used")
        return train_panel, meta
    if not rows:
        return train_panel, meta

    merged = cm.to_panel(uh.monthly_counts(conn) + list(rows))
    meta.update(
        tail=True,
        tail_months=len({r[2] for r in rows}),
        calibrated=bool(factors),
        factors={k: round(v, 4) for k, v in factors.items()},
        as_of=max(r[2] for r in rows))
    return merged, meta


def fitted(conn: sqlite3.Connection, *, force: bool = False) -> dict:
    """The trained model and its panel, memoised.

    Single flight: whoever holds the lock trains, everyone else waits
    for that result rather than starting an eleven-second fit of their
    own. Swapped in when complete, never cleared first.
    """
    def _fresh():
        hit = _fit_cache.get("fit")
        return hit[1] if hit and time.monotonic() - hit[0] < _FIT_TTL_S else None

    if not force:
        got = _fresh()
        if got is not None:
            return got

    with _fit_lock:
        if not force:
            got = _fresh()
            if got is not None:
                return got
        panel = _panel(conn)
        fit = cm.train(panel)
        pred_panel, tail = _predict_panel(conn, panel)
        built = {"panel": pred_panel, "train_panel": panel,
                 "fit": fit, "tail": tail}
        _fit_cache["fit"] = (time.monotonic(), built)
        return built


def residual_of(scenarios) -> float:
    """The probability that NONE of the listed scenarios happens.

    THIS WAS 1 - SUM(p), AND THAT IS A CATEGORY ERROR. It is only the
    residual if the rows are mutually exclusive, and these rows are not:
    "escalation in state-based conflict", "in non-state conflict" and
    "in one-sided violence against civilians" can all happen in the same
    quarter, in the same country, and frequently do.

    The old formula carried its own evidence. It needed max(0.0, ...),
    which can only trigger when the rows sum past 1 — which can only
    happen when they are not exclusive. Sudan summed to 1.121 and the
    board reported a residual of 0.0: "there is no chance that none of
    these happens". That is precisely the unfalsifiable overconfidence
    the four rules exist to prevent, printed in the row the spec calls
    the most important one on the board.

    Under independence P(none) is the product of the complements, which
    is what this returns. Independence is not true either — violence
    types in one country are positively correlated — but the direction of
    that error is known and it is the safe one: for positively correlated
    events P(neither) EXCEEDS the independent product, because things
    that flare together also stay quiet together. So this is a lower
    bound on the residual, and the row can honestly be read as "at least
    this likely", never as an overstatement.
    """
    r = 1.0
    for sc in scenarios or []:
        try:
            p = float(sc.get("p"))
        except (TypeError, ValueError):
            continue
        r *= 1.0 - max(0.0, min(1.0, p))
    return r


def _basis(panel: dict, fit: dict, tail: dict) -> list:
    """What the board is standing on, including where it is weakest.

    The tail line is not a footnote. The revised corpus lags by months,
    and the live tail that closes the gap is preliminary and corrected
    before it is used. Both facts change how the number should be read,
    so both are on the board.
    """
    out = [
        f"UCDP GED, {len(panel)} locale series, 1989 onward",
        f"escalation measured against a {cm.BASELINE_M}-month trailing baseline",
        f"model skill {fit.get('skill')} against the base rate on held-out time",
    ]
    if not tail.get("tail"):
        why = tail.get("reason") or "no live tail available"
        out.append(f"revised corpus only, ending {tail.get('corpus_to') or 'unknown'}"
                   f" — {why}, so the window is measured from there")
        return out
    out.append(
        f"revised corpus to {tail.get('corpus_to')}, then {tail.get('tail_months')} "
        f"months of UCDP candidate data to {tail.get('as_of')} — preliminary, and "
        f"not used to train the model")
    if tail.get("calibrated"):
        worst = min(tail["factors"].items(), key=lambda kv: kv[1], default=None)
        if worst:
            out.append(
                f"candidate months rescaled onto revised levels from the overlap "
                f"the two datasets share (largest correction: {worst[0]} "
                f"x{worst[1]}) — revision removes events, it does not only add them")
    return out


def _sid(board: str, violence: str) -> str:
    return "SC-" + hashlib.sha1(f"{board}|{violence}".encode()).hexdigest()[:10]


def board_id(country: str) -> str:
    return "FB-" + hashlib.sha1(country.encode()).hexdigest()[:8].upper()


# ── Base rates and falsifiers, from the locale's own history ──────────

def historical_base_rate(series: list, horizon: int = cm.HORIZON_M) -> float:
    """How often this locale has actually escalated, over all its history.

    This is the tick on the bar. 7% means nothing; 7% against a 2% base
    rate is the model departing from history and owing you a reason.
    """
    labels = []
    for i in range(cm.MIN_MONTHS, len(series) - horizon):
        lab = cm.label_at(series, i, horizon)
        if lab is not None:
            labels.append(lab)
    return round(sum(labels) / len(labels), 4) if labels else 0.0


def falsifier_for(series: list, violence: str, horizon: int = cm.HORIZON_M) -> str:
    """A statement that can be checked before the window closes.

    Derived from the locale's own baseline rather than a round number,
    so it is falsifiable against the same measure the forecast was made
    on. A forecast with no falsifier cannot be wrong, and a forecast
    that cannot be wrong is not a forecast.
    """
    past = [r["events"] for r in series][-cm.BASELINE_M:]
    base = sum(past) / len(past) if past else 0.0
    return (f"Monthly {violence} events stay at or below {base:.1f} "
            f"for {horizon} consecutive months.")


def indicators_for(series: list, violence: str) -> list:
    """Observables that would move this scenario, and where to watch them.

    Rows are [label, source, direction, weight] — the spec's shape.
    Weight is how much the scenario MOVES if the indicator fires, not
    how likely the indicator is: a heavy indicator that never fires is
    still the one to instrument first.
    """
    f = cm.features_at(series, len(series) - 1) or {}
    base3 = (f.get("mean_12") or 0.0) * cm.HORIZON_M
    return [
        [f"{violence} events above {base3:.0f} per quarter", "UCDP", "up", 0.42],
        ["Fatalities per event rising against the 12-month mean", "UCDP", "up", 0.24],
        ["Coded cooperation between the parties falling", "GDELT", "down", 0.18],
        ["Geolocated incidents confirmed in-country", "GeoConfirmed", "up", 0.16],
    ]


# ── Boards ────────────────────────────────────────────────────────────

def list_boards(conn: sqlite3.Connection, *, limit: int = 40) -> list:
    """Every locale with enough recent activity to be worth forecasting."""
    built = fitted(conn)
    panel, fit = built["panel"], built["fit"]
    if not fit.get("available"):
        return []

    by_country: dict = {}
    for (country, violence), series in panel.items():
        if len(series) < cm.MIN_MONTHS + 1:
            continue
        recent = sum(r["events"] for r in series[-cm.HORIZON_M:])
        if recent < MIN_RECENT_EVENTS:
            continue
        e = by_country.setdefault(country, {"recent": 0, "kinds": 0})
        e["recent"] += recent
        e["kinds"] += 1

    out = []
    for country, e in by_country.items():
        out.append({
            "id": board_id(country),
            "name": country,
            "question": (f"Does violence in {country} escalate beyond its own "
                         f"recent rate in the next {cm.HORIZON_M} months?"),
            "horizon": f"{cm.HORIZON_M} months",
            "kinds": e["kinds"],
            "recent_events": e["recent"],
        })
    out.sort(key=lambda b: -b["recent_events"])
    return out[:limit]


def _model_scenarios(panel: dict, fit: dict, country: str) -> list:
    rows, keys = [], []
    for (c, violence), series in panel.items():
        if c != country or len(series) < cm.MIN_MONTHS + 1:
            continue
        f = cm.features_at(series, len(series) - 1)
        if f is None:
            continue
        rows.append([f[k] for k in cm.FEATURES])
        keys.append((violence, series, f))
    if not rows:
        return []

    probs = fit["model"].predict_proba(rows)[:, 1]
    out = []
    for (violence, series, f), p in zip(keys, probs):
        base = historical_base_rate(series)
        base3 = (f["mean_12"] or 0.0) * cm.HORIZON_M
        out.append({
            "id": _sid(board_id(country), violence),
            "origin": "model",
            "label": f"Escalation in {violence}",
            "p": round(float(p), 3),
            "base": base,
            "window": f"0-{cm.HORIZON_M} months",
            "note": (
                f"More {violence} than this country has been running at. "
                f"The comparison is against its own recent rate, not against "
                f"zero — a steady war is not an escalation."),
            "indicators": indicators_for(series, violence),
            "falsifier": falsifier_for(series, violence),
            "events_last_3m": int(f["ev_3"]),
            "baseline_3m": round(base3, 1),
            "months_since_last": int(f["months_since"]),
            # Chosen by the KIND of violence, never by the probability.
            "template": VIOLENCE_TEMPLATE.get(violence),
        })
    out.sort(key=lambda s: -s["p"])
    return out


def _proposals(conn: sqlite3.Connection, board: str) -> list:
    try:
        rows = conn.execute(
            "SELECT id, label, p, window, indicators, falsifier, author, created_at,"
            " template"
            " FROM forecast_proposals WHERE board = ? ORDER BY created_at", (board,)).fetchall()
    except sqlite3.Error:
        return []
    out = []
    for r in rows:
        try:
            inds = json.loads(r[4] or "[]")
        except ValueError:
            inds = []
        out.append({
            "id": r[0], "origin": "analyst", "label": r[1], "p": r[2],
            "base": None,            # an authored scenario has no measured base rate
            "window": r[3], "indicators": inds,
            # Both absences are shown rather than hidden — see the spec's
            # F7: a proposal that cannot be watched must say so.
            "falsifier": r[5] or None,
            "author": r[6], "created_at": r[7], "mine": True,
            "template": r[8] if len(r) > 8 else None,
        })
    return out


def record(conn: sqlite3.Connection, board: str | None = None) -> dict:
    """The model's own track record, from resolutions only.

    Rule 4 is decoration without this: a forecast that is never resolved
    can never be wrong. Reports n=0 plainly rather than implying a score
    it has not earned.
    """
    try:
        q = ("SELECT p, outcome, origin FROM forecast_resolutions"
             + (" WHERE board = ?" if board else ""))
        rows = conn.execute(q, (board,) if board else ()).fetchall()
    except sqlite3.Error:
        rows = []
    if not rows:
        return {"n": 0, "brier": None, "overconfident": None,
                "calibration": "Nothing has resolved yet, so this model has no "
                               "record. A forecast that is never resolved can "
                               "never be wrong."}

    by_origin = {}
    for origin in ("model", "analyst"):
        sel = [(p, o) for p, o, g in rows if g == origin]
        if not sel:
            continue
        b = sum((p - o) ** 2 for p, o in sel) / len(sel)
        mean_p = sum(p for p, _ in sel) / len(sel)
        hit = sum(o for _, o in sel) / len(sel)
        by_origin[origin] = {
            "n": len(sel), "brier": round(b, 4),
            "mean_probability": round(mean_p, 3),
            "observed_rate": round(hit, 3),
            "overconfident": round(mean_p - hit, 3),
        }

    m = by_origin.get("model") or next(iter(by_origin.values()))
    band = int(m["mean_probability"] * 100)
    return {
        "n": len(rows), "brier": m["brier"],
        "overconfident": m["overconfident"],
        "by_origin": by_origin,
        "calibration": (f"things this model called at about {band}% happened "
                        f"{int(m['observed_rate'] * 100)}% of the time"),
    }


def get_board(conn: sqlite3.Connection, bid: str) -> dict:
    """One board: scenarios, the computed residual, and the record."""
    built = fitted(conn)
    panel, fit = built["panel"], built["fit"]
    if not fit.get("available"):
        return {"available": False, "error": fit.get("reason", "model unavailable")}
    # An unskilled model must not be shown as a forecast.
    if not fit.get("skilful"):
        return {"available": False,
                "error": "the model does not beat the base rate on held-out "
                         "time, so it is not shown",
                "skill": fit.get("skill")}

    country = None
    for (c, _v) in panel:
        if board_id(c) == bid:
            country = c
            break
    if country is None:
        return {"available": False, "error": f"no board {bid}"}

    scenarios = _model_scenarios(panel, fit, country) + _proposals(conn, bid)
    # COMPUTED, never authored, and recomputed whenever a proposal lands.
    residual = residual_of(scenarios)

    last_month = max((s["m"] for series in panel.values() for s in series), default=None)
    return {
        "available": True,
        "id": bid, "name": country,
        "question": (f"Does violence in {country} escalate beyond its own recent "
                     f"rate in the next {cm.HORIZON_M} months?"),
        "horizon": f"{cm.HORIZON_M} months",
        "scenarios": scenarios,
        "residual": round(residual, 4),
        "record": record(conn, bid),
        "model": {
            "skill": fit.get("skill"), "brier": fit.get("brier"),
            "baseline_brier": fit.get("baseline_brier"),
            "n_train": fit.get("n_train"), "n_test": fit.get("n_test"),
            "reliability": fit.get("reliability"),
        },
        "basis": _basis(panel, fit, built.get("tail") or {}),
        "as_of_month": cm.month_label(last_month) if last_month is not None else None,
        # The provenance of the most recent months, stated rather than
        # folded in. A reader who knows the tail is preliminary reads the
        # same number differently, which is the point.
        "tail": built.get("tail") or {},
        "caveat": ("Probabilities are for escalation beyond this locale's own "
                   "recent rate, not for any specific named event. The rows are "
                   "not alternatives to each other — several can happen in the "
                   "same quarter — so they do not sum to 100%. The residual is "
                   "the chance that none of them does, and because these events "
                   "tend to move together it is a floor rather than an estimate: "
                   "the real chance of a quiet quarter is at least that."),
    }


def add_proposal(conn: sqlite3.Connection, *, board: str, label: str, p: float,
                 window: str = "", indicators: list | None = None,
                 falsifier: str = "", author: str = "",
                 template: str | None = None) -> dict:
    """Store an analyst scenario. Scored separately from the model's.

    An analyst's 30% and a model's 30% are different objects with
    different track records, and averaging them destroys the calibration
    line the board depends on.
    """
    ensure_schema(conn)
    label = (label or "").strip()
    if not label:
        return {"ok": False, "error": "a scenario needs a description"}
    try:
        p = float(p)
    except (TypeError, ValueError):
        return {"ok": False, "error": "probability must be a number"}
    # The spec's own 1-80% slider: 0 and 100 are not forecasts.
    if not (0.01 <= p <= 0.80):
        return {"ok": False, "error": "probability must be between 1% and 80%"}
    template = (template or "").strip() or None
    if template is not None and template not in TEMPLATES:
        return {"ok": False, "error": f"unknown template {template!r}"}

    import datetime as _dt
    pid = "SC-P" + hashlib.sha1(
        f"{board}|{label}|{time.time()}".encode()).hexdigest()[:9]
    conn.execute(
        "INSERT INTO forecast_proposals"
        " (id, board, label, p, window, indicators, falsifier, author,"
        "  created_at, template)"
        " VALUES (?,?,?,?,?,?,?,?,?,?)",
        (pid, board, label, p, window or None,
         json.dumps(indicators or []), falsifier or None, author or None,
         _dt.datetime.now(_dt.timezone.utc).isoformat(), template))
    conn.commit()
    return {"ok": True, "id": pid}


def resolve(conn: sqlite3.Connection, *, scenario_id: str, board: str,
            p: float, origin: str, outcome: int) -> dict:
    """Record what actually happened. The only thing that moves the record."""
    ensure_schema(conn)
    import datetime as _dt
    conn.execute(
        "INSERT INTO forecast_resolutions"
        " (scenario_id, board, p, origin, outcome, resolved_at)"
        " VALUES (?,?,?,?,?,?)"
        " ON CONFLICT(scenario_id) DO UPDATE SET"
        "  outcome=excluded.outcome, resolved_at=excluded.resolved_at",
        (scenario_id, board, float(p), origin,
         1 if outcome else 0, _dt.datetime.now(_dt.timezone.utc).isoformat()))
    conn.commit()
    return {"ok": True}


# ── Predictions as signals, for the briefing ──────────────────────────
#
# A FORECAST WRITTEN AS A SIGNAL MUST NEVER READ AS AN OBSERVATION. That
# is the whole risk of this integration: the briefing pipeline treats
# alerts as things that have happened, and a probability dropped into
# that stream without marking becomes, two hands later, a fact. So every
# row written here says "Forecast" in its title, carries is_forecast in
# its payload, and is classified C (model) or B (analyst) at tier T2 so
# the reader can tell machine from analyst without parsing prose.
#
# AND MOST OF THEM ARE NOT WRITTEN AT ALL. A scenario sitting on its own
# base rate is the model agreeing with history — true, and not news. If
# every locale published every quarter the briefing would fill with
# restatements of the obvious and the real departures would be lost in
# them. Only a material departure becomes a signal, which is the same
# argument the bar's own tick makes, applied at write time.

#: How far from its base rate a forecast must be before it is worth
#: telling anybody. Below this the model is agreeing with history.
DEPARTURE_FLOOR = 0.12

#: And a forecast this unlikely is not worth a line whatever its
#: departure — a rise from 1% to 4% is a tripling and still nothing.
PROBABILITY_FLOOR = 0.25


def signal_worthy(p: float, base: float | None) -> tuple:
    """(worth_writing, reason). The tick's argument, applied at write time."""
    if p is None:
        return False, "no probability"
    if p < PROBABILITY_FLOOR:
        return False, f"below {int(PROBABILITY_FLOOR * 100)}% — not worth a line"
    if base is None:
        # An authored scenario has no measured history to depart from.
        # It is published on the analyst's say-so, and marked as theirs.
        return True, "analyst scenario, no measured base rate"
    diff = p - base
    if abs(diff) < DEPARTURE_FLOOR:
        return False, "on its base rate — history already said this"
    return True, (f"{abs(diff) * 100:.0f} points "
                  f"{'above' if diff > 0 else 'below'} a base rate of {base * 100:.0f}%")


def publish_signals(conn: sqlite3.Connection, write_alert, *, limit: int = 40) -> dict:
    """Write today's material forecasts as alerts, for the briefing.

    `write_alert` is passed in rather than imported so this can be
    tested without the whole application.
    """
    built = fitted(conn)
    panel, fit = built["panel"], built["fit"]
    if not fit.get("available") or not fit.get("skilful"):
        return {"written": 0, "skipped": 0,
                "reason": "model not skilful enough to publish"}

    countries = {c for (c, _v) in panel}
    written = skipped = 0
    for country in countries:
        bid = board_id(country)
        for sc in _model_scenarios(panel, fit, country):
            ok, why = signal_worthy(sc["p"], sc["base"])
            if not ok:
                skipped += 1
                continue
            pctv = int(round(sc["p"] * 100))
            try:
                write_alert({
                    # Deterministic, so republishing the same quarter's
                    # forecast updates rather than duplicating it.
                    "id": f"FC-{sc['id']}",
                    "title": (f"Forecast — {sc['label'].lower()} in {country}: "
                              f"{pctv}% over {cm.HORIZON_M} months"),
                    "source": "forecast",
                    "alert_type": "forecast_escalation",
                    "severity": "high" if sc["p"] >= 0.6 else "medium",
                    "region": country,
                    "entity_type": "forecast", "entity_id": sc["id"],
                    "entity_name": sc["label"],
                    "tags": ["forecast", "escalation", "not-an-observation"],
                    "raw": {
                        # The flag a downstream reader checks before
                        # treating any of this as something that happened.
                        "is_forecast": True,
                        "board": bid,
                        "probability": sc["p"],
                        "base_rate": sc["base"],
                        "horizon_months": cm.HORIZON_M,
                        "reason": why,
                        "falsifier": sc["falsifier"],
                        "indicators": sc["indicators"],
                        "events_last_3m": sc.get("events_last_3m"),
                        "baseline_3m": sc.get("baseline_3m"),
                        "model_skill": fit.get("skill"),
                        "caveat": ("A forecast, not an observation. It states "
                                   "what may happen and how often it has "
                                   "happened here before."),
                    },
                })
                written += 1
            except Exception:                                # noqa: BLE001
                skipped += 1
            if written >= limit:
                break
        if written >= limit:
            break
    return {"written": written, "skipped": skipped,
            "departure_floor": DEPARTURE_FLOOR,
            "probability_floor": PROBABILITY_FLOOR}


def watch(conn: sqlite3.Connection, *, scenario_id: str, board: str,
          indicators: list, label: str = "") -> dict:
    """Turn a scenario's indicators into alert rules (spec F10).

    THE RULES FIRE ON THE DETECTOR, NOT ON THE FORECAST. That is the
    whole point of the button: a probability changing is not an event
    anybody can act on, but "rail throughput past Luga went above
    baseline" is. Watching a forecast means instrumenting the
    observables it rests on, so an operations team gets told about the
    world rather than about the model's opinion of it.
    """
    import json as _j
    import datetime as _dt
    ensure_schema(conn)
    made, skipped = 0, 0
    now = _dt.datetime.utcnow().isoformat()
    for row in indicators or []:
        try:
            obs, source, direction, weight = row
        except (TypeError, ValueError):
            skipped += 1
            continue
        if not str(obs).strip():
            skipped += 1
            continue
        # Deterministic name, so pressing watch twice does not create a
        # second copy of the same rule.
        rule = "fc_" + hashlib.sha1(
            f"{scenario_id}|{obs}".encode()).hexdigest()[:12]
        exists = conn.execute(
            "SELECT 1 FROM rule_configs WHERE rule_name = ?", (rule,)).fetchone()
        if exists:
            skipped += 1
            continue
        conn.execute(
            "INSERT INTO rule_configs"
            " (name, rule_name, trigger_type, severity, enabled, params,"
            "  created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
            (f"Watch: {obs}"[:200], rule, "forecast_indicator", "medium", 1,
             _j.dumps({
                 "observable": obs, "source": source, "direction": direction,
                 "weight": weight, "scenario": scenario_id, "board": board,
                 "scenario_label": label,
                 # Recorded so a rule firing months later can still say
                 # which forecast asked for it and why it mattered.
                 "why": ("instrumented because it would move the scenario "
                         f"'{label or scenario_id}'"),
             }), now, now))
        made += 1
    conn.commit()
    return {"ok": True, "created": made, "already_watched": skipped}
