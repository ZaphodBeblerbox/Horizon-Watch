"""
sanctions_loader.py — OpenSanctions vessel list integration.

Downloads and indexes sanctioned vessel data from OpenSanctions.
Provides O(1) MMSI/IMO/name lookups for the AIS pipeline.
Refreshes every 24 hours.
"""

import httpx
import csv
import io
import json
from datetime import datetime, timedelta
from database import SessionLocal, SanctionedEntity


# URLs tried in order — vessels endpoint was deprecated early 2025
_CSV_URLS = [
    "https://data.opensanctions.org/datasets/latest/sanctions/targets.simple.csv",
    "https://data.opensanctions.org/datasets/latest/default/targets.simple.csv",
]
_JSON_FALLBACK_URL = (
    "https://data.opensanctions.org/datasets/latest/sanctions/entities.ftm.json"
)

_VESSEL_KEYWORDS = {"tanker", "cargo", "ship", "vessel", "ferry", "bulk", "lng", "lpg"}


def _is_vessel_row(row: dict) -> bool:
    schema = (row.get("schema") or row.get("type") or "").lower()
    if "vessel" in schema:
        return True
    caption = (row.get("caption") or row.get("name") or "").lower()
    return any(kw in caption for kw in _VESSEL_KEYWORDS)


class SanctionsLoader:

    def __init__(self):
        self._sanctions_by_mmsi: dict = {}
        self._sanctions_by_imo: dict = {}
        self._sanctions_by_name: dict = {}
        self._last_loaded: datetime = None
        self._total_vessels: int = 0

    async def load_or_refresh(self, db=None) -> dict:
        """Load sanctions list. Refresh if older than 24h. Returns stats dict."""
        if (self._last_loaded and
                datetime.utcnow() - self._last_loaded < timedelta(hours=24)):
            return {"cached": True, "vessels": self._total_vessels}

        print("[sanctions] Loading OpenSanctions vessel data…")

        # Try CSV sources first
        data_text = None
        used_url  = None
        async with httpx.AsyncClient(timeout=45, follow_redirects=True) as client:
            for url in _CSV_URLS:
                try:
                    r = await client.get(url)
                    if r.status_code == 200:
                        data_text = r.text
                        used_url  = url
                        print(f"[sanctions] Downloaded CSV from {url}")
                        break
                    print(f"[sanctions] {url} returned {r.status_code}, trying next…")
                except Exception as e:
                    print(f"[sanctions] {url} failed: {e}, trying next…")

        if data_text:
            vessels = self._parse_csv(data_text)
        else:
            # Fallback to JSON format
            print(f"[sanctions] Falling back to JSON: {_JSON_FALLBACK_URL}")
            try:
                async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
                    r = await client.get(_JSON_FALLBACK_URL)
                    r.raise_for_status()
                vessels = self._parse_json(r.text)
                used_url = _JSON_FALLBACK_URL
                print(f"[sanctions] Downloaded JSON from {_JSON_FALLBACK_URL}")
            except Exception as e:
                print(f"[sanctions] All sources failed: {e}")
                if db:
                    self._load_from_db(db)
                return {"error": str(e), "vessels": self._total_vessels}

        if not vessels:
            print("[sanctions] No vessel records parsed — falling back to DB cache")
            if db:
                self._load_from_db(db)
            return {"error": "no_vessels_parsed", "vessels": self._total_vessels}

        new_mmsi: dict = {}
        new_imo:  dict = {}
        new_name: dict = {}
        for vessel in vessels:
            mmsi = vessel.get("mmsi") or ""
            imo  = vessel.get("imo")  or ""
            name = vessel.get("name") or ""
            if mmsi:
                new_mmsi[mmsi] = vessel
            if imo:
                new_imo[imo] = vessel
            if name:
                new_name[name.upper().strip()] = vessel

        self._sanctions_by_mmsi = new_mmsi
        self._sanctions_by_imo  = new_imo
        self._sanctions_by_name = new_name
        self._total_vessels     = len(vessels)
        self._last_loaded       = datetime.utcnow()

        # Persist to DB
        if db:
            self._persist_to_db(vessels, db)
        else:
            try:
                with SessionLocal() as _db:
                    self._persist_to_db(vessels, _db)
            except Exception:
                pass

        print(f"[sanctions] Loaded {len(vessels)} sanctioned vessels "
              f"({len(new_mmsi)} by MMSI, {len(new_imo)} by IMO) from {used_url}")
        return {
            "vessels":   len(vessels),
            "by_mmsi":   len(new_mmsi),
            "by_imo":    len(new_imo),
            "loaded_at": self._last_loaded.isoformat(),
        }

    def _parse_csv(self, data_text: str) -> list:
        reader = csv.DictReader(io.StringIO(data_text))
        vessels = []
        for row in reader:
            if not _is_vessel_row(row):
                continue
            mmsi      = (row.get("mmsi")     or "").strip()
            imo       = (row.get("imo")      or "").strip()
            name      = (row.get("name")     or "").strip()
            datasets  = (row.get("datasets") or "").strip()
            entity_id = (row.get("id")       or "").strip()
            if not (mmsi or imo or name):
                continue
            vessels.append({
                "entity_id": entity_id,
                "name":      name,
                "mmsi":      mmsi or None,
                "imo":       imo  or None,
                "datasets":  datasets,
                "flag":      row.get("flag",   ""),
                "owner":     row.get("owner",  ""),
                "topics":    row.get("topics", ""),
            })
        return vessels

    def _parse_json(self, data_text: str) -> list:
        vessels = []
        for line in data_text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                entity = json.loads(line)
            except Exception:
                continue
            if entity.get("schema") != "Vessel":
                continue
            props     = entity.get("properties", {})
            mmsi_list = props.get("mmsi", [])
            imo_list  = props.get("imoNumber", props.get("imo", []))
            name_list = props.get("name", [])
            datasets  = entity.get("datasets", [])
            mmsi      = mmsi_list[0].strip()  if mmsi_list  else None
            imo       = imo_list[0].strip()   if imo_list   else None
            name      = name_list[0].strip()  if name_list  else None
            if not (mmsi or imo or name):
                continue
            vessels.append({
                "entity_id": entity.get("id", ""),
                "name":      name or "",
                "mmsi":      mmsi,
                "imo":       imo,
                "datasets":  ",".join(datasets),
                "flag":      (props.get("flag",  [None])[0] or ""),
                "owner":     (props.get("owner", [None])[0] or ""),
                "topics":    ",".join(entity.get("topics", [])),
            })
        return vessels

    def _persist_to_db(self, vessels: list, db) -> None:
        try:
            for v in vessels:
                existing = None
                if v["mmsi"]:
                    existing = db.query(SanctionedEntity).filter_by(mmsi=v["mmsi"]).first()
                if not existing and v["imo"]:
                    existing = db.query(SanctionedEntity).filter_by(imo=v["imo"]).first()

                if existing:
                    existing.datasets   = v["datasets"]
                    existing.updated_at = datetime.utcnow()
                else:
                    db.add(SanctionedEntity(
                        entity_id   = v["entity_id"],
                        entity_name = v["name"],
                        mmsi        = v["mmsi"],
                        imo         = v["imo"],
                        flag        = v["flag"],
                        datasets    = v["datasets"],
                        owner_chain = v["owner"],
                        topics      = v["topics"],
                        loaded_at   = datetime.utcnow(),
                    ))
            db.commit()
        except Exception as e:
            print(f"[sanctions] DB persist failed: {e}")

    def _load_from_db(self, db) -> None:
        """Populate in-memory index from DB (used on startup before first download)."""
        try:
            rows = db.query(SanctionedEntity).all()
            for row in rows:
                vessel = {
                    "entity_id": row.entity_id,
                    "name":      row.entity_name or "",
                    "mmsi":      row.mmsi,
                    "imo":       row.imo,
                    "datasets":  row.datasets or "",
                    "flag":      row.flag or "",
                    "owner":     row.owner_chain or "",
                    "topics":    row.topics or "",
                }
                if row.mmsi:
                    self._sanctions_by_mmsi[row.mmsi] = vessel
                if row.imo:
                    self._sanctions_by_imo[row.imo] = vessel
                if row.entity_name:
                    self._sanctions_by_name[row.entity_name.upper().strip()] = vessel
            self._total_vessels = len(rows)
            if rows:
                print(f"[sanctions] Loaded {len(rows)} entries from DB cache")
        except Exception as e:
            print(f"[sanctions] DB load failed: {e}")

    def check_vessel(self, mmsi: str = None,
                     imo: str = None,
                     name: str = None) -> dict | None:
        """Check if a vessel is sanctioned. Returns record or None."""
        if mmsi and str(mmsi) in self._sanctions_by_mmsi:
            return self._sanctions_by_mmsi[str(mmsi)]

        if imo and str(imo) in self._sanctions_by_imo:
            return self._sanctions_by_imo[str(imo)]

        if name:
            key = name.upper().strip()
            if key in self._sanctions_by_name:
                return self._sanctions_by_name[key]
            # Partial match for names > 5 chars
            if len(key) > 5:
                for sname, svessel in self._sanctions_by_name.items():
                    if key in sname or sname in key:
                        return svessel

        return None

    def get_sanction_explanation(self, sanction: dict) -> dict:
        """Return human-readable explanation of a sanction record."""
        datasets = (sanction.get("datasets") or "").split(",")
        list_names = {
            "us_ofac_sdn":       "OFAC SDN (US Treasury)",
            "eu_fsf":            "EU Financial Sanctions (FSF)",
            "un_sc_sanctions":   "UN Security Council",
            "gb_hmt_sanctions":  "UK HM Treasury",
            "ua_sfms_blacklist": "Ukraine SFMS",
            "opensanctions":     "OpenSanctions",
        }
        readable_lists = [
            list_names.get(d.strip(), d.strip())
            for d in datasets if d.strip()
        ]

        return {
            "vessel_name":    sanction.get("name"),
            "mmsi":           sanction.get("mmsi"),
            "imo":            sanction.get("imo"),
            "flag":           sanction.get("flag"),
            "sanction_lists": readable_lists,
            "owner":          sanction.get("owner"),
            "what": (
                "This vessel appears on international sanctions lists."
            ),
            "why": (
                f"Listed by: {', '.join(readable_lists[:3])}. "
                "Sanctioned vessels are prohibited from port access, insurance, "
                "and financial services in signatory countries. Their operation "
                "typically involves sanctions evasion for Iranian oil, Russian "
                "crude, North Korean arms, or other prohibited activities."
            ),
            "watch": (
                "Track vessel movements, note any ship-to-ship transfers, "
                "verify flag state and AIS transponder consistency. "
                "Cross-reference with recent cargo declarations."
            ),
        }

    def stats(self) -> dict:
        return {
            "total_vessels": self._total_vessels,
            "by_mmsi":       len(self._sanctions_by_mmsi),
            "by_imo":        len(self._sanctions_by_imo),
            "loaded_at":     self._last_loaded.isoformat() if self._last_loaded else None,
        }


sanctions_loader = SanctionsLoader()
