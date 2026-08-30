"""
sanctions_loader.py — OpenSanctions maritime vessel list integration.

Downloads and indexes sanctioned vessel data from OpenSanctions' dedicated
maritime export. Provides O(1) MMSI/IMO/name lookups for the AIS pipeline.
Refreshes every 24 hours.

Data source note (2026-08-29): this used to pull the generic
targets.simple.csv bulk export (people/companies/vessels mixed into one
file), guess "is this row a vessel?" from a schema field with a keyword
fallback, and regex-scrape MMSI/IMO out of a freeform semicolon-delimited
"identifiers" field. That guessing was measurably bad: of the 2,714 rows
the old logic tagged as vessels, 716 (26.4%) were not vessels at all —
shipping companies/managers ("Benoil Shipping Inc", "RHINE SHIPPING DMCC")
caught by the keyword fallback purely because their name contained a word
like "shipping" — and 410 of those had no MMSI/IMO whatsoever, so they sat
in `_sanctions_by_name` as bare name strings, inflating the fuzzy/exact
name-match false-positive surface. 418/2714 (15.4%) of all old "vessel"
rows had no usable MMSI/IMO and could only ever be reached via name
matching.

OpenSanctions' maritime export (maritime.csv) fixes this at the source:
`type` is a reliable VESSEL/ORGANIZATION column (no keyword-guessing), and
`imo`/`mmsi`/`flag` are clean, separate, already-formatted columns (no
combined-field regex scraping). Filtering to type == "VESSEL" only, this
source's name-only rate is 551/6,048 = 9.1% — see `_parse_csv` for the
full before/after verification against real downloaded data.
"""

import httpx
import csv
import io
import json
from datetime import datetime, timedelta
from database import SessionLocal, SanctionedEntity

# URL tried first; JSON is a fallback if the CSV endpoint is unreachable.
_CSV_URLS = [
    "https://data.opensanctions.org/datasets/latest/maritime/maritime.csv",
]
_JSON_FALLBACK_URL = (
    "https://data.opensanctions.org/datasets/latest/maritime/entities.ftm.json"
)


class SanctionsLoader:

    def __init__(self):
        self._sanctions_by_mmsi: dict = {}
        self._sanctions_by_imo: dict = {}
        self._sanctions_by_name: dict = {}
        self._last_loaded: datetime = None
        self._total_vessels: int = 0

    async def load_or_refresh(self, db=None) -> dict:
        """Load sanctions list. Refresh if older than 24h. Returns stats dict.

        This is the single choke point both the startup call and the 24h
        scheduled loop go through, so it's also where main.py's
        _DS_STATUS["sanctions"] health entry is updated — on success:
        last_loaded/vessel_count/failures=0/error=None; on any failure path:
        last_attempt, failures incremented, error set to the already-computed
        error string.
        """
        if (self._last_loaded and
                datetime.utcnow() - self._last_loaded < timedelta(hours=24)):
            return {"cached": True, "vessels": self._total_vessels}

        # Imported lazily (not at module top) because main.py imports this
        # module eagerly at its own top level (`from sanctions_loader import
        # sanctions_loader, ...`) — a top-level import back here would be
        # circular. By the time load_or_refresh() actually runs, main.py is
        # already fully loaded, so this always succeeds.
        try:
            from main import _DS_STATUS, _DS_STATUS_LOCK
        except ImportError:
            from backend.main import _DS_STATUS, _DS_STATUS_LOCK

        def _mark_attempt_failed(error_msg: str) -> None:
            with _DS_STATUS_LOCK:
                _DS_STATUS["sanctions"]["last_attempt"] = datetime.utcnow().isoformat()
                _DS_STATUS["sanctions"]["failures"] = _DS_STATUS["sanctions"].get("failures", 0) + 1
                _DS_STATUS["sanctions"]["error"] = error_msg

        print("[sanctions] Loading OpenSanctions maritime data…")

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
                _mark_attempt_failed(f"all sources failed: {e}")
                if db:
                    self._load_from_db(db)
                return {"error": str(e), "vessels": self._total_vessels}

        if not vessels:
            print("[sanctions] No vessel records parsed — falling back to DB cache")
            _mark_attempt_failed("no_vessels_parsed")
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
            # A handful of vessels broadcast under more than one MMSI
            # (observed on North Korea-linked hulls dodging tracking) —
            # index every additional valid MMSI against the same record.
            for extra in vessel.get("_extra_mmsi", []):
                new_mmsi[extra] = vessel
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

        with _DS_STATUS_LOCK:
            _DS_STATUS["sanctions"]["last_loaded"] = self._last_loaded.isoformat()
            _DS_STATUS["sanctions"]["vessel_count"] = self._total_vessels
            _DS_STATUS["sanctions"]["failures"] = 0
            _DS_STATUS["sanctions"]["error"] = None

        print(f"[sanctions] Loaded {len(vessels)} sanctioned vessels "
              f"({len(new_mmsi)} by MMSI, {len(new_imo)} by IMO) from {used_url}")
        return {
            "vessels":   len(vessels),
            "by_mmsi":   len(new_mmsi),
            "by_imo":    len(new_imo),
            "loaded_at": self._last_loaded.isoformat(),
        }

    def _parse_csv(self, data_text: str) -> list:
        # Column layout of maritime.csv (verified against a live download,
        # 2026-08-29):
        #   type, caption, imo, risk, countries, flag, mmsi, id, url,
        #   datasets, aliases
        #
        # Sanctions-scope filter — REQUIRED. This file is OpenSanctions'
        # full maritime watchlist, not a sanctions-only list. Of 23,208
        # real downloaded rows, `risk` (a semicolon-joined tag set) broke
        # down as: '' (7,415), 'mare.detained' (6,740), 'sanction' (5,334),
        # 'poi' (2,086), 'mare.shadow;poi' (857), 'mare.detained;reg.warn'
        # (628), 'reg.warn' (148). 'mare.detained' / 'reg.warn' are Port
        # State Control safety detentions / registry warnings (Tokyo MoU,
        # Abuja MoU, Paris MoU, etc — confirmed via their `datasets`
        # values, e.g. "abuja_mou_detention") — NOT sanctions, and must
        # never reach check_vessel(), or a ship merely detained for a
        # safety defect would trip the "critical: SANCTIONED VESSEL"
        # alert path in main.py.
        #
        # Kept only rows where `risk` contains "sanction" or "poi".
        # Verified every `datasets` value behind those two tags is a real
        # government sanctions program — us_ofac_sdn, us_trade_csl,
        # eu_sanctions_map, ua_war_sanctions, ca_dfatd_sema_sanctions,
        # ch_seco_sanctions, gb_fcdo_sanctions, fr_tresor_gels_avoir,
        # un_1718_vessels, eu_fsf, mc_fund_freezes, eu_journal_sanctions,
        # us_cbp_forced_labor, be_fod_sanctions, ae_local_terrorists — with
        # zero PSC-detention datasets leaking through. That kept 8,277 of
        # 23,208 rows. Further restricting to type == "VESSEL" (dropping
        # 2,229 ORGANIZATION rows — shipping companies/managers, not
        # vessels themselves — this is the reliable column the old
        # keyword-guessing heuristic never had) leaves 6,048 rows actually
        # indexed, of which 5,497 (90.9%) carry a usable MMSI and/or IMO
        # and 551 (9.1%) are name-only.
        reader = csv.DictReader(io.StringIO(data_text))
        vessels = []
        for row in reader:
            if (row.get("type") or "").strip().upper() != "VESSEL":
                continue
            risk = (row.get("risk") or "").lower()
            if "sanction" not in risk and "poi" not in risk:
                continue

            name      = (row.get("caption")  or "").strip()
            entity_id = (row.get("id")       or "").strip()
            datasets  = (row.get("datasets") or "").strip().replace(";", ",")
            flag      = (row.get("flag")     or "").strip()

            # imo/mmsi are clean, dedicated columns now — no more
            # scanning a freeform "identifiers" field with regexes. imo
            # arrives as "IMO<7digits>"; strip the literal prefix to keep
            # the bare-digit form this module has always stored/indexed
            # by. mmsi is a bare digit string for the overwhelming
            # majority of rows, but a few carry multiple semicolon-joined
            # values (see the multi-MMSI note above) — split and keep
            # every 9-digit token.
            imo_raw = (row.get("imo") or "").strip().upper()
            imo = imo_raw[3:] if imo_raw.startswith("IMO") and imo_raw[3:].isdigit() else None

            mmsi_tokens  = [t.strip() for t in (row.get("mmsi") or "").split(";") if t.strip()]
            valid_mmsis  = [t for t in mmsi_tokens if t.isdigit() and len(t) == 9]
            mmsi         = valid_mmsis[0] if valid_mmsis else None

            if not (mmsi or imo or name):
                continue

            vessels.append({
                "entity_id":   entity_id,
                "name":        name,
                "mmsi":        mmsi,
                "imo":         imo,
                "datasets":    datasets,
                "flag":        flag,
                "owner":       "",
                "topics":      "",
                "_extra_mmsi": valid_mmsis[1:],
            })
        return vessels

    def _parse_json(self, data_text: str) -> list:
        """Fallback parser for entities.ftm.json (full FollowTheMoney dump).

        Only used if the CSV endpoint is unreachable. Same sanctions-scope
        filter as _parse_csv, expressed against this format's fields: a
        Vessel entity's `properties.topics` carries the same "sanction" /
        "poi" tags the CSV's `risk` column is derived from.
        """
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
            props  = entity.get("properties", {})
            topics = [t.lower() for t in props.get("topics", [])]
            if not any("sanction" in t or "poi" in t for t in topics):
                continue

            mmsi_list = props.get("mmsi", [])
            imo_list  = props.get("imoNumber", props.get("imo", []))
            name_list = props.get("name", [])
            datasets  = entity.get("datasets", [])

            imo_raw = (imo_list[0].strip().upper() if imo_list else "")
            imo = imo_raw[3:] if imo_raw.startswith("IMO") and imo_raw[3:].isdigit() else (imo_raw or None)
            mmsi = mmsi_list[0].strip() if mmsi_list else None
            name = name_list[0].strip() if name_list else None
            if not (mmsi or imo or name):
                continue

            flag_list = props.get("flag") or props.get("country") or [None]
            vessels.append({
                "entity_id":   entity.get("id", ""),
                "name":        name or "",
                "mmsi":        mmsi,
                "imo":         imo,
                "datasets":    ",".join(datasets),
                "flag":        flag_list[0] or "",
                "owner":       (props.get("owner", [None])[0] or ""),
                "topics":      ",".join(entity.get("topics", [])),
                "_extra_mmsi": [t.strip() for t in mmsi_list[1:] if t.strip()],
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
        """Check if a vessel is sanctioned. Returns record or None.

        The returned dict carries a `_match_type` key so callers can tell a
        verified identifier hit (mmsi/imo — effectively unambiguous) apart
        from a name-based match, which is inherently weaker: vessel names
        are short, reused across unrelated ships ("STAR", "OCEAN GLORY",
        river barges named after the same handful of common words), and a
        substring match against one is not the same evidence as an exact
        registry-number match. Callers that turn a hit into a user-facing
        "critical: SANCTIONED VESSEL" alert should gate on `_match_type` —
        see `_check_sanctions_on_update` in main.py, which used to treat
        every match type identically and could fire a critical alert on an
        unrelated vessel (e.g. Rhine/canal traffic in Germany whose name
        happened to contain — or be contained in — a sanctioned name) that
        happened to be sailing nowhere near where the sanctioned vessel
        actually operates. A name-only match still fires a low-confidence
        "fuzzy_name" hit here, but it is on the caller to decide whether
        that is trustworthy enough to act on.
        """
        if mmsi and str(mmsi) in self._sanctions_by_mmsi:
            hit = dict(self._sanctions_by_mmsi[str(mmsi)])
            hit["_match_type"] = "mmsi"
            return hit

        if imo and str(imo) in self._sanctions_by_imo:
            hit = dict(self._sanctions_by_imo[str(imo)])
            hit["_match_type"] = "imo"
            return hit

        if name:
            key = name.upper().strip()
            if key in self._sanctions_by_name:
                hit = dict(self._sanctions_by_name[key])
                hit["_match_type"] = "exact_name"
                return hit
            # Fuzzy fallback for longer names only, and only when the two
            # names are close enough in length that one containing the
            # other is actually meaningful — e.g. "MV OCEAN GLORY II"
            # containing "OCEAN GLORY" is plausible; a 6-character generic
            # word like "OCEAN" or "STAR" matching inside a 30-character
            # unrelated name is exactly the false-positive pattern that
            # made this list flag random, unrelated vessels as sanctioned.
            if len(key) > 8:
                for sname, svessel in self._sanctions_by_name.items():
                    if len(sname) <= 8:
                        continue
                    if abs(len(key) - len(sname)) > 6:
                        continue
                    if key in sname or sname in key:
                        hit = dict(svessel)
                        hit["_match_type"] = "fuzzy_name"
                        return hit

        return None

    def get_sanction_explanation(self, sanction: dict) -> dict:
        """Return human-readable explanation of a sanction record."""
        datasets = (sanction.get("datasets") or "").split(",")
        list_names = {
            "us_ofac_sdn":          "OFAC SDN (US Treasury)",
            "us_trade_csl":         "US Commerce Consolidated Screening List",
            "eu_fsf":               "EU Financial Sanctions (FSF)",
            "eu_sanctions_map":     "EU Sanctions Map",
            "eu_journal_sanctions": "EU Official Journal Sanctions",
            "un_sc_sanctions":      "UN Security Council",
            "un_1718_vessels":      "UN Security Council Resolution 1718 (North Korea)",
            "gb_hmt_sanctions":     "UK HM Treasury",
            "gb_fcdo_sanctions":    "UK FCDO Sanctions",
            "ua_sfms_blacklist":    "Ukraine SFMS",
            "ua_war_sanctions":     "Ukraine War Sanctions",
            "ca_dfatd_sema_sanctions": "Canada SEMA Sanctions",
            "ch_seco_sanctions":    "Switzerland SECO Sanctions",
            "fr_tresor_gels_avoir": "France Treasury Asset Freeze",
            "mc_fund_freezes":      "Monaco Fund Freezes",
            "us_cbp_forced_labor":  "US CBP Forced Labor",
            "be_fod_sanctions":     "Belgium FOD Sanctions",
            "ae_local_terrorists":  "UAE Local Terrorist List",
            "opensanctions":        "OpenSanctions",
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


# ══════════════════════════════════════════════════════════════════════════════
# SHARED SANCTIONS-HIT CHECK — single source of truth for all 3 call sites that
# can each independently decide "is this vessel a sanctioned vessel":
#   - main.py's _check_sanctions_on_update()   (fires per AIS position update)
#   - main.py's ship-to-ship-transfer detection (fires per STS candidate pair)
#   - detectors/correlation_engine.py's DarkShipDetector, via _check_sanctions_hit
#
# Lives here — rather than in detectors/correlation_engine.py, which already
# had a copy of the flag-plausibility helper — because:
#   - This module is the actual sanctions-data module, and the one dependency
#     all 3 call sites already import unconditionally.
#   - detectors/correlation_engine.py is only importable when main.py's
#     `_HAS_DETECTORS` is True (guarded by a top-level try/except ImportError
#     in main.py). main.py's AIS position-update path is NOT gated on
#     `_HAS_DETECTORS` — it runs any time the AIS websocket is connected —
#     so anchoring the shared check inside detectors/ would make sanctions
#     checking silently disappear whenever the detectors package fails to
#     import, even though it has nothing to do with the detector engines.
# ══════════════════════════════════════════════════════════════════════════════

_sanctions_alert_cooldown: dict = {}  # mmsi (str) → datetime this function last returned a result for it


def _sanctions_hit_is_plausible(hit: dict, vessel: dict) -> bool:
    """
    Best-effort corroboration for a sanctions hit found via a hard MMSI/IMO
    (or exact-name) match. A hard identifier match is not automatically the
    same physical vessel forever — MMSI numbers get reassigned and IMO/
    vessels get scrapped, reflagged, or sold — so this checks one genuinely
    independent data point: does the live vessel's reported flag agree with
    the flag on the sanctions record?

    This is deliberately NOT a name check: sanctions_loader.check_vessel()
    already does exact/fuzzy name matching as a separate, weaker match tier
    (see its docstring and the `_match_type == "fuzzy_name"` gate applied in
    `check_sanctions_for_vessel` below); re-comparing name here would just be
    a confusing duplicate of that existing signal rather than a new one.
    Flag, by contrast, is a completely separate field from whatever produced
    the hit (MMSI/IMO), so a flag mismatch is real corroborating-or-
    contradicting evidence.

    Returns False only when both flags are known, non-empty, and clearly
    different after normalizing case/whitespace — a real contradiction.
    Returns True when the flags agree, OR when either side is unknown/blank:
    missing data can't corroborate OR contradict, so the policy choice here
    is to fall back to the pre-existing behavior (fire normally) rather than
    invent a rule for data we don't have.
    """
    hit_flag  = (hit.get("flag") or "").strip().upper()
    live_flag = (vessel.get("flag") or vessel.get("country") or "").strip().upper()
    if not hit_flag or not live_flag:
        return True
    return hit_flag == live_flag


def check_sanctions_for_vessel(mmsi: str, name: str = None, vessel: dict = None,
                                cooldown_seconds: int = 6 * 3600) -> "dict | None":
    """
    Single shared "is this vessel sanctioned" check, used by all 3 call sites
    that can independently produce a "Sanctioned Vessel"-type alert.

    - Calls sanctions_loader.check_vessel(mmsi=mmsi, name=name).
    - Returns None on no hit.
    - Discards `_match_type == "fuzzy_name"` hits (returns None) — a
      name-only match is not reliable enough evidence to act on (matches
      pre-existing behavior at all 3 sites; see check_vessel's docstring).
    - For a hard match (mmsi/imo/exact_name), runs `_sanctions_hit_is_plausible`
      against whatever vessel data the caller has available. If the caller
      has no live flag/country data to pass (e.g. main.py's AIS
      position-update path — aisstream.io position/static-data messages
      don't carry a flag/country field today), the missing-data policy in
      `_sanctions_hit_is_plausible` applies: treat it as "confirmed" rather
      than invent a rule for data that doesn't exist at that call site.
    - Applies ONE shared cooldown per mmsi: an in-memory dict (fast path)
      backed by a DB check against previously-written Alert rows so the
      cooldown survives a process restart — the more complete of the two
      pre-consolidation cooldown stores (main.py's old `_sanctions_alerted`
      had both an in-memory dict AND a DB backstop;
      detectors/correlation_engine.py's old `_sanctions_alert_cooldown` was
      in-memory only and reset on every restart).
    - Does NOT build or return position (lat/lon) data — callers already
      have their own vessel/pair position and should use that directly
      rather than have this function fabricate a 0,0 default for a vessel
      with no reported position.

    vessel: optional dict that may carry "flag"/"country" (used for
            plausibility) and "name" (fallback display name). Never
            required, and never used for position.

    Returns None (nothing to act on right now — no hit, fuzzy-only hit, or
    still within cooldown) or:
        {
            "status":      "confirmed" | "possible",
            "hit":         <raw sanctions record dict, includes _match_type>,
            "mmsi":        str,
            "vessel_name": str,   # best available display name
        }
    """
    mmsi = str(mmsi or "").strip()
    if not mmsi:
        return None
    vessel = vessel or {}

    hit = sanctions_loader.check_vessel(mmsi=mmsi, name=name)
    if not hit:
        return None
    if hit.get("_match_type") == "fuzzy_name":
        # A name-only fuzzy match is not reliable enough to act on — real
        # traffic (including inland river/canal AIS) can share a common word
        # with a sanctioned vessel's name without being that vessel.
        return None

    now = datetime.utcnow()
    last_fired = _sanctions_alert_cooldown.get(mmsi)
    if last_fired and (now - last_fired).total_seconds() < cooldown_seconds:
        return None

    # DB-backed cooldown backstop — catches the case where a different
    # process (or this one, since a restart) already alerted on this mmsi
    # recently, even though the in-memory dict above has no record of it.
    try:
        from database import get_db as _gdb_sc, Alert as _Alert_sc
        with _gdb_sc() as _db_sc:
            existing = _db_sc.query(_Alert_sc).filter(
                _Alert_sc.entity_id == mmsi,
                _Alert_sc.alert_type.in_(["Sanctioned Vessel", "Sanctioned Vessel (Possible)"]),
                _Alert_sc.created_at >= now - timedelta(seconds=cooldown_seconds),
            ).first()
            if existing:
                _sanctions_alert_cooldown[mmsi] = now
                return None
    except Exception:
        pass

    _sanctions_alert_cooldown[mmsi] = now

    plausible   = _sanctions_hit_is_plausible(hit, vessel)
    vessel_name = hit.get("name") or name or vessel.get("name") or mmsi

    return {
        "status":      "confirmed" if plausible else "possible",
        "hit":         hit,
        "mmsi":        mmsi,
        "vessel_name": vessel_name,
    }
