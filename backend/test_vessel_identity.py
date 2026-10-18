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


# ── two different shapes under one field name ─────────────────────────────

def test_ship_type_is_always_a_label_never_the_numeric_code():
    """The live path stores ship_type as a human label ("cargo"); the
    history column stores the AIS numeric code (70). Copying the number
    into the live field broke the map outright — the client calls
    .toLowerCase() on it."""
    v = vi.enrich({"mmsi": "636020959"})
    st = v.get("ship_type")
    if st is not None:
        assert isinstance(st, str), f"ship_type must be a label, got {type(st)}"


def test_every_enriched_field_survives_a_string_operation():
    """The client treats these as strings. Anything that is not one is a
    crash waiting for the first vessel that carries it."""
    v = vi.enrich({"mmsi": "636020959"})
    for field in ("name", "ship_type", "ship_type_text", "destination", "flag"):
        val = v.get(field)
        if val is not None:
            assert isinstance(val, str), f"{field} is {type(val)}"


# ── an empty history is an answer, not "not loaded yet" ──────────────────
#
# Production 2026-10-18: history held no named vessel, the cache stayed
# empty, and `if _CACHE and fresh` treated that as "never loaded" — so
# every vessel in /api/ais/vessels re-ran the whole-table query, 2,500
# queries per request on the event loop, and the whole API stopped
# answering for half an hour.

import contextlib  # noqa: E402
import sys  # noqa: E402
import threading  # noqa: E402
import time  # noqa: E402
import types  # noqa: E402


def _fake_database(rows, calls, fail=False, gate=None):
    class _Col:
        def isnot(self, _):
            return self

        def __ne__(self, _):
            return self

        def desc(self):
            return self

    class _VH:
        mmsi = name = ship_type = ship_type_text = destination = id = _Col()

    class _Q:
        def filter(self, *a):
            return self

        def order_by(self, *a):
            return self

        def limit(self, *a):
            return self

        def all(self):
            if gate is not None:
                gate.wait(5)
            calls.append(1)
            if fail:
                raise RuntimeError("database is locked")
            return list(rows)

    class _DB:
        def query(self, *a):
            return _Q()

    @contextlib.contextmanager
    def get_db():
        yield _DB()

    m = types.ModuleType("database")
    m.VesselHistory = _VH
    m.get_db = get_db
    return m


def _reset(monkeypatch):
    # A refresh thread started by an earlier suite may still hold the lock;
    # it would mark the cache fresh under us, so let it finish first.
    with vi._LOAD_LOCK:
        pass
    monkeypatch.setattr(vi, "_LOADED_AT", 0.0)
    vi._CACHE.clear()
    vi._LOADING.clear()


def test_an_empty_history_is_loaded_once_not_once_per_vessel(monkeypatch):
    calls = []
    monkeypatch.setitem(sys.modules, "database", _fake_database([], calls))
    _reset(monkeypatch)
    vi._load_known(block=True)
    assert calls == [1]
    out = vi.enrich_all([{"mmsi": str(636000000 + i)} for i in range(500)])
    for i in range(50):
        vi.enrich({"mmsi": str(636000000 + i)})
    assert len(out) == 500
    assert calls == [1], f"queried {len(calls)} times"


def test_a_failed_load_is_retried_after_a_pause_not_per_call(monkeypatch):
    calls = []
    monkeypatch.setitem(sys.modules, "database", _fake_database([], calls, fail=True))
    _reset(monkeypatch)
    vi._load_known(block=True)
    for _ in range(50):
        vi._load_known(block=True)
        vi.enrich({"mmsi": "636019825"})
    assert calls == [1]


def test_a_request_never_waits_for_the_load(monkeypatch):
    """The caller gets what is cached now; the refresh runs in its own
    thread, and only one of them at a time."""
    gate = threading.Event()
    calls = []
    monkeypatch.setitem(sys.modules, "database", _fake_database(
        [("636019825", "ARGO", 70, "Cargo", "ROTTERDAM")], calls, gate=gate))
    _reset(monkeypatch)
    t0 = time.monotonic()
    v = vi.enrich_all([{"mmsi": "636019825"}])[0]
    vi.enrich_all([{"mmsi": "636019825"}])
    assert time.monotonic() - t0 < 1.0
    assert not v.get("name")
    assert vi._LOADING.is_set()
    gate.set()
    for _ in range(250):
        if not vi._LOADING.is_set():
            break
        time.sleep(0.02)
    assert calls == [1]
    assert vi.enrich({"mmsi": "636019825"})["name"] == "ARGO"
