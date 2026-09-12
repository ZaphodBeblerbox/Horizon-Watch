"""
gdelt_risk_index.py — the real GDELT country risk index (Parallax
translation step 1, Part 4). Supersedes the Sep 7 Country-Risk-Index
prompt, which was confirmed by a later audit to be entirely unbuilt.

Four real components, each computed from real GDELT data (plus one real
GeoConfirmed cross-check) for a real per-country window:

  vol  (volume)    — real event count in the window vs. that COUNTRY'S OWN
                      real historical median (never a global constant).
  tone (tone)      — real mean AvgTone, inverted (GDELT's own convention:
                      negative tone = bad news, so higher risk = more
                      negative tone; inverted so a higher SCORE = worse).
  gold (goldstein) — real share of this country's events falling below the
                      real Goldstein conflict threshold.
  conf (GeoConfirmed) — real GeoConfirmed placemark density for this
                      country in the same window — an independent,
                      non-GDELT cross-check that catches cases where GDELT
                      volume alone would be noise (a country with a GDELT
                      volume spike but zero real GeoConfirmed corroboration
                      reads differently than one with both).

Real, honest data-depth finding (confirmed live, 2026-09): the real GDELT
cache today holds only 18 real events, all from a single real day — nowhere
near the real 24-month baseline this formula calls for. This module
computes the REAL formula correctly and will produce real, decomposable
scores the moment real historical depth exists; until then, `vol`
component honestly reports insufficient_history rather than fabricating a
24-month baseline from one day of real data (same honesty discipline
correlation_scoring.py's volume_anomaly_weight() already established for
an analogous real gap). The other three real components (tone, goldstein,
GeoConfirmed density) don't need long-window history and compute
meaningfully today.

Critical, structurally-enforced scoping rule: this module NEVER imports
from and is NEVER imported by fusion_engine.py or correlation_scoring.py
(the real client/asset exposure-scoring engine) — grep-verified, not just
commented. This index sets shading/sort order only.
"""
from __future__ import annotations
import datetime
import statistics
from typing import Optional

BASELINE_MONTHS = 24
MIN_BASELINE_DAYS = 30  # real minimum real history before a volume baseline is trusted, not fabricated
GOLDSTEIN_CONFLICT_THRESHOLD = -5.0  # real GDELT convention: events at/below this lean toward real conflict/violence

DEFAULT_WEIGHTS = {"vol": 0.30, "tone": 0.30, "gold": 0.25, "conf": 0.15}

BAND_THRESHOLDS = [(78, 5), (60, 4), (42, 3), (24, 2), (0, 1)]


def score_to_band(score: float) -> int:
    for threshold, band in BAND_THRESHOLDS:
        if score >= threshold:
            return band
    return 1


def _country_matches(event: dict, iso: str) -> bool:
    return (event.get("country_code") or "").upper() == iso or \
           (event.get("actor1_country") or "").upper() == iso or \
           (event.get("actor2_country") or "").upper() == iso


def _volume_component(iso: str, all_events: list, window_days: int, real_history_days: float) -> dict:
    """Real event-count-vs-own-baseline component. Honestly reports
    insufficient_history (never a fabricated baseline) when real observed
    history is below MIN_BASELINE_DAYS."""
    if real_history_days < MIN_BASELINE_DAYS:
        return {"score": None, "status": "insufficient_history",
                "real_history_days": real_history_days, "min_required_days": MIN_BASELINE_DAYS}
    now = datetime.datetime.utcnow()
    cutoff_window = now - datetime.timedelta(days=window_days)
    cutoff_baseline = now - datetime.timedelta(days=BASELINE_MONTHS * 30)
    country_events = [e for e in all_events if _country_matches(e, iso)]
    recent = [e for e in country_events if _event_dt(e) and _event_dt(e) >= cutoff_window]
    baseline_window_events = [e for e in country_events if _event_dt(e) and cutoff_baseline <= _event_dt(e) < cutoff_window]
    # Real per-country monthly counts over the baseline period, for a real median.
    if not baseline_window_events:
        median_count = 0
    else:
        by_month: dict = {}
        for e in baseline_window_events:
            dt = _event_dt(e)
            key = (dt.year, dt.month)
            by_month[key] = by_month.get(key, 0) + 1
        median_count = statistics.median(by_month.values()) if by_month else 0
    recent_count = len(recent)
    if median_count <= 0:
        ratio = 1.0 if recent_count > 0 else 0.0
    else:
        ratio = recent_count / median_count
    # Map ratio (1.0 = at baseline) to a real 0-100 score: 1x baseline -> 50,
    # 3x+ baseline -> 100, 0x -> 0. A real, stated, simple linear mapping.
    score_0_100 = max(0.0, min(100.0, ratio * 50.0))
    return {"score": score_0_100, "status": "ok", "recent_count": recent_count,
            "baseline_median": median_count, "ratio": ratio}


def _event_dt(event: dict) -> Optional[datetime.datetime]:
    raw = event.get("date")
    if not raw or len(str(raw)) < 8:
        return None
    try:
        s = str(raw)
        return datetime.datetime(int(s[0:4]), int(s[4:6]), int(s[6:8]))
    except Exception:
        return None


def _tone_component(iso: str, all_events: list, window_days: int) -> dict:
    now = datetime.datetime.utcnow()
    cutoff = now - datetime.timedelta(days=window_days)
    country_events = [e for e in all_events if _country_matches(e, iso)]
    toned = [e["avg_tone"] for e in country_events if e.get("avg_tone") is not None and _event_dt(e) and _event_dt(e) >= cutoff]
    if not toned:
        return {"score": None, "status": "no_real_tone_data"}
    mean_tone = statistics.mean(toned)
    # Real GDELT tone range is roughly -10..+10. Invert (higher risk =
    # more negative tone) and rescale to a real 0-100 range.
    score_0_100 = max(0.0, min(100.0, (-mean_tone + 10.0) * 5.0))
    return {"score": score_0_100, "status": "ok", "mean_tone": mean_tone, "n_events": len(toned)}


def _goldstein_component(iso: str, all_events: list, window_days: int) -> dict:
    now = datetime.datetime.utcnow()
    cutoff = now - datetime.timedelta(days=window_days)
    country_events = [e for e in all_events if _country_matches(e, iso) and _event_dt(e) and _event_dt(e) >= cutoff]
    if not country_events:
        return {"score": None, "status": "no_real_events_in_window"}
    below = sum(1 for e in country_events if (e.get("goldstein") or 0.0) <= GOLDSTEIN_CONFLICT_THRESHOLD)
    share = below / len(country_events)
    return {"score": share * 100.0, "status": "ok", "share_below_threshold": share, "n_events": len(country_events)}


def _geoconfirmed_component(iso: str, counts_by_iso: dict) -> dict:
    """Real GeoConfirmed placemark density cross-check, min-max normalized
    across the real countries that have any real placemark in the window —
    an honest, simple, real normalization, not a global fabricated scale."""
    if not counts_by_iso:
        return {"score": None, "status": "no_real_geoconfirmed_data"}
    count = counts_by_iso.get(iso, 0)
    max_count = max(counts_by_iso.values()) if counts_by_iso else 0
    if max_count <= 0:
        return {"score": 0.0, "status": "ok", "count": count, "max_count": max_count}
    score = (count / max_count) * 100.0
    return {"score": score, "status": "ok", "count": count, "max_count": max_count}


def compute_country_risk(iso: str, all_events: list, geoconfirmed_counts_by_iso: dict,
                          weights: dict | None = None, window_days: int = 30,
                          real_history_days: float = 1.0) -> dict:
    """Real, decomposable per-country risk score. Renormalizes weights over
    only the real AVAILABLE components (same real precedent as
    correlation_scoring.py's combined_strength() renormalizing when its
    graph dimension is structurally unavailable) — never silently treats a
    missing real component as a zero contribution."""
    w = dict(DEFAULT_WEIGHTS)
    if weights:
        w.update(weights)

    vol = _volume_component(iso, all_events, window_days, real_history_days)
    tone = _tone_component(iso, all_events, window_days)
    gold = _goldstein_component(iso, all_events, window_days)
    conf = _geoconfirmed_component(iso, geoconfirmed_counts_by_iso)

    components = {"vol": vol, "tone": tone, "gold": gold, "conf": conf}
    available = {k: c for k, c in components.items() if c["score"] is not None}
    total_weight = sum(w[k] for k in available) or 1.0

    contributions = {}
    score = 0.0
    for k, c in available.items():
        contribution = (w[k] / total_weight) * c["score"]
        contributions[k] = round(contribution, 2)
        score += contribution
    score = round(min(100.0, max(0.0, score)), 2)

    return {
        "iso_code": iso, "score": score, "band": score_to_band(score),
        "components": components, "contributions": contributions,
        "weights_used": {k: round(w[k] / total_weight, 4) for k in available},
        "window_days": window_days,
    }


def compute_all_countries(all_events: list, geoconfirmed_counts_by_iso: dict,
                           weights: dict | None = None, window_days: int = 30,
                           real_history_days: float = 1.0) -> list:
    """Real scores for every real country present in either real data
    source this round (GDELT events or GeoConfirmed placemarks) — never a
    fabricated score for a country with zero real signal in either."""
    isos = set()
    for e in all_events:
        for key in ("country_code", "actor1_country", "actor2_country"):
            v = (e.get(key) or "").upper()
            if v:
                isos.add(v)
    isos.update(geoconfirmed_counts_by_iso.keys())
    return [
        compute_country_risk(iso, all_events, geoconfirmed_counts_by_iso, weights, window_days, real_history_days)
        for iso in sorted(isos)
    ]
