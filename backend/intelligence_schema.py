"""
intelligence_schema.py — Unified output schema for all Forge rule assessments.

Every rule type (AIS, ADS-B, NEWS, SENTINEL) produces IntelligenceAssessment rows.
These are the structured source material Claude reads when generating briefings.
"""
from __future__ import annotations
import uuid
import datetime
from sqlalchemy import Column, String, Boolean, DateTime, Text, Float, Integer

from database import Base


def _new_assess_id() -> str:
    return f"ASSESS-{uuid.uuid4().hex[:8].upper()}"


class IntelligenceAssessment(Base):
    __tablename__ = "intelligence_assessments"

    id                    = Column(Integer, primary_key=True)
    assessment_id         = Column(String, unique=True, index=True,
                                   default=_new_assess_id)
    created_at            = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at            = Column(DateTime, default=datetime.datetime.utcnow,
                                   onupdate=datetime.datetime.utcnow)
    expires_at            = Column(DateTime, nullable=False)

    # Classification
    assessment_type       = Column(String, nullable=False, index=True)
    domain                = Column(String, nullable=False, default="NEWS", index=True)
    severity              = Column(String, nullable=False, default="medium")

    # Location
    location_name         = Column(String, nullable=True)
    location_country      = Column(String, nullable=True)   # ISO-2, nullable
    region_id             = Column(String, nullable=True)
    lat                   = Column(Float, nullable=True)
    lon                   = Column(Float, nullable=True)

    # Confidence
    confidence            = Column(Float, default=0.5)
    confidence_reasoning  = Column(Text, nullable=True)

    # Evidence
    evidence_count        = Column(Integer, default=0)
    evidence_items        = Column(Text, default="[]")       # JSON array
    timeframe_hours       = Column(Integer, default=24)

    # Claude-ready summary
    headline              = Column(String, nullable=False)
    summary               = Column(Text, nullable=True)
    key_signals           = Column(Text, default="[]")       # JSON array
    recommended_actions   = Column(Text, default="[]")       # JSON array

    # Source tracking
    source_rule_id        = Column(Integer, nullable=True)
    source_rule_name      = Column(String, nullable=True)
    contributing_alert_ids = Column(Text, default="[]")      # JSON array

    # Map marker
    marker_type           = Column(String, nullable=True)
    marker_visible        = Column(Boolean, default=True)
    poi_id                = Column(Integer, nullable=True)
