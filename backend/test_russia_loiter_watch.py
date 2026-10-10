"""
A Russia-linked ship loitering within drone range of Europe is an alert;
everything short of that — a ship at home, a ship under way, a namesake —
is not. Synthetic vessels against the real coastline file and a stub index.
"""
import pytest

import notification_context as nc
import russia_loiter_watch as rlw
import general_feed
import paths

H = 3600.0
T0 = 1_800_000_000.0


@pytest.fixture(scope="module")
def coasts():
    return rlw.Coasts(str(paths.CODE_DIR / "geo" / "countries.geojson"))


@pytest.fixture(scope="module")
def ports():
    return rlw.Ports.load(str(paths.CODE_DIR / "ports_cache.csv"))


def _index():
    # One EU shadow-fleet hull (IMO), and one namesake-prone name that must
    # never be used for matching.
    return {
        "imo": {"9329760": {"authorities": {"the EU", "the UK"}, "shadow": True,
                            "listed_name": "EAGLE S", "listed_flag": "ck"}},
        "mmsi": {"636000001": {"authorities": {"the US"}, "shadow": False,
                               "listed_name": "PEGASUS", "listed_flag": "pa"}},
        "resolved": {},
    }


def _watch(coasts, ports, **kw):
    return rlw.RussiaLoiterWatch(coasts=coasts, ports=ports, index_loader=_index, **kw)


def _vessel(mmsi, lat, lon, speed=0.3, **extra):
    v = {"mmsi": mmsi, "lat": lat, "lon": lon, "speed": speed, "cog": 120.0,
         "ship_type_code": 80, "ship_type": "tanker", "name": "TEST VESSEL"}
    v.update(extra)
    return v


def _run(w, vessels_at, hours=2.5, step_min=5):
    """Feed the same picture every step_min for `hours`; return all alerts."""
    out = []
    t = T0
    while t <= T0 + hours * H + 1:
        vs = [dict(v, last_update=t) for v in vessels_at(t)]
        out += w.run_cycle(vs, now=t)
        t += step_min * 60
    return out


# Off Denmark's east coast (Køge Bay / Stevns), ~20 km out, not in a port.
OFF_DENMARK = (55.30, 12.75)


def test_russian_flag_loitering_off_denmark_alerts(coasts, ports):
    w = _watch(coasts, ports)
    lat, lon = OFF_DENMARK
    assert not w.in_port(lat, lon)[0]
    alerts = _run(w, lambda t: [_vessel("273123450", lat, lon, name="BORACAY")])
    assert len(alerts) == 1
    a = alerts[0]
    assert a["alert_type"] == rlw.ALERT_TYPE
    assert a["title"].startswith("Russian-flagged tanker BORACAY loitering 2")
    assert "off Denmark" in a["title"] or "off Sweden" in a["title"]
    assert a["severity"] in ("high", "critical")
    assert a["raw"]["link_reasons"] == ["Russian flag"]
    assert a["raw"]["hours_loitering"] >= 2
    assert a["lat"] == lat and a["lon"] == lon and a["entity_id"] == "273123450"
    assert "Russia link: Russian flag" in a["message"]
    # never a bare MMSI or a date
    assert not nc.is_dateish_title(a["title"])


def test_not_before_min_hours(coasts, ports):
    w = _watch(coasts, ports)
    lat, lon = OFF_DENMARK
    assert _run(w, lambda t: [_vessel("273123451", lat, lon)], hours=1.5) == []


def test_critical_inside_quadcopter_range_and_high_beyond(coasts, ports):
    lat, lon = OFF_DENMARK
    d = coasts.distances(lat, lon, 100)
    near = min(v for k, v in d.items() if k in rlw.EUROPE)
    w = _watch(coasts, ports)
    a = _run(w, lambda t: [_vessel("273123452", lat, lon)])[0]
    assert a["severity"] == ("critical" if near <= rlw.QUADCOPTER_KM else "high")
    # North Sea, ~60-90 km off the Danish/German coast: high.
    w2 = _watch(coasts, ports)
    far = _run(w2, lambda t: [_vessel("273123453", 55.6, 7.0)])
    assert len(far) == 1 and far[0]["severity"] == "high"
    assert far[0]["raw"]["distance_km"] > rlw.QUADCOPTER_KM


def test_russian_flag_in_russian_waters_no_alert(coasts, ports):
    w = _watch(coasts, ports)
    # Just off Kaliningrad (Baltiysk approaches), within 22 km of Russia.
    assert _run(w, lambda t: [_vessel("273123454", 54.75, 19.75)]) == []
    assert "Russian waters" in w.where(54.75, 19.75)["why"]


def test_russian_flag_under_way_no_alert(coasts, ports):
    w = _watch(coasts, ports)
    lat, lon = OFF_DENMARK
    assert _run(w, lambda t: [_vessel("273123455", lat, lon, speed=11.5)]) == []


def test_slow_but_turning_counts_up_to_3_knots(coasts, ports):
    w = _watch(coasts, ports)
    lat, lon = OFF_DENMARK
    # 2.5 kn while the course swings around the compass: circling.
    alerts = _run(w, lambda t: [_vessel("273123456", lat, lon, speed=2.5, cog=(t / 60 * 37) % 360)])
    assert len(alerts) == 1
    # 2.5 kn on a steady course is transit, not loitering.
    w2 = _watch(coasts, ports)
    assert _run(w2, lambda t: [_vessel("273123457", lat, lon, speed=2.5, cog=90.0)]) == []


def test_name_only_sanctions_match_never_links(coasts, ports):
    w = _watch(coasts, ports)
    lat, lon = OFF_DENMARK
    # A German-flagged ship called EAGLE S / PEGASUS, without the IMO: no link.
    vs = lambda t: [_vessel("211000001", lat, lon, name="EAGLE S"),
                    _vessel("211000002", lat, lon, name="PEGASUS")]
    assert _run(w, vs) == []
    assert rlw.russia_links({"mmsi": "211000001", "name": "EAGLE S"}, _index()) == []


def test_imo_confirmed_shadow_fleet_hull_alerts_with_its_reason(coasts, ports):
    w = _watch(coasts, ports)
    lat, lon = OFF_DENMARK
    alerts = _run(w, lambda t: [_vessel("518998865", lat, lon, name="EAGLE S", imo="9329760")])
    assert len(alerts) == 1
    a = alerts[0]
    assert a["title"].startswith("Shadow-fleet tanker EAGLE S loitering")
    assert "sanctioned by the EU and the UK as part of Russia's shadow fleet" in a["message"]
    assert "IMO 9329760 match" in a["message"]


def test_mmsi_match_with_contradicting_flag_is_dropped():
    # Listed as Panama; the MMSI now broadcasts Germany: a reassigned number.
    idx = {"imo": {}, "mmsi": {"211000003": {"authorities": {"the US"}, "shadow": False,
                                             "listed_flag": "pa"}}, "resolved": {}}
    assert rlw.russia_links({"mmsi": "211000003"}, idx) == []


def test_non_russian_programme_is_not_a_link():
    # A North Korea listing on the EU list is not a Russia link…
    assert rlw.classify_listing(["eu_sanctions_map"],
                                "Restrictive measures in relation to the non-proliferation "
                                "of weapons of mass destruction (DPRK)") is None
    assert rlw.classify_listing(["us_ofac_sdn"], "SDN List Executive Order 13599 (Iran) IRAN") is None
    # …while the Russia programmes are.
    c = rlw.classify_listing(["eu_journal_sanctions"],
                             "transport crude oil or petroleum products that originate in Russia "
                             "while practicing irregular and high-risk shipping practices")
    assert c == {"authority": "the EU", "shadow": True}
    assert rlw.classify_listing(["us_ofac_sdn"], "RUSSIA-EO14024 Block")["authority"] == "the US"
    assert rlw.classify_listing(["ua_war_sanctions"], "")["authority"] == rlw.GUR


def test_cooldown_one_alert_per_episode_and_same_place_after_restart(coasts, ports):
    lat, lon = OFF_DENMARK
    w = _watch(coasts, ports)
    first = _run(w, lambda t: [_vessel("273123458", lat, lon)], hours=6)
    assert len(first) == 1                                   # one per episode

    # A restart loses the in-memory state; the DB backstop remembers.
    db = [(T0 + 2 * H, lat, lon)]
    w2 = _watch(coasts, ports, recent_alert_lookup=lambda m, since: [h for h in db if h[0] >= since])
    t = T0 + 7 * H
    again = []
    while t <= T0 + 10 * H:
        again += w2.run_cycle([dict(_vessel("273123458", lat, lon), last_update=t)], now=t)
        t += 300
    assert again == []                                       # same place, inside 12 h


def test_new_episode_elsewhere_alerts_again(coasts, ports):
    w = _watch(coasts, ports)
    lat, lon = OFF_DENMARK

    def where(t):
        if t < T0 + 3 * H:
            return [_vessel("273123459", lat, lon)]
        if t < T0 + 4 * H:                                    # moves on at 12 kn
            return [_vessel("273123459", lat, lon + (t - T0 - 3 * H) / H * 0.3, speed=12.0)]
        return [_vessel("273123459", 55.6, 7.0)]              # loiters again, North Sea
    alerts = _run(w, where, hours=7)
    assert len(alerts) == 2
    assert alerts[0]["id"] != alerts[1]["id"]


def test_in_port_no_alert(coasts, ports):
    w = _watch(coasts, ports)
    # Copenhagen harbour.
    assert w.in_port(55.69, 12.60)[0]
    assert _run(w, lambda t: [_vessel("273123460", 55.69, 12.60)]) == []


def test_sea_of_azov_is_not_off_europe(coasts, ports):
    w = _watch(coasts, ports)
    assert not w.where(46.6, 36.6)["eligible"]


def test_reaches_people():
    alert = {"alert_type": rlw.ALERT_TYPE, "severity": "high", "lat": 55.3, "lon": 12.75,
             "title": "Russian-flagged tanker BORACAY loitering 3 h, 18 km off Denmark",
             "raw_json": {"reason": "Russian flag; 18 km off Denmark, within 25 km quadcopter range"}}
    v = nc.notification_relevance(alert)
    assert v["notify"] is True and v["sev"] == "high"
    assert "Russian flag" in v["reason"]
    assert nc.notification_kind(rlw.ALERT_TYPE) == "signal"
    assert nc.headline(alert) == alert["title"]              # never rebuilt
    assert rlw.ALERT_TYPE in general_feed.EVENT_TYPES
    crit = nc.notification_relevance({**alert, "severity": "critical"})
    assert crit["sev"] == "critical"


def test_high_alert_interrupts_so_it_can_push():
    import event_watch
    card = {"sev": "high", "kind": nc.notification_kind(rlw.ALERT_TYPE)}
    assert event_watch.interrupts(card)


def test_port_anchorage_inshore_is_in_port(coasts, ports):
    # Varna roads: 5.3 km from the WPI point but hugging the shore.
    w = _watch(coasts, ports)
    assert w.in_port(43.190, 27.902)[0]


def test_missing_ais_name_falls_back_to_the_listed_name(coasts, ports):
    w = _watch(coasts, ports)
    lat, lon = OFF_DENMARK
    a = _run(w, lambda t: [_vessel("518998865", lat, lon, name="", imo="9329760")])
    assert len(a) == 1 and "EAGLE S" in a[0]["title"] and "Unnamed" not in a[0]["title"]


def test_one_speed_blip_does_not_end_the_episode_but_two_do(coasts, ports):
    lat, lon = OFF_DENMARK
    blip = T0 + 1 * H
    w = _watch(coasts, ports)
    one = _run(w, lambda t: [_vessel("273123461", lat, lon, speed=1.9 if t == blip else 0.4)])
    assert len(one) == 1
    w2 = _watch(coasts, ports)
    two = _run(w2, lambda t: [_vessel("273123462", lat, lon,
                                      speed=1.9 if t in (blip, blip + 300) else 0.4)])
    assert two == []                      # clock restarted at 1h10m; only 1h20m by the end
