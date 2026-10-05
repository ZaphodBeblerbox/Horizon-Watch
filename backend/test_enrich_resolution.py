"""
The Irina case: three mentions of one ship, and the rules that make them one.

The model's extraction is not tested here — it is a model. What IS tested
is everything the identity of an entity depends on, because that part is
code and must be reproducible.
"""
from enrich import norm_name, resolution_key, link_mentions, _adds_numbers


def test_norm_name_folds_the_noise_two_spellings_share():
    for spelling in ("IRINA", "M/V Irina", "MV IRINA", "tanker Irina", "the Irina"):
        assert norm_name(spelling) == "irina", spelling


def test_norm_name_folds_accents_rather_than_dropping_the_name():
    assert norm_name("Güneş") == "gunes"
    assert norm_name("Sõber") == "sober"


def test_an_identifier_beats_a_name():
    # An MMSI is issued and unique. A name is a label two ships can share
    # and one ship can change, so it can never outrank one.
    assert resolution_key({"kind": "vessel", "name": "Irina", "mmsi": "636019825"}) \
        == "vessel:mmsi:636019825"
    assert resolution_key({"kind": "vessel", "name": "Irina"}) == "vessel:name:irina"
    assert resolution_key({"kind": "aircraft", "name": "unknown", "icao24": "3C4AB7"}) \
        == "aircraft:icao:3c4ab7"


def test_a_malformed_identifier_is_not_an_identity():
    # Eight digits is not an MMSI. Treating it as one invents an identity
    # that nothing else will ever match.
    assert resolution_key({"kind": "vessel", "name": "Irina", "mmsi": "63601982"}) \
        == "vessel:name:irina"
    assert resolution_key({"kind": "vessel", "name": "Irina", "mmsi": None}) \
        == "vessel:name:irina"


def test_an_entity_with_nothing_to_identify_it_has_no_key():
    assert resolution_key({"kind": "vessel", "name": ""}) is None
    assert resolution_key({"kind": "vessel"}) is None


def test_the_irina_case():
    """Three mentions, one ship — because the middle one carries the MMSI."""
    mentions = [
        {"kind": "vessel", "name": "tanker IRINA"},
        {"kind": "vessel", "name": "IRINA", "mmsi": "636019825", "flag": "LR"},
        {"kind": "vessel", "name": "Irina", "flag": "IR", "role": "transiting Hormuz"},
    ]
    folded = link_mentions(mentions)
    assert folded == {"vessel:name:irina": "vessel:mmsi:636019825"}
    # Every mention now resolves to the one ship.
    resolved = {folded.get(resolution_key(m), resolution_key(m)) for m in mentions}
    assert resolved == {"vessel:mmsi:636019825"}


def test_two_names_alone_are_not_evidence():
    # Without an identifier between them, two mentions of "Irina" might be
    # two ships. Folding them would be a guess presented as a fact.
    mentions = [{"kind": "vessel", "name": "Irina"},
                {"kind": "vessel", "name": "MV Irina"}]
    assert link_mentions(mentions) == {}


def test_a_name_is_never_folded_across_kinds():
    # "Irina" the vessel and "Irina" the person are not the same thing, and
    # an MMSI on the ship says nothing about the woman.
    mentions = [{"kind": "vessel", "name": "Irina", "mmsi": "636019825"},
                {"kind": "person", "name": "Irina"}]
    assert link_mentions(mentions) == {}


def test_a_rewrite_may_not_introduce_a_number():
    # The one hallucination that matters in a headline is a figure, because
    # a figure is what gets quoted.
    assert _adds_numbers("Clashes reported near the port", "17 killed in clashes near the port")
    assert not _adds_numbers("17 killed in clashes", "17 killed in clashes near Hodeidah, Yemen")
    assert not _adds_numbers("Clashes near the port", "Clashes near Hodeidah port, Yemen")


# ── the headline guard ──────────────────────────────────────────────────
#
# A rewritten headline is shown to an analyst in place of what arrived, so
# the one thing it must never do is add a fact. Numbers are the case that
# matters: a figure is what gets quoted onward.

def test_a_rewrite_may_name_the_place_the_original_omitted():
    # This is the POINT of rewriting. "Road crashes killed 14 people a day"
    # is about a country it never names, and the country is in the text.
    assert not _adds_numbers(
        "Road crashes killed 14 people a day on average in September: RSF — Dhaka, Bangladesh",
        "Bangladesh: road crashes killed 14 people a day on average in September")


def test_a_rewrite_may_not_invent_a_casualty_figure():
    assert _adds_numbers("Clashes reported near Hodeidah",
                         "Dozens killed as 40 clash near Hodeidah")


def test_a_rewrite_may_reorder_the_numbers_it_was_given():
    # Same figures, different sentence. Not an addition.
    assert not _adds_numbers("17 killed, 4 injured in Kenya crash",
                             "Kenya: 4 injured and 17 killed in a road crash")
