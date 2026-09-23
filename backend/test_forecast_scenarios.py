"""Scenarios the analyst builds and keeps."""
import sqlite3
import forecast_scenarios as fs


def _db():
    c = sqlite3.connect(":memory:")
    fs.ensure_schema(c)
    return c


def test_create_and_read_back():
    c = _db()
    r = fs.create(c, name="Narva", target="Estonia", aggressor="Russia",
                  target_place="Narva", target_lat=59.38, target_lon=28.19,
                  coa="ground", analogues=["Ukraine", "Sahel"])
    assert r["ok"]
    got = fs.get(c, r["id"])
    assert got["name"] == "Narva" and got["target_place"] == "Narva"
    assert got["analogues"] == ["Ukraine", "Sahel"]
    c.close()


def test_a_scenario_needs_both_sides():
    c = _db()
    assert not fs.create(c, name="x", target="", aggressor="Russia")["ok"]
    assert not fs.create(c, name="x", target="Estonia", aggressor="")["ok"]
    assert not fs.create(c, name="", target="Estonia", aggressor="Russia")["ok"]
    c.close()


def test_a_country_cannot_attack_itself():
    c = _db()
    r = fs.create(c, name="x", target="Estonia", aggressor="estonia")
    assert not r["ok"] and "same" in r["error"]
    c.close()


def test_listing_is_newest_first():
    c = _db()
    fs.create(c, name="A", target="Estonia", aggressor="Russia")
    b = fs.create(c, name="B", target="Sudan", aggressor="Chad")
    fs.update(c, b["id"], note="touched")
    assert fs.listing(c)[0]["name"] == "B"
    c.close()


def test_update_and_delete():
    c = _db()
    r = fs.create(c, name="A", target="Estonia", aggressor="Russia")
    assert fs.update(c, r["id"], coa="air")["ok"]
    assert fs.get(c, r["id"])["coa"] == "air"
    assert not fs.update(c, "nope", coa="air")["ok"]
    assert fs.delete(c, r["id"])["ok"]
    assert fs.get(c, r["id"]) is None
    assert not fs.delete(c, r["id"])["ok"]
    c.close()


def test_the_laydown_is_not_stored():
    # Only the inputs are kept. Freezing a picture would let a saved
    # scenario quietly disagree with the map it was drawn on.
    c = _db()
    cols = {r[1] for r in c.execute("PRAGMA table_info(forecast_scenarios)")}
    for banned in ("units", "laydown", "geojson", "rendered"):
        assert banned not in cols
    c.close()
