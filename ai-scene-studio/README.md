# AI Scene Studio

Plateforme web de conception d'images et de vidéos IA à partir d'une **scène 3D persistante**.
La 3D apporte la précision, l'IA la richesse visuelle, le compositing préserve le contrôle et le
versioning préserve le travail.

> **État : phase 2 livrée (scène 3D éditable et persistante), en attente de validation.** Connexion, workspaces,
> projets, séquences et plans ; éditeur 3D par plan (primitives, caméras, lumières, import GLB, gizmos,
> hiérarchie, inspecteur, annuler/rétablir) enregistré en révisions immuables. Pas encore d'animation ni de
> génération IA. Voir [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) et la feuille de route ci-dessous.

## Démarrage rapide

```bash
cd ai-scene-studio
./scripts/check-env.sh            # vérifie les outils (Node 22, pnpm 10, Python 3.13, uv, Docker)
cp .env.example .env
docker compose up --build --wait  # PostgreSQL, Redis, stockage S3, migrations, API, web
docker compose exec api python -m ass_api.cli create-user --email vous@example.com --display-name "Vous"
```

Puis se connecter sur http://localhost:3000/login. Les comptes suivants s'ajoutent par invitation depuis la
page « Membres et invitations » d'un workspace.

- Web : http://localhost:3000 (affiche l'état réel des services)
- API : http://localhost:8000/health/ready, documentation OpenAPI sur http://localhost:8000/docs (hors production)

Développement sans conteneur pour l'API et le web : voir [DEVELOPMENT.md](DEVELOPMENT.md).

## Structure

```text
apps/web/                 Next.js (App Router), React, Tailwind — interface
apps/api/                 FastAPI, SQLAlchemy, Alembic — API HTTP
packages/scene-schema/    Format canonique de scène v1 (Zod) + JSON Schema
packages/api-client/      Contrat OpenAPI versionné, types générés et client HTTP typé
packages/shared-types/    Contrats des entités, statuts de jobs, erreurs API
packages/generation-sdk/  Contrat ProviderAdapter et appariement des capacités IA
packages/scene-engine/    Opérations d'édition pures, scène canonique ↔ Three.js
packages/animation-engine/(phase 3) Évaluation déterministe de l'animation
packages/editor-ui/       État de l'éditeur (sélection, outils, annuler/rétablir)
workers/                  (phases 4–5) render, media, ai
infrastructure/           Dockerfiles, nginx, migrations Alembic
tests/                    Fixtures partagées, intégration, E2E transverses
scripts/                  check-env.sh, check-all.sh
```

## Documentation

| Document                                     | Contenu                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| [ARCHITECTURE.md](ARCHITECTURE.md)           | Composants, flux, modèle de données, décisions                            |
| [SCENE_SCHEMA.md](SCENE_SCHEMA.md)           | Format de scène, conventions d'axes, conversions glTF/Blender, migrations |
| [API.md](API.md)                             | Conventions HTTP, erreurs, endpoints disponibles                          |
| [DEVELOPMENT.md](DEVELOPMENT.md)             | Installation, commandes, variables, dépannage                             |
| [DEPLOYMENT.md](DEPLOYMENT.md)               | Images, configuration de production, sauvegarde/restauration              |
| [SECURITY.md](SECURITY.md)                   | Mesures en place et prévues                                               |
| [TESTING.md](TESTING.md)                     | Stratégie et commandes de test                                            |
| [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) | Limites et écarts connus                                                  |
| [CHANGELOG.md](CHANGELOG.md)                 | Historique des versions                                                   |

## Feuille de route

| Phase | Livrable                                                             | État                                  |
| ----- | -------------------------------------------------------------------- | ------------------------------------- |
| 0     | Environnement reproductible, contrats                                | ✅ terminé                            |
| 1     | Projets persistants (auth, workspaces, projets, séquences, plans)    | ✅ terminé                            |
| 2     | Scène éditable persistante (viewport, gizmos, undo/redo, import GLB) | ✅ terminé (en attente de validation) |
| 3     | Plan animé relisible (caméras, timeline, keyframes)                  | à faire                               |
| 4     | Rendu hors navigateur (Blender, passes, FFmpeg)                      | à faire                               |
| 5     | Génération IA depuis la scène                                        | à faire                               |
| 6     | Versioning (historique, A/B, restauration)                           | à faire                               |
| 7     | Compositing hybride                                                  | à faire                               |
| 8     | Durcissement, bêta                                                   | à faire                               |
