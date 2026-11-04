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
- `animation-engine` : 14 tests (interpolations, slerp, extrapolations, édition des clés, référence de déterminisme
  `tests/fixtures/animation/cube-camera-animated.expected.json`).
- `scene-engine` : 16 tests (opérations d'édition, conversions Three.js, mouvements de caméra, visée) ; `editor-ui` :
  9 tests (historique, sélection, temps, cache d'évaluation).
- `web` : 17 tests unitaires et de composants (dont hiérarchie et inspecteur de l'éditeur) ; 5 E2E (accueil,
  redirection vers la connexion, mauvais mot de passe, parcours des projets, éditeur 3D : ajout d'un cube,
  déplacement, annuler/rétablir, renommage, import GLB, duplication, suppression, enregistrement, rechargement ;
  animation : clés, clé automatique, interpolation, caméra active et visée, vue double, marqueur, lecture,
  enregistrement et relecture après rechargement).
- `api` : 64 tests unitaires (dont contrat OpenAPI à jour) et 81 tests d'intégration (PostgreSQL, Redis, S3) :
  migrations, contraintes, authentification, CSRF, limitation, isolation entre workspaces, rôles, invitations,
  CRUD et ordre des séquences et plans.

## Rendu Blender (phase 4)

- `apps/api/tests/test_blender_coherence.py` : vrais rendus Cycles comparés à la projection calculée depuis la scène
  canonique (axes, focales, orthographique, hiérarchie, timing, GLB) et sonde des courbes évaluées par Blender.
  `ASS_BLENDER=docker` (image `ai-scene-studio/render-worker:dev`) ou `ASS_BLENDER=/chemin/blender`.
- `apps/api/tests/test_render_worker_live.py` : rendu de bout en bout par l'API et le worker de la pile Docker
  (`ASS_RUN_RENDER=1`, compte E2E).
- Références de déterminisme inter-langages : `tests/fixtures/animation/*.expected.json` (TypeScript → Python → Blender).

## E2E de la phase 1

Le parcours complet exige la pile démarrée et un compte de test, créé en ligne de commande :

```bash
docker compose up --build --wait
printf '%s\n' "$E2E_PASSWORD" | docker compose exec -T api \
  python -m ass_api.cli create-user --email "$E2E_EMAIL" --display-name E2E --password-stdin
E2E_BASE_URL=http://localhost:3000 E2E_EMAIL=… E2E_PASSWORD=… pnpm test:e2e
```

Sans `E2E_EMAIL` / `E2E_PASSWORD`, ces tests sont explicitement ignorés (seul le test d'accueil s'exécute).

## Montage (phase 7)

Le moteur (`packages/nle/*`) garde ses tests d'origine, sauf `demux`, ignoré sans ses fixtures FFmpeg. Le lien film ↔
studio est couvert par `apps/web/test/montage-film.test.ts` (assemblage, attentes, nouvelle version, son lié, plan
retiré), l'API par `apps/api/tests/test_integration_montage.py` (révisions, droits, formats refusés), et le parcours
complet par `apps/web/e2e/montage.spec.ts` (assemblage, ⌘K, annulation, rechargement, version reçue ; composition vérifiée
au pixel : fondu enchaîné, titre, images clés, mixage). La composition pure (`packages/nle/playback/src/composition.test.ts`),
les transitions et les images clés (`packages/nle/timeline-model/src`) ont leurs tests. L'E2E utilise des
images, car le Chromium de Playwright ne décode pas le H.264 : la lecture vidéo et le son se vérifient avec
`channel: 'chrome'`.

## Intégration continue

`.github/workflows/ai-scene-studio.yml` : TypeScript (format, lint, types, tests, build, JSON Schema à jour),
Python (ruff, mypy, pytest), puis pile Docker complète (build des images, `--wait`, tests d'intégration, E2E).
