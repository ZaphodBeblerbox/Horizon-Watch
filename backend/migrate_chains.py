"""
Migrate existing EscalationChain rows to RuleConnection rows, then remove them.

Mapping:
  CHAIN-1  Cable Loitering + Dark Ship   → ESCALATION  rule 1 + 6  DARK_SHIP_CABLE
  CHAIN-4  Strategic Port + Dark Ship    → ESCALATION  rule 5 + 6  ESCALATED_DUAL

Usage:
    python3 migrate_chains.py [--db ./data/akili.db]
"""
import sys, os, argparse, json

parser = argparse.ArgumentParser()
parser.add_argument("--db", default=os.path.join(os.getenv("DATA_DIR", "./data"), "akili.db"))
args = parser.parse_args()

if not os.path.exists(args.db):
    print(f"Database not found: {args.db}")
    sys.exit(1)

# Add backend dir to path so database.py is importable
sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from database import Base, EscalationChain, RuleConnection, RuleConfig, OntologyEntity
import datetime

engine = create_engine(f"sqlite:///{args.db}", connect_args={"check_same_thread": False})
Base.metadata.create_all(bind=engine)
Session = sessionmaker(bind=engine)
db = Session()

try:
    chains = db.query(EscalationChain).order_by(EscalationChain.id).all()
    if not chains:
        print("No EscalationChain rows found — nothing to migrate.")
        db.close()
        sys.exit(0)

    print(f"Found {len(chains)} EscalationChain row(s):")
    for c in chains:
        print(f"  CHAIN-{c.id}: {c.chain_name} | rules={c.rule_ids} | {c.escalated_severity}/{c.escalated_icon_type}")

    MAPPING = [
        # (chain_id, conn_name, rule_id_a, rule_id_b, rel_type, esc_sev, esc_icon, window_min)
        (1, "Cable Loitering + Dark Ship",   1, 6, "ESCALATION",  "critical", "DARK_SHIP_CABLE",   30),
        (4, "Strategic Port + Dark Ship",    5, 6, "ESCALATION",  "critical", "ESCALATED_DUAL",    30),
    ]

    existing_chain_ids = {c.id for c in chains}
    now = datetime.datetime.utcnow()

    for chain_id, conn_name, rid_a, rid_b, rel, esc_sev, esc_icon, window in MAPPING:
        if chain_id not in existing_chain_ids:
            print(f"  CHAIN-{chain_id} not found in DB, skipping")
            continue

        # Check if a matching RuleConnection already exists to avoid duplicates
        existing_conn = db.query(RuleConnection).filter(
            RuleConnection.rule_id_a == rid_a,
            RuleConnection.rule_id_b == rid_b,
            RuleConnection.relationship_type == rel,
        ).first()
        if existing_conn:
            print(f"  CONN already exists for {conn_name} (id={existing_conn.id}), skipping")
        else:
            row = RuleConnection(
                connection_name=conn_name,
                rule_id_a=rid_a,
                rule_id_b=rid_b,
                relationship_type=rel,
                escalated_severity=esc_sev,
                escalated_icon_type=esc_icon,
                sequence_window_minutes=window if rel == "SEQUENCE" else None,
                suppression_window_minutes=None,
                time_window_minutes=window,
                created_at=now,
            )
            db.add(row)
            db.flush()

            rule_map = {r.id: (r.name or r.rule_name) for r in db.query(RuleConfig).filter(
                RuleConfig.id.in_([rid_a, rid_b])
            ).all()}
            onto_id  = f"CONN-{row.id}"
            onto_meta = json.dumps({
                "relationship_type": rel,
                "rule_id_a": rid_a,
                "rule_id_b": rid_b,
                "rule_name_a": rule_map.get(rid_a, ""),
                "rule_name_b": rule_map.get(rid_b, ""),
            }, ensure_ascii=False)
            existing_onto = db.query(OntologyEntity).filter(OntologyEntity.system_id == onto_id).first()
            if not existing_onto:
                db.add(OntologyEntity(
                    system_id=onto_id, entity_type="Rule Connection",
                    name=conn_name, entity_metadata=onto_meta,
                ))
            print(f"  Created CONN-{row.id}: {conn_name} ({rel}, rules {rid_a}+{rid_b})")

    # Delete old EscalationChain rows and their ontology entries
    for c in chains:
        onto = db.query(OntologyEntity).filter(OntologyEntity.system_id == f"CHAIN-{c.id}").first()
        if onto:
            db.delete(onto)
            print(f"  Removed OntologyEntity CHAIN-{c.id}")
        db.delete(c)
        print(f"  Deleted EscalationChain CHAIN-{c.id}")

    db.commit()
    print("\nMigration complete.")

finally:
    db.close()
