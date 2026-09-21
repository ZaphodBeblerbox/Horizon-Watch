"""The canonical graph: one shape, and traversal that crosses sources.

The point of this store is that a second hop can cross from a vessel to
its flag state to that state's relations, because all three are rows in
the same two tables. These tests are mostly about that crossing, and
about refusing edges that could not be drawn honestly.
"""
import sqlite3

import graph_store as gs


def _conn():
    c = sqlite3.connect(":memory:")
    gs.ensure_schema(c)
    return c


def _n(nid, t, label=None):
    return {"id": nid, "type": t, "label": label or nid}


def _e(src, dst, rel, conf=0.9, method="test", basis="because"):
    return {"src": src, "dst": dst, "relation": rel, "conf": conf,
            "method": method, "basis": basis}


class TestEdgeDiscipline:
    def test_an_edge_without_a_method_is_refused(self):
        # An edge with no stated provenance cannot be drawn differently
        # from a certain one, and the product depends on that difference.
        c = _conn()
        assert gs.upsert_edges(c, [{"src": "a:1", "dst": "b:1",
                                    "relation": "x", "conf": 0.9}]) == 0

    def test_an_edge_without_a_confidence_is_refused(self):
        c = _conn()
        assert gs.upsert_edges(c, [{"src": "a:1", "dst": "b:1", "relation": "x",
                                    "method": "m"}]) == 0

    def test_self_edges_are_refused(self):
        c = _conn()
        assert gs.upsert_edges(c, [_e("country:UKR", "country:UKR", "visited")]) == 0

    def test_rewriting_the_same_fact_does_not_duplicate_it(self):
        c = _conn()
        gs.upsert_edges(c, [_e("vessel:1", "country:MT", "flagged in")])
        gs.upsert_edges(c, [_e("vessel:1", "country:MT", "flagged in")])
        assert c.execute("SELECT COUNT(*) FROM graph_edges").fetchone()[0] == 1

    def test_the_same_pair_by_two_methods_stays_two_edges(self):
        # An exact identifier match and a fuzzy name match are not the
        # same claim, and collapsing them would hide that one is weak.
        c = _conn()
        gs.upsert_edges(c, [_e("vessel:1", "org:x", "sanctioned by",
                               conf=0.98, method="resolution_mmsi"),
                            _e("vessel:1", "org:x", "sanctioned by",
                               conf=0.55, method="resolution_name_fuzzy")])
        assert c.execute("SELECT COUNT(*) FROM graph_edges").fetchone()[0] == 2

    def test_an_unknown_node_type_is_refused(self):
        # The spec fixes the ontology's node types; a stray one would
        # land in a tier the diagram has no band for.
        c = _conn()
        assert gs.upsert_nodes(c, [_n("spaceship:1", "spaceship")]) == 0


class TestNeighbourhood:
    def _fixture(self):
        c = _conn()
        gs.upsert_nodes(c, [_n("vessel:256843000", "vessel", "ARGO I"),
                            _n("org:ofac-1", "org", "ARGO I (listed)"),
                            _n("country:MT", "country", "Malta"),
                            _n("country:RU", "country", "Russia"),
                            _n("vessel:999", "vessel", "OTHER SHIP")])
        gs.upsert_edges(c, [
            _e("vessel:256843000", "org:ofac-1", "sanctioned by", 0.98),
            _e("vessel:256843000", "country:MT", "flagged in", 0.9),
            _e("vessel:999", "country:MT", "flagged in", 0.9),
            _e("country:MT", "country:RU", "economic cooperation with", 0.4),
        ])
        return c

    def test_one_hop_returns_only_direct_links(self):
        d = gs.neighbourhood(self._fixture(), "vessel:256843000", hops=1)
        assert {l["relation"] for l in d["links"]} == {"sanctioned by", "flagged in"}

    def test_two_hops_reaches_the_links_of_the_links(self):
        # The thing the old feed could not do at all.
        d = gs.neighbourhood(self._fixture(), "vessel:256843000", hops=2)
        ids = {n["id"] for n in d["nodes"]}
        assert "country:RU" in ids, "second hop did not cross from Malta"
        assert "vessel:999" in ids, "did not reach the other Malta-flagged vessel"

    def test_traversal_crosses_between_sources(self):
        # vessel (AIS) -> country (MMSI allocation) -> country (CAMEO).
        d = gs.neighbourhood(self._fixture(), "vessel:256843000", hops=2)
        rels = {l["relation"] for l in d["links"]}
        assert {"flagged in", "economic cooperation with"} <= rels

    def test_the_confidence_floor_filters(self):
        d = gs.neighbourhood(self._fixture(), "vessel:256843000", hops=2, min_conf=0.8)
        assert all(l["conf"] >= 0.8 for l in d["links"])
        assert "country:RU" not in {n["id"] for n in d["nodes"]}

    def test_inferred_is_derived_from_the_confidence(self):
        # Spec §6.6: inferred is conf < 0.8, not a stored flag.
        d = gs.neighbourhood(self._fixture(), "vessel:256843000", hops=2)
        for l in d["links"]:
            assert l["inferred"] is (l["conf"] < 0.8)

    def test_an_unknown_root_returns_empty_rather_than_failing(self):
        d = gs.neighbourhood(self._fixture(), "vessel:nope", hops=2)
        assert d["links"] == []

    def test_an_edge_endpoint_with_no_node_row_still_appears(self):
        # Dropping the edge would be worse than an unlabelled node.
        c = _conn()
        gs.upsert_edges(c, [_e("vessel:1", "org:ghost", "sanctioned by")])
        d = gs.neighbourhood(c, "vessel:1", hops=1)
        assert "org:ghost" in {n["id"] for n in d["nodes"]}
        assert len(d["links"]) == 1


class TestStats:
    def test_separates_asserted_from_inferred(self):
        c = _conn()
        gs.upsert_edges(c, [_e("a:1", "b:1", "x", conf=0.95),
                            _e("a:1", "c:1", "y", conf=0.3)])
        s = gs.stats(c)
        assert s["asserted"] == 1 and s["inferred"] == 1
