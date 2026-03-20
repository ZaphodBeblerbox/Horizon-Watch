from sqlalchemy import create_engine, Column, String, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
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
