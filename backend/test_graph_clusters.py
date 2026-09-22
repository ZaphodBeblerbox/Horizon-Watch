"""The clustered ontology view.

Countries as centroids, membership counted rather than drawn, and the
things that sit BETWEEN countries as their own class.
"""
import sqlite3
import graph_store as gs
import graph_clusters as gc


def _graph(nodes, edges):
    conn = sqlite3.connect(":memory:")
    gs.ensure_schema(conn)
    gs.upsert_nodes(conn, nodes)
    gs.upsert_edges(conn, edges)
    return conn


def _country(iso, label=None):
    return {"id": f"country:{iso}", "type": "country", "label": label or iso}


def _base():
    nodes = [_country("UA", "Ukraine"), _country("RU", "Russia"),
             _country("IR", "Iran"),
             {"id": "vessel:1", "type": "vessel", "label": "V1"},
             {"id": "vessel:2", "type": "vessel", "label": "V2"},
             {"id": "facility:a", "type": "facility", "label": "Airport A"},
             {"id": "equipment:Shahed", "type": "equipment", "label": "Shahed"}]
    edges = [
        {"src": "vessel:1", "dst": "country:UA", "relation": "flagged in",
         "conf": 0.9, "method": "reg"},
        {"src": "vessel:2", "dst": "country:UA", "relation": "flagged in",
         "conf": 0.9, "method": "reg"},
        {"src": "facility:a", "dst": "country:UA", "relation": "located in",
         "conf": 0.98, "method": "airport_registry"},
        # A bridge: originates in one country, observed in another.
        {"src": "equipment:Shahed", "dst": "country:IR",
         "relation": "originates in", "conf": 0.9, "method": "curated_gazetteer"},
        {"src": "equipment:Shahed", "dst": "country:UA",
         "relation": "observed in", "conf": 0.72, "method": "geoconfirmed_equipment_text"},
        # A real country-to-country link.
        {"src": "country:RU", "dst": "country:UA",
         "relation": "uses military force against", "conf": 1.0, "method": "cameo"},
    ]
    return _graph(nodes, edges)


def test_membership_is_counted_by_type_not_drawn():
    # The whole point: Malta has 828 vessels flagged to it and nothing
    # useful happens when you draw 828 plates around one node.
    cl = {c["id"]: c for c in gc.clusters(_base())}
    ua = cl["country:UA"]
    assert ua["counts"]["vessel"] == 2
    assert ua["counts"]["facility"] == 1
    assert ua["total"] == 4      # 2 vessels + 1 facility + 1 equipment observation


def test_every_country_gets_a_plate_even_with_nothing_in_it():
    # A cluster missing because nothing is registered inside it would
    # leave its links pointing at nothing.
    ids = {c["id"] for c in gc.clusters(_base())}
    assert "country:RU" in ids


def test_links_are_country_to_country_only():
    links = gc.cross_links(_base())
    assert len(links) == 1
    assert links[0]["relation"] == "uses military force against"
    # Membership must never appear here — it is the volume that was
    # drowning the diagram.
    assert all(l["relation"] not in gc.MEMBERSHIP for l in links)


def test_a_thing_in_two_countries_is_a_bridge():
    br = {b["id"]: b for b in gc.bridges(_base())}
    assert "equipment:Shahed" in br
    assert br["equipment:Shahed"]["country_count"] == 2
    assert set(br["equipment:Shahed"]["countries"]) == {"country:IR", "country:UA"}


def test_a_thing_in_one_country_is_not_a_bridge():
    # One country is membership; two is a connection.
    br = {b["id"] for b in gc.bridges(_base())}
    assert "vessel:1" not in br
    assert "facility:a" not in br


def test_a_country_is_never_its_own_bridge():
    assert all(b["type"] != "country" for b in gc.bridges(_base()))


def test_bridges_can_be_filtered_by_type():
    # Submarine cables are legitimately the widest bridges in the real
    # graph and unfiltered they push every piece of equipment off the
    # end of the limit.
    assert [b["id"] for b in gc.bridges(_base(), types=("equipment",))] \
        == ["equipment:Shahed"]
    assert gc.bridges(_base(), types=("org",)) == []


def test_bridge_type_counts_match_the_bridges():
    conn = _base()
    counts = gc.bridge_type_counts(conn)
    assert counts == {"equipment": 1}


def test_overview_reports_what_it_is_not_shipping():
    # The payload stays small however large the graph gets, and says so.
    o = gc.overview(_base())
    assert o["available"] is True
    assert o["counts"]["clusters"] == 3
    assert o["counts"]["links"] == 1
    assert o["counts"]["bridges"] == 1
    # 4 in Ukraine (2 vessels, 1 facility, 1 equipment observation) plus
    # Iran's 1 (Shahed originates there) — memberships across all plates.
    assert o["counts"]["members_summarised"] == 5
    assert o["note"]


def test_overview_marks_which_plates_have_connections():
    o = gc.overview(_base())
    by = {c["id"]: c for c in o["clusters"]}
    assert by["country:UA"]["links"] == 1
    assert by["country:IR"]["links"] == 0
    # IR has no country-to-country link but IS reached by a bridge, and
    # a plate that looks isolated when it is not would mislead.
    assert by["country:IR"]["bridged"] is True


def test_inferred_is_derived_never_stored():
    conn = _graph(
        [_country("AA"), _country("BB")],
        [{"src": "country:AA", "dst": "country:BB", "relation": "visited",
          "conf": 0.3, "method": "cameo"}])
    assert gc.cross_links(conn)[0]["inferred"] is True


def test_an_empty_graph_does_not_throw():
    conn = _graph([], [])
    o = gc.overview(conn)
    assert o["clusters"] == [] and o["links"] == [] and o["bridges"] == []
