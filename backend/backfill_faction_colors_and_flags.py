"""
backfill_faction_colors_and_flags.py — real, one-time backfill for two new
real fields added to the GeoConfirmed pipeline (fix/geoconfirmed-markers-
and-ontology-graph-rebuild, Parts 1 & 3):

  1. GeoConfirmedPlacemark.faction_color / faction_invert_color — real,
     per-theatre faction color GeoConfirmed's own bulk placemark API serves
     (GET /api/Placemark/{slug}), confirmed live 2026-09. geoconfirmed.py's
     upsert_theatre_placemarks() now captures this for every NEWLY-synced
     placemark going forward, but the ~74,500 real rows already stored
     (mostly from the historic backfill run earlier this session) predate
     this fix and have these columns NULL.
  2. GeoConfirmedOrbatNode.flag_path — GeoConfirmed's own real `patches`
     field on ORBAT tree nodes, confirmed live 2026-09. upsert_orbat_tree()
     now captures this going forward too; existing rows predate it.

This does NOT re-fetch placemark or ORBAT detail per-row (tens of thousands
of real placemarks — that would mean tens of thousands of real HTTP calls
for a one-time backfill). Instead:
  - One real bulk faction-color fetch per real theatre already present in
    the DB (11 theatres -> 11 real API calls), then one SQL UPDATE per
    (theatre, faction name) pair matching the already-stored `faction`
    string — real color data, matched by real theatre+name, never guessed.
  - Re-runs upsert_orbat_tree() per theatre that has a real ORBAT tree
    (cheap: one real /api/Orbat + one real /api/OrbatNode call per theatre),
    which naturally re-populates flag_path on every existing ORBAT row.
  - Re-runs sync_ontology_from_geoconfirmed() once at the end so the real
    Country/Faction nodes in forge_ontology.json pick up flag_path too.

Reports real before/after counts — no row is silently skipped without being
counted as such.

Usage:
    cd backend
    python3 backfill_faction_colors_and_flags.py
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def run() -> dict:
    import geoconfirmed as gc
    from database import SessionLocal, GeoConfirmedPlacemark

    with SessionLocal() as db:
        theatres = [
            row[0] for row in
            db.query(GeoConfirmedPlacemark.theatre_slug).distinct().all()
        ]
    print(f"[backfill] real theatres with stored placemarks: {theatres}")

    before_null = None
    with SessionLocal() as db:
        before_null = db.query(GeoConfirmedPlacemark).filter(
            GeoConfirmedPlacemark.faction_color.is_(None)
        ).count()
        total = db.query(GeoConfirmedPlacemark).count()
    print(f"[backfill] before: {before_null} / {total} real rows with no faction_color")

    color_updates = 0
    color_fetch_failures = []
    for slug in theatres:
        try:
            fmap = gc.fetch_faction_colors_bulk(slug)
        except Exception as e:
            print(f"[backfill] faction color fetch failed for {slug}: {e}")
            color_fetch_failures.append(slug)
            continue
        if not fmap:
            print(f"[backfill] {slug}: no real faction color data returned")
            continue
        with SessionLocal() as db:
            for fname, fc in fmap.items():
                res = (
                    db.query(GeoConfirmedPlacemark)
                    .filter(
                        GeoConfirmedPlacemark.theatre_slug == slug,
                        GeoConfirmedPlacemark.faction == fname,
                        GeoConfirmedPlacemark.faction_color.is_(None),
                    )
                    .update(
                        {
                            GeoConfirmedPlacemark.faction_color: fc["color"],
                            GeoConfirmedPlacemark.faction_invert_color: fc["invert_color"],
                        },
                        synchronize_session=False,
                    )
                )
                color_updates += res
            db.commit()
        print(f"[backfill] {slug}: real faction colors known for {list(fmap.keys())}")

    with SessionLocal() as db:
        after_null = db.query(GeoConfirmedPlacemark).filter(
            GeoConfirmedPlacemark.faction_color.is_(None)
        ).count()
    print(f"[backfill] after: {after_null} / {total} real rows still with no faction_color "
          f"(real rows updated this pass: {color_updates})")

    orbat_results = {}
    with SessionLocal() as db:
        for slug in theatres:
            try:
                orbat_results[slug] = gc.upsert_orbat_tree(slug, db)
            except Exception as e:
                orbat_results[slug] = {"error": str(e)}
    print(f"[backfill] real ORBAT tree re-sync (repopulates flag_path): {orbat_results}")

    with SessionLocal() as db:
        ontology_stats = gc.sync_ontology_from_geoconfirmed(db)
    print(f"[backfill] real ontology re-sync (Country/Faction nodes pick up flag_path): {ontology_stats}")

    return {
        "theatres": theatres,
        "before_null_faction_color": before_null,
        "after_null_faction_color": after_null,
        "total_rows": total,
        "color_rows_updated": color_updates,
        "color_fetch_failures": color_fetch_failures,
        "orbat_results": orbat_results,
        "ontology_stats": ontology_stats,
    }


if __name__ == "__main__":
    import json
    result = run()
    print("\n" + json.dumps(result, indent=2, default=str))
