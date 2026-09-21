"""Tests for inferred links.

Built on a small synthetic graph rather than the live one, because the
behaviour that matters here is what the scorer REFUSES to say, and that
has to be provable rather than observed.
"""
import sqlite3
import graph_store as gs
import link_predict as lp


def _graph(nodes, edges):
    conn = sqlite3.connect(":memory:")
    gs.ensure_schema(conn)
    gs.upsert_nodes(conn, nodes)
    gs.upsert_edges(conn, edges)
    return conn


def _country(iso, label):
    return {"id": f"country:{iso}", "type": "country", "label": label}


def test_hubs_do_not_count_as_evidence():
    # 500 vessels flagged in one country must not make those vessels
    # "connected" to each other. A shared hub is not a relationship.
    nodes = [_country("PA", "Panama")]
    edges = []
    for i in range(500):
        nodes.append({"id": f"vessel:{i}", "type": "vessel", "label": f"V{i}"})
        edges.append({"src": f"vessel:{i}", "dst": "country:PA",
                      "relation": "flagged in", "conf": 0.9, "method": "reg"})
    conn = _graph(nodes, edges)
    assert lp.predict(conn, "vessel:1") == []


def test_shared_attribute_is_not_a_channel():
    # "flagged in" is a property both nodes have, not a link between
    # them; only channel relations may carry an inference.
    conn = _graph(
        [_country("PA", "Panama"),
         {"id": "vessel:a", "type": "vessel", "label": "A"},
         {"id": "vessel:b", "type": "vessel", "label": "B"}],
        [{"src": "vessel:a", "dst": "country:PA", "relation": "flagged in",
          "conf": 0.9, "method": "reg"},
         {"src": "vessel:b", "dst": "country:PA", "relation": "flagged in",
          "conf": 0.9, "method": "reg"}])
    assert lp.predict(conn, "vessel:a") == []


def test_a_real_shared_owner_does_infer_a_link():
    conn = _graph(
        [{"id": "org:x", "type": "org", "label": "X Shipping"},
         {"id": "vessel:a", "type": "vessel", "label": "A"},
         {"id": "vessel:b", "type": "vessel", "label": "B"},
         {"id": "vessel:c", "type": "vessel", "label": "C"}],
        [{"src": "org:x", "dst": f"vessel:{k}", "relation": "owns",
          "conf": 0.9, "method": "reg"} for k in ("a", "b", "c")])
    got = lp.predict(conn, "vessel:a", min_score=0.0)
    assert {r["dst"] for r in got} == {"vessel:b", "vessel:c"}
    assert all(r["inferred"] for r in got)
    assert all(r["basis"] for r in got), "a prediction must carry its chain"


def test_nothing_inferred_is_ever_allowed_to_look_observed():
    conn = _graph(
        [{"id": "org:x", "type": "org", "label": "X"},
         {"id": "vessel:a", "type": "vessel", "label": "A"},
         {"id": "vessel:b", "type": "vessel", "label": "B"}],
        [{"src": "org:x", "dst": "vessel:a", "relation": "owns",
          "conf": 1.0, "method": "reg"},
         {"src": "org:x", "dst": "vessel:b", "relation": "owns",
          "conf": 1.0, "method": "reg"}])
    for r in lp.predict(conn, "vessel:a", min_score=0.0):
        assert r["conf"] <= lp.MAX_CONF < 0.8


def test_existing_links_are_not_predicted():
    conn = _graph(
        [{"id": "org:x", "type": "org", "label": "X"},
         {"id": "vessel:a", "type": "vessel", "label": "A"},
         {"id": "vessel:b", "type": "vessel", "label": "B"}],
        [{"src": "org:x", "dst": "vessel:a", "relation": "owns",
          "conf": 0.9, "method": "reg"},
         {"src": "org:x", "dst": "vessel:b", "relation": "owns",
          "conf": 0.9, "method": "reg"},
         {"src": "vessel:a", "dst": "vessel:b", "relation": "operates",
          "conf": 0.9, "method": "obs"}])
    assert [r for r in lp.predict(conn, "vessel:a") if r["dst"] == "vessel:b"] == []


def test_specificity_prefers_the_rare_relation():
    # A bilateral agreement should outweigh membership of a bloc that
    # everyone belongs to.
    bloc = [_country(c, c) for c in ("AA", "BB", "CC", "DD", "EE", "FF")]
    edges = [{"src": "country:AA", "dst": f"country:{c}", "relation": "allied with",
              "conf": 0.9, "method": "wikidata_membership:Q1"}
             for c in ("BB", "CC", "DD", "EE", "FF")]
    conn = _graph(bloc, edges)
    wide = lp._specificity(lp._load(conn, 0.5)[0], "country:AA", "allied with")
    edges2 = [{"src": "country:AA", "dst": "country:BB", "relation": "signed agreement with",
               "conf": 0.9, "method": "cameo"}]
    conn2 = _graph(bloc, edges + edges2)
    narrow = lp._specificity(lp._load(conn2, 0.5)[0], "country:AA", "signed agreement with")
    assert narrow > wide


def test_a_chain_of_pure_treaty_membership_is_not_a_finding():
    # Walking NATO into NATO says only "these countries are in one
    # bloc". A route has to contain an observed act.
    nodes = [_country(c, c) for c in ("US", "TR", "PT")] + [
        {"id": "equipment:Stinger", "type": "equipment", "label": "Stinger"}]
    edges = [
        {"src": "equipment:Stinger", "dst": "country:US",
         "relation": "originates in", "conf": 0.9, "method": "curated_gazetteer"},
        {"src": "country:US", "dst": "country:TR", "relation": "allied with",
         "conf": 0.95, "method": "wikidata_membership:Q7184"},
        {"src": "country:TR", "dst": "country:PT", "relation": "allied with",
         "conf": 0.95, "method": "wikidata_membership:Q7184"},
    ]
    conn = _graph(nodes, edges)
    assert lp.chains(conn, min_conf=0.05, min_score=0.0) == []


def test_a_chain_that_crosses_into_observed_behaviour_is_a_finding():
    nodes = [_country(c, c) for c in ("UA", "AE", "SD")] + [
        {"id": "equipment:Magura", "type": "equipment", "label": "Magura"}]
    edges = [
        {"src": "equipment:Magura", "dst": "country:UA",
         "relation": "originates in", "conf": 0.9, "method": "curated_gazetteer"},
        {"src": "country:UA", "dst": "country:AE", "relation": "visited",
         "conf": 0.5, "method": "cameo"},
        {"src": "country:AE", "dst": "country:SD", "relation": "provides aid to",
         "conf": 0.5, "method": "cameo"},
    ]
    conn = _graph(nodes, edges)
    got = lp.chains(conn, min_conf=0.05, min_score=0.0)
    assert got, "the operator's own example must survive every filter"
    assert got[0]["dst"] == "country:SD"
    assert "Magura" in got[0]["chain"] and "SD" in got[0]["chain"]
    assert got[0]["conf"] <= lp.MAX_CONF
    assert got[0]["why_wrong"]


def test_a_route_to_where_the_system_is_already_seen_is_not_news():
    nodes = [_country(c, c) for c in ("UA", "AE", "SD")] + [
        {"id": "equipment:Magura", "type": "equipment", "label": "Magura"}]
    edges = [
        {"src": "equipment:Magura", "dst": "country:UA",
         "relation": "originates in", "conf": 0.9, "method": "curated_gazetteer"},
        {"src": "country:UA", "dst": "country:AE", "relation": "visited",
         "conf": 0.5, "method": "cameo"},
        {"src": "country:AE", "dst": "country:SD", "relation": "provides aid to",
         "conf": 0.5, "method": "cameo"},
        # Already observed there — so it is not a finding.
        {"src": "equipment:Magura", "dst": "country:SD", "relation": "observed in",
         "conf": 0.72, "method": "geoconfirmed_equipment_text"},
    ]
    conn = _graph(nodes, edges)
    assert lp.chains(conn, min_conf=0.05, min_score=0.0) == []
