"""
relations.py - typed, directed relations between actors, and the chains
they form.

WHY THIS EXISTS. The ontology could say "located in" and "reported in"
and almost nothing else, so it could not express the thing the product
is for:

    Ukraine visited UAE - UAE supplies a party to the Sudan war -
    therefore Ukrainian materiel may be reaching Sudan

Every link in that chain was already in the system and was being thrown
away. GDELT codes each event with CAMEO, which is a taxonomy of VERBS
between actors: 042 is "make a visit", 062 is "cooperate militarily",
072 is "provide military aid", 163 is "impose an embargo", 190 is
"use conventional military force". We ingest event_code and
event_root_code faithfully - and then the graph builder reduced every
event to an undirected country pair with an averaged Goldstein score.
The relation type, the direction and the date were all discarded at the
last step.

WHAT THIS DOES NOT DO. It does not assert the conclusion. A chain of
real relations is a HYPOTHESIS with a stated path, an evidence count
and a recency; it is the beginning of an analyst's work, not the end of
it. The distinction is enforced in the return shape: findings carry
`inferred: True`, the chain that produced them, and the events behind
each hop, so a reader can disagree with the reasoning rather than
having to trust it.
"""
from __future__ import annotations

import datetime as _dt
from collections import defaultdict

#: CAMEO specific codes worth naming exactly. Keys are matched on the
#: longest prefix, so "0721" falls to "072".
#:
#: Only relations that carry material or political meaning are named. A
#: public statement between two countries is not a relationship, and
#: naming it as one is how a graph fills with noise.
CAMEO_RELATION = {
    "042": ("visited", "diplomatic"),
    "043": ("hosted_visit_from", "diplomatic"),
    "046": ("negotiating_with", "diplomatic"),
    "057": ("signed_agreement_with", "diplomatic"),
    "061": ("economic_cooperation_with", "material"),
    "062": ("military_cooperation_with", "military"),
    "064": ("shares_intelligence_with", "military"),
    "071": ("provides_economic_aid_to", "material"),
    "072": ("provides_military_aid_to", "military"),
    "073": ("provides_humanitarian_aid_to", "material"),
    "074": ("provides_military_protection_to", "military"),
    "1056": ("demands_withdrawal_from", "hostile"),
    "128": ("refuses_to_negotiate_with", "hostile"),
    "130": ("threatens", "hostile"),
    "138": ("threatens_force_against", "hostile"),
    "163": ("imposes_embargo_on", "hostile"),
    "173": ("arrests_detains_for", "hostile"),
    "175": ("uses_repression_against", "hostile"),
    "180": ("assaults", "hostile"),
    "190": ("uses_military_force_against", "hostile"),
    "193": ("fights_with_ground_forces", "hostile"),
    "195": ("uses_air_or_missile_force_against", "hostile"),
    "200": ("mass_violence_against", "hostile"),
}

#: Root codes, as a fallback when the specific code says less.
ROOT_RELATION = {
    "03": ("intends_to_cooperate_with", "diplomatic"),
    "04": ("consulting_with", "diplomatic"),
    "05": ("diplomatic_cooperation_with", "diplomatic"),
    "06": ("material_cooperation_with", "material"),
    "07": ("provides_aid_to", "material"),
    "13": ("threatens", "hostile"),
    "16": ("reducing_relations_with", "hostile"),
    "17": ("coerces", "hostile"),
    "18": ("assaults", "hostile"),
    "19": ("uses_military_force_against", "hostile"),
    "20": ("mass_violence_against", "hostile"),
}

#: Relations that can plausibly move materiel. The chain inference below
#: only follows these, because "issued a statement about" does not
#: transfer a drone.
SUPPLY_RELATIONS = {
    "provides_military_aid_to", "military_cooperation_with",
    "provides_military_protection_to", "shares_intelligence_with",
    "provides_aid_to", "material_cooperation_with",
}

#: Relations that indicate the two actors are working together closely
#: enough for the first to be a plausible origin for the second's supply.
ALIGNMENT_RELATIONS = {
    "visited", "hosted_visit_from", "signed_agreement_with",
    "military_cooperation_with", "economic_cooperation_with",
    "shares_intelligence_with", "diplomatic_cooperation_with",
    "intends_to_cooperate_with", "negotiating_with",
}


def relation_of(event_code: str | None, root_code: str | None) -> tuple | None:
    """The relation an event asserts, or None if it asserts none.

    Longest-prefix on the specific code first, because 0721 ("provide
    military aid, materiel") is more useful than 07 ("provide aid").
    """
    code = (str(event_code or "")).strip()
    for n in (4, 3):
        if len(code) >= n and code[:n] in CAMEO_RELATION:
            return CAMEO_RELATION[code[:n]]
    if code[:3] in CAMEO_RELATION:
        return CAMEO_RELATION[code[:3]]
    root = (str(root_code or "")).strip().zfill(2)
    return ROOT_RELATION.get(root)


def _iso_date(value) -> str | None:
    s = str(value or "").strip()
    if len(s) == 8 and s.isdigit():                 # GDELT's YYYYMMDD
        return f"{s[:4]}-{s[4:6]}-{s[6:]}"
    return s[:10] or None


def build(events: list, *, level: str = "country") -> dict:
    """Typed directed edges between actors, aggregated.

    `level` is "country" for the inter-state graph, or "actor" to keep
    the named actors (which include non-state groups).
    """
    edges: dict = defaultdict(lambda: {
        "count": 0, "first_seen": None, "last_seen": None,
        "goldstein_sum": 0.0, "goldstein_n": 0, "examples": [],
    })

    for e in events or []:
        rel = relation_of(e.get("event_code"), e.get("event_root_code"))
        if not rel:
            continue
        name, family = rel
        if level == "country":
            a = (e.get("actor1_country") or "").strip() or None
            b = (e.get("actor2_country") or "").strip() or None
        else:
            a = (e.get("actor1") or "").strip() or None
            b = (e.get("actor2") or "").strip() or None
        # A relation needs two ends and a direction; self-edges are the
        # coder describing a country's internal affairs, not a link.
        if not a or not b or a == b:
            continue

        key = (a, b, name)
        rec = edges[key]
        rec["count"] += 1
        rec["family"] = family
        d = _iso_date(e.get("date"))
        if d:
            rec["first_seen"] = min(rec["first_seen"] or d, d)
            rec["last_seen"] = max(rec["last_seen"] or d, d)
        try:
            rec["goldstein_sum"] += float(e.get("goldstein"))
            rec["goldstein_n"] += 1
        except (TypeError, ValueError):
            pass
        if len(rec["examples"]) < 3 and e.get("source_url"):
            rec["examples"].append({"date": d, "url": e.get("source_url"),
                                     "actor1": e.get("actor1"), "actor2": e.get("actor2")})

    out = []
    for (a, b, name), rec in edges.items():
        out.append({
            "source": a, "target": b, "relation": name,
            "family": rec.get("family"),
            "events": rec["count"],
            "first_seen": rec["first_seen"], "last_seen": rec["last_seen"],
            "mean_goldstein": (round(rec["goldstein_sum"] / rec["goldstein_n"], 2)
                               if rec["goldstein_n"] else None),
            "examples": rec["examples"],
        })
    out.sort(key=lambda r: -r["events"])
    return {"level": level, "edges": out, "count": len(out)}


def _recency_days(iso: str | None, today: _dt.date | None = None) -> int | None:
    if not iso:
        return None
    try:
        d = _dt.date.fromisoformat(iso[:10])
    except ValueError:
        return None
    return (today or _dt.date.today() - _dt.timedelta(0)).toordinal() - d.toordinal()


def supply_chains(edges: list, *, min_events: int = 2, max_age_days: int = 120,
                  today: _dt.date | None = None) -> list:
    """Two-hop chains of the form ALIGNED-WITH then SUPPLIES.

    The shape of the question this exists for: A is working closely with
    B, B is materially supporting C, so A's materiel may be reaching C.
    That is a hypothesis about a pathway, and it is returned as one.

    Both hops must be recent and evidenced more than once, because a
    single coded event is one wire story and a chain of two of them is
    not an argument.
    """
    by_source: dict = defaultdict(list)
    for e in edges:
        by_source[e["source"]].append(e)

    found = []
    for first in edges:
        if first["relation"] not in ALIGNMENT_RELATIONS:
            continue
        if first["events"] < min_events:
            continue
        age1 = _recency_days(first["last_seen"], today)
        if age1 is None or age1 > max_age_days:
            continue
        for second in by_source.get(first["target"], ()):
            if second["relation"] not in SUPPLY_RELATIONS:
                continue
            if second["events"] < min_events:
                continue
            if second["target"] == first["source"]:
                continue                     # A -> B -> A says nothing
            age2 = _recency_days(second["last_seen"], today)
            if age2 is None or age2 > max_age_days:
                continue

            # Confidence from evidence volume and recency, capped low on
            # purpose: this is a lead, and a number near 1.0 would invite
            # somebody to brief it as established.
            volume = min(1.0, (first["events"] + second["events"]) / 40.0)
            fresh = max(0.0, 1.0 - (max(age1, age2) / max_age_days))
            confidence = round(0.15 + 0.45 * volume + 0.20 * fresh, 2)

            found.append({
                "inferred": True,
                "kind": "possible_materiel_pathway",
                "origin": first["source"],
                "via": first["target"],
                "destination": second["target"],
                "statement": (f"{first['source']} {first['relation'].replace('_', ' ')} "
                              f"{first['target']}, which {second['relation'].replace('_', ' ')} "
                              f"{second['target']} — materiel or support originating in "
                              f"{first['source']} may be reaching {second['target']}."),
                "confidence": min(0.8, confidence),
                "chain": [
                    {"source": first["source"], "relation": first["relation"],
                     "target": first["target"], "events": first["events"],
                     "last_seen": first["last_seen"], "examples": first["examples"]},
                    {"source": second["source"], "relation": second["relation"],
                     "target": second["target"], "events": second["events"],
                     "last_seen": second["last_seen"], "examples": second["examples"]},
                ],
                "caveat": ("A chain of coded relations is a lead, not a finding. Each hop "
                           "is an aggregate of news-coded events, not a confirmed transfer."),
            })

    found.sort(key=lambda h: -h["confidence"])
    return found
