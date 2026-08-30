"""
migrate_minimal.py — one-shot, read-only-on-the-SQLite-side migration of ONLY
the columns/rows needed for the two Postgres+PostGIS benchmark queries:

  QUERY A: alerts region+period+quality scoped query
    -> needs: alerts(id, status, alert_type, title, lat, lon, created_at)
  QUERY B: entity_linker proximity match (ports/cables/airports)
    -> needs: port_boundaries(id, port_name, latitude, longitude, system_id)
              airports(id, airport_name, latitude, longitude, system_id)
              cable_segments(id, cable_name, geometry, system_id)

Does NOT touch akili.db except an explicit read-only (mode=ro) connection.
Does NOT migrate raw_json, news_articles, sentinel_detections, vessel/aircraft
history, or any of the other large tables in the 6.5GB source DB — this
keeps the migrated copy in the tens-of-MB range on a machine with ~2.4GB
free disk.

Target: local Postgres 17 + PostGIS instance on port 5433 (scratch data dir,
unix socket in /tmp/pg17_nagini_sock — NOT the system's Homebrew
postgresql@15 service on 5432, which is left untouched).

Run: python3 migrate_minimal.py
"""
import os
import sys
import json
import sqlite3
import psycopg2
from psycopg2.extras import execute_values

SQLITE_DB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "akili.db")
PG_DSN = "host=/tmp/pg17_nagini_sock port=5433 dbname=nagini_bench"


def get_sqlite_ro():
    return sqlite3.connect(f"file:{SQLITE_DB}?mode=ro", uri=True)


def migrate_alerts(sconn, pconn):
    cur = sconn.cursor()
    cur.execute("""
        SELECT id, status, alert_type, title, lat, lon, created_at
        FROM alerts
    """)
    rows = cur.fetchall()
    print(f"  alerts: fetched {len(rows)} rows from SQLite")

    pcur = pconn.cursor()
    pcur.execute("DROP TABLE IF EXISTS alerts")
    pcur.execute("""
        CREATE TABLE alerts (
            id INTEGER PRIMARY KEY,
            status TEXT,
            alert_type TEXT,
            title TEXT,
            lat DOUBLE PRECISION,
            lon DOUBLE PRECISION,
            created_at TIMESTAMP
        )
    """)
    execute_values(pcur, "INSERT INTO alerts (id, status, alert_type, title, lat, lon, created_at) VALUES %s", rows)
    pconn.commit()
    print(f"  alerts: inserted {len(rows)} rows into Postgres")


def migrate_ports(sconn, pconn):
    cur = sconn.cursor()
    cur.execute("""
        SELECT id, system_id, port_name, latitude, longitude
        FROM port_boundaries
    """)
    rows = cur.fetchall()
    print(f"  port_boundaries: fetched {len(rows)} rows from SQLite")

    pcur = pconn.cursor()
    pcur.execute("DROP TABLE IF EXISTS ports")
    pcur.execute("""
        CREATE TABLE ports (
            id INTEGER PRIMARY KEY,
            system_id TEXT,
            port_name TEXT,
            latitude DOUBLE PRECISION,
            longitude DOUBLE PRECISION,
            geog GEOGRAPHY(Point, 4326)
        )
    """)
    expanded = [(id_, system_id, name, lat, lon, lon, lat) for (id_, system_id, name, lat, lon) in rows]
    execute_values(
        pcur,
        "INSERT INTO ports (id, system_id, port_name, latitude, longitude, geog) "
        "VALUES %s",
        expanded,
        template="(%s, %s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography)",
    )
    pconn.commit()
    print(f"  ports: inserted {len(rows)} rows into Postgres")


def migrate_airports(sconn, pconn):
    cur = sconn.cursor()
    cur.execute("""
        SELECT id, system_id, airport_name, latitude, longitude
        FROM airports
    """)
    rows = cur.fetchall()
    print(f"  airports: fetched {len(rows)} rows from SQLite")

    pcur = pconn.cursor()
    pcur.execute("DROP TABLE IF EXISTS airports")
    pcur.execute("""
        CREATE TABLE airports (
            id INTEGER PRIMARY KEY,
            system_id TEXT,
            airport_name TEXT,
            latitude DOUBLE PRECISION,
            longitude DOUBLE PRECISION,
            geog GEOGRAPHY(Point, 4326)
        )
    """)
    expanded = [(id_, system_id, name, lat, lon, lon, lat) for (id_, system_id, name, lat, lon) in rows]
    execute_values(
        pcur,
        "INSERT INTO airports (id, system_id, airport_name, latitude, longitude, geog) "
        "VALUES %s",
        expanded,
        template="(%s, %s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography)",
    )
    pconn.commit()
    print(f"  airports: inserted {len(rows)} rows into Postgres")


def migrate_cables(sconn, pconn):
    cur = sconn.cursor()
    cur.execute("""
        SELECT id, system_id, cable_name, geometry
        FROM cable_segments
    """)
    rows = cur.fetchall()
    print(f"  cable_segments: fetched {len(rows)} rows from SQLite")

    pcur = pconn.cursor()
    pcur.execute("DROP TABLE IF EXISTS cables")
    pcur.execute("""
        CREATE TABLE cables (
            id INTEGER PRIMARY KEY,
            system_id TEXT,
            cable_name TEXT,
            geog GEOGRAPHY(Geometry, 4326)
        )
    """)
    inserted = 0
    skipped = 0
    for (id_, system_id, cable_name, geometry) in rows:
        if not geometry:
            skipped += 1
            continue
        try:
            geojson_str = geometry if isinstance(geometry, str) else json.dumps(geometry)
            pcur.execute(
                "INSERT INTO cables (id, system_id, cable_name, geog) "
                "VALUES (%s, %s, %s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)::geography)",
                (id_, system_id, cable_name, geojson_str),
            )
            inserted += 1
        except Exception as e:
            print(f"    skipping cable {system_id or id_}: {e}")
            skipped += 1
    pconn.commit()
    print(f"  cables: inserted {inserted} rows into Postgres (skipped {skipped})")


def main():
    print("=" * 70)
    print("Migrating minimal tables: SQLite (read-only) -> Postgres 17/PostGIS")
    print(f"  source: {SQLITE_DB} (mode=ro)")
    print(f"  target: {PG_DSN}")
    print("=" * 70)

    sconn = get_sqlite_ro()
    pconn = psycopg2.connect(PG_DSN)

    try:
        print("\n[1/4] alerts (lat/lon subset of columns, all rows)")
        migrate_alerts(sconn, pconn)

        print("\n[2/4] ports (port_boundaries)")
        migrate_ports(sconn, pconn)

        print("\n[3/4] airports")
        migrate_airports(sconn, pconn)

        print("\n[4/4] cables (cable_segments)")
        migrate_cables(sconn, pconn)
    finally:
        sconn.close()
        pconn.close()

    print("\nDone. No indexes created yet (bench_postgres.py creates them mid-run to")
    print("A/B the no-index vs indexed case, matching the SQLite comparison point).")


if __name__ == "__main__":
    main()
