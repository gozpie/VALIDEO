#!/usr/bin/env bash
# Exécute l'ensemble des vérifications locales (hors tests d'intégration et E2E).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== TypeScript"
pnpm run check
echo "== Python"
uv run ruff check .
uv run ruff format --check .
uv run mypy apps/api/src apps/api/tests infrastructure/migrations
uv run pytest apps/api -m "not integration"
echo "Toutes les vérifications sont passées."
