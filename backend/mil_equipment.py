"""
mil_equipment.py — what a force actually fields, from Wikipedia.

WHY THIS AND NOT A GUESS. A generated scenario decides which formations
to draw: whether there is an air axis at all, whether the defender can
contest it, whether a naval approach is possible. Deciding that from
doctrine alone invents capabilities. Wikipedia maintains "List of
equipment of the X Armed Forces" pages, community-edited and sectioned
BY CAPABILITY — air defence, anti-ship, armoured vehicles, artillery,
aircraft — through the same open MediaWiki API wiki_warmaps.py already
uses. No key, no quota.

WHAT IS TAKEN AND WHAT IS NOT. The SECTIONS, not the inventory. Counting
tanks from a wiki table would be a precision nobody should trust and the
numbers are the most-edited, least-stable part of those pages. Which
capability categories a force HAS is stable, checkable and enough:
air-defence present means an air axis is contested; no combat aircraft
listed means there is no air axis from that side to draw.

ABSENCE IS REPORTED, NOT ASSUMED. A force with no page, or a page with no
recognisable sections, returns `known: False`. That is different from a
force known to lack a capability, and the caller must be able to tell
them apart — drawing no air axis because we checked is a finding, and
drawing none because we never looked is a bug.
"""
from __future__ import annotations
import json
import re
import sqlite3
import time
import urllib.parse
import urllib.request

_API = "https://en.wikipedia.org/w/api.php"
_UA = "HorizonWatch/2.0 (+https://github.com/ZaphodBeblerbox/Horizon-Watch)"
_TIMEOUT = 45

#: Cache for a month. These pages change slowly and a scenario that
#: waits on four network round-trips is a scenario nobody runs twice.
TTL_S = 30 * 24 * 3600

SCHEMA = """
CREATE TABLE IF NOT EXISTS mil_equipment (
    force      TEXT PRIMARY KEY,
    page       TEXT,
    caps       TEXT NOT NULL,      -- JSON list of capability keys
    sections   TEXT NOT NULL,      -- JSON list of raw section titles
    fetched_at REAL NOT NULL
);
"""

#: Section title patterns -> capability. Ordered most specific first,
#: because "anti-aircraft" must not be swallowed by "aircraft".
CAP_PATTERNS = [
    ("air_defence",  r"air[- ]?defen[cs]e|anti[- ]?aircraft|surface[- ]to[- ]air|\bsam\b"),
    ("anti_ship",    r"anti[- ]?ship|coastal defen[cs]e"),
    ("anti_tank",    r"anti[- ]?tank|anti[- ]?armou?r"),
    ("rotary",       r"helicopter|rotary"),
    ("aircraft",     r"aircraft|air force|fixed[- ]wing|fighter|bomber"),
    ("naval",        r"\bnaval\b|\bnavy\b|\bships?\b|vessels|patrol boat"),
    ("armour",       r"armou?red vehicle|\btanks?\b|\bafv\b|infantry fighting"),
    ("artillery",    r"artillery|\bmortars?\b|rocket|\bmlrs\b|howitzer"),
    ("missiles",     r"missile|ballistic"),
    ("uav",          r"\buav\b|drone|unmanned"),
    ("small_arms",   r"small arms|infantry weapons|firearms"),
    ("vehicles",     r"utility vehicle|logistics vehicle|\btrucks?\b"),
]


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


def _get(url: str, timeout: int = _TIMEOUT):
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def find_page(force: str, timeout: int = _TIMEOUT) -> str | None:
    """The equipment page for a force, or None.

    Searched rather than constructed: the naming is not consistent
    ("List of equipment of the Sudanese Armed Forces" exists, the Malian
    equivalent does not), and a constructed title that 404s is
    indistinguishable from a force with nothing.
    """
    q = urllib.parse.urlencode({
        "action": "query", "list": "search", "format": "json", "srlimit": 5,
        "srsearch": f"List of equipment of the {force}",
    })
    try:
        d = _get(f"{_API}?{q}", timeout)
    except Exception:                                        # noqa: BLE001
        return None
    for hit in d.get("query", {}).get("search", []):
        t = hit.get("title") or ""
        # Only accept a page that is actually an equipment list for THIS
        # force; the search happily returns the Spanish Armed Forces for
        # a Malian query.
        if re.search(r"^list of equipment of", t, re.I) and _same_force(t, force):
            return t
    return None


def _same_force(title: str, force: str) -> bool:
    """Whether a result names the force we asked about.

    Matched on a STEM, not the whole word. Wikipedia titles the Ukrainian
    list "List of equipment of the Armed Forces of Ukraine" — a different
    word order and a different form of the name — so requiring
    "Ukrainian" to appear verbatim rejected the correct page and reported
    a country at war as having no published equipment. Six characters is
    enough to separate "ukrai-" from "urugu-" and short enough to join
    "Ukrainian" to "Ukraine".
    """
    key = re.sub(r"\b(armed|defence|defense|ground|forces?|army|military|of|the)\b",
                 " ", force.lower())
    stems = [w[:6] for w in re.split(r"\W+", key) if len(w) > 3]
    low = title.lower()
    return any(st in low for st in stems) if stems else False


def _wikitext(title: str, timeout: int = _TIMEOUT) -> str:
    q = urllib.parse.urlencode({
        "action": "parse", "page": title, "prop": "wikitext", "format": "json"})
    try:
        d = _get(f"{_API}?{q}", timeout)
    except Exception:                                        # noqa: BLE001
        return ""
    return d.get("parse", {}).get("wikitext", {}).get("*", "") or ""


def sections_of(wikitext: str) -> list:
    return [s.strip() for s in re.findall(r"^==+\s*([^=]+?)\s*==+", wikitext, re.M)]


def capabilities_from(sections: list) -> list:
    """Capability keys implied by a page's section titles."""
    out = []
    for title in sections or []:
        low = title.lower()
        for cap, pat in CAP_PATTERNS:
            if re.search(pat, low):
                # FIRST MATCH WINS, per section. The patterns are ordered
                # most-specific-first for exactly this reason: without
                # the break, "Anti-aircraft weapons" matches air_defence
                # and then aircraft too, handing a defender an offensive
                # air capability it does not have.
                if cap not in out:
                    out.append(cap)
                break
    return out


def lookup(conn: sqlite3.Connection, force: str, *, force_refresh: bool = False,
           timeout: int = _TIMEOUT) -> dict:
    """Capabilities for a force, cached.

    Returns known=False rather than an empty capability list when we
    could not find out, because "we checked and it has no air force" and
    "we never looked" must not render the same.
    """
    ensure_schema(conn)
    key = (force or "").strip()
    if not key:
        return {"known": False, "force": force, "reason": "no force named"}

    if not force_refresh:
        row = conn.execute(
            "SELECT page, caps, sections, fetched_at FROM mil_equipment WHERE force=?",
            (key,)).fetchone()
        if row and time.time() - row[3] < TTL_S:
            caps = json.loads(row[1] or "[]")
            return {"known": bool(caps), "force": key, "page": row[0],
                    "capabilities": caps, "sections": json.loads(row[2] or "[]"),
                    "cached": True}

    page = find_page(key, timeout)
    if not page:
        conn.execute("INSERT OR REPLACE INTO mil_equipment"
                     " (force, page, caps, sections, fetched_at) VALUES (?,?,?,?,?)",
                     (key, None, "[]", "[]", time.time()))
        conn.commit()
        return {"known": False, "force": key,
                "reason": "no equipment list published for this force"}

    secs = sections_of(_wikitext(page, timeout))
    caps = capabilities_from(secs)
    conn.execute("INSERT OR REPLACE INTO mil_equipment"
                 " (force, page, caps, sections, fetched_at) VALUES (?,?,?,?,?)",
                 (key, page, json.dumps(caps), json.dumps(secs), time.time()))
    conn.commit()
    return {"known": bool(caps), "force": key, "page": page,
            "capabilities": caps, "sections": secs, "cached": False}
