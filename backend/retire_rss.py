"""
retire_rss.py — real, one-time RSS retirement pass (fix/geoconfirmed-real-
backbone). RSS ingestion is fully retired: the scheduled ingestion loops are
removed (see main.py), and GeoConfirmed is now the real source for news/
conflict signals everywhere RSS/NewsArticle used to feed.

Real disposition decision for existing NewsArticle rows: SOFT-DELETE, never
a hard delete. Reasoning, stated plainly: a real report snapshot, a real
export, or a real OntologyLink row (source_type="article") may already cite
an existing NewsArticle by its real url/id. A hard delete would silently
dangle every one of those real citations. Soft-delete (status="retired")
means:
  - every real current/future query that should only see live data filters
    on status="active" (or simply stops querying NewsArticle at all, as
    every real consumer this pass touched now does)
  - every existing real citation/reference still resolves to a real row
    with its real original content, forever

Usage (from backend/):
    python3 retire_rss.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))


def retire_all() -> dict:
    from database import Base, engine, migrate_db, SessionLocal, NewsArticle

    migrate_db()
    Base.metadata.create_all(bind=engine)

    with SessionLocal() as db:
        total = db.query(NewsArticle).count()
        already_retired = db.query(NewsArticle).filter(NewsArticle.status == "retired").count()
        updated = (
            db.query(NewsArticle)
            .filter(NewsArticle.status != "retired")
            .update({NewsArticle.status: "retired"}, synchronize_session=False)
        )
        db.commit()
        return {"total_rows": total, "already_retired": already_retired, "newly_retired": updated}


if __name__ == "__main__":
    import json
    print(json.dumps(retire_all(), indent=2))
