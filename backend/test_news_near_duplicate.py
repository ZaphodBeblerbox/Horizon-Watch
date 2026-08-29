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

REGRESSION COVERAGE (added after a real, live bug — see
relevance_embedding.py's module docstring for the full root-cause writeup):
running the real pipeline against real RSS feeds produced completely
unrelated articles suppressed as "near-duplicates" of each other at cosine
scores of 0.30-0.75 under the OLD (plain hashed-TF, no IDF) mechanism, via
TWO distinct failure modes both reproduced below:
  1. Generic news vocabulary ("said", "according", "official", weekday
     names) inflating cosine similarity between any two news articles.
  2. Literal, byte-identical syndication-boilerplate text that some RSS
     feeds wrap around EVERY article's <summary> field (a real, confirmed
     pattern — see relevance_embedding.py's docstring for the verbatim text
     found live) making completely unrelated articles from the SAME outlet
     look near-identical.
This file's "diverse realistic sample" and "syndication boilerplate
regression" sections exercise both failure modes directly and assert real
score separation, not just 1-2 hand-picked examples.

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
import relevance_embedding  # noqa: E402

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


# ══════════════════════════════════════════════════════════════════════════
#  REGRESSION: diverse realistic sample — genuine near-duplicates must score
#  meaningfully higher than genuinely unrelated pairs, with a real margin a
#  single threshold can separate. This is exactly the kind of check that was
#  missing before the live false-positive bug shipped (the original test only
#  had ONE hand-picked duplicate pair and ONE hand-picked unrelated pair).
# ══════════════════════════════════════════════════════════════════════════
print()
print("=" * 70)
print("  Diverse realistic sample: near-duplicate vs unrelated separation")
print("=" * 70)

relevance_embedding.reset_corpus()

# Realistic "background" articles registered first, so IDF weights reflect a
# warmed-up corpus the way a real news cycle actually builds one up (every
# article registers via embed_and_learn before the next one is compared).
_BACKGROUND = [
    ("Stock markets rally on tech earnings",
     "Major indices rose Wednesday as strong tech-sector earnings boosted "
     "investor confidence, analysts said, extending a weeks-long rally."),
    ("New species of frog discovered in rainforest",
     "Researchers announced the discovery of a new frog species in a remote "
     "rainforest region, according to a study published Tuesday."),
    ("Election commission certifies results after recount",
     "The election commission certified the results Tuesday following a "
     "recount, officials said, ending weeks of legal challenges."),
    ("Flooding closes major highway for third day",
     "Authorities kept a major highway closed for a third day Wednesday as "
     "floodwaters receded slowly, according to transport officials."),
    ("Startup raises funding round for AI tool",
     "The startup announced Tuesday it had raised a new funding round to "
     "expand its AI-powered software, the company said in a statement."),
    ("Local team wins championship in dramatic final",
     "The team won the championship Tuesday in a dramatic final match, "
     "according to league officials, sparking celebrations citywide."),
    ("Airline adds new routes amid demand surge",
     "The airline said Wednesday it would add new routes in response to "
     "rising travel demand, according to a company statement."),
    ("Court sentences man for fraud scheme",
     "A court sentenced a man to prison Tuesday for running a multi-year "
     "fraud scheme, prosecutors said, ordering restitution to victims."),
    ("Museum unveils renovated wing after years of work",
     "The museum unveiled its renovated wing Wednesday after years of "
     "construction, according to officials, with new galleries opening."),
    ("Farmers protest new agricultural regulations",
     "Farmers protested new agricultural regulations Tuesday, blocking "
     "roads in several regions, according to organizers and local police."),
    ("Central bank holds interest rates steady",
     "The central bank held interest rates steady Wednesday, officials "
     "said, citing mixed signals on inflation and employment data."),
    ("City unveils plan to expand public parks",
     "City officials unveiled a plan Tuesday to expand public parks over "
     "the next five years, according to a statement from the mayor's office."),
    ("Researchers publish study on ocean temperatures",
     "Researchers published a study Wednesday showing rising ocean "
     "temperatures, according to the paper, warning of impacts on marine "
     "ecosystems."),
    ("Government announces new education funding",
     "The government announced new funding for education Tuesday, "
     "according to the ministry, aimed at improving school infrastructure."),
    ("Tech giant faces antitrust probe in new market",
     "A tech giant is facing a new antitrust probe, regulators said "
     "Wednesday, the latest in a series of investigations into the "
     "company's practices."),
]

# Genuine near-duplicates: same real-world event, different outlet, realistic
# rewording (not identical strings).
_DUPES = [
    ("Houthi rebels strike oil tanker near Bab el-Mandeb strait",
     "A commercial oil tanker was struck by a missile fired from "
     "Houthi-controlled territory in Yemen as it transited the Bab "
     "el-Mandeb strait on Tuesday, officials said, the latest in a series "
     "of attacks on Red Sea shipping.",
     "Yemen's Houthi militants hit oil tanker with missile near Red Sea strait",
     "Yemen's Houthi militants hit an oil tanker with a missile close to "
     "the Bab el-Mandeb waterway on Tuesday, according to maritime "
     "security officials, marking another attack on Red Sea shipping "
     "traffic."),
    ("Delivery rider rams scooter into knife attacker, gets named local hero",
     "A delivery rider has been named a local hero after ramming his "
     "scooter into a man armed with a knife who was attacking pedestrians "
     "on a busy high street, police said Wednesday, adding the attacker "
     "was arrested at the scene.",
     "Food delivery driver hailed hero for using scooter to stop knife attacker",
     "A food delivery driver is being hailed a hero after he used his "
     "scooter to ram a knife-wielding attacker who had been assaulting "
     "people on a high street, according to police, who confirmed the "
     "suspect was taken into custody."),
    ("South Korea to cut infant-care fees to boost birth rate",
     "South Korea's government announced Wednesday it will reduce "
     "infant-care fees as part of a package of measures aimed at "
     "reversing the country's record-low birth rate, the health ministry "
     "said.",
     "World's second richest country to reduce infant-care fees to raise births",
     "The government said Wednesday it would cut infant-care and "
     "childcare fees, the latest in a series of subsidies meant to raise "
     "the nation's birth rate, which remains among the lowest in the "
     "world according to the health ministry."),
    ("Wildfire forces evacuation of thousands near coastal town",
     "Thousands of residents were ordered to evacuate a coastal town on "
     "Thursday as a fast-moving wildfire, fanned by high winds, "
     "threatened homes and businesses, local officials said.",
     "Thousands evacuated as fast-moving wildfire nears coastal community",
     "Local officials ordered the evacuation of thousands of people from "
     "a coastal community on Thursday after a wildfire, driven by strong "
     "winds, advanced toward residential neighborhoods."),
]

# Genuinely unrelated pairs spanning diverse topics/regions — includes the
# EXACT false-positive regression cases from the live bug (a Vietnam-US
# diplomacy article falsely matched to a scooter/knife-attack rescue story,
# a K-pop-adjacent hacking story, and an infant-care-subsidy story). The
# literal live RSS text from that incident isn't preserved anywhere (RSS
# entries are transient), so these are realistic reconstructions using the
# same real headlines/subject matter reported in the original bug.
_UNRELATED = [
    ("Vietnam and US begin talks on roadmap for concrete partnership results",
     "Vietnamese and American officials met in Hanoi on Tuesday to begin "
     "talks on a roadmap for concrete partnership results, the ambassador "
     "said, describing the discussions as a step toward deeper bilateral "
     "cooperation.",
     "Delivery rider rams scooter into knife attacker, gets named local hero",
     "A delivery rider has been named a local hero after ramming his "
     "scooter into a man armed with a knife who was attacking pedestrians "
     "on a busy high street, police said Wednesday, adding the attacker "
     "was arrested at the scene."),
    ("Vietnam and US begin talks on roadmap for concrete partnership results",
     "Vietnamese and American officials met in Hanoi on Tuesday to begin "
     "talks on a roadmap for concrete partnership results, the ambassador "
     "said, describing the discussions as a step toward deeper bilateral "
     "cooperation.",
     "Chinese hacker who broke into stock account of BTS's Jungkook sentenced",
     "A Chinese national who hacked into the brokerage account of BTS "
     "member Jungkook and made unauthorized trades was sentenced to two "
     "years in prison on Tuesday, according to prosecutors, who said the "
     "scheme netted significant losses for the victim."),
    ("Vietnam and US begin talks on roadmap for concrete partnership results",
     "Vietnamese and American officials met in Hanoi on Tuesday to begin "
     "talks on a roadmap for concrete partnership results, the ambassador "
     "said, describing the discussions as a step toward deeper bilateral "
     "cooperation.",
     "World's second richest country to reduce infant-care fees to raise births",
     "The government said Wednesday it would cut infant-care and "
     "childcare fees, the latest in a series of subsidies meant to raise "
     "the nation's birth rate, which remains among the lowest in the "
     "world according to the health ministry."),
    ("City council approves new public transit funding package",
     "The city council voted 7-2 on Tuesday to approve a new funding "
     "package for public transit improvements, officials said, including "
     "expanded bus routes and station upgrades.",
     "Central bank raises interest rates to combat rising inflation",
     "The central bank raised its benchmark interest rate on Tuesday, "
     "officials said, in a bid to combat inflation that has remained "
     "stubbornly high in recent months according to the latest data."),
    ("Wildfire forces evacuation of thousands near coastal town",
     "Thousands of residents were ordered to evacuate a coastal town on "
     "Thursday as a fast-moving wildfire, fanned by high winds, "
     "threatened homes and businesses, local officials said.",
     "Tech company unveils new smartphone with improved battery life",
     "The company unveiled its latest smartphone on Thursday, officials "
     "said, touting improved battery life and a faster processor as its "
     "key selling points according to a press release."),
    ("Chinese hacker who broke into stock account of BTS's Jungkook sentenced",
     "A Chinese national who hacked into the brokerage account of BTS "
     "member Jungkook and made unauthorized trades was sentenced to two "
     "years in prison on Tuesday, according to prosecutors, who said the "
     "scheme netted significant losses for the victim.",
     "South Korea to cut infant-care fees to boost birth rate",
     "South Korea's government announced Wednesday it will reduce "
     "infant-care fees as part of a package of measures aimed at "
     "reversing the country's record-low birth rate, the health ministry "
     "said."),
    ("Houthi rebels strike oil tanker near Bab el-Mandeb strait",
     "A commercial oil tanker was struck by a missile fired from "
     "Houthi-controlled territory in Yemen as it transited the Bab "
     "el-Mandeb strait on Tuesday, officials said, the latest in a series "
     "of attacks on Red Sea shipping.",
     "City council approves new public transit funding package",
     "The city council voted 7-2 on Tuesday to approve a new funding "
     "package for public transit improvements, officials said, including "
     "expanded bus routes and station upgrades."),
    ("Military junta seizes power in coup, deploys troops nationwide",
     "Soldiers loyal to a breakaway military faction seized the "
     "presidential palace overnight, declaring a state of emergency and "
     "deploying troops to the capital after months of political crisis, "
     "officials said.",
     "Central bank raises interest rates to combat rising inflation",
     "The central bank raised its benchmark interest rate on Tuesday, "
     "officials said, in a bid to combat inflation that has remained "
     "stubbornly high in recent months according to the latest data."),
]

try:
    for t, s in _BACKGROUND:
        relevance_embedding.embed_and_learn(t, s)

    dup_scores = []
    for ta, sa, tb, sb in _DUPES:
        va = relevance_embedding.embed_and_learn(ta, sa)
        vb = relevance_embedding.embed_and_learn(tb, sb)
        score = relevance_embedding.cosine(va, vb)
        dup_scores.append(score)
        print(f"  dup      score={score:.3f}   {ta[:45]!r} ~ {tb[:45]!r}")

    unrel_scores = []
    for ta, sa, tb, sb in _UNRELATED:
        va = relevance_embedding.embed_and_learn(ta, sa)
        vb = relevance_embedding.embed_and_learn(tb, sb)
        score = relevance_embedding.cosine(va, vb)
        unrel_scores.append(score)
        print(f"  unrelated score={score:.3f}   {ta[:45]!r} ~ {tb[:45]!r}")

    print(f"  dup group:      min={min(dup_scores):.3f} max={max(dup_scores):.3f}")
    print(f"  unrelated group: min={min(unrel_scores):.3f} max={max(unrel_scores):.3f}")
    print(f"  _NEAR_DUP_THRESHOLD = {main._NEAR_DUP_THRESHOLD}")

    check("every genuine near-duplicate pair clears the threshold",
          all(s >= main._NEAR_DUP_THRESHOLD for s in dup_scores),
          f"scores={[round(s,3) for s in dup_scores]}")
    check("every unrelated pair (including the exact Vietnam/US regression "
          "cases from the live bug) stays below the threshold",
          all(s < main._NEAR_DUP_THRESHOLD for s in unrel_scores),
          f"scores={[round(s,3) for s in unrel_scores]}")
    check("real margin: the unrelated group's ceiling is below the "
          "duplicate group's floor (a single threshold cleanly separates them)",
          max(unrel_scores) < min(dup_scores),
          f"unrelated_max={max(unrel_scores):.3f} dup_min={min(dup_scores):.3f}")
finally:
    pass  # this section only touches relevance_embedding's module-level
          # corpus state, reset again below — no main.py store/cache entries
          # were created here.


# ══════════════════════════════════════════════════════════════════════════
#  REGRESSION: syndication-boilerplate contamination (the dominant real
#  failure mode found live). Several RSS feeds wrap EVERY article's summary
#  in an identical templated attribution/CTA block; the mechanism must not
#  let that alone make unrelated articles from the SAME outlet look like
#  duplicates. Uses a genericized version of the real structural pattern
#  confirmed live (see relevance_embedding.py's docstring) rather than the
#  literal third-party site text.
# ══════════════════════════════════════════════════════════════════════════
print()
print("=" * 70)
print("  Regression: same-outlet syndication-boilerplate contamination")
print("=" * 70)

relevance_embedding.reset_corpus()

_BOILERPLATE = (
    "<p>This article was originally published on NewsOutlet24, "
    "NewsOutlet24's #1 independent news platform.</p>\n"
    "<p>{content}</p>\n"
    "<p>Read the full article and more news at NewsOutlet24 — Breaking "
    "news, politics, and more.</p>"
)

_OUTLET_ARTICLES = [
    ("Husband forces wife into sex act, court told",
     "A man appeared in court Tuesday accused of forcing his wife into a "
     "sex act, prosecutors said, with the trial continuing this week."),
    ("Chess battle heats up ahead of national finals",
     "The national chess finals are heating up ahead of next week's "
     "matches, organizers said, with several top contenders still in the "
     "running."),
    ("Airport officer tells inquiry visibility was safe for landing",
     "An airport officer told an inquiry Tuesday that visibility met the "
     "minimum standard for landing at the time of the incident, according "
     "to transcripts."),
    ("27 church members killed in road crash",
     "Twenty-seven church members were killed Tuesday when their bus "
     "overturned on a rural road, police said, adding an investigation "
     "was underway."),
    ("City council debates new water tariff plan",
     "The city council debated a new water tariff plan Tuesday, according "
     "to minutes released Wednesday, with a final vote expected next "
     "month."),
]

try:
    boilerplate_scores = []
    vecs = []
    for title, content in _OUTLET_ARTICLES:
        summary_html = _BOILERPLATE.format(content=content)
        vecs.append((title, relevance_embedding.embed_and_learn(title, summary_html)))

    worst = 0.0
    for i in range(len(vecs)):
        for j in range(i + 1, len(vecs)):
            score = relevance_embedding.cosine(vecs[i][1], vecs[j][1])
            worst = max(worst, score)
            print(f"  same-outlet cross-topic score={score:.3f}   "
                  f"{vecs[i][0][:35]!r} ~ {vecs[j][0][:35]!r}")

    print(f"  worst (highest) cross-topic same-outlet score: {worst:.3f}  "
          f"(threshold={main._NEAR_DUP_THRESHOLD})")
    check("completely unrelated articles sharing only templated "
          "boilerplate stay below the near-duplicate threshold",
          worst < main._NEAR_DUP_THRESHOLD, f"worst={worst:.3f}")
finally:
    relevance_embedding.reset_corpus()

print("=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
else:
    print("  RESULT: ALL CHECKS PASSED")
print("=" * 70)

if __name__ == "__main__":
    sys.exit(1 if FAILURES else 0)
