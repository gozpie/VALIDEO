# Changelog

Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versionnement [SemVer](https://semver.org/lang/fr/).

## [Non publié]

### Ajouté

- Étape 3.1 : `@ass/animation-engine` — évaluation déterministe (interpolations, slerp, extrapolations) et
  édition pure des clés ; référence de déterminisme.
- Étape 3.2 : format de scène **v2** (caméra active, marqueurs, verrouillage, visée et roulis des caméras) avec
  migration v1 → v2 et fixtures avant/après ; validation serveur à jour ; `evaluateFrame` (animation + contraintes) ;
  mouvements de caméra (dolly, truck, pedestal, pan, tilt, orbite).

- Étapes 3.3–3.4 : éditeur — affichage de la scène évaluée à la frame courante, clé automatique des propriétés
  animées, clés de transformation / visibilité / focale / ouverture / intensité, caméra active, visée et roulis,
  mouvements de caméra, vue caméra (capteur et focale physiques, format de rendu) et vue double, trajectoire de
  l'élément sélectionné ; timeline (lecture, pause, stop, pas à pas, boucle, règle de navigation, marqueurs, pistes
  repliables, zoom, sélection multiple, déplacement, interpolation, copier-coller et suppression de clés) ; raccourcis
  Espace, ←/→, Origine/Fin, K, ⌘C/⌘V.

### Modifié

- JSON Schema renommé `scene.schema.json` (version courante, identifiée par son `$id`).

## [0.3.0] — 2026-11-03 — Phase 2 : scène 3D éditable et persistante

### Ajouté

- Étape 2.1 : validation serveur des scènes (structure par JSON Schema embarqué, norme des quaternions, intégrité
  identique à TypeScript), cas invalides partagés TypeScript/Python, sérialisation canonique pour l'empreinte.
- Étape 2.2 : scènes et révisions immuables (migration `0004`), stockage S3 adressé par contenu, concurrence
  optimiste (`409`), historique, lecture d'une révision ; module `core/storage.py`.
- Étape 2.3 : assets GLB (migration `0005`) — envoi validé, déduplication, liste, métadonnées, contenu servi en
  flux ; plafond global des corps de requête ; contrôle des assets référencés par une scène ; fixture `cube.glb`.
- Étape 2.4 : `@ass/scene-engine` — fabriques d'objets, opérations d'édition pures, conversions Three.js.
- Étape 2.5 : `@ass/editor-ui` — store de l'éditeur (sélection, outils, magnétisme, annuler/rétablir, gestes).
- Étape 2.6 : éditeur 3D `/shots/[id]/editor` — viewport (orbite, pan, zoom, perspective/orthographique, vues
  prédéfinies, grille, axes, cadrage), primitives, empty, groupe, caméras, lumières, import GLB, sélection (clic,
  multiple, rectangle), gizmos déplacement/rotation/échelle avec magnétisme, hiérarchie (recherche, renommage,
  masquage, verrouillage), inspecteur (transformations numériques, parent, couleur, caméra, lumière), duplication,
  groupement, suppression, raccourcis clavier, enregistrement en révision et rechargement.

## [0.2.0] — 2026-11-03 — Phase 1 : projets persistants

### Ajouté

- Étape 1.1 : modèle de données (`users`, `workspaces`, `workspace_members`, `projects`, `sequences`, `shots`)
  et migration Alembic `0001`, avec tests unitaires et tests d'intégration PostgreSQL (aller-retour des
  migrations, `alembic check`, contraintes, cascades, réordonnancement).
- `CLAUDE.md` : conventions, commandes et règles de contribution (prévu par le cahier des charges, absent de la phase 0).

- Étape 1.2 : authentification — `POST /auth/login`, `GET /auth/session`, `POST /auth/logout` ; Argon2id,
  sessions en base (empreinte du jeton) et cookie `HttpOnly`/`SameSite=Lax`/`Secure`, jeton CSRF,
  limitation des échecs dans Redis, migration `0002` (`user_sessions`), commande `create-user`.

- Étape 1.3 : autorisation par workspace (rôles `viewer` < `editor` < `admin` < `owner`, `404` hors
  workspace, `403` rôle insuffisant), routes `/workspaces` (création, liste paginée par curseur, lecture,
  renommage, suppression).

- Étape 1.4 : membres (liste, rôle, retrait, départ), invitations à usage unique (création, liste, révocation,
  consultation et acceptation avec création de compte), CRUD des projets, séquences et plans avec insertion à
  une position, réordonnancement complet et recompactage à la suppression ; migration `0003`.

- Étape 1.5 : `@ass/api-client` — contrat OpenAPI versionné, types générés (openapi-typescript), client typé
  (openapi-fetch) gérant cookie et jeton CSRF ; commandes `export-openapi` et `pnpm api:generate` ; tests de dérive
  Python et TypeScript ; erreurs documentées en « problem details » dans l'OpenAPI.

- Étape 1.6 : interface web — connexion (retour sûr vers la page demandée), workspaces (création, liste
  paginée, renommage, suppression), membres et invitations (rôles, retrait, lien d'invitation, révocation),
  acceptation d'invitation avec création de compte, projets (création avec cadence et résolution, description,
  suppression), séquences et plans (création, renommage, ordre, suppression, durée affichée) ; E2E du parcours
  complet contre la vraie pile ; compte E2E créé en CI.

### Modifié

- Image web : copie du manifeste de `@ass/api-client`.
- `@ass/shared-types` réexporte les entités de la phase 1 depuis `@ass/api-client`.
- Rôles et espaces colorimétriques typés en énumérations dans l'OpenAPI.
- `pnpm test` exécute les packages l'un après l'autre (le cache Vitest partagé échouait en parallèle).
- Les erreurs HTTP conservent les en-têtes de l'exception (`Retry-After`…).
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
