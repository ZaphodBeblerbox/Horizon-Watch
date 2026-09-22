"""Manufacturer links for equipment.

Network is never touched: a fake fetcher stands in, so these test the
parsing and the failure behaviour rather than Wikidata's uptime.
"""
import urllib.error
import equipment_makers as em
import equipment as eq


def _fake(entities_by_call):
    calls = {"n": 0}

    def fetcher(params):
        i = calls["n"]
        calls["n"] += 1
        return {"entities": entities_by_call[min(i, len(entities_by_call) - 1)]}
    return fetcher


def test_every_curated_qid_is_a_real_gazetteer_system():
    # A maker attached to a system the extractor cannot find is a maker
    # nothing will ever reach.
    for name in em.QIDS:
        assert eq.kind_of(name), f"{name} is not in the equipment gazetteer"


def test_every_curated_entry_records_why_it_was_matched():
    # Wikidata search is fuzzy — "IRIS-T" returns a plant genus and
    # "HIMARS" a South African model — so each id carries the
    # description that justified it.
    for name, (qid, desc) in em.QIDS.items():
        assert qid.startswith("Q") and qid[1:].isdigit(), name
        assert desc and len(desc) > 8, name


def test_it_parses_manufacturer_and_origin(tmp_path, monkeypatch):
    monkeypatch.setattr(em, "_CACHE", tmp_path / "c.json")
    systems = {
        "Q17501733": {
            "labels": {"en": {"value": "Bayraktar TB2"}},
            "claims": {
                "P176": [{"mainsnak": {"datavalue": {"value": {"id": "Q-BAYKAR"}}}}],
                "P495": [{"mainsnak": {"datavalue": {"value": {"id": "Q-TR"}}}}],
            },
        },
    }
    labels = {
        "Q-BAYKAR": {"labels": {"en": {"value": "Baykar"}}},
        "Q-TR": {"labels": {"en": {"value": "Turkey"}}},
    }
    out = em.sync(force=True, fetcher=_fake([systems, labels]))
    assert out["available"] is True
    b = out["systems"]["Bayraktar"]
    assert b["manufacturers"] == ["Baykar"]
    assert b["origin"] == ["Turkey"]
    assert "wikidata.org" in b["source_url"]


def test_a_system_wikidata_does_not_return_is_simply_absent(tmp_path, monkeypatch):
    monkeypatch.setattr(em, "_CACHE", tmp_path / "c.json")
    out = em.sync(force=True, fetcher=_fake([{}, {}]))
    assert out["systems"] == {}


def test_a_claim_with_no_value_is_skipped_not_crashed(tmp_path, monkeypatch):
    monkeypatch.setattr(em, "_CACHE", tmp_path / "c.json")
    systems = {"Q155658": {"claims": {"P176": [{"mainsnak": {}}, {}]}}}
    out = em.sync(force=True, fetcher=_fake([systems, {}]))
    assert out["systems"]["T-72"]["manufacturers"] == []


def test_rate_limiting_keeps_the_cache_and_names_the_reason(tmp_path, monkeypatch):
    # Wikidata's query service was rate-limiting to about one request a
    # minute while this was written. "No manufacturers" and "Wikidata
    # would not answer" are different states.
    cache = tmp_path / "c.json"
    monkeypatch.setattr(em, "_CACHE", cache)
    good = {"Q155658": {"claims": {"P176": [
        {"mainsnak": {"datavalue": {"value": {"id": "Q-UVZ"}}}}]}}}
    em.sync(force=True, fetcher=_fake([good, {"Q-UVZ": {"labels": {"en": {"value": "Uralvagonzavod"}}}}]))

    def boom(_params):
        raise urllib.error.HTTPError("u", 429, "Too Many Requests", None, None)

    out = em.sync(force=True, fetcher=boom)
    assert out["error"] == "HTTP 429"
    assert out["systems"]["T-72"]["manufacturers"] == ["Uralvagonzavod"]


def test_with_no_cache_and_no_network_it_returns_nothing_not_a_guess(tmp_path, monkeypatch):
    # An absent manufacturer is a gap; an invented one is a lie the
    # sanctions bridge would then act on.
    monkeypatch.setattr(em, "_CACHE", tmp_path / "missing.json")

    def boom(_params):
        raise urllib.error.URLError("offline")

    out = em.sync(force=True, fetcher=boom)
    assert out["available"] is False
    assert out["systems"] == {}
    assert em.makers() == {}


def test_makers_never_calls_the_network(tmp_path, monkeypatch):
    monkeypatch.setattr(em, "_CACHE", tmp_path / "none.json")
    monkeypatch.setattr(em, "_api", lambda *_a, **_k: (_ for _ in ()).throw(
        AssertionError("makers() must not hit the network")))
    assert em.makers() == {}


def test_entities_are_batched_not_one_call_each():
    seen = {}

    def fetcher(params):
        seen["ids"] = params["ids"]
        return {"entities": {}}
    em._entities(["Q1", "Q2", "Q3"], fetcher=fetcher)
    assert seen["ids"] == "Q1|Q2|Q3", "must be one request for all of them"
