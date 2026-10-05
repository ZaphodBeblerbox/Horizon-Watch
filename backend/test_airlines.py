"""
The operator hiding in every airline callsign.

An aircraft on the map was an ICAO24 hex code and a flight number, and the
chain "this aircraft -> this airline -> this country" could not be walked
at all — while 58.6% of the aircraft-days in this system carried an ICAO
airline designator in the first three letters of the callsign.
"""
from airlines import AIRLINES, designator_for_callsign, operator_for_callsign


def test_the_designator_is_the_first_three_letters():
    assert designator_for_callsign("UAE231") == "UAE"
    assert designator_for_callsign("ryr4tg") == "RYR"
    assert designator_for_callsign(" BAW15 ") == "BAW"


def test_a_registration_is_not_a_designator():
    """N12345 and D-ABCD are tail numbers. Reading them as airline codes
    would attribute private aircraft to carriers that do not exist."""
    for reg in ("N12345", "D-ABCD", "G-EUPT", "F-GKXA", "", "   ", "12345"):
        assert designator_for_callsign(reg) is None, reg


def test_the_chain_the_product_needs():
    op = operator_for_callsign("UAE231")
    assert op["name"] == "Emirates"
    assert op["country"] == "United Arab Emirates"
    assert op["hub"] == "Dubai"


def test_an_unknown_designator_returns_nothing_rather_than_a_guess():
    """An aircraft wrongly attributed to an airline is worse than one left
    unattributed: the first is a false connection somebody will reason
    from, the second is an obvious gap."""
    assert operator_for_callsign("ZZZ99") is None
    assert operator_for_callsign("QQQ1") is None


def test_the_table_has_no_blank_entries():
    for code, (name, country, _hub) in AIRLINES.items():
        assert len(code) == 3 and code.isalpha() and code.isupper(), code
        assert name and country, code


def test_every_entry_is_reachable_through_a_callsign():
    # A code that cannot appear in a callsign is dead weight in the table.
    for code in AIRLINES:
        assert operator_for_callsign(code + "1") is not None, code
