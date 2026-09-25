"""
No database session may be held open across an await.

A reader's snapshot pins every WAL page newer than it, so a session that
survives an await stops SQLite checkpointing for as long as it lives.
Measured consequences in production: the WAL reached 2.14GB once, and
85MB again on 2026-09-25, with "database is locked" appearing at the
moment of each checkpoint and a one-off TRUNCATE checkpoint reclaiming
152 pages out of 32,147 before giving up with busy=1.

_wal_checkpoint_loop's own docstring named this and counted five such
places. The worst was _foresight_loop, which held one for an entire
foresight cycle — three zones, each awaiting an LLM call.

Worth recording why it got worse before it got better: while foresight
crashed on its first alert (Alert.domain never existed) the session was
released almost immediately. Repairing that bug turned a dead feature
into a minutes-long WAL pin.
"""
import ast

SOURCES = ["main.py", "foresight_engine.py"]


def _offenders(path):
    tree = ast.parse(open(path).read())
    out = []
    for fn in ast.walk(tree):
        if not isinstance(fn, ast.AsyncFunctionDef):
            continue
        for node in ast.walk(fn):
            if not isinstance(node, (ast.With, ast.AsyncWith)):
                continue
            dumped = ast.dump(node)
            if "get_db" not in dumped and "SessionLocal" not in dumped:
                continue
            if any(isinstance(k, ast.Await) for k in ast.walk(node)):
                out.append(f"{path}:{node.lineno} in {fn.name}")
    return out


def test_no_open_session_survives_an_await():
    found = []
    for path in SOURCES:
        found += _offenders(path)
    assert not found, (
        "A session held across an await pins the WAL and blocks "
        "checkpointing for as long as it lives:\n  " + "\n  ".join(found))


def test_the_check_can_actually_see_one():
    # Guard against the guard silently passing because the AST walk is
    # wrong. This snippet is exactly the shape we forbid.
    import tempfile, os, textwrap
    bad = textwrap.dedent('''
        async def f():
            with get_db() as db:
                await something(db)
    ''')
    fd, path = tempfile.mkstemp(suffix=".py")
    try:
        os.write(fd, bad.encode()); os.close(fd)
        assert _offenders(path), "the detector does not detect the thing"
    finally:
        os.unlink(path)
