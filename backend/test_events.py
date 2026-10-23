"""events.py: one event per incident with a stable id; join and merge rules; status and corroboration on read;
following (DATAMINR_PLAN B1, owner 2026-10-23)."""
import datetime as dt
import sqlite3

import pytest

import events as ev

T0 = dt.datetime(2026, 10, 24, 14, 0, tzinfo=dt.timezone.utc)
BASTILLE = (48.8532, 2.3692)


def off(lat, lon, north_m=0.0, east_m=0.0):
    import math
    return lat + north_m / 111_320, lon + east_m / (111_320 * math.cos(math.radians(lat)))


def atom(mid, act="explosion", at=T0, pos=BASTILLE, chan="chanA", prec="street", text=None, first_hand=False, quote=None,
         place="Place de la Bastille"):
    return {"channel": chan, "msg_id": mid, "channel_title": chan, "act": act, "event_time": at, "lat": pos[0], "lon": pos[1],
            "precision": prec, "name": place, "context": ["Paris"], "quote": quote or act, "text": text or f"{act} {mid} at {place}",
            "first_hand": first_hand, "media": "none", "country_code": "fr"}


@pytest.fixture
def con(tmp_path):
    c = sqlite3.connect(str(tmp_path / "ev.db"))
    ev.ensure_tables(c)
    yield c
    c.close()


def ids(c):
    return [r[0] for r in c.execute("SELECT id FROM events WHERE merged_into IS NULL")]


def test_two_reports_400m_and_20min_apart_are_one_event_and_the_id_survives_a_restart(con, tmp_path):
    a = ev.assign(con, atom(1), T0)
    b = ev.assign(con, atom(2, at=T0 + dt.timedelta(minutes=20), pos=off(*BASTILLE, north_m=400), chan="chanB"), T0)
    con.commit()
    assert a == b and a.startswith("ev_")
    # "a restart": a new connection, the same reports again
    c2 = sqlite3.connect(str(tmp_path / "ev.db"))
    assert ev.assign(c2, atom(1), T0) == a and ev.assign(c2, atom(2), T0) == a
    c2.close()


def test_join_radius_follows_the_coarser_precision(con):
    a = ev.assign(con, atom(1, prec="site"), T0)
    far = ev.assign(con, atom(2, pos=off(*BASTILLE, north_m=1500), prec="street", chan="b"), T0)
    city = ev.assign(con, atom(3, pos=off(*BASTILLE, north_m=1500), prec="city", chan="c"), T0)
    assert far != a                                            # street + site: 600 m
    assert city in (a, far)                                    # city: 8 km joins
    region = ev.assign(con, atom(4, prec="region", chan="d"), T0)
    assert region not in (a, far)                              # a region-level report never joins


def test_the_family_window_and_cross_family_joins(con):
    a = ev.assign(con, atom(1, act="explosion"), T0)
    late = ev.assign(con, atom(2, act="strike", at=T0 + dt.timedelta(minutes=100), chan="b"), T0)
    assert late != a                                           # violence joins within 90 min
    protest = ev.assign(con, atom(3, act="crowd_movement", at=T0 + dt.timedelta(minutes=10), pos=off(*BASTILLE, east_m=200), chan="c"), T0)
    assert protest == a                                        # an explosion at a protest: 300 m and 30 min
    away = ev.assign(con, atom(4, act="arrest", at=T0 + dt.timedelta(minutes=10), pos=off(*BASTILLE, east_m=500), chan="d"), T0)
    assert away != a


def test_a_report_between_two_events_merges_them_into_the_oldest_id(con):
    # two reports at one place 100 min apart: two events (violence joins within 90 min) ...
    a = ev.assign(con, atom(1), T0)
    b = ev.assign(con, atom(2, chan="b", at=T0 + dt.timedelta(minutes=100)), T0 + dt.timedelta(minutes=100))
    assert a != b
    # ... until a report from between them arrives: one incident, under the oldest id
    c = ev.assign(con, atom(3, chan="c", at=T0 + dt.timedelta(minutes=50)), T0 + dt.timedelta(minutes=101))
    assert c == a and ids(con) == [a]
    assert ev.resolve_id(con, b) == a                          # the merged id redirects (its push tag too)
    assert ev.get(con, b, T0)["id"] == a


def test_status_on_a_clock(con):
    a = ev.assign(con, atom(1), T0)
    ev.assign(con, atom(2, chan="b", at=T0 + dt.timedelta(minutes=5)), T0)
    st = lambda m: ev.get(con, a, T0 + dt.timedelta(minutes=m))["status"]   # noqa: E731
    assert st(10) == "developing"
    assert st(70) == "ongoing"
    assert st(5 + 91) == "ended"                               # 90 min after the last violence report
    con.execute("INSERT INTO event_feedback VALUES (?,?,?,?,?)", (a, "u1", "not_live", "", ""))
    con.execute("INSERT INTO event_feedback VALUES (?,?,?,?,?)", (a, "u2", "wrong_place", "", ""))
    assert st(10) == "contradicted"


def test_a_new_independent_source_keeps_an_event_developing(con):
    a = ev.assign(con, atom(1, act="crowd_movement"), T0)
    ev.assign(con, atom(2, act="crowd_movement", at=T0 + dt.timedelta(minutes=70), chan="b", pos=off(*BASTILLE, east_m=100),
                        text="la foule remonte vers République"), T0)
    assert ev.get(con, a, T0 + dt.timedelta(minutes=75))["status"] == "developing"
    ev.assign(con, atom(3, act="crowd_movement", at=T0 + dt.timedelta(minutes=80), chan="a", pos=off(*BASTILLE, east_m=100),
                        text="other words entirely here"), T0)
    assert ev.get(con, a, T0 + dt.timedelta(minutes=105))["status"] == "ongoing"


def test_corroboration_counts_channels_not_forwards_and_other_domains(con):
    a = ev.assign(con, atom(1, text="Explosion heard at Place de la Bastille now"), T0)
    ev.assign(con, atom(2, chan="fwd", text="Explosion heard at Place de la Bastille now!!"), T0)
    v = ev.get(con, a, T0 + dt.timedelta(minutes=2))
    assert v["corroboration"]["n_independent"] == 1 and v["corroboration"]["level"] == "unverified"
    assert ev.attach_other(con, "fire", "fire:ALT-1", BASTILLE[0], BASTILLE[1], T0 + dt.timedelta(minutes=30)) == a
    v = ev.get(con, a, T0 + dt.timedelta(minutes=31))
    assert v["corroboration"]["n_independent"] == 2 and "satellite fire detection" in v["corroboration"]["line"]


def test_other_domains_only_join(con):
    assert ev.attach_other(con, "fire", "fire:x", 10.0, 10.0, T0) is None
    assert ids(con) == []
    a = ev.assign(con, atom(1, act="crowd_movement"), T0)
    assert ev.attach_other(con, "fire", "fire:y", BASTILLE[0], BASTILLE[1], T0) is None      # fires join violence only
    assert ev.attach_other(con, "situation", "sit:1", BASTILLE[0], BASTILLE[1], T0 + dt.timedelta(minutes=5)) == a


def test_a_replayed_day_gives_fewer_events_than_reports_and_none_spans_two_cities(con):
    lyon = (45.7640, 4.8357)
    atoms = [atom(i, act="crowd_movement", at=T0 + dt.timedelta(minutes=4 * i), pos=off(*BASTILLE, east_m=40 * i), chan=f"c{i % 3}")
             for i in range(12)]
    atoms += [atom(100 + i, act="police_intervention", at=T0 + dt.timedelta(minutes=5 * i), pos=lyon, chan=f"l{i}", place="Bellecour")
              for i in range(5)]
    out = ev.reconcile(con, T0 + dt.timedelta(minutes=60), atoms=atoms, situations=[], others=[], concerns=[], watch={"open": True}, attention_rows=[],
                       brief_fn=lambda *a: ({}, 0.0))
    evs = ev.recent(con, T0 + dt.timedelta(minutes=60))
    assert out["assigned"] == len(atoms) and len(evs) < len(atoms)
    for v in evs:
        assert not ({m["ref"] for m in ev._members_of(con, [v["id"]])[v["id"]]} >= {"tg:c0:0", "tg:l0:100"})
    assert len(evs) == 2


def test_follow_an_event_and_a_protest_area(con, monkeypatch):
    a = ev.assign(con, atom(1, act="crowd_movement"), T0)
    ev.maybe_rebrief(con, a, T0, concerns=[], brief_fn=None)
    f = ev.follow(con, "u1", a, now=T0)
    assert f["kind"] == "event" and f["label"].startswith("Crowd")
    # a protest: its area; a crowd report 2 km away later joins the follow
    ev.follow(con, "u1", "protest:pr-p1-live", kind="protest", label="March, Bastille", lat=BASTILLE[0], lon=BASTILLE[1], now=T0)
    b = ev.assign(con, atom(2, act="police_intervention", at=T0 + dt.timedelta(minutes=30), pos=off(*BASTILLE, north_m=2000),
                            chan="b", prec="street"), T0)
    track = [{"kind": "crowd_track", "id": "pr-crowd_track-1", "lat": BASTILLE[0], "lon": BASTILLE[1], "live": True,
              "last_update": ev.iso(T0 + dt.timedelta(minutes=40)),
              "track": {"points": [{"lat": BASTILLE[0], "lon": BASTILLE[1], "at": ev.iso(T0), "place": "Bastille"},
                                   {"lat": 48.8566, "lon": 2.3622, "at": ev.iso(T0 + dt.timedelta(minutes=40)), "place": "Saint-Paul"}]}}]
    now = T0 + dt.timedelta(minutes=45)
    lst = ev.following(con, "u1", now, protest_items_of=lambda f: track)
    prot = next(x for x in lst if x["target"] == "protest:pr-p1-live")
    assert b in prot["event_ids"] and prot["status"] == "developing" and prot["n_movements"] == 1
    fp = next(x for x in ev.follows_of(con, "u1") if x["kind"] == "protest")
    tl = ev.timeline(con, fp, now, protest_items=track)
    kinds = [e["kind"] for e in tl]
    assert "movement" in kinds and "report" in kinds
    assert tl[0]["at"] >= tl[-1]["at"]                          # newest first
    assert any(e["text"] == "Crowd at Saint-Paul" for e in tl)
    assert ev.unfollow(con, "u1", a) and len(ev.follows_of(con, "u1")) == 1
    with pytest.raises(ValueError):
        ev.follow(con, "u1", "alert:x", kind="alert")          # no place, no event: nothing to follow
