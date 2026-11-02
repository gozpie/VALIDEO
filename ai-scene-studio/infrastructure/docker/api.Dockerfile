# syntax=docker/dockerfile:1.7
# Image de l'API FastAPI. Contexte de build : racine du monorepo (ai-scene-studio/).

FROM python:3.13.18-slim-trixie AS builder
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
# Secret BuildKit optionnel « extra_ca » : autorité de certification d'un proxy d'entreprise.
# Sans effet s'il n'est pas fourni ; il n'est jamais copié dans l'image.
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export PIP_CERT=/run/secrets/extra_ca; fi; \
    pip install --no-cache-dir uv==0.11.32
WORKDIR /app
# Dépendances d'abord (cache Docker), puis le code.
COPY pyproject.toml uv.lock ./
COPY apps/api/pyproject.toml apps/api/pyproject.toml
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export SSL_CERT_FILE=/run/secrets/extra_ca; fi; \
    uv sync --frozen --no-dev --no-install-workspace --package ass-api
COPY apps/api apps/api
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export SSL_CERT_FILE=/run/secrets/extra_ca; fi; \
    uv sync --frozen --no-dev --package ass-api --no-editable

FROM python:3.13.18-slim-trixie AS runtime
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN groupadd --system --gid 10001 app && useradd --system --uid 10001 --gid app --no-create-home app
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
COPY infrastructure/migrations /app/infrastructure/migrations
USER app
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health/live', timeout=2).status == 200 else 1)"]
CMD ["uvicorn", "ass_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
