"""
test_seed_rules_import_safety.py — regression test for a severe, real bug:

seed_rules.py used to call argparse.ArgumentParser().parse_args() at module
import time, unconditionally. main.py's _auto_ingest_task imports this module
as a library (`from seed_rules import seed_db`) on every backend boot. When
imported that way, argparse.parse_args() parses the *importing process's own
sys.argv* — e.g. uvicorn's "main:app --host 0.0.0.0 --port 8000" — which does
not match seed_rules.py's own --base flag, so argparse called sys.exit(2).
SystemExit is not a subclass of Exception, so it slipped straight past the
`except Exception` guard around the auto-ingest task and crashed the entire
running server. Confirmed live: a real local boot of this backend crashed
with exactly this traceback ~60-90s after startup, every time auto-ingest
reached the rule-seeding step.

This test simulates the exact failure condition — importing the module with
argv set to something that looks nothing like seed_rules.py's own CLI flags —
and confirms it no longer raises SystemExit (or anything else) on import.
"""
import subprocess
import sys
import os

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))


def test_import_survives_unrelated_argv():
    """
    Reproduce main.py's actual import path under a subprocess whose argv
    mimics uvicorn's own invocation, to prove the module doesn't blow up
    the importing process anymore.
    """
    code = (
        "import sys; "
        "sys.argv = ['uvicorn', 'main:app', '--host', '0.0.0.0', '--port', '8000']; "
        "import seed_rules; "
        "assert seed_rules.BASE == 'http://localhost:8000', seed_rules.BASE; "
        "print('IMPORT_SURVIVED')"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=BACKEND_DIR,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, (
        f"Importing seed_rules with unrelated argv crashed the process "
        f"(returncode={result.returncode}).\nstdout={result.stdout}\nstderr={result.stderr}"
    )
    assert "IMPORT_SURVIVED" in result.stdout, result.stdout


def test_cli_path_still_parses_base_flag():
    """The standalone `python3 seed_rules.py --base ...` CLI path must still work."""
    code = (
        "import sys; "
        "sys.argv = ['seed_rules.py', '--base', 'http://example-host:9000']; "
        "import seed_rules; "
        "seed_rules._parse_cli_args(); "
        "assert seed_rules.BASE == 'http://example-host:9000', seed_rules.BASE; "
        "print('CLI_PARSE_OK')"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=BACKEND_DIR,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, f"stdout={result.stdout}\nstderr={result.stderr}"
    assert "CLI_PARSE_OK" in result.stdout, result.stdout


if __name__ == "__main__":
    test_import_survives_unrelated_argv()
    print("PASS: test_import_survives_unrelated_argv")
    test_cli_path_still_parses_base_flag()
    print("PASS: test_cli_path_still_parses_base_flag")
    print("ALL CHECKS PASSED")
