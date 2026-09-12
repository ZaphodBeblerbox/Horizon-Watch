"""
backfill_alert_provenance.py — real, one-time backfill of origin_class/
licence_tier for existing `alerts` rows (Parallax translation step 1,
Part 2).

The new columns were added with no column default (provenance varies per
row by real Alert.source), so only NEW rows written after this round's
alert_writer.write_alert() change get populated automatically. This
backfills the real existing rows using the exact same real mapping
(provenance.py's provenance_for_alert_source()), so a query made today
doesn't see tens of thousands of real historical rows sitting null for a
source this app already has a real classification for.

Reports real before/after counts — no row's provenance is silently guessed
at for a source not in the real mapping table (surge/fusion/manual stay
null, honestly unclassified).

Usage:
    cd backend
    python3 backfill_alert_provenance.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))


def run() -> dict:
    from database import SessionLocal, Alert
    from provenance import provenance_for_alert_source, ALERT_SOURCE_PROVENANCE

    with SessionLocal() as db:
        before_null = db.query(Alert).filter(Alert.origin_class.is_(None)).count()
        total = db.query(Alert).count()
        print(f"[backfill] before: {before_null} / {total} real alert rows with no origin_class")

        updated_by_source = {}
        # Real distinct source strings currently in the table (handles the
        # real case-variance found live: 'AIS' and 'ais' both exist).
        distinct_sources = [r[0] for r in db.query(Alert.source).distinct().all()]
        for src in distinct_sources:
            oclass, ltier = provenance_for_alert_source(src)
            if oclass is None:
                continue  # honestly unclassified source (surge/fusion/manual/etc) — never guessed at
            res = (
                db.query(Alert)
                .filter(Alert.source == src, Alert.origin_class.is_(None))
                .update({Alert.origin_class: oclass, Alert.licence_tier: ltier}, synchronize_session=False)
            )
            updated_by_source[src] = {"origin_class": oclass, "licence_tier": ltier, "rows_updated": res}
        db.commit()

        after_null = db.query(Alert).filter(Alert.origin_class.is_(None)).count()
        print(f"[backfill] after: {after_null} / {total} real alert rows with no origin_class")
        print(f"[backfill] by real source: {updated_by_source}")

        return {
            "before_null": before_null, "after_null": after_null, "total": total,
            "updated_by_source": updated_by_source,
            "real_mapping_used": ALERT_SOURCE_PROVENANCE,
        }


if __name__ == "__main__":
    import json
    print(json.dumps(run(), indent=2, default=str))
