# Architecture

## Principe directeur

La **scène 3D canonique** et ses **révisions immuables** sont la source de vérité. Rendus, passes
techniques et sorties IA sont des **artefacts attachés à une révision** ; ils ne la remplacent jamais.

```text
              ┌──────────────┐  REST/SSE  ┌──────────────┐   SQL    ┌────────────┐
 Navigateur ─▶│  apps/web    │──────────▶ │   apps/api   │────────▶ │ PostgreSQL │
 (WebGL 2)    │ Next.js, R3F │            │   FastAPI    │          └────────────┘
              └──────┬───────┘            │              │  queue   ┌────────────┐
                     │ URL signées        │              │────────▶ │   Redis    │
                     ▼                    └──────┬───────┘          └─────┬──────┘
              ┌──────────────┐                   │                       │ Celery (phases 4–5)
              │ Stockage S3  │◀──────────────────┴───────────┬───────────┘
              │ (SeaweedFS)  │◀─── render-worker (Blender) ──┤
              └──────────────┘◀─── media-worker (FFmpeg)  ───┤
                              ◀─── ai-worker (fournisseurs) ─┘
```

## Composants

| Composant                   | Rôle                                                                       | Technologies                                                                                                     | Phase |
| --------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----- |
| `apps/web`                  | Interface, éditeur, viewport preview                                       | Next.js 16, React 19, TypeScript strict, Tailwind 4 ; Three.js, R3F, Drei, Zustand, Immer à partir de la phase 2 | 0+    |
| `apps/api`                  | Authentification, droits par workspace, CRUD, révisions, jobs, URL signées | Python 3.13, FastAPI, Pydantic 2, SQLAlchemy 2.1, Alembic                                                        | 0+    |
| `packages/scene-schema`     | Format canonique, validation, migrations                                   | Zod 4 → JSON Schema                                                                                              | 0     |
| `packages/shared-types`     | Contrats des entités et des jobs                                           | TypeScript                                                                                                       | 0     |
| `packages/generation-sdk`   | Contrat `ProviderAdapter`, appariement des capacités                       | TypeScript                                                                                                       | 0, 5  |
| `packages/scene-engine`     | Scène canonique ↔ graphe Three.js, chargement d'assets, libération GPU     | Three.js                                                                                                         | 2     |
| `packages/animation-engine` | Évaluation pure `(scène, frame) → état`, sans dépendance UI                | TypeScript                                                                                                       | 3     |
| `packages/editor-ui`        | Panneaux, inspector, timeline                                              | React                                                                                                            | 2–3   |
| `workers/render-worker`     | Conversion scène → Blender, rendu Cycles, passes                           | Blender headless                                                                                                 | 4     |
| `workers/media-worker`      | Miniatures, transcodage, assemblage vidéo                                  | FFmpeg, OpenEXR                                                                                                  | 4     |
| `workers/ai-worker`         | Exécution des générations via les adapters                                 | Python, Celery                                                                                                   | 5     |

## Décisions (ADR condensées)

1. **Monorepo pnpm + uv** : un seul dépôt, un lockfile par écosystème (`pnpm-lock.yaml`, `uv.lock`), versions figées (`save-exact`).
2. **Contrat de scène écrit en Zod, exporté en JSON Schema** : un seul endroit pour la structure ; le backend
   valide la structure via le JSON Schema et réimplémente les règles d'intégrité, testées sur les mêmes fixtures.
3. **Packages internes publiés en source TypeScript** (`exports` → `src/index.ts`), transpilés par Next.js
   (`transpilePackages`) et Vitest : pas d'étape de build intermédiaire.
4. **Temps en frames entières, fps rationnel** : évaluation déterministe, aucune dérive flottante.
5. **Convention d'axes glTF** (Y-up, −Z avant, mètres) : aucune conversion côté navigateur ; une seule conversion documentée vers Blender.
6. **Les contrats API seront générés depuis l'OpenAPI de FastAPI** à partir de la phase 1 ; `shared-types` documente d'ici là la forme cible.
7. **Stockage S3 générique** : seul l'API S3 standard est utilisée ; SeaweedFS en local (MinIO n'est plus distribué en image publique).
8. **Jobs** : machine à états unique (`queued → preparing → running → processing → completed`, plus `failed` et `cancelled`),
   jamais de retour d'un état terminal. Relancer une opération crée un nouveau job, avec une clé d'idempotence.
9. **WebGL 2 comme cible** ; WebGPU optionnel plus tard.

## Modèle de données (cible)

```text
User ─< WorkspaceMember >─ Workspace ─< Project ─< Sequence ─< Shot
                                         │                     │ activeCameraId, activeRevisionId
                                         └─< Scene ─< SceneRevision (parent, snapshotUri, sha256, auteur, date)
Workspace ─< Asset (type, MIME, URI, SHA-256, métadonnées)
SceneRevision ─< GenerationJob (fournisseur, modèle, manifests, statut, coûts, erreurs)
Shot ─< RenderVersion (parent, révision, job, asset de sortie)
```

- UUID partout, clés étrangères explicites, index sur les clés de parcours (workspace, projet, plan, statut des jobs).
- Isolation : toute requête est filtrée par workspace et contrôlée côté serveur (`WorkspaceMember.role`).
- `SceneRevision` est immuable : le snapshot JSON est stocké en S3 sous une clé dérivée de son SHA-256 ; la base conserve l'empreinte.

Les formes JSON correspondantes sont dans `packages/shared-types/src/entities.ts`.

### Implémenté (migration `0001`, étape 1.1)

Modèles SQLAlchemy dans `apps/api/src/ass_api/db/models.py`, migration
`infrastructure/migrations/versions/20261103_0001_identites_workspaces_projets.py`.

| Table               | Points clés                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `users`             | e-mail unique et en minuscules ; `password_hash` NULL = compte sans mot de passe local (invitation en attente, identité externe)     |
| `workspaces`        | `owner_id` → `users` en `RESTRICT` : un propriétaire ne peut pas être supprimé tant qu'il possède un workspace                       |
| `workspace_members` | clé (`workspace_id`, `user_id`), rôle `owner` / `admin` / `editor` / `viewer`, index sur `user_id`                                   |
| `projects`          | fps rationnel (`fps_numerator` / `fps_denominator`), résolution 1–16384, `color_space` (`srgb`, `rec709`, `acescg`, `linear_rec709`) |
| `sequences`         | `order_index` unique par projet, contrainte différée en fin de transaction (réordonnancement)                                        |
| `shots`             | `order_index` unique par séquence (différée), `duration_frames` > 0, fps propre facultatif (sinon hérité du projet)                  |

Suppression d'un workspace : cascade sur membres, projets, séquences et plans. `scenes` et
`shots.active_scene_revision_id` arrivent en phase 2 avec les révisions de scène.

## Observabilité

- Logs JSON sur stdout (structlog), corrélés par `X-Request-ID`, secrets masqués.
- `/health/live` (processus) et `/health/ready` (PostgreSQL, Redis, S3, chacun avec un timeout).
- Healthchecks Docker sur tous les services.
