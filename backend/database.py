from sqlalchemy import create_engine, Column, String, Boolean, DateTime, Text, ForeignKey, Float, Integer, JSON, UniqueConstraint, Index
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from contextlib import contextmanager
import uuid, datetime, os

DATABASE_URL = f"sqlite:///{os.getenv('DATA_DIR', './data')}/akili.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class User(Base):
    __tablename__ = "users"
    id                  = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    email               = Column(String, unique=True, index=True, nullable=False)
    password_hash       = Column(String, nullable=False)
    name                = Column(String, default="")
    role                = Column(String, default="observer")   # observer | analyst | admin
    is_super_admin      = Column(Boolean, default=False)
    approved            = Column(Boolean, default=False)
    created_at          = Column(DateTime, default=datetime.datetime.utcnow)
    last_login          = Column(DateTime, nullable=True)
    reset_token         = Column(String, nullable=True)
    reset_token_expires = Column(DateTime, nullable=True)
    notes               = Column(Text, default="")
    # Session tracking (admin surveillance, silent)
    last_ip             = Column(String, nullable=True)
    last_seen           = Column(DateTime, nullable=True)
    current_view        = Column(Text, nullable=True)   # JSON: {lat, lon, zoom, event}
    location_lat        = Column(Float, nullable=True)
    location_lon        = Column(Float, nullable=True)
    location_city       = Column(String, nullable=True)
    location_updated    = Column(DateTime, nullable=True)
    location_consent    = Column(Boolean, default=False)


class DirectMessage(Base):
    __tablename__ = "direct_messages"
    id              = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    sender_id       = Column(String, ForeignKey("users.id"), nullable=False)
    recipient_id    = Column(String, ForeignKey("users.id"), nullable=False)
    content         = Column(Text, nullable=False)
    message_type    = Column(String, default="text")   # text | poi | briefing
    attachment_id   = Column(String, nullable=True)    # POI id or briefing id
    timestamp       = Column(DateTime, default=datetime.datetime.utcnow)
    read_at         = Column(DateTime, nullable=True)


class AircraftHistory(Base):
    __tablename__ = 'aircraft_history'

    id           = Column(Integer, primary_key=True)
    icao24       = Column(String(10), index=True)
    callsign     = Column(String(20))
    lat          = Column(Float)
    lon          = Column(Float)
    altitude     = Column(Integer)
    speed        = Column(Float)
    heading      = Column(Float)
    aircraft_type = Column(String(20))
    is_military  = Column(Boolean, default=False)
    timestamp    = Column(DateTime, index=True)


class VesselHistory(Base):
    __tablename__ = 'vessel_history'

    id             = Column(Integer, primary_key=True)
    mmsi           = Column(String(15), index=True)
    name           = Column(String(100))
    ship_type      = Column(Integer)
    ship_type_text = Column(String(50))
    lat            = Column(Float)
    lon            = Column(Float)
    speed          = Column(Float)
    heading        = Column(Float)
    flag           = Column(String(10))
    destination    = Column(String(100))
    timestamp      = Column(DateTime, index=True)


class TrackDensity(Base):
    """Hourly grid-cell aggregation of AIS / ADS-B positions.
    One row per (grid_lat, grid_lon, hour, domain) tuple. Replaces the
    multi-million-row raw history tables for heatmaps and trend graphs."""
    __tablename__ = "track_density"

    id           = Column(Integer, primary_key=True)
    grid_lat     = Column(Float, index=True)     # rounded to 0.1° (~11km)
    grid_lon     = Column(Float, index=True)
    hour         = Column(DateTime, index=True)  # truncated to hour
    domain       = Column(String(10), index=True) # 'ais' or 'adsb'
    count        = Column(Integer, default=0)    # unique tracks this cell-hour
    vessel_types = Column(JSON, nullable=True)   # {'cargo': 5, 'tanker': 3, ...}
    avg_speed    = Column(Float, nullable=True)
    updated_at   = Column(DateTime, default=datetime.datetime.utcnow,
                          onupdate=datetime.datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("grid_lat", "grid_lon", "hour", "domain",
                         name="uq_density_cell_hour_domain"),
        Index("ix_density_hour_domain", "hour", "domain"),
    )


class CableSegment(Base):
    __tablename__ = "cable_segments"

    id                 = Column(Integer, primary_key=True)
    cable_id           = Column(String, unique=True, index=True, nullable=False)
    cable_name         = Column(String, nullable=False)
    owners             = Column(String, nullable=True)   # comma-separated
    rfs_year           = Column(Integer, nullable=True)
    length_km          = Column(Integer, nullable=True)
    geometry           = Column(JSON, nullable=False)    # raw GeoJSON geometry object
    country_a          = Column(String, nullable=True)   # first landing country
    country_b          = Column(String, nullable=True)   # last landing country
    all_countries      = Column(String, nullable=True)   # comma-separated sorted unique
    landing_point_ids  = Column(String, nullable=True)   # comma-separated LP ids


class LandingPoint(Base):
    __tablename__ = "landing_points"

    id                = Column(Integer, primary_key=True)
    landing_point_id  = Column(String, unique=True, index=True, nullable=False)
    name              = Column(String, nullable=False)
    country           = Column(String, nullable=True)
    latitude          = Column(Float, nullable=False)
    longitude         = Column(Float, nullable=False)
    cable_ids         = Column(String, nullable=True)   # comma-separated cable ids


class WeeklySnapshot(Base):
    __tablename__ = 'weekly_snapshots'

    id               = Column(Integer, primary_key=True)
    week_start       = Column(DateTime, index=True)
    week_end         = Column(DateTime)
    maritime_stats   = Column(Text)   # JSON
    aviation_stats   = Column(Text)   # JSON
    news_stats       = Column(Text)   # JSON
    alert_stats      = Column(Text)   # JSON
    summary          = Column(Text)
    threat_assessment = Column(Text)  # JSON
    trends           = Column(Text)   # JSON
    created_at       = Column(DateTime, default=datetime.datetime.utcnow)


@contextmanager
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def migrate_db():
    """Add missing columns to existing database and create new tables."""
    import sqlite3, os
    db_path = os.getenv('DATA_DIR', './data') + '/akili.db'
    if not os.path.exists(db_path):
        return
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cols = [
        ('last_ip', 'TEXT'),
        ('last_seen', 'DATETIME'),
        ('current_view', 'TEXT'),
        ('location_lat', 'REAL'),
        ('location_lon', 'REAL'),
        ('location_city', 'TEXT'),
        ('location_updated', 'DATETIME'),
        ('location_consent', 'BOOLEAN DEFAULT 0'),
    ]
    existing = [row[1] for row in cur.execute('PRAGMA table_info(users)').fetchall()]
    for col, typ in cols:
        if col not in existing:
            cur.execute(f'ALTER TABLE users ADD COLUMN {col} {typ}')
            print(f'[db-migrate] added column: {col}')

    # cable_segments enrichment columns
    cable_cols = [
        ('country_a',         'TEXT'),
        ('country_b',         'TEXT'),
        ('all_countries',     'TEXT'),
        ('landing_point_ids', 'TEXT'),
    ]
    tables = [row[0] for row in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    if 'cable_segments' in tables:
        cs_existing = [row[1] for row in cur.execute('PRAGMA table_info(cable_segments)').fetchall()]
        for col, typ in cable_cols:
            if col not in cs_existing:
                cur.execute(f'ALTER TABLE cable_segments ADD COLUMN {col} {typ}')
                print(f'[db-migrate] cable_segments: added column {col}')

    conn.commit()
    conn.close()
    # Create new tables via SQLAlchemy (idempotent)
    Base.metadata.create_all(bind=engine)

def init_db():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        from passlib.context import CryptContext
        pwd = CryptContext(schemes=["bcrypt"])
        super_admins = [
            {"email": "marc-amay.lunau@trifecta-technologies.com", "name": "Marc (Trifecta)"},
            {"email": "marcamaylun@gmail.com",                     "name": "Marc (Personal)"},
        ]
        for sa in super_admins:
            existing = db.query(User).filter(User.email == sa["email"]).first()
            if existing:
                # Always ensure super admins have correct role
                existing.role          = "admin"
                existing.is_super_admin = True
                existing.approved      = True
            else:
                db.add(User(
                    email          = sa["email"],
                    name           = sa["name"],
                    password_hash  = pwd.hash("Password1"),
                    role           = "admin",
                    is_super_admin = True,
                    approved       = True,
                ))
        db.commit()
    finally:
        db.close()
