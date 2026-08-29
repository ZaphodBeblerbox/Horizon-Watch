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

print("=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
else:
    print("  RESULT: ALL CHECKS PASSED")
print("=" * 70)

if __name__ == "__main__":
    sys.exit(1 if FAILURES else 0)
