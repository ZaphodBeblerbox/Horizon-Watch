"""
test_news_embedding_relevance_ranking.py

Verifies the new embedding-relevance stage (relevance_embedding.py +
main._classify_article_intel()'s embedding-relevance gate) correctly ranks a
KNOWN-relevant article above a KNOWN-irrelevant one against a populated
Mission Profile, and routes both through the expected funnel stage — as a
purely structural assertion, not a comparison against a real (and repeatedly
costly) Haiku API call.

Uses a deliberately POPULATED test Mission Profile (focusRegions,
infraDomains, chokepoints, activeSituations all filled in), NOT the live
backend/profile.json, which today has all of those empty/thin — see
main._profile_has_signal()'s docstring and relevance_embedding.py's module
docstring for why the embedding-relevance gate deliberately does not engage
against that thin a profile. Both seeded articles clear the existing cheap
keyword prescore gate identically (so under the OLD system they'd have
reached Haiku identically) — the embedding-relevance stage is what tells them
apart, which is the actual thing being proven here.

Usage:
    cd backend
    python3 test_news_embedding_relevance_ranking.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))

import main  # noqa: E402

FAILURES = []


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


print("=" * 70)
print("  Embedding-relevance ranking test (known-relevant vs known-irrelevant)")
print("=" * 70)

TEST_PROFILE = {
    "displayName": "Test Analyst", "role": "Analyst",
    "focusRegions": ["Middle East"],
    "infraDomains": ["Energy", "Maritime chokepoints"],
    "chokepoints": ["Strait of Hormuz", "Bab el-Mandeb"],
    "threshold": 1,
    "activeSituations": "Houthi attacks on Red Sea shipping, Iran-Israel tensions, tanker seizures in the Gulf",
}

check("test profile is judged to carry real signal (unlike today's thin live profile)",
      main._profile_has_signal(TEST_PROFILE) is True)

# Known-relevant: directly matches the profile's chokepoints/active situations.
title_relevant = "Houthi missile strike hits oil tanker near Bab el-Mandeb strait"
summary_relevant = (
    "A commercial oil tanker came under missile attack from Houthi forces in Yemen "
    "as it transited the Bab el-Mandeb strait on Tuesday, the latest naval escalation "
    "in Red Sea shipping lanes."
)

# Known-irrelevant: also conflict-shaped (so it clears the SAME generic keyword
# gate as the relevant article), but has nothing to do with this profile's
# stated focus regions/chokepoints/situations.
title_irrelevant = "Military junta seizes power in coup, deploys troops nationwide"
summary_irrelevant = (
    "Soldiers loyal to a breakaway military faction seized the presidential palace "
    "overnight, declaring a state of emergency and deploying troops to the capital "
    "after months of political crisis."
)

prescore_relevant = main._cheap_prescore(title_relevant, summary_relevant)
prescore_irrelevant = main._cheap_prescore(title_irrelevant, summary_irrelevant)
check("both seeded articles clear the SAME generic cheap-prescore gate "
      "(so only the embedding stage tells them apart, not the keyword gate)",
      prescore_relevant >= main.NEWS_ENRICHMENT_MIN_RELEVANCE_PRESCORE
      and prescore_irrelevant >= main.NEWS_ENRICHMENT_MIN_RELEVANCE_PRESCORE,
      f"relevant={prescore_relevant} irrelevant={prescore_irrelevant} "
      f"threshold={main.NEWS_ENRICHMENT_MIN_RELEVANCE_PRESCORE}")

call_count = {"n": 0}


def _counting_stub(title, body=None, source=None):
    call_count["n"] += 1
    return {"tier": 1, "relevance_score": 9.0}


_orig_analyse_article = main.analyse_article
_orig_client = main.client
_orig_budget_ok = main._claude_budget_ok
main.analyse_article = _counting_stub
main.client = object()
main._claude_budget_ok = lambda: True

try:
    result_relevant = main._classify_article_intel(
        title_relevant, summary_relevant, "Test Feed", TEST_PROFILE,
        llm_calls_this_cycle=0, article_calls_today=0,
    )
    result_irrelevant = main._classify_article_intel(
        title_irrelevant, summary_irrelevant, "Test Feed", TEST_PROFILE,
        llm_calls_this_cycle=0, article_calls_today=0,
    )
finally:
    main.analyse_article = _orig_analyse_article
    main.client = _orig_client
    main._claude_budget_ok = _orig_budget_ok

check("Haiku was never called for either article (embedding gate handled both deterministically)",
      call_count["n"] == 0, f"calls={call_count['n']}")

check("known-relevant article's embedding score is meaningfully higher than the known-irrelevant one's",
      result_relevant["embedding_score"] > result_irrelevant["embedding_score"],
      f"relevant={result_relevant['embedding_score']:.4f} irrelevant={result_irrelevant['embedding_score']:.4f}")

check("known-relevant article's embedding verdict is 'relevant'",
      result_relevant["embedding_verdict"] == "relevant", f"verdict={result_relevant['embedding_verdict']}")
check("known-irrelevant article's embedding verdict is 'irrelevant'",
      result_irrelevant["embedding_verdict"] == "irrelevant", f"verdict={result_irrelevant['embedding_verdict']}")

check("both route through the embedding-relevance funnel stage (neither fell through to Haiku or a plain fallback)",
      result_relevant["stage"] == "embedding_relevance_score_and_verdict"
      and result_irrelevant["stage"] == "embedding_relevance_score_and_verdict",
      f"relevant_stage={result_relevant['stage']} irrelevant_stage={result_irrelevant['stage']}")

check("known-relevant article gets a MORE significant tier than the known-irrelevant one "
      "(lower tier number = more significant)",
      result_relevant["intel"]["tier"] < result_irrelevant["intel"]["tier"],
      f"relevant_tier={result_relevant['intel']['tier']} irrelevant_tier={result_irrelevant['intel']['tier']}")

check("known-relevant article gets a HIGHER relevance_score than the known-irrelevant one",
      result_relevant["intel"]["relevance_score"] > result_irrelevant["intel"]["relevance_score"],
      f"relevant_score={result_relevant['intel']['relevance_score']} "
      f"irrelevant_score={result_irrelevant['intel']['relevance_score']}")


# ══════════════════════════════════════════════════════════════════════════
#  REGRESSION: diverse sample sanity check. relevance_score() shares its
#  underlying similarity mechanism with near-duplicate detection (see
#  relevance_embedding.py's module docstring for the near-dup bug that
#  mechanism shipped with), so this confirms the fix (IDF weighting,
#  unigram/bigram hybrid, unigram-dominant 0.7/0.3 weighting) didn't break
#  mission-profile relevance ranking — using several relevant/irrelevant
#  pairs, not just the one hand-picked pair above.
# ══════════════════════════════════════════════════════════════════════════
print()
print("=" * 70)
print("  Diverse sample: relevance ranking against the test profile")
print("=" * 70)

_RELEVANT_SAMPLE = [
    ("Houthi missile strike hits oil tanker near Bab el-Mandeb strait",
     "A commercial oil tanker came under missile attack from Houthi forces "
     "in Yemen as it transited the Bab el-Mandeb strait on Tuesday, the "
     "latest naval escalation in Red Sea shipping lanes."),
    ("Iran seizes another tanker near Strait of Hormuz amid rising tensions",
     "Iran naval forces seized a foreign-flagged tanker near the Strait of "
     "Hormuz on Wednesday, officials said, in the latest escalation amid "
     "ongoing tensions with Gulf states."),
    ("Energy markets on edge as Gulf tanker seizures continue",
     "Energy markets were on edge Wednesday as tanker seizures continued "
     "in the Gulf, analysts said, with shipping firms rerouting away from "
     "Red Sea chokepoints."),
    ("Houthi attacks on Red Sea shipping disrupt Middle East trade routes",
     "Houthi attacks on Red Sea shipping have disrupted trade routes "
     "across the Middle East, officials said, forcing many vessels to "
     "avoid the Bab el-Mandeb strait."),
]
_IRRELEVANT_SAMPLE = [
    ("Military junta seizes power in coup, deploys troops nationwide",
     "Soldiers loyal to a breakaway military faction seized the "
     "presidential palace overnight, declaring a state of emergency and "
     "deploying troops to the capital after months of political crisis."),
    ("Local bakery wins award for best pastry in the region",
     "A small family-owned bakery has won a regional award for its "
     "pastries, the owner said Wednesday, crediting decades of tradition "
     "and a loyal customer base."),
    ("Tech company announces new laptop with longer battery life",
     "The company unveiled its newest laptop model on Wednesday, touting "
     "a longer battery life and faster processor as its main selling "
     "points, according to a press release."),
    ("City council approves new public transit funding package",
     "The city council voted 7-2 to approve a new funding package for "
     "public transit improvements, including expanded bus routes and "
     "station upgrades."),
]

relevant_scores = []
for t, s in _RELEVANT_SAMPLE:
    score = main.relevance_embedding.relevance_score(main._format_profile_context(TEST_PROFILE), f"{t} {s}")
    relevant_scores.append(score)
    print(f"  relevant   score={score:.4f}   {t[:55]!r}")

irrelevant_scores = []
for t, s in _IRRELEVANT_SAMPLE:
    score = main.relevance_embedding.relevance_score(main._format_profile_context(TEST_PROFILE), f"{t} {s}")
    irrelevant_scores.append(score)
    print(f"  irrelevant score={score:.4f}   {t[:55]!r}")

print(f"  relevant group:   min={min(relevant_scores):.4f} max={max(relevant_scores):.4f}")
print(f"  irrelevant group: min={min(irrelevant_scores):.4f} max={max(irrelevant_scores):.4f}")

check("every relevant-sample article scores above the irrelevant "
      "group's ceiling (real margin, not just one lucky pair)",
      min(relevant_scores) > max(irrelevant_scores),
      f"relevant_min={min(relevant_scores):.4f} irrelevant_max={max(irrelevant_scores):.4f}")

print("=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
else:
    print("  RESULT: ALL CHECKS PASSED")
print("=" * 70)

if __name__ == "__main__":
    sys.exit(1 if FAILURES else 0)
