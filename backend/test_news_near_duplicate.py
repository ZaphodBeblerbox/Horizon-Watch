"""
test_news_near_duplicate.py

Verifies the near-duplicate detection added to the news-article
classification funnel (main._find_near_duplicate / main._attach_duplicate_report),
wired into _run_news_conflict_extraction_sync() right after event-type
classification and before the Haiku/embedding-relevance stages.

Before this change, dedup was exact-URL only (_PROCESSED_URLS) — the same
real-world event covered by two different outlets under two different URLs
(which ~270 RSS feeds do routinely) produced two independent story cards,
each independently classified. This test seeds two REALISTIC near-duplicate
articles (same underlying event, different outlet, meaningfully different
wording — not identical strings, which would trivially dedupe on exact match
and prove nothing) and confirms they collapse to ONE classification: the
second is suppressed and tracked as "also reported by" on the first, rather
than becoming its own card. A third, genuinely unrelated article confirms the
mechanism doesn't over-merge unrelated stories.

Uses main._find_near_duplicate() / main._attach_duplicate_report() directly —
the exact functions _run_news_conflict_extraction_sync() calls — rather than
running the real feed-fetch loop, which needs live network access to ~270 RSS
feeds and is not something a repeatable unit test should depend on.

Usage:
    cd backend
    python3 test_news_near_duplicate.py
"""
import os
import sys
import uuid

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
print("  Near-duplicate article detection test")
print("=" * 70)

tag = uuid.uuid4().hex[:8]
url_a = f"https://outlet-a.test/{tag}/tanker-strike"
url_b = f"https://outlet-b.test/{tag}/tanker-strike-reworded"
url_c = f"https://outlet-c.test/{tag}/unrelated-story"

title_a = "Houthi rebels strike oil tanker near Bab el-Mandeb strait"
summary_a = (
    "A commercial oil tanker was struck by a missile fired from Houthi-controlled "
    "territory in Yemen as it transited the Bab el-Mandeb strait, the latest in a "
    "series of attacks on Red Sea shipping."
)

# Same real-world event, meaningfully different wording, different outlet/URL —
# a realistic wire-service rewrite, not an identical string.
title_b = "Yemen's Houthi militants hit oil tanker with missile near Red Sea strait"
summary_b = (
    "Yemen's Houthi militants hit an oil tanker with a missile close to the Bab "
    "el-Mandeb waterway, officials said, marking another attack on Red Sea "
    "maritime traffic."
)

# A genuinely different story — must NOT be treated as a duplicate of A.
title_c = "City council approves new public transit funding package"
summary_c = (
    "The city council voted 7-2 to approve a new funding package for public "
    "transit improvements, including expanded bus routes and station upgrades."
)

try:
    # ── First sighting of the story: novel, becomes the canonical entry ──────
    match_a = main._find_near_duplicate(url_a, title_a, summary_a)
    check("first sighting of a story is NOT flagged as a duplicate", match_a is None, f"match={match_a}")

    # Register article A's own store entry, the way the real loop's
    # _upsert_news_article call does for every non-suppressed article.
    main._upsert_news_article({
        "url": url_a, "title": title_a, "source": "Outlet A", "summary": summary_a[:400],
        "published": "2026-08-01T00:00:00+00:00", "expires_at": "2026-12-01T00:00:00+00:00",
        "tier": 1, "llm_relevance_score": 8.0,
    })

    # ── Article B: same event, different outlet, reworded ────────────────────
    match_b = main._find_near_duplicate(url_b, title_b, summary_b)
    check("reworded same-event article IS flagged as a near-duplicate", match_b is not None, f"match={match_b}")

    canonical_b, score_b = match_b if match_b else (None, 0.0)
    check("near-duplicate resolves to article A's URL as canonical",
          canonical_b == url_a, f"canonical={canonical_b} expected={url_a}")
    check("near-duplicate similarity score clears the configured threshold",
          match_b is not None and score_b >= main._NEAR_DUP_THRESHOLD,
          f"score={score_b} threshold={main._NEAR_DUP_THRESHOLD}")

    if match_b:
        main._attach_duplicate_report(canonical_b, {
            "url": url_b, "source": "Outlet B", "published": "2026-08-01T00:10:00+00:00",
        })

    # ── Article C: genuinely unrelated story — must NOT collapse into A ──────
    match_c = main._find_near_duplicate(url_c, title_c, summary_c)
    check("unrelated article is NOT flagged as a duplicate of the tanker story",
          match_c is None or match_c[0] != url_a, f"match={match_c}")

    # ── Confirm the canonical record now carries the "also reported by" entry
    canonical_record = main._NEWS_ARTICLE_STORE.get(url_a)
    check("canonical article record exists in the store", canonical_record is not None)
    if canonical_record:
        also = canonical_record.get("also_reported_by") or []
        check("canonical record's also_reported_by lists the duplicate outlet",
              any(a.get("url") == url_b for a in also), f"also_reported_by={also}")
    check("duplicate outlet was NOT separately upserted as its own story card",
          main._NEWS_ARTICLE_STORE.get(url_b) is None,
          f"unexpected separate entry: {main._NEWS_ARTICLE_STORE.get(url_b)}")
finally:
    # ── Cleanup: remove this test's synthetic entries from shared in-memory state
    for u in (url_a, url_b, url_c):
        main._NEWS_VECTOR_CACHE.pop(u, None)
    with main._NEWS_STORE_LOCK:
        main._NEWS_ARTICLE_STORE.pop(url_a, None)
        main._NEWS_ARTICLE_STORE.pop(url_b, None)
        main._NEWS_ARTICLE_STORE.pop(url_c, None)

print("=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
else:
    print("  RESULT: ALL CHECKS PASSED")
print("=" * 70)

if __name__ == "__main__":
    sys.exit(1 if FAILURES else 0)
