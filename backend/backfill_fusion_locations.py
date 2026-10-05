"""
backfill_fusion_locations.py — give the stored fusions back their position.

A fusion's title is DERIVED from its signals and then STORED, so fixing
_best_location_name only helps fusions created afterwards: 484 of 811 rows
already say "Unknown Location Intelligence Event" while holding a perfectly
good lat/lon in their own columns.

This rewrites `location_name` and `title` for exactly those rows, from the
coordinates on the row itself. Nothing is invented: a row with no position
is left alone, and the narrative text is not touched — only the place it
claims not to know.

    python backfill_fusion_locations.py           # dry run
    python backfill_fusion_locations.py --apply
"""
from __future__ import annotations

import argparse
import os
import sqlite3


def coord_name(lat, lon) -> str | None:
    try:
        lat, lon = float(lat), float(lon)
    except (TypeError, ValueError):
        return None
    return (f"{abs(lat):.2f}°{'N' if lat >= 0 else 'S'} "
            f"{abs(lon):.2f}°{'E' if lon >= 0 else 'W'}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()

    db = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "akili.db")
    con = sqlite3.connect(db, timeout=60)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT id, fusion_id, title, location_name, lat, lon, geo_key FROM fusion_events"
        " WHERE (location_name IS NULL OR location_name = '' OR location_name = 'Unknown Location')"
    ).fetchall()

    fixed = skipped = 0
    for r in rows:
        # The row's own position first, then the key it is filed under:
        # "CTY:mx" is Mexico and "GEO:19.25,-99.25" is a point. Both were
        # being discarded in favour of the words "Unknown Location".
        name = coord_name(r["lat"], r["lon"])
        if not name:
            from fusion_engine import _name_from_geo_key
            name = _name_from_geo_key(r["geo_key"])
        if not name:
            skipped += 1
            continue
        # Only the words that claim ignorance of the place are replaced.
        title = (r["title"] or "").replace("Unknown Location", name) or f"{name} Intelligence Event"
        if a.apply:
            con.execute("UPDATE fusion_events SET location_name = ?, title = ? WHERE id = ?",
                        (name, title, r["id"]))
        elif fixed < 5:
            print(f"  {r['title']!r}\n    -> {title!r}")
        fixed += 1

    if a.apply:
        con.commit()
    left = con.execute(
        "SELECT COUNT(*) FROM fusion_events WHERE title LIKE '%Unknown Location%'").fetchone()[0]
    con.close()
    print(f"\n{fixed} row(s) {'updated' if a.apply else 'would be updated'}; "
          f"{skipped} have no position and no key that names one")
    print(f"{left} row(s) still say Unknown Location "
          f"({'genuinely positionless' if a.apply else 'before applying'})")


if __name__ == "__main__":
    main()
