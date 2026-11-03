#!/usr/bin/env bash
# Worker à lancer sur le Mac, relié à la pile docker compose (Postgres, Redis, S3 sur 127.0.0.1).
#   ./scripts/mac-worker.sh                    gozCut seul
#   ./scripts/mac-worker.sh gozcut,higgsfield  gozCut et Higgsfield (Chrome ouvert sur higgsfield.ai)
set -euo pipefail
cd "$(dirname "$0")/.."
exec uv run --package ass-api python -m ass_api.ai.worker --providers "${1:-gozcut}"
