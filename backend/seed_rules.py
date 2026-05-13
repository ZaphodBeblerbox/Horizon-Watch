"""
Seed the 8 canonical surveillance rules + 4 escalation chains.
Run once after wiping the DB:
    python3 seed_rules.py
"""
import json, sys, os
sys.path.insert(0, os.path.dirname(__file__))

from database import SessionLocal, RuleConfig, OntologyEntity, EscalationChain, Base, engine

Base.metadata.create_all(bind=engine)

RULES = [
    # ── Cable Loitering ──────────────────────────────────────────────────────
    {
        "rule_name": "AIS_LOITERING_NEAR_INFRA",
        "severity":  "high",
        "params": {
            "infra_type":        "Submarine Cable",
            "target":            "ALL",
            "distance_metres":   500,
            "max_speed_knots":   0.5,
            "duration_minutes":  120,
            "icon_type":         "LOITERING_CABLE",
        },
        "label": "Cable Loitering — Global",
    },
    {
        "rule_name": "AIS_LOITERING_NEAR_INFRA",
        "severity":  "critical",
        "params": {
            "infra_type":        "Submarine Cable",
            "target":            "REG-NORSEA",
            "distance_metres":   500,
            "max_speed_knots":   0.5,
            "duration_minutes":  60,
            "icon_type":         "LOITERING_CABLE",
        },
        "label": "Cable Loitering — Baltic / North Sea",
    },
    {
        "rule_name": "AIS_LOITERING_NEAR_INFRA",
        "severity":  "critical",
        "params": {
            "infra_type":        "Submarine Cable",
            "target":            "REG-REDSEA",
            "distance_metres":   500,
            "max_speed_knots":   0.5,
            "duration_minutes":  60,
            "icon_type":         "LOITERING_CABLE",
        },
        "label": "Cable Loitering — Red Sea / Hormuz",
    },
    # ── STS Transfer ─────────────────────────────────────────────────────────
    {
        "rule_name": "AIS_STS_PROXIMITY",
        "severity":  "high",
        "params": {
            "target":                  "ALL",
            "proximity_metres":        500,
            "min_duration_minutes":    20,
            "max_speed_knots":         1.5,
            "icon_type":               "STS_TRANSFER",
        },
        "label": "Ship-to-Ship Proximity — Global",
    },
    # ── Strategic Port Loitering ──────────────────────────────────────────────
    {
        "rule_name": "AIS_LOITERING_NEAR_INFRA",
        "severity":  "high",
        "params": {
            "infra_type":        "Port",
            "target":            "PORTS:STRATEGIC",
            "proximity_metres":  2000,
            "max_speed_knots":   1.0,
            "duration_minutes":  90,
            "icon_type":         "LOITERING_PORT",
        },
        "label": "Loitering — Strategic Ports",
    },
    # ── Dark Ship ────────────────────────────────────────────────────────────
    {
        "rule_name": "AIS_DARK_SHIP",
        "severity":  "medium",
        "params": {
            "target":                "ALL",
            "min_gap_minutes":       60,
            "last_known_region":     "ALL",
            "min_speed_before_gap":  3.0,
            "icon_type":             "DARK_SHIP",
        },
        "label": "Dark Ship — Global",
    },
    # ── ADS-B ────────────────────────────────────────────────────────────────
    {
        "rule_name": "ADSB_SQUAWK_MILITARY",
        "severity":  "medium",
        "params": {
            "squawk_codes":  ["7700", "7600", "7500", "7777", "6100", "6400"],
            "icon_type":     "UNKNOWN_CONTACT",
        },
        "label": "Military / Emergency Squawk Code",
    },
    {
        "rule_name": "ADSB_TRANSPONDER_ANOMALY",
        "severity":  "medium",
        "params": {
            "no_callsign":      True,
            "no_squawk":        True,
            "min_altitude_ft":  1000,
            "icon_type":        "DARK_SHIP",
        },
        "label": "Transponder Anomaly",
    },
]

CHAINS = [
    {
        "chain_name":          "Cable Loiter + Dark Ship",
        "rule_name_triggers":  ["AIS_LOITERING_NEAR_INFRA", "AIS_DARK_SHIP"],
        "escalated_severity":  "critical",
        "escalated_icon_type": "DARK_SHIP_CABLE",
        "time_window_minutes": 30,
    },
    {
        "chain_name":          "Cable Loiter + STS Transfer",
        "rule_name_triggers":  ["AIS_LOITERING_NEAR_INFRA", "AIS_STS_PROXIMITY"],
        "escalated_severity":  "critical",
        "escalated_icon_type": "STS_TRANSFER_DARK",
        "time_window_minutes": 30,
    },
    {
        "chain_name":          "Port Loiter + STS Transfer",
        "rule_name_triggers":  ["AIS_LOITERING_NEAR_INFRA", "AIS_STS_PROXIMITY"],
        "escalated_severity":  "critical",
        "escalated_icon_type": "STS_TRANSFER",
        "time_window_minutes": 45,
    },
    {
        "chain_name":          "Dark Ship + STS Transfer",
        "rule_name_triggers":  ["AIS_DARK_SHIP", "AIS_STS_PROXIMITY"],
        "escalated_severity":  "critical",
        "escalated_icon_type": "ESCALATED_DUAL",
        "time_window_minutes": 60,
    },
]


def seed():
    db = SessionLocal()
    try:
        inserted_rules = []
        for spec in RULES:
            row = RuleConfig(
                rule_name=spec["rule_name"],
                enabled=True,
                params=json.dumps(spec["params"]),
            )
            db.add(row)
            db.flush()  # get row.id

            # Ontology entry
            db.add(OntologyEntity(
                system_id=f"RULE-{row.id}",
                entity_type="Rule",
                name=spec["label"],
                infra_type=spec["params"].get("infra_type"),
                region_id=None,
                entity_metadata=json.dumps({
                    "rule_name": spec["rule_name"],
                    "severity":  spec["severity"],
                    "params":    spec["params"],
                }),
            ))
            inserted_rules.append((row.id, spec))
            print(f"  RULE-{row.id}: {spec['label']} [{spec['rule_name']}]")

        db.commit()

        # Build chain rule_ids by matching rule_name_triggers to inserted rule ids
        print("\nSeeding escalation chains:")
        for chain_spec in CHAINS:
            triggers = chain_spec["rule_name_triggers"]
            # Match inserted rules whose rule_name is in the trigger list
            matched_ids = [
                str(rid)
                for rid, spec in inserted_rules
                if spec["rule_name"] in triggers
            ]
            row = EscalationChain(
                chain_name=chain_spec["chain_name"],
                rule_ids=",".join(matched_ids),
                escalated_severity=chain_spec["escalated_severity"],
                escalated_icon_type=chain_spec["escalated_icon_type"],
                time_window_minutes=chain_spec["time_window_minutes"],
            )
            db.add(row)
            db.flush()

            db.add(OntologyEntity(
                system_id=f"CHAIN-{row.id}",
                entity_type="Escalation Chain",
                name=chain_spec["chain_name"],
                infra_type=None,
                region_id=None,
                entity_metadata=json.dumps({
                    "escalated_severity":  chain_spec["escalated_severity"],
                    "escalated_icon_type": chain_spec["escalated_icon_type"],
                    "time_window_minutes": chain_spec["time_window_minutes"],
                    "rule_ids":            matched_ids,
                }),
            ))
            db.commit()
            print(f"  CHAIN-{row.id}: {chain_spec['chain_name']} → rules [{','.join(matched_ids)}]")

    finally:
        db.close()


if __name__ == "__main__":
    print("Seeding rules...")
    seed()
    print("\nDone.")
