"""GDELT's translingual export (Spanish, Portuguese and 63 more languages)
reaches the risk index, and Latin American ActionGeo codes resolve."""
import country_codes as cc
import gdelt_events as ge

LISTING = """53500 bbf1 http://data.gdeltproject.org/gdeltv2/20261018141500.translation.export.CSV.zip
71311 6040 http://data.gdeltproject.org/gdeltv2/20261018141500.translation.mentions.CSV.zip
7851197 dd6a http://data.gdeltproject.org/gdeltv2/20261018141500.translation.gkg.csv.zip
"""


def test_the_english_filter_still_rejects_translation_files():
    assert not ge._is_event_export_url("http://x/20261018141500.translation.export.CSV.zip")
    assert ge._is_event_export_url("http://x/20261018141500.export.CSV.zip")


def test_translation_listing_yields_only_the_events_export():
    assert ge.parse_translation_lastupdate(LISTING) == [
        "http://data.gdeltproject.org/gdeltv2/20261018141500.translation.export.CSV.zip"]


def test_candidates_are_oldest_first_and_skip_what_was_read():
    listed = ge.parse_translation_lastupdate(LISTING)
    c = ge.translation_candidates(listed, loaded=set(), lookback=4, limit=3)
    assert [u.rsplit("/", 1)[1][:14] for u in c] == ["20261018133000", "20261018134500", "20261018140000"]
    c2 = ge.translation_candidates(listed, loaded=set(c), lookback=4, limit=3)
    assert [u.rsplit("/", 1)[1][:14] for u in c2] == ["20261018141500"]


def test_latin_american_fips_codes_resolve():
    # FIPS, not ISO: PA is Paraguay, ES is El Salvador, BL Bolivia, NU Nicaragua, HA Haiti.
    for fips, iso3 in {"BL": "BOL", "HA": "HTI", "GT": "GTM", "ES": "SLV", "NU": "NIC",
                       "PM": "PAN", "PA": "PRY", "UY": "URY", "CU": "CUB", "VE": "VEN"}.items():
        assert cc.from_fips(fips) == iso3, fips
    assert cc.from_fips("SP") == "ESP" and cc.from_fips("BO") == "BLR"     # unchanged


def test_iso2_and_cameo_cover_latin_america():
    for two, three in {"BO": "BOL", "HT": "HTI", "GT": "GTM", "SV": "SLV", "NI": "NIC", "PA": "PAN",
                       "PY": "PRY", "UY": "URY", "DO": "DOM", "CU": "CUB", "HN": "HND", "CR": "CRI"}.items():
        assert cc.from_iso2(two) == three
        assert cc.from_cameo(three) == three
    assert cc.event_iso3s({"country_code": "HA", "actor1_country": "BOL"}) == {"HTI", "BOL"}
