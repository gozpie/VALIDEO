# syntax=docker/dockerfile:1.7
# Worker de rendu : Blender 4.5 LTS (Cycles sur CPU) + FFmpeg + code de l'API (worker Python).
# Contexte : racine du monorepo. Blender ne publie des binaires Linux que pour x86-64 : sur un Mac Apple
# Silicon, l'image tourne en émulation (plus lente, mêmes résultats).

FROM --platform=linux/amd64 python:3.13.18-slim-trixie AS blender
ARG BLENDER_VERSION=4.5.15
ARG BLENDER_SHA256=0d2b8bb2efe97e6c8eb57de6b7322f8800e1984e3125b60decca5f6771e4773e
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
    && rm -rf /var/lib/apt/lists/*
RUN --mount=type=secret,id=extra_ca,required=false \
    curl -fsSL \
      "https://download.blender.org/release/Blender${BLENDER_VERSION%.*}/blender-${BLENDER_VERSION}-linux-x64.tar.xz" \
      -o /tmp/blender.tar.xz \
    && echo "${BLENDER_SHA256}  /tmp/blender.tar.xz" | sha256sum -c - \
    && mkdir -p /opt/blender \
    && tar -xJf /tmp/blender.tar.xz -C /opt/blender --strip-components=1 \
    && rm /tmp/blender.tar.xz

FROM --platform=linux/amd64 python:3.13.18-slim-trixie AS builder
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
RUN pip install --no-cache-dir uv==0.11.32
WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY apps/api/pyproject.toml apps/api/pyproject.toml
RUN uv sync --frozen --no-dev --no-install-workspace --package ass-api
COPY apps/api apps/api
RUN uv sync --frozen --no-dev --package ass-api --no-editable

FROM --platform=linux/amd64 python:3.13.18-slim-trixie AS runtime
# Bibliothèques système requises par le binaire officiel de Blender en mode headless, et FFmpeg.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg libx11-6 libxi6 libxxf86vm1 libxfixes3 libxrender1 libxkbcommon0 libsm6 libice6 \
      libgl1 libegl1 libglu1-mesa libxext6 libxinerama1 libwayland-client0 libdbus-1-3 \
    && rm -rf /var/lib/apt/lists/*
ENV PATH="/app/.venv/bin:/opt/blender:$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    ASS_BLENDER_PATH=/opt/blender/blender ASS_FFMPEG_PATH=/usr/bin/ffmpeg
RUN groupadd --system --gid 10001 app && useradd --system --uid 10001 --gid app --create-home app
COPY --from=blender /opt/blender /opt/blender
COPY --from=builder /app/.venv /app/.venv
COPY workers/render-worker/blender /app/blender
COPY tests/fixtures /app/fixtures
WORKDIR /app
USER app
CMD ["python", "-m", "ass_api.render.worker"]
