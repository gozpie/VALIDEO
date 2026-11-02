# Rapport de modifications

## Historique

### Documentation initiale
- Mise à jour du `README.md` avec une description détaillée du projet, des fonctionnalités principales, des endpoints et du flux d’utilisation.
- Objectif : clarifier le périmètre fonctionnel de VALIDEO et faciliter la prise en main.

## AI Scene Studio — Phase 0 (audit et initialisation)

Le nouveau produit est développé dans le sous-dossier `ai-scene-studio/`, pour ne pas toucher à l'application PHP VALIDEO existante (aucun fichier PHP/JS existant n'a été modifié).

### Étape 0.1 — Socle du monorepo et schéma canonique de scène
- **Ajouté** : configuration racine du monorepo (`package.json` pnpm, `pnpm-workspace.yaml`, `tsconfig.base.json` en mode strict, ESLint flat config, Prettier, EditorConfig, `.nvmrc`, `.python-version`, `.gitignore`).
- **Ajouté** : `packages/scene-schema` — format canonique de scène v1 (Zod) : transformations (position, quaternion XYZW, échelle), nœuds, caméras physiques, lumières, matériaux PBR, pistes d'animation à keyframes en frames entières, références, réglages de rendu. Validation d'intégrité (ID uniques, parents, cycles, cibles d'animation, types de valeurs…), mécanisme de migration de version, fabrique de scène vide, export JSON Schema pour le backend Python.
- **Ajouté** : fixtures de scènes partagées (`tests/fixtures/scenes`).
- **Objectif** : poser le contrat de données central (« la scène 3D est la source de vérité ») avant tout développement applicatif.
- **Vérifications** : `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test` (33 tests réussis).

### Étape 0.2 — Contrats partagés et contrat des fournisseurs IA
- **Ajouté** : `packages/shared-types` — contrats des entités (User, Workspace, WorkspaceMember, Project, Sequence, Shot, Scene, SceneRevision, Asset, GenerationJob, RenderVersion), machine à états des jobs (transitions autorisées, états terminaux), enveloppe d'erreur API.
- **Ajouté** : `packages/generation-sdk` — interface `ProviderAdapter` (getCapabilities, validateRequest, estimateCost, submitGeneration, getJobStatus, cancelGeneration, retrieveOutputs, normalizeError) et `matchCapabilities`, qui signale explicitement les contraintes bloquantes ou ignorées par un modèle.
- **Objectif** : figer les contrats entre frontend, backend et workers avant l'implémentation (aucune API fournisseur réelle ou fictive n'est intégrée à ce stade).
- **Vérifications** : lint, typecheck, 42 tests TypeScript réussis.

### Étape 0.3 — Backend Python (FastAPI) et migrations
- **Ajouté** : espace de travail Python `uv` (`pyproject.toml` racine, `uv.lock` figé), outils ruff, mypy strict et pytest.
- **Ajouté** : `apps/api` — application FastAPI : configuration par variables d'environnement (`ASS_*`, secrets en `SecretStr`, refus des identifiants de développement en production, CORS sans joker), logs JSON structurés avec masquage des secrets, identifiant de corrélation `X-Request-ID`, en-têtes de sécurité, erreurs au format « problem details », endpoints `/health/live` et `/health/ready` (PostgreSQL, Redis, S3 avec timeouts, sans fuite de secrets).
- **Ajouté** : `infrastructure/migrations` — configuration Alembic (URL lue depuis l'environnement, convention de nommage des contraintes). Aucune table n'est créée avant la phase 1.
- **Ajouté** : test de contrat inter-langages — le JSON Schema généré côté TypeScript valide les fixtures côté Python.
- **Objectif** : disposer d'un backend démarrable, observable et testable, prêt à recevoir le modèle de données en phase 1.
- **Vérifications** : ruff, mypy, 21 tests unitaires réussis ; 2 tests d'intégration réussis contre PostgreSQL 16 et Redis 7 réels ; `alembic check` OK. Le test d'intégration S3 n'a pas pu être exécuté (MinIO indisponible dans l'environnement).
