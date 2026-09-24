"""Capabilities from Wikipedia, tested without touching the network."""
import sqlite3
import time

import mil_equipment as me


def test_sections_become_capabilities():
    secs = ["Small arms", "Anti-tank weapons", "Air-defence equipment",
            "Anti-ship weapons", "Armoured vehicles", "Artillery"]
    caps = me.capabilities_from(secs)
    for want in ("small_arms", "anti_tank", "air_defence", "anti_ship",
                 "armour", "artillery"):
        assert want in caps, want


def test_anti_aircraft_is_air_defence_not_aircraft():
    # Ordering matters: "anti-aircraft" contains "aircraft", and reading
    # it as an air force would give a defender an offensive capability
    # it does not have.
    caps = me.capabilities_from(["Anti-aircraft weapons"])
    assert "air_defence" in caps
    assert "aircraft" not in caps


def test_sections_are_parsed_from_wikitext():
    wt = "intro\n== Weapons ==\nx\n=== Small arms ===\ny\n== Vehicles ==\nz"
    assert me.sections_of(wt) == ["Weapons", "Small arms", "Vehicles"]


def test_a_force_name_matches_a_differently_ordered_title():
    # Wikipedia titles Ukraine's list "List of equipment of the Armed
    # Forces of Ukraine". Requiring "Ukrainian" verbatim rejected the
    # correct page and reported a country at war as having none.
    assert me._same_force("List of equipment of the Armed Forces of Ukraine",
                          "Ukrainian Armed Forces")
    assert me._same_force("List of equipment of the Estonian Defence Forces",
                          "Estonian Defence Forces")


def test_it_does_not_match_an_unrelated_country():
    # The search happily returns the Spanish Armed Forces for a Malian
    # query; accepting it would put Spanish equipment in a Sahel scenario.
    assert not me._same_force("List of equipment of the Spanish Armed Forces",
                              "Malian Armed Forces")
    assert not me._same_force("List of equipment of the Croatian Armed Forces",
                              "Chadian Armed Forces")


def test_unknown_is_not_the_same_as_none(monkeypatch):
    # "We checked and it has no air force" and "we never looked" must not
    # render the same: one is a finding, the other is a bug.
    c = sqlite3.connect(":memory:")
    monkeypatch.setattr(me, "find_page", lambda *a, **k: None)
    out = me.lookup(c, "Ruritanian Armed Forces")
    assert out["known"] is False
    assert "no equipment list" in out["reason"]
    c.close()


def test_a_found_page_with_sections_is_known(monkeypatch):
    c = sqlite3.connect(":memory:")
    monkeypatch.setattr(me, "find_page", lambda *a, **k: "List of equipment of the X")
    monkeypatch.setattr(me, "_wikitext",
                        lambda *a, **k: "== Air-defence equipment ==\n== Artillery ==")
    out = me.lookup(c, "X Armed Forces")
    assert out["known"] is True
    assert set(out["capabilities"]) == {"air_defence", "artillery"}
    c.close()


def test_the_result_is_cached(monkeypatch):
    c = sqlite3.connect(":memory:")
    calls = []
    monkeypatch.setattr(me, "find_page",
                        lambda *a, **k: (calls.append(1), "P")[1])
    monkeypatch.setattr(me, "_wikitext", lambda *a, **k: "== Artillery ==")
    me.lookup(c, "X Armed Forces")
    first = len(calls)
    me.lookup(c, "X Armed Forces")
    # A scenario that waits on network round-trips is one nobody runs
    # twice. The first lookup queries each branch; the second must query
    # nothing at all.
    assert first >= 1
    assert len(calls) == first
    assert me.lookup(c, "X Armed Forces")["cached"] is True
    c.close()


def test_a_stale_cache_entry_is_refetched(monkeypatch):
    c = sqlite3.connect(":memory:")
    me.ensure_schema(c)
    c.execute("INSERT INTO mil_equipment (force,page,caps,sections,fetched_at)"
              " VALUES (?,?,?,?,?)",
              ("X Armed Forces", "P", '["artillery"]', '[]',
               time.time() - me.TTL_S - 10))
    c.commit()
    monkeypatch.setattr(me, "find_page", lambda *a, **k: "P2")
    monkeypatch.setattr(me, "_wikitext", lambda *a, **k: "== Air-defence ==")
    out = me.lookup(c, "X Armed Forces")
    assert out["cached"] is False
    assert out["capabilities"] == ["air_defence"]
    c.close()


def test_an_empty_force_name_is_refused():
    c = sqlite3.connect(":memory:")
    assert me.lookup(c, "")["known"] is False
    assert me.lookup(c, None)["known"] is False
    c.close()


def test_branches_are_queried_separately_and_unioned(monkeypatch):
    """A national force is split across ground, air and navy lists.

    Asking only for "X Armed Forces" lands on whichever the search
    prefers — for Russia that is the GROUND forces page, which has no
    aircraft section. Russia therefore came back with no air arm and
    every air course of action was refused for a country that flies more
    combat aircraft than most alliances.
    """
    c = sqlite3.connect(":memory:")
    pages = {"Ruritanian Ground Forces": "== Armoured vehicles ==",
             "Ruritanian Air Force": "== Aircraft ==",
             "Ruritanian Navy": "== Ships =="}
    monkeypatch.setattr(me, "find_page",
                        lambda q, *a, **k: next((p for p in pages if
                                                 p.split()[-2:] == q.split()[-2:]), None))
    monkeypatch.setattr(me, "_wikitext", lambda pg, *a, **k: pages.get(pg, ""))
    out = me.lookup(c, "Ruritanian Armed Forces")
    assert "armour" in out["capabilities"]
    assert "aircraft" in out["capabilities"]
    assert "naval" in out["capabilities"]
    c.close()


def test_a_force_with_no_branch_pages_is_still_unknown(monkeypatch):
    c = sqlite3.connect(":memory:")
    monkeypatch.setattr(me, "find_page", lambda *a, **k: None)
    assert me.lookup(c, "Ruritanian Armed Forces")["known"] is False
    c.close()
