"""
risk_crossref.py — the country risk index as a cross-reference of four
independent source families.

The owner (2026-10-18): "add Telegram feeds to the country risk index, so it
needs to become a cross-reference of GDELT, RSS, Telegram and GeoConfirmed."

Until now the index was GDELT with GeoConfirmed as a small cross-check, so a
country's band said how the wire coding read it and little else. A
cross-reference asks a different question: do sources that do not depend on
each other agree that something is wrong there?

THE FOUR FAMILIES, each scored 0–100 on its own evidence and window:

  gdelt         GDELT event coding (tone, share of conflictual events, volume
                against the country's own baseline) — gdelt_risk_index.py.
                Includes the translingual feed, so Spanish and Portuguese
                press count.
  rss           national and regional news outlets, read by rss_pulse.py:
                how much of what is written about the country is about
                violence or unrest (a share, so a country with many outlets is
                not riskier for it), and how much of it there is (log scale).
  telegram      what the joined channels report (event posts located in the
                country), how they speak (the mood rating: tension and calls to
                act), and the alarms already raised from them — demonstrations
                likely, tension rising, calls for conflict rising, single calls
                to violence, and stated intents to gather/attack/block.
  geoconfirmed  geolocated, verified footage (log scale of placemarks).

HOW THEY COMBINE.
  1. Each family's weight is scaled by how much evidence it has
     (count / FULL_EVIDENCE, at most 1): two Telegram posts move the index
     a little, two hundred move it fully. A family with no observation at all
     is left out, never read as calm.
  2. The index is the evidence-weighted mean of the family scores, with a
     small calm baseline (PRIOR_WEIGHT at PRIOR_SCORE) so thin evidence
     cannot produce a high score on its own.
  3. A family CORROBORATES when its own score reaches CORROBORATES_AT, rests on
     at least half its full evidence and, for RSS and Telegram, on at least two
     independent outlets or channels (one viral post is one voice).
  4. NO SINGLE FAMILY CAN CARRY A COUNTRY TO THE TOP. With one corroborating
     family (or none) the index is capped below band 4 (60); with two, below
     band 5 (78). Only three or more agreeing families can reach the top band.
  5. Confidence is the number of agreeing families: low (0–1), medium (2),
     high (3–4).

Every family reports its score, its counts, its window and its contribution,
so a band always traces back to the sources that put it there.

Pure functions only: the loaders live in routers/risk_index.py and
rss_pulse.py. Never imported by fusion_engine or correlation_scoring — the
index ranks countries, it does not score sites.
"""
from __future__ import annotations

import math

FAMILIES = ("gdelt", "rss", "telegram", "geoconfirmed")

FAMILY_LABEL = {
    "gdelt": "GDELT",
    "rss": "News (RSS)",
    "telegram": "Telegram",
    "geoconfirmed": "GeoConfirmed",
}

DEFAULT_FAMILY_WEIGHTS = {"gdelt": 0.30, "rss": 0.25, "telegram": 0.25, "geoconfirmed": 0.20}

#: The evidence count at which a family carries its full weight.
FULL_EVIDENCE = {"gdelt": 25, "rss": 10, "telegram": 15, "geoconfirmed": 3}

#: The score at which a family counts as agreeing that the country is at risk.
#: GDELT's is higher because its tone component sits between 48 and 70 for
#: nine countries in ten (measured 2026-10-18); agreement has to mean more
#: than "is being reported".
CORROBORATES_AT = {"gdelt": 60.0, "rss": 40.0, "telegram": 40.0, "geoconfirmed": 30.0}

#: THIN EVIDENCE IS PULLED TOWARD CALM. A pseudo-reading worth PRIOR_WEIGHT
#: of weight at PRIOR_SCORE joins every mean, so a country seen in two GDELT
#: events (Costa Rica, 2026-10-18: 53, band 3) lands near 25 instead, while a
#: country every family observes in full moves by a point or two.
PRIOR_WEIGHT = 0.05
PRIOR_SCORE = 15.0

#: Distinct outlets (RSS) or channels (Telegram) a family needs to corroborate.
MIN_VOICES = {"rss": 2, "telegram": 2}

#: Index ceilings by the number of corroborating families (bands: 60 = 4, 78 = 5).
CAP_BY_AGREEING = {0: 59.9, 1: 59.9, 2: 77.9}

WINDOW_DAYS = {"gdelt": 30, "rss": 7, "telegram": 7, "geoconfirmed": 30}

# Saturation points for the log scales (the count that reads as 100).
RSS_VOLUME_SAT = 150         # security articles a week
# The share of a country's coverage about violence or unrest that reads as
# 100, separately for its own press and for foreign press. Foreign outlets
# write about a country mostly when something is wrong (France: 51 % in the
# riots week), a country's own press about everything (Venezuela: 11 %), so
# one threshold made every country with national outlets look calm.
RSS_SHARE_SAT = 0.60         # foreign press
RSS_DOMESTIC_SHARE_SAT = 0.25  # the country's own press
GDELT_GOLD_SAT = 0.50        # half its events below the Goldstein conflict line reads as 100
TG_REPORTS_SAT = 150         # located event posts a week
TG_CALLS_SAT = 10            # single calls to violence a week
TG_INTENTS_SAT = 25          # stated intents to gather/attack/block a week
GEOCONFIRMED_SAT = 150       # verified placemarks in 30 days

UNREST_LEVEL_SCORE = {"Low": 0.0, "Elevated": 55.0, "High": 85.0}

BAND_THRESHOLDS = [(78, 5), (60, 4), (42, 3), (24, 2), (0, 1)]


def score_to_band(score: float) -> int:
    for threshold, band in BAND_THRESHOLDS:
        if score >= threshold:
            return band
    return 1


def log_scale(n, sat: float) -> float:
    """0–100: log1p(n) against log1p(sat), capped."""
    try:
        n = float(n or 0)
    except (TypeError, ValueError):
        return 0.0
    if n <= 0:
        return 0.0
    return 100.0 * min(1.0, math.log1p(n) / math.log1p(sat))


def _plural(n: int, word: str, plural: str | None = None) -> str:
    return f"{n} {word if n == 1 else (plural or word + 's')}"


def _family(name: str, score, count: int, voices: int | None, detail: dict, summary: str,
            status: str = "ok") -> dict:
    score = None if score is None else round(max(0.0, min(100.0, float(score))), 1)
    full = FULL_EVIDENCE[name]
    need_voices = MIN_VOICES.get(name)
    corroborates = bool(
        score is not None and count > 0
        and score >= CORROBORATES_AT[name]
        and count >= full / 2.0
        and (need_voices is None or (voices or 0) >= need_voices))
    return {
        "family": name, "label": FAMILY_LABEL[name], "score": score, "status": status,
        "count": int(count or 0), "voices": voices, "window_days": WINDOW_DAYS[name],
        "evidence_weight": round(min(1.0, (count or 0) / full), 3) if count else 0.0,
        "corroborates": corroborates, "summary": summary, "detail": detail,
    }


# ── the four families ─────────────────────────────────────────────────────

GDELT_PARTS = {"vol": 0.30, "tone": 0.30, "gold": 0.25}


def gdelt_family(row: dict | None) -> dict:
    """From one gdelt_risk_index.compute_country_risk() result. Only the
    GDELT components count here (vol, tone, gold); its GeoConfirmed
    component is now a family of its own.

    The conflictual share is rescaled (GDELT_GOLD_SAT): measured over 90
    countries on 2026-10-18 it ran from 8 % to 36 % for nine in ten, and
    Yemen led at 61 %, so read raw it could never say "war" — Ukraine's
    family scored 52, below Cuba's."""
    comps = (row or {}).get("components") or {}
    avail = {k: comps[k] for k in GDELT_PARTS if (comps.get(k) or {}).get("score") is not None}
    n = int(((comps.get("gold") or {}).get("n_events")) or ((comps.get("tone") or {}).get("n_events")) or 0)
    if not avail or n <= 0:
        return _family("gdelt", None, 0, None, {"components": comps}, "no GDELT events in the window",
                       status="no_events")
    part = {k: avail[k]["score"] for k in avail}
    if "gold" in part:
        share = avail["gold"].get("share_below_threshold")
        share = (part["gold"] / 100.0) if share is None else share
        part["gold"] = 100.0 * min(1.0, share / GDELT_GOLD_SAT)
    tw = sum(GDELT_PARTS[k] for k in avail)
    score = sum(GDELT_PARTS[k] / tw * part[k] for k in avail)
    bits = []
    if "gold" in avail:
        bits.append(f"{round(100 * (avail['gold'].get('share_below_threshold') or 0))}% conflictual")
    if "tone" in avail and avail["tone"].get("mean_tone") is not None:
        bits.append(f"tone {avail['tone']['mean_tone']:.1f}")
    if "vol" in avail and avail["vol"].get("ratio") is not None:
        bits.append(f"{avail['vol']['ratio']:.1f}× its usual volume")
    summary = f"{_plural(n, 'event')}" + (f" · {', '.join(bits)}" if bits else "")
    return _family("gdelt", score, n, None, {"components": comps}, summary)


def rss_family(st: dict | None) -> dict:
    """st: {total, conflict, unrest, outlets, sources: [{source, n}],
    domestic_total, domestic_conflict, domestic_unrest} over the RSS window
    (rss_pulse.country_stats). `unrest` counts unrest without violence;
    the domestic_* fields are the country's own press."""
    st = st or {}
    total = int(st.get("total") or 0)
    conflict = int(st.get("conflict") or 0)
    unrest = int(st.get("unrest") or 0)
    security = conflict + unrest
    total = max(total, security)
    if total <= 0:
        return _family("rss", None, 0, 0, {}, "no articles about it in the window", status="no_articles")
    d_total = min(total, int(st.get("domestic_total") or 0))
    d_conf = min(conflict, int(st.get("domestic_conflict") or 0))
    d_unr = min(unrest, int(st.get("domestic_unrest") or 0))
    d_total = max(d_total, d_conf + d_unr)
    f_total, f_conf, f_unr = total - d_total, conflict - d_conf, unrest - d_unr
    f_total = max(f_total, f_conf + f_unr)
    weighted = conflict + 0.5 * unrest
    parts, wsum = 0.0, 0
    if d_total:
        parts += d_total * min(1.0, (d_conf + 0.5 * d_unr) / d_total / RSS_DOMESTIC_SHARE_SAT)
        wsum += d_total
    if f_total:
        parts += f_total * min(1.0, (f_conf + 0.5 * f_unr) / f_total / RSS_SHARE_SAT)
        wsum += f_total
    share_score = parts / wsum if wsum else 0.0
    score = 100.0 * (0.5 * share_score + 0.5 * log_scale(weighted, RSS_VOLUME_SAT) / 100.0)
    outlets = int(st.get("outlets") or 0)
    summary = (f"{_plural(security, 'security article')} of {total} about it "
               f"({conflict} on violence, {unrest} on unrest) from {_plural(outlets, 'outlet')}"
               + (f"; {d_total} from its own press" if d_total else ""))
    detail = {"total": total, "conflict": conflict, "unrest": unrest,
              "share": round(weighted / total, 3), "share_score": round(100 * share_score, 1),
              "domestic_total": d_total, "outlets": outlets, "sources": (st.get("sources") or [])[:5]}
    return _family("rss", score, total, outlets, detail, summary)


def telegram_family(st: dict | None) -> dict:
    """st: {reports, report_channels, mood_n, mood_tension_sum, mood_calls,
    mood_channels, unrest_level, trend, sharp, conflict_rising,
    conflict_severity, violence_calls, intents} over the Telegram window."""
    st = st or {}
    reports = int(st.get("reports") or 0)
    mood_n = int(st.get("mood_n") or 0)
    calls = int(st.get("violence_calls") or 0)
    intents = int(st.get("intents") or 0)
    level = st.get("unrest_level")
    rising = bool(st.get("conflict_rising"))
    count = reports + mood_n
    if count <= 0 and not calls and not intents and level in (None, "Low") and not rising:
        return _family("telegram", None, 0, 0, {}, "no joined channel speaks about it", status="no_posts")

    reports_score = log_scale(reports, TG_REPORTS_SAT)
    mood_index = None
    if mood_n:
        mean_t = (st.get("mood_tension_sum") or 0) / mood_n
        call_share = (st.get("mood_calls") or 0) / mood_n
        mood_index = 100.0 * (0.5 * min(3.0, mean_t) / 3.0 + 0.5 * min(1.0, call_share))
    unrest_score = UNREST_LEVEL_SCORE.get(level or "Low", 0.0)
    if st.get("trend") == "rising":
        unrest_score = min(100.0, unrest_score + 10.0)
    if st.get("sharp"):
        unrest_score = min(100.0, unrest_score + 20.0)
    conflict_score = (95.0 if st.get("conflict_severity") == "critical" else 75.0) if rising else 0.0
    alarms = {"demonstrations": unrest_score, "calls_for_conflict": conflict_score,
              "calls_to_violence": log_scale(calls, TG_CALLS_SAT), "intents": log_scale(intents, TG_INTENTS_SAT)}
    alarm = max(alarms.values())
    # What is reported happening OR what is being called for, whichever is
    # stronger, then how people speak. A war zone reports and rarely
    # "calls"; a country before a protest calls and has little to report.
    # Summed (0.35 reports + 0.40 alarms) Ukraine scored 37 on 10,612 posts
    # in a week (production, 2026-10-18).
    score = 0.75 * max(reports_score, alarm) + 0.25 * (mood_index or 0.0)
    voices = max(int(st.get("report_channels") or 0), int(st.get("mood_channels") or 0))

    bits = []
    if reports:
        bits.append(f"{_plural(reports, 'event post')} from {_plural(int(st.get('report_channels') or 0), 'channel')}")
    if mood_index is not None:
        bits.append(f"mood {round(mood_index)} over {_plural(mood_n, 'rated post')}")
    if level and level != "Low":
        bits.append(f"demonstrations {level.lower()}")
    if st.get("trend") == "rising":
        bits.append("tension rising")
    if rising:
        bits.append("calls for conflict rising")
    if calls:
        bits.append(_plural(calls, "call to violence", "calls to violence"))
    if intents:
        bits.append(_plural(intents, "stated intent"))
    detail = {"reports": reports, "report_channels": int(st.get("report_channels") or 0),
              "mood_n": mood_n, "mood_index": None if mood_index is None else round(mood_index, 1),
              "unrest_level": level, "trend": st.get("trend"), "sharp": bool(st.get("sharp")),
              "conflict_rising": rising, "conflict_severity": st.get("conflict_severity"),
              "violence_calls": calls, "intents": intents,
              "parts": {"reports": round(reports_score, 1),
                        "mood": None if mood_index is None else round(mood_index, 1),
                        **{k: round(v, 1) for k, v in alarms.items()}}}
    return _family("telegram", score, count, voices, detail, " · ".join(bits) or "quiet")


def geoconfirmed_family(n: int | None) -> dict:
    n = int(n or 0)
    if n <= 0:
        return _family("geoconfirmed", None, 0, None, {}, "no verified footage in the window", status="no_placemarks")
    return _family("geoconfirmed", log_scale(n, GEOCONFIRMED_SAT), n, None, {"placemarks": n},
                   f"{_plural(n, 'geolocated, verified placemark')}")


# ── the cross-reference ──────────────────────────────────────────────────

def combine(families: dict, weights: dict | None = None) -> dict:
    """The index from the four family readings. See the module docstring."""
    w = dict(DEFAULT_FAMILY_WEIGHTS)
    if weights:
        w.update({k: float(v) for k, v in weights.items() if k in w})
    present = {f: d for f, d in families.items()
               if f in w and d and d.get("score") is not None and (d.get("count") or 0) > 0}
    eff = {f: w[f] * min(1.0, d["count"] / FULL_EVIDENCE[f]) for f, d in present.items()}
    total = sum(eff.values())
    agreeing = [f for f in FAMILIES if f in present and present[f].get("corroborates")]
    k = len(agreeing)
    if total <= 0:
        return {"score": None, "band": None, "uncapped_score": None, "capped": False, "cap": None,
                "corroborating": agreeing, "agreeing": k, "families_with_data": len(present),
                "confidence": "none", "contributions": {}, "weights_used": {}}
    denom = total + PRIOR_WEIGHT
    raw = (sum(eff[f] * present[f]["score"] for f in present) + PRIOR_WEIGHT * PRIOR_SCORE) / denom
    cap = CAP_BY_AGREEING.get(k)
    score = min(raw, cap) if cap is not None else raw
    scale = (score / raw) if raw > 0 else 0.0
    contributions = {f: round(eff[f] / denom * present[f]["score"] * scale, 2) for f in present}
    contributions["baseline"] = round(PRIOR_WEIGHT / denom * PRIOR_SCORE * scale, 2)
    score = round(score, 2)
    return {
        "score": score, "band": score_to_band(score),
        "uncapped_score": round(raw, 2), "capped": cap is not None and raw > cap, "cap": cap,
        "corroborating": agreeing, "agreeing": k, "families_with_data": len(present),
        "confidence": "high" if k >= 3 else "medium" if k == 2 else "low",
        "contributions": contributions,
        "weights_used": {f: round(eff[f] / denom, 4) for f in present},
    }


def explain_line(result: dict) -> str:
    """One sentence on what the sources agree on."""
    fams = result.get("families") or {}
    agreeing = [FAMILY_LABEL[f] for f in result.get("corroborating") or []]
    with_data = [f for f in FAMILIES if (fams.get(f) or {}).get("score") is not None]
    if not with_data:
        return "No source family has observed this country in its window."
    if not agreeing:
        s = f"No source family reads it as elevated ({len(with_data)} of 4 observe it)."
    elif len(agreeing) == 1:
        s = f"Only {agreeing[0]} reads it as elevated; one family alone cannot raise it past band 3."
    else:
        s = f"{', '.join(agreeing[:-1])} and {agreeing[-1]} agree it is elevated."
    if result.get("capped") and len(agreeing) == 2:
        s += " A third agreeing family is needed for the top band."
    return s


def score_country(iso3: str, gdelt_row: dict | None, rss_stats: dict | None, tg_stats: dict | None,
                  geoconfirmed_count: int | None, weights: dict | None = None,
                  window_days: int = 30) -> dict:
    families = {
        "gdelt": gdelt_family(gdelt_row),
        "rss": rss_family(rss_stats),
        "telegram": telegram_family(tg_stats),
        "geoconfirmed": geoconfirmed_family(geoconfirmed_count),
    }
    c = combine(families, weights)
    out = {
        "iso_code": iso3, "score": c["score"], "band": c["band"],
        "uncapped_score": c["uncapped_score"], "capped": c["capped"], "cap": c["cap"],
        "confidence": c["confidence"], "corroborating": c["corroborating"],
        "families_with_data": c["families_with_data"],
        "families": families,
        # The family readings double as the components, so every consumer
        # that lists "what made this score" lists the four sources.
        "components": families,
        "contributions": c["contributions"], "weights_used": c["weights_used"],
        "window_days": window_days,
    }
    out["explanation"] = explain_line(out)
    return out


def score_all(gdelt_rows: list, geoconfirmed_by_iso3: dict, rss_by_iso3: dict, tg_by_iso3: dict,
              weights: dict | None = None, window_days: int = 30) -> list:
    """Every country any family observed. Countries with no reading in any
    family are not scored at all, rather than scored zero."""
    gd = {}
    for r in gdelt_rows or []:
        iso = (r or {}).get("iso_code")
        if iso:
            gd[str(iso).upper()] = r
    isos = set(gd) | {k.upper() for k in (geoconfirmed_by_iso3 or {})} \
        | {k.upper() for k in (rss_by_iso3 or {})} | {k.upper() for k in (tg_by_iso3 or {})}
    out = []
    for iso in sorted(isos):
        row = score_country(iso, gd.get(iso), (rss_by_iso3 or {}).get(iso), (tg_by_iso3 or {}).get(iso),
                            (geoconfirmed_by_iso3 or {}).get(iso), weights, window_days)
        if row["score"] is not None:
            out.append(row)
    return out
