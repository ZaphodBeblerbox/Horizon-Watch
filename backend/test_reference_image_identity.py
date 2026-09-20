"""
test_reference_image_identity.py — is this a picture of the place we asked for?

The image service already refused logos, seals and locator maps. What it
never checked was IDENTITY, and the result was not missing pictures but
confident wrong ones. Measured against the live service before the fix:

    Port of Rotterdam           -> "Port"            (the generic article)
    Amsterdam Airport Schiphol  -> "Schiphol Airport station"  (the railway)
    Dubai International Airport -> Chhatrapati Shivaji ...     (MUMBAI)
    EHAM                        -> "List of busiest airports by passenger traffic"

Every one of those passed the existing subject check, because that check
only asks whether the page is about airports IN GENERAL. Showing an analyst
Mumbai captioned as Dubai is worse than showing nothing: it looks right.

    cd backend && python3 -m pytest test_reference_image_identity.py -q
"""
import services.wikimedia_image_service as w


# ── the page has to be about THIS place ───────────────────────────────────

def test_the_generic_article_is_not_a_picture_of_rotterdam():
    assert not w._name_matches("Port of Rotterdam", "Port")


def test_mumbais_airport_is_not_dubais():
    """The one that matters most: right country would still be wrong, and
    this was not even the right country."""
    assert not w._name_matches(
        "Dubai International Airport",
        "Chhatrapati Shivaji Maharaj International Airport")


def test_the_place_itself_matches():
    assert w._name_matches("Port of Rotterdam", "Port of Rotterdam")
    assert w._name_matches("Jebel Ali", "Port of Jebel Ali")
    assert w._name_matches("Dubai International Airport", "Dubai International Airport")


def test_generic_words_alone_never_constitute_a_match():
    """"International" and "Airport" are shared by thousands of pages. If
    the only overlap is category vocabulary, it is not a match."""
    assert not w._name_matches("Kansai International Airport",
                               "Denver International Airport")


def test_a_name_with_nothing_distinctive_is_not_blocked():
    """The gate must not reject a lookup it cannot judge — that would trade
    wrong answers for missing ones."""
    assert w._name_matches("Port", "Port of Something")


# ── pages that are the right subject but the wrong thing ──────────────────

def test_an_index_page_is_rejected():
    assert w._NOT_A_FACILITY.search("List of busiest airports by passenger traffic")


def test_the_railway_station_under_the_terminal_is_rejected():
    """Its photograph is a platform."""
    assert w._NOT_A_FACILITY.search("Schiphol Airport station")


def test_the_operating_company_is_not_the_place():
    """"Royal Schiphol Group" is a holding company; its picture is a
    headquarters or a wordmark, not an apron."""
    assert w._NOT_A_FACILITY.search("Royal Schiphol Group")
    assert w._NOT_A_FACILITY.search("Rotterdam Port Authority")


def test_real_facilities_survive_all_of_it():
    for title in ("Port of Rotterdam", "Port of Hamburg", "Port of Jebel Ali",
                  "Dubai International Airport", "Heathrow Airport",
                  "Amsterdam Airport Schiphol"):
        assert not w._NOT_A_FACILITY.search(title), title


# ── the double-prefix that created the Rotterdam failure ──────────────────

def test_a_name_that_already_says_port_is_not_prefixed_again():
    """"Port of Rotterdam" became "Port of Port of Rotterdam", which
    Wikipedia collapses to the generic article "Port"."""
    assert w._candidates("Port of Rotterdam", "port") == ["Port of Rotterdam"]


def test_a_bare_city_name_still_gets_the_port_prefixes():
    """The prefixing exists for a reason: "Rotterdam" is a city."""
    cands = w._candidates("Rotterdam", "port")
    assert "Port of Rotterdam" in cands
    assert cands[0] == "Port of Rotterdam"


def test_an_airport_name_is_not_suffixed_twice():
    assert w._candidates("Dubai International Airport", "airport")[0] \
        == "Dubai International Airport"
