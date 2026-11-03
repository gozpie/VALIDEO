# Tests

## Pyramide

| Niveau                 | Outils                                      | Emplacement                                                 | Exécution                                                     |
| ---------------------- | ------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| Unitaires TS           | Vitest                                      | `packages/*/test`, `apps/web/test`                          | `pnpm test`                                                   |
| Composants             | Vitest + React Testing Library (jsdom)      | `apps/web/test`                                             | `pnpm test`                                                   |
| Unitaires Python       | pytest                                      | `apps/api/tests`                                            | `uv run pytest apps/api`                                      |
| Contrat inter-langages | pytest + jsonschema                         | `apps/api/tests/test_scene_schema_contract.py`              | idem                                                          |
| Intégration            | pytest contre PostgreSQL, Redis et S3 réels | `apps/api/tests/test_integration_*.py`, `tests/integration` | `ASS_RUN_INTEGRATION=1 uv run pytest apps/api -m integration` |
| E2E                    | Playwright (Chromium)                       | `apps/web/e2e`, `tests/e2e`                                 | `pnpm test:e2e`                                               |
| Rendu (phase 4)        | comparaisons d'images de référence          | `tests/fixtures`                                            | à venir                                                       |

## Fixtures partagées

`tests/fixtures/scenes/*.v1.json` sont utilisées à la fois par les tests TypeScript (validation complète)
et Python (validation par le JSON Schema). Toute nouvelle règle de schéma doit être couverte par une fixture
valide et par un cas invalide.

## Règles

- Un test non exécuté n'est jamais annoncé comme réussi.
- Les tests d'intégration sont **ignorés par défaut** et exécutés en CI contre la pile Docker complète.
  `ASS_INTEGRATION_CHECKS=database,redis` restreint les dépendances testées.
- Les tests touchant une API **payante** seront marqués `paid` et exclus par défaut (`-m "not paid"`), avec activation explicite.
- Les générations simulées (mocks) seront **explicitement signalées** comme telles dans l'UI et dans les manifests.
- Le JSON Schema committé doit correspondre au schéma Zod (test automatique et vérification en CI).

## Couverture actuelle (phase 1)

- `scene-schema` : 33 tests (structure, intégrité référentielle, animation, caméras, lumières, migrations, synchronisation du JSON Schema).
- `shared-types` : 4 tests (machine à états des jobs).
- `generation-sdk` : 5 tests (appariement des capacités, contraintes bloquantes ou ignorées).
- `api-client` : 3 tests (types à jour du contrat OpenAPI, gestion du jeton CSRF).
- `web` : 13 tests unitaires et de composants ; 4 E2E (accueil, redirection vers la connexion, mauvais mot de passe,
  parcours complet workspace → projet → séquence → plans → rechargement → reconnexion).
- `api` : 64 tests unitaires (dont contrat OpenAPI à jour) et 81 tests d'intégration (PostgreSQL, Redis, S3) :
  migrations, contraintes, authentification, CSRF, limitation, isolation entre workspaces, rôles, invitations,
  CRUD et ordre des séquences et plans.

## E2E de la phase 1

Le parcours complet exige la pile démarrée et un compte de test, créé en ligne de commande :

```bash
docker compose up --build --wait
printf '%s\n' "$E2E_PASSWORD" | docker compose exec -T api \
  python -m ass_api.cli create-user --email "$E2E_EMAIL" --display-name E2E --password-stdin
E2E_BASE_URL=http://localhost:3000 E2E_EMAIL=… E2E_PASSWORD=… pnpm test:e2e
```

Sans `E2E_EMAIL` / `E2E_PASSWORD`, ces tests sont explicitement ignorés (seul le test d'accueil s'exécute).

## Intégration continue

`.github/workflows/ai-scene-studio.yml` : TypeScript (format, lint, types, tests, build, JSON Schema à jour),
Python (ruff, mypy, pytest), puis pile Docker complète (build des images, `--wait`, tests d'intégration, E2E).
