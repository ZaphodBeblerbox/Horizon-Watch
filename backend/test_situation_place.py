"""
Matching a place to a signal's location string.

The pool stores locations as "City, Region, Country", and the whole
send-situation / explain feature rests on deciding which signals name a
place. Two countries share the prefix "Niger" and have a war near their
border, so a substring test is not merely sloppy here — it is wrong about
a specific thing.
"""
from routers.voice_ai import _match_place, render_situation


def test_a_country_matches_on_the_tail():
    assert _match_place("Lahj, Lahij, Yemen", "Yemen")
    assert _match_place("Nairobi, Nairobi Area, Kenya", "Kenya")


def test_a_city_matches_on_the_head():
    assert _match_place("Nairobi, Nairobi Area, Kenya", "Nairobi")
    assert _match_place("Hodeidah, Al Hudaydah, Yemen", "Hodeidah")


def test_niger_does_not_match_nigeria():
    """The reason this is a whole-part match and not a substring one."""
    assert not _match_place("Lagos, Lagos, Nigeria", "Niger")
    assert not _match_place("Niamey, Niamey, Niger", "Nigeria")
    assert _match_place("Niamey, Niamey, Niger", "Niger")


def test_a_multi_word_place_matches_as_a_whole_part():
    assert _match_place("Jeddah, Makkah, Saudi Arabia", "Saudi Arabia")
    assert not _match_place("Jeddah, Makkah, Saudi Arabia", "Arabia Felix")


def test_case_and_padding_do_not_matter():
    assert _match_place("  CAIRO , Cairo , EGYPT ", "egypt")
    assert _match_place("Cairo, Cairo, Egypt", "  Cairo  ")


def test_nothing_matches_nothing():
    assert not _match_place("", "Yemen")
    assert not _match_place("Lahj, Lahij, Yemen", "")
    assert not _match_place(None, None)


def test_an_empty_picture_says_so_rather_than_implying_calm():
    """The digest for a place with no signals must not read as reassurance.
    An absence of reporting is not an absence of events."""
    text = render_situation("Niger", [], "an analyst")
    assert "NIGER" in text
    assert "absence of reporting" in text


def test_the_digest_carries_the_evidence_not_a_summary():
    items = [{"severity_tier": "critical", "headline": "Convoy ambushed near Tillaberi",
              "location": "Tillaberi, Niger", "source": "gdelt",
              "published_at": "2026-10-04T11:00:00", "url": "https://example.test/a"}]
    text = render_situation("Niger", items, "Ana Ruiz")
    assert "[CRITICAL]" in text
    assert "Convoy ambushed near Tillaberi" in text
    assert "https://example.test/a" in text
    assert "Ana Ruiz" in text
    # It is a compilation, and says so — nothing in it is an assessment.
    assert "is an assessment" in text   # "Nothing here is an assessment."
