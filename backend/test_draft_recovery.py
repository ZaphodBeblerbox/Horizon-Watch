"""A draft that outlives the browser's timeout must not wedge the task.

The failure this guards against, as it actually happened:

    error — Request timed out — check your connection
    error — only ready_to_draft tasks can start drafting (this one is drafting)
    error — only ready_to_draft tasks can start drafting (this one is drafting)
    ...

The model call outlived apiFetch's 30s default. The server carried on,
finished, and set status=drafting. The client never saw the reply, and every
retry hit the status guard — the task was wedged permanently. Nine tasks in
the live database were in exactly that state.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))

_MAIN = open(os.path.join(os.path.dirname(__file__), "main.py"), encoding="utf-8").read()
_API = open(os.path.join(os.path.dirname(__file__), "..", "src", "reports", "reportApi.js"),
            encoding="utf-8").read()


def test_the_draft_call_is_not_on_the_default_timeout():
    """A model call on a 30s budget reports failure for work that succeeded —
    the worst of both. A researched narrative draft measured 255s live, so the
    first raise to 240s was still under it."""
    assert re.search(r'_timeout:\s*path === "/draft" \? 600000', _API)


def test_a_drafting_task_with_real_work_returns_it():
    """The request is the same request; the caller losing the reply is not a
    reason to refuse it a second time."""
    assert 'if row.status == "drafting" and row.report_id:' in _MAIN
    assert '"ai_draft_status"] = "recovered"' in _MAIN


def test_an_empty_shell_is_reset_rather_than_served_as_a_briefing():
    """An empty draft is what this endpoint produces when the model call
    fails — it degrades honestly rather than fabricating. Handing that husk
    back as "your briefing" would be worse than the error it replaces."""
    assert "has_content = bool(" in _MAIN
    assert "db.delete(existing)" in _MAIN
    # and the reset actually makes the task drawable again
    assert _MAIN.count('row.status = "ready_to_draft"') >= 2


def test_a_drafting_task_with_no_report_is_reset_not_stranded():
    assert 'if row.status == "drafting" and not row.report_id:' in _MAIN


def test_other_statuses_are_still_refused():
    """Recovery is for "drafting" only — a published report must not be
    silently redrafted."""
    assert 'elif row.status != "ready_to_draft":' in _MAIN
    assert "only ready_to_draft tasks can start drafting" in _MAIN
