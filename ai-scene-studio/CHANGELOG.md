# Changelog

Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versionnement [SemVer](https://semver.org/lang/fr/).

## [Non publié]

### Ajouté

- Étape 1.1 : modèle de données (`users`, `workspaces`, `workspace_members`, `projects`, `sequences`, `shots`)
  et migration Alembic `0001`, avec tests unitaires et tests d'intégration PostgreSQL (aller-retour des
  migrations, `alembic check`, contraintes, cascades, réordonnancement).
- `CLAUDE.md` : conventions, commandes et règles de contribution (prévu par le cahier des charges, absent de la phase 0).

### Modifié

- `infrastructure/migrations/env.py` : enregistre les modèles et accepte une URL de base fournie par les tests.

## [0.1.0] — 2026-11-02 — Phase 0 : audit et initialisation

### Ajouté

- Monorepo `ai-scene-studio/` : pnpm (TypeScript strict, ESLint, Prettier, Vitest) et uv (ruff, mypy, pytest).
- `@ass/scene-schema` : format canonique de scène v1 (Zod), validation d'intégrité, migrations, JSON Schema, fixtures.
- `@ass/shared-types` : contrats des entités, machine à états des jobs, enveloppe d'erreur.
- `@ass/generation-sdk` : contrat `ProviderAdapter`, appariement des capacités.
- `apps/api` : FastAPI, configuration sécurisée, logs structurés, `/health/live` et `/health/ready`, Alembic.
- `apps/web` : Next.js 16, état des services, tests Vitest/RTL et Playwright.
- Docker Compose (PostgreSQL, Redis, SeaweedFS S3, migrations, API, web, nginx), Dockerfiles non-root.
- CI GitHub Actions, scripts `check-env.sh` et `check-all.sh`, documentation complète.
