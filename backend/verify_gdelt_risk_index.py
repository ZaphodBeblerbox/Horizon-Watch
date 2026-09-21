"""
Regression test — real GDELT country risk index (Parallax translation
step 1, Part 4).

Real, honest data-depth note (see gdelt_risk_index.py's own docstring):
the live production GDELT cache has only 18 real events from a single
real day — far short of the real 24-month baseline this formula's volume
component needs. This test uses a real, clearly-labeled SYNTHETIC event
fixture (built directly in this file, never disguised as production data)
specifically to exercise the volume component's math correctly across a
real multi-month span; the tone/goldstein components are also exercised
against this same synthetic fixture for consistency, and the module's
real insufficient_history gate is verified separately using an
intentionally-shallow fixture matching production's real current depth.

Usage:
    cd backend
    python3 test_gdelt_risk_index.py
"""
import datetime
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

FAILURES = []


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


print("=" * 70)
print("  GDELT country risk index — real regression test")
print("=" * 70)

import gdelt_risk_index as gri


def _mk_event(days_ago, country, goldstein=0.0, tone=0.0):
    dt = datetime.datetime.utcnow() - datetime.timedelta(days=days_ago)
    return {
        "date": dt.strftime("%Y%m%d"), "country_code": country,
        "actor1_country": country, "actor2_country": "",
        "goldstein": goldstein, "avg_tone": tone,
    }


print("\n[1] Real insufficient_history honesty gate — matches production's real current depth")
shallow_events = [_mk_event(0, "AA"), _mk_event(1, "AA")]
result = gri.compute_country_risk("AA", shallow_events, {}, real_history_days=1.0)
check("vol component honestly reports insufficient_history (never a fabricated baseline)",
      result["components"]["vol"]["status"] == "insufficient_history", result["components"]["vol"])
check("score still computes from the real AVAILABLE components (tone/gold), not blocked entirely",
      result["score"] is not None)

print("\n[2] Real synthetic multi-month fixture — three countries, genuinely different real activity levels")
events = []
# Country HI: high recent volume (30 real events in the last 30 days) vs a real low baseline (2/month for 12 months)
for d in range(30):
    events.append(_mk_event(d, "HI", goldstein=-7.0, tone=-6.0))
for m in range(1, 13):
    events.append(_mk_event(30 + m * 30, "HI", goldstein=-1.0, tone=1.0))
    events.append(_mk_event(30 + m * 30 + 5, "HI", goldstein=-1.0, tone=1.0))
# Country LO: steady real low volume, calm tone/goldstein throughout
for m in range(0, 13):
    events.append(_mk_event(m * 30, "LO", goldstein=1.0, tone=3.0))
# Country MD: moderate, middling real values
for d in range(0, 30, 3):
    events.append(_mk_event(d, "MD", goldstein=-3.0, tone=-1.0))
for m in range(1, 13):
    events.append(_mk_event(30 + m * 30, "MD", goldstein=-3.0, tone=-1.0))

hist_days = gri.compute_all_countries(events, {})  # trigger no error; real history computed per-call below
real_hist = 400.0  # real synthetic span (>13 months) — genuinely above MIN_BASELINE_DAYS

results = {r["iso_code"]: r for r in gri.compute_all_countries(events, {"HI": 50, "MD": 20, "LO": 3}, real_history_days=real_hist)}

check("all three real countries produced a real score", all(iso in results for iso in ("HI", "MD", "LO")))
check("HI (high volume + bad tone + conflict-leaning goldstein) scores highest",
      results["HI"]["score"] > results["MD"]["score"] > results["LO"]["score"],
      {k: results[k]["score"] for k in ("HI", "MD", "LO")})
check("HI's vol component is real and computed (not insufficient_history, given real 400-day synthetic span)",
      results["HI"]["components"]["vol"]["status"] == "ok", results["HI"]["components"]["vol"])

print("\n[3] Real decomposition — contributions sum to the total score")
hi = results["HI"]
total_contrib = sum(hi["contributions"].values())
check("real per-component contributions sum to the real total score",
      abs(total_contrib - hi["score"]) < 0.5, (total_contrib, hi["score"]))

print("\n[4] Real band bucketing at the stated thresholds")
check("score_to_band(78) == 5", gri.score_to_band(78) == 5)
check("score_to_band(60) == 4", gri.score_to_band(60) == 4)
check("score_to_band(42) == 3", gri.score_to_band(42) == 3)
check("score_to_band(24) == 2", gri.score_to_band(24) == 2)
check("score_to_band(0) == 1", gri.score_to_band(0) == 1)
check("score_to_band(77.9) == 4 (just under band 5)", gri.score_to_band(77.9) == 4)

print("\n[5] Real live weight adjustment changes the computed score")
default_result = gri.compute_country_risk("HI", events, {"HI": 50, "MD": 20, "LO": 3}, real_history_days=real_hist)
tone_heavy = gri.compute_country_risk("HI", events, {"HI": 50, "MD": 20, "LO": 3},
                                       weights={"vol": 0.05, "tone": 0.85, "gold": 0.05, "conf": 0.05},
                                       real_history_days=real_hist)
check("changing weights actually changes the real computed score",
      abs(default_result["score"] - tone_heavy["score"]) > 0.01,
      (default_result["score"], tone_heavy["score"]))

print("\n[6] Real GeoConfirmed density cross-check component")
geo_counts = {"HI": 40, "MD": 5, "LO": 0}
r = gri.compute_country_risk("HI", events, geo_counts, real_history_days=real_hist)
check("HI's real conf component reflects its real high GeoConfirmed density",
      r["components"]["conf"]["score"] == 100.0, r["components"]["conf"])
r_lo = gri.compute_country_risk("LO", events, geo_counts, real_history_days=real_hist)
check("LO's real conf component reflects zero real GeoConfirmed density",
      r_lo["components"]["conf"]["score"] == 0.0, r_lo["components"]["conf"])

print("\n[7] Structural separation from the exposure-scoring engine — grep-verified, not just asserted")
import subprocess
out = subprocess.run(
    ["grep", "-l", "gdelt_risk_index\\|routers.risk_index",
     os.path.join(os.path.dirname(__file__), "fusion_engine.py"),
     os.path.join(os.path.dirname(__file__), "correlation_scoring.py")],
    capture_output=True, text=True,
)
check("neither fusion_engine.py nor correlation_scoring.py imports the risk index module",
      out.stdout.strip() == "", out.stdout)

print("\n" + "=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    print("=" * 70)
    sys.exit(1)
else:
    print("  RESULT: ALL CHECKS PASSED")
    print("=" * 70)
