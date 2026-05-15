"""
Seed the 8 canonical surveillance rules + 4 escalation chains via the live API.
The backend must be running before executing this script.

Usage:
    python3 seed_rules.py [--base http://localhost:8000]
"""
import sys, json, argparse

try:
    import httpx
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "httpx", "-q"])
    import httpx

parser = argparse.ArgumentParser()
parser.add_argument("--base", default="http://localhost:8000")
args = parser.parse_args()
BASE = args.base.rstrip("/")

RULES = [
    {
        "name":         "Cable Loitering — Global",
        "trigger_type": "AIS_LOITERING_NEAR_INFRA",
        "severity":     "high",
        "icon_type":    "LOITERING_CABLE",
        "params": {
            "infra_type":          "Submarine Cable",
            "target":              "ALL",
            "proximity_km":        0.5,
            "distance_metres":     500,
            "max_speed_knots":     0.5,
            "min_duration_minutes": 120,
        },
    },
    {
        "name":         "Cable Loitering — Baltic",
        "trigger_type": "AIS_LOITERING_NEAR_INFRA",
        "severity":     "critical",
        "icon_type":    "LOITERING_CABLE",
        "params": {
            "infra_type":          "Submarine Cable",
            "target":              "REG-NORSEA",
            "proximity_km":        0.5,
            "distance_metres":     500,
            "max_speed_knots":     0.5,
            "min_duration_minutes": 60,
        },
    },
    {
        "name":         "Cable Loitering — Hormuz",
        "trigger_type": "AIS_LOITERING_NEAR_INFRA",
        "severity":     "critical",
        "icon_type":    "LOITERING_CABLE",
        "params": {
            "infra_type":          "Submarine Cable",
            "target":              "REG-REDSEA",
            "proximity_km":        0.5,
            "distance_metres":     500,
            "max_speed_knots":     0.5,
            "min_duration_minutes": 60,
        },
    },
    {
        "name":         "Loitering — Strategic Ports",
        "trigger_type": "AIS_LOITERING_NEAR_INFRA",
        "severity":     "high",
        "icon_type":    "LOITERING_PORT",
        "params": {
            "infra_type":          "Port",
            "target":              "PORTS:STRATEGIC",
            "proximity_km":        2.0,
            "proximity_metres":    2000,
            "max_speed_knots":     1.0,
            "min_duration_minutes": 90,
        },
    },
    {
        "name":         "Dark Ship — Global",
        "trigger_type": "AIS_DARK_SHIP",
        "severity":     "medium",
        "icon_type":    "DARK_SHIP",
        "params": {
            "target":               "ALL",
            "min_gap_minutes":      60,
            "last_known_region":    "ALL",
            "min_speed_before_gap": 3.0,
        },
    },
    {
        "name":         "Military Squawk Code",
        "trigger_type": "ADSB_SQUAWK_MILITARY",
        "severity":     "medium",
        "icon_type":    "UNKNOWN_CONTACT",
        "params": {
            "target":       "ALL",
            "squawk_codes": ["7700", "7600", "7500", "7777", "6100", "6400"],
        },
    },
    {
        "name":         "Transponder Anomaly",
        "trigger_type": "ADSB_TRANSPONDER_ANOMALY",
        "severity":     "medium",
        "icon_type":    "DARK_SHIP",
        "params": {
            "target":          "ALL",
            "no_callsign":     True,
            "no_squawk":       True,
            "min_altitude_ft": 1000,
        },
    },
]


def seed():
    print(f"Connecting to {BASE} …\n")

    # ── Rules ────────────────────────────────────────────────────────────────
    rule_ids = {}   # name → id
    print("Creating rules:")
    for spec in RULES:
        r = httpx.post(f"{BASE}/api/rules", json=spec, timeout=10)
        if r.status_code not in (200, 201):
            print(f"  ERROR {r.status_code}: {r.text[:200]}")
            sys.exit(1)
        d = r.json()
        rule_ids[spec["name"]] = d["id"]
        print(f"  {d['system_id']} | {d['trigger_type']} | {d['name']}")

    # ── Escalation Chains ────────────────────────────────────────────────────
    chains = [
        {
            "chain_name":          "Cable Loitering + Dark Ship",
            "rule_ids":            [rule_ids["Cable Loitering — Global"],
                                    rule_ids["Dark Ship — Global"]],
            "escalated_severity":  "critical",
            "escalated_icon_type": "DARK_SHIP_CABLE",
            "time_window_minutes": 30,
        },
        {
            "chain_name":          "Strategic Port Loitering + Dark Ship",
            "rule_ids":            [rule_ids["Loitering — Strategic Ports"],
                                    rule_ids["Dark Ship — Global"]],
            "escalated_severity":  "critical",
            "escalated_icon_type": "ESCALATED_DUAL",
            "time_window_minutes": 30,
        },
    ]

    print("\nCreating escalation chains:")
    for spec in chains:
        r = httpx.post(f"{BASE}/api/escalation-chains", json=spec, timeout=10)
        if r.status_code not in (200, 201):
            print(f"  ERROR {r.status_code}: {r.text[:200]}")
            sys.exit(1)
        d = r.json()
        print(f"  {d['system_id']} | {d['chain_name']} | rules={d['rule_ids']} → {d['escalated_severity']}/{d['escalated_icon_type']}")

    print("\nDone.")


CHOKEPOINT_RULES = [
    {
        "name":         "Chokepoint Loitering — Global",
        "trigger_type": "AIS_CHOKEPOINT_ACTIVITY",
        "severity":     "high",
        "icon_type":    "CHOKEPOINT_LOITER",
        "params": {
            "target":                        "ALL",
            "monitor_transit":               False,
            "monitor_loitering":             True,
            "min_loiter_duration_minutes":   45,
            "max_loiter_speed_knots":        1.0,
        },
    },
    {
        "name":         "Chokepoint Transit — Hormuz",
        "trigger_type": "AIS_CHOKEPOINT_ACTIVITY",
        "severity":     "medium",
        "icon_type":    "CHOKEPOINT_TRANSIT",
        "params": {
            "target":            "ID:CHOKE-001",
            "monitor_transit":   True,
            "monitor_loitering": False,
            "vessel_types":      ["Tanker", "Unknown", "Military"],
        },
    },
]


def seed_chokepoint_rules():
    print(f"\nConnecting to {BASE} for chokepoint rules…\n")
    ids = {}
    for spec in CHOKEPOINT_RULES:
        r = httpx.post(f"{BASE}/api/rules", json=spec, timeout=10)
        if r.status_code not in (200, 201):
            print(f"  ERROR {r.status_code}: {r.text[:200]}")
            return
        d = r.json()
        ids[spec["name"]] = d["id"]
        print(f"  {d['system_id']} | {d['trigger_type']} | {d['name']}")

    # Connect RULE-9 (Chokepoint Loitering Global) + RULE-6 (Dark Ship) → ESCALATION
    # First look up the Dark Ship rule id
    rules_resp = httpx.get(f"{BASE}/api/rules", timeout=10)
    all_rules = rules_resp.json().get("rules", []) if rules_resp.is_success else []
    dark_ship_id = next((r["id"] for r in all_rules if r.get("trigger_type") == "AIS_DARK_SHIP"), None)
    choke_loiter_id = ids.get("Chokepoint Loitering — Global")
    if dark_ship_id and choke_loiter_id:
        conn_body = {
            "connection_name":   "Chokepoint Loitering + Dark Ship",
            "rule_id_a":         choke_loiter_id,
            "rule_id_b":         dark_ship_id,
            "relationship_type": "ESCALATION",
            "escalated_severity":  "critical",
            "escalated_icon_type": "DARK_SHIP_CABLE",
            "time_window_minutes": 30,
        }
        rc = httpx.post(f"{BASE}/api/rule-connections", json=conn_body, timeout=10)
        if rc.status_code in (200, 201):
            print(f"  Created rule connection: {rc.json().get('system_id')} Chokepoint Loitering + Dark Ship → ESCALATION")
        else:
            print(f"  Rule connection ERROR {rc.status_code}: {rc.text[:200]}")
    print("\nChokepoint seed done.")


def seed_db(db=None) -> dict:
    """
    Seed rules and escalation chains directly into the database.
    Does NOT require the backend to be running.
    Returns stats dict.
    """
    import json as _json
    from database import (
        RuleConfig, EscalationChain, RuleConnection, OntologyEntity, SessionLocal as _SL
    )

    _own = db is None
    if _own:
        db = _SL()
    try:
        # ── Rules ────────────────────────────────────────────────────────────────
        all_rules_to_seed = RULES + CHOKEPOINT_RULES
        rule_ids: dict = {}  # name → RuleConfig.id

        for spec in all_rules_to_seed:
            existing = db.query(RuleConfig).filter(
                RuleConfig.rule_name == spec.get("trigger_type", spec.get("name"))
            ).first()
            # Deduplicate by name
            existing_by_name = db.query(RuleConfig).filter(RuleConfig.name == spec["name"]).first()
            if existing_by_name:
                rule_ids[spec["name"]] = existing_by_name.id
                continue

            row = RuleConfig(
                name         = spec["name"],
                rule_name    = spec.get("trigger_type", spec["name"]),
                trigger_type = spec.get("trigger_type"),
                severity     = spec.get("severity", "medium"),
                icon_type    = spec.get("icon_type"),
                params       = _json.dumps(spec.get("params", {})),
            )
            db.add(row)
            db.flush()  # assign id

            # Upsert OntologyEntity
            onto_id = f"RULE-{row.id}"
            existing_onto = db.query(OntologyEntity).filter(OntologyEntity.system_id == onto_id).first()
            if not existing_onto:
                db.add(OntologyEntity(
                    system_id    = onto_id,
                    entity_type  = "Rule",
                    name         = spec["name"],
                    infra_type   = spec.get("trigger_type"),
                    entity_metadata = _json.dumps({"trigger_type": spec.get("trigger_type"), "severity": spec.get("severity")}),
                ))
            rule_ids[spec["name"]] = row.id

        db.commit()

        # ── Escalation Chains ────────────────────────────────────────────────────
        chains_to_seed = [
            {
                "chain_name":          "Cable Loitering + Dark Ship",
                "rule_names":          ["Cable Loitering — Global", "Dark Ship — Global"],
                "escalated_severity":  "critical",
                "escalated_icon_type": "DARK_SHIP_CABLE",
                "time_window_minutes": 30,
            },
            {
                "chain_name":          "Strategic Port Loitering + Dark Ship",
                "rule_names":          ["Loitering — Strategic Ports", "Dark Ship — Global"],
                "escalated_severity":  "critical",
                "escalated_icon_type": "ESCALATED_DUAL",
                "time_window_minutes": 30,
            },
        ]

        chains_inserted = 0
        for spec in chains_to_seed:
            existing = db.query(EscalationChain).filter(
                EscalationChain.chain_name == spec["chain_name"]
            ).first()
            if existing:
                continue
            ids = [rule_ids[n] for n in spec["rule_names"] if n in rule_ids]
            if len(ids) < 2:
                continue
            db.add(EscalationChain(
                chain_name          = spec["chain_name"],
                rule_ids            = ",".join(str(i) for i in ids),
                escalated_severity  = spec["escalated_severity"],
                escalated_icon_type = spec["escalated_icon_type"],
                time_window_minutes = spec["time_window_minutes"],
            ))
            chains_inserted += 1

        db.commit()
        return {
            "rules_seeded": len(rule_ids),
            "chains_inserted": chains_inserted,
        }
    finally:
        if _own:
            db.close()


NEWS_RULES = [
    {
        "name":         "Rising Tensions — Global",
        "trigger_type": "NEWS_PATTERN",
        "severity":     "high",
        "icon_type":    "RISING_TENSIONS",
        "params": {
            "pattern_type":             "RISING_TENSIONS",
            "location_scope":           "ALL",
            "article_count_threshold":  5,
            "timeframe_hours":          6,
            "min_relevance_score":      6.0,
            "article_types":            ["conflict", "aviation"],
            "cooldown_hours":           2,
        },
    },
    {
        "name":         "Port Disruption — Global",
        "trigger_type": "NEWS_PATTERN",
        "severity":     "high",
        "icon_type":    "PORT_DISRUPTION",
        "params": {
            "pattern_type":             "PORT_DISRUPTION",
            "location_scope":           "ALL",
            "article_count_threshold":  3,
            "timeframe_hours":          12,
            "min_relevance_score":      5.0,
            "article_types":            ["maritime", "infrastructure"],
            "keywords_required":        ["port", "terminal", "shipping", "vessel", "cargo", "blockade", "closure", "attack"],
            "cooldown_hours":           4,
        },
    },
    {
        "name":         "Infrastructure Threat — Global",
        "trigger_type": "NEWS_PATTERN",
        "severity":     "high",
        "icon_type":    "INFRASTRUCTURE_THREAT",
        "params": {
            "pattern_type":             "INFRASTRUCTURE_THREAT",
            "location_scope":           "ALL",
            "article_count_threshold":  2,
            "timeframe_hours":          6,
            "min_relevance_score":      7.0,
            "article_types":            ["infrastructure", "energy", "cyber"],
            "keywords_required":        ["attack", "damage", "destroyed", "sabotage", "explosion", "fire", "outage", "pipeline", "cable", "power"],
            "cooldown_hours":           3,
        },
    },
    {
        "name":         "Escalation Spike — Global",
        "trigger_type": "NEWS_PATTERN",
        "severity":     "critical",
        "icon_type":    "ESCALATION_SPIKE",
        "params": {
            "pattern_type":             "ESCALATION_SPIKE",
            "location_scope":           "ALL",
            "article_count_threshold":  10,
            "timeframe_hours":          3,
            "min_relevance_score":      5.0,
            "article_types":            ["conflict", "political", "maritime"],
            "cooldown_hours":           1,
        },
    },
    {
        "name":         "Sanctions Pressure — Global",
        "trigger_type": "NEWS_PATTERN",
        "severity":     "medium",
        "icon_type":    "SANCTIONS_PRESSURE",
        "params": {
            "pattern_type":             "SANCTIONS_PRESSURE",
            "location_scope":           "ALL",
            "article_count_threshold":  4,
            "timeframe_hours":          24,
            "min_relevance_score":      5.0,
            "article_types":            ["political", "economic"],
            "keywords_required":        ["sanction", "embargo", "restriction", "ban", "freeze", "penalty", "tariff"],
            "cooldown_hours":           6,
        },
    },
    {
        "name":         "Military Mobilisation — Global",
        "trigger_type": "NEWS_PATTERN",
        "severity":     "high",
        "icon_type":    "MILITARY_MOBILISATION",
        "params": {
            "pattern_type":             "MILITARY_MOBILISATION",
            "location_scope":           "ALL",
            "article_count_threshold":  3,
            "timeframe_hours":          12,
            "min_relevance_score":      7.0,
            "article_types":            ["conflict", "political"],
            "keywords_required":        ["troops", "military", "forces", "deploy", "mobilise", "mobilize", "exercise", "drill", "warship", "aircraft carrier", "buildup", "reinforcement"],
            "cooldown_hours":           4,
        },
    },
    {
        "name":         "Humanitarian Crisis — Global",
        "trigger_type": "NEWS_PATTERN",
        "severity":     "high",
        "icon_type":    "HUMANITARIAN_CRISIS",
        "params": {
            "pattern_type":             "HUMANITARIAN_CRISIS",
            "location_scope":           "ALL",
            "article_count_threshold":  4,
            "timeframe_hours":          24,
            "min_relevance_score":      6.0,
            "article_types":            ["conflict", "disaster"],
            "keywords_required":        ["civilian", "casualties", "displaced", "refugees", "famine", "humanitarian", "aid", "evacuation", "massacre"],
            "cooldown_hours":           6,
        },
    },
    {
        "name":         "Ceasefire Breakdown — Global",
        "trigger_type": "NEWS_PATTERN",
        "severity":     "critical",
        "icon_type":    "CEASEFIRE_BREAKDOWN",
        "params": {
            "pattern_type":             "CEASEFIRE_BREAKDOWN",
            "location_scope":           "ALL",
            "article_count_threshold":  3,
            "timeframe_hours":          6,
            "min_relevance_score":      7.0,
            "article_types":            ["conflict", "political"],
            "keywords_required":        ["ceasefire", "peace talks", "violation", "collapsed", "breakdown", "resumed fighting", "offensive"],
            "cooldown_hours":           3,
        },
    },
    {
        "name":         "Energy Supply Risk — Global",
        "trigger_type": "NEWS_PATTERN",
        "severity":     "medium",
        "icon_type":    "ENERGY_SUPPLY_RISK",
        "params": {
            "pattern_type":             "ENERGY_SUPPLY_RISK",
            "location_scope":           "ALL",
            "article_count_threshold":  3,
            "timeframe_hours":          12,
            "min_relevance_score":      6.0,
            "article_types":            ["energy", "maritime", "infrastructure"],
            "keywords_required":        ["oil", "gas", "LNG", "pipeline", "refinery", "tanker", "supply", "shortage", "disruption", "export", "OPEC"],
            "cooldown_hours":           4,
        },
    },
]


def seed_news_rules(db=None) -> dict:
    """Seed 9 default NEWS_PATTERN rules. Idempotent — skips existing by name."""
    import json as _json
    from database import RuleConfig, OntologyEntity, SessionLocal as _SL

    _own = db is None
    if _own:
        db = _SL()
    created = 0
    try:
        for spec in NEWS_RULES:
            existing = db.query(RuleConfig).filter(RuleConfig.name == spec["name"]).first()
            if existing:
                continue
            row = RuleConfig(
                name         = spec["name"],
                rule_name    = spec["trigger_type"],
                trigger_type = spec["trigger_type"],
                severity     = spec["severity"],
                icon_type    = spec["icon_type"],
                params       = _json.dumps(spec["params"]),
            )
            db.add(row)
            db.flush()
            onto_id = f"RULE-{row.id}"
            if not db.query(OntologyEntity).filter(OntologyEntity.system_id == onto_id).first():
                db.add(OntologyEntity(
                    system_id   = onto_id,
                    entity_type = "Rule",
                    name        = spec["name"],
                    infra_type  = spec["trigger_type"],
                    entity_metadata = _json.dumps({"trigger_type": spec["trigger_type"], "severity": spec["severity"]}),
                ))
            created += 1
        db.commit()
        print(f"[seed-news-rules] {created} news pattern rules seeded")
        return {"created": created}
    finally:
        if _own:
            db.close()


if __name__ == "__main__":
    seed()
    seed_chokepoint_rules()
    seed_news_rules()
