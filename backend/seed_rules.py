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
        "name":         "Ship-to-Ship Proximity",
        "trigger_type": "AIS_STS_PROXIMITY",
        "severity":     "high",
        "icon_type":    "STS_TRANSFER",
        "params": {
            "target":                  "ALL",
            "proximity_metres":        500,
            "min_duration_minutes":    20,
            "max_speed_knots":         1.5,
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
            "chain_name":          "STS Transfer + Dark Ship",
            "rule_ids":            [rule_ids["Ship-to-Ship Proximity"],
                                    rule_ids["Dark Ship — Global"]],
            "escalated_severity":  "critical",
            "escalated_icon_type": "STS_TRANSFER_DARK",
            "time_window_minutes": 30,
        },
        {
            "chain_name":          "Cable Loitering + STS + Dark Ship",
            "rule_ids":            [rule_ids["Cable Loitering — Global"],
                                    rule_ids["Ship-to-Ship Proximity"],
                                    rule_ids["Dark Ship — Global"]],
            "escalated_severity":  "critical",
            "escalated_icon_type": "ESCALATED_TRIPLE",
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


if __name__ == "__main__":
    seed()
