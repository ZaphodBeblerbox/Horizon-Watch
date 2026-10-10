"""
paths.py — where Parallax keeps things, decided in one place.

Three kinds of file, three homes:

  CODE_DIR   the code, and what ships with it. Read-only in a container
             and replaced on every deploy, so nothing written at runtime
             may live here.
  SEED_DIR   data that ships with the code (pipelines, deployments,
             military enrichment …). Read from here unless an edited copy
             exists in DATA_DIR. Kept OUT of data/ because the server's
             volume is mounted over data/ and would hide it.
  DATA_DIR   everything written at runtime: the database, user documents,
             caches, the Telegram session, the LLM spend log. On the server
             this is the persistent volume; locally it is backend/data.

DATA_DIR is resolved by ONE rule — DATA_DIR, else RAILWAY_VOLUME_MOUNT_PATH,
else backend/data. Before this module, five files each had their own
fallback (./data from the working directory, /var/lib/railway, the code
directory), so with DATA_DIR unset the ORM and the rest of the app could
open different databases — the shape of the 2026-09-16 outage.
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path

CODE_DIR = Path(__file__).resolve().parent
SEED_DIR = CODE_DIR / "seed"

try:  # DATA_DIR may be set in backend/.env; read it before resolving.
    from dotenv import load_dotenv
    load_dotenv(CODE_DIR / ".env")
except Exception:  # pragma: no cover — dotenv is a dependency, but never fatal
    pass


def resolve_data_dir(env=os.environ) -> Path:
    return Path(env.get("DATA_DIR") or env.get("RAILWAY_VOLUME_MOUNT_PATH") or (CODE_DIR / "data"))


DATA_DIR: Path = resolve_data_dir()
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH: Path = DATA_DIR / "akili.db"


def data_path(*parts: str) -> Path:
    """A path under DATA_DIR (its parent directory is created)."""
    p = DATA_DIR.joinpath(*parts)
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def state_path(name: str, data_dir: Path | None = None, code_dir: Path | None = None) -> Path:
    """User state that used to be written beside the code (briefings.json,
    documents/, annotations.json …). It lives in DATA_DIR now; the first
    call moves an existing copy over from the code directory, so nothing a
    user saved is left behind by the move."""
    data_dir = data_dir or DATA_DIR
    code_dir = code_dir or CODE_DIR
    new, old = data_dir / name, code_dir / name
    if not new.exists() and old.exists() and old.resolve() != new.resolve():
        new.parent.mkdir(parents=True, exist_ok=True)
        try:
            shutil.move(str(old), str(new))
            print(f"[paths] moved {old} → {new}")
        except OSError as exc:  # read-only code dir: copy instead
            print(f"[paths] could not move {old} ({exc}); copying")
            (shutil.copytree if old.is_dir() else shutil.copy2)(str(old), str(new))
    return new


def seeded(name: str, data_dir: Path | None = None, seed_dir: Path | None = None) -> Path:
    """Where to READ a seed file: the edited copy in DATA_DIR if there is
    one, else the copy that ships with the code. Writes go to
    data_path(name), which then wins on every later read."""
    data_dir = data_dir or DATA_DIR
    seed_dir = seed_dir or SEED_DIR
    edited = data_dir / name
    return edited if edited.exists() else seed_dir / name


def safe_filename(name: str | None, fallback: str = "upload") -> str:
    """A client-supplied filename made safe to join onto a directory: the
    last path component only, no leading dots, a conservative alphabet."""
    base = os.path.basename((name or "").replace("\\", "/")).strip().lstrip(".")
    clean = "".join(c if (c.isalnum() or c in "-_. ") else "_" for c in base).strip()
    return clean[:120] or fallback


def shared_data(name: str) -> Path:
    """A data file the frontend also uses (public/data/<name>). Railway
    deploys backend/ alone, so ../public is not there in production: the
    copy in backend/seed is read first (test_seed_copies.py keeps it equal
    to the frontend's), the frontend's own file only as a local fallback."""
    copy = SEED_DIR / name
    return copy if copy.exists() else CODE_DIR.parent / "public" / "data" / name
