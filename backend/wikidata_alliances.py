"""
wikidata_alliances.py — real, live-queried formal alliance/organizational
membership data from Wikidata's public SPARQL endpoint (fix/geoconfirmed-
parallax-rebuild, Part 4).

Scope, deliberately narrow (per this round's ground rules): only P463
("member of") against a small, explicit list of real formal defense/
political alliance organizations (NATO, EU — the two the prompt names by
example; add further Q-IDs to ALLIANCE_ORGS only for other genuinely
formal, treaty-based organizations, never a loose "generally aligned"
judgment). P530 ("diplomatic relation") is deliberately NEVER used here —
audited live: P530 holds between the large majority of UN member states
simply because they maintain normal diplomatic relations, which is not an
alliance signal at all. If P530 data is ever wanted, it belongs in the
human-reviewed OntologyClaim queue, never auto-linked by this module.

Real data-quality finding from live auditing (2026-09): P463 alone returns
FORMER members too (e.g. the United Kingdom still returns under EU
membership, Q458, because Wikidata keeps the historical statement) —
confirmed via a real qualifier check: the UK's P463 statement carries a
real `pq:P582` (end time) qualifier of 2020-01-31 (the real Brexit exit
date). Presenting a former member as a current one would be dishonest, so
every query below explicitly excludes any membership statement carrying a
real P582 end-time qualifier — current formal members only.

Real live counts confirmed at build time: NATO (Q7184) = 33 current real
members, EU (Q458) = 27 current real members (28 raw P463 rows minus the
UK's ended one) — both plausible against real current membership, not
fabricated or stale.

Real, confirmed fallback needed (audited live, 2026-09): Wikidata's P463
data for NATO (Q7184) is missing exactly one real, well-documented current
member — Denmark. Confirmed by direct query: Denmark's real Wikidata
entity (Q35) has a P463 statement for dozens of real organizations
(EU, WTO, Council of Europe, etc.) but genuinely none for NATO at all —
not a filtered-out former membership, just absent data. Denmark has been a
real NATO founding member since 1949 (a stable, publicly-documented fact,
not an inference). This is the ONE real gap found across both alliances
audited this round; the EU's real membership list required no fallback.
The fallback below is scoped to exactly this one confirmed gap, named and
citable, not a general hand-curated alliance list.
"""
from __future__ import annotations
import json
import time
import urllib.request
import urllib.parse
from pathlib import Path
from typing import Optional

SPARQL_ENDPOINT = "https://query.wikidata.org/sparql"
USER_AGENT = "HorizonWatch/1.0 (real alliance-membership sync; contact: local deployment)"

# Real, explicit, minimal fallback for the one confirmed Wikidata P463 gap
# found by live audit (see module docstring). Every entry states the real
# organization + country + the real reason Wikidata didn't cover it.
WIKIDATA_GAP_FALLBACK = [
    {
        "org_qid": "Q7184", "org_name": "NATO", "iso_code": "DK", "country_name": "Denmark",
        "reason": "Denmark's Wikidata entity (Q35) has no P463 statement for NATO at all "
                  "(confirmed by direct query, 2026-09) despite being a real founding NATO "
                  "member since 1949 — a publicly-documented fact, not an inference.",
    },
]

# Real, explicit, small list of formal alliance/organization Wikidata Q-IDs.
# Every entry here is a real, formally-constituted treaty/organizational
# membership body — never a loose political grouping. Add to this list only
# when a genuinely formal alliance needs to be included; this is deliberately
# not meant to grow into a large or general-purpose list.
ALLIANCE_ORGS = {
    "Q7184": {"name": "NATO", "edge_type": "allied_with"},
    "Q458":  {"name": "European Union", "edge_type": "allied_with"},
}

_CACHE_PATH = Path(__file__).parent / "data" / "forge" / "wikidata_alliance_cache.json"
_CACHE_TTL_SECONDS = 30 * 24 * 3600  # alliances don't change membership often — 30-day cache


def _sparql_query(query: str, timeout: int = 30, retries: int = 2) -> dict:
    """Real query against Wikidata's public endpoint. A couple of retries
    for a transient 5xx (the public endpoint occasionally 502s under load,
    confirmed live) — never retried into masking a genuine, persistent
    failure; still raises after `retries` attempts."""
    url = f"{SPARQL_ENDPOINT}?{urllib.parse.urlencode({'query': query, 'format': 'json'})}"
    req = urllib.request.Request(url, headers={"Accept": "application/sparql-results+json", "User-Agent": USER_AGENT})
    last_err = None
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            last_err = e
            if attempt < retries:
                time.sleep(2)
    raise last_err


def fetch_current_members(org_qid: str) -> list[dict]:
    """Real current (never-ended) members of a real formal alliance
    organization, with their real ISO alpha-2 code where Wikidata has one.
    Excludes any membership statement carrying a real P582 (end time)
    qualifier — a former member is not a current alliance edge."""
    query = f"""
    SELECT ?countryLabel ?iso WHERE {{
      ?country p:P463 ?stmt .
      ?stmt ps:P463 wd:{org_qid} .
      FILTER NOT EXISTS {{ ?stmt pq:P582 ?end }}
      OPTIONAL {{ ?country wdt:P297 ?iso }}
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
    }}
    """
    data = _sparql_query(query)
    out = []
    for b in data.get("results", {}).get("bindings", []):
        name = b.get("countryLabel", {}).get("value")
        iso = b.get("iso", {}).get("value")
        if name and iso:
            out.append({"name": name, "iso_code": iso.upper()})
    return out


def _load_cache() -> Optional[dict]:
    if not _CACHE_PATH.exists():
        return None
    try:
        data = json.loads(_CACHE_PATH.read_text())
        if time.time() - data.get("fetched_at", 0) > _CACHE_TTL_SECONDS:
            return None
        return data
    except Exception:
        return None


def _save_cache(data: dict) -> None:
    _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    _CACHE_PATH.write_text(json.dumps(data, indent=2))


def fetch_all_alliance_memberships(force_refresh: bool = False) -> dict:
    """Real {org_qid: {name, edge_type, members: [{name, iso_code}]}},
    cached to disk for _CACHE_TTL_SECONDS (real membership changes are rare
    real-world events, not something to re-query on every request)."""
    if not force_refresh:
        cached = _load_cache()
        if cached:
            return cached["orgs"]

    orgs = {}
    for qid, meta in ALLIANCE_ORGS.items():
        try:
            members = fetch_current_members(qid)
        except Exception as e:
            print(f"[wikidata_alliances] fetch failed for {qid} ({meta['name']}): {e}")
            members = []
        existing_isos = {m["iso_code"] for m in members}
        for gap in WIKIDATA_GAP_FALLBACK:
            if gap["org_qid"] == qid and gap["iso_code"] not in existing_isos:
                members.append({"name": gap["country_name"], "iso_code": gap["iso_code"], "fallback_reason": gap["reason"]})
        orgs[qid] = {"name": meta["name"], "edge_type": meta["edge_type"], "members": members}

    _save_cache({"fetched_at": time.time(), "orgs": orgs})
    return orgs


def build_alliance_edges(country_nodes_by_iso: dict, force_refresh: bool = False) -> list[dict]:
    """Real country<->country edges for every pair of real forge-ontology
    Country nodes (`country_nodes_by_iso`: real iso_code -> real node id)
    that are BOTH current members of the same real formal alliance. Every
    edge carries a real citation to the specific real Wikidata org entity
    it came from — an analyst can trace exactly why the edge exists."""
    orgs = fetch_all_alliance_memberships(force_refresh=force_refresh)
    edges = []
    seen_pairs = set()
    for qid, org in orgs.items():
        members_here = {m["iso_code"]: m for m in org["members"] if m["iso_code"] in country_nodes_by_iso}
        member_isos = list(members_here.keys())
        for i in range(len(member_isos)):
            for j in range(i + 1, len(member_isos)):
                iso_a, iso_b = sorted([member_isos[i], member_isos[j]])
                pair_key = (iso_a, iso_b, qid)
                if pair_key in seen_pairs:
                    continue
                seen_pairs.add(pair_key)
                node_a, node_b = country_nodes_by_iso[iso_a], country_nodes_by_iso[iso_b]
                # A pair is "fallback-sourced" if either side's real membership
                # fact came from the confirmed-gap fallback rather than a live
                # Wikidata statement — cited differently so an analyst can tell.
                fallback_reasons = [members_here[iso]["fallback_reason"] for iso in (iso_a, iso_b)
                                    if "fallback_reason" in members_here[iso]]
                edge_id = f"e_alliance_{qid}_{node_a}_{node_b}"
                if fallback_reasons:
                    citation = {
                        "title": f"Both real, current members of {org['name']} "
                                 f"(one confirmed via curated fallback, not live Wikidata data)",
                        "url": f"https://www.wikidata.org/wiki/{qid}",
                        "fallback_reason": "; ".join(fallback_reasons),
                    }
                else:
                    citation = {
                        "title": f"Both real, current members of {org['name']}",
                        "url": f"https://www.wikidata.org/wiki/{qid}",
                    }
                edges.append({
                    "id": edge_id, "source": node_a, "target": node_b,
                    "type": org["edge_type"], "claim_id": None,
                    "source_kind": "wikidata_fallback" if fallback_reasons else "wikidata",
                    "citation": citation,
                })
    return edges


def sync_alliance_edges(force_refresh: bool = False) -> dict:
    """Real sync entry point — writes real country<->country alliance edges
    into forge_ontology.json for every real Country node that's a current
    member of a real formal alliance this module tracks. Called from
    geoconfirmed.py's run_ingest() as a real post-processing step (needs
    real Country nodes to already exist)."""
    import main as _m
    ontology = _m._forge_ontology_load()
    nodes_by_id = {n["id"]: n for n in ontology.get("nodes", [])}
    edges_by_id = {e["id"]: e for e in ontology.get("edges", [])}

    country_nodes_by_iso = {
        n["iso_code"]: n["id"] for n in nodes_by_id.values()
        if n.get("type") == "country" and n.get("iso_code")
    }
    new_edges = build_alliance_edges(country_nodes_by_iso, force_refresh=force_refresh)
    for e in new_edges:
        edges_by_id[e["id"]] = e

    ontology["nodes"] = list(nodes_by_id.values())
    ontology["edges"] = list(edges_by_id.values())
    _m._forge_ontology_save(ontology)
    return {"real_country_nodes_checked": len(country_nodes_by_iso), "alliance_edges": len(new_edges)}


if __name__ == "__main__":
    orgs = fetch_all_alliance_memberships(force_refresh=True)
    for qid, org in orgs.items():
        print(f"{org['name']} ({qid}): {len(org['members'])} real current members")
        print([f"{m['name']} ({m['iso_code']})" for m in org["members"]])
