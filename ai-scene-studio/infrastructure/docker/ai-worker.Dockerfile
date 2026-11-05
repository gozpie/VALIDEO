# syntax=docker/dockerfile:1.7
# Worker IA conteneurisé : fournisseurs « simulation » (FFmpeg) et « claude » (outil officiel `claude`
# en mode non interactif, authentifié par CLAUDE_CODE_OAUTH_TOKEN). La passerelle Higgsfield, elle,
# tourne sur le Mac où Chrome est ouvert (voir DEVELOPMENT.md). Contexte : racine du monorepo.

FROM python:3.13.18-slim-trixie AS builder
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
RUN pip install --no-cache-dir uv==0.11.32
WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY apps/api/pyproject.toml apps/api/pyproject.toml
RUN uv sync --frozen --no-dev --no-install-workspace --package ass-api
COPY apps/api apps/api
RUN uv sync --frozen --no-dev --package ass-api --no-editable

FROM node:22.23.4-trixie-slim AS claude
# Version figée et vérifiée : la 2.1.317 refuse à tort le découpage d'un script de fiction ordinaire
# (garde-fous « AUP » sur Opus et Sonnet), la 2.1.233 l'accepte (essais du 03/11/2026).
ARG CLAUDE_CODE_VERSION=2.1.233
RUN npm install --global --omit=dev "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
    && npm cache clean --force

FROM python:3.13.18-slim-trixie AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# Le paquet npm installe un binaire natif autonome : Node n'est pas nécessaire à l'exécution.
COPY --from=claude /usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe /usr/local/bin/claude
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    ASS_FFMPEG_PATH=/usr/bin/ffmpeg ASS_CLAUDE_PATH=/usr/local/bin/claude \
    DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
RUN groupadd --system --gid 10001 app && useradd --system --uid 10001 --gid app --create-home app
COPY --from=builder /app/.venv /app/.venv
WORKDIR /app
USER app
CMD ["python", "-m", "ass_api.ai.worker", "--providers", "simulation,claude"]
