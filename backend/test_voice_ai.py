from routers.voice_ai import read_answer

CTX = {"people": [{"id": 7, "name": "Hannes Weber", "kind": "user"}], "selected": False, "page": "home"}


def test_steps_are_checked_one_by_one():
    out = read_answer({"steps": [
        {"intent": "layer", "slots": {"layer": "heat", "on": True}},
        {"intent": "navigate", "slots": {"place": "Yemen"}},
        {"intent": "delete_everything", "slots": {}},                 # not on the list
        {"intent": "navigate", "slots": {"place": "Mali"}},           # beyond three steps
    ]}, CTX)
    assert out["ok"] and [s["intent"] for s in out["steps"]] == ["layer", "navigate"]
    assert out["steps"][0]["slots"] == {"layer": "heat", "on": True}
    assert out["intent"] == "layer"                                   # first step on top, for older callers


def test_pages_layers_and_zoom_only_from_their_lists():
    assert read_answer({"steps": [{"intent": "open_page", "slots": {"page": "map"}}]}, CTX)["steps"][0]["slots"] == {"page": "situation"}
    assert not read_answer({"steps": [{"intent": "open_page", "slots": {"page": "admin"}}]}, CTX)["ok"]
    assert not read_answer({"steps": [{"intent": "layer", "slots": {"layer": "nukes", "on": True}}]}, CTX)["ok"]
    assert read_answer({"steps": [{"intent": "layer", "slots": {"layer": "GDELT", "on": None}}]}, CTX)["steps"][0]["slots"]["on"] is None
    assert not read_answer({"steps": [{"intent": "zoom", "slots": {"direction": "sideways"}}]}, CTX)["ok"]
    assert read_answer({"steps": [{"intent": "search", "slots": {"query": "Pegasus"}}]}, CTX)["steps"][0]["slots"]["query"] == "Pegasus"
    assert not read_answer({"steps": [{"intent": "search", "slots": {"query": " "}}]}, CTX)["ok"]


def test_old_single_intent_answers_still_read():
    out = read_answer({"intent": "navigate", "slots": {"place": "Dubai"}, "confidence": 0.9}, CTX)
    assert out["ok"] and out["steps"][0]["slots"]["place"] == "Dubai" and out["confidence"] == 0.9


def test_nothing_to_do_is_said_plainly():
    assert read_answer({"steps": []}, CTX) == {"ok": False, "intent": None, "steps": [],
                                              "why": "That did not resolve to anything this console can do."}
