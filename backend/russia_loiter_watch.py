"""
russia_loiter_watch.py — a Russia-linked ship loitering within drone range
of a European coast.

THE OWNER'S RULE (2026-10-10): "A loitering ship that can reliably be linked
to Russia and is in drone striking range of any European nation should be an
alert, considering the current developments." The developments: the autumn
2025 drone incursions over Danish, Norwegian and German airports, with
suspected launches from shadow-fleet tankers sitting off the coast (Boracay /
Pushpa), and the Baltic cable cuts by Eagle S.

THREE TESTS, ALL REQUIRED.

1. RELIABLY RUSSIA-LINKED. A false accusation is worse than a miss, so only
   identifiers count, never a name (67% of sanctioned-vessel name matches
   were namesakes — see sanctions_loader.check_sanctions_for_vessel):

     * Russian flag: a ship-station MMSI whose MID is 273.
     * A sanctions listing under a RUSSIA-RELATED programme, matched on the
       hull's IMO number or on the MMSI. The programme is read from the
       FollowTheMoney store (ftm_things + Sanction edges: OFAC provisions
       such as RUSSIA-EO14024, EU "Russia's actions destabilising the
       situation in Ukraine", UK "The Russia (Sanctions) Regulations", the
       EU shadow-fleet annex text, Canada "Russia", Switzerland "situation in
       Ukraine"). A dataset alone is not enough: the EU, UK and Swiss lists
       also carry North Korean ships. Ukraine's GUR War & Sanctions register
       (ua_war_sanctions) is Russia-specific by construction, so it counts
       by dataset, from either store.
     * An MMSI match is dropped when the listing's flag and the flag the
       MMSI broadcasts are both known and disagree — MMSIs are reassigned
       with a change of flag, so that is probably a different ship. An IMO
       match is kept through a reflagging: reflagging is what shadow-fleet
       hulls do.
   A destination or last port is never a link; a Russian destination is
   only mentioned as context in the message.

2. LOITERING. Speed over ground <= 1.5 kn — or <= 3 kn while the course
   wanders through 90 degrees or more within the hour — continuously for at
   least RUSSIA_LOITER_MIN_HOURS (default 2) while more than 5 km from any
   known port, inside drone range and outside Russian waters. Any break
   (moving on, entering a port, leaving range, a position jump, no report
   for two hours) ends the episode.

3. IN DRONE RANGE OF A EUROPEAN NATION. Distance to the nearest land of a
   European country (EUROPE below) <= RUSSIA_LOITER_DRONE_RANGE_KM (default
   100 km: fixed-wing Group 2/3 drones reach 100+ km; quadcopters 10-30 km,
   hence "critical" inside 25 km). A ship within 22 km of Russian land
   (Kaliningrad and, in this dataset, Crimea included) is a ship at home and
   is skipped; so is the Sea of Azov, whose Ukrainian shore is occupied.

One alert per vessel per loitering episode. A 12-hour cooldown per vessel
applies unless it has moved on (> 10 km) since the last alert — which also
stops a restart, or a one-report speed blip, from re-raising the same
episode.

Pure apart from the loaders: run_cycle() takes the raw AIS snapshot and a
clock and returns alert dicts for write_alert(). Geometry is prepared once,
the Russia-link index is rebuilt every six hours, and only the (small) set of
Russia-linked vessels is ever measured against coastlines.
"""
from __future__ import annotations

import csv
import json
import math
import os
import re
import sqlite3
import threading
import time
from typing import Callable, Iterable, Optional

# ── configuration ─────────────────────────────────────────────────────────


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "") or default)
    except ValueError:
        return default


ALERT_TYPE = "Russia-linked vessel loitering"
SOURCE = "ais"

MIN_HOURS = _env_float("RUSSIA_LOITER_MIN_HOURS", 2.0)
DRONE_RANGE_KM = _env_float("RUSSIA_LOITER_DRONE_RANGE_KM", 100.0)
QUADCOPTER_KM = 25.0          # within this: "critical"
HOME_WATERS_KM = 22.0         # 12 nm territorial sea, rounded up
PORT_KM = 5.0
# A port's own anchorage: hugging the shore close to a known port is waiting
# for a berth, not loitering (Varna's roads sit 5.3 km from the WPI point).
PORT_APPROACH_KM = 10.0
NEARSHORE_KM = 3.0
SLOW_KN = 1.5
SLOW_TURNING_KN = 3.0
TURN_SPREAD_DEG = 90.0
TURN_WINDOW_S = 3600
MOVE_ON_KM = 10.0             # a jump this far (beyond what slow drift explains) is a new place
STALE_S = 2 * 3600            # no report for this long: continuity cannot be claimed
COOLDOWN_S = 12 * 3600
INDEX_TTL_S = 6 * 3600

# European nations a drone launched from the sea could reach — names as in
# backend/geo/countries.geojson, with the ISO code stored on the alert and
# the phrase used in a title ("18 km off the UK"). Russia and Belarus are
# excluded by definition. Turkey and Georgia are excluded on purpose:
# Russian-flagged ships wait off Istanbul for the Bosphorus and trade with
# Georgian Black Sea ports every day, so including them would bury the
# signal in routine traffic. Greenland is excluded (not in Europe); so are
# Northern Cyprus and the UN buffer zone.
EUROPE: dict[str, tuple[str, str]] = {
    # EU 27
    "Austria": ("AT", "Austria"), "Belgium": ("BE", "Belgium"), "Bulgaria": ("BG", "Bulgaria"),
    "Croatia": ("HR", "Croatia"), "Cyprus": ("CY", "Cyprus"), "Czechia": ("CZ", "Czechia"),
    "Denmark": ("DK", "Denmark"), "Estonia": ("EE", "Estonia"), "Finland": ("FI", "Finland"),
    "France": ("FR", "France"), "Germany": ("DE", "Germany"), "Greece": ("GR", "Greece"),
    "Hungary": ("HU", "Hungary"), "Ireland": ("IE", "Ireland"), "Italy": ("IT", "Italy"),
    "Latvia": ("LV", "Latvia"), "Lithuania": ("LT", "Lithuania"), "Luxembourg": ("LU", "Luxembourg"),
    "Malta": ("MT", "Malta"), "Netherlands": ("NL", "the Netherlands"), "Poland": ("PL", "Poland"),
    "Portugal": ("PT", "Portugal"), "Romania": ("RO", "Romania"), "Slovakia": ("SK", "Slovakia"),
    "Slovenia": ("SI", "Slovenia"), "Spain": ("ES", "Spain"), "Sweden": ("SE", "Sweden"),
    "Aland": ("AX", "the Åland Islands (Finland)"),
    # The rest of Europe
    "United Kingdom": ("GB", "the UK"), "Isle of Man": ("IM", "the Isle of Man"),
    "Jersey": ("JE", "Jersey"), "Guernsey": ("GG", "Guernsey"), "Gibraltar": ("GI", "Gibraltar"),
    "Akrotiri Sovereign Base Area": ("GB", "the UK base at Akrotiri (Cyprus)"),
    "Dhekelia Sovereign Base Area": ("GB", "the UK base at Dhekelia (Cyprus)"),
    "Norway": ("NO", "Norway"), "Iceland": ("IS", "Iceland"), "Faroe Islands": ("FO", "the Faroe Islands"),
    "Switzerland": ("CH", "Switzerland"), "Liechtenstein": ("LI", "Liechtenstein"),
    "Andorra": ("AD", "Andorra"), "Monaco": ("MC", "Monaco"), "San Marino": ("SM", "San Marino"),
    "Vatican": ("VA", "the Vatican"),
    "Albania": ("AL", "Albania"), "Bosnia and Herzegovina": ("BA", "Bosnia and Herzegovina"),
    "Montenegro": ("ME", "Montenegro"), "North Macedonia": ("MK", "North Macedonia"),
    "Republic of Serbia": ("RS", "Serbia"), "Kosovo": ("XK", "Kosovo"),
    "Moldova": ("MD", "Moldova"), "Ukraine": ("UA", "Ukraine"),
}
RUSSIA_NAMES = ("Russia",)

# Geographic Europe, for clipping away overseas territories (French Guiana is
# "France" in the dataset) and Svalbard, where Russia runs Barentsburg.
EUROPE_BOX = (-32.0, 27.0, 45.0, 72.0)        # lon_min, lat_min, lon_max, lat_max
RUSSIA_BOX = (-32.0, 27.0, 60.0, 75.0)
# The Sea of Azov: its Ukrainian shore is occupied, so a Russian ship there
# is in Russian-controlled water, not off a European coast.
AZOV_BOX = (34.6, 45.0, 39.5, 47.4)


# ── small geometry helpers ────────────────────────────────────────────────

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def heading_spread(angles: Iterable[float]) -> float:
    """The smallest arc containing every course, in degrees (0..360)."""
    a = sorted({round(x % 360.0, 1) for x in angles})
    if len(a) < 2:
        return 0.0
    gaps = [b - c for b, c in zip(a[1:], a[:-1])] + [a[0] + 360.0 - a[-1]]
    return 360.0 - max(gaps)


def _in_box(lat: float, lon: float, b: tuple) -> bool:
    return b[0] <= lon <= b[2] and b[1] <= lat <= b[3]


# ── coastlines ───────────────────────────────────────────────────────────

class Coasts:
    """European and Russian land, prepared once: clipped to Europe, split
    into polygons, simplified (~500 m), and indexed in an STRtree so a
    distance query only ever touches the few polygons near the ship."""

    def __init__(self, geojson_path: str, simplify_deg: float = 0.005):
        from shapely.geometry import shape, box
        from shapely.strtree import STRtree
        import shapely

        polys, meta = [], []           # meta: (dataset name, is_russia)
        with open(geojson_path, encoding="utf-8") as fh:
            features = json.load(fh).get("features", [])
        for f in features:
            name = ((f.get("properties") or {}).get("name") or (f.get("properties") or {}).get("n") or "").strip()
            is_ru = name in RUSSIA_NAMES
            if not is_ru and name not in EUROPE:
                continue
            try:
                g = shape(f["geometry"])
            except Exception:                                   # noqa: BLE001
                continue
            g = g.intersection(box(*(RUSSIA_BOX if is_ru else EUROPE_BOX)))
            if g.is_empty:
                continue
            g = g.simplify(simplify_deg, preserve_topology=False)
            for part in getattr(g, "geoms", [g]):
                if part.is_empty or part.geom_type != "Polygon":
                    continue
                polys.append(part)
                meta.append((name, is_ru))
        self._shapely = shapely
        self._box = box
        self.polys = polys
        self.meta = meta
        self.tree = STRtree(polys) if polys else None

    def distances(self, lat: float, lon: float, radius_km: float) -> dict[str, float]:
        """{country name: km to its nearest land} for every European country
        and Russia ("Russia") within radius_km. 0.0 means on/inside the
        (simplified) coastline."""
        if self.tree is None:
            return {}
        import numpy as np
        sh = self._shapely
        kx = 111.320 * max(0.05, math.cos(math.radians(lat)))
        ky = 110.574
        dlon, dlat = radius_km / kx, radius_km / ky
        rect = (lon - dlon, lat - dlat, lon + dlon, lat + dlat)
        out: dict[str, float] = {}
        origin = sh.Point(0.0, 0.0)

        def to_km(coords):
            return np.column_stack(((coords[:, 0] - lon) * kx, (coords[:, 1] - lat) * ky))

        for i in self.tree.query(self._box(*rect)):
            name, _is_ru = self.meta[int(i)]
            part = sh.clip_by_rect(self.polys[int(i)], *rect)
            if part.is_empty:
                continue
            d = float(sh.transform(part, to_km).distance(origin))
            if d <= radius_km and d < out.get(name, float("inf")):
                out[name] = d
        return out


# ── ports ────────────────────────────────────────────────────────────────

class Ports:
    """Known ports on a one-degree grid. The World Port Index ships with the
    code (ports_cache.csv); PortBoundary rows (UN/LOCODE) are added when the
    database has them."""

    def __init__(self, ports: Iterable[tuple[float, float, str, str]]):
        self.grid: dict[tuple[int, int], list] = {}
        n = 0
        for lat, lon, name, country in ports:
            self.grid.setdefault((math.floor(lat), math.floor(lon)), []).append((lat, lon, name, country))
            n += 1
        self.count = n

    def nearest(self, lat: float, lon: float, *, country: Optional[str] = None,
                max_km: float = 100.0) -> tuple[Optional[float], Optional[str]]:
        best, best_name = None, None
        cy, cx = math.floor(lat), math.floor(lon)
        reach = 1 if max_km <= 60 else 2
        for dy in range(-reach, reach + 1):
            for dx in range(-reach, reach + 1):
                for plat, plon, name, pc in self.grid.get((cy + dy, cx + dx), ()):
                    if country and (pc or "").strip().lower() != country.lower():
                        continue
                    d = haversine_km(lat, lon, plat, plon)
                    if d <= max_km and (best is None or d < best):
                        best, best_name = d, name
        return best, best_name

    @classmethod
    def load(cls, csv_path: Optional[str], db_path: Optional[str] = None) -> "Ports":
        rows: list = []
        if csv_path and os.path.exists(csv_path):
            with open(csv_path, encoding="utf-8-sig", newline="") as fh:
                for r in csv.DictReader(fh):
                    try:
                        lat, lon = float(r.get("Latitude") or ""), float(r.get("Longitude") or "")
                    except ValueError:
                        continue
                    rows.append((lat, lon, (r.get("Main Port Name") or "").strip(),
                                 (r.get("Country Code") or "").strip()))
        if db_path and os.path.exists(db_path):
            try:
                con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=10)
                try:
                    for lat, lon, name in con.execute(
                            "SELECT latitude, longitude, port_name FROM port_boundaries "
                            "WHERE latitude IS NOT NULL AND longitude IS NOT NULL"):
                        rows.append((float(lat), float(lon), name or "", ""))
                finally:
                    con.close()
            except sqlite3.Error:
                pass
        return cls(rows)


# ── who is Russia-linked ─────────────────────────────────────────────────

_RUSSIA_TEXT = re.compile(
    r"russia|russie|russian|eo\s*14024|executive order 14024|eo\s*1366[012]|eo\s*13685|"
    r"ukraine-eo|eu-ukr|uk-rus|situation in ukraine|stolen ukrainian", re.I)
_SHADOW_TEXT = re.compile(
    r"shadow fleet|irregular and high-risk shipping|price cap|exported from russia|"
    r"originate in russia|russian (?:crude )?oil", re.I)

_AUTHORITY = (                     # dataset prefix -> who listed it
    ("us_", "the US"), ("eu_", "the EU"), ("gb_", "the UK"), ("ch_", "Switzerland"),
    ("ca_", "Canada"), ("fr_", "France"), ("be_", "Belgium"), ("mc_", "Monaco"),
    ("au_", "Australia"), ("nz_", "New Zealand"), ("jp_", "Japan"), ("un_", "the UN"),
)
GUR = "Ukraine's GUR War & Sanctions register"
_AUTH_ORDER = ["the EU", "the UK", "the US", "Switzerland", "Canada", "France", "Belgium",
               "Monaco", "Australia", "New Zealand", "Japan", "the UN"]


def authority_of(datasets: Iterable[str]) -> Optional[str]:
    for d in datasets:
        d = (d or "").strip().lower()
        if d.startswith("ua_war_sanctions"):
            return GUR
        for prefix, label in _AUTHORITY:
            if d.startswith(prefix):
                return label
    return None


def classify_listing(datasets: Iterable[str], text: str) -> Optional[dict]:
    """One sanctions listing -> {"authority", "shadow"} when it is a
    Russia-related listing, else None. The programme text decides; only
    Ukraine's GUR register counts by dataset alone."""
    ds = [str(d or "").lower() for d in datasets]
    auth = authority_of(ds)
    if not auth:
        return None
    gur = auth == GUR
    if not gur and not _RUSSIA_TEXT.search(text or ""):
        return None
    return {"authority": auth, "shadow": bool(_SHADOW_TEXT.search(text or ""))}


def _merge(index: dict, key: str, link: dict) -> None:
    cur = index.get(key)
    if cur is None:
        index[key] = {"authorities": set(link["authorities"]), "shadow": link["shadow"],
                      "listed_name": link.get("listed_name"), "listed_flag": link.get("listed_flag")}
        return
    cur["authorities"] |= set(link["authorities"])
    cur["shadow"] = cur["shadow"] or link["shadow"]
    cur["listed_name"] = cur.get("listed_name") or link.get("listed_name")
    cur["listed_flag"] = cur.get("listed_flag") or link.get("listed_flag")


def build_russia_index(db_path: str) -> dict:
    """{"imo": {imo: link}, "mmsi": {mmsi: link}, "resolved": {mmsi: link}}
    from the FtM store (programme-level) and the legacy sanctions table
    (GUR register only). A link: {"authorities": set, "shadow": bool,
    "listed_name", "listed_flag"}."""
    by_imo: dict = {}
    by_mmsi: dict = {}
    resolved: dict = {}
    by_thing: dict = {}
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=30)
    try:
        # FtM: every Sanction edge on a vessel, with its programme text.
        try:
            rows = con.execute(
                "SELECT t.id, t.imo, t.mmsi, t.caption, t.country, t.props_json, "
                "       e.datasets_json, e.props_json "
                "FROM ftm_things t JOIN ftm_edges e "
                "  ON e.schema = 'Sanction' AND e.source_id = t.id "
                "WHERE t.schema = 'Vessel'").fetchall()
        except sqlite3.Error:
            rows = []
        for tid, imo, mmsi, caption, country, tprops, eds, eprops in rows:
            try:
                tp = json.loads(tprops or "{}")
                ep = json.loads(eprops or "{}")
                ds = json.loads(eds or "[]")
            except ValueError:
                continue
            text = " ".join(str(v) for k in ("program", "programId", "provisions", "reason", "summary")
                            for v in (ep.get(k) or []))
            text += " " + " ".join(str(v) for v in (tp.get("notes") or []))
            c = classify_listing(ds, text)
            if not c:
                continue
            flag = ((tp.get("flag") or [None])[0] or country or "")
            link = {"authorities": {c["authority"]}, "shadow": c["shadow"],
                    "listed_name": caption, "listed_flag": str(flag).lower() or None}
            _merge(by_thing, tid, link)
            if imo:
                _merge(by_imo, str(imo), link)
            if mmsi:
                _merge(by_mmsi, str(mmsi), link)
        # Our own MMSI -> FtM resolutions, identifier methods only.
        try:
            for local_id, ftm_id, method in con.execute(
                    "SELECT local_id, ftm_id, method FROM ftm_resolution "
                    "WHERE local_kind = 'vessel' AND method IN ('imo', 'mmsi')"):
                if ftm_id in by_thing:
                    link = dict(by_thing[ftm_id])
                    link["method"] = method
                    resolved[str(local_id)] = link
        except sqlite3.Error:
            pass
        # Legacy table: Ukraine's GUR register is Russia-specific by itself.
        try:
            for imo, mmsi, name, flag in con.execute(
                    "SELECT DISTINCT imo, mmsi, entity_name, flag FROM sanctioned_entities "
                    "WHERE datasets LIKE '%ua_war_sanctions%' AND (imo IS NOT NULL OR mmsi IS NOT NULL)"):
                link = {"authorities": {GUR}, "shadow": False, "listed_name": name,
                        "listed_flag": (flag or "").lower() or None}
                if imo:
                    _merge(by_imo, str(imo).strip(), link)
                if mmsi:
                    _merge(by_mmsi, str(mmsi).strip(), link)
        except sqlite3.Error:
            pass
    finally:
        con.close()
    return {"imo": by_imo, "mmsi": by_mmsi, "resolved": resolved}


def _join(items: list[str]) -> str:
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def sanction_phrase(link: dict) -> str:
    """"sanctioned by the EU and the UK as part of Russia's shadow fleet"."""
    auths = set(link.get("authorities") or ())
    western = [a for a in _AUTH_ORDER if a in auths]
    parts = []
    if western:
        if link.get("shadow"):
            parts.append(f"sanctioned by {_join(western)} as part of Russia's shadow fleet")
        else:
            parts.append(f"sanctioned by {_join(western)} under Russia-related sanctions")
    if GUR in auths:
        if parts:
            parts.append(f"also listed in {GUR}")
        elif link.get("shadow"):
            parts.append(f"listed in {GUR} as part of Russia's shadow fleet (carrying Russian oil)")
        else:
            parts.append(f"listed in {GUR} as serving Russia's war effort")
    return "; ".join(parts)


def _mid_flag(mmsi: str) -> tuple[str, str]:
    """(MID, ISO2 flag) for a ship-station MMSI, else ("", "")."""
    try:
        import mmsi_lookup
        info = mmsi_lookup.lookup_mmsi(str(mmsi))
        iso = info.get("flag_iso2") or ""
        return info.get("mid") or "", "" if iso == "XX" else iso.lower()
    except Exception:                                       # noqa: BLE001
        return "", ""


def russia_links(vessel: dict, index: Optional[dict]) -> list[dict]:
    """Every reliable link this vessel has to Russia, as
    [{"kind": "flag" | "sanctions", "reason": str, "basis": str, ...}].
    Empty when there is none. Never looks at the name or destination."""
    mmsi = str(vessel.get("mmsi") or "").strip()
    out: list[dict] = []
    mid, live_flag = _mid_flag(mmsi)
    if len(mmsi) == 9 and mmsi.isdigit() and mmsi.startswith("273") and mid == "273":
        out.append({"kind": "flag", "reason": "Russian flag", "basis": "MMSI country code 273"})
    if not index:
        return out

    imo = str(vessel.get("imo") or "").strip()
    if imo.upper().startswith("IMO"):
        imo = imo[3:]
    link, basis = None, None
    if imo and imo in index.get("imo", {}):
        link, basis = index["imo"][imo], f"IMO {imo} match"
    if link is None and mmsi in index.get("mmsi", {}):
        cand = index["mmsi"][mmsi]
        listed = (cand.get("listed_flag") or "").lower()
        if not (listed and live_flag and listed != live_flag):   # reassigned MMSI: a different ship
            link, basis = cand, f"MMSI {mmsi} match"
    if link is None and mmsi in index.get("resolved", {}):
        cand = index["resolved"][mmsi]
        listed = (cand.get("listed_flag") or "").lower()
        if cand.get("method") == "imo" or not (listed and live_flag and listed != live_flag):
            link, basis = cand, f"{cand.get('method', 'identifier').upper()} match (resolved)"
    if link is not None:
        phrase = sanction_phrase(link)
        if phrase:
            out.append({"kind": "sanctions", "reason": phrase, "basis": basis,
                        "shadow": bool(link.get("shadow")),
                        "authorities": sorted(link.get("authorities") or ()),
                        "listed_name": link.get("listed_name")})
    return out


# ── words ────────────────────────────────────────────────────────────────

_SHIP_TYPE_CODES = [
    (range(80, 90), "tanker"), (range(70, 80), "cargo ship"), (range(60, 70), "passenger ship"),
    (range(30, 31), "fishing vessel"), (range(31, 33), "tug"), (range(52, 53), "tug"),
    (range(35, 36), "military vessel"), (range(55, 56), "law-enforcement vessel"),
    (range(33, 34), "dredger"), (range(34, 35), "diving vessel"), (range(50, 51), "pilot boat"),
    (range(51, 52), "search-and-rescue vessel"), (range(36, 38), "yacht"),
]
_RU_DEST = re.compile(r"\bRU\s?[A-Z]{3}\b|PRIMORSK|UST[\s-]?LUGA|NOVOROSSIYSK|ST\.?\s?PETERSBURG|"
                      r"SANKT|KALININGRAD|MURMANSK|TUAPSE|TAMAN|VYSOTSK|KAVKAZ|ARKHANGELSK", re.I)


def ship_word(vessel: dict) -> str:
    code = vessel.get("ship_type_code")
    try:
        c = int(code)
        for rng, word in _SHIP_TYPE_CODES:
            if c in rng:
                return word
    except (TypeError, ValueError):
        pass
    t = str(vessel.get("ship_type") or "").strip().lower()
    return {"tanker": "tanker", "cargo": "cargo ship", "passenger": "passenger ship",
            "military": "military vessel", "fishing": "fishing vessel"}.get(t, "vessel")


def _clean_name(vessel: dict) -> str:
    n = str(vessel.get("name") or "").strip()
    if not n or n.upper().startswith("MMSI") or n == str(vessel.get("mmsi") or ""):
        return ""
    return n


def _hours(h: float) -> str:
    return f"{h:.0f} h" if h >= 3 else f"{h:.1f} h".replace(".0 h", " h")


def _km(d: float) -> str:
    return "under 1 km" if d < 1 else f"{d:.0f} km"


def build_title(vessel: dict, links: list[dict], hours: float, dist_km: float,
                country_phrase: str, place: Optional[str]) -> str:
    """"Russian-flagged tanker EAGLE S loitering 3 h, 18 km off Finland (near Porvoo)"."""
    flag = any(l["kind"] == "flag" for l in links)
    sanc = next((l for l in links if l["kind"] == "sanctions"), None)
    words = []
    if flag:
        words.append("Russian-flagged")
    if sanc:
        words.append("shadow-fleet" if sanc.get("shadow") else "Russia-sanctioned")
    label = " ".join(words) or "Russia-linked"
    name = _clean_name(vessel)
    what = ship_word(vessel)
    if name:
        subject = f"{label} {what} {name}"
    else:
        subject = f"Unnamed {label} {what} (MMSI {vessel.get('mmsi')})"
    subject = subject[0].upper() + subject[1:]
    head = f"{subject} loitering {_hours(hours)}, {_km(dist_km)} off {country_phrase}"
    if place:
        head += f" (near {place})"
    return head


# ── the detector ─────────────────────────────────────────────────────────

class RussiaLoiterWatch:
    """Per-MMSI loitering state plus the rules above. Thread-safe enough for
    one cycle at a time (run_cycle holds a lock)."""

    def __init__(self, *, coasts: Optional[Coasts] = None, ports: Optional[Ports] = None,
                 index_loader: Optional[Callable[[], dict]] = None,
                 enrich: Optional[Callable[[dict], dict]] = None,
                 recent_alert_lookup: Optional[Callable[[str, float], list]] = None,
                 min_hours: float = MIN_HOURS, range_km: float = DRONE_RANGE_KM):
        self.coasts = coasts
        self.ports = ports
        self.index_loader = index_loader
        self.enrich = enrich
        self.recent_alert_lookup = recent_alert_lookup
        self.min_hours = min_hours
        self.range_km = range_km
        self._index: Optional[dict] = None
        self._index_at = 0.0
        self.state: dict[str, dict] = {}         # mmsi -> episode state
        self.alerted: dict[str, list] = {}       # mmsi -> [(ts, lat, lon)]
        self._lock = threading.Lock()
        self.last_stats: dict = {}

    # -- the Russia-link index ------------------------------------------
    def index(self, now: float) -> Optional[dict]:
        if self.index_loader and (self._index is None or now - self._index_at > INDEX_TTL_S):
            try:
                self._index = self.index_loader()
                self._index_at = now
                n = len(self._index.get("imo", {})) + len(self._index.get("mmsi", {}))
                print(f"[russia-loiter] Russia-link index: {len(self._index.get('imo', {}))} IMO, "
                      f"{len(self._index.get('mmsi', {}))} MMSI, {len(self._index.get('resolved', {}))} resolved ({n} keys)")
            except Exception as e:                           # noqa: BLE001
                # Loud, and retried next cycle — the flag rule keeps working.
                print(f"[russia-loiter] error: index build failed: {type(e).__name__}: {e}")
                self._index_at = now - INDEX_TTL_S + 600
        return self._index

    # -- geography --------------------------------------------------------
    def where(self, lat: float, lon: float) -> dict:
        """{"eligible", "why", "country", "iso2", "phrase", "dist_km"}."""
        if _in_box(lat, lon, AZOV_BOX):
            return {"eligible": False, "why": "Sea of Azov (Russian-controlled)"}
        if not self.coasts:
            return {"eligible": False, "why": "no coastline data"}
        d = self.coasts.distances(lat, lon, max(self.range_km, HOME_WATERS_KM))
        ru = min((v for k, v in d.items() if k in RUSSIA_NAMES), default=None)
        if ru is not None and ru <= HOME_WATERS_KM:
            return {"eligible": False, "why": f"Russian waters ({ru:.0f} km from Russia)"}
        eu = [(v, k) for k, v in d.items() if k in EUROPE and v <= self.range_km]
        if not eu:
            return {"eligible": False, "why": "out of drone range of Europe"}
        dist, name = min(eu)
        iso2, phrase = EUROPE[name]
        return {"eligible": True, "country": name, "iso2": iso2, "phrase": phrase, "dist_km": dist}

    def in_port(self, lat: float, lon: float) -> tuple[bool, Optional[str]]:
        if not self.ports:
            return False, None
        d, name = self.ports.nearest(lat, lon, max_km=PORT_APPROACH_KM)
        if d is None:
            return False, None
        if d <= PORT_KM:
            return True, name
        # Within a port's approaches AND close inshore: its anchorage.
        if self.coasts:
            near = self.coasts.distances(lat, lon, NEARSHORE_KM)
            if near:
                return True, name
        return False, None

    # -- loitering --------------------------------------------------------
    @staticmethod
    def _slow(st: dict, speed: Optional[float], now: float) -> bool:
        if speed is None:
            return False
        if speed <= SLOW_KN:
            return True
        if speed <= SLOW_TURNING_KN:
            recent = [c for t, c in st.get("cogs", []) if now - t <= TURN_WINDOW_S]
            return heading_spread(recent) >= TURN_SPREAD_DEG
        return False

    def _recently_alerted_here(self, mmsi: str, lat: float, lon: float, now: float) -> bool:
        hits = [h for h in self.alerted.get(mmsi, []) if now - h[0] < COOLDOWN_S]
        if self.recent_alert_lookup and not hits:
            try:
                hits = [h for h in (self.recent_alert_lookup(mmsi, now - COOLDOWN_S) or [])]
            except Exception as e:                           # noqa: BLE001
                print(f"[russia-loiter] error: cooldown lookup failed for {mmsi}: {type(e).__name__}: {e}")
                return True          # cannot tell — fail quiet, not noisy
            if hits:
                self.alerted[mmsi] = list(hits)
        return any(h[1] is not None and h[2] is not None
                   and haversine_km(lat, lon, h[1], h[2]) <= MOVE_ON_KM for h in hits)

    def _identify(self, v: dict, links: list[dict], mmsi: str) -> dict:
        """Name and type for the title. A live position report carries
        neither, so earlier static messages (vessel_identity — only ever
        adds) and then the listing itself fill the gap: the link was made on
        IMO/MMSI, so the listed name is this hull's."""
        if self.enrich:
            try:
                v = self.enrich(v) or v
            except Exception as e:                           # noqa: BLE001
                print(f"[russia-loiter] error: identity enrich failed for {mmsi}: {type(e).__name__}: {e}")
        if not _clean_name(v):
            listed = next((l.get("listed_name") for l in links if l.get("listed_name")), None)
            if listed:
                v = {**v, "name": str(listed).upper(), "name_from": "sanctions listing"}
        return v

    def run_cycle(self, vessels: Iterable[dict], now: Optional[float] = None) -> list[dict]:
        """One pass over the raw AIS snapshot. Returns new alert dicts."""
        now = time.time() if now is None else now
        with self._lock:
            return self._run(vessels, now)

    def _run(self, vessels: Iterable[dict], now: float) -> list[dict]:
        idx = self.index(now)
        alerts: list[dict] = []
        stats = {"vessels": 0, "linked": 0, "slow": 0, "eligible": 0, "loitering": 0, "alerts": 0}
        seen: set[str] = set()
        for v in vessels:
            stats["vessels"] += 1
            mmsi = str(v.get("mmsi") or "").strip()
            if not mmsi:
                continue
            try:
                lat, lon = float(v.get("lat")), float(v.get("lon", v.get("lng")))
            except (TypeError, ValueError):
                continue
            if lat == 0 and lon == 0:
                continue
            links = russia_links(v, idx)
            if not links:
                continue
            stats["linked"] += 1
            seen.add(mmsi)
            t_obs = float(v.get("last_update") or now)
            st = self.state.setdefault(mmsi, {"cogs": [], "start": None})
            # Continuity: a long silence, or a jump slow drift cannot explain,
            # ends the episode.
            if st.get("last_t") is not None:
                gap = t_obs - st["last_t"]
                moved = haversine_km(lat, lon, st["last_lat"], st["last_lon"])
                if gap > STALE_S or moved > MOVE_ON_KM + SLOW_TURNING_KN * 1.852 * max(gap, 0) / 3600:
                    st["start"] = None
                    st["cogs"] = []
            cog = v.get("cog", v.get("heading"))
            if cog is not None:
                try:
                    st["cogs"].append((t_obs, float(cog)))
                except (TypeError, ValueError):
                    pass
            st["cogs"] = [(t, c) for t, c in st["cogs"] if t_obs - t <= TURN_WINDOW_S][-60:]
            st.update(last_t=t_obs, last_lat=lat, last_lon=lon)

            speed = v.get("speed", v.get("sog"))
            try:
                speed = None if speed is None else float(speed)
            except (TypeError, ValueError):
                speed = None
            if not self._slow(st, speed, t_obs):
                # One fast report is AIS noise more often than departure; two
                # in a row, or a clear transit speed, end the episode.
                if (speed is not None and speed > 2 * SLOW_TURNING_KN) or st.get("start") is None \
                        or (st.get("fast_t") is not None and st["fast_t"] != t_obs):
                    st["start"] = None
                    st["fast_t"] = None
                elif st.get("fast_t") is None:
                    st["fast_t"] = t_obs
                continue
            st["fast_t"] = None
            stats["slow"] += 1
            port, _ = self.in_port(lat, lon)
            if port:
                st["start"] = None
                continue
            geo = self.where(lat, lon)
            if not geo["eligible"]:
                st["start"] = None
                continue
            stats["eligible"] += 1
            if st.get("start") is None:
                st["start"] = t_obs
                st["alerted"] = False
            hours = (t_obs - st["start"]) / 3600.0
            if hours < self.min_hours:
                continue
            stats["loitering"] += 1
            if st.get("alerted"):
                continue
            if self._recently_alerted_here(mmsi, lat, lon, now):
                st["alerted"] = True          # same place within the cooldown
                continue
            alert = self._alert(self._identify(v, links, mmsi), links, st, hours, geo, lat, lon, speed, mmsi)
            st["alerted"] = True
            self.alerted.setdefault(mmsi, []).append((now, lat, lon))
            alerts.append(alert)
            stats["alerts"] += 1
        # Forget vessels that have not been seen for longer than continuity allows.
        for m in [m for m, s in self.state.items() if m not in seen and now - (s.get("last_t") or 0) > STALE_S]:
            del self.state[m]
        for m in [m for m, h in self.alerted.items() if all(now - x[0] >= COOLDOWN_S for x in h)]:
            del self.alerted[m]
        self.last_stats = stats
        return alerts

    def _alert(self, v, links, st, hours, geo, lat, lon, speed, mmsi) -> dict:
        dist = geo["dist_km"]
        place = None
        if self.ports:
            _d, place = self.ports.nearest(lat, lon, country=geo["country"], max_km=max(60.0, dist + 30))
        title = build_title(v, links, hours, dist, geo["phrase"], place)
        severity = "critical" if dist <= QUADCOPTER_KM else "high"
        name = _clean_name(v) or None
        imo = str(v.get("imo") or "").strip() or None
        reasons = [l["reason"] for l in links]
        bases = [l["basis"] for l in links]
        within = (f"within {QUADCOPTER_KM:.0f} km quadcopter range" if dist <= QUADCOPTER_KM
                  else f"within {self.range_km:.0f} km fixed-wing drone range")
        dest = str(v.get("destination") or "").strip()
        ctx = []
        if v.get("nav_status"):
            ctx.append(f"AIS status: {v['nav_status']}")
        if dest:
            ctx.append(f"declared destination {dest}" + (" (a Russian port)" if _RU_DEST.search(dest) else ""))
        ident = ", ".join(x for x in (ship_word(v), f"MMSI {mmsi}", f"IMO {imo}" if imo else None) if x)
        message = (
            f"{name or 'Unnamed vessel'} ({ident}) has been loitering for {_hours(hours)} at "
            f"{'unknown speed' if speed is None else f'{speed:.1f} kn'}, {_km(dist)} off {geo['phrase']} — "
            f"{within}. Russia link: {'; '.join(reasons)} ({', '.join(bases)})."
            + (f" {'; '.join(ctx)}." if ctx else "")
            + f" Position {lat:.4f}, {lon:.4f}."
        )
        reason = f"{'; '.join(reasons)}; {_km(dist)} off {geo['phrase']}, {within}"
        return {
            "id": f"RUL-{mmsi}-{int(st['start'])}",
            "source": SOURCE,
            "alert_type": ALERT_TYPE,
            "title": title,
            "severity": severity,
            "lat": lat, "lon": lon,
            "region": geo["country"],
            "country_code": geo["iso2"],
            "entity_type": "vessel",
            "entity_id": mmsi,
            "entity_name": name,
            "mmsi": mmsi,
            "imo": imo,
            "vessel_name": name,
            "confidence": 0.9,
            "message": message,
            "reason": reason,
            "raw": {
                "rule": "russia_linked_loitering_in_drone_range",
                "link_reasons": reasons,
                "link_basis": bases,
                "links": links,
                "hours_loitering": round(hours, 2),
                "episode_start": st["start"],
                "speed_kn": speed,
                "distance_km": round(dist, 1),
                "nearest_country": geo["country"],
                "nearest_country_iso2": geo["iso2"],
                "near_place": place,
                "drone_range_km": self.range_km,
                "quadcopter_range": dist <= QUADCOPTER_KM,
                "lat": lat, "lon": lon,
                "mmsi": mmsi, "imo": imo, "name": name,
                "ship_type": ship_word(v),
                "nav_status": v.get("nav_status"),
                "destination": dest or None,
                "reason": reason,
            },
        }


# ── production wiring helpers ────────────────────────────────────────────

def recent_alerts_from_db(db_path: str) -> Callable[[str, float], list]:
    """[(epoch, lat, lon)] of this rule's alerts for an MMSI since a time —
    the cooldown backstop that survives a restart."""
    def lookup(mmsi: str, since: float) -> list:
        import datetime as _dt
        since_s = _dt.datetime.fromtimestamp(since, _dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=10)
        try:
            rows = con.execute(
                "SELECT created_at, lat, lon FROM alerts WHERE entity_id = ? AND alert_type = ? "
                "AND created_at >= ?", (str(mmsi), ALERT_TYPE, since_s)).fetchall()
        finally:
            con.close()
        out = []
        for created, la, lo in rows:
            try:
                ts = _dt.datetime.fromisoformat(str(created).replace(" ", "T")[:19]).replace(
                    tzinfo=_dt.timezone.utc).timestamp()
            except ValueError:
                ts = since
            out.append((ts, la, lo))
        return out
    return lookup


def _identity_enricher() -> Optional[Callable[[dict], dict]]:
    try:
        import vessel_identity
        return vessel_identity.enrich
    except Exception as e:                                   # noqa: BLE001
        print(f"[russia-loiter] error: vessel_identity unavailable ({type(e).__name__}: {e}); "
              f"titles fall back to the listed name or the MMSI")
        return None


_WATCH: Optional[RussiaLoiterWatch] = None
_WATCH_LOCK = threading.Lock()


def default_watch() -> RussiaLoiterWatch:
    """The process-wide detector, its data loaded on first use (call it from
    a worker thread: preparing the coastlines takes a second or two)."""
    global _WATCH
    with _WATCH_LOCK:
        if _WATCH is None:
            import paths
            t0 = time.monotonic()
            geo = paths.CODE_DIR / "geo" / "countries.geojson"
            coasts = Coasts(str(geo))
            db = str(paths.DB_PATH)
            ports = Ports.load(str(paths.CODE_DIR / "ports_cache.csv"), db)
            _WATCH = RussiaLoiterWatch(
                coasts=coasts, ports=ports,
                index_loader=lambda: build_russia_index(db),
                enrich=_identity_enricher(),
                recent_alert_lookup=recent_alerts_from_db(db),
            )
            print(f"[russia-loiter] prepared {len(coasts.polys)} coastline polygons and "
                  f"{ports.count} ports in {time.monotonic() - t0:.1f}s "
                  f"(range {DRONE_RANGE_KM:.0f} km, min {MIN_HOURS:g} h)")
        return _WATCH
