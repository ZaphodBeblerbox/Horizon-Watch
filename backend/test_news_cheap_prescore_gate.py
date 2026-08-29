"""
test_news_cheap_prescore_gate.py

Verifies that an article engineered to fail the EXISTING cheap keyword
prescore gate (main._cheap_prescore() < NEWS_ENRICHMENT_MIN_RELEVANCE_PRESCORE)
genuinely never reaches the Haiku call (article_intelligence.analyse_article),
and that main._classify_article_intel() correctly attributes the funnel stage
as "failed_cheap_prescore" rather than silently falling through to some other
reason.

Uses main._classify_article_intel() directly — the exact decision function
_run_news_conflict_extraction_sync() calls per article, refactored out of the
extraction loop specifically so it's testable without a live RSS feed fetch —
with article_intelligence.analyse_article() (bound into main.py's namespace
as `analyse_article`) monkeypatched to a call-counting stub, so no real
Anthropic API call happens and no API credits are spent.

A second, high-prescore, gates-clear case proves the SAME harness DOES route
to Haiku when the gates pass, so the first case's zero calls is a real gate
effect rather than "nothing in this test environment ever calls Haiku".

Usage:
    cd backend
    python3 test_news_cheap_prescore_gate.py
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
print("  Cheap-prescore gate — Haiku call-counting test")
print("=" * 70)

call_count = {"n": 0}


def _counting_stub(title, body=None, source=None):
    call_count["n"] += 1
    return {
        "tier": 1, "relevance_score": 9.0, "location": None,
        "location_country": None, "location_confidence": "none",
        "article_type": "conflict", "icon_type": "conflict",
        "event_title": "stub", "has_image": False, "is_breaking": False,
        "context_summary": "stub response — no real API call made", "entities": [],
    }


_orig_analyse_article = main.analyse_article
_orig_client = main.client
_orig_budget_ok = main._claude_budget_ok
main.analyse_article = _counting_stub
main.client = object()                  # any truthy sentinel — bypasses the "no client" gate
main._claude_budget_ok = lambda: True   # bypasses live budget state so the test is deterministic

try:
    # ── Case A: engineered to fail the cheap keyword prescore ────────────────
    title_low = "Local bakery wins regional pastry competition"
    summary_low = (
        "A small bakery took home first prize at a regional pastry championship "
        "this weekend, delighting judges with its cinnamon rolls and croissants."
    )
    prescore_low = main._cheap_prescore(title_low, summary_low)
    check("engineered article genuinely scores below the prescore threshold",
          prescore_low < main.NEWS_ENRICHMENT_MIN_RELEVANCE_PRESCORE,
          f"prescore={prescore_low} threshold={main.NEWS_ENRICHMENT_MIN_RELEVANCE_PRESCORE}")

    result_low = main._classify_article_intel(
        title_low, summary_low, "Test Feed", None,
        llm_calls_this_cycle=0, article_calls_today=0,
    )
    check("low-prescore article is never routed to Haiku",
          result_low["llm_called"] is False, f"result={result_low}")
    check("funnel stage correctly attributes the rejection to the cheap prescore gate",
          result_low["stage"] == "failed_cheap_prescore", f"stage={result_low['stage']}")
    check("Haiku stub was never actually invoked for the low-prescore article",
          call_count["n"] == 0, f"calls={call_count['n']}")

    # ── Case B: high-prescore, gates clear — same harness DOES call Haiku ────
    title_high = "Missile strike hits naval vessel near strategic strait, casualties reported"
    summary_high = (
        "A warship came under missile attack near a strategic maritime chokepoint, "
        "military officials said, with several casualties reported amid an "
        "escalating naval confrontation."
    )
    prescore_high = main._cheap_prescore(title_high, summary_high)
    check("contrast article genuinely clears the prescore threshold",
          prescore_high >= main.NEWS_ENRICHMENT_MIN_RELEVANCE_PRESCORE,
          f"prescore={prescore_high} threshold={main.NEWS_ENRICHMENT_MIN_RELEVANCE_PRESCORE}")

    result_high = main._classify_article_intel(
        title_high, summary_high, "Test Feed", None,
        llm_calls_this_cycle=0, article_calls_today=0,
    )
    check("high-prescore article with clear gates IS routed to Haiku",
          result_high["llm_called"] is True, f"result={result_high}")
    check("funnel stage reflects the Haiku call actually happening",
          result_high["stage"] == "haiku_called_with_result", f"stage={result_high['stage']}")
    check("Haiku stub was invoked exactly once for the high-prescore article",
          call_count["n"] == 1, f"calls={call_count['n']}")
finally:
    main.analyse_article = _orig_analyse_article
    main.client = _orig_client
    main._claude_budget_ok = _orig_budget_ok

print("=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
else:
    print("  RESULT: ALL CHECKS PASSED")
print("=" * 70)

if __name__ == "__main__":
    sys.exit(1 if FAILURES else 0)
