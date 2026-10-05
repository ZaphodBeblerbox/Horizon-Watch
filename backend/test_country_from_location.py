"""
The country sitting at the end of the location string.

A live surface pool had 0 of 50 signals with a `location_country` while
every one of them carried the country as the last part of its location —
"Subukia, Rift Valley, Kenya", "Ferozepur, Punjab, Pakistan". Every count,
filter and join that works by country was reading an empty column.

Matching is exact against the shipped ISO names, their codes and a short
alias table. Never fuzzy: a signal filed under the wrong country is worse
than one filed under none.
"""
from location_extract import country_from_location as cfl


def test_the_tail_names_the_country():
    assert cfl("Subukia, Rift Valley, Kenya") == "Kenya"
    assert cfl("Ferozepur, Punjab, Pakistan") == "Pakistan"
    assert cfl("Dhaka, Dhaka, Bangladesh") == "Bangladesh"


def test_the_geocoders_general_suffix_is_ignored():
    # "Israel (general)" and "Nigeria (general)" are real values in the feed.
    assert cfl("Gaza, Israel (general), Israel") == "Israel"
    assert cfl("Riyom, Nigeria (general), Nigeria") == "Nigeria"


def test_a_mojibake_region_does_not_block_the_country():
    # "Lahj, La?ij, Yemen" — the middle part arrives mangled; the tail does not.
    assert cfl("Lahj, La?ij, Yemen") == "Yemen"


def test_the_common_names_resolve_not_only_the_iso_spellings():
    """The shipped table says "United States of America"; the feed says
    "United States". Twelve of fifty signals failed on exactly this."""
    assert cfl("Chatham, Illinois, United States") == "United States of America"
    assert cfl("Las Vegas, Nevada, USA") == "United States of America"
    assert cfl("Leeds, England") == "United Kingdom"
    assert cfl("Moscow, Russian Federation") == "Russia"


def test_a_country_on_its_own_resolves():
    assert cfl("Yemen") == "Yemen"
    assert cfl("  kenya  ") == "Kenya"


def test_a_region_appended_after_the_country_still_resolves():
    # Some sources put the region last; the part before it is then the country.
    assert cfl("Hodeidah, Yemen, Middle East") == "Yemen"


def test_an_unknown_tail_returns_none_rather_than_a_near_miss():
    assert cfl("Somewhere, Nowhere, Atlantis") is None
    assert cfl("") is None
    assert cfl(None) is None
    # A city that shares no name with a country must not resolve.
    assert cfl("Springfield") is None


def test_it_does_not_reach_past_the_last_two_parts():
    """Only the tail and the part before it are considered. A country named
    early in a long string is a region or a street name, not the place."""
    assert cfl("Kenya Road, Kampala, Central, Uganda") == "Uganda"
