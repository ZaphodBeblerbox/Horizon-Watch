import sanctions_loader as sl


def test_a_name_match_against_a_different_flag_is_not_the_sanctioned_ship(monkeypatch):
    monkeypatch.setattr(sl.sanctions_loader, "check_vessel",
                        lambda mmsi=None, name=None: {"name": "PEGASUS", "flag": "Barbados", "_match_type": "exact_name"})
    sl._sanctions_alert_cooldown.clear()
    assert sl.check_sanctions_for_vessel("211551140", name="PEGASUS") is None       # German tour boat


def test_a_name_match_with_the_same_flag_counts(monkeypatch):
    monkeypatch.setattr(sl.sanctions_loader, "check_vessel",
                        lambda mmsi=None, name=None: {"name": "PEGASUS", "flag": "Barbados", "_match_type": "exact_name"})
    sl._sanctions_alert_cooldown.clear()
    import database
    monkeypatch.setattr(database, "get_db", lambda: (_ for _ in ()).throw(RuntimeError("no db in test")))
    r = sl.check_sanctions_for_vessel("314123456", name="PEGASUS")
    assert r and r["status"] == "confirmed"
