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

### Étape 1.2 — Authentification
- **Ajouté** : `apps/api/src/ass_api/auth/` — hachage Argon2id (`passwords.py`, 12 caractères minimum, vérification à temps comparable même sans compte), jetons opaques (`tokens.py`), sessions en base (`sessions.py`, seule l'empreinte SHA-256 du jeton est stockée, expiration absolue), limitation des échecs de connexion par e-mail et par IP dans Redis (`rate_limit.py`, échec fermé si Redis est indisponible), dépendance « utilisateur courant » avec contrôle CSRF des requêtes modifiantes (`dependencies.py`).
- **Ajouté** : routes `POST /auth/login`, `GET /auth/session`, `POST /auth/logout` (`routes/auth.py`), cookie `HttpOnly` / `SameSite=Lax` / `Secure`, nouvelle session à chaque connexion.
- **Ajouté** : table `user_sessions` (migration `0002`), moteur et sessions SQLAlchemy par application (`db/session.py`), schémas JSON en camelCase (`core/api_model.py`), commande `python -m ass_api.cli create-user` (l'inscription publique est fermée).
- **Modifié** : configuration (`ASS_SESSION_*`, `ASS_LOGIN_*`, cookie `Secure` obligatoire en production), gestionnaire d'erreurs (conserve `Retry-After`), `main.py` (cycle de vie : moteur et limiteur), fixture de base temporaire déplacée dans `conftest.py`.
- **Documentation** : `API.md`, `SECURITY.md`, `DEVELOPMENT.md`, `DEPLOYMENT.md` (dont `FORWARDED_ALLOW_IPS` derrière un proxy), `KNOWN_LIMITATIONS.md`, `CHANGELOG.md`.
- **Objectif** : permettre à un utilisateur de se connecter de façon sûre, préalable aux droits par workspace (1.3).
- **Vérifications** : ruff, mypy strict ; 51 tests unitaires ; 36 tests d'intégration (PostgreSQL et Redis réels) ; essai manuel avec uvicorn et curl (connexion, session, déconnexion refusée sans CSRF puis acceptée, session révoquée).

### Étape 1.3 — Autorisation par workspace
- **Ajouté** : `auth/permissions.py` — rôles ordonnés (`viewer` < `editor` < `admin` < `owner`) et contrôles d'accès qui retrouvent le workspace à partir de la ressource (workspace, projet, séquence, plan) par jointure sur l'appartenance de l'utilisateur ; `404` hors workspace (existence non révélée), `403` rôle insuffisant ; verrouillage de ligne optionnel pour les modifications.
- **Ajouté** : `core/pagination.py` (pagination par curseur opaque sur `(created_at, id)`), `routes/workspaces.py` (création avec rôle `owner`, liste paginée de mes workspaces, lecture, renommage `admin`, suppression `owner`), `routes/schemas.py` (noms nettoyés et bornés).
- **Ajouté** : `tests/support.py` et fixtures partagées (`api_settings`, `db_factory`, `clients` : un client connecté par utilisateur), `test_integration_workspaces.py` (isolation entre deux utilisateurs, rôles, CSRF, pagination, curseur invalide), `test_permissions_units.py`.
- **Objectif** : garantir qu'aucun utilisateur n'accède aux données d'un workspace dont il n'est pas membre, avant d'exposer projets, séquences et plans.
- **Vérifications** : ruff, mypy strict ; 61 tests unitaires ; 52 tests d'intégration (PostgreSQL, Redis).

### Étape 1.4 — API CRUD : membres, invitations, projets, séquences, plans
- **Ajouté** : `routes/members.py` (liste, changement de rôle, retrait par un admin ou départ volontaire ; le propriétaire ne peut être ni rétrogradé ni retiré).
- **Ajouté** : `routes/invitations.py` et table `workspace_invitations` (migration `0003`) — lien à usage unique renvoyé une seule fois à l'admin (aucun e-mail envoyé), empreinte du jeton seule en base, une invitation en attente par adresse ; acceptation qui crée le compte et ouvre la session, ou qui exige d'être connecté avec le compte invité s'il existe déjà (le lien ne permet jamais de prendre la main sur un compte existant).
- **Ajouté** : `routes/projects.py`, `routes/sequences.py`, `routes/shots.py`, `routes/ordering.py` — CRUD complet, cadence rationnelle validée (1 à 1000 i/s), cadence de plan facultative avec cadence effective calculée, insertion à une position, réordonnancement par liste complète (refus si ce n'est pas exactement la liste du parent), recompactage à la suppression, verrou de la ligne parente pour sérialiser les modifications d'ordre.
- **Modifié** : `auth/dependencies.py` (session facultative, CSRF exigé dès qu'une session est présentée), configuration (`ASS_INVITATION_TTL_HOURS`, `ASS_WEB_BASE_URL`).
- **Tests** : `test_integration_invitations.py` (9 tests) et `test_integration_projects.py` (19 tests) — parcours d'invitation, droits par rôle, isolation entre workspaces sur toutes les routes, ordre, validation, projets retrouvés après reconnexion.
- **Objectif** : livrable de la phase 1 côté API — l'utilisateur crée et retrouve ses projets, séquences et plans, sans jamais voir ceux d'un autre workspace.
- **Vérifications** : ruff, mypy strict ; 61 tests unitaires ; 80 tests d'intégration (PostgreSQL, Redis).

### Étape 1.5 — Types TypeScript générés depuis l'API
- **Ajouté** : `packages/api-client` — `openapi.json` versionné (exporté par `python -m ass_api.cli export-openapi`), `src/schema.gen.ts` généré par openapi-typescript (`scripts/render-types.ts`, rendu déterministe), client `createApiClient` basé sur openapi-fetch (cookies inclus, jeton CSRF mémorisé à chaque réponse de session et ajouté aux requêtes modifiantes, oublié à la déconnexion ou sur `401`), alias d'entités (`Workspace`, `Project`, `Shot`…).
- **Ajouté** : tests de dérive — `apps/api/tests/test_openapi_contract.py` (le fichier versionné doit égaler l'OpenAPI de l'API) et `packages/api-client/test/contract.test.ts` (les types doivent égaler ceux régénérés) ; `test/client.test.ts` (gestion du jeton CSRF) ; commande `pnpm api:generate`.
- **Modifié** : rôles et espaces colorimétriques exposés en énumérations (`Literal`) ; schéma `ProblemOut` déclaré pour toutes les réponses 4XX/5XX (au lieu du format FastAPI par défaut, qui n'est pas celui renvoyé) ; `@ass/shared-types` réexporte les entités de la phase 1 depuis `@ass/api-client` ; le test Python des énumérations compare désormais les `Literal` de l'API aux contraintes de la base.
- **Corrigé** : le test unitaire de la liste des tables n'incluait pas `workspace_invitations` (oubli de l'étape 1.4, qui avait été vérifiée par les seuls tests d'intégration) ; `pnpm test` lancé package par package, car le cache Vitest partagé à la racine échouait aléatoirement en parallèle (`ENOTEMPTY`).
- **Environnement** : Node 22 installé via nvm (le Mac avait Node 24, refusé par `engine-strict`).
- **Objectif** : une seule source de vérité pour les contrats front/back, avant l'interface de l'étape 1.6.
- **Vérifications** : `pnpm check` (format, lint, types, 51 tests TypeScript) ; ruff, mypy ; 64 tests unitaires et 80 tests d'intégration Python.

### Étape 1.6 — Interface web
- **Ajouté** : `apps/web` — `AuthProvider` (session lue au chargement, connexion, déconnexion), `RequireAuth` (redirection vers `/login?next=…`, chemin de retour limité aux chemins internes), en-tête avec utilisateur et déconnexion, composants de formulaire accessibles (libellés, `role="alert"`).
- **Ajouté** : pages `/login`, `/workspaces` (création, liste paginée « Charger plus »), `/workspaces/[id]` (projets avec cadence et résolution prédéfinies, renommage admin, suppression owner avec confirmation), `/workspaces/[id]/members` (rôles, retrait, départ, lien d'invitation affiché une seule fois, révocation), `/invitations/[token]` (création de compte ou acceptation par le compte connecté), `/projects/[id]` (séquences et plans : création, renommage, ordre ↑/↓, suppression, durée en frames et en secondes, description et suppression du projet).
- **Ajouté** : tests unitaires (`lib.test.ts` : ordre, chemin de retour, messages d'erreur, cadences ; `LoginForm.test.tsx`) et E2E `e2e/projects.spec.ts` (redirection, mauvais mot de passe, parcours complet avec rechargement et reconnexion) ; création du compte E2E dans la CI.
- **Modifié** : image Docker web (manifeste de `@ass/api-client`), `next.config.ts` (`transpilePackages`), page d'accueil.
- **Documentation** : `README.md` (premier compte, état), `TESTING.md` (E2E de la phase 1), `DEPLOYMENT.md` (front et API sur le même site pour le cookie `SameSite=Lax`), `KNOWN_LIMITATIONS.md` (fonctions de l'API non exposées à l'écran), `CHANGELOG.md`.
- **Objectif** : livrable de la phase 1 — l'utilisateur crée et retrouve ses projets depuis le navigateur.
- **Vérifications** : `pnpm check` (58 tests TypeScript) ; build de production ; pile Docker complète reconstruite (`docker compose up --build --wait`, 6 services sains, `/health/ready` OK y compris S3) ; 81 tests d'intégration Python contre la pile (le test S3, impossible en phase 0, passe) ; 4 E2E Playwright contre les conteneurs ; contrôle visuel de la page projet.

### Étape 1.7 — Clôture de la phase 1
- **Vérifié** : premier passage du workflow GitHub Actions sur la branche avec le code de la phase 1 (run 41676773358) — TypeScript, Python (64 tests unitaires), pile Docker complète (81 tests d'intégration réels, dont S3), 4 E2E contre les conteneurs : tout au vert.
- **Modifié** : `KNOWN_LIMITATIONS.md` (la CI tourne désormais sur GitHub), `CHANGELOG.md` (version 0.2.0).

### Bilan de la phase 1
- **Livrable** (« l'utilisateur peut créer et retrouver ses projets ») : atteint et couvert par un E2E qui crée workspace, projet, séquence et plans, recharge la page, se déconnecte, se reconnecte et retrouve le projet.
- **Fonctionnalités** : connexion par session (Argon2id, cookie HttpOnly/SameSite/Secure, CSRF, limitation des échecs), workspaces avec rôles et isolation stricte, membres et invitations à usage unique, CRUD des projets, séquences et plans avec ordre, contrats TypeScript générés depuis l'OpenAPI, interface web.
- **Commandes exécutées** : `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy …`, `uv run pytest apps/api`, `ASS_RUN_INTEGRATION=1 uv run pytest apps/api -m integration`, `pnpm check`, `pnpm --filter @ass/web build`, `docker compose up --build --wait`, `pnpm test:e2e`, `gh run watch`.
- **Tests réussis** : 64 unitaires et 81 d'intégration Python ; 58 TypeScript ; 4 E2E ; CI GitHub au vert. **Tests échoués** : aucun à la clôture (deux défauts trouvés en cours de route et corrigés : contrainte de cadence acceptant une colonne NULL, liste de tables oubliée dans un test).
- **Limitations** : voir `KNOWN_LIMITATIONS.md` — pas d'envoi d'e-mail (lien d'invitation transmis par l'admin), pas de réinitialisation de mot de passe, certaines modifications disponibles dans l'API mais pas à l'écran, pas de déplacement d'un plan entre séquences, purge des sessions expirées à la présentation seulement.
- **Risques restants** : limite d'échecs par e-mail permettant le blocage temporaire d'un compte par un tiers ; derrière un proxy, `FORWARDED_ALLOW_IPS` doit être configuré sinon la limite par IP devient commune ; front et API doivent partager le même site pour le cookie.
- **Prochaine étape** : phase 2 (scène 3D éditable et persistante : viewport, primitives, sélection, gizmos, hiérarchie, inspector, undo/redo, import GLB, sauvegarde en révisions), après validation de la phase 1.

## AI Scene Studio — Phase 2 (éditeur 3D)

Plan suivi (GO de Pierre pour enchaîner) : 2.1 validation serveur des scènes ; 2.2 scènes et révisions immuables
(API, stockage S3) ; 2.3 assets GLB (upload validé, contenu servi) ; 2.4 `scene-engine` (scène canonique ↔
Three.js, opérations d'édition pures) ; 2.5 `editor-ui` (état, sélection, historique annuler/rétablir) ;
2.6 éditeur dans le navigateur (viewport, primitives, sélection, gizmos, hiérarchie, inspecteur, raccourcis,
import GLB, sauvegarde et rechargement) ; 2.7 clôture.

### Étape 2.1 — Validation serveur des scènes
- **Ajouté** : `apps/api/src/ass_api/scenes/validation.py` — structure validée par le JSON Schema généré depuis Zod (copie embarquée dans le package Python pour l'image Docker), norme des quaternions, règles d'intégrité identiques à `validate.ts` (identifiants, parents et cycles, primitives et assets, matériaux, passIndex, caméras, spots, pistes d'animation, plage de rendu) avec les mêmes chemins d'erreur ; refus de `NaN`/`Infinity` et des snapshots > 5 Mo ; sérialisation canonique (clés triées) pour l'empreinte SHA-256.
- **Ajouté** : `tests/fixtures/scenes/invalid-cases.json` (21 cas), joués par `packages/scene-schema/test/shared-cases.test.ts` et `apps/api/tests/test_scene_validation.py` ; test d'égalité entre la copie embarquée et le JSON Schema généré.
- **Modifié** : `pnpm schema:generate` écrit aussi la copie embarquée ; `jsonschema` devient une dépendance de l'API.
- **Objectif** : lever la limite connue « intégrité de scène côté Python » avant tout enregistrement de scène.
- **Vérifications** : 27 tests Python et 54 tests TypeScript de validation.

