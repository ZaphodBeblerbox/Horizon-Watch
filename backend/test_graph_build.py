"""Country keys, which are where this graph silently came apart.

Keyed as each source happened to hold them, the store grew 431 country
nodes — 242 by ISO2 and 189 by name — with Malta existing as both
country:MT and country:Malta. Nothing errored. The graph just stopped
joining, so a Malta-flagged vessel could never meet a Malta cable
landing, which is the exact second-order connection it exists to make.
"""
import graph_build as gb

CMAP = {"by_name": {"malta": "MT", "united states": "US", "gibraltar": "GI",
                    "germany": "DE", "sudan": "SD"},
        "by_iso2": {"MT": "Malta", "US": "United States", "GI": "Gibraltar",
                    "DE": "Germany", "SD": "Sudan"}}


class TestCanonicalCountry:
    def test_iso2_a_name_and_iso3_all_collapse_to_one_key(self):
        assert gb.canonical_country("MT", CMAP)[0] == "MT"
        assert gb.canonical_country("Malta", CMAP)[0] == "MT"
        # ISO3 is what CAMEO gives us, routed via its name.
        assert gb.canonical_country("USA", CMAP)[0] == "US"
        assert gb.canonical_country("United States", CMAP)[0] == "US"

    def test_case_and_padding_do_not_create_a_second_country(self):
        assert gb.canonical_country("  malta  ", CMAP)[0] == "MT"
        assert gb.canonical_country("mt", CMAP)[0] == "MT"

    def test_it_carries_a_readable_label(self):
        assert gb.canonical_country("MT", CMAP)[1] == "Malta"
        assert gb.canonical_country("Malta", CMAP)[1] == "Malta"

    def test_the_unresolvable_is_dropped_not_invented(self):
        # A node nothing else will ever match is worse than no node: it
        # looks like a connection and can never become one.
        for bad in ("", None, "Zzzland", "   "):
            assert gb.canonical_country(bad, CMAP) == (None, None)

    def test_a_country_node_is_none_when_unresolvable(self):
        assert gb._country_node("Zzzland", CMAP) is None
        node = gb._country_node("Malta", CMAP)
        assert node["id"] == "country:MT" and node["label"] == "Malta"

    def test_the_same_country_from_two_sources_gets_the_same_id(self):
        # The whole point: a vessel flag (ISO2) and a cable landfall
        # (name) must land on one node.
        from_flag = gb._country_node("MT", CMAP)
        from_cable = gb._country_node("Malta", CMAP)
        assert from_flag["id"] == from_cable["id"] == "country:MT"
