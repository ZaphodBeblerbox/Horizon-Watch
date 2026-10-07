"""
deploy_check.py — is this machine ready to run Parallax as the server?

    python deploy_check.py          # prints a report, exits 1 if anything blocks

Read-only: it looks, it never writes (apart from one probe file in DATA_DIR
that it removes again). Run it in the container before pointing anyone at
it; the checks are the mistakes that have cost a deploy before — the app on
the wrong data path (2026-09-16), sessions lost on restart, seed data hidden
by the volume mount.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import paths

REQUIRED = {
    "JWT_SECRET": "signs logins; without it a secret is generated into DATA_DIR",
    "OPENAI_API_KEY": "enrichment, voice, asset briefs",
    "ANTHROPIC_API_KEY": "briefings and decks",
}
WANTED = {
    "AISSTREAM_API_KEY": "live vessels",
    "TELEGRAM_API_ID": "ground footage",
    "TELEGRAM_API_HASH": "ground footage",
    "FIRMS_MAP_KEY": "fires",
    "GFW_TOKEN": "vessel owners",
    "COPERNICUS_CLIENT_ID": "satellite imagery",
    "COPERNICUS_CLIENT_SECRET": "satellite imagery",
    "OPENAIP_KEY": "airspace",
}
SEEDS = ("pipelines.json", "deployments.json", "military_enrichment.json", "shipping_routes.json")


def checks(env=os.environ) -> list[tuple[str, str, str]]:
    """(level, what, detail) — level is ok, warn or block."""
    out: list[tuple[str, str, str]] = []
    on_server = bool(env.get("RAILWAY_ENVIRONMENT"))
    d = paths.DATA_DIR

    if on_server and not (env.get("DATA_DIR") or env.get("RAILWAY_VOLUME_MOUNT_PATH")):
        out.append(("block", "DATA_DIR", f"not set on the server; the app would write to {d}, which a deploy wipes"))
    elif env.get("DATA_DIR") and env.get("RAILWAY_VOLUME_MOUNT_PATH") and Path(env["DATA_DIR"]) != Path(env["RAILWAY_VOLUME_MOUNT_PATH"]):
        out.append(("block", "DATA_DIR", f"{env['DATA_DIR']} is not the volume ({env['RAILWAY_VOLUME_MOUNT_PATH']})"))
    else:
        out.append(("ok", "DATA_DIR", str(d)))

    probe = d / ".deploy_check"
    try:
        probe.write_text("x"); probe.unlink()
        out.append(("ok", "DATA_DIR writable", ""))
    except OSError as exc:
        out.append(("block", "DATA_DIR writable", str(exc)))

    db = paths.DB_PATH
    if db.exists():
        out.append(("ok", "database", f"{db} · {db.stat().st_size / 1e9:.2f} GB"))
    else:
        out.append(("warn", "database", f"none at {db} — a first start creates it and seeds users from SEED_TEMP_PASSWORD"))

    try:
        st = os.statvfs(d)
        free = st.f_bavail * st.f_frsize / 1e9
        out.append(("ok" if free > 5 else "warn", "free space", f"{free:.1f} GB on the data volume"))
    except OSError:
        pass

    for name in SEEDS:
        if not paths.seeded(name).exists():
            out.append(("warn", f"seed {name}", "missing from backend/seed and DATA_DIR"))

    for k, why in REQUIRED.items():
        out.append(("ok" if env.get(k) else ("block" if (k == "JWT_SECRET" and on_server) else "warn"), k, "" if env.get(k) else f"not set — {why}"))
    for k, why in WANTED.items():
        if not env.get(k):
            out.append(("warn", k, f"not set — no {why}"))

    if (env.get("TELEGRAM_VIDEO_STORE") or "temp") != "volume" and on_server:
        out.append(("warn", "TELEGRAM_VIDEO_STORE", "not 'volume' — footage is fetched per view and not archived"))
    if not (paths.CODE_DIR / "yolov8m-obb.onnx").exists():
        out.append(("warn", "imagery model", "yolov8m-obb.onnx not in the image; the first scan downloads and exports it"))
    if not (paths.DATA_DIR / "telegram" / "parallax.session").exists():
        out.append(("warn", "Telegram session", "no login session in DATA_DIR/telegram — log in once (telegram_ingest.py login)"))
    return out


def main() -> int:
    rows = checks()
    mark = {"ok": "  ok  ", "warn": " warn ", "block": "BLOCK "}
    for level, what, detail in rows:
        print(f"[{mark[level]}] {what}{' — ' + detail if detail else ''}")
    blocks = sum(1 for r in rows if r[0] == "block")
    print(f"\n{blocks} blocking, {sum(1 for r in rows if r[0] == 'warn')} warnings")
    return 1 if blocks else 0


if __name__ == "__main__":
    sys.exit(main())
