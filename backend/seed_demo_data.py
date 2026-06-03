"""
seed_demo_data.py — Realistic demo data seeder.
Seeds: ForesightAssessments, ThreatSnapshotHourly (30-day history),
       SurgeEvents, forge Alerts, ThreatTrajectory rows.

Run: python3 seed_demo_data.py
"""
import sys, json, random
sys.path.insert(0, '.')
from database import SessionLocal, Base, engine
from datetime import datetime, timedelta

db = SessionLocal()
now = datetime.utcnow()

# ── FORESIGHT ASSESSMENTS ─────────────────────────────────────────────────────

FORESIGHT_DATA = [
    {
        "zone_id": "Black Sea / Ukraine", "zone_name": "Black Sea / Ukraine",
        "score": 87, "model": "claude-sonnet-4-5-20251015",
        "situation": (
            "Russian forces continue grinding offensive operations along the Donetsk axis, "
            "with incremental territorial gains near Chasiv Yar and Toretsk. Ukrainian forces "
            "are conducting active defence with drone-intensive tactics, inflicting significant "
            "attrition on Russian armoured formations. Artillery exchange intensity remains "
            "elevated across the entire front line."
        ),
        "trajectory": (
            "Situation is deteriorating at a measured pace. Russian operational tempo has "
            "increased marginally over the past 30 days, consistent with a deliberate "
            "attritional strategy rather than a major offensive push."
        ),
        "escalation_prob": 0.68,
        "prob_basis": (
            "High probability driven by sustained Russian offensive pressure, declining "
            "Ukrainian ammunition reserves per open-source reporting, and increased Russian "
            "air operations. Offset by continued Western military aid packages."
        ),
        "scenarios": [
            {"scenario": "Continued attrition", "probability": 0.55,
             "description": "Current grinding offensive continues with slow Russian territorial gains.",
             "timeline": "months", "key_triggers": ["Sustained ammunition supply", "No major Ukrainian counteroffensive"]},
            {"scenario": "Russian operational pause", "probability": 0.25,
             "description": "Russian forces consolidate gains ahead of winter.",
             "timeline": "weeks", "key_triggers": ["Logistics strain indicators", "Rotational unit movements"]},
            {"scenario": "Escalation to strategic strikes", "probability": 0.20,
             "description": "Russian deep strikes on Ukrainian energy infrastructure intensify.",
             "timeline": "weeks", "key_triggers": ["Temperature drop below 0C", "Ukrainian drone strikes on Russian territory"]},
        ],
        "patterns": [
            {"historical_analogue": "Donbas 2014-2015",
             "similarity_basis": "Same geographic theatre, similar grinding attritional pattern.",
             "similarity_score": 0.71, "outcome_of_analogue": "Frozen conflict with Minsk agreements, periodic flare-ups over 8 years."},
            {"historical_analogue": "Korea 1951-1953",
             "similarity_basis": "Positional warfare along established front lines, high casualties for marginal gains.",
             "similarity_score": 0.48, "outcome_of_analogue": "Armistice agreement maintaining approximate pre-war front lines."},
        ],
        "indicators": [
            {"indicator": "Russian armour concentration north of Kupyansk", "domain": "SENTINEL",
             "significance": "Would signal preparation for northern axis offensive", "current_status": "not_observed"},
            {"indicator": "Ukrainian 47th Brigade redeployment from Avdiivka axis", "domain": "NEWS",
             "significance": "Strategic reserve movement indicating expected breakthrough attempt", "current_status": "weak_signal"},
            {"indicator": "Increased Russian electronic warfare emissions near Kharkiv", "domain": "ADSB",
             "significance": "GPS jamming precedes major ground operations", "current_status": "active"},
        ],
        "gaps": ["Actual Ukrainian reserve strength", "Russian ammunition production rates", "Western F-16 delivery timelines"],
        "confidence": "high",
        "analyst_note": "GPS jamming over Kharkiv oblast is the most actionable current indicator — correlate with ADSB anomalies and Black Sea AIS behaviour.",
    },
    {
        "zone_id": "Persian Gulf", "zone_name": "Persian Gulf / Strait of Hormuz",
        "score": 74, "model": "claude-sonnet-4-5-20251015",
        "situation": (
            "IRGCN patrol boat activity in the strait remains above baseline following the "
            "latest round of US-Iran nuclear negotiations. Two oil tankers reported GPS "
            "spoofing incidents in the past 72 hours. Iranian state media rhetoric regarding "
            "'closure capability' has intensified. 21% of global petroleum transits daily."
        ),
        "trajectory": (
            "Elevated and trending upward. Iranian coercive messaging has increased in "
            "frequency and specificity, consistent with a deliberate pressure campaign "
            "tied to nuclear negotiation leverage."
        ),
        "escalation_prob": 0.51,
        "prob_basis": "Moderate-high probability. Iran has historically escalated maritime harassment during diplomatic deadlocks. Nuclear talks stalled.",
        "scenarios": [
            {"scenario": "Tanker seizure or harassment", "probability": 0.38,
             "description": "IRGCN seizes or briefly detains a tanker linked to Israel or Western interests.",
             "timeline": "weeks", "key_triggers": ["Nuclear talks formal breakdown", "Israeli strike on Iranian proxy"]},
            {"scenario": "GPS spoofing escalation", "probability": 0.35,
             "description": "Systematic GPS interference campaign causes navigational incidents.",
             "timeline": "days", "key_triggers": ["New US sanctions announcement", "IRGCN exercise near strait"]},
            {"scenario": "De-escalation via diplomacy", "probability": 0.27,
             "description": "Back-channel agreement reduces Iranian pressure.",
             "timeline": "months", "key_triggers": ["Oman mediation progress"]},
        ],
        "patterns": [
            {"historical_analogue": "Tanker War 1984-1988",
             "similarity_basis": "Systematic targeting of neutral shipping as coercion tool.",
             "similarity_score": 0.59, "outcome_of_analogue": "US naval intervention (Operation Earnest Will), direct US-Iran clashes."},
        ],
        "indicators": [
            {"indicator": "IRGCN fast boat deployment beyond normal patrol range", "domain": "AIS",
             "significance": "Indicates preparation for interception operation", "current_status": "weak_signal"},
            {"indicator": "GPS spoofing density increase in eastern strait", "domain": "ADSB",
             "significance": "Electronic warfare precedes physical harassment", "current_status": "active"},
        ],
        "gaps": ["IRGCN operational orders and alert status", "Iran actual nuclear enrichment progress"],
        "confidence": "medium",
        "analyst_note": "GPS spoofing in the eastern strait is the leading indicator — it has preceded every IRGCN interdiction attempt in the past 3 years.",
    },
    {
        "zone_id": "Red Sea / Bab el-Mandeb", "zone_name": "Red Sea / Bab el-Mandeb",
        "score": 79, "model": "claude-sonnet-4-5-20251015",
        "situation": (
            "Houthi forces continue systematic attacks on commercial shipping in the "
            "Red Sea corridor, with drone and missile strikes averaging 3-4 per week. "
            "US and UK naval forces conducting interception operations. Major shipping "
            "lines have diverted via Cape of Good Hope, adding 10-14 days transit. "
            "Insurance premiums for Red Sea transit up 300% since October."
        ),
        "trajectory": (
            "Sustained high-level threat. Houthi operational capability has not been "
            "significantly degraded despite coalition airstrikes on launch sites. "
            "Iranian resupply enabling continued operations."
        ),
        "escalation_prob": 0.62,
        "prob_basis": "High probability of continued disruption. Houthi political objectives unchanged. Coalition strikes insufficient to degrade capability.",
        "scenarios": [
            {"scenario": "Continued interdiction campaign", "probability": 0.55,
             "description": "Houthi attacks continue at current pace, shipping diverted, insurance elevated.",
             "timeline": "months", "key_triggers": ["Gaza ceasefire failure", "Continued Iranian resupply"]},
            {"scenario": "Escalation to port attacks", "probability": 0.25,
             "description": "Houthis expand targeting to include Djibouti and Saudi ports.",
             "timeline": "weeks", "key_triggers": ["Coalition escalation against Houthi leadership"]},
        ],
        "patterns": [
            {"historical_analogue": "Somali piracy 2008-2012",
             "similarity_basis": "Systematic attacks on commercial shipping disrupting global trade routes.",
             "similarity_score": 0.52, "outcome_of_analogue": "International naval coalition reduced but did not eliminate threat. Required 4 years."},
        ],
        "indicators": [
            {"indicator": "Houthi drone launch site expansion northward", "domain": "SENTINEL",
             "significance": "Extended range would bring Mediterranean shipping into threat envelope", "current_status": "weak_signal"},
            {"indicator": "Iranian dhow activity near Yemeni coast", "domain": "AIS",
             "significance": "Arms resupply enabling continued operations", "current_status": "active"},
        ],
        "gaps": ["Houthi actual missile inventory", "Iranian direct command relationship"],
        "confidence": "high",
        "analyst_note": "Iranian dhow activity near the Yemeni coast is the critical logistical indicator — sustained Houthi operations depend on this resupply chain.",
    },
    {
        "zone_id": "Sahel", "zone_name": "Sahel Instability Belt",
        "score": 58, "model": "claude-sonnet-4-5-20251015",
        "situation": (
            "Military juntas in Mali, Burkina Faso, and Niger have consolidated power "
            "following French withdrawal. Wagner Group (rebranded Africa Corps) operating "
            "across the region. Jihadist insurgency activity increasing in areas previously "
            "covered by French Barkhane mission. Nigeria increasingly drawn into Sahel "
            "security dynamics."
        ),
        "trajectory": (
            "Deteriorating. Loss of French/Western counter-insurgency capability has "
            "created security vacuum. Russian presence increasing but focused on regime "
            "protection rather than population security."
        ),
        "escalation_prob": 0.55,
        "prob_basis": "Moderate-high. Security vacuum combined with jihadist operational expansion and humanitarian crisis creates conditions for regional spillover.",
        "scenarios": [
            {"scenario": "Jihadist territorial expansion", "probability": 0.45,
             "description": "JNIM or ISGS achieve significant territorial gains in southern Mali/Burkina Faso.",
             "timeline": "months", "key_triggers": ["Junta military failure", "Wagner redeployment"]},
            {"scenario": "Regional conflict", "probability": 0.20,
             "description": "Niger-Nigeria border tensions escalate to military confrontation.",
             "timeline": "months", "key_triggers": ["ECOWAS pressure", "Niger coup consolidation"]},
        ],
        "patterns": [
            {"historical_analogue": "Mali 2012", "similarity_basis": "Military coup followed by jihadist territorial expansion into security vacuum.",
             "similarity_score": 0.74, "outcome_of_analogue": "French Serval intervention stabilised situation. Barkhane maintained for decade."},
        ],
        "indicators": [
            {"indicator": "JNIM advance toward Bamako southern suburbs", "domain": "NEWS",
             "significance": "Capital threat would trigger emergency international response", "current_status": "not_observed"},
            {"indicator": "Wagner convoy movements from Libya toward Mali", "domain": "SENTINEL",
             "significance": "Reinforcement indicating planned offensive operation", "current_status": "weak_signal"},
        ],
        "gaps": ["Wagner actual force size in Sahel", "Junta command relationships with Russia"],
        "confidence": "medium",
        "analyst_note": "Wagner convoy movements from Libya are the key logistical indicator — reinforcement precedes both junta offensive operations and regime protection missions.",
    },
    {
        "zone_id": "South China Sea", "zone_name": "South China Sea — Contested Waters",
        "score": 65, "model": "claude-sonnet-4-5-20251015",
        "situation": (
            "PLA Navy and Coast Guard presence around the Second Thomas Shoal has intensified "
            "following Philippine resupply mission confrontations. China deployed water cannon "
            "and laser dazzling against Philippine vessels on four occasions this month. "
            "US-Philippines mutual defence treaty commitments are being tested."
        ),
        "trajectory": (
            "Gradually escalating with confrontations becoming more frequent and more "
            "aggressive. China is testing the threshold of US treaty commitments through "
            "incremental pressure."
        ),
        "escalation_prob": 0.44,
        "prob_basis": "Moderate probability. China unlikely to seek direct US confrontation but may miscalculate. Philippines domestic politics pushing toward firmer stance.",
        "scenarios": [
            {"scenario": "Accidental escalation", "probability": 0.22,
             "description": "Philippine or Chinese vessel sinks during confrontation, triggering treaty activation.",
             "timeline": "weeks", "key_triggers": ["Vessel collision or gunfire", "Philippine casualties"]},
            {"scenario": "Status quo confrontation", "probability": 0.55,
             "description": "Periodic confrontations continue without escalation.",
             "timeline": "months", "key_triggers": ["No US direct intervention"]},
        ],
        "patterns": [
            {"historical_analogue": "Scarborough Shoal 2012",
             "similarity_basis": "Identical pattern of Chinese Coast Guard escalation, US treaty ambiguity.",
             "similarity_score": 0.83, "outcome_of_analogue": "China established permanent control after US-brokered 'withdrawal' not honoured."},
        ],
        "indicators": [
            {"indicator": "PLA Navy Type 055 destroyer deployment to Spratlys", "domain": "AIS",
             "significance": "Combat-capable warship signals escalation beyond grey zone tactics", "current_status": "not_observed"},
            {"indicator": "Philippine Coast Guard reinforcement at BRP Sierra Madre", "domain": "NEWS",
             "significance": "Manila escalation decision", "current_status": "active"},
        ],
        "gaps": ["PLA actual operational orders vs exercise posture", "US carrier group tasking timeline"],
        "confidence": "medium",
        "analyst_note": "The Scarborough Shoal pattern match is the most concerning — China used the same playbook in 2012 and there is no evidence strategy has adapted to prevent a repeat.",
    },
]

try:
    from database import ForesightAssessment
    db.query(ForesightAssessment).delete()
    db.commit()
    for d in FORESIGHT_DATA:
        hours_ago = random.randint(1, 5)
        gen_time  = now - timedelta(hours=hours_ago)
        db.add(ForesightAssessment(
            zone_id=d["zone_id"], zone_name=d["zone_name"],
            score_at_generation=d["score"], model_used=d["model"],
            situation_summary=d["situation"], trajectory_assessment=d["trajectory"],
            escalation_probability_30d=d["escalation_prob"],
            probability_basis=d["prob_basis"],
            early_warning_indicators=json.dumps(d["indicators"]),
            likely_scenarios=json.dumps(d["scenarios"]),
            pattern_matches=json.dumps(d["patterns"]),
            intelligence_gaps=json.dumps(d["gaps"]),
            confidence=d["confidence"], analyst_note=d["analyst_note"],
            full_assessment=json.dumps(d),
            generated_at=gen_time,
            expires_at=gen_time + timedelta(hours=24),
        ))
    db.commit()
    print(f"Seeded {len(FORESIGHT_DATA)} foresight assessments")
except Exception as e:
    print(f"Foresight seed failed: {e}")
    import traceback; traceback.print_exc()


# ── THREAT SNAPSHOT HISTORY (30-day hourly trend data) ────────────────────────

try:
    from database import ThreatSnapshotHourly

    REGION_BASELINES = {
        "Baltic":                  (44, 4),
        "East Mediterranean":      (55, 5),
        "Black Sea / Ukraine":     (87, 5),
        "Persian Gulf":            (74, 7),
        "Red Sea / Bab el-Mandeb": (79, 6),
        "Sahel":                   (58, 4),
        "Horn of Africa":          (47, 3),
        "South China Sea":         (65, 5),
        "Taiwan Strait":           (61, 4),
        "Indian Ocean":            (38, 3),
    }

    # Clear old snapshots to avoid bloat
    cutoff_clear = now - timedelta(days=32)
    db.query(ThreatSnapshotHourly).filter(
        ThreatSnapshotHourly.snapshot_at < cutoff_clear
    ).delete(synchronize_session=False)
    db.commit()

    snapshots_added = 0
    for days_ago in range(30, 0, -1):
        for hour in [0, 6, 12, 18]:
            snap_time = now - timedelta(days=days_ago, hours=hour)
            for region, (base, variance) in REGION_BASELINES.items():
                trend = (30 - days_ago) / 30
                trending = base + (trend * 5) if base > 50 else base
                score = min(100, max(10, trending + random.uniform(-variance, variance)))
                level = "CRITICAL" if score >= 80 else "HIGH" if score >= 55 else "MEDIUM" if score >= 30 else "LOW"
                db.add(ThreatSnapshotHourly(
                    region_name=region, region_id=region,
                    score=round(score, 1), threat_level=level,
                    snapshot_at=snap_time,
                ))
                snapshots_added += 1

    db.commit()
    print(f"Seeded {snapshots_added} threat snapshots (30-day history)")
except Exception as e:
    print(f"Snapshot seed failed: {e}")
    import traceback; traceback.print_exc()


# ── THREAT TRAJECTORY ROWS ────────────────────────────────────────────────────

try:
    from database import ThreatTrajectory

    TRAJECTORIES = [
        ("Black Sea / Ukraine",     87, "rapid_escalation",  15.2, 4.8, 2.1,  1.8),
        ("Red Sea / Bab el-Mandeb", 79, "escalating",        8.4,  3.1, 1.2,  0.9),
        ("Persian Gulf",            74, "volatile",          6.1,  2.2, 0.8,  0.4),
        ("South China Sea",         65, "escalating",        7.3,  2.5, 0.9,  0.6),
        ("East Mediterranean",      55, "stable_high",       2.1,  0.8, 0.3,  0.1),
        ("Sahel",                   58, "escalating",        5.4,  1.8, 0.6,  0.3),
        ("Baltic",                  44, "stable",            1.2,  0.4, 0.1,  0.0),
        ("Taiwan Strait",           61, "escalating",        6.8,  2.3, 0.8,  0.5),
        ("Indian Ocean",            38, "stable_low",        0.5,  0.2, 0.1,  0.0),
        ("Horn of Africa",          47, "stable",            1.8,  0.6, 0.2,  0.1),
    ]

    db.query(ThreatTrajectory).delete(synchronize_session=False)
    db.commit()
    for (zname, score, traj, v1d, v3d, v7d, acc) in TRAJECTORIES:
        db.add(ThreatTrajectory(
            zone_id=zname, zone_name=zname,
            score_now=score, threat_level="CRITICAL" if score >= 80 else "HIGH" if score >= 55 else "MEDIUM",
            velocity_1d=v1d, velocity_3d=v3d, velocity_7d=v7d,
            acceleration=acc, trajectory=traj,
            computed_at=now - timedelta(minutes=random.randint(5, 30)),
        ))
    db.commit()
    print(f"Seeded {len(TRAJECTORIES)} trajectory rows")
except Exception as e:
    print(f"Trajectory seed failed: {e}")
    import traceback; traceback.print_exc()


# ── SURGE EVENTS ──────────────────────────────────────────────────────────────

SURGE_DATA = [
    {"headline": "Houthi drone attacks on Red Sea shipping intensify",
     "article_type": "maritime", "severity": "critical",
     "location_name": "Hodeidah", "location_country": "ye",
     "lat": 14.8, "lon": 42.9, "article_count": 14,
     "context_summary": "Multiple Houthi drone and missile attacks on commercial vessels in the Red Sea corridor over 24 hours. US Navy destroyer USS Gravely intercepted two ballistic missiles. Maersk and CMA CGM rerouting vessels around Cape of Good Hope."},
    {"headline": "Israeli strikes on Iranian proxy positions in Syria",
     "article_type": "conflict", "severity": "high",
     "location_name": "Damascus", "location_country": "sy",
     "lat": 33.5, "lon": 36.3, "article_count": 11,
     "context_summary": "Israeli Air Force conducted strikes on weapons storage facilities in the Damascus suburbs and Homs province. Hezbollah supply routes from Iran targeted. Syrian air defence activated but failed to intercept."},
    {"headline": "Sudan RSF advances threaten El Fasher aid corridors",
     "article_type": "conflict", "severity": "critical",
     "location_name": "El Fasher", "location_country": "sd",
     "lat": 13.6, "lon": 25.3, "article_count": 9,
     "context_summary": "Rapid Support Forces tightening siege of El Fasher, last major city in Darfur under SAF control. UN warns of imminent famine affecting 800,000 civilians. Aid convoys blocked for 12 days."},
    {"headline": "IRGC naval exercises near Strait of Hormuz",
     "article_type": "maritime", "severity": "high",
     "location_name": "Bandar Abbas", "location_country": "ir",
     "lat": 27.2, "lon": 56.3, "article_count": 8,
     "context_summary": "Islamic Revolutionary Guard Corps Navy conducting live-fire exercises in the eastern Strait of Hormuz. Exercise includes fast-boat swarm tactics and anti-ship missile drills. Two tankers reported GPS interference."},
    {"headline": "North Korea ballistic missile test over Japan Sea",
     "article_type": "military", "severity": "high",
     "location_name": "Pyongyang", "location_country": "kp",
     "lat": 39.0, "lon": 125.7, "article_count": 16,
     "context_summary": "DPRK launched intermediate-range ballistic missile that flew over the Sea of Japan, reaching maximum altitude of 1,200km. Japan and South Korea issued emergency alerts. US Indo-Pacific Command tracking."},
    {"headline": "Taiwan Strait PLA military exercises near median line",
     "article_type": "military", "severity": "high",
     "location_name": "Taiwan Strait", "location_country": "tw",
     "lat": 24.5, "lon": 121.0, "article_count": 12,
     "context_summary": "PLA Eastern Theatre Command conducting Joint Sword-series exercises around Taiwan, crossing the informal median line. Taiwanese F-16s scrambled 12 times in 24h. US carrier Ronald Reagan monitoring from Philippine Sea."},
]

try:
    from database import SurgeEvent
    db.query(SurgeEvent).filter(SurgeEvent.surge_id.like("SURGE-DEMO-%")).delete(synchronize_session=False)
    db.commit()
    for i, s in enumerate(SURGE_DATA):
        hours_ago = random.randint(1, 6)
        surge_time = now - timedelta(hours=hours_ago, minutes=random.randint(0, 59))
        db.add(SurgeEvent(
            surge_id=f"SURGE-DEMO-{i+1:03d}",
            headline=s["headline"], article_type=s["article_type"],
            surge_type="VOLUME_SURGE", status="active", severity=s["severity"],
            location_name=s["location_name"], location_country=s["location_country"],
            lat=s["lat"], lon=s["lon"], article_count=s["article_count"],
            context_summary=s["context_summary"], why_it_matters=s["context_summary"],
            created_at=surge_time, expires_at=surge_time + timedelta(hours=18),
        ))
    db.commit()
    print(f"Seeded {len(SURGE_DATA)} surge events")
except Exception as e:
    print(f"Surge seed failed: {e}")
    import traceback; traceback.print_exc()


# ── FORGE ALERTS ──────────────────────────────────────────────────────────────

ALERT_DATA = [
    {"domain": "AIS",  "alert_type": "Dark Ship",                "severity": "high",     "confidence": 0.87, "relevance_score": 78,  "lat": 26.3,  "lon": 57.1,  "country_code": "IR", "entity_id": "310567000", "title": "VLCC tanker dark 4h near Hormuz eastern approach"},
    {"domain": "AIS",  "alert_type": "Ship-to-Ship Transfer",    "severity": "high",     "confidence": 0.82, "relevance_score": 82,  "lat": 13.2,  "lon": 43.8,  "country_code": "YE", "entity_id": "477123456", "title": "STS detected: OCEAN PIONEER ↔ ATLAS FORTUNE 89min offshore"},
    {"domain": "AIS",  "alert_type": "Identity Change",          "severity": "high",     "confidence": 0.91, "relevance_score": 75,  "lat": 43.1,  "lon": 28.6,  "country_code": "RO", "entity_id": "636091827", "title": "Vessel renamed: POSEIDON STAR → GOLDEN WAVE (flag: RU→PA)"},
    {"domain": "AIS",  "alert_type": "Cable Loiterer",           "severity": "high",     "confidence": 0.85, "relevance_score": 80,  "lat": 57.8,  "lon": 21.3,  "country_code": "LT", "entity_id": "265678901", "title": "Vessel loitering 3h near NordBalt cable segment"},
    {"domain": "ADSB", "alert_type": "Military Squawk",          "severity": "high",     "confidence": 0.79, "relevance_score": 85,  "lat": 25.1,  "lon": 122.3, "country_code": "CN", "entity_id": "780A2B",    "title": "PLA J-11B crossing Taiwan Strait median line"},
    # CONSOLIDATED INTO MILITARY_AIRCRAFT — ISR Pattern is now part of the rich ADSB alert type
    # {"domain": "ADSB", "alert_type": "ISR Pattern Detected", "severity": "medium", "confidence": 0.88, "relevance_score": 72, "lat": 26.6, "lon": 56.5, "country_code": "AE", "entity_id": "AE1234", "title": "US P-8 Poseidon ISR orbit pattern over Strait of Hormuz"},
    {"domain": "AIS",  "alert_type": "Vessel Cluster",           "severity": "high",     "confidence": 0.76, "relevance_score": 77,  "lat": 9.8,   "lon": 114.2, "country_code": "CN", "entity_id": "477345678", "title": "6 vessels clustered near Spratly Islands — possible resupply"},
    {"domain": "NEWS", "alert_type": "Escalation Spike",         "severity": "critical", "confidence": 0.92, "relevance_score": 91,  "lat": 13.6,  "lon": 25.3,  "country_code": "SD", "entity_id": "SURGE-DEMO-003", "title": "14 sources: RSF assault on El Fasher intensifying"},
    {"domain": "AIS",  "alert_type": "Sanctioned Vessel",        "severity": "critical", "confidence": 0.97, "relevance_score": 100, "lat": 27.1,  "lon": 56.1,  "country_code": "IR", "entity_id": "422345678", "title": "OFAC SDN vessel IRAN PIONEER detected off Bandar Abbas"},
    {"domain": "NEWS", "alert_type": "Infrastructure Threat Signal","severity": "high",  "confidence": 0.84, "relevance_score": 79,  "lat": 31.5,  "lon": 34.5,  "country_code": "PS", "entity_id": "SURGE-INF-001", "title": "Power infrastructure targeting in northern Gaza surge"},
    {"domain": "AIS",  "alert_type": "Dark Ship",                "severity": "high",     "confidence": 0.83, "relevance_score": 74,  "lat": 12.8,  "lon": 43.5,  "country_code": "YE", "entity_id": "510887123", "title": "Supertanker FORTUNE dark 6h near Bab el-Mandeb"},
    {"domain": "ADSB", "alert_type": "Military Squawk",          "severity": "medium",   "confidence": 0.81, "relevance_score": 68,  "lat": 37.9,  "lon": 127.1, "country_code": "KR", "entity_id": "AE789F",    "title": "USAF B-52 + F-15 formation exercise near Korean DMZ"},
    {"domain": "AIS",  "alert_type": "Chokepoint Loitering",     "severity": "medium",   "confidence": 0.78, "relevance_score": 65,  "lat": 27.4,  "lon": 56.2,  "country_code": "OM", "entity_id": "352456789", "title": "Unidentified vessel loitering in Hormuz traffic separation zone"},
    {"domain": "NEWS", "alert_type": "Diplomatic Incident",      "severity": "medium",   "confidence": 0.82, "relevance_score": 67,  "lat": 55.7,  "lon": 37.6,  "country_code": "RU", "entity_id": "DIPLO-001", "title": "Three NATO ambassadors expelled from Moscow following espionage allegations"},
]

try:
    import uuid
    from database import Alert

    # Remove previous demo alerts
    db.query(Alert).filter(Alert.alert_id.like("ALT-DEMO-%")).delete(synchronize_session=False)
    db.commit()

    for i, a in enumerate(ALERT_DATA):
        mins_ago = random.randint(5, 480)
        created  = now - timedelta(minutes=mins_ago)
        db.add(Alert(
            alert_id=f"ALT-DEMO-{i+1:03d}",
            source=a["domain"].lower(),
            alert_type=a["alert_type"],
            title=a["title"],
            severity=a["severity"],
            lat=a["lat"], lon=a["lon"],
            country_code=a["country_code"],
            entity_id=a["entity_id"],
            raw_json=json.dumps(a),
            zone_ids="[]", tags="[]",
            status="active",
            created_at=created,
        ))

    db.commit()
    print(f"Seeded {len(ALERT_DATA)} forge alerts")
except Exception as e:
    print(f"Alert seed failed: {e}")
    import traceback; traceback.print_exc()


db.close()
print("\nDemo data seeding complete.")
print("Run: curl -X POST https://horizon-watch-production.up.railway.app/api/admin/trigger-threat-snapshot")
print("     curl -X POST https://horizon-watch-production.up.railway.app/api/admin/trigger-foresight-all")
