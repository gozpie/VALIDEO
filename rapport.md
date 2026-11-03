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

### Étape 0.4 — Application web (Next.js)
- **Ajouté** : `apps/web` — Next.js 16 (App Router, TypeScript strict, Tailwind 4, thème sombre), en-têtes de sécurité, page d'accueil qui interroge réellement `/health/ready` et affiche l'état de chaque dépendance (chargement, API dégradée, API injoignable, bouton « Revérifier »). Aucun bouton décoratif ; l'éditeur 3D n'est pas simulé.
- **Ajouté** : tests unitaires Vitest + React Testing Library, test E2E Playwright exécuté sur le build de production.
- **Objectif** : valider la chaîne front complète (build, tests, E2E) et la liaison front ↔ API.
- **Vérifications** : build de production OK, typecheck, lint, 6 tests unitaires et 1 test E2E réussis (API réelle avec PostgreSQL/Redis).

### Étape 0.5 — Docker Compose, CI et scripts
- **Ajouté** : `compose.yaml` — PostgreSQL 16, Redis 7, stockage S3 (SeaweedFS), création idempotente du bucket, migrations Alembic, API, web, et reverse proxy nginx optionnel (profil `proxy`). Ports d'infrastructure liés à `127.0.0.1` uniquement, healthchecks partout.
- **Ajouté** : Dockerfiles multi-étapes (API Python avec uv, web Next.js standalone), utilisateurs non-root, secret BuildKit optionnel `extra_ca` pour les proxys d'entreprise (jamais copié dans l'image).
- **Ajouté** : workflow GitHub Actions `.github/workflows/ai-scene-studio.yml` (TypeScript, Python, puis pile Docker complète avec tests d'intégration et E2E), scripts `scripts/check-env.sh` et `scripts/check-all.sh`, commande `python -m ass_api.cli ensure-bucket`.
- **Modifié** : identifiants S3 de développement par défaut et garde-fou de production associé ; Playwright peut cibler un serveur déjà démarré (`E2E_BASE_URL`).
- **Écart au cahier des charges** : MinIO est remplacé par SeaweedFS (compatible S3, Apache-2.0), car les images MinIO ne sont plus distribuées publiquement. Le code n'utilise que l'API S3 standard : tout stockage compatible S3 peut être utilisé.
- **Objectif** : environnement reproductible en une commande et intégration continue.
- **Vérifications** : `docker compose up --wait` (6 services sains), `/health/ready` = 200, 3 tests d'intégration réels (PostgreSQL, Redis, S3), E2E sur le conteneur web, proxy nginx testé, `scripts/check-all.sh` OK. Le workflow CI n'a pas encore tourné sur GitHub.

### Étape 0.6 — Documentation
- **Ajouté** : `README.md`, `ARCHITECTURE.md`, `DEVELOPMENT.md`, `DEPLOYMENT.md`, `SCENE_SCHEMA.md` (conventions d'axes, conversions glTF/Blender, temps, caméras, migrations), `API.md`, `SECURITY.md`, `TESTING.md`, `KNOWN_LIMITATIONS.md`, `CHANGELOG.md`, ainsi que des README décrivant le rôle des packages et workers prévus pour les phases suivantes.
- **Modifié** : `README.md` racine — courte section qui renvoie vers `ai-scene-studio/`.
- **Objectif** : documenter l'installation, les commandes, les variables, la base, le stockage, la sauvegarde et la restauration, la sécurité et les limites dès la phase 0.

### Bilan de la phase 0
- 48 tests TypeScript, 21 tests unitaires Python, 3 tests d'intégration réels et 1 E2E réussis ; lint, format et typage au vert.
- En attente de validation utilisateur avant la phase 1.

## AI Scene Studio — Phase 1 (application et données)

### Étape 1.1 — Modèle de données et migration initiale
- **Ajouté** : `apps/api/src/ass_api/db/models.py` — tables `users`, `workspaces`, `workspace_members`, `projects`, `sequences`, `shots` (UUID, dates `timestamptz`, rôles et espaces colorimétriques en texte contraint par `CHECK`, fps rationnel, ordre unique par parent vérifié en fin de transaction pour permettre les réordonnancements).
- **Ajouté** : migration Alembic `0001` (`infrastructure/migrations/versions/20261103_0001_identites_workspaces_projets.py`), réversible.
- **Ajouté** : `apps/api/tests/test_models.py` (tables, clés UUID, règles de suppression, rôles et espaces colorimétriques identiques à `shared-types`) et `apps/api/tests/test_integration_database.py` (base PostgreSQL temporaire créée puis supprimée : `alembic check`, aller-retour des migrations, unicité et casse de l'e-mail, contraintes, cascades, réordonnancement).
- **Ajouté** : `CLAUDE.md`, exigé par le cahier des charges et absent de la phase 0.
- **Modifié** : `infrastructure/migrations/env.py` (enregistrement des modèles, URL de base surchargeable par les tests) ; `ARCHITECTURE.md`, `KNOWN_LIMITATIONS.md`, `CHANGELOG.md`.
- **Corrigé pendant l'étape** : la contrainte « fps propre au plan » acceptait une seule des deux colonnes renseignée (un `CHECK` évalué à NULL est accepté par PostgreSQL) ; détecté par le test, corrigé.
- **Reporté** : `scenes` et `shots.active_scene_revision_id` en phase 2, avec les révisions de scène qu'elles référencent.
- **Objectif** : poser le socle persistant sur lequel reposeront l'authentification (1.2), les droits (1.3) et le CRUD (1.4).
- **Vérifications** : ruff, format, mypy strict ; 37 tests unitaires Python ; 18 tests d'intégration contre PostgreSQL 16 réel.

