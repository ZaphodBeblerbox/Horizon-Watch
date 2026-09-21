"""Typed relations, and the chains they form.

The chain inference is the part that can do real damage: a two-hop path
presented as a fact is how an analyst briefs something that never
happened. These pin both the extraction and the restraint.
"""
import datetime as dt

import relations as R


class TestRelationOf:
    def test_names_the_cameo_verbs_that_matter(self):
        assert R.relation_of("042", "04")[0] == "visited"
        assert R.relation_of("072", "07")[0] == "provides_military_aid_to"
        assert R.relation_of("062", "06")[0] == "military_cooperation_with"
        assert R.relation_of("163", "16")[0] == "imposes_embargo_on"
        assert R.relation_of("190", "19")[0] == "uses_military_force_against"

    def test_prefers_the_specific_code_over_the_root(self):
        # 0721 is "provide military aid, materiel" — more useful than 07.
        assert R.relation_of("0721", "07")[0] == "provides_military_aid_to"

    def test_falls_back_to_the_root_when_the_specific_code_is_unmapped(self):
        assert R.relation_of("199", "19")[0] == "uses_military_force_against"

    def test_a_public_statement_is_not_a_relationship(self):
        # CAMEO 01/02 are statements and appeals. Naming those as edges
        # is how a graph fills up with noise and connects nothing.
        assert R.relation_of("010", "01") is None
        assert R.relation_of("020", "02") is None
        assert R.relation_of(None, None) is None


def _ev(a, b, code, root, date, gold=1.0, url="http://x"):
    return {"actor1_country": a, "actor2_country": b, "actor1": a, "actor2": b,
            "event_code": code, "event_root_code": root, "date": date,
            "goldstein": gold, "source_url": url}


class TestBuild:
    def test_aggregates_direction_relation_and_dates(self):
        evs = [_ev("UKR", "ARE", "042", "04", "20260901"),
               _ev("UKR", "ARE", "042", "04", "20260905")]
        g = R.build(evs)
        assert g["count"] == 1
        e = g["edges"][0]
        assert (e["source"], e["target"], e["relation"]) == ("UKR", "ARE", "visited")
        assert e["events"] == 2
        assert e["first_seen"] == "2026-09-01" and e["last_seen"] == "2026-09-05"

    def test_direction_is_kept(self):
        # A supplies B is not B supplies A, and the old country-pair
        # graph could not tell them apart.
        g = R.build([_ev("ARE", "SDN", "072", "07", "20260910")])
        e = g["edges"][0]
        assert e["source"] == "ARE" and e["target"] == "SDN"

    def test_drops_self_edges(self):
        assert R.build([_ev("SDN", "SDN", "190", "19", "20260901")])["count"] == 0

    def test_drops_events_with_only_one_actor(self):
        assert R.build([_ev("UKR", None, "042", "04", "20260901")])["count"] == 0


class TestSupplyChains:
    """The example the product exists for, end to end."""

    def _edges(self, today):
        d1 = (today - dt.timedelta(days=5)).strftime("%Y%m%d")
        d2 = (today - dt.timedelta(days=12)).strftime("%Y%m%d")
        evs = [_ev("UKR", "ARE", "042", "04", d1) for _ in range(6)]
        evs += [_ev("ARE", "SDN", "072", "07", d2) for _ in range(8)]
        return R.build(evs)["edges"]

    def test_finds_the_ukraine_uae_sudan_shape(self):
        today = dt.date(2026, 9, 21)
        chains = R.supply_chains(self._edges(today), today=today)
        assert chains, "expected a two-hop pathway"
        c = chains[0]
        assert (c["origin"], c["via"], c["destination"]) == ("UKR", "ARE", "SDN")
        assert len(c["chain"]) == 2
        assert c["chain"][0]["relation"] == "visited"
        assert c["chain"][1]["relation"] == "provides_military_aid_to"

    def test_is_labelled_as_inference_and_capped(self):
        # A number near 1.0 invites somebody to brief a lead as fact.
        today = dt.date(2026, 9, 21)
        c = R.supply_chains(self._edges(today), today=today)[0]
        assert c["inferred"] is True
        assert c["confidence"] <= 0.8
        assert "not a finding" in c["caveat"]
        assert c["statement"].startswith("UKR visited ARE")

    def test_will_not_chain_through_a_statement(self):
        # Talking to someone does not move a drone: the second hop must
        # be a supply relation.
        today = dt.date(2026, 9, 21)
        d = (today - dt.timedelta(days=3)).strftime("%Y%m%d")
        evs = [_ev("UKR", "ARE", "042", "04", d) for _ in range(6)]
        evs += [_ev("ARE", "SDN", "046", "04", d) for _ in range(6)]   # negotiating
        assert R.supply_chains(R.build(evs)["edges"], today=today) == []

    def test_ignores_stale_hops(self):
        today = dt.date(2026, 9, 21)
        old = (today - dt.timedelta(days=400)).strftime("%Y%m%d")
        evs = [_ev("UKR", "ARE", "042", "04", old) for _ in range(6)]
        evs += [_ev("ARE", "SDN", "072", "07", old) for _ in range(6)]
        assert R.supply_chains(R.build(evs)["edges"], today=today) == []

    def test_needs_more_than_one_coded_event_per_hop(self):
        # One coded event is one wire story.
        today = dt.date(2026, 9, 21)
        d = (today - dt.timedelta(days=2)).strftime("%Y%m%d")
        evs = [_ev("UKR", "ARE", "042", "04", d), _ev("ARE", "SDN", "072", "07", d)]
        assert R.supply_chains(R.build(evs)["edges"], today=today) == []

    def test_does_not_chain_back_to_the_origin(self):
        today = dt.date(2026, 9, 21)
        d = (today - dt.timedelta(days=2)).strftime("%Y%m%d")
        evs = [_ev("UKR", "ARE", "042", "04", d) for _ in range(4)]
        evs += [_ev("ARE", "UKR", "072", "07", d) for _ in range(4)]
        assert R.supply_chains(R.build(evs)["edges"], today=today) == []


class TestGlobalGraphEmitsTypedLinks:
    """The ontology diagram's own feed, which used to emit a mood.

    /api/ontology/global reduced every country pair to one undirected
    edge whose kind was "strained" or "cooperative". The spec asks for
    the relationship word at the midpoint of the link; a tone bucket is
    not one.
    """

    def test_a_link_carries_the_verb_the_confidence_and_the_basis(self):
        import country_graph as cg
        import gdelt_events as ge

        evs = [_ev("ARE", "SDN", "072", "07", "20260910") for _ in range(4)]
        saved = ge.EVENTS_CACHE.get("events")
        ge.EVENTS_CACHE["events"] = evs
        try:
            g = cg.global_graph(hours=168)
        finally:
            ge.EVENTS_CACHE["events"] = saved

        links = g["links"]
        assert links, "expected a typed link"
        l = links[0]
        assert l["kind"] == "provides military aid to"
        # Directed: source and target are not interchangeable.
        assert l["s"] == "country_ARE" and l["t"] == "country_SDN"
        # The basis for the assertion, which the link editor shows and a
        # briefing would cite.
        assert "coded event" in l["note"] and "CAMEO" in l["note"]
        # Spec §6.6: inferred is derived, conf < 0.8.
        assert l["inferred"] is (l["conf"] < 0.8)

    def test_both_directions_survive_as_separate_links(self):
        # An undirected tone average could not say that two actors are
        # doing different things to each other.
        import country_graph as cg
        import gdelt_events as ge

        evs = ([_ev("ISR", "PSE", "190", "19", "20260910") for _ in range(3)]
               + [_ev("PSE", "ISR", "190", "19", "20260911") for _ in range(2)])
        saved = ge.EVENTS_CACHE.get("events")
        ge.EVENTS_CACHE["events"] = evs
        try:
            links = cg.global_graph(hours=168)["links"]
        finally:
            ge.EVENTS_CACHE["events"] = saved
        pairs = {(l["s"], l["t"]) for l in links}
        assert ("country_ISR", "country_PSE") in pairs
        assert ("country_PSE", "country_ISR") in pairs
