"""
Real test for Part 6 of the correlation-engine deepening pass: the
deterministic narrative validator in fusion_engine.py must catch a model
response that names something not present in the real input bundle, and
the regenerate-then-fallback flow must engage correctly rather than
shipping a hallucinated fact. Script-style, matches this directory's
existing test_*.py convention.
"""
import os
import sys
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fusion_engine import FusionEngine  # noqa: E402

FAILURES = []


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


fe = FusionEngine()

real_signals = [
    {"domain": "AIS", "rule_name": "Sanctioned Vessel", "summary": "Vessel Shturman Albanov detected loitering"},
    {"domain": "NEWS", "rule_name": "Port Disruption",   "summary": "Reports of disruption near Piraeus port"},
]
real_domains = {"AIS", "NEWS"}
real_location = "Piraeus Port Approach"


def _mock_msg(text):
    m = MagicMock()
    m.content = [MagicMock(text=text)]
    m.usage = MagicMock(input_tokens=100, output_tokens=50)  # real numeric usage — the 2026-09 spend-audit round's usage_tracker.record_call() needs real ints, not an auto-generated MagicMock
    return m


HALLUCINATED_JSON = """{
  "title": "Piraeus Escalation",
  "subtitle": "AIS + NEWS convergence",
  "narrative": "The vessel MV Blackwater Runner was seen departing Piraeus under escort of the Hellenic Coast Guard.",
  "key_signals": ["MV Blackwater Runner spotted near the port"],
  "threat_indicators": ["Possible smuggling operation involving MV Blackwater Runner"]
}"""

CLEAN_JSON = """{
  "title": "Piraeus Port Disruption",
  "subtitle": "AIS + NEWS convergence",
  "narrative": "A sanctioned vessel was detected loitering near Piraeus Port Approach while news reports describe a port disruption in the same area.",
  "key_signals": ["Sanctioned vessel detected loitering", "Port disruption reported"],
  "threat_indicators": ["Sanctions-evasion activity near the port"]
}"""

# ── 1. Validator itself: a hallucinated vessel name is caught ──────────────
print("1. _validate_narrative() catches an unsupported named entity")

ok, violations = FusionEngine._validate_narrative(
    "The vessel MV Blackwater Runner was seen departing under escort.",
    ["MV Blackwater Runner spotted near the port"],
    ["Possible smuggling operation involving MV Blackwater Runner"],
    real_signals, real_domains, real_location, [],
)
check("hallucinated vessel name not in the bundle is flagged as a violation",
      not ok and any("Blackwater" in v for v in violations), f"ok={ok} violations={violations}")

ok2, violations2 = FusionEngine._validate_narrative(
    "A sanctioned vessel was detected loitering near Piraeus Port Approach.",
    ["Sanctioned vessel detected loitering"], ["Sanctions-evasion activity near the port"],
    real_signals, real_domains, real_location, [],
)
check("a narrative using only real bundle facts passes validation",
      ok2, f"ok={ok2} violations={violations2}")


# ── 2. Full _generate_haiku_assessment(): first response hallucinates, ────
#    regenerates once, second response is clean -> clean narrative ships. ──
print("2. regenerate-once flow: hallucination then a clean retry")

call_count = {"n": 0}


def _fake_create(**kwargs):
    call_count["n"] += 1
    return _mock_msg(HALLUCINATED_JSON if call_count["n"] == 1 else CLEAN_JSON)


with patch("anthropic.Anthropic") as MockAnthropic:
    instance = MockAnthropic.return_value
    instance.messages.create.side_effect = _fake_create
    title, subtitle, narrative, key_signals, threat_indicators = fe._generate_haiku_assessment(
        real_signals, real_domains, "high", real_location, score={"strength": 72.0, "components": {}, "shared_entities": []}
    )
check("exactly 2 model calls were made (1 original + 1 regeneration)",
      call_count["n"] == 2, f"calls={call_count['n']}")
check("the shipped narrative is the CLEAN regenerated one, not the hallucinated first attempt",
      "Blackwater" not in narrative and "Piraeus" in narrative, f"narrative={narrative!r}")


# ── 3. Both attempts hallucinate -> falls back to the deterministic ───────
#    template narrative (no LLM), never ships a hallucinated fact. ────────
print("3. both attempts hallucinate -> deterministic template fallback engages")

call_count2 = {"n": 0}


def _fake_create_always_bad(**kwargs):
    call_count2["n"] += 1
    return _mock_msg(HALLUCINATED_JSON)


with patch("anthropic.Anthropic") as MockAnthropic2:
    instance2 = MockAnthropic2.return_value
    instance2.messages.create.side_effect = _fake_create_always_bad
    title3, subtitle3, narrative3, key_signals3, threat_indicators3 = fe._generate_haiku_assessment(
        real_signals, real_domains, "high", real_location, score={"strength": 72.0, "components": {}, "shared_entities": []}
    )
check("exactly 2 model calls were made before falling back (no infinite retry loop)",
      call_count2["n"] == 2, f"calls={call_count2['n']}")
check("fallback is the real deterministic template — never ships the hallucinated vessel name",
      "Blackwater" not in narrative3 and real_location in narrative3, f"narrative={narrative3!r}")
check("fallback title matches the real deterministic template format",
      title3 == f"{real_location} Intelligence Event", f"title={title3!r}")


print("=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
else:
    print("  RESULT: ALL CHECKS PASSED")
print("=" * 70)

if __name__ == "__main__":
    sys.exit(1 if FAILURES else 0)
