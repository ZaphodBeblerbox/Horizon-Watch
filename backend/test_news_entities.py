"""Linking reporting to the entity graph, and everything that had to be
refused along the way.

The yield is small and the reasons are structural, not tuneable: 5,900 of
6,066 articles have only a title, `body` is empty for every row, and the RSS
feed has not run since 2026-09-11. This module is correct; the corpus is thin.
"""
import sqlite3

import pytest

import news_entities as ne


def test_possessives_do_not_become_names():
    """"Iran's" normalised to the two-token name "Iran s" and sailed straight
    through the multi-token gate."""
    assert ne.normalise("Iran’s Army") == "Iran Army"
    assert ne.normalise("Sudan's military") == "Sudan military"


def test_single_token_names_are_never_matched():
    """Every error that survived the other gates was single-token:

        "Society" <- "civil society"
        "League"  <- "Arab League", "Ligue 1"
        "Martin"  <- "Lockheed Martin", "Martin Hikel"

    The graph legitimately contains entities with those names, the string is
    present, and the referent is different. No blocklist fixes a name that is
    genuinely both a company and a common noun.
    """
    for name in ("Society", "League", "Martin", "Leadership", "Justice", "Sovcomflot"):
        assert not ne.gazetteer_usable(name, set(), ["sanction"]), name


def test_multi_token_names_are_usable():
    for name in ("Islamic State", "Russian Aerospace Forces", "Donetsk People's Republic",
                 "Jaguar Land Rover", "NATIONAL IRANIAN TANKER COMPANY"):
        assert ne.gazetteer_usable(name, set(), []), name


def test_nickname_aliases_are_refused():
    """OpenSanctions records aliases like "the Nose" and "The Youth" — real,
    useful in a profile, indistinguishable from ordinary language in a
    headline. They matched "the Nose Job of Tomorrow" and "The youth film"."""
    for alias in ("the Nose", "The Youth", "a Friend"):
        assert not ne.gazetteer_usable(alias, set(), ["sanction"]), alias


def test_corpus_frequency_kills_common_words():
    """Derived from our own reporting rather than hand-listed, so it adapts
    as coverage changes. The first run linked "Israel" as a Person 109 times."""
    common = {"ISRAEL", "ACROSS", "SUMMIT", "ACTION"}
    assert not ne.gazetteer_usable("Israel Summit", common, [])
    assert ne.gazetteer_usable("Islamic State", common, [])


def test_a_vessel_needs_maritime_context():
    """Sanctioned hulls really are called JUSTICE, TARGET and LEADERSHIP, so
    the match is textually right and the referent is wrong: "Company
    leadership may again send..." is not the tanker."""
    index = {"by_name": {" ATLANTIC PIONEER ": [("v1", "Vessel", "ATLANTIC PIONEER")]},
             "sorted_keys": [" ATLANTIC PIONEER "], "common": set()}
    assert ne.find_known("Atlantic Pioneer detained off Denmark, tanker seized", index)
    assert not ne.find_known("Atlantic Pioneer wins the regional football cup", index)


def test_a_non_vessel_does_not_need_maritime_context():
    index = {"by_name": {" ISLAMIC STATE ": [("o1", "Organization", "Islamic State")]},
             "sorted_keys": [" ISLAMIC STATE "], "common": set()}
    assert ne.find_known("Suspected Islamic State member killed in Istanbul", index)


def test_word_boundaries_are_respected():
    index = {"by_name": {" ISLAMIC STATE ": [("o1", "Organization", "Islamic State")]},
             "sorted_keys": [" ISLAMIC STATE "], "common": set()}
    assert not ne.find_known("preislamicstatehood debates", index)


def test_the_longest_match_wins():
    """"NATIONAL IRANIAN TANKER COMPANY LLC" must beat the shorter name."""
    index = {"by_name": {
        " NATIONAL IRANIAN TANKER COMPANY LLC ": [("a", "Organization", "NITC LLC")],
        " NATIONAL IRANIAN TANKER COMPANY ": [("b", "Organization", "NITC")]},
        "sorted_keys": [" NATIONAL IRANIAN TANKER COMPANY LLC ",
                        " NATIONAL IRANIAN TANKER COMPANY "], "common": set()}
    hits = ne.find_known("National Iranian Tanker Company LLC expands fleet", index)
    assert len(hits) == 1 and hits[0]["ftm_id"] == "a"
