"""
Briefing generation: the evidence handed to the model, the output language,
and the section selection. Everything up to the API boundary.
"""
import json
import sqlite3
import os
import pytest

import report_draft as rd
import report_language as L
import llm_gate


# ── the language contract ────────────────────────────────────────────────
def test_three_languages_only():
    assert set(L.LANGUAGES) == {"en", "de", "fr"}


@pytest.mark.parametrize("given,want", [
    ("de", "de"), ("DE", "de"), ("de-DE", "de"), ("German", "de"), ("Deutsch", "de"),
    ("fr", "fr"), ("Français", "fr"), ("en", "en"),
    (None, "en"), ("", "en"), ("xx", "en"), ("klingon", "en"),
])
def test_normalise(given, want):
    assert L.normalise(given) == want


def test_identifiers_are_never_translated():
    """The failure this guards is silent and total.

    A model told to "write in German" will return "abschnitt":
    "seeaktivität"; every claim is then dropped by validation and the
    analyst gets an empty report with no error shown anywhere.
    """
    block = L.prompt_block("de")
    assert "item_id" in block and "cite_section" in block
    assert "maritime_activity" in block
    assert "silently discards the claim" in block


def test_likelihood_and_confidence_are_separate_scales():
    for code in ("en", "de", "fr"):
        block = L.prompt_block(code)
        assert "never put the two in the same sentence" in block.lower()
        assert len(L.spec(code)["bands"]) == 7
        assert len(L.spec(code)["confidence"]) == 3


def test_every_language_has_the_full_marking_vocabulary():
    keys = {"fact", "reported", "interested", "assessment", "assumption",
            "gap", "forecast", "observation"}
    for code, spec in L.LANGUAGES.items():
        assert set(spec["marks"]) == keys, code
        # and they are actually translated, not copied
    assert L.spec("de")["marks"]["fact"] == "[FAKT]"
    assert L.spec("fr")["marks"]["gap"] == "[LACUNE]"


# ── the evidence the model receives ──────────────────────────────────────
def _snapshot():
    path = os.path.join(os.path.dirname(__file__), "data", "akili.db")
    if not os.path.exists(path):
        pytest.skip("no local database")
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    row = db.execute("SELECT content_json FROM report_snapshots ORDER BY rowid DESC LIMIT 1").fetchone()
    if not row:
        pytest.skip("no snapshots in database")
    return json.loads(row[0])


def test_candidates_carry_when_and_where():
    """The model was drafting a DATED situation report from evidence with no
    dates. Every snapshot item has created_at and lat/lon; none of it
    reached the prompt."""
    snap = _snapshot()
    cands = rd._candidate_items(snap, ["ais_anomalies"])
    if not cands:
        pytest.skip("no AIS anomalies in this snapshot")
    c = cands[0]
    assert c["when"], "no timestamp reached the prompt"
    assert c["where"] or c["coords"], "no place reached the prompt"
    assert c["basis"], "which detector fired never reached the prompt"


def test_detector_name_is_not_passed_off_as_a_place():
    """AIS rows carry the DETECTOR NAME in location_name — the real value is
    'AIS_DARK_SHIP', not a port. Passed through, the model writes 'a vessel
    off AIS_DARK_SHIP'."""
    item = {"signal_id": "x", "location_name": "AIS_DARK_SHIP", "rule_name": "AIS_DARK_SHIP",
            "lat": 59.35, "lon": 18.85, "created_at": "2026-09-17T19:03:00Z"}
    out = rd._candidate_items({"ais_anomalies": [item]}, ["ais_anomalies"])[0]
    assert out["where"] is None
    assert out["coords"] == "59.35N 18.85E"
    assert "AIS_DARK_SHIP" not in rd._format_candidates([out]).split("basis=")[0]


def test_corroboration_counts_distinct_modalities():
    """The two-independent-sources test the product is built on. Without it a
    four-modality fusion and a single unconfirmed report read identically."""
    assert rd._corroboration({"domains": ["AIS", "NEWS", "ADSB"]}) == 3
    assert rd._corroboration({"domains": ["AIS", "AIS"]}) == 1
    assert rd._corroboration({"key_signals": [{"domain": "AIS"}, {"domain": "NEWS"}]}) == 2
    assert rd._corroboration({}) is None


def test_truncation_is_stated_not_silent():
    """Otherwise the model writes 'the only activity observed' about a sample."""
    items = [{"signal_id": f"s{i}", "created_at": "2026-09-17T19:03:00Z"} for i in range(30)]
    cands = rd._candidate_items({"ais_anomalies": items}, ["ais_anomalies"], limit=12)
    text = rd._format_candidates(cands)
    assert "of 30 real items" in text
    assert "do not write as though these were the only ones" in text


def test_empty_category_is_described_as_empty():
    assert "genuinely nothing real" in rd._format_candidates([])


def test_provenance_travels_as_two_axes():
    item = {"signal_id": "x", "created_at": "2026-01-01T00:00:00Z",
            "origin_class": "B", "licence_tier": "T1"}
    text = rd._format_candidates(rd._candidate_items({"ais_anomalies": [item]}, ["ais_anomalies"]))
    assert "origin_class=B" in text and "licence_tier=T1" in text


# ── section selection ────────────────────────────────────────────────────
def test_all_sections_on_adds_no_instruction():
    assert rd._sections_block(list(rd._DOC_SECTION_LABELS)) == ""
    assert rd._sections_block(None) == ""


def test_turning_a_section_off_actually_changes_the_request():
    block = rd._sections_block(["executive_judgement", "signal_assessment"])
    assert "Return an EMPTY warnings list." in block
    assert "Return an EMPTY actions list." in block


def test_dropping_sourcing_keeps_citations():
    """Citations are how claims are validated — losing them empties the
    report rather than shortening it."""
    block = rd._sections_block(["executive_judgement", "indicators_warnings", "recommended_actions"])
    assert "cite item_ids exactly as required" in block


# ── the gate ─────────────────────────────────────────────────────────────
def test_only_briefing_by_default(monkeypatch):
    """The council is off too: it is a SECOND model call per report on top of
    the draft, and with credit scarce the draft is what earns the spend."""
    monkeypatch.delenv("HW_LLM_PURPOSES", raising=False)
    assert llm_gate.allowed_purposes() == frozenset({"briefing"})
    for off in ("council", "fusion_narrative", "chat", "imagery",
                "article_intelligence", "forge"):
        assert not llm_gate.is_enabled(off), off


def test_disabled_purpose_returns_none_not_an_exception(monkeypatch):
    """None is the state every call site already handles — running without an
    API key has always been supported. Raising would turn a disabled feature
    into a 500."""
    monkeypatch.delenv("HW_LLM_PURPOSES", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-not-real")
    assert llm_gate.get_client("chat") is None


def test_gate_is_reversible(monkeypatch):
    monkeypatch.setenv("HW_LLM_PURPOSES", "all")
    assert llm_gate.is_enabled("fusion_narrative")
    monkeypatch.setenv("HW_LLM_PURPOSES", "briefing,chat")
    assert llm_gate.is_enabled("chat") and not llm_gate.is_enabled("forge")


# ── the full loop, with the model stubbed ────────────────────────────────
class _Block:
    type = "text"
    def __init__(self, text): self.text = text

class _Usage:
    input_tokens = output_tokens = 0

class _Resp:
    def __init__(self, text): self.content = [_Block(text)]; self.usage = _Usage()

class _Stream:
    """The call is STREAMED now (the SDK refuses a non-streaming request whose
    ceiling could run past ten minutes), so the stub has to be a context
    manager too."""
    def __init__(self, resp): self._resp = resp
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def get_final_message(self): return self._resp


class _Messages:
    def __init__(self, outer): self._outer = outer
    def _record(self, kw):
        self._outer.prompt = kw["messages"][0]["content"]
        self._outer.system = kw.get("system", "")
        self._outer.tools = kw.get("tools")
    def create(self, **kw):
        self._record(kw)
        return _Resp(self._outer.reply)
    def stream(self, **kw):
        self._record(kw)
        return _Stream(_Resp(self._outer.reply))

class StubClient:
    """Stands in for Anthropic so the whole loop is exercised: prompt built,
    response parsed, claims validated against real ids."""
    def __init__(self, reply): self.reply = reply; self.prompt = None; self.system = None; self.tools = None
    @property
    def messages(self): return _Messages(self)


_REAL_ID = "darkship_TEST_1"
_SNAP = {"ais_anomalies": [{
    "signal_id": _REAL_ID, "created_at": "2026-09-17T19:03:00Z", "lat": 59.35, "lon": 18.85,
    "location_name": "AIS_DARK_SHIP", "rule_name": "AIS_DARK_SHIP", "domain": "AIS",
    "severity": "medium", "summary": "MMSI 265630250 has not reported for 163 min.",
}]}


def _german_reply(item_id=_REAL_ID):
    return json.dumps({
        "key_judgments": "[FAKT] Ein Schiff meldete seit 163 Minuten keine AIS-Position.",
        "claims": [{"section": "maritime_activity",
                    "text": "[GEMELDET] AIS-Ausfall in der Ostsee, wahrscheinlich (55-80 %), Konfidenz mittel.",
                    "cite_section": "ais_anomalies", "item_id": item_id}],
        "sections": [{"key": "maritime_activity", "heading": "AIS-Ausfall in der Ostsee",
                      "paragraphs": ["Ein Schiff meldete seit 163 Minuten keine Position."],
                      "implication": "Die Ostsee-Zufahrten sind betroffen."}],
        "second_para": "Der Vorgang betrifft die Ostsee-Zufahrten.",
        "bottom_line": "Ein AIS-Ausfall allein trägt keine Bewertung.",
        "warnings": ["Weitere Ausfälle im selben Seegebiet"],
        "actions": [["Nachverfolgung", "Wachhabender Analyst", "D+2"]],
    }, ensure_ascii=False)


def test_german_run_reaches_the_model_and_comes_back_validated():
    stub = StubClient(_german_reply())
    res = rd.generate_draft(snapshot_content=_SNAP, focus="Ostsee", region_label="Baltic",
                            client=stub, usage_tracker_mod=None, language="de")
    assert res["status"] == "ok", res
    # the language instruction actually reached the model
    assert "German (Deutsch)" in stub.prompt
    assert "[FAKT]" in stub.prompt and "[BEWERTUNG]" in stub.prompt
    # the evidence carried its own when/where/basis
    assert "when=17SEP 1903Z" in stub.prompt
    assert "at=59.35N 18.85E" in stub.prompt
    assert "basis=AIS_DARK_SHIP" in stub.prompt
    # and the German claim survived validation with its citation intact
    assert len(res["claims"]) == 1
    assert res["claims"][0]["citation"]["item_id"] == _REAL_ID
    assert "wahrscheinlich" in res["claims"][0]["text"]


def test_french_and_english_reach_the_model_too():
    for code, needle in (("fr", "French (Français)"), ("en", "Write all prose in English")):
        stub = StubClient(_german_reply())
        rd.generate_draft(snapshot_content=_SNAP, focus="x", region_label=None,
                          client=stub, usage_tracker_mod=None, language=code)
        assert needle in stub.prompt, code


def test_a_claim_citing_an_id_we_never_offered_is_dropped():
    """The model inventing a plausible id is the failure mode that matters;
    it must not be silently rewritten into something that validates."""
    stub = StubClient(_german_reply(item_id="darkship_INVENTED_999"))
    res = rd.generate_draft(snapshot_content=_SNAP, focus="x", region_label=None,
                            client=stub, usage_tracker_mod=None, language="de")
    assert res["status"] == "ok"
    cited = [c for c in res["claims"] if c.get("citation", {}).get("item_id") == "darkship_INVENTED_999"]
    assert not cited, "a fabricated item_id survived validation"


def test_no_client_degrades_honestly_rather_than_inventing():
    res = rd.generate_draft(snapshot_content=_SNAP, focus="x", region_label=None,
                            client=None, usage_tracker_mod=None, language="de")
    assert res["status"] in ("skipped", "error")
    assert not res.get("claims")


def test_the_token_ceiling_is_large_enough_for_a_real_snapshot():
    """6000, then 16000, truncated the reply mid-JSON on a real global snapshot, and the
    parser then reported "could not parse model response" — which pointed at
    the parser rather than the budget, and is why briefings came back empty."""
    src = open(os.path.join(os.path.dirname(__file__), "report_draft.py"), encoding="utf-8").read()
    assert '"max_tokens": 32000' in src
    assert "6000" not in src.split("create_kwargs")[1][:400]


def test_a_truncated_reply_says_it_was_truncated():
    """Naming the wrong failure costs a debugging cycle every time."""
    src = open(os.path.join(os.path.dirname(__file__), "report_draft.py"), encoding="utf-8").read()
    assert 'stop_reason", None) == "max_tokens"' in src
    assert "stopped" in src and "mid-answer" in src


def test_the_failure_reason_reaches_the_operator():
    """ai_draft_reason was returned by the endpoint and never rendered, so a
    failure showed as "ai_draft_status=error" and nothing else."""
    gen = open(os.path.join(os.path.dirname(__file__), "..", "src", "reports", "Generate.jsx"),
               encoding="utf-8").read()
    assert "draftRes.ai_draft_reason" in gen
    assert "draft not usable" in gen


def test_citation_markup_never_reaches_the_reader():
    """Claude marks web-sourced sentences with its own tags:
        (cite index="22-9">Pskov is surrounded by NATO members</cite>
    Useful signal, unreadable in a deliverable. A client-facing report cannot
    ship with tag soup mid-sentence."""
    out = rd.strip_cite_markup(
        '[FACT] Pskov matters because (cite index="22-9">it borders Estonia and Latvia</cite> , '
        'and its airfield is a target.')
    assert "cite index" not in out and "</cite>" not in out
    assert "it borders Estonia and Latvia, and its airfield" in out


def test_the_report_asks_for_prose_not_a_list():
    src = open(os.path.join(os.path.dirname(__file__), "report_draft.py"), encoding="utf-8").read()
    assert "continuous analytical prose" in src.lower()
    assert "REFERENCE POINTS, not the content" in src
    # and an implication sentence per section, or the section is dropped
    assert '"implication"' in src


def test_research_is_on_and_can_be_switched_off():
    src = open(os.path.join(os.path.dirname(__file__), "report_draft.py"), encoding="utf-8").read()
    assert "web_search_20250305" in src
    assert "research: bool = True" in src
    assert "if research:" in src


def test_a_section_with_no_paragraphs_is_dropped():
    """A section that cannot say anything is filler, not a section."""
    src = open(os.path.join(os.path.dirname(__file__), "report_draft.py"), encoding="utf-8").read()
    assert "if not paras:" in src and "continue" in src
