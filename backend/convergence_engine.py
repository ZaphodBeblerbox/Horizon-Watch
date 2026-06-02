"""
Signal Convergence Engine
Every 30 minutes: pull all active signals, group by 200km geographic buckets,
send each meaningful cluster to Sonnet, get back structured intelligence
assessment, store as FusionEvent.
"""

import json
import re
import math
import anthropic
from datetime import datetime, timedelta

client = anthropic.Anthropic()

_last_run: datetime = None
_RUN_INTERVAL_MINUTES = 30


def _geo_bucket(lat, lon, resolution=2.0):
    """Round to 2-degree bucket (~200km)."""
    return (round(lat / resolution) * resolution,
            round(lon / resolution) * resolution)


def _haversine_km(lat1, lon1, lat2, lon2) -> float:
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a  = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


async def run_convergence_cycle(db, force: bool = False) -> int:
    """Main cycle. Returns number of assessments created."""
    global _last_run
    now = datetime.utcnow()

    if not force and _last_run and (now - _last_run).total_seconds() < _RUN_INTERVAL_MINUTES * 60:
        return 0

    _last_run = now
    print(f"[convergence] Starting cycle at {now.strftime('%H:%M:%S')}")

    cutoff = now - timedelta(hours=12)
    signals = []

    # ── 1. Gather all active signals ────────────────────────────────────────────

    try:
        from database import Alert
        for a in (db.query(Alert)
                    .filter(Alert.status == "active",
                            Alert.created_at >= cutoff,
                            Alert.lat.isnot(None))
                    .order_by(Alert.relevance_score.desc())
                    .limit(60).all()):
            signals.append({
                "type": f"{(a.source or 'AIS').upper()}_ALERT",
                "domain": (a.source or "AIS").upper(),
                "title": (a.title or "")[:150],
                "rule": a.alert_type or "",
                "severity": a.severity or "medium",
                "lat": a.lat, "lon": a.lon,
                "country": a.country_code or "",
                "created_at": a.created_at.isoformat() if a.created_at else "",
                "id": a.alert_id,
            })
    except Exception as e:
        print(f"[convergence] Alert query: {e}")

    try:
        from database import SurgeEvent
        for s in (db.query(SurgeEvent)
                    .filter(SurgeEvent.status == "active",
                            SurgeEvent.expires_at > now,
                            SurgeEvent.lat.isnot(None))
                    .all()):
            signals.append({
                "type": "NEWS_SURGE",
                "domain": "NEWS",
                "title": (s.headline or "")[:150],
                "rule": "surge",
                "severity": s.severity or "medium",
                "lat": s.lat, "lon": s.lon,
                "country": s.location_country or "",
                "created_at": s.created_at.isoformat() if s.created_at else "",
                "article_count": s.article_count or 0,
                "context": (s.context_summary or "")[:300],
                "id": s.surge_id,
            })
    except Exception as e:
        print(f"[convergence] Surge query: {e}")

    try:
        from database import NewsArticle
        for n in (db.query(NewsArticle)
                    .filter(NewsArticle.tier == 1,
                            NewsArticle.lat.isnot(None),
                            NewsArticle.ingested_at >= cutoff)
                    .order_by(NewsArticle.relevance_score.desc())
                    .limit(30).all()):
            signals.append({
                "type": "NEWS_ARTICLE",
                "domain": "NEWS",
                "title": (n.event_title or n.title or "")[:150],
                "rule": "tier1_news",
                "severity": "high",
                "lat": n.lat, "lon": n.lon,
                "country": n.country_code or "",
                "created_at": n.published or "",
                "context": (n.context_summary or "")[:300],
                "source": n.source_name or "",
                "id": str(n.id or ""),
            })
    except Exception as e:
        print(f"[convergence] News query: {e}")

    if not signals:
        print("[convergence] No signals found")
        return 0

    domains_present = set(s["domain"] for s in signals)
    print(f"[convergence] {len(signals)} signals across {len(domains_present)} domains")

    # ── 2. Group by geographic bucket ───────────────────────────────────────────

    buckets: dict = {}
    for sig in signals:
        bucket = _geo_bucket(sig["lat"], sig["lon"])
        buckets.setdefault(bucket, []).append(sig)

    # Interesting = 2+ signals OR single critical
    interesting = {
        k: v for k, v in buckets.items()
        if len(v) >= 2 or any(s["severity"] == "critical" for s in v)
    }
    print(f"[convergence] {len(interesting)} interesting clusters from {len(buckets)} buckets")

    # ── 3. Assess each cluster with Sonnet ──────────────────────────────────────

    from database import FusionEvent
    assessments_created = 0

    for bucket_key, cluster in list(interesting.items())[:8]:
        bucket_lat, bucket_lon = bucket_key
        domains = list(set(s["domain"] for s in cluster))
        n = len(cluster)

        # Skip low-value single-domain clusters
        if len(domains) == 1 and n < 3:
            if not any(s["severity"] in ("high", "critical") for s in cluster):
                continue

        # Check for recent assessment of same area
        try:
            recent = (db.query(FusionEvent)
                        .filter(FusionEvent.lat.between(bucket_lat - 2, bucket_lat + 2),
                                FusionEvent.lon.between(bucket_lon - 2, bucket_lon + 2),
                                FusionEvent.created_at >= now - timedelta(hours=2),
                                FusionEvent.status == "active")
                        .first())
            if recent:
                continue
        except Exception:
            pass

        # Build signal lines for Claude
        lines = []
        for s in sorted(cluster, key=lambda x: x["severity"], reverse=True)[:10]:
            line = f"[{s['domain']}] {s['rule'].upper()}: {s['title'][:100]}"
            if s.get("context"):
                line += f" — {s['context'][:150]}"
            lines.append(line)

        prompt = f"""You are an intelligence analyst. Assess this cluster of signals from a 200km area.

LOCATION: ~{bucket_lat:.1f}N {bucket_lon:.1f}E
SIGNALS ({n} total, {len(domains)} domains):
{chr(10).join(lines)}

Respond ONLY with valid JSON, no markdown fences:
{{
  "title": "5-8 word intelligence headline",
  "subtitle": "one sentence operational summary",
  "narrative": "2-3 sentences. What is happening, why it matters, what to watch. Specific and factual.",
  "severity": "critical|high|medium|low",
  "confidence": 0.0-1.0,
  "domains": {json.dumps(domains)},
  "key_finding": "single most important fact",
  "watch_item": "specific observable to monitor next"
}}"""

        try:
            resp = client.messages.create(
                model="claude-sonnet-4-5-20251015",
                max_tokens=400,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = resp.content[0].text.strip()

            m = re.search(r'\{.*\}', raw, re.DOTALL)
            if not m:
                continue
            assessment = json.loads(m.group())

            avg_lat = sum(s["lat"] for s in cluster) / len(cluster)
            avg_lon = sum(s["lon"] for s in cluster) / len(cluster)

            fusion = FusionEvent(
                fusion_id=(f"CONV-{int(now.timestamp())}"
                           f"-{abs(hash(bucket_key)) % 9999:04d}"),
                title=assessment.get("title", ""),
                subtitle=assessment.get("subtitle", ""),
                narrative=assessment.get("narrative", ""),
                severity=assessment.get("severity", "medium"),
                confidence=float(assessment.get("confidence", 0.75)),
                domains=json.dumps(domains),
                signal_count=n,
                lat=avg_lat,
                lon=avg_lon,
                status="active",
                key_signals=json.dumps([s["title"][:80] for s in cluster[:3]]),
                threat_indicators=json.dumps([
                    assessment.get("key_finding", ""),
                    assessment.get("watch_item", ""),
                ]),
                created_at=now,
                expires_at=now + timedelta(hours=6),
            )
            db.add(fusion)
            db.commit()
            assessments_created += 1
            print(f"[convergence] {assessment.get('title','?')} [{assessment.get('severity')}] {domains}")

        except json.JSONDecodeError as e:
            print(f"[convergence] JSON parse failed: {e}")
        except Exception as e:
            print(f"[convergence] Sonnet call failed: {e}")

    print(f"[convergence] Cycle complete: {assessments_created} assessments")
    return assessments_created
