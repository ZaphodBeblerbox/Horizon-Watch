"""The global ontology view is bounded.

Measured on production before this: 158 nodes and 1,715 links in a 1MB
payload — eleven links per node, which no layout can make readable and
which the browser must draw and re-draw as SVG. Most of those links
rested on a single coded event.
"""
import country_graph as cg


def _link(n, conf=None):
    return {"id": f"l{n}", "s": f"a{n}", "t": f"b{n}", "events": n,
            "conf": conf if conf is not None else min(1.0, n / 20.0)}


def test_a_cap_exists_and_is_sane():
    assert 50 <= cg.GLOBAL_MAX_LINKS <= 1000


def test_it_keeps_the_best_evidenced_and_drops_the_tail():
    kept, total, hidden = cg.cap_links([_link(i) for i in range(1, 60)], 10)
    assert total == 59 and hidden == 49 and len(kept) == 10
    assert sorted((l["events"] for l in kept), reverse=True) == list(range(59, 49, -1))


def test_nothing_is_hidden_when_it_fits():
    kept, total, hidden = cg.cap_links([_link(i) for i in range(1, 5)], 250)
    assert hidden == 0 and total == 4 and len(kept) == 4


def test_it_does_not_reorder_when_it_does_not_have_to():
    # Re-sorting a set that fits would shuffle the diagram for no reason.
    links = [_link(1), _link(9), _link(5)]
    kept, _t, _h = cg.cap_links(links, 250)
    assert [l["events"] for l in kept] == [1, 9, 5]


def test_confidence_breaks_a_tie_on_event_count():
    a = {"id": "a", "events": 3, "conf": 0.2}
    b = {"id": "b", "events": 3, "conf": 0.9}
    kept, _t, _h = cg.cap_links([a, b], 1)
    assert kept[0]["id"] == "b"


def test_missing_fields_do_not_crash_the_sort():
    kept, _t, _h = cg.cap_links([{"id": "x"}, {"id": "y", "events": 5}], 1)
    assert kept[0]["id"] == "y"


def test_empty_and_degenerate_input():
    assert cg.cap_links([], 10) == ([], 0, 0)
    kept, total, hidden = cg.cap_links([_link(1)], 0)
    assert hidden == 0 and len(kept) == 1, "a zero cap must not blank the graph"
