"""ontology_view: membership counted not drawn; records get a graph put
together from their own fields; units come with their order of battle."""
import json
import sqlite3

import ontology_view as ov


def _db(tmp_path):
    p = str(tmp_path / "g.db")
    c = sqlite3.connect(p)
    c.executescript("""
    CREATE TABLE graph_nodes (id TEXT PRIMARY KEY, type TEXT, label TEXT, country TEXT, lat REAL, lon REAL, risk REAL,
                              props_json TEXT, first_seen REAL, updated_at REAL);
    CREATE TABLE graph_edges (id TEXT PRIMARY KEY, src TEXT, dst TEXT, relation TEXT, conf REAL, method TEXT, basis TEXT,
                              events INTEGER, first_seen TEXT, last_seen TEXT, source_url TEXT, updated_at REAL);
    CREATE TABLE geoconfirmed_orbat_nodes (id INTEGER PRIMARY KEY, parent_id INTEGER, theatre_slug TEXT, name TEXT,
                              structure_path TEXT, is_deleted BOOLEAN, is_disbanded BOOLEAN, color TEXT, linked_system_id TEXT,
                              link_status TEXT, source_last_update TEXT, ingested_at TEXT, updated_at TEXT, flag_path TEXT);
    """)
    nodes = [("country:MT", "country", "Malta", None, 35.9, 14.4), ("country:UA", "country", "Ukraine", None, 49, 32),
             ("faction:47th mechanized brigade", "faction", "47th Mechanized Brigade", "UA", None, None),
             ("equipment:FPV", "equipment", "FPV", None, None, None),
             ("facility:UKKK", "facility", "Kyiv Zhuliany", "UA", 50.40, 30.45)]
    nodes += [(f"vessel:{i}", "vessel", f"SHIP {i}", "MT", None, None) for i in range(20)]
    c.executemany("INSERT INTO graph_nodes (id, type, label, country, lat, lon, props_json) VALUES (?,?,?,?,?,?,'{}')", nodes)
    edges = [(f"e{i}", f"vessel:{i}", "country:MT", "flagged in", 1.0) for i in range(20)]
    edges += [("u1", "faction:47th mechanized brigade", "equipment:FPV", "operates", 0.9)]
    c.executemany("INSERT INTO graph_edges (id, src, dst, relation, conf, method, events) VALUES (?,?,?,?,?,'t',1)", edges)
    c.executemany("INSERT INTO geoconfirmed_orbat_nodes (id, parent_id, theatre_slug, name, is_deleted, is_disbanded) VALUES (?,?,?,?,0,0)",
                  [(1, None, "ukraine", "Ukraine"), (2, 1, "ukraine", "Ukrainian Ground Forces"),
                   (3, 2, "ukraine", "47th Mechanized Brigade"), (4, 3, "ukraine", "1st Battalion"), (5, 2, "ukraine", "Another Brigade")])
    c.commit(); c.close()
    return p


def test_membership_is_counted(tmp_path):
    out = ov.view(_db(tmp_path), id="country:MT")
    counted = [n for n in out["nodes"] if n.get("count")]
    assert len(counted) == 1 and counted[0]["count"] == 20 and counted[0]["label"] == "20 vessels"
    assert not any(n["id"].startswith("vessel:") for n in out["nodes"])


def test_unit_has_orbat(tmp_path):
    out = ov.view(_db(tmp_path), id="faction:47th mechanized brigade")
    o = out["orbat"]
    assert [c["name"] for c in o["chain"]] == ["Ukraine", "Ukrainian Ground Forces"]
    assert [k["name"] for k in o["children"]] == ["1st Battalion"] and o["siblings"] == 1
    assert any(l["relation"] == "operates" for l in out["links"])


def test_orbat_walk(tmp_path):
    out = ov.view(_db(tmp_path), id="orbat:2")
    assert out["root"]["label"] == "Ukrainian Ground Forces"
    assert {n["label"] for n in out["nodes"]} >= {"Ukraine", "47th Mechanized Brigade", "Another Brigade"}


def test_record_gets_a_graph(tmp_path):
    rec = {"id": 7, "headline": "47th Mechanized Brigade strikes near Kyiv", "event_type": "strike", "place": "Kyiv",
           "country_code": "ua", "lat": 50.41, "lon": 30.46, "channel_title": "Probe channel"}
    out = ov.view(_db(tmp_path), entity_type="telegram", data=rec)
    rel = {(l["relation"], next(n["label"] for n in out["nodes"] if n["id"] == l["dst"])) for l in out["links"]}
    assert ("is a", "Strike") in rel and ("in", "Ukraine") in rel and ("at", "Kyiv") in rel
    assert ("involves", "47th Mechanized Brigade") in rel and ("near", "Kyiv Zhuliany") in rel
    assert ("reported by", "Probe channel") in rel
    assert out["orbat"]["unit"]["name"] == "47th Mechanized Brigade"
    json.dumps(out)


def test_named_place_resolves_to_its_node(tmp_path):
    out = ov.view(_db(tmp_path), entity_type="country", data={"name": "Ukraine"})
    assert out["root"]["id"] == "country:UA"
