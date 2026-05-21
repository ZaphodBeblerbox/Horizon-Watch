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
    system_id          = Column(String, unique=True, nullable=True, index=True)  # CABLE-001 …
    infra_type         = Column(String, nullable=True, default="Submarine Cable")
    region_id          = Column(String, nullable=True, index=True)


class LandingPoint(Base):
    __tablename__ = "landing_points"

    id                = Column(Integer, primary_key=True)
    landing_point_id  = Column(String, unique=True, index=True, nullable=False)
    name              = Column(String, nullable=False)
    country           = Column(String, nullable=True)
    latitude          = Column(Float, nullable=False)
    longitude         = Column(Float, nullable=False)
    cable_ids         = Column(String, nullable=True)   # comma-separated cable ids


class PortBoundary(Base):
    __tablename__ = "port_boundaries"

    id                      = Column(Integer, primary_key=True)
    system_id               = Column(String, unique=True, index=True, nullable=False)  # PORT-0001 …
    port_name               = Column(String, nullable=False)
    country                 = Column(String, nullable=True)   # ISO-2 e.g. NL
    locode                  = Column(String, nullable=True)   # e.g. NLRTM
    region_id               = Column(String, nullable=True, index=True)
    latitude                = Column(Float, nullable=False)
    longitude               = Column(Float, nullable=False)
    port_size               = Column(String, nullable=True)   # Small/Medium/Large/Very Large
    shelter                 = Column(String, nullable=True)
    boundary_radius_metres  = Column(Integer, default=2000)
    infra_type              = Column(String, nullable=True, default="Port")
    port_metadata           = Column(Text, nullable=True)     # JSON string


class Airport(Base):
    __tablename__ = "airports"

    id            = Column(Integer, primary_key=True)
    system_id     = Column(String, unique=True, index=True, nullable=False)  # ARPT-00001 …
    ident         = Column(String, unique=True, index=True, nullable=True)   # OurAirports ident (reliable unique key)
    icao_code     = Column(String, nullable=True, index=True)                # 4-letter ICAO (may be empty)
    iata_code     = Column(String, nullable=True)                            # 3-letter IATA
    airport_name  = Column(String, nullable=False)
    airport_type  = Column(String, nullable=False)                           # large_airport | medium_airport | …
    country_code  = Column(String, nullable=True)                            # ISO-2
    country_name  = Column(String, nullable=True)
    region_id     = Column(String, nullable=True, index=True)
    latitude      = Column(Float, nullable=False)
    longitude     = Column(Float, nullable=False)
    elevation_ft  = Column(Integer, nullable=True)
    municipality  = Column(String, nullable=True)
    infra_type    = Column(String, nullable=True, default="Airport")
    airport_metadata = Column(Text, nullable=True)                          # JSON string


class RegionDefinition(Base):
    __tablename__ = "region_definitions"

    region_id   = Column(String, primary_key=True)
    region_name = Column(String, nullable=False)
    description = Column(String, nullable=True)


class OntologyEntity(Base):
    __tablename__ = "ontology_entities"

    system_id         = Column(String, primary_key=True)
    entity_type       = Column(String, nullable=False, index=True)
    name              = Column(String, nullable=False)
    infra_type        = Column(String, nullable=True)
    region_id         = Column(String, nullable=True, index=True)
    entity_metadata   = Column(Text, nullable=True)   # JSON string


class RuleConfig(Base):
    __tablename__ = "rule_configs"

    id           = Column(Integer, primary_key=True)
    name         = Column(String, nullable=True)                    # human-readable label
    rule_name    = Column(String, nullable=False, index=True)       # trigger_type key used by detectors
    trigger_type = Column(String, nullable=True, index=True)        # explicit alias, mirrors rule_name
    severity     = Column(String, nullable=True, default="medium")
    icon_type    = Column(String, nullable=True)
    enabled      = Column(Boolean, default=True)
    params       = Column(Text, nullable=False, default="{}")       # JSON string
    created_at   = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at   = Column(DateTime, default=datetime.datetime.utcnow,
                          onupdate=datetime.datetime.utcnow)


class EscalationChain(Base):
    __tablename__ = "escalation_chains"

    id                  = Column(Integer, primary_key=True)
    chain_name          = Column(String, nullable=False)
    rule_ids            = Column(String, nullable=False)   # comma-separated RuleConfig ids
    escalated_severity  = Column(String, nullable=False)
    escalated_icon_type = Column(String, nullable=False)
    time_window_minutes = Column(Integer, default=30)


class RuleConnection(Base):
    __tablename__ = "rule_connections"

    id                         = Column(Integer, primary_key=True)
    connection_name            = Column(String, nullable=False)
    rule_id_a                  = Column(Integer, nullable=False, index=True)
    rule_id_b                  = Column(Integer, nullable=False, index=True)
    relationship_type          = Column(String, nullable=False)  # ESCALATION | CORRELATION | SEQUENCE | SUPPRESSION
    escalated_severity         = Column(String, nullable=True)   # ESCALATION only
    escalated_icon_type        = Column(String, nullable=True)   # ESCALATION only
    sequence_window_minutes    = Column(Integer, nullable=True)  # SEQUENCE only
    suppression_window_minutes = Column(Integer, nullable=True)  # SUPPRESSION only
    time_window_minutes        = Column(Integer, default=30)     # ESCALATION + CORRELATION
    notes                      = Column(String, nullable=True)
    created_at                 = Column(DateTime, default=datetime.datetime.utcnow)


class WatchZone(Base):
    __tablename__ = "watch_zones"

    id                  = Column(Integer, primary_key=True)
    system_id           = Column(String, unique=True, index=True, nullable=False)
    name                = Column(String, nullable=False)
    description         = Column(String, nullable=True)
    polygon_geojson     = Column(Text, nullable=False)
    bbox_min_lon        = Column(Float, nullable=False)
    bbox_min_lat        = Column(Float, nullable=False)
    bbox_max_lon        = Column(Float, nullable=False)
    bbox_max_lat        = Column(Float, nullable=False)
    priority            = Column(String, nullable=False, default="medium")
    scan_interval_hours = Column(Integer, nullable=False, default=120)
    enabled             = Column(Boolean, default=True)
    created_by          = Column(String, nullable=True)
    created_at          = Column(DateTime, default=datetime.datetime.utcnow)
    last_scanned_at     = Column(DateTime, nullable=True)
    next_scan_at        = Column(DateTime, nullable=True)
    ml_tasks            = Column(Text, nullable=False, default="[]")
    alert_threshold     = Column(String, nullable=False, default="both")
    zone_metadata       = Column(Text, nullable=True)


class SentinelScan(Base):
    __tablename__ = "sentinel_scans"

    id                    = Column(Integer, primary_key=True)
    scan_id               = Column(String, unique=True, index=True, nullable=False)
    zone_id               = Column(Integer, ForeignKey("watch_zones.id"), nullable=False, index=True)
    triggered_by          = Column(String, nullable=False, default="schedule")
    status                = Column(String, nullable=False, default="pending")
    created_at            = Column(DateTime, default=datetime.datetime.utcnow)
    completed_at          = Column(DateTime, nullable=True)
    image_id              = Column(String, nullable=True)
    image_timestamp_utc   = Column(DateTime, nullable=True)
    cloud_cover_percent   = Column(Float, nullable=True)
    image_age_hours       = Column(Float, nullable=True)
    result_summary        = Column(Text, nullable=True)
    raw_result_json       = Column(Text, nullable=True)
    alert_fired           = Column(Boolean, default=False)
    error_message         = Column(String, nullable=True)


class SentinelDetection(Base):
    __tablename__ = "sentinel_detections"

    id                       = Column(Integer, primary_key=True)
    detection_id             = Column(String, unique=True, index=True, nullable=False)
    scan_id                  = Column(String, ForeignKey("sentinel_scans.scan_id"), nullable=False, index=True)
    zone_id                  = Column(Integer, ForeignKey("watch_zones.id"), nullable=False, index=True)
    object_type              = Column(String, nullable=False)
    confidence               = Column(Float, nullable=False)
    centroid_lat             = Column(Float, nullable=False)
    centroid_lon             = Column(Float, nullable=False)
    geo_geometry             = Column(Text, nullable=True)
    area_m2                  = Column(Float, nullable=True)
    severity                 = Column(String, nullable=False, default="info")
    alert_tier               = Column(String, nullable=False, default="silent")
    attributes               = Column(Text, nullable=True)
    image_crop_url           = Column(String, nullable=True)
    overlay_url              = Column(String, nullable=True)
    matched_to_ais           = Column(Boolean, default=False)
    nearest_port             = Column(String, nullable=True)
    nearest_infrastructure   = Column(String, nullable=True)
    nearest_chokepoint       = Column(String, nullable=True)
    created_at               = Column(DateTime, default=datetime.datetime.utcnow)


class ThreatMatrixSnapshot(Base):
    __tablename__ = "threat_matrix_snapshots"

    id                        = Column(Integer, primary_key=True)
    snapshot_date             = Column(String, nullable=False, index=True)  # YYYY-MM-DD
    region_name               = Column(String, nullable=False, index=True)
    region_id                 = Column(String, nullable=True)
    alert_count               = Column(Integer, default=0)
    forge_alert_count         = Column(Integer, default=0)
    sentinel_detection_count  = Column(Integer, default=0)
    news_event_count          = Column(Integer, default=0)
    threat_score              = Column(Float, default=0.0)
    threat_level              = Column(String, default="LOW")
    contributing_signals      = Column(Text, nullable=True)  # JSON array
    created_at                = Column(DateTime, default=datetime.datetime.utcnow)

    __table_args__ = (UniqueConstraint("snapshot_date", "region_id", name="uq_tm_date_region"),)


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


class FusionEvent(Base):
    __tablename__ = "fusion_events"

    id                      = Column(Integer, primary_key=True)
    fusion_id               = Column(String, unique=True, index=True, nullable=False)
    created_at              = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at              = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
    expires_at              = Column(DateTime, nullable=False)

    # Haiku-generated identity
    title                   = Column(String, nullable=False, default="Intelligence Fusion Event")
    subtitle                = Column(String, nullable=True)
    narrative               = Column(Text, nullable=True)

    # Classification
    severity                = Column(String, nullable=False, default="medium", index=True)
    confidence              = Column(Float, default=0.5)
    domain_count            = Column(Integer, default=1)
    domains                 = Column(Text, default="[]")            # JSON array
    fusion_type             = Column(String, default="MULTI_DOMAIN") # MULTI_DOMAIN / ESCALATION_CHAIN / PATTERN_SURGE

    # Geography
    location_name           = Column(String, nullable=True)
    location_country        = Column(String, nullable=True)
    region_id               = Column(String, nullable=True)
    lat                     = Column(Float, nullable=True)
    lon                     = Column(Float, nullable=True)
    radius_km               = Column(Float, default=0.0)

    # Contributing signals
    contributing_assessments = Column(Text, default="[]")           # JSON array of assessment_ids
    contributing_alert_ids   = Column(Text, default="[]")           # JSON array of alert ids
    contributing_rule_ids    = Column(Text, default="[]")           # JSON array of rule ids
    signal_count            = Column(Integer, default=0)

    # Claude-ready output
    key_signals             = Column(Text, default="[]")            # JSON array of bullet points
    recommended_actions     = Column(Text, default="[]")            # JSON array
    threat_indicators       = Column(Text, default="[]")            # JSON array of named threats

    # Map
    marker_type             = Column(String, default="FUSION_EVENT")
    marker_visible          = Column(Boolean, default=True)
    poi_id                  = Column(Integer, nullable=True)

    # Status
    status                  = Column(String, default="active", index=True)  # active / resolved / expired
    resolved_at             = Column(DateTime, nullable=True)
    analyst_notes           = Column(Text, nullable=True)


class SurgeConfig(Base):
    __tablename__ = "surge_configs"
    id                      = Column(Integer, primary_key=True)
    enabled                 = Column(Boolean, default=True)
    volume_window_hours     = Column(Integer, default=3)
    volume_multiplier       = Column(Float, default=2.0)
    velocity_window_minutes = Column(Integer, default=30)
    velocity_threshold      = Column(Integer, default=5)
    baseline_days           = Column(Integer, default=7)
    eligible_types          = Column(Text, default='["conflict","maritime","aviation","infrastructure","energy","cyber","disaster"]')
    cooldown_minutes        = Column(Integer, default=60)
    created_at              = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at              = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class StrategicZone(Base):
    __tablename__ = "strategic_zones"

    id                 = Column(Integer, primary_key=True)
    zone_id            = Column(String, unique=True, index=True, nullable=False)   # SZONE-001
    name               = Column(String, nullable=False)
    zone_type          = Column(String, nullable=False, index=True)
    # CONFLICT_ACTIVE | CONFLICT_FROZEN | MILITARY_SENSITIVE | ECONOMIC_CRITICAL
    # CHOKEPOINT_EXTENDED | NUCLEAR_SENSITIVE | INSTABILITY | CUSTOM
    severity_baseline  = Column(String, nullable=False, default="medium")          # low/medium/high/critical
    polygon_geojson    = Column(Text, nullable=False)                              # GeoJSON Polygon/MultiPolygon string
    bbox_min_lon       = Column(Float, nullable=False, default=0.0)
    bbox_min_lat       = Column(Float, nullable=False, default=0.0)
    bbox_max_lon       = Column(Float, nullable=False, default=0.0)
    bbox_max_lat       = Column(Float, nullable=False, default=0.0)
    colour             = Column(String, nullable=False, default="#FF9500")
    description        = Column(Text, nullable=True)
    is_baseline        = Column(Boolean, default=False)
    enabled            = Column(Boolean, default=True)
    created_at         = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at         = Column(DateTime, default=datetime.datetime.utcnow,
                                onupdate=datetime.datetime.utcnow)
    zone_metadata      = Column(Text, nullable=True)                               # JSON string


class SurgeEvent(Base):
    __tablename__ = "surge_events"
    id                      = Column(Integer, primary_key=True)
    surge_id                = Column(String, unique=True, index=True, nullable=False)
    created_at              = Column(DateTime, default=datetime.datetime.utcnow)
    expires_at              = Column(DateTime, nullable=False)
    location_name           = Column(String, nullable=True)
    location_country        = Column(String, nullable=True)
    region_id               = Column(String, nullable=True)
    lat                     = Column(Float, nullable=True)
    lon                     = Column(Float, nullable=True)
    article_type            = Column(String, nullable=False)
    surge_type              = Column(String, nullable=False)   # VOLUME_SURGE | VELOCITY_SPIKE
    article_count           = Column(Integer, default=0)
    baseline_count          = Column(Float, nullable=True)
    multiplier              = Column(Float, nullable=True)
    time_window_description = Column(String, nullable=True)
    severity                = Column(String, nullable=False, default="medium", index=True)
    headline                = Column(String, nullable=False)
    evidence_items          = Column(Text, default="[]")       # JSON array {title, source}
    status                  = Column(String, default="active", index=True)  # active | expired


class RegionalScanJob(Base):
    __tablename__ = "regional_scan_jobs"

    id                   = Column(Integer, primary_key=True)
    job_id               = Column(String, unique=True, index=True, nullable=False)
    region_name          = Column(String, nullable=False, default="UAE")
    status               = Column(String, nullable=False, default="pending", index=True)
    bbox_min_lon         = Column(Float, nullable=False, default=0.0)
    bbox_min_lat         = Column(Float, nullable=False, default=0.0)
    bbox_max_lon         = Column(Float, nullable=False, default=0.0)
    bbox_max_lat         = Column(Float, nullable=False, default=0.0)
    tile_size_deg        = Column(Float, nullable=True, default=0.5)
    total_tiles          = Column(Integer, default=0)
    tiles_complete       = Column(Integer, default=0)
    tiles_failed         = Column(Integer, default=0)
    detections_total     = Column(Integer, default=0)
    current_tile_index   = Column(Integer, default=0)
    cancelled            = Column(Boolean, default=False)
    created_at           = Column(DateTime, default=datetime.datetime.utcnow)
    started_at           = Column(DateTime, nullable=True)
    completed_at         = Column(DateTime, nullable=True)
    claude_report        = Column(Text, nullable=True)
    report_summary       = Column(String, nullable=True)
    error_message        = Column(String, nullable=True)
    # Legacy columns kept for backward compat
    phase                = Column(String, nullable=True)
    flagged_tiles        = Column(Integer, default=0)
    detections_flagged   = Column(Integer, default=0)
    scan_metadata        = Column(Text, nullable=True)


class RegionalScanDetection(Base):
    __tablename__ = "regional_scan_detections"

    id                          = Column(Integer, primary_key=True)
    detection_id                = Column(String, unique=True, index=True, nullable=False)
    job_id                      = Column(String, ForeignKey("regional_scan_jobs.job_id"), nullable=False, index=True)
    tile_index                  = Column(Integer, nullable=True, default=0)
    region_name                 = Column(String, nullable=False, default="UAE")
    detection_type              = Column(String, nullable=False, index=True)
    change_type                 = Column(String, nullable=False, default="CHANGED")
    confidence                  = Column(Float, nullable=False, default=0.5)
    centroid_lat                = Column(Float, nullable=False)
    centroid_lon                = Column(Float, nullable=False)
    bbox_min_lon                = Column(Float, nullable=True)
    bbox_min_lat                = Column(Float, nullable=True)
    bbox_max_lon                = Column(Float, nullable=True)
    bbox_max_lat                = Column(Float, nullable=True)
    nearest_asset_type          = Column(String, nullable=True)
    nearest_asset_name          = Column(String, nullable=True)
    nearest_asset_distance_km   = Column(Float, nullable=True)
    in_strategic_zone           = Column(String, nullable=True)
    spectral_change_score       = Column(Float, default=0.0)
    claude_vision_analysis      = Column(Text, nullable=True)   # primary analysis field
    claude_severity             = Column(String, nullable=True)
    image_b64                   = Column(Text, nullable=True)   # base64 PNG, fire only
    created_at                  = Column(DateTime, default=datetime.datetime.utcnow)
    suppressed                  = Column(Boolean, default=False)
    # New ML fields
    category                    = Column(String, nullable=True)   # environmental|maritime|military|aviation|energy|infrastructure
    importance                  = Column(Integer, default=3)      # 1-5
    detection_source            = Column(String, nullable=True)   # spectral|yolo_vessels|yolo_aircraft|yolo_defence|yolo_oil_tanks
    class_name                  = Column(String, nullable=True)   # YOLO class label
    is_change                   = Column(Boolean, default=False)  # True = change vs baseline
    baseline_available          = Column(Boolean, default=False)
    # Legacy columns
    claude_threat_assessment    = Column(String, nullable=True)
    yolo_confirmed              = Column(Boolean, default=False)
    yolo_object_type            = Column(String, nullable=True)


class RegionalScanTile(Base):
    """One fetched Sentinel-2 tile per scan job."""
    __tablename__ = "regional_scan_tiles"

    id               = Column(Integer, primary_key=True)
    tile_id          = Column(String, unique=True, index=True, nullable=False)
    job_id           = Column(String, ForeignKey("regional_scan_jobs.job_id"), nullable=False, index=True)
    tile_index       = Column(Integer, nullable=False)
    min_lon          = Column(Float, nullable=False)
    min_lat          = Column(Float, nullable=False)
    max_lon          = Column(Float, nullable=False)
    max_lat          = Column(Float, nullable=False)
    status           = Column(String, nullable=False, default="pending")  # fetched|failed|skipped
    image_b64        = Column(Text, nullable=True)   # base64 true-color PNG
    image_date       = Column(DateTime, nullable=True)
    detections_count = Column(Integer, default=0)
    created_at       = Column(DateTime, default=datetime.datetime.utcnow)


class Alert(Base):
    """Persisted forge alert from AIS/ADSB/surge/fusion pipelines."""
    __tablename__ = "alerts"

    id              = Column(Integer, primary_key=True)
    alert_id        = Column(String, unique=True, index=True, nullable=False)   # ALT-<uuid8>
    source          = Column(String, nullable=False, index=True)                # ais|adsb|surge|fusion|manual
    alert_type      = Column(String, nullable=False, index=True)               # vessel_dark|aircraft_squawk|surge|etc
    title           = Column(String, nullable=False)
    severity        = Column(String, nullable=False, default="medium", index=True)
    lat             = Column(Float, nullable=True)
    lon             = Column(Float, nullable=True)
    region          = Column(String, nullable=True, index=True)
    country_code    = Column(String, nullable=True, index=True)
    entity_type     = Column(String, nullable=True)                             # vessel|aircraft|port|zone|etc
    entity_id       = Column(String, nullable=True, index=True)                 # mmsi|icao|etc
    entity_name     = Column(String, nullable=True)
    raw_json        = Column(Text, default="{}")                                # full original alert dict
    zone_ids        = Column(Text, default="[]")                                # JSON list of containing zone IDs
    tags            = Column(Text, default="[]")                                # JSON list of string tags
    status          = Column(String, default="active", index=True)              # active|acknowledged|expired
    created_at      = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    expires_at      = Column(DateTime, nullable=True)
    acknowledged_at = Column(DateTime, nullable=True)
    acknowledged_by = Column(String, nullable=True)

    __table_args__ = (
        Index("ix_alerts_region_created", "region", "created_at"),
        Index("ix_alerts_source_type",    "source",  "alert_type"),
    )


class Signal(Base):
    """Raw signal ingested by fusion engine — one signal per domain event."""
    __tablename__ = "signals"

    id           = Column(Integer, primary_key=True)
    signal_id    = Column(String, unique=True, index=True, nullable=False)   # SIG-<uuid8>
    domain       = Column(String, nullable=False, index=True)                # maritime|aviation|news|surge
    signal_type  = Column(String, nullable=False, index=True)
    geo_key      = Column(String, nullable=True, index=True)                 # lat_lon bucket
    lat          = Column(Float, nullable=True)
    lon          = Column(Float, nullable=True)
    region       = Column(String, nullable=True, index=True)
    country_code = Column(String, nullable=True)
    source_id    = Column(String, nullable=True)                             # mmsi|icao|url|etc
    title        = Column(String, nullable=True)
    raw_json     = Column(Text, default="{}")
    score        = Column(Float, default=0.0)
    fusion_id    = Column(String, nullable=True, index=True)                 # FK → FusionEvent if consumed
    created_at   = Column(DateTime, default=datetime.datetime.utcnow, index=True)

    __table_args__ = (
        Index("ix_signals_domain_type",   "domain", "signal_type"),
        Index("ix_signals_region_time",   "region", "created_at"),
    )


class NewsArticle(Base):
    """Persisted news article with LLM intelligence fields."""
    __tablename__ = "news_articles"

    id                   = Column(Integer, primary_key=True)
    url                  = Column(String, unique=True, index=True, nullable=False)
    title                = Column(String, nullable=False)
    source_name          = Column(String, nullable=True, index=True)
    published            = Column(String, nullable=True)
    lat                  = Column(Float, nullable=True)
    lon                  = Column(Float, nullable=True)
    location_name        = Column(String, nullable=True)
    country_code         = Column(String, nullable=True, index=True)
    article_type         = Column(String, nullable=True, index=True)         # conflict|energy|aviation|etc
    tier                 = Column(Integer, nullable=True, index=True)        # 1-4 (LLM relevance tier)
    relevance_score      = Column(Float, nullable=True)
    event_title          = Column(String, nullable=True)
    context_summary      = Column(Text, nullable=True)
    is_breaking          = Column(Boolean, default=False)
    llm_extracted        = Column(Boolean, default=False)
    entities_json        = Column(Text, default="[]")                        # JSON array of entity dicts
    image_url            = Column(String, nullable=True)
    body                 = Column(Text, nullable=True)
    ingested_at          = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    region               = Column(String, nullable=True, index=True)

    __table_args__ = (
        Index("ix_news_country_time",  "country_code", "ingested_at"),
        Index("ix_news_type_tier",     "article_type", "tier"),
        Index("ix_news_region_time",   "region",       "ingested_at"),
    )


class OntologyLink(Base):
    """Directed link from an event (alert/signal/article) to an ontology entity."""
    __tablename__ = "ontology_links"

    id              = Column(Integer, primary_key=True)
    link_id         = Column(String, unique=True, index=True, nullable=False)  # LNK-<uuid8>
    source_type     = Column(String, nullable=False, index=True)               # alert|signal|article|fusion
    source_id       = Column(String, nullable=False, index=True)               # alert_id|signal_id|url|etc
    entity_type     = Column(String, nullable=False, index=True)               # cable|port|airport|zone|vessel|aircraft
    entity_id       = Column(String, nullable=False, index=True)               # system_id or DB pk
    entity_name     = Column(String, nullable=True)
    link_type       = Column(String, nullable=False, default="proximity")       # proximity|mention|impact
    distance_km     = Column(Float, nullable=True)                             # for proximity links
    confidence      = Column(Float, default=1.0)
    created_at      = Column(DateTime, default=datetime.datetime.utcnow, index=True)

    __table_args__ = (
        Index("ix_ontlink_entity",      "entity_type", "entity_id"),
        Index("ix_ontlink_source",      "source_type", "source_id"),
        Index("ix_ontlink_entity_time", "entity_type", "created_at"),
    )


@contextmanager
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def migrate_db():
    """Add missing columns to existing database and create new tables."""
    # Register IntelligenceAssessment with Base before create_all
    try:
        import intelligence_schema as _is  # noqa: F401  — registers model with Base
    except ImportError:
        pass
    # FusionEvent is defined in this module — already registered with Base
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
        ('system_id',         'TEXT'),
        ('infra_type',        'TEXT'),
        ('region_id',         'TEXT'),
    ]
    tables = [row[0] for row in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    if 'cable_segments' in tables:
        cs_existing = [row[1] for row in cur.execute('PRAGMA table_info(cable_segments)').fetchall()]
        for col, typ in cable_cols:
            if col not in cs_existing:
                cur.execute(f'ALTER TABLE cable_segments ADD COLUMN {col} {typ}')
                print(f'[db-migrate] cable_segments: added column {col}')

    # rule_configs new columns
    rule_cols = [
        ('name',         'TEXT'),
        ('trigger_type', 'TEXT'),
        ('severity',     'TEXT DEFAULT "medium"'),
        ('icon_type',    'TEXT'),
    ]
    if 'rule_configs' in tables:
        rc_existing = [row[1] for row in cur.execute('PRAGMA table_info(rule_configs)').fetchall()]
        for col, typ in rule_cols:
            if col not in rc_existing:
                cur.execute(f'ALTER TABLE rule_configs ADD COLUMN {col} {typ}')
                print(f'[db-migrate] rule_configs: added column {col}')

    # regional_scan_jobs new columns (tile-by-tile streaming schema)
    rscan_new_cols = [
        ('tile_size_deg',      'REAL DEFAULT 0.5'),
        ('tiles_complete',     'INTEGER DEFAULT 0'),
        ('tiles_failed',       'INTEGER DEFAULT 0'),
        ('current_tile_index', 'INTEGER DEFAULT 0'),
        ('cancelled',          'BOOLEAN DEFAULT 0'),
    ]
    if 'regional_scan_jobs' in tables:
        rsj_existing = [row[1] for row in cur.execute('PRAGMA table_info(regional_scan_jobs)').fetchall()]
        for col, typ in rscan_new_cols:
            if col not in rsj_existing:
                cur.execute(f'ALTER TABLE regional_scan_jobs ADD COLUMN {col} {typ}')
                print(f'[db-migrate] regional_scan_jobs: added column {col}')

    # regional_scan_detections new columns
    rsdet_new_cols = [
        ('tile_index', 'INTEGER DEFAULT 0'),
        ('image_b64',  'TEXT'),
    ]
    if 'regional_scan_detections' in tables:
        rsd_existing = [row[1] for row in cur.execute('PRAGMA table_info(regional_scan_detections)').fetchall()]
        for col, typ in rsdet_new_cols:
            if col not in rsd_existing:
                cur.execute(f'ALTER TABLE regional_scan_detections ADD COLUMN {col} {typ}')
                print(f'[db-migrate] regional_scan_detections: added column {col}')

    conn.commit()
    conn.close()
    # Create new tables via SQLAlchemy (idempotent)
    Base.metadata.create_all(bind=engine)

def init_db():
    try:
        import intelligence_schema as _is  # noqa: F401
    except ImportError:
        pass
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
