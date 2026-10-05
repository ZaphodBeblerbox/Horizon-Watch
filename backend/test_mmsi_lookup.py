"""mmsi_lookup: the MID is read where ITU puts it, and names join with the rest."""
from mmsi_lookup import lookup_mmsi, mid_of


def test_ship_mids_that_were_missing_resolve():
    assert lookup_mmsi("229043000")["flag_country"] == "Malta"
    assert lookup_mmsi("710001648")["flag_country"] == "Brazil"
    assert lookup_mmsi("701006094")["flag_country"] == "Argentina"


def test_names_match_the_rest_of_the_system():
    assert lookup_mmsi("366123456")["flag_country"] == "United States of America"
    assert lookup_mmsi("470123456")["flag_country"] == "United Arab Emirates"


def test_mid_position_follows_the_mmsi_kind():
    assert mid_of("232001234") == "232"     # ship
    assert mid_of("002320001") == "232"     # coast station
    assert mid_of("023200012") == "232"     # group
    assert mid_of("111232503") == "232"     # SAR aircraft
    assert mid_of("992351234") == "235"     # aid to navigation
    assert mid_of("982321234") == "232"     # craft of a parent ship


def test_beacons_and_malformed_ids_carry_no_flag():
    for m in ("970014523", "972123456", "974123456", "12345", "", None):
        assert lookup_mmsi(m)["flag_iso2"] == "XX"
