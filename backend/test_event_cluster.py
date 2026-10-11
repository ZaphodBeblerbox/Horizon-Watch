"""event_cluster: one event, one signal — and never across places or days."""
import event_cluster as ec

RIYADH_AIRPORT = (24.957, 46.698)


def _it(i, head, at, lat=None, lon=None, cc=None, sev="high", src="x", **kw):
    return {"id": i, "headline": head, "at": at, "lat": lat, "lon": lon, "country_code": cc, "severity": sev, "source": src, **kw}


def test_saudi_airport_attack_is_one_event():
    items = [
        _it("a", "Riyadh airport attack", "2026-10-11T06:10:00", 24.71, 46.67, "sa", src="Telegram"),
        _it("b", "Houthis attack Saudi airport", "2026-10-11T06:40:00", *RIYADH_AIRPORT, "sa", src="GeoConfirmed"),
        _it("c", "12 people killed in Saudi airport attack", "2026-10-11T09:05:00", *RIYADH_AIRPORT, "sa", sev="critical", src="Telegram"),
        _it("d", "Houthis claim responsibility", "2026-10-11T11:30:00", cc="ye", src="Telegram"),
    ]
    # the claim is made from Yemen: its country differs, and it has no point
    # — so it is checked again with the country unknown, as such posts arrive
    items[3]["country_code"] = None
    out = ec.cluster(items)
    assert len(out) == 1, [o["headline"] for o in out]
    head = out[0]
    assert head["id"] == "c"                                  # the most severe and most informative leads
    assert head["also_count"] == 3
    assert {a["id"] for a in head["also"]} == {"a", "b", "d"}
    assert set(head["also_sources"]) == {"Telegram", "GeoConfirmed"}
    assert ec.also_line(head).startswith("+3 more reports")


def test_two_attacks_same_country_same_day_stay_separate():
    items = [
        _it("k", "Russian drone attack on Kharkiv power plant", "2026-10-11T03:00:00", 49.99, 36.23, "ua"),
        _it("o", "Russian drone attack on Odesa port", "2026-10-11T04:00:00", 46.48, 30.73, "ua"),
    ]
    assert len(ec.cluster(items)) == 2


def test_unplaced_reports_of_different_cities_stay_separate():
    items = [
        _it("k", "Russian drone attack on Kharkiv", "2026-10-11T03:00:00", cc="ua"),
        _it("o", "Russian drone attack on Odesa", "2026-10-11T04:00:00", cc="ua"),
    ]
    assert len(ec.cluster(items)) == 2


def test_same_place_far_apart_in_time_stays_separate():
    items = [
        _it("1", "Drone strike on Riyadh airport", "2026-10-10T01:00:00", *RIYADH_AIRPORT, "sa"),
        _it("2", "Drone strike on Riyadh airport", "2026-10-11T08:00:00", *RIYADH_AIRPORT, "sa"),
    ]
    assert len(ec.cluster(items)) == 2


def test_two_sanctioned_ships_in_one_strait_are_two_signals():
    items = [
        _it("s1", "Sanctioned vessel SMYRTOS in the English Channel", "2026-10-11T03:00:00", 50.5, -2.3, entity_id="613411302"),
        _it("s2", "Sanctioned vessel ARGO in the English Channel", "2026-10-11T03:30:00", 50.6, -2.1, entity_id="273000111"),
        _it("s3", "Sanctioned vessel SMYRTOS in the English Channel", "2026-10-11T05:00:00", 50.4, -2.0, entity_id="613411302"),
    ]
    out = ec.cluster(items)
    assert len(out) == 2
    assert next(o for o in out if o.get("entity_id") == "613411302")["also_count"] == 1


def test_precise_pins_on_one_front_are_separate_events():
    """GeoConfirmed pins 10 km apart on a front line are different strikes."""
    items = [
        _it("g1", "Russian tank destroyed by FPV drone near Pokrovsk", "2026-10-11T03:00:00", 48.28, 37.18, "ua", precise=True),
        _it("g2", "Russian tank destroyed by FPV drone near Pokrovsk", "2026-10-11T03:20:00", 48.37, 37.20, "ua", precise=True),
    ]
    assert len(ec.cluster(items)) == 2


def test_prefer_first_keeps_a_stable_headline():
    items = [
        _it("first", "Explosion at Riyadh airport", "2026-10-11T06:00:00", *RIYADH_AIRPORT, "sa"),
        _it("later", "Explosion at Riyadh airport, 12 killed in the attack on the terminal", "2026-10-11T07:00:00", *RIYADH_AIRPORT, "sa"),
    ]
    assert ec.cluster(items, prefer="first")[0]["id"] == "first"
    assert ec.cluster(items)[0]["id"] == "later"


def test_two_views_of_one_pinned_site_are_one_event():
    items = [
        _it("v1", "Point of view: a pink glow and smoke plume from the struck Yandex Cloud Vladimir Data Center", "2026-10-11T10:41:00",
            56.0993, 40.2012, precise=True),
        _it("v2", "Point of view: explosion from the direction of the reported strike on Yandex Cloud Vladimir Data Center",
            "2026-10-11T10:41:01", 56.0991, 40.2012, precise=True),
    ]
    assert len(ec.cluster(items)) == 1
