from pathlib import Path

import paths


def test_one_rule_for_data_dir():
    assert paths.resolve_data_dir({"DATA_DIR": "/v", "RAILWAY_VOLUME_MOUNT_PATH": "/r"}) == Path("/v")
    assert paths.resolve_data_dir({"RAILWAY_VOLUME_MOUNT_PATH": "/r"}) == Path("/r")
    assert paths.resolve_data_dir({}) == paths.CODE_DIR / "data"


def test_state_moves_over_once(tmp_path):
    code, data = tmp_path / "code", tmp_path / "data"
    code.mkdir(); data.mkdir()
    (code / "briefings.json").write_text("[1]")
    (code / "documents").mkdir(); (code / "documents" / "a.json").write_text("{}")
    p = paths.state_path("briefings.json", data, code)
    assert p == data / "briefings.json" and p.read_text() == "[1]"
    assert not (code / "briefings.json").exists()
    d = paths.state_path("documents", data, code)
    assert (d / "a.json").exists()
    # a later call leaves the new copy alone
    (code / "briefings.json").write_text("[stale]")
    assert paths.state_path("briefings.json", data, code).read_text() == "[1]"


def test_seeded_prefers_the_edited_copy(tmp_path):
    seed, data = tmp_path / "seed", tmp_path / "data"
    seed.mkdir(); data.mkdir()
    (seed / "deployments.json").write_text("seed")
    assert paths.seeded("deployments.json", data, seed).read_text() == "seed"
    (data / "deployments.json").write_text("edited")
    assert paths.seeded("deployments.json", data, seed).read_text() == "edited"


def test_safe_filename():
    assert paths.safe_filename("../../etc/passwd") == "passwd"
    assert paths.safe_filename("..\\..\\x.csv") == "x.csv"
    assert paths.safe_filename(".env") == "env"
    assert paths.safe_filename("") == "upload"
    assert paths.safe_filename("ships ä.csv") == "ships ä.csv"
