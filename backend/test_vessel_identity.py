"""
test_vessel_identity.py — a ship we have identified stays identified.

Reported as "the only thing we ever see is stationary unknown vessels —
when we match one to a sanctioned name, don't we then have its identity?"

Yes, and we had it all along. AIS splits identity from position: a
PositionReport carries lat/lon/speed and no name, ShipStaticData carries
the name every six minutes or so. Position outnumbers identity about
thirty to one, and the live dict is rebuilt from scratch on every
restart — so the map showed a field of unknowns while 11,748 of those
MMSIs had a name sitting in history.

    cd backend && python3 -m pytest test_vessel_identity.py -q
"""
import vessel_identity as vi


# ── flag needs no history at all ──────────────────────────────────────────

def test_the_flag_is_in_the_mmsi_itself():
    """The first three digits are the MID, which is the flag state. It
    was derivable for every vessel that ever appeared and stored for
    none of them — 0% of 2,076,858 rows."""
    assert vi.flag_of("636019825")["flag"] == "Liberia"
    assert vi.flag_of("273123456")["flag"] == "Russia"
    assert vi.flag_of("247123456")["flag"] == "Italy"


def test_a_nonsense_mmsi_gets_no_flag_rather_than_a_guess():
    assert vi.flag_of("1") is None
    assert vi.flag_of("") is None


def test_enrich_adds_a_flag_to_a_bare_position_report():
    v = vi.enrich({"mmsi": "636019825", "lat": 1.0, "lon": 1.0})
    assert v["flag"] == "Liberia"
    assert v["identity_from"]["flag"].startswith("MMSI")


# ── a live packet always wins ─────────────────────────────────────────────

def test_history_never_overwrites_what_the_ship_is_broadcasting_now():
    """If it is transmitting a name this second, that is the name. A
    stale one from last week must not replace it — ships are renamed,
    and renaming is exactly what a sanctioned vessel does."""
    v = vi.enrich({"mmsi": "636019825", "name": "NEW NAME"})
    assert v["name"] == "NEW NAME"


def test_a_live_flag_is_left_alone():
    v = vi.enrich({"mmsi": "636019825", "flag": "Panama"})
    assert v["flag"] == "Panama"


# ── absence is stated, never disguised ────────────────────────────────────

def test_an_unidentified_vessel_says_why_it_is_unidentified():
    """"Unknown" reads as a property of the ship. It is a property of our
    reception: no static message has reached us yet."""
    v = vi.enrich({"mmsi": "999999999"})
    assert not v.get("name")
    assert "static message" in v["name_status"]


def test_a_named_vessel_carries_no_absence_note():
    v = vi.enrich({"mmsi": "636019825", "name": "ARGO"})
    assert "name_status" not in v


# ── it must never break the feed ──────────────────────────────────────────

def test_a_vessel_with_no_mmsi_passes_through_untouched():
    v = {"lat": 1.0, "lon": 2.0}
    assert vi.enrich(v) == v


def test_enrich_all_handles_an_empty_feed():
    assert vi.enrich_all([]) == []
    assert vi.enrich_all(None) == []


def test_enrich_does_not_mutate_its_input():
    """The live dict is shared state behind a lock; enriching a copy for
    one response must not write identity back into it."""
    original = {"mmsi": "636019825", "lat": 1.0}
    vi.enrich(original)
    assert "flag" not in original
