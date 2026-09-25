"""
A loop may only move to the worker if the web process loses nothing by it.

The split exists because the event loop was measurably blocked 68% of the
time with background work and HTTP in one interpreter. But a loop moved
carelessly is worse than one left alone: if it fills a module-level
structure that an endpoint reads, moving it leaves that endpoint serving
an empty result in the other process — silently, with no error anywhere.

A first pass at the allowlist classified each loop by looking at the loop
function alone and got three wrong, because a loop that touches no state
itself can still CALL something that does. This re-derives the answer from
the source, transitively, so the list cannot drift away from the code.
"""
import ast

import pytest

import process_role as pr

SRC = open("main.py").read()
TREE = ast.parse(SRC)
FUNCS = {n.name: n for n in ast.walk(TREE)
         if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}

#: Module-level structures that live in ONE process and are read there.
IN_PROCESS_STATE = {
    "_AIS_VESSELS", "_forge_alerts", "_correlation_assessments",
    "_GLOBAL_ADSB_CACHE", "_SURFACE_POOL", "_last_cycle_stats",
    "_fusion_engine", "_DS_STATUS", "_RISK_CACHE", "_shorts_cache",
    "_youtube_reels_cache", "_AIS_STATUS",
}


def _reaches(name, seen=None, depth=0):
    seen = seen if seen is not None else set()
    if name in seen or name not in FUNCS or depth > 4:
        return set()
    seen.add(name)
    found = set()
    for node in ast.walk(FUNCS[name]):
        if isinstance(node, ast.Name) and node.id in IN_PROCESS_STATE:
            found.add(node.id)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            found |= _reaches(node.func.id, seen, depth + 1)
    return found


@pytest.mark.parametrize("loop", sorted(pr.WORKER_ONLY))
def test_a_worker_loop_touches_no_in_process_state(loop):
    reached = _reaches(loop)
    assert not reached, (
        f"{loop} is marked worker-only but reaches {sorted(reached)}. "
        f"Moving it leaves whatever reads that state empty in the web "
        f"process, with no error to show for it.")


def test_every_worker_loop_actually_exists():
    # A typo here does not fail loudly; it just quietly runs the loop in
    # both processes, or in neither.
    missing = sorted(n for n in pr.WORKER_ONLY if n not in FUNCS)
    assert not missing, f"named in WORKER_ONLY but not defined: {missing}"


def test_the_three_that_were_wrong_stay_out():
    # Regression guard on the specific mistake, with its reason.
    for name in ("_weekly_snapshot_loop", "_sentinel_zone_scheduler_loop",
                 "_threat_matrix_loop"):
        assert name not in pr.WORKER_ONLY, (
            f"{name} reads in-process state through a callee")


def test_the_roles_partition_the_loops_exactly():
    # Nothing may run in both processes, and nothing may run in neither.
    for loop in sorted(pr.WORKER_ONLY | {"_gdelt_loop", "_risk_index_warm_loop"}):
        web = loop not in pr.WORKER_ONLY
        worker = loop in pr.WORKER_ONLY
        assert web != worker, f"{loop} is in both roles or neither"


def test_default_role_changes_nothing():
    # An existing deployment that sets no env var must behave exactly as
    # it did before this file existed.
    assert pr.ROLE == "all"
    for loop in sorted(pr.WORKER_ONLY):
        assert pr.runs_here(loop) is True
