#!/usr/bin/env bash
# Worker IA Higgsfield, lancé sur le Mac où Chrome est ouvert (CDP sur le port 9222, onglet
# higgsfield.ai connecté). Il rejoint la pile docker compose (Postgres, Redis, S3 sur 127.0.0.1).
# Chaque génération Higgsfield est payante : l'API exige la confirmation du coût exact.
set -euo pipefail
cd "$(dirname "$0")/.."
exec uv run --package ass-api python -m ass_api.ai.worker --providers higgsfield "$@"
