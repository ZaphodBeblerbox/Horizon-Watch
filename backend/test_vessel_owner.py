"""vessel_owner: the registered owner by MMSI, and nothing when it is not certain."""
from vessel_owner import lookup, owner_from

M = "636020667"


def _entry(owners=(), regs=()):
    return {"registryOwners": list(owners), "registryInfo": list(regs)}


def test_the_current_owner_of_this_mmsi_is_returned_with_its_country():
    raw = {"entries": [_entry(
        owners=[{"name": "PACITA HARREN PARTNER", "flag": "DEU", "ssvid": M, "sourceCode": ["IMO"],
                 "dateFrom": "2019-01-01T00:00:00Z", "dateTo": "2024-05-09T00:00:00Z"}],
        regs=[{"ssvid": M, "shipname": "PACITA", "imo": "9000000"}])]}
    r = owner_from(raw, M)
    assert r["owner"]["name"] == "PACITA HARREN PARTNER"
    assert r["owner"]["country"] == "Germany"
    assert r["owner"]["until"] == "2024-05-09" and r["owner"]["kind"] == "registered owner"
    assert r["registry"]["imo"] == "9000000"


def test_an_owner_filed_under_another_mmsi_is_not_borrowed():
    raw = {"entries": [_entry(owners=[{"name": "SOMEONE ELSE", "flag": "NOR", "ssvid": "258000000",
                                       "dateTo": "2026-08-31T00:00:00Z"}])]}
    assert owner_from(raw, M)["owner"] is None


def test_two_owners_in_the_same_period_is_a_question_not_an_answer():
    o = lambda n: {"name": n, "flag": "NOR", "ssvid": M, "dateTo": "2026-08-31T00:00:00Z"}
    r = owner_from({"entries": [_entry(owners=[o("A AS"), o("B AS")])]}, M)
    assert r["owner"] is None and "2 owners" in r["reason"]


def test_an_older_owner_gives_way_to_the_newer():
    raw = {"entries": [_entry(owners=[
        {"name": "OLD AS", "ssvid": M, "dateTo": "2015-01-01T00:00:00Z"},
        {"name": "NEW AS", "ssvid": M, "dateTo": "2026-08-31T00:00:00Z"}])]}
    assert owner_from(raw, M)["owner"]["name"] == "NEW AS"


def test_self_reported_only_says_so():
    r = owner_from({"entries": [{"selfReportedInfo": [{"ssvid": M}]}]}, M)
    assert r["owner"] is None and "own AIS" in r["reason"]


def test_non_ship_identities_are_not_looked_up():
    for m in ("970014523", "002320001", "12345"):
        assert "Not a ship MMSI" in lookup(m)["reason"]


def test_registry_states_the_country_file_lacks_still_resolve():
    from location_extract import country_name_from_code as c
    assert [c(k) for k in ("NOR", "FRA", "MLT", "SGP", "MHL", "MCO")] == \
        ["Norway", "France", "Malta", "Singapore", "Marshall Islands", "Monaco"]
    assert c("LBR") == "Liberia"            # the file's own answer is untouched
