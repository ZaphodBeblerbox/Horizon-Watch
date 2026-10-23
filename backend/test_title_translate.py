"""Headlines in English: local detection, one cached translation per title,
batched calls, a marked original when the model is off."""
import json
import types

import pytest

import title_translate as tt

TR = "Fransa'da ohal! Tüm eylemler yasaklandı"
DA = "Midtvejsvalget i USA, urolighederne i Frankrig og diskriminerende aftale om førtidspension"


@pytest.fixture(autouse=True)
def fresh(tmp_path, monkeypatch):
    monkeypatch.setattr(tt, "_PATH", str(tmp_path / "title_translations.json"))
    monkeypatch.setattr(tt, "_CACHE", None)
    monkeypatch.setattr(tt, "_QUEUE", {})
    monkeypatch.setattr(tt, "_RETRY", {})
    monkeypatch.setattr(tt, "_DAY", {"day": "", "n": 0})
    monkeypatch.setattr(tt, "ENABLED", True)
    yield


def fake_model(calls):
    def tb(texts):
        calls.append(list(texts))
        return [{"en": f"EN: {t[:20]}", "lang": "xx"} for t in texts]
    return tb


def test_detection_is_local_and_leaves_english_alone():
    assert tt.needs_translation(TR) == "tr"
    assert tt.needs_translation(DA) == "da"
    assert tt.needs_translation("Missile launch at Суми") in ("ru", "uk", "bg", "mk")
    assert tt.needs_translation("Взрывы в Белгороде")
    assert tt.needs_translation("Polizei räumt Protestcamp in Berlin") == "de"
    for en in ("Drone strike on Ras Isa terminal", "Arrest at rue de Rivoli, Paris", "Kupyansk",
               "Russian Army expands control west of Kupyansk", "Possible sanctions match WENDRIX in the North Sea",
               "Police charge at Place de la République", ""):
        assert tt.needs_translation(en) is None, en


def test_english_items_are_returned_untouched_without_a_call(monkeypatch):
    calls = []
    monkeypatch.setattr(tt, "translate_batch", fake_model(calls))
    items = [{"title": "Explosion reported near Kharkiv"}]
    assert tt.apply(items, wait=True) is items
    assert calls == []


def test_cached_translation_is_used_and_the_original_kept(monkeypatch):
    calls = []
    monkeypatch.setattr(tt, "translate_batch", fake_model(calls))
    src = {"id": 1, "title": TR}
    out = tt.apply([src], wait=True)
    assert calls == [[TR]]
    assert out[0]["title"].startswith("EN: ") and out[0]["title_original"] == TR
    assert out[0]["title_translated"] is True
    assert src == {"id": 1, "title": TR}                       # a shared row is never changed
    again = tt.apply([{"id": 2, "title": TR}], wait=True)
    assert calls == [[TR]] and again[0]["title"] == out[0]["title"]   # paid once


def test_translations_survive_a_restart(monkeypatch):
    monkeypatch.setattr(tt, "translate_batch", fake_model([]))
    tt.apply([{"title": TR}], wait=True)
    with open(tt._PATH, encoding="utf-8") as fh:
        assert len(json.load(fh)) == 1
    monkeypatch.setattr(tt, "_CACHE", None)                   # a new process
    calls = []
    monkeypatch.setattr(tt, "translate_batch", fake_model(calls))
    out = tt.apply([{"title": TR}], wait=True)
    assert calls == [] and out[0]["title_translated"] is True


def test_titles_are_batched(monkeypatch):
    calls = []
    monkeypatch.setattr(tt, "translate_batch", fake_model(calls))
    items = [{"headline": f"Взрывы в Белгороде номер {i} сегодня"} for i in range(25)]
    out = tt.apply(items, ("headline",), wait=True)
    assert [len(c) for c in calls] == [20, 5]
    assert all(o["title_translated"] for o in out)


def test_a_request_never_waits_it_queues(monkeypatch):
    started = []
    monkeypatch.setattr(tt, "_RUNNING", types.SimpleNamespace(is_set=lambda: False, set=lambda: started.append(1), clear=lambda: None))
    monkeypatch.setattr(tt.threading, "Thread", lambda **kw: types.SimpleNamespace(start=lambda: None))
    out = tt.apply([{"title": TR}, {"title": DA}, {"title": TR}])
    assert list(tt._QUEUE.values()) == [TR, DA] and started
    assert out[0]["title"] == TR and out[0]["title_translated"] is False
    assert out[0]["title_lang_name"] == "Turkish" and out[1]["title_lang_name"] == "Danish"


def test_without_enqueue_only_the_cache_is_read(monkeypatch):
    out = tt.apply([{"headline": TR}], ("headline",), enqueue=False)
    assert tt._QUEUE == {} and out[0]["title_lang"] == "tr"


def test_model_off_falls_back_to_the_marked_original(monkeypatch):
    import openai_gate
    monkeypatch.setattr(openai_gate, "get_client", lambda purpose: None)
    out = tt.apply([{"title": TR}], wait=True)
    assert out[0]["title"] == TR and out[0]["title_translated"] is False and out[0]["title_lang_name"] == "Turkish"
    calls = []
    monkeypatch.setattr(tt, "translate_batch", fake_model(calls))
    tt.apply([{"title": TR}], wait=True)
    assert calls == []                                        # not asked again at once


def test_daily_cap(monkeypatch):
    calls = []
    monkeypatch.setattr(tt, "translate_batch", fake_model(calls))
    monkeypatch.setattr(tt, "PER_DAY", 3)
    out = tt.apply([{"title": f"Взрывы в Белгороде номер {i} сегодня"} for i in range(5)], wait=True)
    assert calls == [] and not any(o["title_translated"] for o in out)


def test_model_saying_english_is_remembered(monkeypatch):
    calls = []
    monkeypatch.setattr(tt, "translate_batch", lambda texts: calls.append(1) or [{"en": t, "lang": "en"} for t in texts])
    out = tt.apply([{"title": TR}], wait=True)
    assert "title_lang" not in out[0]
    tt.apply([{"title": TR}], wait=True)
    assert calls == [1]


def test_translate_batch_uses_the_enrich_purpose_and_reads_the_answer(monkeypatch):
    import openai_gate
    seen = {}

    class Comp:
        def create(self, **kw):
            seen.update(kw)
            msg = types.SimpleNamespace(content=json.dumps({"results": [
                {"n": 2, "lang": "da", "en": "US midterms, unrest in France"},
                {"n": 1, "lang": "tr", "en": "State of emergency in France! All protests banned"}]}))
            return types.SimpleNamespace(choices=[types.SimpleNamespace(message=msg)], usage=None)

    client = types.SimpleNamespace(chat=types.SimpleNamespace(completions=Comp()))
    purposes = []
    monkeypatch.setattr(openai_gate, "get_client", lambda p: purposes.append(p) or client)
    out = tt.translate_batch([TR, DA])
    assert purposes == [openai_gate.ENRICH]
    assert out[0] == {"en": "State of emergency in France! All protests banned", "lang": "tr"}
    assert out[1]["lang"] == "da"
    assert "1. Fransa" in seen["messages"][1]["content"] and "2. Midtvejs" in seen["messages"][1]["content"]
