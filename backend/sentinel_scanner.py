"""
Stub SentinelScanner — satellite-imagery scan engine.
Full implementation requires Planet/Sentinel API credentials and ONNX inference.
Without credentials the scan is logged as skipped rather than crashing the cycle.
"""
import datetime
import uuid


class SentinelScanner:
    def run_scan(self, zone_dict: dict, triggered_by: str = "schedule") -> dict:
        zone_id = zone_dict.get("system_id", "unknown")
        scan_id = str(uuid.uuid4())
        print(f"[sentinel-scanner] scan skipped (no imagery backend) — "
              f"zone={zone_id} triggered_by={triggered_by} scan_id={scan_id}")
        try:
            from database import SentinelScan, SessionLocal
            db = SessionLocal()
            try:
                row = SentinelScan(
                    scan_id=scan_id,
                    zone_id=zone_dict.get("id"),
                    triggered_by=triggered_by,
                    status="skipped",
                    completed_at=datetime.datetime.utcnow(),
                    error_message="sentinel_scanner not configured — no imagery backend",
                )
                db.add(row)
                db.commit()
            finally:
                db.close()
        except Exception as e:
            print(f"[sentinel-scanner] could not persist scan record: {e}")
        return {"scan_id": scan_id, "status": "skipped"}
