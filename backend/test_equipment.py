"""Tests for the equipment gazetteer and extractor.

The cases that matter here are the ones that were wrong when measured
against the live corpus, not the ones that were obviously right.
"""
import equipment as E


def test_families_are_shallow_and_disjoint():
    # Noy's rule of thumb: siblings at one level of generality, and a
    # family with fifty children is a missing level, not a big family.
    for fam, kinds in E.FAMILIES.items():
        assert 1 <= len(kinds) <= 12, fam
    seen = set()
    for kinds in E.FAMILIES.values():
        for k in kinds:
            assert k not in seen, f"{k} in two families"
            seen.add(k)


def test_every_gazetteer_entry_is_well_formed():
    for name, (kind, origin, aliases) in E.GAZETTEER.items():
        assert E.family_of(kind), f"{name}: kind {kind} has no family"
        assert origin is None or len(origin) == 2, f"{name}: {origin}"
        assert isinstance(aliases, tuple)


def test_word_boundaries_not_substrings():
    # The bug that made "Tor" the second most common system in the
    # corpus: substring matching found it inside "history", and "Grad"
    # inside "Volgograd".
    assert E.extract("a long history of conflict") == []
    assert E.extract("footage from Volgograd") == []
    assert "Tor" in E.extract("a Tor-M2 was struck")


def test_source_markers_are_not_equipment():
    # "Vid 1" and "Pic 2" are GeoConfirmed's own video markers and were
    # the two most frequent designator matches in the whole dataset.
    assert E.extract("Vid 1 - Pic 2 - OBR 2022") == []


def test_separator_variants_are_one_system():
    for spelling in ("BTR-82A", "BTR 82A", "btr82a", "BTR-82"):
        assert E.extract(f"{spelling} destroyed") == ["BTR-82"], spelling


def test_variants_collapse_to_the_base_system():
    # A variant is the same system for every competency question here;
    # splitting them scatters evidence over one-observation nodes.
    assert E.extract("T-72B3 hit by a drone") == ["T-72"]
    assert E.extract("T-80BV burning") == ["T-80"]


def test_generic_categories_have_no_origin():
    # An FPV drone is an improvised airframe, not a product of a state.
    # A country here would let the transfer layer infer a supplier that
    # does not exist.
    assert E.origin_of("FPV") is None
    assert E.kind_of("FPV") == "uav"


def test_extract_is_deduplicated_and_ordered():
    got = E.extract("Lancet strike on a 2S1; a second Lancet followed")
    assert got.count("Lancet") == 1
    assert set(got) == {"Lancet", "2S1"}


def test_real_corpus_titles():
    cases = [
        ("Claimed Ukrainian 2S1 artillery destroyed by Russian lancet strike",
         {"2S1", "Lancet"}),
        ("Ukrainian armored personnel carrier is destroyed by a Russian FPV strike",
         {"FPV"}),
        ("Shahed 136 intercepted over Kyiv", {"Shahed"}),
    ]
    for text, expected in cases:
        assert set(E.extract(text)) == expected, text


def test_canonical_is_idempotent():
    for raw in ("BTR 82A", " T-72  ", "2S1"):
        once = E.canonical(raw)
        assert E.canonical(once) == once
