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
    created_at  TEXT NOT NULL
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
    conn.commit()


# ── The fitted model, cached ──────────────────────────────────────────

def _panel(conn: sqlite3.Connection) -> dict:
    return cm.to_panel(uh.monthly_counts(conn))


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
        built = {"panel": panel, "fit": fit}
        _fit_cache["fit"] = (time.monotonic(), built)
        return built


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
        })
    out.sort(key=lambda s: -s["p"])
    return out


def _proposals(conn: sqlite3.Connection, board: str) -> list:
    try:
        rows = conn.execute(
            "SELECT id, label, p, window, indicators, falsifier, author, created_at"
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
    total = sum(s["p"] for s in scenarios)
    # COMPUTED, never authored, and recomputed whenever a proposal lands.
    residual = max(0.0, 1.0 - total)

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
        "basis": [
            f"UCDP GED, {len(panel)} locale series, 1989 onward",
            f"escalation measured against a {cm.BASELINE_M}-month trailing baseline",
            f"model skill {fit.get('skill')} against the base rate on held-out time",
        ],
        "as_of_month": last_month,
        "caveat": ("Probabilities are for escalation beyond this locale's own "
                   "recent rate, not for any specific named event. The residual "
                   "is what none of the listed scenarios covers, and it is "
                   "usually the largest row."),
    }


def add_proposal(conn: sqlite3.Connection, *, board: str, label: str, p: float,
                 window: str = "", indicators: list | None = None,
                 falsifier: str = "", author: str = "") -> dict:
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

    import datetime as _dt
    pid = "SC-P" + hashlib.sha1(
        f"{board}|{label}|{time.time()}".encode()).hexdigest()[:9]
    conn.execute(
        "INSERT INTO forecast_proposals"
        " (id, board, label, p, window, indicators, falsifier, author, created_at)"
        " VALUES (?,?,?,?,?,?,?,?,?)",
        (pid, board, label, p, window or None,
         json.dumps(indicators or []), falsifier or None, author or None,
         _dt.datetime.now(_dt.timezone.utc).isoformat()))
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
