from locate import resolve


def _geo(table):
    return lambda q, cc: table.get(q, [])


def test_resolve_keeps_only_places_inside_the_country_and_never_model_coordinates():
    table = {
        "Al-Khawkhah, Hodeidah, Yemen": [{"lat": 13.80, "lon": 43.25, "country_code": "ye", "display_name": "Al Khawkhah"}],
        "Mokha, Yemen": [{"lat": 13.32, "lon": 43.25, "country_code": "ye", "display_name": "Mocha"}],
        "Djibouti City, Djibouti": [{"lat": 11.59, "lon": 43.14, "country_code": "dj"}],
    }
    cands = [
        {"place": "Al-Khawkhah, Hodeidah, Yemen", "why": "sign reads الخوخة", "confidence": 0.7, "lat": 1, "lon": 1},
        {"place": "Mokha, Taiz Governorate, Yemen", "why": "coastal road", "confidence": 0.4},   # resolves on "Mokha, Yemen"
        {"place": "Djibouti City, Djibouti", "why": "port cranes", "confidence": 0.2},            # other country: dropped
        {"place": "Nowhere Village, Yemen", "why": "?", "confidence": 0.1},                       # does not resolve
    ]
    out = resolve(cands, "YE", {"lat": 13.32, "lon": 43.25}, _geo(table))
    assert [c["resolved_as"] for c in out] == ["Al Khawkhah", "Mocha"]
    assert out[0]["lat"] == 13.80 and out[0]["km_from_post"] > 50
    assert out[1]["km_from_post"] == 0


def test_resolve_dedupes_the_same_spot():
    table = {"A, Mali": [{"lat": 12.6, "lon": -8.0, "country_code": "ml"}],
             "B, Mali": [{"lat": 12.6001, "lon": -8.0001, "country_code": "ml"}]}
    out = resolve([{"place": "A, Mali"}, {"place": "B, Mali"}], "ML", None, _geo(table))
    assert len(out) == 1 and out[0]["km_from_post"] is None


def test_set_located_moves_the_pin(tmp_path, monkeypatch):
    import telegram_ingest as t
    monkeypatch.setattr(t, "_db_path", lambda: str(tmp_path / "tg.db"))
    con = t._con()
    con.execute("INSERT INTO telegram_posts (channel, msg_id, posted_at, headline, lat, lon, role)"
                " VALUES ('ch', 5, datetime('now'), 'Convoy on the coast road', 13.3, 43.2, 'local')")
    con.commit(); con.close()
    assert t.set_located("ch", 5, {"lat": 13.81, "lon": 43.26, "heading_deg": 20, "junk": 1})
    p = t.published(24)[0]
    assert (p["lat"], p["lon"]) == (13.81, 43.26) and p["located"]["heading_deg"] == 20 and "junk" not in p["located"]
    assert t.set_located("ch", 5, None)
    assert t.published(24)[0]["lat"] == 13.3
    assert not t.set_located("ch", 6, {"lat": 1, "lon": 1})


def test_a_town_beats_its_province_of_the_same_name():
    from geocode_utils import prefer_settlement
    region = {"lat": 19.80, "lon": 0.73, "class": "boundary", "type": "administrative"}
    town = {"lat": 18.44, "lon": 1.41, "class": "place", "type": "city"}
    assert prefer_settlement([region, town])[0] is town
    assert prefer_settlement([region])[0] is region
