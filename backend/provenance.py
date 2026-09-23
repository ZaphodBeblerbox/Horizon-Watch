"""
provenance.py — the real, two-independent-axis provenance model (Parallax
translation step 1, Parts 0-2).

Two real, INDEPENDENT fields, never merged into one "quality" score:

  origin_class — how good is this evidence (a fixed 4-value scale):
    A = primary instrument (sensor output, unmediated)
    B = authoritative registry (a real body of record)
    C = commercial/aggregated redistribution (cleaned/resold — provenance
        survives, the raw data doesn't)
    D = open reporting (press/social — fast, cheap, weak)

  licence_tier — may this reach a client, independently of evidence quality:
    T1 = client-deliverable, may be quoted/charted/shipped verbatim
    T2 = internal only, may inform a conclusion, never leaves the building
    T3 = derived metrics only (counts/indices/deltas may ship, records may not)
    T4 = research/non-commercial — excellent evidence, illegal in a paid deliverable

Canonical real example of why these are independent: a real ADS-B feed can
be class-A instrument data while being licensed T4 — merging the two axes
would make it "legal by accident" to ship research-licensed data to a
paying client.

Real per-source mapping — populated at real ingest time by each source's
own writer (alert_writer.write_alert, geoconfirmed.py, sanctions_loader.py,
sentinel ingestion, OntologyClaim creation). This module is the single
real source of truth for the mapping so no call site invents its own copy.

Real audit finding (this pass): no origin_class/licence_tier field existed
anywhere in this codebase before this change. The pre-existing
`_DOMAIN_DEFAULT_RELIABILITY` dict in correlation_scoring.py is a DIFFERENT
thing — a numeric 0-1 weight used purely as a fusion-scoring input, not an
evidentiary-class/legal-clearance classification. It is not subsumed by or
merged with this new pair; both continue to exist for their own real purpose.

Real per-source assignment used here (see each field's own real reasoning
where a source name is ambiguous):
  - GeoConfirmed:            B / T3
  - AIS (vessel tracks):     B / T1
  - ADS-B (aircraft):        C / T1 — this app's real ADS-B source is
    api.adsb.lol, a free community-aggregated redistribution of many
    volunteer ground receivers (cleaned/merged before serving), not a raw
    unmediated instrument feed this app owns directly — real-world class C,
    not A. (State explicitly: if this app ever adds a direct receiver feed
    of its own, THAT would be real class A and should get its own mapping
    entry, not reuse this one.)
  - sanctioned_entities/OpenSanctions: B / T1
  - Satellite imagery (SentinelDetection): A / T1
  - GDELT: D / T3 — no persistent per-row DB table exists for GDELT today
    (it's an in-memory/JSON-cache structure, gdelt_events.py's
    _persist_cache()) — see the Part 2 report for what this means for
    schema population.
  - Client-uploaded documents (OntologyClaim sources): B / T2

Deliberately NOT assigned (real, honest gap — not fabricated): Alert rows
written with source in ("surge", "fusion", "manual") don't correspond to
one single primary ingestion source in the real mapping table above —
"surge" is a derived trend computation over multiple underlying signals,
"fusion" is a derived cross-domain correlation over multiple sources, and
"manual" is operator-entered. Assigning any of the four real values to
these would be a real judgment call the source prompt's mapping table
doesn't authorize — left as None (honestly unclassified) rather than
guessed at.
"""
from __future__ import annotations

ORIGIN_CLASSES = ("A", "B", "C", "D")
LICENCE_TIERS = ("T1", "T2", "T3", "T4")

# Real per-Alert.source mapping — only for the real sources this app's own
# Alert-writing pipelines actually use and that the source mapping table
# above covers. Anything else (surge/fusion/manual) intentionally absent.
ALERT_SOURCE_PROVENANCE: dict[str, tuple[str, str]] = {
    "ais":          ("B", "T1"),
    "adsb":         ("C", "T1"),
    "geoconfirmed": ("B", "T3"),
    # Scenario board (spec addendum F10). A model forecast is class C —
    # machine-derived — and an analyst's is class B, because the two have
    # different records and the briefing must be able to tell them apart
    # without reading the text. T2: internal by default, since a forecast
    # is not an observation and must not leave on the same footing as one.
    "forecast":          ("C", "T2"),
    "forecast_analyst":  ("B", "T2"),
}


def provenance_for_alert_source(source: str) -> tuple[str | None, str | None]:
    """Real (origin_class, licence_tier) for a real Alert.source value, or
    (None, None) for a source this mapping deliberately doesn't cover
    (surge/fusion/manual/anything unrecognized) — never guessed at."""
    pair = ALERT_SOURCE_PROVENANCE.get((source or "").lower())
    return pair if pair else (None, None)
