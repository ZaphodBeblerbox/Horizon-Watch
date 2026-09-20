"""
test_country_graph.py — one graph per country, and the links in it.

The Ontology page looked empty because it was showing the Forge store
curated to ~160 nodes while ontology_entities held 50,686. One graph for
the world cannot be both complete and legible; scoped to a country it can.

    cd backend && python3 -m pytest test_country_graph.py -q
"""
import country_graph as cg


def node(nid, typ, lat=None, lon=None, label=None):
    return cg._node(nid, typ, label or nid, lat=lat, lon=lon)


# ── proximity is a real relationship ──────────────────────────────────────

def test_an_event_links_to_what_is_near_it():
    """THE LINK THIS SYSTEM WAS MISSING: "a news point is more important
    if it happened next to a military base"."""
    ev = node("ev1", "event", 31.50, 34.47)
    base = node("f1", "facility", 31.501, 34.471)
    links = cg.proximity_links([ev], [base], radius_km=2.0)
    assert len(links) == 1
    assert links[0]["s"] == "ev1" and links[0]["t"] == "f1"
    assert links[0]["distance_km"] < 0.2


def test_something_far_away_is_not_linked():
    ev = node("ev1", "event", 31.50, 34.47)
    far = node("f1", "facility", 32.90, 35.90)
    assert cg.proximity_links([ev], [far], radius_km=2.0) == []


def test_the_distance_rides_on_the_edge():
    """So a reader judges the coincidence rather than being told it
    matters — 40 metres and 1.9km are not the same claim."""
    ev = node("ev1", "event", 31.50, 34.47)
    near = node("f1", "facility", 31.5005, 34.4705)
    l = cg.proximity_links([ev], [near], radius_km=2.0)[0]
    assert "km" in l["label"]
    assert l["distance_km"] == round(l["distance_km"], 2)


def test_closer_is_more_confident():
    ev = node("ev1", "event", 31.50, 34.47)
    close = cg.proximity_links([ev], [node("a", "facility", 31.5005, 34.4705)], 2.0)[0]
    edge = cg.proximity_links([ev], [node("b", "facility", 31.5165, 34.4705)], 2.0)[0]
    assert close["conf"] > edge["conf"]


def test_proximity_never_claims_causation():
    """An edge on a graph is easily read as an assertion. This one says
    what it is."""
    l = cg.proximity_links([node("ev1", "event", 1.0, 1.0)],
                           [node("f1", "facility", 1.0, 1.0)], 2.0)[0]
    assert "not attribution" in l["note"]


def test_an_event_with_no_coordinates_links_to_nothing():
    ev = node("ev1", "event")
    assert cg.proximity_links([ev], [node("f1", "facility", 1.0, 1.0)], 2.0) == []


# ── factions are named, never inferred from geography ─────────────────────

def test_a_faction_links_only_when_the_report_names_it():
    """An event inside a faction's territory is not thereby that
    faction's doing. Inferring it from where it happened would
    manufacture attributions this system has no basis for."""
    houthi = node("fac1", "faction", label="Houthi (Ansar Allah)")
    named = node("ev1", "event", 15.0, 44.0, label="Houthi forces take Mokha")
    silent = node("ev2", "event", 15.0, 44.0, label="Explosion reported in Mokha")
    links = cg.faction_links([named, silent], [houthi])
    assert [l["s"] for l in links] == ["ev1"]


def test_the_faction_match_uses_the_distinctive_part_of_the_name():
    """"Houthi (Ansar Allah)" must match on Houthi without also matching
    every mention of Allah."""
    f = node("fac1", "faction", label="Houthi (Ansar Allah)")
    ev = node("ev1", "event", 15.0, 44.0, label="Allah is mentioned here")
    assert cg.faction_links([ev], [f]) == []


# ── the shape the renderer actually reads ─────────────────────────────────

def test_nodes_carry_a_tier_and_a_risk():
    """The page indexes a four-element array by node.tier. A node with
    none indexed it at undefined and the page threw on load."""
    for typ in ("country", "faction", "facility", "event", "airport"):
        n = cg._node("x", typ, "x")
        assert n["tier"] in (0, 1, 2, 3), typ
        assert isinstance(n["risk"], int)


def test_links_use_the_renderers_vocabulary():
    """The renderer reads l.s and l.t, not source/target."""
    l = cg.proximity_links([node("ev1", "event", 1.0, 1.0)],
                           [node("f1", "facility", 1.0, 1.0)], 2.0)[0]
    assert "s" in l and "t" in l
    assert "source" not in l and "target" not in l


def test_the_four_tiers_are_distinct_so_the_layout_has_bands():
    tiers = {cg.TIER[t] for t in ("country", "faction", "facility", "event")}
    assert tiers == {0, 1, 2, 3}


# ── what the graph refuses to include ─────────────────────────────────────

def test_an_unknown_country_is_refused_with_a_reason():
    g = cg.build("ZZZ")
    assert g["available"] is False
    assert "extent" in g["error"]


def test_haversine_is_right_about_a_known_distance():
    """Gaza City to Khan Yunis is about 22km."""
    d = cg.haversine_km(31.5017, 34.4668, 31.3444, 34.3063)
    assert 20 < d < 26
