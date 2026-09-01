"""
backfill_article_classification.py — one-off, bounded real reclassification
of NewsArticle rows still sitting at the cheap fallback classification
(tier=3, article_type="other" — see main.py's _STATIC_FALLBACK_INTEL) because
they were ingested while MAX_LLM_CALLS_PER_CYCLE was cut to 8/cycle for cost
reduction. Real Claude credits are available again and that cap has been
restored (main.py), but that only helps NEWLY-ingested articles — this
script gives the *existing* recent backlog a real classification too, using
the exact same real analyse_article() call the live funnel uses (same
model, same budget/cap awareness, same fallback-on-failure behavior).

Bounded and safe to re-run: only touches rows that still look like the
fallback default, orders by recency, and stops at `--limit` (respects
usage_tracker's real daily budget on top of that — analyse_article() itself
returns the fallback once the cap is hit, so a real budget overrun isn't
possible here).

Usage:
    cd backend
    python3 backfill_article_classification.py [--limit N] [--hours H]
"""
import argparse
import os
import sys

os.environ.setdefault("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
load_dotenv()

from datetime import datetime, timedelta

from article_intelligence import analyse_article
from database import NewsArticle, get_db

parser = argparse.ArgumentParser()
parser.add_argument("--limit", type=int, default=60)
parser.add_argument("--hours", type=int, default=24)
args = parser.parse_args()

cutoff = datetime.utcnow() - timedelta(hours=args.hours)

with get_db() as db:
    candidates = (
        db.query(NewsArticle)
        .filter(
            NewsArticle.ingested_at >= cutoff,
            NewsArticle.tier == 3,
            NewsArticle.article_type == "other",
        )
        .order_by(NewsArticle.ingested_at.desc())
        .limit(args.limit)
        .all())
    print(f"Found {len(candidates)} fallback-classified articles from the last {args.hours}h (limit {args.limit})")

    reclassified = 0
    for row in candidates:
        result = analyse_article(row.title, row.body, row.source_name)
        # Every real fallback path in analyse_article() (auth/network
        # failure, budget cap hit, bad JSON) returns an empty
        # context_summary — the prompt requires Haiku to always produce a
        # real 1-2 sentence summary on genuine success, so this is a robust,
        # single-condition way to tell "a real classification happened"
        # from "nothing changed, don't overwrite the row with a fallback".
        if not (result.get("context_summary") or "").strip():
            print(f"  [skip] no real classification (fallback) — {(row.title or '')[:70]}")
            continue
        row.tier = result.get("tier", row.tier)
        row.article_type = result.get("article_type", row.article_type)
        row.relevance_score = result.get("relevance_score", row.relevance_score)
        row.event_title = result.get("event_title") or row.event_title
        row.context_summary = result.get("context_summary") or row.context_summary
        reclassified += 1
        print(f"  [{row.tier}] {result.get('article_type')} (score {result.get('relevance_score')}) — {(row.event_title or row.title or '')[:70]}")
    db.commit()
    print(f"\nReclassified {reclassified}/{len(candidates)} with a real Claude result.")
