"""briefing/collect.py and profile.py on a small synthetic store: what reaches
a Berlin substation and what does not (the owner's rule, 2026-10-07)."""
import datetime as dt
import sqlite3

import pytest

from briefing import collect, profile

NOW = dt.datetime(2026, 10, 7, 12, tzinfo=dt.timezone.utc)
UID = "u-1"


def _ts(days_ago, hours=0, sep=" "):
    return (NOW - dt.timedelta(days=days_ago, hours=hours)).replace(tzinfo=None).isoformat(sep=sep, timespec="seconds")


@pytest.fixture()
def db(tmp_path):
    p = tmp_path / "t.db"
    c = sqlite3.connect(p)
    c.executescript("""
    CREATE TABLE users (id TEXT, email TEXT, name TEXT, company TEXT, title TEXT, settings TEXT);
    CREATE TABLE owned_assets (id TEXT, owner_id TEXT, name TEXT, kind TEXT, lat REAL, lon REAL, radius_km REAL, country TEXT,
                               address TEXT, importance TEXT, shared INTEGER);
    CREATE TABLE alerts (alert_id TEXT, source TEXT, alert_type TEXT, title TEXT, severity TEXT, lat REAL, lon REAL, region TEXT,
                         country_code TEXT, entity_name TEXT, entity_type TEXT, raw_json TEXT, created_at TEXT, fire_count INTEGER);
    CREATE TABLE telegram_posts (channel TEXT, msg_id INTEGER, channel_title TEXT, posted_at TEXT, headline TEXT, summary_en TEXT,
                                 event_type TEXT, place TEXT, lat REAL, lon REAL, role TEXT, party TEXT, claim TEXT, first_hand INTEGER,
                                 media TEXT, thumb TEXT, graphic INTEGER, unpublished_reason TEXT, relevant INTEGER);
    """)
    c.execute("INSERT INTO users VALUES (?, 'a@b.c', 'A', 'Acme', 'Security', '{}')", (UID,))
    c.execute("INSERT INTO owned_assets VALUES ('OA-1', ?, 'Umspannwerk Mitte', 'substation', 52.52, 13.38, 20, 'Germany', '', 'high', 0)", (UID,))
    rows = [
        # the Baltic tanker: maritime, at sea — reaches no vector of a substation
        ("a1", "AIS", "Sanctioned Vessel", "Sanctioned vessel EAGLE S in the Baltic Sea", "high", 54.9, 13.9, 1),
        # substation sabotage elsewhere in Germany: a precedent
        ("a2", "OSINT", "incident", "Arson attack on substation near Cologne", "high", 50.94, 6.96, 1),
    ]
    for i, src, typ, title, sev, lat, lon, days in rows:
        c.execute("INSERT INTO alerts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)", (i, src, typ, title, sev, lat, lon, "", None, "", "", "{}", _ts(days)))
    # GPS interference over Germany on five days: one pattern, not five events
    for d in range(5):
        for k in range(4):
            c.execute("INSERT INTO alerts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)",
                      (f"g{d}{k}", "ADSB", "gps_interference", f"Satellite navigation degraded over 5{k}.2°N 1{k}.8°E", "medium",
                       50 + k, 10 + k, "", None, "", "", "{}", _ts(d, k + 1)))
    # a protest in Berlin, reported by Telegram and by a detector alert: one event, two families
    c.execute("INSERT INTO telegram_posts VALUES ('berlinnews', 7, 'Berlin News', ?, 'Protest blocks Friedrichstraße', 'Hundreds protest', "
              "'protest', 'Berlin', 52.52, 13.39, 'local', NULL, NULL, 1, 'none', NULL, 0, NULL, 1)", (_ts(1, sep="T") + "+00:00",))
    c.execute("INSERT INTO alerts VALUES ('p1','GDELT','protest','Protest blocks Friedrichstraße in Berlin','medium',52.521,13.385,'Berlin',"
              "NULL,'','','{}',?,1)", (_ts(1, 1),))
    c.commit()
    c.close()
    return str(p)


def test_derived_profile_has_a_vector_for_the_site_and_the_country(db):
    prof = profile.derive(UID, db)
    assert prof["org"] == "Acme"
    assert [s["name"] for s in prof["sites"]] == ["Umspannwerk Mitte"]
    keys = {v["key"] for v in prof["vectors"]}
    assert "group-energy" in keys and "country-germany" in keys
    energy = next(v for v in prof["vectors"] if v["key"] == "group-energy")
    assert "maritime" not in energy["categories"] and "unrest" in energy["categories"]


def test_saved_profile_is_cleaned_and_kept(db):
    prof = profile.save(UID, {"org": "Acme GmbH", "language": "xx", "vectors": [{"name": "Standort Berlin", "categories": ["unrest", "bogus"]}]}, db)
    assert prof["org"] == "Acme GmbH" and prof["language"] == "de"
    assert prof["vectors"][0]["categories"] == ["unrest"]
    assert profile.get(UID, db)["derived"] is False


def test_what_reaches_a_berlin_substation(db):
    prof = profile.derive(UID, db)
    out = collect.collect(prof, "weekly", start=NOW - dt.timedelta(days=7), end=NOW, db_path=db)
    titles = {e["title"]: e for e in out["events"]}
    assert not any("EAGLE S" in t for t in titles), "a sanctioned tanker at sea does not reach a substation"
    arson = next(e for t, e in titles.items() if "Arson" in t)
    assert arson["reach"] == "precedent" and arson["category"] == "sabotage"
    protest = next(e for t, e in titles.items() if "Protest" in t)
    assert protest["category"] == "unrest" and protest["reach"] == "site"
    assert protest["corroboration"] == 2 and protest["reports"] == 2


def test_standing_conditions_fold_into_one_pattern(db):
    prof = profile.derive(UID, db)
    out = collect.collect(prof, "weekly", start=NOW - dt.timedelta(days=7), end=NOW, db_path=db)
    gps = [e for e in out["events"] if e["detector"] == "gps_interference"]
    assert len(gps) == 1 and gps[0]["pattern"] and gps[0]["days_active"] == 5 and gps[0]["reports"] == 20
    assert out["funnel"]["read"] >= 23 and out["funnel"]["used"] == len(out["events"])
    ids = [e["sid"] for e in out["events"]]
    assert ids == sorted(ids) and len(set(ids)) == len(ids)
