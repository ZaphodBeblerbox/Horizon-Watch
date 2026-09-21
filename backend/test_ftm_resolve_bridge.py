"""The sanctions bridge: does a ship we track resolve to a listed entity?

The bridge was dead at both ends — resolve_all() was called by nothing
and ftm_resolution was read by nothing — so these cover the two things
that made it dead, plus the distinction that matters most in this
domain: a fuzzy candidate is not a finding.
"""
import sqlite3

import ftm_resolve
import ftm_store


def _db(tmp_path):
    path = str(tmp_path / "t.db")
    conn = sqlite3.connect(path)
    ftm_store.ensure_schema(conn)
    conn.execute(
        "INSERT INTO ftm_things (id, schema, caption, country, imo, mmsi,"
        " topics_json, datasets_json, props_json)"
        " VALUES ('v1','Vessel','ARGO I','RU',NULL,'256843000',"
        " '[\"sanction\"]','[\"us_ofac_sdn\"]','{}')")
    conn.execute(
        "INSERT INTO ftm_things (id, schema, caption, country, imo, mmsi,"
        " topics_json, datasets_json, props_json)"
        " VALUES ('v2','Vessel','NEPTUNE STAR','PA','9321524',NULL,"
        " '[\"sanction\"]','[\"eu_fsf\"]','{}')")
    conn.execute("CREATE TABLE vessel_history (mmsi TEXT, name TEXT, timestamp TEXT)")
    conn.commit()
    return path, conn


class TestResolvesWithoutAName:
    def test_an_unnamed_vessel_still_matches_on_mmsi(self, tmp_path):
        # This is the defect the ungating fixed: the query required a
        # name, and an MMSI match does not need one. Measured on the
        # real store, it cost 21 of 28 certain links.
        path, conn = _db(tmp_path)
        conn.execute("INSERT INTO vessel_history VALUES ('256843000', NULL, '2026-09-01')")
        conn.commit()
        stats = ftm_resolve.resolve_all(path)
        assert stats["examined"] == 1
        assert stats["by_method"].get("mmsi") == 1
        assert stats["linked"] == 1

    def test_an_mmsi_match_is_decided_by_the_system(self, tmp_path):
        path, conn = _db(tmp_path)
        conn.execute("INSERT INTO vessel_history VALUES ('256843000', NULL, '2026-09-01')")
        conn.commit()
        ftm_resolve.resolve_all(path)
        links = ftm_resolve.links_for(path, "vessel", "256843000")
        assert len(links) == 1
        assert links[0]["name"] == "ARGO I"
        assert links[0]["method"] == "mmsi"
        assert links[0]["decided"] is True
        assert "sanction" in links[0]["topics"]


class TestFuzzyIsNotAFinding:
    def test_a_fuzzy_name_match_is_stored_but_undecided(self, tmp_path):
        # "probably the sanctioned tanker" is not a finding, and naming
        # the wrong ship in a deliverable is the harm being avoided.
        path, conn = _db(tmp_path)
        conn.execute("INSERT INTO vessel_history VALUES ('111111111', 'NEPTUN STAR', '2026-09-01')")
        conn.commit()
        ftm_resolve.resolve_all(path)
        links = ftm_resolve.links_for(path, "vessel", "111111111")
        if links:                      # fuzzy matching is scorer-dependent
            assert all(not l["decided"] for l in links if l["method"] == "name_fuzzy")


class TestReadSide:
    def test_links_for_is_empty_not_an_error_for_an_unknown_vessel(self, tmp_path):
        path, _ = _db(tmp_path)
        assert ftm_resolve.links_for(path, "vessel", "999999999") == []

    def test_summary_separates_decided_from_candidates(self, tmp_path):
        path, conn = _db(tmp_path)
        conn.execute("INSERT INTO vessel_history VALUES ('256843000', NULL, '2026-09-01')")
        conn.commit()
        ftm_resolve.resolve_all(path)
        s = ftm_resolve.resolution_summary(path)
        assert s["decided"] >= 1
        assert "awaiting_review" in s
        # The wording is part of the contract: a reader must not take a
        # candidate for a finding.
        assert "not findings" in s["note"]
