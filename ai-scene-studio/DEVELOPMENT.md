# Développement

## Prérequis

| Outil            | Version                                 | Vérification             |
| ---------------- | --------------------------------------- | ------------------------ |
| Node.js          | 22 (LTS, `.nvmrc`)                      | `node --version`         |
| pnpm             | 10.28 (via `packageManager` / corepack) | `pnpm --version`         |
| Python           | 3.13 (`.python-version`)                | `python3 --version`      |
| uv               | 0.11.x                                  | `uv --version`           |
| Docker + Compose | Docker 27+, Compose v2+                 | `docker compose version` |
| FFmpeg           | optionnel avant la phase 4              | `ffmpeg -version`        |
| Blender          | optionnel avant la phase 4              | `blender --version`      |

`./scripts/check-env.sh` vérifie l'ensemble.

## Installation

```bash
cd ai-scene-studio
pnpm install          # dépendances JS (lockfile figé en CI : --frozen-lockfile)
uv sync               # environnement Python .venv (dépendances + outils de dev)
cp .env.example .env  # variables pour docker compose
```

## Lancer l'environnement

**Tout en conteneurs** : `docker compose up --build --wait`, puis `docker compose down` (ajouter `-v` pour effacer les données).

**Infrastructure en conteneurs, code en local** (rechargement à chaud) :

```bash
docker compose up -d --wait postgres redis storage storage-init
uv run alembic -c infrastructure/migrations/alembic.ini upgrade head
uv run uvicorn ass_api.main:app --reload --port 8000     # API
pnpm --filter @ass/web dev                              # Web sur http://localhost:3000
```

Les valeurs par défaut de l'API correspondent à cet environnement local : aucune variable n'est nécessaire.

## Commandes

| Commande                                                                                   | Effet                                                                 |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `./scripts/check-all.sh`                                                                   | Format, lint, typecheck et tests unitaires (TS et Python)             |
| `pnpm check`                                                                               | Format, lint, typecheck et tests côté TypeScript                      |
| `pnpm test` / `pnpm typecheck` / `pnpm lint` / `pnpm format`                               | Tâches TypeScript sur tous les packages                               |
| `pnpm schema:generate`                                                                     | Regénère le JSON Schema de scène après modification du schéma         |
| `pnpm test:e2e`                                                                            | Playwright (construit et démarre le web, ou cible `E2E_BASE_URL`)     |
| `uv run pytest apps/api`                                                                   | Tests Python (l'intégration est ignorée sans `ASS_RUN_INTEGRATION=1`) |
| `uv run ruff check . && uv run ruff format .`                                              | Lint et format Python                                                 |
| `uv run mypy apps/api/src apps/api/tests infrastructure/migrations`                        | Typage Python strict                                                  |
| `uv run alembic -c infrastructure/migrations/alembic.ini revision --autogenerate -m "..."` | Nouvelle migration                                                    |
| `uv run python -m ass_api.cli ensure-bucket`                                               | Crée le bucket S3 s'il n'existe pas                                   |
| `uv run python -m ass_api.cli create-user --email … --display-name …`                      | Crée un compte (mot de passe demandé ; `--password-stdin` possible)   |

## Variables d'environnement

API (préfixe `ASS_`, voir `apps/api/src/ass_api/core/config.py`) :

| Variable                                                | Défaut (dev)                                      | Rôle                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ASS_ENVIRONMENT`                                       | `development`                                     | `development`, `test` ou `production` (désactive `/docs` et refuse les identifiants de dev)  |
| `ASS_LOG_LEVEL` / `ASS_LOG_JSON`                        | `INFO` / `true`                                   | Journalisation                                                                               |
| `ASS_DATABASE_URL`                                      | `postgresql+psycopg://ass:ass@localhost:5432/ass` | PostgreSQL                                                                                   |
| `ASS_REDIS_URL`                                         | `redis://localhost:6379/0`                        | Redis                                                                                        |
| `ASS_S3_ENDPOINT_URL`, `ASS_S3_REGION`, `ASS_S3_BUCKET` | `http://localhost:8333`, `us-east-1`, `ass-media` | Stockage                                                                                     |
| `ASS_S3_ACCESS_KEY_ID`, `ASS_S3_SECRET_ACCESS_KEY`      | identifiants de dev                               | Stockage                                                                                     |
| `ASS_CORS_ALLOWED_ORIGINS`                              | `http://localhost:3000`                           | Liste séparée par des virgules ; `*` interdit                                                |
| `ASS_HEALTH_CHECK_TIMEOUT_SECONDS`                      | `2`                                               | Timeout par dépendance                                                                       |
| `ASS_SESSION_COOKIE_NAME`                               | `ass_session`                                     | Nom du cookie de session                                                                     |
| `ASS_SESSION_COOKIE_SECURE`                             | `true`                                            | Attribut `Secure` ; obligatoire en production. Chrome et Firefox l'acceptent sur `localhost` |
| `ASS_SESSION_TTL_HOURS`                                 | `336`                                             | Durée de vie absolue d'une session (14 jours)                                                |
| `ASS_LOGIN_MAX_FAILURES_PER_EMAIL` / `…_PER_IP`         | `10` / `50`                                       | Échecs tolérés par fenêtre avant `429`                                                       |
| `ASS_LOGIN_FAILURE_WINDOW_SECONDS`                      | `900`                                             | Fenêtre de comptage des échecs                                                               |

Web : `NEXT_PUBLIC_API_URL` (défaut `http://localhost:8000`), figée au build.

## Conventions

- TypeScript `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` ; ESLint `strict` ; Prettier.
- Python : ruff (règles de sécurité `S` incluses), mypy `strict`.
- Dépendances : versions exactes ; vérifier la compatibilité (peer dependencies) avant toute montée de version.
- Messages de commit en français ; petits incréments ; rapport des modifications dans `rapport.md` à la racine du dépôt.

## Dépannage

| Symptôme                                                                          | Cause probable / solution                                                                                         |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `/health/ready` renvoie 503                                                       | Le détail par dépendance indique laquelle est indisponible : `docker compose ps`, `docker compose logs <service>` |
| Port 5432/6379 déjà utilisé                                                       | Un PostgreSQL/Redis local tourne : l'arrêter ou modifier le mapping de ports dans `compose.yaml`                  |
| `CERTIFICATE_VERIFY_FAILED` pendant `docker build` derrière un proxy d'entreprise | `docker build --secret id=extra_ca,src=/chemin/ca.pem …` (voir DEPLOYMENT.md)                                     |
| Playwright ne trouve pas de navigateur                                            | `pnpm --filter @ass/web exec playwright install chromium`                                                         |
| `pnpm install` refuse la version de Node                                          | Utiliser Node 22 (`nvm use`) ; `engine-strict` est activé                                                         |
| Le test « JSON Schema à jour » échoue                                             | Lancer `pnpm schema:generate` et commiter le fichier                                                              |
