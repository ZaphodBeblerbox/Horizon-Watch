from sqlalchemy import create_engine, Column, String, Boolean, DateTime, Text, ForeignKey, Float, Integer, JSON, UniqueConstraint, Index, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from contextlib import contextmanager
import uuid, datetime, os

DATABASE_URL = f"sqlite:///{os.getenv('DATA_DIR', './data')}/akili.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

@event.listens_for(engine, "connect")
def _set_sqlite_pragmas(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA cache_size = -65536")  # cap page cache at 64 MB
    cursor.execute("PRAGMA journal_mode = WAL")   # WAL reduces lock contention
    cursor.execute("PRAGMA mmap_size = 0")        # disable memory-mapped I/O
    cursor.close()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class Team(Base):
    """Real auth round — a real organization a user belongs to. Exactly one
    real team exists today (Trifecta Technologies); this is a real table,
    not a hardcoded string, so a second real org can be added later without
    a schema change."""
    __tablename__ = "teams"
    id         = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name       = Column(String, unique=True, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


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
    # Workstation round (§7.4/§7.11) — real per-user display fields. All
    # nullable: initials/colour are derived deterministically from the real
    # user id when unset (see main.py's _user_initials/_user_color), never
    # randomized; timezone/shift are real settings a user sets for
    # themselves, defaulted honestly rather than invented.
    initials            = Column(String, nullable=True)
    color               = Column(String, nullable=True)
    timezone            = Column(String, nullable=True)
    shift                = Column(String, nullable=True)
    # Real auth round — real team membership + real company title (display
    # only — "CTO"/"CEO" are not app capability roles) + the real 5-tier
    # capability role (src/lib/capabilities.js's ACCESS_ROLE_IDS) that
    # actually gates privileged actions, now resolved server-side from a
    # verified session instead of a self-reported client value.
    team_id             = Column(String, nullable=True, index=True)  # Team.id
    title               = Column(String, nullable=True)              # e.g. "CTO" — display only
    capability_role     = Column(String, nullable=True)              # one of ACCESS_ROLE_IDS
    # Parallax theming round — real per-user, server-persisted theme
    # ("dark" | "light"), same DB-not-localStorage discipline as
    # DeskSession below. Nullable: unset means "dark", the pre-existing
    # look every current user already sees, so this column's addition is
    # a zero-visual-change migration for every existing row.
    theme               = Column(String, nullable=True)
    # Real Settings round — every OTHER real per-user setting (density,
    # units, map/layers, alert thresholds incl. quiet hours, briefing
    # defaults, notification/sound toggles). Theme keeps its own dedicated
    # column/endpoint (pre-existing, reused as-is — Settings' General
    # section is a second real control surface for the SAME value, never a
    # second mechanism). One JSON blob rather than a column per setting,
    # merged in-place by PATCH /api/users/me/settings so every control
    # applies immediately with no client-side "unsaved changes" state.
    settings            = Column(JSON, nullable=True)


class DeskSession(Base):
    """V3 Phase 1, §5.1 — a real, server-persisted "whole desk": time
    window, severity floor, active layers/domains, the real Cesium camera
    position, open tabs, the briefing basket, all restored atomically on
    switch. A real, disclosed design call (see the Phase 1 report): this
    persists server-side rather than in localStorage — reusing the real DB
    this app already uses for everything else rather than the narrower
    client-only "Workspace" concept it supersedes — but real per-request
    user authentication does not exist in this codebase today (deliberately
    removed, commit 189d706). `owner_user_id` is real (a real users.id, when
    set) but not yet enforced by any live auth check — every session is
    currently readable/writable by anyone, exactly like every other
    endpoint in this app post-removal. True multi-user isolation is a real
    follow-up once auth is rebuilt, not something this table can honestly
    claim to deliver alone."""
    __tablename__ = "desk_sessions"

    id                 = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id         = Column(String, unique=True, index=True, nullable=False)  # SESN-<uuid8>
    name               = Column(String, nullable=False)
    owner_user_id      = Column(String, nullable=True, index=True)

    time_window        = Column(String, nullable=False, default="72h")
    severity_floor     = Column(String, nullable=False, default="low")
    domains_json       = Column(Text, nullable=False, default="[]")
    context_layers_json = Column(Text, nullable=False, default="{}")
    track_layers_json  = Column(Text, nullable=False, default="{}")
    projection         = Column(String, nullable=False, default="world")

    # Real Cesium camera state — position + orientation, not just lat/lon/
    # zoom (the old client-only Workspace's much narrower shape).
    camera_json        = Column(Text, nullable=True)  # {lon, lat, height, heading, pitch, roll}

    tabs_json          = Column(Text, nullable=False, default="[]")
    basket_json        = Column(Text, nullable=False, default="[]")

    created_at         = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at         = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class DeskView(Base):
    """V3 Phase 1, §5.2 — a named filter preset LIVING INSIDE a session,
    deliberately a separate real table (not a session with a "view mode"
    flag): merging the two loses the ability to look at the same desk two
    ways, per the reference spec's own stated reasoning. A view only ever
    carries filter-level state (window/floor/domains/context layers/
    projection) — never camera, tabs, or basket, which are real session-
    level (whole-desk) concerns."""
    __tablename__ = "desk_views"

    id                  = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    view_id             = Column(String, unique=True, index=True, nullable=False)  # VIEW-<uuid8>
    session_id          = Column(String, nullable=False, index=True)  # DeskSession.session_id
    name                = Column(String, nullable=False)

    time_window         = Column(String, nullable=False, default="72h")
    severity_floor      = Column(String, nullable=False, default="low")
    domains_json        = Column(Text, nullable=False, default="[]")
    context_layers_json = Column(Text, nullable=False, default="{}")
    projection          = Column(String, nullable=False, default="world")

    created_at          = Column(DateTime, default=datetime.datetime.utcnow)


class DeskNote(Base):
    """A real note routed from the mobile companion's Note tab to a desk
    (duty desk / group security / regional lead / logistics) — a route/desk
    is not a person, so this is deliberately its own small table rather than
    forcing it through DirectMessage's person-to-person sender/recipient
    shape (that table already exists in this schema but has zero real
    endpoints anywhere). `status` genuinely transitions queued -> sent (or
    failed) based on a real delivery attempt (see backend/routers/mobile.py's
    real _broadcast_push() call) — never a client-side timer standing in for
    a real confirmation."""
    __tablename__ = "desk_notes"
    id              = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    route           = Column(String, nullable=False, index=True)   # duty_desk|group_security|regional_lead|logistics
    kind            = Column(String, nullable=False, default="text")  # text | voice
    text_content    = Column(Text, nullable=True)
    audio_path      = Column(String, nullable=True)     # real file under backend/data/desk_notes/, voice notes only
    audio_seconds   = Column(Float, nullable=True)
    reference_kind  = Column(String, nullable=True)     # signal|scene|node|region — the attached reference, if any
    reference_id    = Column(String, nullable=True)
    reference_label = Column(String, nullable=True)
    status          = Column(String, nullable=False, default="queued")  # queued | sent | failed
    created_by      = Column(String, nullable=True)
    created_at      = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    delivered_at    = Column(DateTime, nullable=True)
    recipients_notified = Column(Integer, default=0)    # real count of push subscriptions actually notified


class Case(Base):
    """Workstation round, §7.6 — "a case is what turns sixteen modules into
    one job." Attached records are stored as real reference-grammar strings
    (src/lib/ref.js's `kind:id` form, e.g. "sig:ALT-1") so Case.refs_json is
    never a second, parallel record-shape — every attached record resolves
    through the exact same real resolve()/label()/open() every other
    reference in this app already uses. The four-step approval chain
    (draft -> review -> approved -> issued) is real history, not just a
    current-value column: approval_history_json is an append-only real log
    of {stage, user_id, at}, so the Briefing tab's four-step strip can show
    real stamped initials/timestamps for every step actually taken, not
    just the current one."""
    __tablename__ = "cases"
    id                    = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    case_id               = Column(String, unique=True, index=True, nullable=False)  # CS-####
    title                 = Column(String, nullable=False)
    owner_user_id         = Column(String, nullable=True, index=True)
    status                = Column(String, nullable=False, default="active")    # active | review | closed
    priority              = Column(String, nullable=False, default="moderate")  # critical | high | moderate | low
    summary               = Column(Text, nullable=True)
    watchers_json         = Column(Text, nullable=False, default="[]")  # [user_id, ...]
    refs_json             = Column(Text, nullable=False, default="[]")  # ["sig:ALT-1", "mail:M-2", ...]
    notes_json            = Column(Text, nullable=False, default="[]")  # [{id, author_user_id, text, created_at}] — minimal real discussion for this pass
    approval_stage        = Column(String, nullable=False, default="draft")     # draft | review | approved | issued
    approval_history_json = Column(Text, nullable=False, default="[]")  # [{stage, user_id, at}]
    opened_at             = Column(DateTime, default=datetime.datetime.utcnow)
    due_at                = Column(DateTime, nullable=True)
    created_at            = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at            = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class RFI(Base):
    """Workstation round, §7.7 — a real Request For Information raised
    against a case, answerable only by its real named recipient
    (to_user_id) — never any user with a role capability, per the doc's own
    "answerable only by the recipient" rule enforced in main.py's
    api_rfi_answer()."""
    __tablename__ = "rfis"
    id             = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    rfi_id         = Column(String, unique=True, index=True, nullable=False)  # RFI-###
    case_id        = Column(String, nullable=False, index=True)  # Case.case_id
    from_user_id   = Column(String, nullable=True)
    to_user_id     = Column(String, nullable=False, index=True)
    question       = Column(Text, nullable=False)
    status         = Column(String, nullable=False, default="open")  # open | answered | closed
    answers_json   = Column(Text, nullable=False, default="[]")  # [{user_id, text, at}]
    due_at         = Column(DateTime, nullable=True)
    created_at     = Column(DateTime, default=datetime.datetime.utcnow)


class Comment(Base):
    """Workstation round, Part 8 — real, generic per-record discussion,
    injected via the app's one real UI extension point (src/inspector/
    extensionRegistry.js) onto every record surface, not a case-only or
    signal-only feature. `record_ref` is a real reference-grammar string
    (src/lib/ref.js's `kind:id` form — "case:CS-1A2B3C", "sig:ALT-...",
    "ent:...", "onto:...", "aoi:..."), so one real table covers every
    record kind rather than one comments table per surface. Deliberately
    additive alongside Case.notes_json (Cases.jsx's own pre-existing,
    simpler per-case note list) rather than replacing it — migrating an
    already-shipped, working feature's data model is real, separate,
    riskier work not attempted in this pass; a case gets both."""
    __tablename__ = "comments"
    id                      = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    comment_id              = Column(String, unique=True, index=True, nullable=False)  # CMT-######
    record_ref              = Column(String, nullable=False, index=True)
    author_user_id          = Column(String, nullable=False)
    body                    = Column(Text, nullable=False)
    mentioned_user_ids_json = Column(Text, nullable=False, default="[]")  # [user_id, ...] — real users picked via the real @mention autocomplete, never free-text parsed
    resolved                = Column(Boolean, default=False)
    created_at              = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at              = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class RecordAssignment(Base):
    """Workstation round, Part 8 — real, generic per-record assignment,
    keyed the same real reference-grammar way as Comment above. Additive:
    Case.owner_user_id (a case's own pre-existing ownership field) is left
    untouched; this is the assignment mechanism for every OTHER record
    kind that has never had one (a signal, an entity, an AOI...), and
    cases can carry both. Exactly one active (done=False) row per
    record_ref in practice, enforced at the application layer —
    "reassign" marks the old row done and inserts a new one rather than
    mutating history, so real past assignments stay visible in the
    activity log."""
    __tablename__ = "record_assignments"
    id                   = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    record_ref           = Column(String, nullable=False, index=True)
    assignee_user_id     = Column(String, nullable=False, index=True)
    assigned_by_user_id  = Column(String, nullable=True)
    due_at               = Column(DateTime, nullable=True)
    done                 = Column(Boolean, default=False)
    created_at           = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at           = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class ActivityLogEntry(Base):
    """Workstation round, Part 8 — real per-record activity log (who did
    what, when) for the assignment/comment primitives above. A different,
    smaller thing than My Work's own sidebar "recent activity" (which
    already has its own real, working, unrelated derivation from Case
    approval-history + RFI answers, left untouched) — this is the
    per-record feed shown inside the collaboration panel itself."""
    __tablename__ = "activity_log"
    id             = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    record_ref     = Column(String, nullable=False, index=True)
    actor_user_id  = Column(String, nullable=True)
    verb           = Column(String, nullable=False)  # assigned | reassigned | done | commented | resolved_comment | reopened_comment
    detail_json    = Column(Text, nullable=False, default="{}")
    created_at     = Column(DateTime, default=datetime.datetime.utcnow)


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
    # Real provenance (Parallax translation step 1, Part 2) — see
    # provenance.py's module docstring for the real two-axis model and why
    # this app's real ADS-B source (api.adsb.lol, a free community-
    # aggregated redistribution) is real class C, not A, with T1 licensing.
    origin_class  = Column(String(1), default="C")
    licence_tier  = Column(String(2), default="T1")

    # Real perf-round fix — briefing_prep.py's traffic-summary count(
    # distinct icao24) over a timestamp filter was the single largest real
    # contributor to prepare_intelligence_picture()'s measured 10.5s
    # (6.98s of it in that one section). icao24/timestamp already each had
    # their OWN index, but ~98% of this table's real rows already fall
    # inside any real 24h window (this table is itself continuously
    # pruned to roughly that horizon), so the timestamp filter barely
    # narrows anything — the real cost is the distinct-count itself. A
    # composite (icao24, timestamp) index lets SQLite answer it as an
    # index-only scan; measured directly against this real, live 1.1M-row
    # table: ~2.5s -> ~0.08s.
    __table_args__ = (Index("ix_aircraft_history_icao24_timestamp", "icao24", "timestamp"),)


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
    # Real provenance (Parallax translation step 1, Part 2) — see
    # provenance.py's module docstring. Real AIS class/tier per the source
    # mapping table: B (authoritative registry-grade tracking data), T1
    # (client-deliverable).
    origin_class   = Column(String(1), default="B")
    licence_tier   = Column(String(2), default="T1")

    # Real perf-round fix — see AircraftHistory's own matching comment
    # above. Measured directly against this real, live 895K-row table:
    # ~2.97s -> ~0.06s for the same real count(distinct mmsi) query
    # briefing_prep.py's traffic summary runs on every call.
    __table_args__ = (Index("ix_vessel_history_mmsi_timestamp", "mmsi", "timestamp"),)


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


class EntityAlertPref(Base):
    """A real, per-entity alerting on/off preference for the Dossiers page's
    "alerting on" toggle — keyed by (entity_type, entity_id) so it works
    identically for a WatchZone or a StrategicZone (or any future trackable
    entity type) without adding a column to each entity table separately.
    Consulted by write_alert() (backend/main.py) before an alert linked to
    this entity is surfaced — see the real wiring there, not a decorative
    UI-only flag."""
    __tablename__ = "entity_alert_prefs"

    id          = Column(Integer, primary_key=True)
    entity_type = Column(String, nullable=False, index=True)   # "watch_zone" | "strategic_zone"
    entity_id   = Column(String, nullable=False, index=True)   # the entity's internal .id, as a string
    enabled     = Column(Boolean, nullable=False, default=True)
    updated_at  = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    __table_args__ = (
        Index("ix_entity_alert_pref_key", "entity_type", "entity_id", unique=True),
    )


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
    # Real AOI class + proposal lifecycle for the Imagery page (§B3/B6).
    # 'proposed' rows are real, derived-from-real-infrastructure suggestions
    # (backend/imagery_pipeline.py's propose_coverage) an analyst hasn't
    # accepted yet — they never scan (the schedule loop's own enabled=False
    # check already skips them) until accept_proposal() flips both
    # status='active' and enabled=True.
    aoi_class           = Column(String, nullable=False, default="custom")
    status              = Column(String, nullable=False, default="active")  # active|paused|proposed
    owner               = Column(String, nullable=True)
    # Real Imagery pipeline round — the spec's #sc-sensor selector
    # (sentinel2_optical|sentinel1_sar|commercial_eo|commercial_sar).
    # Real, honest gating on the value, not cosmetic: commercial_eo/
    # commercial_sar are accepted and persisted (an analyst's real stated
    # intent survives), but a real scan attempt against one of them fails
    # with a clear real error (see api_watch_zone_scan_now/SentinelScanner.
    # run_scan) rather than silently running a detector against imagery it
    # was never built for — no commercial EO/SAR pipeline exists in this
    # codebase today. sentinel1_sar IS real and deployed (recovered from
    # git history and wired to a live Sentinel Hub raw-band fetch + the
    # real Faster R-CNN detector, see sar_detector.py and
    # SentinelDetection.instrument's own docstring) — see
    # _SENSOR_PIPELINES_DEPLOYED in main.py for the current real set.
    sensor_preference   = Column(String, nullable=False, default="sentinel2_optical")


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
    # Real Imagery/Sentinel round — which real instrument produced this
    # scan (OPTICAL default for every existing/optical row; SAR is set
    # explicitly by sentinel_scanner.py's real SAR branch). Needed so
    # imagery_pipeline.reference_scan() can enforce real same-sensor
    # pairing — a scan's own detections already carried this per-row, but
    # a SAR scan that (honestly) finds zero real vessels would otherwise
    # be indistinguishable from an optical scan at the scan level.
    instrument            = Column(String, nullable=False, default="OPTICAL")
    # The real fetched true-colour crop for this scan, base64-encoded — the
    # Imagery page's comparison view needs a real image to render; previously
    # nothing persisted the fetched bytes at all (image_crop_url/overlay_url
    # on SentinelDetection were always null). Stored inline as base64 rather
    # than a new static-file mount, matching this codebase's existing
    # precedent (GlobeOverwatchLayer.jsx already consumes a base64 image
    # string for the same real Sentinel imagery elsewhere).
    image_b64             = Column(Text, nullable=True)


class SentinelDetection(Base):
    __tablename__ = "sentinel_detections"

    id                       = Column(Integer, primary_key=True)
    detection_id             = Column(String, unique=True, index=True, nullable=False)
    scan_id                  = Column(String, ForeignKey("sentinel_scans.scan_id"), nullable=False, index=True)
    zone_id                  = Column(Integer, ForeignKey("watch_zones.id"), nullable=False, index=True)
    # Always populated (never inferred implicitly downstream) — "OPTICAL" for
    # Sentinel-2/YOLO-OBB detections (sentinel_ml.run_ship_detection(), via
    # main.py's shared yolov8n-obb.onnx/DOTA inference). "SAR" is real and
    # in active use as of the SAR-detector deployment round: real Sentinel-1
    # raw VH/VV bands fetched via Sentinel Hub, detected by the real,
    # recovered-from-git-history sar_detector.py (Faster R-CNN + attribute
    # model, AllenAI vessel-detection-sentinels weights) — see
    # sentinel_scanner.py's SAR branch and main.py's
    # _SENSOR_PIPELINES_DEPLOYED. Defaults to "OPTICAL" so existing rows/
    # writers (which predate this column) remain valid without a data
    # migration.
    instrument               = Column(String, nullable=False, default="OPTICAL")
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
    # Real analyst feedback (Imagery page §B5) — 'pending'|'confirmed'|
    # 'rejected'. Genuinely consulted (not cosmetic): a rejected detection is
    # excluded from subsequent reference-count comparisons for its zone, so
    # confirming/rejecting actually changes what a later scan's delta is
    # computed against. See backend/imagery_pipeline.py.
    reviewed_status          = Column(String, nullable=False, default="pending")
    # Real provenance (Parallax translation step 1, Part 2) — real
    # satellite-imagery detections are class A (primary instrument, real
    # unmediated sensor output) and T1 (client-deliverable).
    origin_class             = Column(String(1), default="A")
    licence_tier             = Column(String(2), default="T1")


class OverwatchScanRecord(Base):
    """Persisted record of each manual Overwatch scan for analytics."""
    __tablename__ = "overwatch_scan_records"

    id             = Column(Integer, primary_key=True)
    zone_name      = Column(String, nullable=True)
    bounds_json    = Column(Text, nullable=True)   # JSON {north,south,east,west}
    polygon_json   = Column(Text, nullable=True)   # JSON [[lat,lon],...]
    total          = Column(Integer, default=0)
    by_category    = Column(Text, nullable=True)   # JSON {category: count}
    avg_confidence = Column(Float, nullable=True)
    imagery_source = Column(String, nullable=True) # "Sentinel-2" | "ESRI"
    imagery_type   = Column(String, nullable=True) # "true_color" etc
    model_used     = Column(String, nullable=True)
    created_at     = Column(DateTime, default=datetime.datetime.utcnow)


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


class ThreatSnapshotHourly(Base):
    """One row per region per hour — used for 24h trend computation."""
    __tablename__ = "threat_snapshots_hourly"

    id           = Column(Integer, primary_key=True)
    region_name  = Column(String, nullable=False, index=True)
    region_id    = Column(String, nullable=True)
    score        = Column(Float, default=0.0)
    threat_level = Column(String, default="LOW")
    snapshot_at  = Column(DateTime, nullable=False, index=True)


class HorizonSnapshot(Base):
    """Pre-built data snapshots — zero latency reads after cold start."""
    __tablename__ = "horizon_snapshot"

    key       = Column(String(64), primary_key=True)
    payload   = Column(Text, nullable=False)
    built_at  = Column(DateTime, default=datetime.datetime.utcnow, index=True)


class SurfacePoolCache(Base):
    """Persisted surface pool — avoids cold-start rebuild on every restart."""
    __tablename__ = "surface_pool_cache"

    id         = Column(Integer, primary_key=True)
    cached_at  = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    pool_json  = Column(Text, nullable=False)


class ThreatTrajectory(Base):
    """Velocity and acceleration of threat scores per zone — computed hourly."""
    __tablename__ = "threat_trajectories"

    id            = Column(Integer, primary_key=True)
    zone_id       = Column(String, index=True, nullable=False)
    zone_name     = Column(String, nullable=True)
    computed_at   = Column(DateTime, default=datetime.datetime.utcnow, index=True)

    score_now     = Column(Float, default=0.0)
    threat_level  = Column(String, default="LOW")

    velocity_1d   = Column(Float, default=0.0)   # pts/day vs 24h ago
    velocity_3d   = Column(Float, default=0.0)   # pts/day vs 72h ago
    velocity_7d   = Column(Float, default=0.0)   # pts/day vs 7d ago
    acceleration  = Column(Float, default=0.0)   # velocity change (v1d - v1d_yesterday)

    trajectory    = Column(String, default="stable")
    # rapid_escalation | escalating | stable_high | stable_low |
    # de_escalating | rapid_de_escalation | volatile | stable

    dominant_domain = Column(String, nullable=True)
    drivers_json    = Column(Text, nullable=True)   # JSON


class ForesightAssessment(Base):
    """Claude Opus escalation assessment per zone — generated every 6h when score >= 40."""
    __tablename__ = "foresight_assessments"

    id                    = Column(Integer, primary_key=True)
    zone_id               = Column(String, index=True, nullable=False)
    zone_name             = Column(String, nullable=True)
    score_at_generation   = Column(Float, default=0.0)
    model_used            = Column(String, nullable=True)

    situation_summary           = Column(Text, nullable=True)
    trajectory_assessment       = Column(Text, nullable=True)
    escalation_probability_30d  = Column(Float, default=0.0)
    probability_basis           = Column(Text, nullable=True)
    early_warning_indicators    = Column(Text, default="[]")   # JSON
    likely_scenarios            = Column(Text, default="[]")   # JSON
    pattern_matches             = Column(Text, default="[]")   # JSON
    intelligence_gaps           = Column(Text, default="[]")   # JSON
    confidence                  = Column(String, default="low")
    analyst_note                = Column(Text, nullable=True)
    full_assessment             = Column(Text, nullable=True)  # full JSON

    generated_at  = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    expires_at    = Column(DateTime, nullable=True)


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
    confidence              = Column(Float, default=0.5)             # == correlation_strength / 100, kept for existing consumers
    domain_count            = Column(Integer, default=1)
    domains                 = Column(Text, default="[]")            # JSON array
    fusion_type             = Column(String, default="MULTI_DOMAIN") # MULTI_DOMAIN / ESCALATION_CHAIN / PATTERN_SURGE

    # Real correlation-strength breakdown (correlation_scoring.py) — the
    # single real, auditable 0-100 formula plus its full component
    # breakdown, so the strength shown to an analyst is never one opaque
    # blended number (see fusion_engine.py's _score_cluster()).
    correlation_strength     = Column(Float, nullable=True)          # 0-100, correlation_scoring.combined_strength()
    correlation_components   = Column(Text, nullable=True)           # JSON: {geo_temporal, graph, domain_diversity, statistical, weights_used, graph_available, ...}

    # Real per-call-site cost audit (2026-09): when the Haiku narrative was
    # last actually (re)generated — distinct from updated_at, which also
    # changes on every mechanical field update (signal_count, expiry,
    # correlation strength). fusion_engine.py's _update_fusion() checks this
    # before spending a real Claude call, so a busy cluster receiving many
    # contributing signals in a short window doesn't re-narrate on every one
    # of them, and a process restart's startup re-evaluation pass doesn't
    # either — see fusion_engine.py's FUSION_NARRATIVE_MIN_REFRESH_MINUTES.
    narrative_generated_at  = Column(DateTime, nullable=True)

    # Real bug fix (2026-09 spend audit): the in-memory active_fusions
    # registry (fusion_engine.py) was NEVER reloaded from this table on
    # startup — only the raw contributing signals were. That meant every
    # restart found active_fusions empty, so _find_existing_fusion() always
    # returned None for a geo_key that already had a real FusionEvent row,
    # routing back into _create_fusion() instead of _update_fusion() —
    # minting a genuinely NEW duplicate FusionEvent (and a fresh unmetered
    # Haiku call) for every already-fused cluster on every single restart.
    # geo_key wasn't previously stored on this row at all, so there was no
    # way to even reconstruct active_fusions correctly after a restart.
    # Persisting it here is what lets _reload_fusions_from_db() rebuild the
    # in-memory registry keyed exactly the way live signals are.
    geo_key                 = Column(String, nullable=True, index=True)

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
    updated_at              = Column(DateTime, default=datetime.datetime.utcnow,
                                    onupdate=datetime.datetime.utcnow)
    expires_at              = Column(DateTime, nullable=False)
    location_name           = Column(String, nullable=True)
    location_country        = Column(String, nullable=True)
    region_id               = Column(String, nullable=True)
    lat                     = Column(Float, nullable=True)
    lon                     = Column(Float, nullable=True)
    article_type            = Column(String, nullable=False)
    surge_type              = Column(String, nullable=False)   # VOLUME_SURGE | VELOCITY_SPIKE | KEYWORD_SURGE
    article_count           = Column(Integer, default=0)
    baseline_count          = Column(Float, nullable=True)
    multiplier              = Column(Float, nullable=True)
    time_window_description = Column(String, nullable=True)
    severity                = Column(String, nullable=False, default="medium", index=True)
    headline                = Column(String, nullable=False)
    evidence_items          = Column(Text, default="[]")       # JSON array {title, source, url}
    keyword                 = Column(String, nullable=True)
    context_summary         = Column(Text, nullable=True)
    why_it_matters          = Column(Text, nullable=True)
    status                  = Column(String, default="active", index=True)  # active | expired


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

    # Real provenance (Parallax translation step 1, Part 2) — independently
    # populated per real `source` at write time (see provenance.py's
    # ALERT_SOURCE_PROVENANCE) since Alert.source varies row to row (ais/
    # adsb/geoconfirmed/surge/fusion/manual), unlike the single-source
    # tables above. Deliberately null for surge/fusion/manual — those don't
    # map to one real primary source in the provenance table, so they're
    # left honestly unclassified rather than guessed at.
    origin_class    = Column(String(1), nullable=True)
    licence_tier    = Column(String(2), nullable=True)

    # ── Deduplication ──────────────────────────────────────────────────────
    dedup_key       = Column(String, nullable=True, index=True)                # domain:entity_id:alert_type
    fire_count      = Column(Integer, default=1, nullable=True)               # times this dedup key fired

    # ── Correlation ────────────────────────────────────────────────────────
    correlated_alert_ids  = Column(Text, nullable=True)                       # JSON list of related alert_ids
    correlation_score     = Column(Float, nullable=True)                      # 0-1 multi-domain strength
    correlation_domains   = Column(String, nullable=True)                     # "AIS+ADSB+NEWS"

    # ── Enrichment ─────────────────────────────────────────────────────────
    analyst_note    = Column(Text, nullable=True)                              # Haiku-generated analyst note

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


class FusionSignal(Base):
    """Fusion engine active signals — persisted so signals survive restarts."""
    __tablename__ = "fusion_signals"

    id              = Column(Integer, primary_key=True)
    signal_id       = Column(String, unique=True, index=True, nullable=False)
    domain          = Column(String, nullable=False, index=True)
    geo_key         = Column(String, nullable=False, index=True)
    severity        = Column(String, nullable=True)
    confidence      = Column(Float, nullable=True)
    relevance_score = Column(Float, nullable=True)
    lat             = Column(Float, nullable=True)
    lon             = Column(Float, nullable=True)
    location_name   = Column(String, nullable=True)
    region_id       = Column(String, nullable=True)
    country         = Column(String, nullable=True)
    rule_name       = Column(String, nullable=True)
    summary         = Column(String, nullable=True)
    payload         = Column(Text, nullable=True)   # full signal JSON
    created_at      = Column(DateTime, default=datetime.datetime.utcnow)
    expires_at      = Column(DateTime, nullable=False)


class SanctionedEntity(Base):
    """Vessel or entity appearing on international sanctions lists (OpenSanctions)."""
    __tablename__ = "sanctioned_entities"

    id           = Column(Integer, primary_key=True)
    entity_id    = Column(String, index=True)
    entity_name  = Column(String, index=True)
    mmsi         = Column(String, nullable=True, index=True)
    imo          = Column(String, nullable=True, index=True)
    flag         = Column(String, nullable=True)
    datasets     = Column(String, nullable=True)   # comma-sep list: us_ofac_sdn, eu_fsf, etc.
    owner_chain  = Column(Text, nullable=True)
    topics       = Column(Text, nullable=True)
    loaded_at    = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at   = Column(DateTime, nullable=True)
    # Real provenance (Parallax translation step 1, Part 2) — OpenSanctions
    # is a real authoritative registry (B), client-deliverable (T1).
    origin_class = Column(String(1), default="B")
    licence_tier = Column(String(2), default="T1")


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
    # RSS ingestion is retired (fix/geoconfirmed-real-backbone) — real,
    # deliberate soft-delete rather than a hard delete: existing rows may
    # already be cited by a real report, export, or OntologyLink, and a
    # hard delete would silently dangle those. New rows are never written
    # again (the RSS ingestion adapter itself is removed); this column
    # exists purely so every real consumer can filter retired rows out of
    # anything CURRENT while historical citations still resolve.
    status               = Column(String, nullable=False, default="active", index=True)  # active|retired

    __table_args__ = (
        Index("ix_news_country_time",  "country_code", "ingested_at"),
        Index("ix_news_type_tier",     "article_type", "tier"),
        Index("ix_news_region_time",   "region",       "ingested_at"),
    )


class NewsClassificationLog(Base):
    """
    Structured, queryable record of every classification-funnel decision made
    for a news article — dedup suppression, cheap-prescore rejection,
    embedding-relevance verdict, whether Haiku was actually invoked, and the
    final tier/relevance_score assigned. Previously this funnel only emitted
    print() debug lines; nothing was queryable. NOT intended to train a
    classifier this round — this table exists so that future round doesn't
    need a retrofit to get the data in the first place.
    """
    __tablename__ = "news_classification_log"

    id                     = Column(Integer, primary_key=True)
    url                    = Column(String, nullable=False, index=True)
    ts                     = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    stage                  = Column(String, nullable=False, index=True)
    # stage ∈ {dedup_suppressed, failed_cheap_prescore,
    #          embedding_relevance_score_and_verdict, haiku_called_with_result,
    #          fallback_default}
    cheap_prescore         = Column(Integer, nullable=True)
    embedding_score        = Column(Float, nullable=True)
    embedding_verdict      = Column(String, nullable=True)   # relevant|uncertain|irrelevant|not_computed
    haiku_called           = Column(Boolean, default=False)
    duplicate_of_url       = Column(String, nullable=True)   # set only when stage == dedup_suppressed
    final_tier             = Column(Integer, nullable=True)
    final_relevance_score  = Column(Float, nullable=True)

    __table_args__ = (
        Index("ix_newsclf_stage_time", "stage", "ts"),
        Index("ix_newsclf_url_time",   "url",   "ts"),
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
    link_type       = Column(String, nullable=False, default="proximity")       # proximity|mention|impact|contains
    distance_km     = Column(Float, nullable=True)                             # for proximity links
    confidence      = Column(Float, nullable=True)  # None = not yet computed; never fabricate certainty
    created_at      = Column(DateTime, default=datetime.datetime.utcnow, index=True)

    __table_args__ = (
        Index("ix_ontlink_entity",      "entity_type", "entity_id"),
        Index("ix_ontlink_source",      "source_type", "source_id"),
        Index("ix_ontlink_entity_time", "entity_type", "created_at"),
    )


class OntologyClaim(Base):
    """A candidate entity-relationship claim extracted from an ingested document,
    held for human review before it is allowed to become a live Forge ontology edge.

    This is the review gate for the entity-relationship ingestion pipeline: every
    row here must carry a real source citation (title/publisher/date/url/excerpt).
    Nothing here is asserted as true — it is a claim a document makes, tagged with
    where it came from, awaiting a person's approval. `confidence` is deliberately
    a string ('direct' | 'inferred'), never a fabricated numeric score — this system
    has no way to compute a real numeric confidence for a claim extracted from free
    text, so it does not pretend to."""
    __tablename__ = "ontology_claims"

    id                = Column(Integer, primary_key=True)
    claim_id          = Column(String, unique=True, index=True, nullable=False)  # CLM-<uuid8>

    entity_a_label    = Column(String, nullable=False)
    entity_a_type     = Column(String, nullable=False)
    relationship_type = Column(String, nullable=False, index=True)
    entity_b_label    = Column(String, nullable=False)
    entity_b_type     = Column(String, nullable=False)

    as_of             = Column(String, nullable=True)   # free-text date/period the source itself states
    confidence        = Column(String, nullable=True)   # 'direct' | 'inferred' — never a numeric score

    # Structured validity window — optional, in addition to the free-text `as_of` above.
    # Most claims only ever carry a loose "as of August 2026" from their source text, which
    # `as_of` already captures; these are for the minority of cases where the source states
    # (or a reviewer can determine) an actual start/end. Addresses the audit's "relationships
    # change over time" gap: a relationship can now be recorded as bounded, not just eternal.
    valid_from        = Column(DateTime, nullable=True)
    valid_until       = Column(DateTime, nullable=True)

    source_title      = Column(String, nullable=True)
    source_publisher  = Column(String, nullable=True)
    source_date       = Column(String, nullable=True)
    source_url        = Column(String, nullable=True)
    source_excerpt    = Column(Text, nullable=True)     # the actual fact/quote grounding this claim

    upload_id         = Column(String, nullable=True, index=True)  # forge upload record this came from, if any

    # Real provenance (Parallax translation step 1, Part 2). Default B/T2
    # matches this table's real current sole source (client-uploaded
    # documents) — see provenance.py. origin_class is also the real,
    # general structural gate for the open-reporting (D-class) edge-type
    # restriction: see database.py's validate_claim_relationship_type().
    origin_class      = Column(String(1), nullable=True, default="B")
    licence_tier      = Column(String(2), nullable=True, default="T2")

    status            = Column(String, nullable=False, default="pending", index=True)  # pending|approved|rejected
    reviewer          = Column(String, nullable=True)
    review_note       = Column(Text, nullable=True)
    reviewed_at       = Column(DateTime, nullable=True)
    created_at        = Column(DateTime, default=datetime.datetime.utcnow, index=True)

    __table_args__ = (
        Index("ix_claim_status_created", "status", "created_at"),
    )


# Real, general structural rule from Part 0's own definition ("D — open
# reporting... may only ever mint a mentioned_with-strength edge, never a
# stronger claim like 'supplies' or 'owns'"). Real audit finding: no
# existing edge-type restriction mechanism for OntologyClaim existed before
# this — this is the first real one, not a second parallel system layered
# on an existing gate. Applies to ANY class-D (open-reporting) claim, not
# hardcoded to "GDELT" specifically, since GDELT itself creates zero real
# OntologyClaim rows today (confirmed: it only ever feeds
# fusion_engine.on_signal(), never a claim/edge) — this guard is real,
# general, and ready for the day a class-D source does mint a claim.
OPEN_REPORTING_MAX_RELATIONSHIP = "mentioned_with"


def validate_claim_relationship_type(origin_class: str | None, relationship_type: str) -> None:
    """Raises ValueError if a real class-D (open-reporting) claim attempts
    to assert anything stronger than mentioned_with. Call this at every
    real OntologyClaim creation site before the row is committed."""
    if origin_class == "D" and relationship_type != OPEN_REPORTING_MAX_RELATIONSHIP:
        raise ValueError(
            f"class-D (open-reporting) evidence cannot mint a '{relationship_type}' claim — "
            f"only '{OPEN_REPORTING_MAX_RELATIONSHIP}' is allowed for this origin_class"
        )


class GeoConfirmedPlacemark(Base):
    """A real, geolocated conflict-event pin from GeoConfirmed's public API
    (per-theatre fetch — 'World' is a small curated highlight reel, NOT the
    union of every theatre; ~530 pins vs. Ukraine's real ~60,000, confirmed
    live against the real API on ingest). GeoConfirmed's real placemark API
    carries NO lastUpdate/version field (verified live 2026-09 — the id +
    date + lat/lon returned by the cheap bulk per-theatre listing is what
    change-detection actually keys on; the expensive per-id detail fetch
    only runs for a genuinely new id or one whose bulk-listing date/lat/lon
    changed). A placemark that vanishes from a live sync is soft-deleted via
    `status` (this app's existing active/removed convention — see Alert/
    SurgeEvent/WatchZone), never hard-deleted: a pin that occurred inside an
    already-generated signals-export date range must stay real and
    queryable even after GeoConfirmed itself later removes it upstream."""
    __tablename__ = "geoconfirmed_placemarks"

    id                  = Column(String, primary_key=True)   # GeoConfirmed's own real placemark UUID
    theatre_slug        = Column(String, nullable=False, index=True)   # e.g. "ukraine", "world"
    name                = Column(String, nullable=True)       # GeoConfirmed's own short label (often a date string)
    description         = Column(Text, nullable=True)         # real prose from Placemark/detail
    date                = Column(DateTime, nullable=False, index=True)  # real event date (day precision from source)
    date_precision      = Column(String, nullable=False, default="day")  # honest precision — never a fabricated finer one
    t_end               = Column(DateTime, nullable=True)     # end-of-day for day-precision dates
    latitude            = Column(Float, nullable=False)
    longitude           = Column(Float, nullable=False)
    faction             = Column(String, nullable=True)       # real GeoConfirmed faction/category label
    # Real, per-theatre faction color GeoConfirmed's own bulk placemark API
    # serves alongside the faction grouping (GET /api/Placemark/{slug} ->
    # [{name, color, invertColor, icons: [...]}]) — confirmed live 2026-09
    # via direct API inspection. The SAME hex can mean a different real side
    # in a different theatre (e.g. #0051CA is "Ukraine" in the ukraine
    # theatre but "IDF" in israel), so this is stored per-placemark-row,
    # never as a global name->color constant. Null for a placemark ingested
    # before this field existed, until its theatre next re-syncs — an
    # honest gap, never backfilled with a guessed color.
    faction_color        = Column(String, nullable=True)
    faction_invert_color = Column(Boolean, nullable=True)
    icon_url            = Column(String, nullable=True)       # GeoConfirmed's own icon path — real attribution/debug
    origin              = Column(String, nullable=True)
    original_source     = Column(Text, nullable=True)         # real citation URL(s), as GeoConfirmed provides them
    geolocation_source  = Column(String, nullable=True)       # real geolocation-verification URL
    plus_code           = Column(String, nullable=True)
    orbat_node_id       = Column(Integer, nullable=True, index=True)  # real GeoConfirmed ORBAT node id, if present
    orbat_unit_name     = Column(String, nullable=True)       # denormalized for display without a join
    status              = Column(String, nullable=False, default="active", index=True)  # active|removed — soft-delete only
    # PARALLAX addendum §A3 — the composed title, written ONCE at ingest so
    # that search, the briefing and the notification all quote the same
    # string. `name` above stays exactly as GeoConfirmed sent it (the
    # publication date, for ~99% of rows); this is the sentence a human
    # reads. Null only for a row ingested before this column existed, until
    # the §A3 backfill or its next re-sync reaches it — never defaulted to
    # the date, which is the defect the column exists to remove.
    title               = Column(Text, nullable=True)
    # Derived from the source's own description text (geoconfirmed_title.py).
    # Null is a real answer: an uncategorised placemark still plots, searches
    # and counts toward a fusion point, and is excluded only from the
    # per-category surge baselines of §A5, where a guessed label would
    # manufacture a trend nobody reported.
    category            = Column(String, nullable=True, index=True)
    detail_fetched_at   = Column(DateTime, nullable=True)     # last time the expensive detail endpoint actually ran
    ingested_at         = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at          = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
    # Real provenance (Parallax translation step 1, Part 2) — GeoConfirmed
    # is a real authoritative registry (B: a real, actively-maintained body
    # of record of verified conflict events), T3 (derived metrics/counts may
    # ship to a client; the underlying placemark records may not).
    origin_class        = Column(String(1), default="B")
    licence_tier        = Column(String(2), default="T3")

    __table_args__ = (
        Index("ix_gc_theatre_status", "theatre_slug", "status"),
    )


class GeoConfirmedOrbatNode(Base):
    """A real node from GeoConfirmed's own ORBAT tree (/api/OrbatNode/{id}),
    keyed on GeoConfirmed's real numeric node id — never name-matched. A
    dedicated table rather than folding into OntologyEntity, for the same
    reason Asset already documents for itself: a genuinely different real
    shape (a parent/child military-unit hierarchy, not infrastructure).
    Linking one of these to an EXISTING tracked/sanctioned entity in this
    app (`linked_system_id`) requires real evidence and is NEVER auto-
    applied on a name collision — see geoconfirmed.py's
    link_orbat_to_existing_entities(), which routes any candidate match to
    the real OntologyClaim review queue instead of merging it directly."""
    __tablename__ = "geoconfirmed_orbat_nodes"

    id                  = Column(Integer, primary_key=True, autoincrement=False)  # GeoConfirmed's own real node id
    parent_id           = Column(Integer, nullable=True, index=True)
    theatre_slug        = Column(String, nullable=False, index=True)
    name                = Column(String, nullable=False)
    structure_path      = Column(Text, nullable=True)   # real breadcrumb, e.g. "58th CAA ▸ Southern MD ▸ Russian Ground Forces"
    is_deleted          = Column(Boolean, default=False)
    is_disbanded        = Column(Boolean, default=False)
    color               = Column(String, nullable=True)
    # Real flag/patch image path GeoConfirmed's own ORBAT node carries
    # (`patches` field, confirmed live 2026-09 via direct API inspection —
    # e.g. Ukraine's ORBAT root: "/files/orbat/Flag_of_Ukraine.svg.png",
    # joined with https://geoconfirmed.org to load). Inconsistently
    # populated across countries/units (confirmed empty on Israel's root) —
    # null here means GeoConfirmed genuinely doesn't provide one, never a
    # placeholder. No description/general-info field exists at the
    # country/faction root level in GeoConfirmed's real API (confirmed by
    # direct audit), so there is no equivalent field to store for that.
    flag_path           = Column(String, nullable=True)
    linked_system_id    = Column(String, nullable=True, index=True)  # real OntologyEntity system_id / sanctioned entity name — ONLY set on hard evidence, never set by this app's own code today (see link_status)
    link_status         = Column(String, nullable=True, index=True)  # null | "pending_review" — never "auto_linked"
    source_last_update  = Column(DateTime, nullable=True)  # GeoConfirmed's own real lastUpdate for this node
    ingested_at         = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at          = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class ReportSnapshot(Base):
    """A frozen, versioned intelligence-picture artefact — the persistence layer
    the report pipeline needs but never had. Before this model existed,
    `prepare_intelligence_picture()` was recomputed live on every call and
    handed straight to a prompt or an HTTP response: nothing about it had an
    ID, a timestamp, or a stored copy a later report/council pass could point
    back to and say "this claim traces to artefact X, captured at time Y."
    A row here is a snapshot: taken once, stored as-is, and never mutated
    afterward — the whole point is that it does NOT change if the live data
    underneath it changes later."""
    __tablename__ = "report_snapshots"

    id           = Column(Integer, primary_key=True)
    snapshot_id  = Column(String, unique=True, index=True, nullable=False)  # SNAP-<uuid8>

    label        = Column(String, nullable=True)    # optional human label, e.g. "Red Sea AOI — daily capture"
    source       = Column(String, nullable=False, default="intelligence_picture")  # which capture pipeline produced this
    period_start = Column(DateTime, nullable=True)   # optional explicit window this snapshot covers
    period_end   = Column(DateTime, nullable=True)

    stats_json   = Column(Text, nullable=True)       # denormalized quick-view stats, for listing without parsing content
    content_json = Column(Text, nullable=False)      # the full frozen picture — never re-written after creation

    created_by   = Column(String, nullable=True)
    captured_at  = Column(DateTime, default=datetime.datetime.utcnow, index=True)

    __table_args__ = (
        Index("ix_snapshot_source_captured", "source", "captured_at"),
    )


class Asset(Base):
    """A categorized piece of real-world infrastructure — the missing piece
    for questions like "is this port civilian, military, or dual-use, and
    who owns it." `OntologyEntity` (above) is infra-only: a label, a type,
    and a metadata blob, with nowhere to put ownership or category. This is
    a genuinely new, purpose-built table rather than overloading that one.

    Every row must carry a real source citation (title/publisher/date/url +
    a quoted excerpt) — same no-fake-data gate as OntologyClaim. `category`
    and `confidence` are both deliberately constrained, human-readable
    strings, never a fabricated numeric score. `region_tag` marks which
    pilot AOI a row belongs to, per the roadmap's "populate only for the
    pilot AOI first" population strategy — this is not meant to be a
    global registry on day one."""
    __tablename__ = "assets"

    id           = Column(Integer, primary_key=True)
    asset_id     = Column(String, unique=True, index=True, nullable=False)  # AST-<uuid8>

    name         = Column(String, nullable=False)
    asset_type   = Column(String, nullable=False, index=True)   # port|airbase|naval_base|pipeline|power_plant|shipyard|...
    category     = Column(String, nullable=False, index=True)   # civilian|military|dual_use|unknown — never a numeric score
    owner        = Column(String, nullable=True)                # e.g. "Government of Djibouti", "DP World"
    operator     = Column(String, nullable=True)                # when distinct from owner (state-owned, foreign-operated, etc.)
    country      = Column(String, nullable=True)
    lat          = Column(Float, nullable=True)
    lng          = Column(Float, nullable=True)
    description  = Column(Text, nullable=True)
    region_tag   = Column(String, nullable=True, index=True)    # pilot AOI tag, e.g. "red_sea_bab_el_mandeb"

    confidence       = Column(String, nullable=True)   # 'direct' | 'inferred' — never a fabricated numeric score
    source_title     = Column(String, nullable=True)
    source_publisher = Column(String, nullable=True)
    source_date      = Column(String, nullable=True)
    source_url       = Column(String, nullable=True)
    source_excerpt   = Column(Text, nullable=True)      # the actual fact/quote grounding the category/ownership claim

    created_by   = Column(String, nullable=True)
    created_at   = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    updated_at   = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    __table_args__ = (
        Index("ix_asset_region_type", "region_tag", "asset_type"),
    )


class Report(Base):
    """A draft-to-published intelligence report — the Phase 3 entity the
    roadmap's whole "automated production of intelligence reports" mission
    depends on, and net-new: nothing in this codebase built a report
    lifecycle before this. Every report is keyed to a `ReportSnapshot`
    (Phase 1) — the frozen artefact its claims are supposed to cite — so a
    claim can point at "signal X in snapshot Y" rather than at nothing.

    `claims_json` is a list of {claim_id, text, citation, source_evaluation}
    dicts (kept inline rather than a separate table: claims belong to
    exactly one report and are never queried across reports, so a normal
    table would add join overhead for no real benefit at this scale).
    `citation` on each claim points at something checkable — either
    {"type": "snapshot_ref", "path": "ais_anomalies[2]"/"fusion_events[0]"/...,
    "id": "<the referenced item's own id field>"} for something the deterministic
    fact-check pass can verify actually exists in the snapshot, or
    {"type": "external", "url": "..."} for a claim grounded in an outside
    source instead. `source_evaluation` is the NATO Admiralty System
    (reliability A-F, credibility 1-6) — a real, standard scale an analyst
    assigns by hand during review, never a number an LLM invents.

    `council_findings_json` holds the output of the review pipeline: a
    deterministic pass (citation-existence, geo-sanity) plus a small number
    of model-based passes with distinct lenses — never a single blended
    "AI verdict," so a reviewer can see which lens flagged what."""
    __tablename__ = "reports"

    id            = Column(Integer, primary_key=True)
    report_id     = Column(String, unique=True, index=True, nullable=False)  # RPT-<uuid8>

    title         = Column(String, nullable=False)
    snapshot_id   = Column(String, nullable=False, index=True)   # the ReportSnapshot this report's claims cite
    classification = Column(String, nullable=False, default="UNCLASSIFIED // FOR ANALYTICAL USE ONLY")
    key_judgments  = Column(Text, nullable=True)                 # free-text summary, analyst-written
    claims_json    = Column(Text, nullable=False, default="[]")

    # V3 Phase 2 (deck cover slide, §6.6) — real fields Generate.jsx already
    # collects (scope/audience/horizon inputs) but never persisted anywhere
    # before this: confirmed live that /draft's body only stored title/
    # classification/key_judgments/claims/narrative/exposure. Rather than
    # fabricate these on the deck's cover slide, they're now real Report
    # columns, wired through from the same real generation-time values.
    scope         = Column(String, nullable=True)
    audience      = Column(String, nullable=True)
    horizon       = Column(String, nullable=True)

    # The Generate/Briefings rebuild's extra drafted narrative — a second
    # supporting paragraph, a one-line "Bottom line." callout, indicators/
    # warnings, and owner/by-date recommended actions. Unlike claims_json,
    # these are trusted free-text narrative (same trust model already given
    # to key_judgments) rather than individually citation-checked.
    narrative_json = Column(Text, nullable=True)
    # Real asset-register proximity matches for this report's evidence set —
    # see backend/asset_exposure.py. Null until the exposure stage has run.
    exposure_json  = Column(Text, nullable=True)

    status        = Column(String, nullable=False, default="draft", index=True)
    # draft -> in_review -> approved -> published  (or draft/in_review -> rejected)

    council_findings_json = Column(Text, nullable=True)   # set once submit-for-review has run
    council_run_at        = Column(DateTime, nullable=True)

    reviewer      = Column(String, nullable=True)
    review_note   = Column(Text, nullable=True)
    reviewed_at   = Column(DateTime, nullable=True)
    published_at  = Column(DateTime, nullable=True)

    created_by    = Column(String, nullable=True)
    created_at    = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    updated_at    = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    __table_args__ = (
        Index("ix_report_status_created", "status", "created_at"),
    )


class ReportTask(Base):
    """Tasks the system to watch a region over a time window before anything is
    drafted — sits in front of the ReportSnapshot/Report pair rather than
    replacing either. Before this existed, the only way to get a
    ReportSnapshot was to hit the endpoint and freeze "everything active,
    right now" with no region/period scope at all and no way to see what was
    accumulating before deciding to draft.

    Status machine is deliberately a SUPERSET of Report's own
    (draft -> in_review -> approved -> published/rejected): `drafting`,
    `council_review`, and `human_review` on a task correspond 1:1 to the
    underlying Report actually being in `draft`, `in_review` (twice — once
    for the council pass, once for human review), and `published`. This
    model orchestrates and points at a Report via `report_id`; it does not
    fork or replace Report's own status machine or its existing tests.

    `region_json` is either a JSON array of named Mission-Profile-style
    region strings (must match scoring.REGION_BBOXES keys — the same
    vocabulary Mission Profile's own focusRegions already uses, not a new
    geometry format) or the literal JSON string "auto", meaning: infer the
    region from Mission Profile's currently-configured focusRegions at
    collection time. v1 auto-detection is deliberately this simple lookup,
    not real hotspot/anomaly-density detection — that is real, sequenced,
    later work, not a shortcut being snuck in here.

    There is no separate "collected so far" storage column: while
    status == "collecting", the collected-so-far view is computed live by
    calling prepare_intelligence_picture() scoped to
    [period_start, min(period_end, now)] on every request, rather than
    running a background poller that periodically diffs and persists
    partial artefacts. This was the smaller, safer choice — no new
    scheduler/thread, no diff-state that can drift out of sync with the
    real data — and it inherently shows more data as time passes, since
    the query window naturally grows and the real DB naturally accumulates
    more matching rows in it. Once collection is done, `snapshot_id` points
    at a real, frozen ReportSnapshot taken via the exact same creation path
    the unscoped endpoint already uses — not a parallel implementation."""
    __tablename__ = "report_tasks"

    id            = Column(Integer, primary_key=True)
    task_id       = Column(String, unique=True, index=True, nullable=False)  # TASK-<uuid8>

    focus         = Column(Text, nullable=True)     # free text, same shape as Mission Profile's missionContext
    region_json   = Column(Text, nullable=True)      # JSON: ["Region A", ...] or the literal JSON string "auto"
    period_start  = Column(DateTime, nullable=True)   # open-ended (nullable) = "until further notice"
    period_end    = Column(DateTime, nullable=True)

    status        = Column(String, nullable=False, default="queued", index=True)
    # queued -> collecting -> ready_to_draft -> drafting -> council_review -> human_review -> published -> archived

    snapshot_id   = Column(String, nullable=True, index=True)   # set once collection freezes a ReportSnapshot
    report_id     = Column(String, nullable=True, index=True)   # set once drafting creates the underlying Report

    # Set only for a "Generate Snapshot Report" task (real WatchZone.system_id
    # it was scoped to) — real, loosely-coupled reference, same convention as
    # snapshot_id/report_id above rather than a hard FK. None for both a
    # normal region/"auto"-scoped task and a global-overview snapshot task.
    watch_zone_id = Column(String, nullable=True, index=True)

    created_by    = Column(String, nullable=True)
    created_at    = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    updated_at    = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    __table_args__ = (
        Index("ix_task_status_created", "status", "created_at"),
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
        ('initials', 'TEXT'),
        ('color', 'TEXT'),
        ('timezone', 'TEXT'),
        ('shift', 'TEXT'),
        ('team_id', 'TEXT'),
        ('title', 'TEXT'),
        ('capability_role', 'TEXT'),
        ('theme', 'TEXT'),
        ('settings', 'TEXT'),
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

    # news_articles.status — RSS retirement soft-delete column (see the
    # model's own docstring). Existing rows default to 'active' via the
    # ALTER's own DEFAULT clause, then the real bulk retirement pass
    # (backend/retire_rss.py) flips them all to 'retired' once, separately.
    if 'news_articles' in tables:
        na_existing = [row[1] for row in cur.execute('PRAGMA table_info(news_articles)').fetchall()]
        if 'status' not in na_existing:
            cur.execute("ALTER TABLE news_articles ADD COLUMN status TEXT DEFAULT 'active'")
            print('[db-migrate] news_articles: added column status')

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

    # surge_events new columns
    surge_new_cols = [
        ('keyword',         'TEXT'),
        ('context_summary', 'TEXT'),
        ('why_it_matters',  'TEXT'),
        ('updated_at',      'DATETIME'),
    ]
    if 'surge_events' in tables:
        se_existing = [row[1] for row in cur.execute('PRAGMA table_info(surge_events)').fetchall()]
        for col, typ in surge_new_cols:
            if col not in se_existing:
                cur.execute(f'ALTER TABLE surge_events ADD COLUMN {col} {typ}')
                print(f'[db-migrate] surge_events: added column {col}')

    # report_tasks new columns (Generate Snapshot Report — real WatchZone scope)
    if 'report_tasks' in tables:
        rt_existing = [row[1] for row in cur.execute('PRAGMA table_info(report_tasks)').fetchall()]
        if 'watch_zone_id' not in rt_existing:
            cur.execute('ALTER TABLE report_tasks ADD COLUMN watch_zone_id TEXT')
            print('[db-migrate] report_tasks: added column watch_zone_id')

    # Sentinel detection instrument tagging (optical vs SAR)
    if 'sentinel_detections' in tables:
        sd_existing = [row[1] for row in cur.execute('PRAGMA table_info(sentinel_detections)').fetchall()]
        if 'instrument' not in sd_existing:
            cur.execute("ALTER TABLE sentinel_detections ADD COLUMN instrument TEXT DEFAULT 'OPTICAL'")
            print('[db-migrate] sentinel_detections: added column instrument')

    # Alert correlation/dedup new columns
    alert_new_cols = [
        ('dedup_key',              'TEXT'),
        ('fire_count',             'INTEGER'),
        ('correlated_alert_ids',   'TEXT'),
        ('correlation_score',      'FLOAT'),
        ('correlation_domains',    'TEXT'),
        ('analyst_note',           'TEXT'),
        ('relevance_score',        'REAL'),
    ]
    if 'alerts' in tables:
        al_existing = [row[1] for row in cur.execute('PRAGMA table_info(alerts)').fetchall()]
        for col, typ in alert_new_cols:
            if col not in al_existing:
                cur.execute(f'ALTER TABLE alerts ADD COLUMN {col} {typ}')
                print(f'[db-migrate] alerts: added column {col}')

    # geoconfirmed_placemarks composed-title columns (PARALLAX addendum §A3).
    # Added to a table that already holds ~74,700 rows in deployed databases,
    # so create_all() below will not add them — and they are left NULL here
    # rather than backfilled inline, because composing 74,700 titles inside
    # the migration would block startup. backfill_geoconfirmed_titles() does
    # it in bounded batches.
    gc_new_cols = [
        ('title',    'TEXT'),
        ('category', 'TEXT'),
    ]
    if 'geoconfirmed_placemarks' in tables:
        gc_existing = [row[1] for row in cur.execute('PRAGMA table_info(geoconfirmed_placemarks)').fetchall()]
        for col, typ in gc_new_cols:
            if col not in gc_existing:
                cur.execute(f'ALTER TABLE geoconfirmed_placemarks ADD COLUMN {col} {typ}')
                print(f'[db-migrate] geoconfirmed_placemarks: added column {col}')
        if 'category' not in gc_existing:
            cur.execute('CREATE INDEX IF NOT EXISTS ix_gc_category ON geoconfirmed_placemarks (category)')

    # ontology_claims validity-window columns (added after the table already
    # existed in deployed databases — create_all() below only creates missing
    # tables, it never adds columns to one that's already there)
    claim_new_cols = [
        ('valid_from',  'DATETIME'),
        ('valid_until', 'DATETIME'),
    ]
    if 'ontology_claims' in tables:
        oc_existing = [row[1] for row in cur.execute('PRAGMA table_info(ontology_claims)').fetchall()]
        for col, typ in claim_new_cols:
            if col not in oc_existing:
                cur.execute(f'ALTER TABLE ontology_claims ADD COLUMN {col} {typ}')
                print(f'[db-migrate] ontology_claims: added column {col}')

    # reports.narrative_json — the new Generate/Briefings rebuild's extra
    # drafted narrative fields (second_para, bottom_line, warnings, actions)
    # beyond the existing key_judgments/claims, plus the real asset-register
    # exposure matches computed for the report's evidence set.
    if 'reports' in tables:
        rp_existing = [row[1] for row in cur.execute('PRAGMA table_info(reports)').fetchall()]
        if 'narrative_json' not in rp_existing:
            cur.execute('ALTER TABLE reports ADD COLUMN narrative_json TEXT')
            print('[db-migrate] reports: added column narrative_json')
        if 'exposure_json' not in rp_existing:
            cur.execute('ALTER TABLE reports ADD COLUMN exposure_json TEXT')
            print('[db-migrate] reports: added column exposure_json')
        # V3 Phase 2 — real scope/audience/horizon, see Report's own docstring.
        for _col in ('scope', 'audience', 'horizon'):
            if _col not in rp_existing:
                cur.execute(f'ALTER TABLE reports ADD COLUMN {_col} TEXT')
                print(f'[db-migrate] reports: added column {_col}')

    # Imagery page — real image persistence, real AOI proposal lifecycle,
    # real detection review status.
    if 'sentinel_scans' in tables:
        ss_existing = [row[1] for row in cur.execute('PRAGMA table_info(sentinel_scans)').fetchall()]
        if 'image_b64' not in ss_existing:
            cur.execute('ALTER TABLE sentinel_scans ADD COLUMN image_b64 TEXT')
            print('[db-migrate] sentinel_scans: added column image_b64')
        if 'instrument' not in ss_existing:
            cur.execute("ALTER TABLE sentinel_scans ADD COLUMN instrument TEXT DEFAULT 'OPTICAL'")
            print('[db-migrate] sentinel_scans: added column instrument (real default OPTICAL — every existing row predates the real SAR path)')
    if 'sentinel_detections' in tables:
        sd2_existing = [row[1] for row in cur.execute('PRAGMA table_info(sentinel_detections)').fetchall()]
        if 'reviewed_status' not in sd2_existing:
            cur.execute("ALTER TABLE sentinel_detections ADD COLUMN reviewed_status TEXT DEFAULT 'pending'")
            print('[db-migrate] sentinel_detections: added column reviewed_status')
    if 'watch_zones' in tables:
        wz2_existing = [row[1] for row in cur.execute('PRAGMA table_info(watch_zones)').fetchall()]
        if 'aoi_class' not in wz2_existing:
            cur.execute("ALTER TABLE watch_zones ADD COLUMN aoi_class TEXT DEFAULT 'custom'")
            print('[db-migrate] watch_zones: added column aoi_class')
        if 'status' not in wz2_existing:
            cur.execute("ALTER TABLE watch_zones ADD COLUMN status TEXT DEFAULT 'active'")
            print('[db-migrate] watch_zones: added column status')
        if 'owner' not in wz2_existing:
            cur.execute('ALTER TABLE watch_zones ADD COLUMN owner TEXT')
            print('[db-migrate] watch_zones: added column owner')
        if 'sensor_preference' not in wz2_existing:
            cur.execute("ALTER TABLE watch_zones ADD COLUMN sensor_preference TEXT DEFAULT 'sentinel2_optical'")
            print('[db-migrate] watch_zones: added column sensor_preference')

    # Real correlation-strength breakdown (correlation_scoring.py) — see
    # FusionEvent.correlation_strength/correlation_components above.
    if 'fusion_events' in tables:
        fe_existing = [row[1] for row in cur.execute('PRAGMA table_info(fusion_events)').fetchall()]
        if 'correlation_strength' not in fe_existing:
            cur.execute('ALTER TABLE fusion_events ADD COLUMN correlation_strength FLOAT')
            print('[db-migrate] fusion_events: added column correlation_strength')
        if 'correlation_components' not in fe_existing:
            cur.execute('ALTER TABLE fusion_events ADD COLUMN correlation_components TEXT')
            print('[db-migrate] fusion_events: added column correlation_components')
        if 'narrative_generated_at' not in fe_existing:
            cur.execute('ALTER TABLE fusion_events ADD COLUMN narrative_generated_at DATETIME')
            print('[db-migrate] fusion_events: added column narrative_generated_at')
        if 'geo_key' not in fe_existing:
            cur.execute('ALTER TABLE fusion_events ADD COLUMN geo_key VARCHAR')
            print('[db-migrate] fusion_events: added column geo_key')

    # 2026-09 alert/detector audit: a real clean delete (not just "stop
    # seeding") of the two orphaned RuleConfig rows confirmed to have zero
    # backing detector code anywhere in the codebase — ADSB_SQUAWK_MILITARY
    # ("Military Squawk Code") and ADSB_TRANSPONDER_ANOMALY ("Transponder
    # Anomaly"). Both were `enabled=True` in the live DB but main.py's own
    # WIRED_RULE_NAMES allowlist already marked them wired=false/live=false
    # — they could never actually fire. seed_rules.py's seed definitions for
    # both were removed in the same pass; this one-time cleanup removes the
    # already-seeded rows themselves so a fresh deploy doesn't carry them
    # forward as dead configuration. Confirmed (2026-09) no EscalationChain
    # or RuleConnection row references either rule_id, so this is a safe,
    # standalone delete.
    if 'rule_configs' in tables:
        cur.execute(
            "DELETE FROM rule_configs WHERE rule_name IN "
            "('ADSB_SQUAWK_MILITARY', 'ADSB_TRANSPONDER_ANOMALY')"
        )
        if cur.rowcount:
            print(f'[db-migrate] rule_configs: removed {cur.rowcount} orphaned row(s) '
                  f'(ADSB_SQUAWK_MILITARY / ADSB_TRANSPONDER_ANOMALY — no backing detector code)')

    # geoconfirmed_placemarks.faction_color / faction_invert_color — real,
    # per-theatre faction color GeoConfirmed's own bulk placemark API serves
    # (GET /api/Placemark/{slug} groups placemarks under a faction object
    # carrying its own real {color, invertColor}), confirmed live 2026-09.
    # Previously discarded during ingestion; the map marker used one fixed
    # hardcoded color for every placemark regardless of real faction/side.
    if 'geoconfirmed_placemarks' in tables:
        gcp_existing = [row[1] for row in cur.execute('PRAGMA table_info(geoconfirmed_placemarks)').fetchall()]
        if 'faction_color' not in gcp_existing:
            cur.execute('ALTER TABLE geoconfirmed_placemarks ADD COLUMN faction_color TEXT')
            print('[db-migrate] geoconfirmed_placemarks: added column faction_color')
        if 'faction_invert_color' not in gcp_existing:
            cur.execute('ALTER TABLE geoconfirmed_placemarks ADD COLUMN faction_invert_color BOOLEAN DEFAULT 0')
            print('[db-migrate] geoconfirmed_placemarks: added column faction_invert_color')

    # geoconfirmed_orbat_nodes.flag_path — real flag/patch image path
    # (GeoConfirmed's own `patches` field), confirmed live 2026-09.
    if 'geoconfirmed_orbat_nodes' in tables:
        gon_existing = [row[1] for row in cur.execute('PRAGMA table_info(geoconfirmed_orbat_nodes)').fetchall()]
        if 'flag_path' not in gon_existing:
            cur.execute('ALTER TABLE geoconfirmed_orbat_nodes ADD COLUMN flag_path TEXT')
            print('[db-migrate] geoconfirmed_orbat_nodes: added column flag_path')

    # Real provenance fields (Parallax translation step 1, Part 2) — see
    # provenance.py's module docstring for the real two-axis model. Each
    # real source table gets its own real default matching the source
    # mapping table; `alerts` is left nullable/no-default since its
    # provenance varies per real Alert.source row (populated at write time
    # in alert_writer.write_alert(), not via a column default).
    _PROVENANCE_DEFAULTS = [
        ('aircraft_history',        'C', 'T1'),
        ('vessel_history',          'B', 'T1'),
        ('sentinel_detections',     'A', 'T1'),
        ('sanctioned_entities',     'B', 'T1'),
        ('ontology_claims',         'B', 'T2'),
        ('geoconfirmed_placemarks', 'B', 'T3'),
    ]
    for table_name, oclass_default, ltier_default in _PROVENANCE_DEFAULTS:
        if table_name in tables:
            existing_cols = [row[1] for row in cur.execute(f'PRAGMA table_info({table_name})').fetchall()]
            if 'origin_class' not in existing_cols:
                cur.execute(f"ALTER TABLE {table_name} ADD COLUMN origin_class TEXT DEFAULT '{oclass_default}'")
                cur.execute(f"UPDATE {table_name} SET origin_class = '{oclass_default}' WHERE origin_class IS NULL")
                print(f'[db-migrate] {table_name}: added column origin_class (real default {oclass_default})')
            if 'licence_tier' not in existing_cols:
                cur.execute(f"ALTER TABLE {table_name} ADD COLUMN licence_tier TEXT DEFAULT '{ltier_default}'")
                cur.execute(f"UPDATE {table_name} SET licence_tier = '{ltier_default}' WHERE licence_tier IS NULL")
                print(f'[db-migrate] {table_name}: added column licence_tier (real default {ltier_default})')
    if 'alerts' in tables:
        al_prov_existing = [row[1] for row in cur.execute('PRAGMA table_info(alerts)').fetchall()]
        if 'origin_class' not in al_prov_existing:
            cur.execute('ALTER TABLE alerts ADD COLUMN origin_class TEXT')
            print('[db-migrate] alerts: added column origin_class (no default — populated per-row by real source at write time)')
        if 'licence_tier' not in al_prov_existing:
            cur.execute('ALTER TABLE alerts ADD COLUMN licence_tier TEXT')
            print('[db-migrate] alerts: added column licence_tier (no default — populated per-row by real source at write time)')

    # Real perf-round fix — Base.metadata.create_all() below only creates
    # missing TABLES, never adds a missing INDEX to an existing table, so
    # the composite indexes declared on AircraftHistory/VesselHistory
    # above (added in this same round) need this explicit real migration
    # to actually reach an existing real database. Measured directly
    # against this app's own real, live data: the count(distinct
    # icao24/mmsi) query briefing_prep.py's traffic summary runs on every
    # call went from ~2.5-3.0s to ~0.06-0.08s once these exist.
    if 'aircraft_history' in tables:
        ah_indexes = {row[1] for row in cur.execute("PRAGMA index_list(aircraft_history)").fetchall()}
        if 'ix_aircraft_history_icao24_timestamp' not in ah_indexes:
            cur.execute('CREATE INDEX IF NOT EXISTS ix_aircraft_history_icao24_timestamp ON aircraft_history(icao24, timestamp)')
            print('[db-migrate] aircraft_history: added composite index (icao24, timestamp)')
    if 'vessel_history' in tables:
        vh_indexes = {row[1] for row in cur.execute("PRAGMA index_list(vessel_history)").fetchall()}
        if 'ix_vessel_history_mmsi_timestamp' not in vh_indexes:
            cur.execute('CREATE INDEX IF NOT EXISTS ix_vessel_history_mmsi_timestamp ON vessel_history(mmsi, timestamp)')
            print('[db-migrate] vessel_history: added composite index (mmsi, timestamp)')

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

        # Real auth round — Trifecta Technologies, the one real team, and
        # its three real named users. The shared temporary password is read
        # from SEED_TEMP_PASSWORD (never hardcoded here, never logged) — if
        # unset, this block honestly skips seeding these three accounts
        # rather than falling back to any committed plaintext value.
        team = db.query(Team).filter(Team.name == "Trifecta Technologies").first()
        if not team:
            team = Team(name="Trifecta Technologies")
            db.add(team)
            db.commit()
            db.refresh(team)

        seed_pw = os.getenv("SEED_TEMP_PASSWORD")
        if seed_pw:
            trifecta_users = [
                {"email": "marc.lunau@trifecta-technologies.com",     "name": "Marc Lunau",       "title": "CTO"},
                {"email": "hannes.kohnen@trifecta-technologies.com",  "name": "Hannes Kohnen",    "title": "CEO"},
                {"email": "jakob.hentschel@trifecta-technologies.com","name": "Jakob Hentschel",  "title": "Chief Strategy Officer"},
            ]
            for tu in trifecta_users:
                existing = db.query(User).filter(User.email == tu["email"]).first()
                if existing:
                    existing.team_id = team.id
                    existing.title = tu["title"]
                    if not existing.capability_role:
                        existing.capability_role = "security_lead"
                    if not existing.approved:
                        existing.approved = True
                else:
                    db.add(User(
                        email=tu["email"], name=tu["name"], title=tu["title"],
                        password_hash=pwd.hash(seed_pw),
                        team_id=team.id, capability_role="security_lead",
                        role="analyst", is_super_admin=False, approved=True,
                        # timezone/shift left honestly unset — this org's
                        # real primary timezone isn't something I have real
                        # evidence for; _user_to_dict() already falls back
                        # to "UTC" for DISPLAY only, same as the 2 pre-
                        # existing users, rather than writing a guessed
                        # value into the real stored record.
                    ))
            db.commit()
            print("[db-seed] Trifecta Technologies team + 3 real users ensured (password from SEED_TEMP_PASSWORD, not logged)")
        else:
            print("[db-seed] SEED_TEMP_PASSWORD not set — skipping Trifecta user seed (no plaintext fallback)")
    finally:
        db.close()
