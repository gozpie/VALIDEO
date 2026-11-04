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

### Étape 2.2 — Scènes et révisions immuables
- **Ajouté** : tables `scenes` et `scene_revisions` (migration `0004`, clé étrangère circulaire créée après les deux tables) ; `core/storage.py` (client S3 générique : existence, écriture idempotente, lecture, flux) ; `routes/scenes.py` — lecture de la scène d'un plan, enregistrement d'une révision (validation serveur, sérialisation canonique, empreinte SHA-256, snapshot écrit en S3 sous le préfixe du workspace, jamais écrasé), concurrence optimiste par `baseRevisionId` (`409` si la tête a changé), enregistrement identique sans nouvelle révision, historique et lecture d'une révision ; corps lu par le serveur (taille bornée `413`, `NaN` refusé) ; erreurs de scène en `422` avec chemins.
- **Modifié** : `@ass/api-client` (types `SceneState`, `SceneRevision`, `SaveRevisionResult`), `@ass/shared-types` (formes cibles `Scene`/`SceneRevision` remplacées par les types générés).
- **Tests** : `test_integration_scenes.py` (9 tests : scène absente, enregistrement et rechargement à l'identique, objet S3 présent, enregistrement identique, historique et parent, conflit, `sceneId` stable, scène invalide, `NaN`, corps trop gros, rôles et isolation, cascade à la suppression du plan).
- **Objectif** : rendre la scène persistante et versionnée avant l'éditeur.
- **Vérifications** : ruff, mypy ; 94 tests unitaires et 90 tests d'intégration Python (PostgreSQL, Redis, S3) ; `pnpm check`.

### Étape 2.3 — Assets GLB
- **Ajouté** : table `assets` (migration `0005`, SHA-256 unique par workspace, métadonnées JSONB) ; `assets/glb.py` (validation : en-tête et version, longueur, chunks, JSON glTF 2.0, refus des ressources externes et des extensions obligatoires sans décodeur, métadonnées descriptives) ; `routes/assets.py` (envoi multipart validé puis écrit en S3 sous une clé construite par le serveur, déduplication, liste paginée, métadonnées, contenu servi en flux après contrôle des droits) ; `core/body_limit.py` (plafond des corps de requête appliqué avant lecture, y compris en transfert « chunked »).
- **Modifié** : l'enregistrement d'une scène refuse les assets d'un autre workspace ou inconnus ; nginx `client_max_body_size` aligné ; `@ass/api-client` et `@ass/shared-types` (type `Asset` généré) ; dépendance `python-multipart`.
- **Ajouté** : `tests/glb_factory.py` (GLB de test sans dépendance) et `tests/fixtures/assets/cube.glb` ; `test_glb.py` (9 tests) et `test_integration_assets.py` (8 tests : envoi et contenu, déduplication, fichiers invalides dont URI externe, limites de taille, rôles et isolation, références depuis une scène).
- **Corrigé** : les tests de scène utilisaient une fixture référençant une image inexistante, désormais refusée par le contrôle des assets.
- **Objectif** : permettre l'import de modèles GLB dans l'éditeur sans jamais exposer le stockage ni accepter de contenu non autonome.
- **Vérifications** : 104 tests unitaires et 98 tests d'intégration Python ; `pnpm check`.

### Étape 2.4 — `@ass/scene-engine`
- **Ajouté** : fabriques (primitives, empty, groupe, modèle, caméra 35 mm, lumières, matériaux), opérations d'édition pures (ajout, suppression en cascade avec pistes et matériaux propres, duplication de sous-arbre avec nouveaux ID, renommage, transformation, visibilité, verrouillage, parentage qui conserve la position monde et refuse cycles et parents non objets, groupement, couleur, réglages caméra et lumière), mathématiques (matrices, Euler ↔ quaternion, champ de vision physique), conversions Three.js (géométries unitaires conformes à SCENE_SCHEMA.md, matériaux en couleurs linéaires, caméra physique, transformations).
- **Dépendances** : `three` 0.187.0 et `@types/three` (versions exactes).
- **Tests** : 11 tests (toutes les opérations produisent des scènes valides, entrée jamais modifiée, position monde conservée, cycles refusés, dimensions et orientation des primitives, champ de vision 35 mm, aller-retour des transformations, couleurs linéaires).
- **Objectif** : un cœur d'édition testable sans navigateur, sur lequel reposent l'historique et l'interface.

### Étape 2.5 — État de l'éditeur (`@ass/editor-ui`)
- **Ajouté** : `src/store.ts` — store Zustand : scène et scène enregistrée (modifications en attente), révision de départ, sélection (remplacer/ajouter/basculer, purgée des entités supprimées), outil, magnétisme, historique annuler/rétablir borné à 200 entrées, gestes continus inscrits en une seule entrée, opérations invalides ignorées sans perte d'état ; `topLevelSelection`.
- **Écart** : Immer n'est pas utilisé (les opérations pures de `scene-engine` suffisent) ; documenté dans le README du package.
- **Tests** : 7 tests (annuler/rétablir, gestes, opération refusée, borne de l'historique, sélection, modifications en attente, sélection de premier niveau).

### Étape 2.6 — Éditeur 3D dans le navigateur
- **Ajouté** : `apps/web/src/editor/` — `Viewport.tsx` (React Three Fiber : caméras perspective et orthographique, OrbitControls, vues avant/arrière/gauche/droite/dessus/dessous, grille, axes XYZ, cadrage `F`, primitives, modèles GLB chargés depuis l'API avec cookie, icônes de caméras et de lumières, lumières réelles de la scène orientées selon −Z local, éclairage d'aperçu, sélection au clic et rectangle, gizmo TransformControls avec magnétisme et un seul pas d'historique par geste), `Hierarchy.tsx` (arbre, recherche, renommage par double-clic, masquage, verrouillage), `Inspector.tsx` (position, rotation en degrés, échelle, parent avec conservation de la position monde, couleur, focale et capteur, intensité et couleur des lumières, dupliquer/grouper/supprimer), `AddMenu.tsx` (6 primitives, empty, groupe, caméra, 3 lumières, import GLB), `Toolbar.tsx` (état d'enregistrement, annuler/rétablir, outils, magnétisme, rectangle, projection, vues, cadrer, enregistrer), `useShortcuts.ts` (W/E/R, F, H, B, Suppr, ⌘Z/⇧⌘Z, ⌘D, ⌘G, ⌘S, Échap), `EditorShell.tsx` (validation avant enregistrement, révision avec `baseRevisionId`, avertissement avant de quitter avec des modifications).
- **Ajouté** : page `/shots/[shotId]/editor` (scène migrée à la lecture ou nouvelle scène aux réglages du plan et du projet, lecture seule pour un `viewer`) ; lien vers l'éditeur depuis chaque plan ; `uploadAsset` (multipart avec CSRF).
- **Modifié** : image Docker web (manifestes de `scene-engine` et `editor-ui`) ; dépendances `three`, `@react-three/fiber`, `@react-three/drei`, `zustand` (versions exactes).
- **Tests** : `editor-panels.test.tsx` (4 tests : hiérarchie, sélection, inspecteur et historique, masquage, verrouillage, lecture seule) ; E2E `editor.spec.ts` (ajout d'un cube, déplacement numérique, annuler/rétablir au clavier, renommage, import du GLB de test, duplication, suppression et annulation, enregistrement, rechargement complet et vérification, aucune erreur JavaScript) ; contrôle visuel du rendu (cube sélectionné avec gizmo, modèles GLB, tore).
- **Objectif** : livrable de la phase 2 — une scène 3D réellement éditable et persistante.

### Étape 2.7 — Clôture de la phase 2
- **Vérifié** : pile Docker reconstruite avec l'éditeur (6 services sains) ; 98 tests d'intégration et 5 E2E contre les conteneurs ; CI GitHub au vert (run 41682069748), y compris l'E2E de l'éditeur avec rendu WebGL sous Linux.
- **Modifié** : `README.md` (état, feuille de route), `CHANGELOG.md` (version 0.3.0).

### Bilan de la phase 2
- **Livrable** (« une scène 3D est réellement éditable et persistante ») : atteint et couvert par un E2E qui ajoute un cube, le déplace, annule et rétablit, le renomme, importe un GLB, duplique, supprime et annule, enregistre, recharge la page et retrouve la scène à l'identique.
- **Fonctionnalités** : viewport (orbite, pan, zoom, perspective/orthographique, 6 vues, grille, axes, cadrage), 6 primitives, empty, groupe, caméra, 3 lumières, import GLB validé, sélection simple/multiple/rectangle, gizmos déplacement/rotation/échelle avec magnétisme, transformations numériques, duplication, suppression, groupement, parentage, renommage, masquage, verrouillage, annuler/rétablir, raccourcis W/E/R/F/H/B/Suppr/⌘Z/⇧⌘Z/⌘D/⌘G/⌘S, enregistrement en révisions immuables (S3, SHA-256, concurrence optimiste) et rechargement.
- **Commandes exécutées** : `uv run ruff check .`, `uv run mypy …`, `uv run pytest apps/api`, `ASS_RUN_INTEGRATION=1 uv run pytest apps/api -m integration`, `pnpm check`, `pnpm schema:generate`, `pnpm api:generate`, `pnpm --filter @ass/web build`, `docker compose up --build --wait`, `pnpm test:e2e`, `gh run watch`.
- **Tests réussis** : 104 unitaires et 98 d'intégration Python ; 101 tests TypeScript ; 5 E2E ; CI au vert. **Tests échoués** : aucun à la clôture (corrigés en cours : attente de FOV erronée dans un test, bruit numérique du parentage, fixture de scène référençant un asset absent, localisateurs E2E).
- **Écarts au cahier des charges** : Immer non utilisé (opérations pures) ; composants de l'éditeur dans `apps/web/src/editor` plutôt que `packages/editor-ui` ; envoi des assets via l'API (100 Mo) au lieu d'un upload multipart direct avec reprise ; seuls les GLB sont importés (glTF à fichiers séparés, textures, HDRI à venir).
- **Limitations** : voir `KNOWN_LIMITATIONS.md` (gizmo sur l'élément principal seulement, masquage hérité par les enfants, rectangle sur les centres, pas de glisser-déposer dans la hiérarchie, panneaux fixes, animations GLB non jouées, pas de vue caméra avant la phase 3).
- **Risques restants** : performances non mesurées sur de grosses scènes (pas d'instancing ni de LOD) ; objets orphelins possibles dans le stockage si une écriture en base échoue après l'envoi (adressage par contenu, nettoyage à prévoir) ; un snapshot est limité à 5 Mo.
- **Prochaine étape** : phase 3 (caméras et animation : vue caméra, timeline, keyframes, interpolation, animation d'objets et de caméra, lecture, sauvegarde, tests déterministes), après validation de la phase 2.

## AI Scene Studio — Phase 3 (caméras et animation)

Plan suivi (GO de Pierre) : 3.1 moteur d'animation ; 3.2 format de scène v2 (caméra active, marqueurs,
verrouillage et visée des caméras) et contraintes ; 3.3 caméras dans l'éditeur (caméra active, vue caméra,
vue simultanée, mouvements de caméra, trajectoire) ; 3.4 timeline (lecture, pistes, clés, marqueurs, zoom,
déplacement, copier-coller) ; 3.5 clôture (E2E, CI, bilan).

### Étape 3.1 — Moteur d'animation
- **Ajouté** : `packages/animation-engine` — `evaluateTrack` / `evaluateScene` (step, linear, Bézier cubique temps-valeur, ease in/out/in-out, slerp au plus court chemin, extrapolations constant/linear/cycle, bornes physiques des grandeurs après dépassement de Bézier), édition pure des clés (`setKey`, `removeKeys`, `moveKeys`, `copyKeys`, `pasteKeys`, `setTransformAtFrame`, `keyTransform`).
- **Ajouté** : référence de déterminisme `tests/fixtures/animation/cube-camera-animated.expected.json` (valeurs de la fixture animée à 11 frames, dont fractionnaires et hors plage).
- **Tests** : 13 tests (passage exact par les clés, chaque interpolation, Bézier droite et symétrique, slerp et signe opposé, extrapolations, booléens, entrée non modifiée, référence, indépendance vis-à-vis de l'ordre d'évaluation, édition des clés).
- **Objectif** : un état de scène exact pour n'importe quelle frame, séparé de l'affichage.

### Étape 3.2 — Format de scène v2, contraintes et mouvements de caméra
- **Modifié** : `@ass/scene-schema` — `CURRENT_SCHEMA_VERSION = 2` : `activeCameraId`, `markers`, caméras `locked` / `lookAtTargetId` / `rollRadians`, propriété animable `camera.rollRadians` ; règles d'intégrité (caméra active existante, cible de visée existante et différente de la caméra, marqueurs dans la durée, identifiants de marqueurs uniques) ; migration `migrateV1toV2` ; fabrique de scène vide ; JSON Schema renommé `scene.schema.json`.
- **Ajouté** : fixtures `empty.v2.json` et `cube-camera-animated.v2.json` (résultat exact de la migration des fixtures v1), 5 nouveaux cas invalides partagés TypeScript/Python.
- **Modifié** : validation Python (mêmes règles, propriété animable) ; `scene-engine` (caméras verrouillables, `setActiveCamera`, nettoyage de la caméra active et des cibles de visée à la suppression, copie des cibles à la duplication) ; `animation-engine` (roulis animé).
- **Ajouté** : `scene-engine/src/camera.ts` — `moveCamera` (dolly, truck, pedestal, pan, tilt, orbite) et `evaluateFrame` (animation puis contrainte de visée avec roulis, y compris pour une caméra enfant).
- **Tests** : migrations avant/après et non-mutation, 26 cas partagés, mouvements de caméra, visée d'une cible animée à plusieurs frames, roulis, caméra active et suppressions (TypeScript 61 + 16 + 14 tests sur ces packages ; Python 109 unitaires, 98 intégration).
- **Objectif** : associer une caméra active à chaque plan et calculer ses mouvements à partir des clés et des contraintes, de façon déterministe.

### Étapes 3.3 et 3.4 — Caméras et timeline dans l'éditeur
- **Ajouté** (`packages/editor-ui`) : état temporel (frame courante, lecture, boucle, sélection et presse-papiers de clés, disposition des vues) et `evaluatedScene` (scène évaluée mise en cache par scène et par frame).
- **Ajouté** (`packages/animation-engine`, `packages/scene-engine`) : `setKeysInterpolation`, `addMarker`, `removeMarker`, `setCameraLookAt`.
- **Ajouté** (`apps/web/src/editor`) : `Timeline.tsx` (transport, frame et temps, règle cliquable et glissable, marqueurs, pistes par entité repliables, losanges de clés sélectionnables et déplaçables, choix de l'interpolation, zoom), `usePlayback.ts` (frame déduite du temps écoulé et de la cadence rationnelle), `CameraViewport.tsx` (rendu par la caméra active évaluée : position et orientation monde, FOV physique, format de rendu, orthographique), trajectoire de l'élément animé sélectionné dans la vue libre.
- **Modifié** : la vue libre et l'inspecteur affichent la scène évaluée ; toute édition d'une propriété animée (gizmo, champs, mouvements de caméra) pose une clé à la frame courante ; inspecteur (indicateurs ◆/◇, clés de transformation, de visibilité, de focale, d'ouverture et d'intensité, caméra active, visée, roulis, capteur, mise au point, near/far, mouvements dolly/truck/pedestal/pan/tilt/orbite avec pas réglables) ; barre d'outils (caméra active, disposition des vues) ; raccourcis (Espace, ←/→, Origine/Fin, K, ⌘C/⌘V, Suppr sur les clés) ; verrouillage des caméras ; la première caméra ajoutée devient active.
- **Tests** : `editor-ui` (temps, cache) ; E2E `animation.spec.ts` (clé, clé automatique à la frame 24, relecture exacte à la frame 12, interpolation palier, caméra active et visée, vue double, marqueur, lecture, enregistrement, rechargement et vérification de toutes les données) ; contrôle visuel de la vue double et de la timeline.
- **Objectif** : livrable de la phase 3 — un plan 3D animé peut être créé et relu.

### Étape 3.5 — Clôture de la phase 3
- **Modifié** : image Docker web (manifeste de `animation-engine`), `README.md`, `CHANGELOG.md` (version 0.4.0).
- **Vérifié** : pile Docker reconstruite ; 98 tests d'intégration et 6 E2E contre les conteneurs ; CI GitHub au vert (run 41686775358).

### Bilan de la phase 3
- **Livrable** (« un plan 3D animé peut être créé et relu ») : atteint et couvert par un E2E qui anime un cube (clé, clé automatique, interpolation), ajoute une caméra active qui le vise, affiche la vue caméra, pose un marqueur, lit l'animation, enregistre, recharge et retrouve exactement les valeurs aux frames 12 et 24, le marqueur, la caméra active et la visée.
- **Fonctionnalités** : moteur d'animation pur et déterministe (step, linéaire, Bézier, ease, slerp, extrapolations) ; format v2 (caméra active, marqueurs, caméras verrouillables avec visée et roulis) et migration ; évaluation d'une frame = animation puis contraintes ; caméras physiques (focale, capteur, FOV, ouverture, mise au point, near/far, roulis, verrouillage, visée), mouvements dolly/truck/pedestal/pan/tilt/orbite, trajectoire ; vue caméra, vue double, sélecteur de caméra ; timeline (lecture, pause, stop, pas à pas, boucle, navigation, marqueurs, pistes repliables, zoom, sélection multiple, déplacement, interpolation, copier-coller, suppression).
- **Commandes exécutées** : `pnpm check`, `pnpm schema:generate`, `pnpm api:generate`, `UPDATE_GOLDEN=1 vitest run` (création de la référence), `uv run ruff check .`, `uv run mypy …`, `uv run pytest apps/api`, `ASS_RUN_INTEGRATION=1 uv run pytest apps/api -m integration`, `docker compose up --build --wait`, `pnpm test:e2e`, `gh run watch`.
- **Tests réussis** : 109 unitaires et 98 d'intégration Python ; 129 TypeScript ; 6 E2E ; CI au vert. **Tests échoués** : aucun à la clôture (un défaut de mise en forme committé puis corrigé dans un commit séparé).
- **Écarts** : contrainte « suivre une cible » non implémentée (visée seule) ; poignées de Bézier sans éditeur de courbes ; profondeur de champ non prévisualisée (rendu en phase 4).
- **Limitations et risques** : voir `KNOWN_LIMITATIONS.md` ; l'identité visuelle entre la vue Three.js et le futur rendu Blender ne sera vérifiée que sur les transformations, focales et le cadrage (phase 4) ; la référence de déterminisme couvre la fixture animée, pas encore des scènes complexes.
- **Prochaine étape** : phase 4 (rendu technique : export de scène, worker Blender, passes, FFmpeg), après validation de la phase 3. Elle exigera Blender en mode headless et des décisions d'infrastructure (version de Blender, rendu CPU ou GPU).

## AI Scene Studio — Phase 4 (rendu technique)

Demande de Pierre en cours de phase : « se rapprocher le plus de l'application Blender ». Choix retenus : le rendu
final est fait par le **vrai Blender** (4.5 LTS, Cycles sur CPU dans un conteneur, sans GPU), chaque rendu fournit
aussi un **fichier .blend** ouvrable dans Blender avec les clés converties en courbes Blender, et l'éditeur reçoit
des **raccourcis façon Blender** (sans copier son apparence, conformément au cahier des charges).

Plan suivi : 4.1 portage Python de l'évaluation ; 4.2 jobs de rendu (table, file Redis, API, reprise, annulation,
délais) ; 4.3 construction de la scène dans Blender (script bpy) et passes ; 4.4 worker de rendu (Blender, FFmpeg,
assets de sortie, image Docker) ; 4.5 tests de cohérence Blender ; 4.6 éditeur (panneau Rendu, raccourcis façon
Blender) ; 4.7 clôture.

### Étape 4.1 — Évaluation en Python
- **Ajouté** : `apps/api/src/ass_api/animation/` (`evaluate.py`, `math3d.py`) — portage exact de `evaluateTrack`, `evaluateScene` et de la contrainte de visée (hiérarchie, roulis), en Python pur.
- **Ajouté** : fixture `tests/fixtures/scenes/look-at.v2.json` (caméra enfant d'un rig tourné et mis à l'échelle, visée d'un cube animé en Bézier, roulis animé en cycle, visibilité en palier, marqueur) et référence `tests/fixtures/animation/look-at.expected.json` produite par TypeScript (`packages/scene-engine/test/golden.test.ts`).
- **Tests** : `test_animation_port.py` — les deux références (10 et 11 frames, dont fractionnaires et hors plage) sont reproduites à 1e-9 près ; l'entrée n'est pas modifiée.
- **Objectif** : Blender recevra exactement les valeurs que l'éditeur affiche (déterminisme inter-langages).

### Étape 4.2 — Jobs de rendu
- **Ajouté** : table `render_jobs` (migration `0006` : état, réglages JSONB, progression, message, erreur, sorties, clé d'idempotence unique par workspace, demande d'annulation, worker, horodatages) ; `render/jobs.py` (transitions identiques à `shared-types/src/jobs.ts`, vérifiées par un test qui lit le fichier TypeScript ; file Redis fiable avec liste « en cours » par worker ; signe de vie ; échec des jobs abandonnés) ; `routes/renders.py` (lancement validé contre la révision : plage de frames, résolution, échantillons, passes ; idempotence ; liste ; détail ; annulation).
- **Modifié** : correction des poignées de Bézier alignée sur Blender (`BKE_fcurve_correct_bezpart` : réduction proportionnelle des deux poignées quand elles dépassent ensemble la durée du segment) dans les moteurs TypeScript et Python, pour que les courbes exportées dans Blender s'évaluent à l'identique ; test dédié dans chaque langage (références inchangées).
- **Tests** : `test_render_jobs.py` (contrat, transitions), `test_integration_renders.py` (11 tests : révision requise, création et mise en file, valeurs par défaut, réglages invalides, idempotence, annulation en file et en cours, échec des jobs abandonnés, rôles et isolation, file fiable).

### Étapes 4.3 et 4.4 — Construction de la scène dans Blender et worker de rendu
- **Ajouté** : `render/prepare.py` — description de scène pour Blender : courbes natives pour position, échelle, focale, ouverture, mise au point, intensité, couleur, opacité et visibilité (équivalences exactes d'interpolation, d'extrapolation et de cycle), échantillonnage par frame des rotations animées et des caméras contraintes, unités des lumières de l'importeur glTF, objets proxy non rendus, éclairage d'aperçu si la scène n'a aucune lumière.
- **Ajouté** : `workers/render-worker/blender/build_scene.py` — racine Y-up → Z-up, primitives aux dimensions canoniques, import GLB avec compensation de la conversion d'axes, matériaux Principled, caméras (capteur horizontal, orthographique, profondeur de champ), lumières, courbes d'animation, rendu Cycles CPU déterministe (graine fixe, sans débruitage), passes (Depth, Normal, IndexOB, CryptoObject, Vector), OpenEXR multicouche 32 bits, PNG via le compositeur, `.blend` compressé, mode « sonde » qui relit les valeurs évaluées par Blender.
- **Ajouté** : `render/runner.py` et `render/worker.py` (préparation, téléchargement des modèles du workspace, Blender en sous-processus avec progression par frame, annulation, délai maximal, FFmpeg H.264 et ProRes 4444 alpha, archive des passes, publication des sorties comme assets, gestion des erreurs, reprise après indisponibilité de Redis ou PostgreSQL, arrêt propre), `assets/store.py`.
- **Ajouté** : image `render-worker.Dockerfile` (Blender 4.5.15 LTS officiel vérifié par SHA-256, FFmpeg, bibliothèques système) et service `render-worker` (quotas CPU, mémoire, disque temporaire, processus).
- **Corrigé en cours** : expiration de lecture Redis pendant l'attente bloquante du worker (délai de socket inférieur à l'attente).
- **Vérifications** : sonde Blender sur la fixture `look-at` : positions monde identiques au moteur Python à 1,3e-6 près (précision float32 de Blender) sur 8 frames, Bézier, ease et cycle compris ; rendu réel de bout en bout par l'API (`test_render_worker_live.py` : GLB importé, caméra en visée, animation, 4 frames, vidéo MP4, aperçu PNG, `.blend`, archive de 4 EXR contenant Combined, Depth, Normal, IndexOB et CryptoObject).

### Étape 4.5 — Tests de cohérence avec Blender
- **Ajouté** : `apps/api/tests/test_blender_coherence.py` (7 tests sur de vrais rendus Cycles) — le barycentre de la couverture alpha de l'objet rendu est comparé à la projection calculée depuis la scène canonique et le moteur Python (sténopé à capteur horizontal) : axes (+X à droite, +Y en haut), focales 25 et 50 mm, caméra orthographique, hiérarchie avec rotation de 90°, timing et interpolation ease sur 5 frames, modèle GLB ; et sonde des courbes évaluées par Blender sur la fixture `look-at` (positions, focale, visibilité) face au moteur.
- **Ajouté** : utilitaires de test sans dépendance `png.py` (décodage PNG) et `exr.py` (canaux d'un OpenEXR multicouche).
- **Résultat** : tous les écarts sont inférieurs à 1 pixel (rendu 320 × 180) et à 1e-4 m pour les courbes.
- **CI** : l'étape d'intégration exécute désormais le rendu réel de bout en bout et les tests de cohérence avec l'image du worker.

### Étape 4.6 — Rendu dans l'éditeur et raccourcis façon Blender
- **Ajouté** : `RenderPanel.tsx` (onglet « Rendu » : résolution, fond transparent, flou de mouvement, transformation d'affichage de la scène ; plage de frames, pourcentage de résolution, échantillons et passes du rendu ; enregistrement automatique puis lancement ; suivi avec barre de progression et message ; annulation ; lecteur vidéo ; liens de téléchargement de la vidéo, du ProRes alpha, des passes EXR, de la scène `.blend` et de l'aperçu).
- **Ajouté** : disposition de raccourcis **façon Blender**, choisie par défaut (préférence mémorisée) : G/R/S puis X/Y/Z pour contraindre l'axe (axes de Blender, Z vertical), Maj+A (menu d'ajout flottant), Maj+D, X, H/Maj+H/Alt+H, A/Alt+A, B, Ctrl+P/Alt+P, Alt+G/Alt+R/Alt+S, I/Alt+I, pavé numérique (et chiffres du clavier, comme l'émulation du pavé de Blender) 1/3/7 (Ctrl : vue opposée), 5 (ortho), 0 (vue caméra), « . » (cadrer), Origine (tout cadrer), Espace, ←/→, Maj+←/→, ↑/↓ (clés). Disposition « standard » conservée ; aide des raccourcis dans l'éditeur. Contrainte d'axe du gizmo dans l'état de l'éditeur.
- **Ajouté** : opérations `updateRenderSettings` et `clearParent` ; commandes de l'éditeur (tout sélectionner, masquer le reste, tout afficher, parenter à l'actif, retirer le parent, effacer une transformation, poser/supprimer des clés, aller à la clé suivante/précédente).
- **Tests** : E2E `render.spec.ts` (Maj+A, Maj+D, X, Ctrl+Z, Alt+G, I, caméra active, rendu Blender réel à 10 % jusqu'à « Terminé », vidéo affichée, `.blend` téléchargeable) ; contrôle visuel du panneau de rendu et de l'aide des raccourcis.
- **Objectif** : répondre à la demande de Pierre de « se rapprocher le plus de Blender » (vrai rendu Blender, fichier `.blend`, conventions de raccourcis) sans copier son apparence.

### Étape 4.7 — Clôture de la phase 4
- **Corrigé** : en CI (Linux), les tests de cohérence lancent le conteneur Blender avec l'utilisateur de l'hôte (dossier de travail monté inaccessible sinon).
- **Vérifié** : CI GitHub au vert (run 41693266774) : 116 tests unitaires Python, 118 tests d'intégration dont 7 rendus Blender de cohérence et 1 rendu de bout en bout par le worker, 7 E2E dont le rendu depuis l'éditeur.
- **Modifié** : `README.md`, `ARCHITECTURE.md`, `CHANGELOG.md` (version 0.5.0).

### Bilan de la phase 4
- **Livrable** (« un plan animé peut être rendu hors navigateur ») : atteint — depuis l'éditeur, un plan animé est rendu par Blender 4.5 LTS dans le worker, avec vidéo H.264 lisible dans l'éditeur, passes OpenEXR (beauty RGBA, alpha, profondeur, normales, Object ID, Cryptomatte, vecteurs), aperçu et scène `.blend` téléchargeables ; vérifié en local et en CI.
- **Demande de Pierre « se rapprocher le plus de Blender »** : vrai moteur Blender pour le rendu final, fichier `.blend` avec courbes d'animation natives (interpolations, poignées et cycles équivalents, correction des poignées identique à Blender adoptée par nos deux moteurs), raccourcis façon Blender par défaut. L'apparence de Blender n'est pas copiée (exigence du cahier des charges).
- **Tests de cohérence** : axes, focales, orthographique, hiérarchie, timing et interpolation, GLB — écart < 1 pixel ; courbes évaluées par Blender = moteur à 1e-4 m ; moteur Python = moteur TypeScript à 1e-9.
- **Commandes exécutées** : `docker build` (image du worker), `docker compose up --build --wait`, `blender -b … build_scene.py` (sonde et rendus), `ASS_BLENDER=docker ASS_RUN_RENDER=1 ASS_RUN_INTEGRATION=1 uv run pytest apps/api -m integration`, `pnpm check`, `pnpm test:e2e`, `gh run watch`.
- **Tests réussis** : 116 unitaires et 118 d'intégration Python ; 131 TypeScript ; 7 E2E ; CI au vert. **Échecs rencontrés et corrigés** : expiration de lecture Redis du worker, extension des fichiers de sortie, permissions du dossier monté en CI, attentes de tests (échantillons, noms de canaux EXR).
- **Écarts** : file Redis maison au lieu de Celery (moins de pièces mobiles, état en base) ; suivi par interrogation (pas de SSE) ; Cycles CPU sans GPU ; envoi des sorties via l'API de stockage interne.
- **Limitations et risques** : voir `KNOWN_LIMITATIONS.md` (CPU seulement, émulation sur Apple Silicon, éclairage d'aperçu approximatif, `receiveShadow` et portée des lumières ignorés, rotations échantillonnées dans le `.blend`, `.blend` pour Blender ≥ 4.5 — le Blender 3.5.1 installé sur le Mac de Pierre est trop ancien pour l'ouvrir correctement).
- **Prochaine étape** : phase 5 (premier moteur IA : adaptateur fournisseur, génération image/vidéo conditionnée par les passes, estimation de coût, jobs). Elle exigera un choix de fournisseur et une clé d'API **payante** : aucune génération ne sera lancée sans GO explicite.

## AI Scene Studio — Phase 5 (IA)

Décisions de Pierre : Claude par l'abonnement (jeton du VPS copié dans le `.env` local privé, option A) ; images et vidéos par Higgsfield sur l'abonnement de Benoît, via la passerelle Chrome de VALIDEO (aucune génération sans GO explicite) ; ergonomie et esthétique ajoutées à la phase.

### Étape 5.1 — Socle IA (fournisseurs, jobs, préparation depuis la scène)
- **Ajouté** : table `generation_jobs` (migration `0007` : fournisseur, modèle, mode, requête, rendu de préparation, manifests d'entrée et de sortie en S3, coûts estimé et réel, sorties, idempotence, annulation).
- **Ajouté** : `ai/capabilities.py` (capacités déclarées et appariement : contraintes « bloquantes » ou « ignorées / indicatives », modes texte en plus des modes image et vidéo), `ai/providers/base.py` (contrat `ProviderAdapter` : capacités, validation, estimation, soumission, suivi, annulation, sorties, normalisation des erreurs, exécution bornée dans le temps), fournisseurs `simulation` (aucune IA, encadré rouge, gratuit), `claude` (abonnement via l'outil `claude` non interactif, lecture d'images, sorties JSON structurées : prompt de plan, assistant de scène, analyse de rendu), `higgsfield` (passerelle navigateur non officielle vers les scripts VALIDEO : GPT Image 2.5 et Seedance 2.5, coûts en crédits, disponibilité = Chrome + onglet Higgsfield).
- **Ajouté** : `ai/scene_summary.py` (description de la scène pour Claude), `ai/service.py` (rendu Blender de préparation avec images de la caméra, cartes de profondeur et de normales ; conversion des données 3D selon les capacités du modèle ; manifest ; exécution ; publication des sorties comme assets marqués « généré par IA »), `ai/worker.py` (une file par fournisseur, signe de vie de disponibilité dans Redis), `routes/generations.py` (fournisseurs et disponibilité, estimation, lancement avec **confirmation exacte du coût** pour tout fournisseur payant, suivi, annulation).
- **Modifié** : rendu — frames isolées et cartes de conditionnement (profondeur normalisée, normales) dans le générateur Blender et le worker ; transitions de jobs communes aux rendus et aux générations.
- **Tests** : `test_ai_providers.py` (4) et `test_integration_generations.py` (9 : disponibilité des workers, estimation et contraintes indicatives, confirmation du coût obligatoire, contrainte bloquante, génération simulée de bout en bout avec manifest, références hors workspace refusées, rôles et isolation).
- **Vérifié manuellement** : appel réel de Claude par le jeton d'abonnement du VPS (vision + sortie structurée) ; rendu de préparation Blender (images, profondeur, normales).
- **Reste à faire dans la phase** : service `ai-worker` dans Docker, panneau IA de l'éditeur, test réel Higgsfield (après GO), ergonomie, esthétique.

### Étape 5.2 — Workers IA (Docker et Mac)
- **Ajouté** : image `infrastructure/docker/ai-worker.Dockerfile` (Python + FFmpeg + binaire natif officiel `claude` 2.1.317, sans Node à l'exécution, utilisateur non root, mises à jour automatiques désactivées) et service compose `ai-worker` (fournisseurs `simulation` et `claude`, jeton `CLAUDE_CODE_OAUTH_TOKEN` lu dans `.env`, quotas CPU / mémoire / processus).
- **Ajouté** : `scripts/higgsfield-worker.sh` — worker Higgsfield lancé sur le Mac (Chrome, port 9222), relié à la pile Docker.
- **Modifié** : `DEVELOPMENT.md` (workers IA, variables `CLAUDE_CODE_OAUTH_TOKEN`, `ASS_CLAUDE_PATH`, `ASS_FFMPEG_PATH`, `ASS_HIGGSFIELD_SCRIPTS_DIR`, `ASS_AI_PROVIDERS`).
- **Vérifié** : génération réelle « prompt depuis la scène » par Claude Sonnet via le worker Docker — rendu Blender de préparation (image + profondeur), réponse structurée (prompt anglais, cadrage, lumière, conseils en français) en ~40 s, coût affiché « inclus dans l'abonnement » ; worker Higgsfield sur le Mac : disponibilité publiée (Chrome et onglet connectés). **Aucune génération Higgsfield lancée.**

### Étape 5.3 — Fondations ergonomie et esthétique
- **Ajouté** : jetons de design (`globals.css` : surfaces en couches fond / panneau / surélevé / survol, accent, couleur « IA », bordures, ombres, animations courtes, police système, anneau de focus visible, barres de défilement fines, respect de « réduire les animations ») ; icônes `lucide-react` 1.67.0.
- **Ajouté** : palette de commandes (`CommandPalette.tsx`, `lib/commands.ts`) — ⌘K / Ctrl+K partout, F3 comme la recherche d'opérateurs de Blender ; recherche floue sans accents, groupes, raccourcis de la disposition active, commandes désactivées visibles ; ~50 commandes de l'éditeur (`editor/paletteCommands.ts` : édition, sélection, ajout, vues, temps, panneaux, préférences) et commandes de navigation.
- **Ajouté** : notifications (`Toaster.tsx`, `lib/toast.ts`) avec action — suppression annulable depuis la notification (« Annuler » sans effet si la scène a changé depuis) ; erreurs d'enregistrement notifiées.
- **Ajouté** : menu contextuel générique (`ContextMenu.tsx`, clavier ↑ ↓ Entrée Échap, recadré dans la fenêtre) ; clic droit dans la hiérarchie (renommer F2, cadrer, dupliquer, grouper, masquer, verrouiller, caméra active, supprimer).
- **Ajouté** : panneaux redimensionnables (`Resizable.tsx` : gauche, droite, timeline ; souris, double-clic = taille par défaut, flèches au clavier, tailles mémorisées) ; infobulles avec raccourci (`Kbd.tsx`) ; état vide explicite (`EmptyState.tsx`).
- **Modifié** : champs numériques — expressions (`lib/expression.ts`, analyseur sans `eval` : + − * / % ^, parenthèses, virgule décimale), étiquette glissable (Maj précis, Alt rapide), flèches ↑ ↓ ; tout le glissé = **une seule** annulation (`apply` pendant un geste ne crée plus d'entrée d'historique, `endGesture` en crée une).
- **Modifié** : barre d'outils de l'éditeur sur une ligne (icônes, groupes d'outils, infobulles avec raccourcis selon la disposition, bouton palette) ; hiérarchie (icônes par type, actions visibles au survol) ; en-tête de l'application (marque, bouton palette).
- **Tests** : `ergonomics.test.tsx` (31 : expressions valides et refusées, recherche floue, palette ⌘K / F3 / commande désactivée, notifications et durée, menu contextuel) ; test du store (opérations regroupées dans un geste) ; E2E `ergonomics.spec.ts` (palette, glisser un champ puis une annulation, expression, clic droit → supprimer → « Annuler », redimensionnement mémorisé). 8 E2E au vert en local.

### Étape 5.4 — Panneau IA de l'éditeur
- **Ajouté** : `apps/web/src/editor/AiPanel.tsx` (onglet « IA ») — moteurs et modèles avec voyant de disponibilité et raison ; types de génération proposés selon les capacités du modèle ; prompt, prompt négatif, « Rédiger avec Claude » (prompt du plan depuis la caméra et l'intention) ; cadrage par la caméra active à la frame courante (+ image de fin pour la vidéo) ; format, durée ; références reprises d'une image générée ; estimation serveur en direct (coût, contraintes indicatives ou bloquantes, disponibilité) ; **dialogue de confirmation du montant exact** pour tout moteur payant ; enregistrement automatique avant lancement ; historique du plan (progression, annulation, images, vidéos, coût réel, prompt réutilisable, critique du rendu) ; notifications de fin.
- **Ajouté** : `editor/aiOperations.ts` — traduction des opérations proposées par l'assistant de scène (ajouts de primitives / caméras / lumières, transformations, clés, suppression, renommage, couleur sRGB → linéaire, caméra active, visée), appliquées en **une seule étape annulable** ; opérations impossibles ignorées avec leur raison ; aperçu lisible de chaque opération.
- **Modifié** : API — estimation possible avant le premier enregistrement (la génération exige toujours une révision) ; résumé de scène et schéma de Claude en couleurs sRGB ; types `AiProvider`, `GenerationJob`… exportés par `@ass/api-client` ; commande « Afficher la génération IA » dans la palette.
- **Tests** : `ai-operations.test.ts` (3), `ai-panel.test.tsx` (2 : rien n'est lancé sans confirmation du montant, « Annuler » n'envoie rien, la confirmation transmet `confirmedCost` exact ; bouton désactivé sans prompt), intégration `test_estimate_before_first_save_but_not_generation` ; E2E `ai.spec.ts` (image simulée de bout en bout par le worker IA puis reprise en référence ; assistant de scène **Claude réel** : proposition puis application — exécuté en local avec `E2E_CLAUDE=1`, ignoré en CI).

### Bilan de la phase 5
- **Livrable** (« générer une image ou une vidéo IA conditionnée par la scène ») : atteint côté plateforme — depuis l'éditeur, une génération est estimée, confirmée si payante, préparée par Blender (image, profondeur, normales de la caméra active), exécutée par un worker IA et publiée comme asset marqué « généré par IA ». Vérifié avec la simulation (CI) et **Claude réel** (prompt du plan, assistant de scène appliqué à la scène).
- **Higgsfield** (abonnement de Benoît) : passerelle et worker Mac prêts, disponibilité vérifiée ; **aucune génération réelle lancée** — elle attend ton GO sur le prompt et le coût exacts (règle « jamais de génération payante sans GO »).
- **Ergonomie et esthétique** : jetons de design, icônes, palette ⌘K / F3, menus contextuels, notifications avec « Annuler », panneaux redimensionnables, infobulles avec raccourcis, champs à expressions et glissables, états vides.
- **Commandes exécutées** : `docker compose build/up` (ai-worker, api, web), `pnpm check`, `./scripts/check-all.sh`, `ASS_RUN_INTEGRATION=1 uv run pytest apps/api -m integration`, `E2E_CLAUDE=1 … playwright test`.
- **Tests réussis** : 120 unitaires et 119 d'intégration Python (8 rendus Blender ignorés en local, exécutés en CI) ; 52 tests web + paquets TypeScript ; 10 E2E dont Claude réel.
- **Écarts** : pas de Celery (files Redis maison, comme les rendus) ; passerelle Higgsfield non officielle ; références limitées aux images générées.
- **CI** : premier passage en échec (FFmpeg absent de la machine de CI pour le fournisseur simulation ; test de rendu réel ignorant la nouvelle sortie `frames`), corrigé (commit 31317f7) ; CI GitHub au vert (run 41721661259).
- **Prochaine étape** : phase 6 — studio de production (script → découpage par Claude selon la méthode réalisateur / chef-op → bible LOOK, personnages, décors → plans avec arbre de versions et A/B), interface centrée sur le workflow.

## AI Scene Studio — Phase 6 (studio de production)

Décision de Pierre (pivot du 03/11) : un studio de fabrication de film IA centré sur le workflow — brief / script → découpage par Claude selon la méthode réalisateur / chef-op de VALIDEO → bible (LOOK, personnages, décors, accessoires) → plans générés en versions successives avec allers-retours → montage (phase 7). La 3D n'est utilisée qu'à la demande (mode de fabrication « scène 3D » d'un plan).

### Étape 6.1 — Modèle de données et API du studio
- **Ajouté** : migration `0008` — `project_scripts` (versions immuables numérotées du brief / script), `bible_entries` (LOOK, personnage, décor, accessoire : fiche FR, prompt EN, image clé, galerie), `shot_bible_links`, `shot_versions` (versions image / vidéo d'un plan, `parent_id` = arbre des allers-retours, lien vers la génération) ; plans enrichis (description, intention, dialogue, valeur, caméra, mode de fabrication, statut, prompts image / vidéo / négatif, version retenue) ; générations rattachées au projet (`project_id`, plan et révision désormais facultatifs, données existantes migrées).
- **Ajouté** : `routes/studio.py` — scripts (`GET/POST /projects/{id}/scripts`, `GET /scripts/{id}`), bible (`GET/POST /projects/{id}/bible`, `PATCH/DELETE /bible-entries/{id}`, `POST /bible-entries/{id}/images`), versions (`GET/POST /shots/{id}/versions`, `PATCH /shot-versions/{id}`), storyboard complet (`GET /projects/{id}/storyboard`) ; `PATCH /shots/{id}` accepte le découpage, les liens de bible et la version retenue.

### Étape 6.2 — Claude dans le studio (méthode VALIDEO) et générations sans scène
- **Ajouté** : `ai/method.py` — persona chef opérateur, méthode réalisateur en 6 étapes écrites (`splitBuildDirectorBlock`), description professionnelle d'un plan (`splitPlanTextSpec`), formats de prompt par couches CHAGOMI (image) et multiplan minuté (Seedance), repris de VALIDEO ; `ai/providers/claude_studio.py` — modes `script_breakdown` (les 6 étapes sont des champs du JSON placés **avant** la version optimisée des séquences et plans), `bible_from_script`, `shot_prompts` ; `ai/studio_context.py` — documents transmis à Claude (script.md, bible.md, plan.md avec plans voisins, LOOK et correspondance @imageN).
- **Ajouté** : générations du projet (`POST /projects/{id}/generations[/estimate]`, `GET /projects/{id}/generations`) pour le découpage, la bible et l'image d'un élément de bible ; application en une transaction (`POST /projects/{id}/breakdown/apply`, `POST /projects/{id}/bible/apply` : séquences et plans créés à la suite, éléments ajoutés sans doublon, plans reliés à la bible par les noms, application unique).
- **Modifié** : une génération d'image / vidéo d'un plan n'exige plus de scène 3D enregistrée si la caméra ne la conditionne pas ; option `bibleReferences` (images clés des éléments liés au plan en références, dans l'ordre @imageN) ; `parentVersionId` ; à la fin d'une génération, chaque image / vidéo devient une **version du plan** (statut « en cours »), ou une image de la galerie de l'élément de bible.
- **Tests** : `test_integration_studio.py` (4 : versions de script et droits, bible et images clés, découpage puis bible jusqu'au storyboard relié, arbre des versions avec génération simulée sans scène, référence de bible, image de bible, version retenue), `test_studio_method.py` (3), test d'intégration des générations adapté.

### Étape 6.3 — Interface du studio
- **Ajouté** : `/projects/{id}/studio` (lien « Ouvrir le studio de production » en tête de la page du projet) — barre d'étapes Script · Propositions · Bible · Plans avec compteurs, commandes dans la palette ⌘K.
- **Ajouté** : `studio/ScriptStep.tsx` (éditeur de brief / script, versions immuables, « Découper le film » — Claude Opus par défaut — et « Établir la bible », consigne facultative), `ProposalsStep.tsx` (propositions de Claude : intention, brouillon des 6 étapes, séquences et plans avec valeur, caméra, durée, mode de fabrication, éléments ; bible proposée ; « Appliquer » une seule fois), `BibleStep.tsx` (LOOK, personnages, décors, accessoires en cartes : fiche, prompt, galerie et image clé, génération d'image avec le LOOK en tête), `ShotsStep.tsx` (storyboard par séquence : version retenue, statut, valeur, mode, durée, nombre de versions), `ShotDrawer.tsx` (panneau d'un plan : aperçu, arbre des versions, « Retenir cette version », comparaison A/B, image clé puis vidéo à partir d'une version, prompts écrits par Claude, découpage, éléments de bible, lien vers l'éditeur 3D), `Generate.tsx` (choix du modèle, estimation en direct, **confirmation du montant exact** pour tout moteur payant), `data.ts`.
- **Modifié** : le refus des garde-fous de Claude (faux positif rencontré avec Sonnet sur un découpage) devient une erreur claire « relancez, ou choisissez un autre modèle Claude » ; l'onglet IA de l'éditeur masque les modes du studio.
- **Vérifié en réel** : découpage d'un court script (« Le dernier gardien ») par **Claude Opus** en 163 s — intention, 6 étapes rédigées, 5 séquences et 13 plans fidèles au script ; bible par **Claude Sonnet** via le worker Docker en 25 s, reprenant exactement les noms du découpage (tous les plans reliés à leurs personnages, décors et accessoires). Projet de démo laissé dans « Démo Gozpie ».
- **Tests** : E2E `studio.spec.ts` (script en 2 versions, personnage créé et illustré par la simulation, plan relié à la bible, image générée → v1 retenue visible sur la carte, v2, comparaison A/B ; découpage par Claude réel avec `E2E_CLAUDE=1`) ; unitaires du rapprochement des noms et du refus des garde-fous.
- **Corrigé** : refus systématique du découpage par le worker Docker (Opus et Sonnet, « safeguards flagged… AUP ») reproduit 2/2 avec l'outil `claude` 2.1.317, absent avec la 2.1.233 (2/2 réussis, 82-88 s) : version **figée à 2.1.233** dans `ai-worker.Dockerfile`. E2E « Claude découpe le script puis le découpage s'applique au storyboard » réussi par l'interface (1,6 min).

### Bilan de la phase 6
- **Livrable** (« du script au storyboard fabriqué ») : atteint — un script versionné est découpé par Claude selon la méthode réalisateur / chef-op de VALIDEO, la bible est établie et reliée aux plans, chaque plan est généré en versions successives (arbre, version retenue, A/B) avec les images clés de la bible en références ; vérifié avec Claude réel et la simulation.
- **CI** : verte (run 41727373587) — 124 unitaires et 123 d'intégration Python, tests web, 10 E2E dont le studio.
- **Reste** : premier test réel Higgsfield (GO de Pierre) ; import d'images de référence depuis le disque ; montage (phase 7).

### Étapes 6.4–6.5 — Chagomi : nouvelle interface sur toute la plateforme
- **Décisions de Pierre** : interface jugée « horrible, design inexistant, aucune ergonomie » ; références retenues D29 et D30 (barre latérale), P01 (Frame.io, médiathèque) et P06 (ftrack, suivi de production) ; la plateforme s'appelle **Chagomi**.
- **Ajouté** : `AppSidebar.tsx`, `AppShell.tsx` (coquille commune, navigation selon le contexte), `AuthScreen.tsx`, `GlobalCommands.tsx`, `lib/theme.ts` (thème clair / sombre) ; logos dans `public/brand` (copiés dans l'image Docker) ; API : affiche et avancement dans la liste des projets.
- **Refait** : Plans (grille, tableau, filtres, bande des plans, lecteur et onglets), Bible (galeries et panneau de détail, création directe), Workspaces et Projets (galeries), Membres, Structure, Script, Connexion, Accueil, Invitation ; éditeur 3D aligné (commandes, transport à icônes, marque, retour vers les Plans).
- **Projet de démo local** « Jules Verne — Teaser » : copies allégées des médias du teaser CHAGOMI, statuts et descriptions écrits pour la démo ; aucune génération, rien en ligne.
- **Tests** : `pnpm check`, intégration Python (affiche de projet), E2E adaptés (10 réussis, 2 ignorés sans `E2E_CLAUDE`).
- **Décision de Pierre pour la suite** : le montage doit être un vrai logiciel complet et l'écran central où l'on revient voir le film se construire. Il demande de repartir de gozCut ; constat : gozCut est en Swift natif Mac (ne tourne pas dans le navigateur), le moteur web `nle` (branche `claude/video-editing-software-analysis-om0bn7`) gère déjà le montage mais ni la composition ni l'export. Choix à trancher avant la phase 7.

## AI Scene Studio (Chagomi) — Phase 7 (montage) — en cours

Décision de Pierre : option C — le pont gozCut d'abord, pour monter tout de suite, puis un écran Montage intégré à Chagomi, où l'on revient voir le film se construire.

### Correctif — « Aucun worker IA actif » pendant une génération
- **Constaté par Pierre** : pendant une bible Claude, tous les moteurs Claude passaient « indisponible ».
- **Cause** : le worker n'envoyait son signe de vie qu'entre deux générations ; la bible a duré 62 s, le signal expire à 30 s.
- **Corrigé** : `Heartbeat` (fil dédié) publie la disponibilité, entretient le signe de vie de la génération en cours et traite les jobs abandonnés ; message remplacé par ce qu'il faut relancer.
- **Vérifié** : test d'intégration, et génération Claude réelle de 60 s : 7 relevés, aucun « indisponible ». Worker Mac lancé (`scripts/mac-worker.sh gozcut,higgsfield`, journal `~/Library/Logs/Chagomi/mac-worker.log`) : Higgsfield n'était pas lancé, d'où « indisponible » sur GPT Image.

### Étape 7.1 — Pont gozCut et écran Montage
- **Ajouté** : `ai/edit_list.py` et `GET /projects/{id}/edit-list` (le film dans l'ordre : version retenue, sinon dernière version, plan sans version signalé) ; `ai/providers/gozcut.py` (nouveau dossier dans `~/Movies/gozCut/`, images converties en clips, clip noir pour un plan sans version, ouverture de gozCut) ; étape **Montage** dans la barre latérale (durée, plans prêts, envoi, historique, film plan par plan).
- **Non modifié** : le code de gozCut.
- **Tests** : `test_edit_list_follows_the_film_and_builds_a_gozcut_project` (FFmpeg réel) ; essai réel sur « Jules Verne — Teaser » : 15 plans, 1:21, relu par gozCut (`--open … --frames`).

### Étape 7.2 — Le montage intégré à Chagomi
- **Repris** : moteur du NLE web de la branche `claude/video-editing-software-analysis-om0bn7` dans `packages/nle` (sans `storage` ni `media-engine`, inutilisés ; exports en TypeScript source, imports sans `.js`) ; interface dans `apps/web/src/montage`, CSS limité à `.nle`, toujours sombre.
- **Ajouté** : `film.ts` (synchronisation pure film ↔ plans), `useFilm.ts` (ouverture, récupération des médias, enregistrement automatique avec révision), `media/image-fixe.ts`, `panels/PanneauPlans.tsx`, son des vidéos lié sur A1, bande d'images à tous les zooms ; `routes/montage.py`, table `project_edits`, migration 0009, type d'asset `audio`.
- **Modifié** : `MontageStep.tsx` (l'éditeur remplit l'écran, gozCut devient un panneau ouvert depuis la barre), `StudioShell.tsx` (le montage reste monté en coulisse : l'historique survit aux allers-retours), ⌘K réservé à la coupe dans cet écran.
- **Tests** : 11 tests du module film, 9 tests d'intégration API, E2E complet réussi. Essais en Chrome réel : « Jules Verne — Teaser » assemblé (15 plans, 1:20:14), lecture vidéo ; vidéo H.264 + AAC générée par FFmpeg : son lié sur A1, lecture sans clip muet ; WAV importé, retrouvé en ligne après rechargement.
- **Non vérifié** : écoute à l'oreille (lancé en navigateur sans écran), gros film (> 15 plans), Safari.
- **Reste** : 7.3 composition (calques, opacité, fondus, transitions, titres), 7.4 export du film et XML Premiere.

