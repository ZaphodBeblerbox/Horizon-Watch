"""A team member's shared position moves the person assets linked to them,
keeps a trail, and reads as live; other assets are untouched."""
import os

import owned_assets as oa


def test_live_position_moves_linked_people(tmp_path, monkeypatch):
    monkeypatch.setattr(oa, "_db_path", lambda: os.path.join(tmp_path, "t.db"))
    anna = oa.create("boss", {"name": "Anna", "kind": "person", "lat": 48.85, "lon": 2.35, "identifiers": {"user_id": "u-anna"}})
    site = oa.create("boss", {"name": "Office", "kind": "office", "lat": 48.85, "lon": 2.35})
    moved = oa.live_position("u-anna", 50.45, 30.52, 15)
    assert [m["id"] for m in moved] == [anna["id"]]
    a = oa.get(anna["id"], "boss")
    assert (a["lat"], a["lon"]) == (50.45, 30.52)
    assert oa.position(a)["source"] == "their phone, live"
    assert len(oa.track(anna["id"])) == 1
    assert oa.get(site["id"], "boss")["lat"] == 48.85
    assert oa.live_position("someone-else", 1, 1) == []


def test_position_out_of_range(tmp_path, monkeypatch):
    monkeypatch.setattr(oa, "_db_path", lambda: os.path.join(tmp_path, "t.db"))
    import pytest
    with pytest.raises(ValueError):
        oa.live_position("u", 95, 0)
