# Deploying Parallax

Prepared, not deployed. Nothing in this repo deploys on its own; a deploy
is a decision the owner makes.

## Shape

One Railway service, one container, one volume.

- **Root directory:** `backend/`. Start command: `./start.sh` (the Procfile).
  The script runs two processes. The *web* process serves HTTP. The
  *worker* process runs the ingest loops. They are separate because
  ingest and HTTP in one interpreter blocked the event loop 68% of the
  time. They share one container because a Railway volume mounts to
  exactly one service.
- **Volume:** mount at `/app/data` and set `DATA_DIR=/app/data`.
  Everything written at runtime goes there (`backend/paths.py`):
  - the SQLite database
  - user documents and briefings
  - annotations, situations, the profile
  - the LLM spend log
  - caches
  - the Telegram login session
  - desk, chat and case files
  - Telegram footage, if `TELEGRAM_VIDEO_STORE=volume`
- **Seed data** ships in `backend/seed/` (pipelines, deployments,
  military enrichment, shipping routes). It used to live in `data/`, where
  the volume mount hid it. An edited copy in DATA_DIR wins.
- **Health check:** `/api/health/live`, with a 600 s timeout
  (`railway.json`). Startup on a large database is slow, so keep the
  timeout.
- **Frontend:** built by Vite. It talks to the URL in `src/apiBase.js`
  (`PRODUCTION`) or `VITE_API_BASE` at build time.

## Before the first deploy

1. Set the variables in `backend/.env.example` as service variables.
   - `JWT_SECRET` must be set. Without it, a secret is generated into
     DATA_DIR. That works, but it can't be rotated deliberately.
   - The Anthropic key in the local `.env` currently returns 401.
     Briefings stay empty until it is replaced.
2. Copy the database onto the volume: `backend/data/akili.db`, about
   3.7 GB. Without it, the server starts empty and re-seeds users.
3. Log Telegram in once on the server:
   `python telegram_ingest.py login`. The session is kept in
   `DATA_DIR/telegram/`.
4. Run `python deploy_check.py` in the container. Exit code 1 means
   something blocks.
5. Optionally bake `yolov8m-obb.onnx` (101 MB, not in git) into the image.
   Otherwise the first imagery scan downloads and exports it.
   - torchvision arrives with ultralytics.
   - The SAR weights download into DATA_DIR on first use.

## What moved (2026-10-07)

Earlier, these files were written beside the code, so a redeploy erased
them:

- `briefings.json`
- `documents/`
- `annotations.json`
- `situations.json`
- `profile.json`
- `usage_log.json`, which held the LLM spend, so its loss reset the
  budget
- `article_preview_cache.json`

They now live in DATA_DIR. The first start moves any existing copy over.

Other fixes in the same change:

- `escalation.py` had its own database path and now uses the shared one.
- Five modules each had their own fallback when DATA_DIR was unset
  (`./data`, `/var/lib/railway`, the code directory). There is now one
  rule: DATA_DIR, else RAILWAY_VOLUME_MOUNT_PATH, else `backend/data`.
- Forge uploads no longer trust the client's filename.

## Not yet

- **Media in object storage.** Footage on the volume is the first step. An
  S3-compatible bucket would move it off the volume. `TELEGRAM_VIDEO_STORE`
  is the switch where that would go.
- **Postgres.** `backend/postgres_prototype/` exists; SQLite on the volume
  is what runs.
