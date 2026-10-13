import copernicus_accounts as ca


def test_backup_takes_over_while_the_primary_quota_is_spent(monkeypatch):
    monkeypatch.setenv("COPERNICUS_CLIENT_ID", "primary")
    monkeypatch.setenv("COPERNICUS_CLIENT_SECRET", "s1")
    monkeypatch.setenv("COPERNICUS_CLIENT_ID_2", "backup")
    monkeypatch.setenv("COPERNICUS_CLIENT_SECRET_2", "s2")
    monkeypatch.setattr(ca, "_SATURATED", {})
    assert ca.active(now=1000)[0] == "primary"
    assert ca.is_quota_exhausted(403, '{"error":{"code":"ACCESS_INSUFFICIENT_PROCESSING_UNITS"}}')
    assert not ca.is_quota_exhausted(403, "forbidden")
    assert ca.mark_saturated("primary", now=1000) is True
    assert ca.active(now=1001)[0] == "backup"
    assert ca.active(now=1000 + ca.SATURATED_S + 1)[0] == "primary"     # tried again later
    assert ca.mark_saturated("backup", now=1002) is False
    assert ca.active(now=1003)[0] == "primary"                           # freed soonest


def test_without_a_backup_only_the_primary(monkeypatch):
    monkeypatch.setenv("COPERNICUS_CLIENT_ID", "primary")
    monkeypatch.setenv("COPERNICUS_CLIENT_SECRET", "s1")
    monkeypatch.delenv("COPERNICUS_CLIENT_ID_2", raising=False)
    monkeypatch.delenv("COPERNICUS_CLIENT_SECRET_2", raising=False)
    assert ca.accounts() == [("primary", "s1")]
