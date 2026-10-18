"""A new risk-index formula re-baselines the saved bands silently instead
of announcing every country whose band moved as an escalation."""
import live_notifications as ln


def test_formula_change_rebaselines_without_notifications(tmp_path, monkeypatch):
    monkeypatch.setattr(ln, "_RISK_STATE", tmp_path / "risk_band_state.json")
    ln._save_bands({"FRA": 2, "UKR": 3})                       # old formula, no marker
    rows = [{"iso_code": "FRA", "band": 4, "score": 70}, {"iso_code": "UKR", "band": 5, "score": 80}]
    assert ln.risk_change_items(rows) == []
    saved = ln._load_bands()
    assert saved[ln._FORMULA_KEY] == ln.RISK_FORMULA and saved["FRA"] == 4


def test_same_formula_still_reports_band_moves(tmp_path, monkeypatch):
    monkeypatch.setattr(ln, "_RISK_STATE", tmp_path / "risk_band_state.json")
    ln._save_bands({"FRA": 2, ln._FORMULA_KEY: ln.RISK_FORMULA})
    out = ln.risk_change_items([{"iso_code": "FRA", "band": 4, "score": 70,
                                 "explanation": "GDELT and News (RSS) agree it is elevated."}])
    assert len(out) == 1 and out[0]["notify"]
    assert "agree it is elevated" in out[0]["reason"]
