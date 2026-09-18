"""The FollowTheMoney graph: ingest, storage, and resolution.

What this replaces: a loader that parsed the same OpenSanctions file and kept
`schema == "Vessel"`. In the first 60,000 entities of the maritime dataset
that is 300 rows, and it discarded 9,702 Persons, 21,032 Sanctions, 1,071
Organizations and 765 links. The owner_chain and topics columns it wrote were
empty in all 334,468 rows.
"""
import json
import sqlite3

import pytest

import ftm
import ftm_store
from ftm_resolve import norm_name, same_shape, name_distinctiveness, accept, resolve_vessel


# ── the model ────────────────────────────────────────────────────────────
def test_edges_are_entities_with_endpoints():
    """An edge being an entity is what lets it carry its own dates and its own
    source: "A owned B from 2019 to 2022, per this dataset" is a fact with a
    lifetime, not a foreign key."""
    assert ftm.is_edge("Ownership") and not ftm.is_thing("Ownership")
    assert ftm.is_thing("Vessel") and not ftm.is_edge("Vessel")
    assert ftm.edge_endpoints("Ownership", {"owner": ["a"], "asset": ["b"]}) == ("a", "b")
    assert ftm.edge_endpoints("Directorship", {"director": ["p"], "organization": ["o"]}) == ("p", "o")


def test_properties_are_always_lists():
    """Reading an FtM property as a scalar is the commonest way to lose data
    from this format."""
    assert ftm.first({"name": ["A", "B"]}, "name") == "A"
    assert ftm.first({"name": []}, "name") is None
    assert ftm.first({}, "name") is None


def test_previous_names_are_kept():
    """A sanctioned tanker is renamed and reflagged precisely to break the
    link to its listing, so matching only on current name misses the vessels
    most worth finding."""
    got = ftm.names({"name": ["LADY R"], "previousName": ["OLD HULL"], "alias": ["LADY-R"]})
    assert "OLD HULL" in got and "LADY R" in got and "LADY-R" in got


def test_imo_normalisation():
    """"IMO9811000" and "9811000" are the same hull."""
    assert ftm.normalise_imo("IMO9811000") == "9811000"
    assert ftm.normalise_imo(" 9811000 ") == "9811000"
    assert ftm.normalise_imo("98110001234") is None
    assert ftm.normalise_imo("") is None


# ── the store ────────────────────────────────────────────────────────────
@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    ftm_store.ensure_schema(c)
    return c


def test_a_thing_and_an_edge_land_in_different_tables(conn):
    assert ftm_store.upsert_entity(conn, {
        "id": "v1", "schema": "Vessel", "caption": "LADY R",
        "properties": {"name": ["LADY R"], "imoNumber": ["IMO9811000"], "topics": ["sanction"]}}) == "thing"
    assert ftm_store.upsert_entity(conn, {
        "id": "o1", "schema": "Ownership",
        "properties": {"owner": ["p1"], "asset": ["v1"], "startDate": ["2019-03-01"]}}) == "edge"
    c = ftm_store.counts(conn)
    assert c["things"] == 1 and c["edges"] == 1


def test_an_edge_keeps_its_lifetime(conn):
    """An edge whose dates we drop is a claim about the present that may be
    years stale — the difference between a current owner and a divested one."""
    ftm_store.upsert_entity(conn, {"id": "o1", "schema": "Ownership", "properties": {
        "owner": ["p1"], "asset": ["v1"], "startDate": ["2019-03-01"], "endDate": ["2022-11-30"]}})
    row = conn.execute("SELECT start_date, end_date FROM ftm_edges").fetchone()
    assert row == ("2019-03-01", "2022-11-30")


def test_topics_survive_ingest(conn):
    """They were read from the wrong path and came back empty in all 334,468
    rows — the code had already read them correctly four lines earlier."""
    ftm_store.upsert_entity(conn, {"id": "v1", "schema": "Vessel",
                                   "properties": {"name": ["X"], "topics": ["sanction", "poi"]}})
    topics = json.loads(conn.execute("SELECT topics_json FROM ftm_things").fetchone()[0])
    assert topics == ["sanction", "poi"]


def test_an_unknown_schema_is_reported_not_silently_dropped(conn):
    assert ftm_store.upsert_entity(conn, {"id": "x", "schema": "Nonsense", "properties": {}}) is None
    assert ftm_store.counts(conn)["things"] == 0


def test_provenance_is_two_axes(conn):
    """OpenSanctions is class B — an authoritative registry we are reading,
    not class A, which would mean we observed it."""
    ftm_store.upsert_entity(conn, {"id": "v1", "schema": "Vessel", "properties": {"name": ["X"]}})
    oc, lt = conn.execute("SELECT origin_class, licence_tier FROM ftm_things").fetchone()
    assert oc == "B" and lt == "T1"


# ── resolution ───────────────────────────────────────────────────────────
def test_name_normalisation_strips_prefixes():
    assert norm_name("M/V  Lady-R") == "LADY R"
    assert norm_name("MT OCEAN STAR") == "OCEAN STAR"


def test_a_sister_ship_is_not_a_match():
    """Fleet operators name vessels in series, so a missing or extra token is
    the NORM in this corpus. A plain similarity score scored these at 95% and
    they are different ships."""
    for a, b in [("VB VICTORY", "VICTORY"), ("CEDAR", "CEDAR 4"),
                 ("TAMAR A", "TAMAR"), ("P O PIONEER", "P PIONEER")]:
        assert not same_shape(a, b), f"{a} ~ {b} must not resolve"


def test_a_misspelling_is_a_match():
    assert same_shape("PERSERVERANCE", "PERSEVERANCE")
    assert same_shape("KATERINA", "EKATERINA")


def test_a_common_name_is_worth_less_than_a_rare_one():
    """"LADY R" appearing once is strong evidence; "OCEAN STAR" appearing
    forty times is nearly none."""
    counts = {"RARE NAME": 1, "OCEAN STAR": 40}
    assert name_distinctiveness("RARE NAME", counts) > name_distinctiveness("OCEAN STAR", counts)


def test_a_fuzzy_match_is_never_auto_accepted():
    """"Probably the sanctioned tanker" is not a finding."""
    assert accept({"method": "imo"}) and accept({"method": "mmsi"})
    assert accept({"method": "name_exact"})
    assert not accept({"method": "name_fuzzy", "score": 0.99})


def test_imo_outranks_name():
    """IMO survives renaming and reflagging, which is exactly what shadow-fleet
    vessels do."""
    index = {"imo": {"9811000": "ftm-imo"}, "mmsi": {}, "name": {"LADY R": {"ftm-name"}},
             "counts": {"LADY R": 1}, "keys": ["LADY R"]}
    out = resolve_vessel("265630250", "LADY R", "IMO9811000", index)
    assert out[0]["method"] == "imo"
    assert out[0]["score"] == 1.0


def test_every_resolution_carries_its_evidence():
    """A link with no stated basis is an accusation with no argument."""
    index = {"imo": {"9811000": "f1"}, "mmsi": {}, "name": {}, "counts": {}, "keys": []}
    out = resolve_vessel(None, None, "9811000", index)
    assert out and out[0]["evidence"] == "IMO 9811000"
