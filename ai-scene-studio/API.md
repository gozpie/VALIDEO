# API HTTP

Base URL locale : `http://localhost:8000`. OpenAPI : `/openapi.json`, interface `/docs`
(désactivées en production).

Contrat versionné : [`packages/api-client/openapi.json`](packages/api-client/openapi.json), dont sont générés
les types et le client TypeScript `@ass/api-client` (`createApiClient({ baseUrl })` : cookies inclus, jeton CSRF
mémorisé et ajouté automatiquement). Après toute modification de l'API : `pnpm api:generate`.

## Conventions

- JSON UTF-8 ; propriétés en **camelCase** dans les payloads métier (à partir de la phase 1) ; dates ISO 8601 UTC ; identifiants UUID.
- **Corrélation** : chaque réponse porte `X-Request-ID`. Un identifiant client est repris s'il respecte `[A-Za-z0-9._-]{8,64}`, sinon il est remplacé.
- **Erreurs** : format unique `application/problem+json` :

```json
{
  "type": "about:blank",
  "title": "Requête invalide",
  "status": 422,
  "detail": "Validation échouée",
  "requestId": "4b88d3b6c6ed4baa9c48d907a40e6781",
  "errors": [{ "path": "body.name", "message": "Field required" }]
}
```

Les erreurs 500 ne divulguent ni trace ni message interne ; le détail est dans les logs, retrouvable via `requestId`.

- **Idempotence** (à partir de la phase 5) : les opérations coûteuses ou payantes exigent un en-tête `Idempotency-Key`.
- **Pagination** (à partir de la phase 1) : par curseur, `{ "items": [...], "nextCursor": "..." | null }`.
- **Suivi des jobs** (à partir de la phase 4) : Server-Sent Events, avec reprise après rechargement du navigateur.

## Authentification (étape 1.2)

Session côté serveur portée par un cookie opaque `ass_session` (`HttpOnly`, `SameSite=Lax`, `Secure` hors
tests, `Path=/`, durée `ASS_SESSION_TTL_HOURS`). Le front appelle l'API avec `credentials: "include"`.
Toute requête modifiante d'un utilisateur connecté doit porter l'en-tête `X-CSRF-Token` avec le jeton
renvoyé par `/auth/login` ou `/auth/session` ; sinon `403`.

L'inscription publique est fermée : le premier compte se crée en ligne de commande
(`python -m ass_api.cli create-user`), les suivants par invitation (étape 1.4).

### `POST /auth/login`

Corps JSON `{ "email": "...", "password": "..." }` (tout autre type de contenu est refusé : `422`).
`200` : pose le cookie et renvoie la session :

```json
{
  "user": {
    "id": "b256bd0d-…",
    "email": "pierre@example.test",
    "displayName": "Pierre",
    "createdAt": "2026-11-03T16:19:08Z"
  },
  "csrfToken": "zxIvVwDP…",
  "expiresAt": "2026-11-17T16:19:11Z"
}
```

`401` : « E-mail ou mot de passe incorrect » (même message que le compte existe ou non).
`429` + `Retry-After` : trop d'échecs pour cette adresse ou cette IP pendant la fenêtre.
`503` : limiteur (Redis) indisponible ; la connexion est alors refusée.
Chaque connexion crée une nouvelle session et révoque celle que portait éventuellement le cookie.

### `GET /auth/session`

Session courante (même forme que ci-dessus) ou `401`.

### `POST /auth/logout`

Exige `X-CSRF-Token`. Révoque la session en base et efface le cookie : `204`.

## Autorisation (étape 1.3)

Chaque ressource appartient à un workspace, retrouvé en base à partir de la ressource elle-même : un
`workspaceId` envoyé par le client n'est jamais cru. Rôles cumulatifs :

| Rôle     | Droits                                                                     |
| -------- | -------------------------------------------------------------------------- |
| `viewer` | lecture                                                                    |
| `editor` | + créer, modifier, réordonner et supprimer séquences et plans ; projets    |
| `admin`  | + renommer le workspace, gérer membres et invitations, supprimer un projet |
| `owner`  | + supprimer le workspace                                                   |

Ressource d'un workspace dont on n'est pas membre (ou inexistante) : `404`. Membre au rôle insuffisant : `403`.

## Workspaces

| Méthode et chemin                   | Rôle minimal | Réponse                                               |
| ----------------------------------- | ------------ | ----------------------------------------------------- |
| `POST /workspaces` `{ name }`       | connecté     | `201` ; le créateur devient `owner`                   |
| `GET /workspaces?cursor=&limit=`    | connecté     | `{ items, nextCursor }`, uniquement mes workspaces    |
| `GET /workspaces/{id}`              | `viewer`     | `{ id, name, ownerId, role, createdAt, updatedAt }`   |
| `PATCH /workspaces/{id}` `{ name }` | `admin`      | workspace renommé                                     |
| `DELETE /workspaces/{id}`           | `owner`      | `204` ; supprime membres, projets, séquences et plans |

`role` est le rôle de l'utilisateur connecté. `limit` : 1 à 200 (50 par défaut) ; `cursor` : valeur
`nextCursor` de la page précédente (opaque), `422` si invalide.

## Membres et invitations (étape 1.4)

| Méthode et chemin                                     | Rôle minimal     | Effet                                                                                                                                           |
| ----------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /workspaces/{id}/members`                        | `viewer`         | `[{ userId, email, displayName, role, createdAt }]`                                                                                             |
| `PATCH /workspaces/{id}/members/{userId}` `{ role }`  | `admin`          | rôle `admin`, `editor` ou `viewer` ; le propriétaire est intouchable                                                                            |
| `DELETE /workspaces/{id}/members/{userId}`            | `admin` (ou soi) | retrait, ou départ volontaire ; jamais le propriétaire                                                                                          |
| `POST /workspaces/{id}/invitations` `{ email, role }` | `admin`          | `201` avec `token` et `acceptUrl`, **renvoyés une seule fois** ; `409` si déjà membre ; remplace une invitation en attente pour la même adresse |
| `GET /workspaces/{id}/invitations`                    | `admin`          | invitations en attente                                                                                                                          |
| `DELETE /workspaces/{id}/invitations/{invitationId}`  | `admin`          | révocation                                                                                                                                      |
| `GET /invitations/{token}`                            | public           | `{ workspaceName, email, role, expiresAt, accountExists }`                                                                                      |
| `POST /invitations/{token}/accept`                    | voir ci-dessous  | rejoint le workspace et renvoie la session                                                                                                      |

Acceptation : si aucun compte n'existe pour l'adresse invitée, le corps `{ displayName, password }` crée le
compte et ouvre une session (cookie posé). Si le compte existe, il faut être connecté **avec ce compte**
(`401` sinon, `403` si un autre compte est connecté) ; le lien ne permet jamais de définir le mot de passe
d'un compte existant. Jeton inconnu, expiré (`ASS_INVITATION_TTL_HOURS`) ou déjà utilisé : `404`.

## Projets, séquences et plans (étape 1.4)

| Méthode et chemin                                                                | Rôle minimal        | Effet                                                                  |
| -------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------- |
| `POST /workspaces/{id}/projects`                                                 | `editor`            | `201` ; défauts : 24 i/s, 1920×1080, `srgb`                            |
| `GET /workspaces/{id}/projects?cursor=&limit=`                                   | `viewer`            | `{ items, nextCursor }`                                                |
| `GET` / `PATCH /projects/{id}`                                                   | `viewer` / `editor` | lecture / modification partielle                                       |
| `DELETE /projects/{id}`                                                          | `admin`             | `204` ; supprime séquences et plans                                    |
| `GET` / `POST /projects/{id}/sequences` `{ name, position? }`                    | `viewer` / `editor` | liste ordonnée / insertion (fin par défaut)                            |
| `PUT /projects/{id}/sequences/order` `{ sequenceIds }`                           | `editor`            | ordre complet ; `422` si la liste n'est pas exactement celle du projet |
| `GET` / `PATCH` / `DELETE /sequences/{id}`                                       | `viewer` / `editor` | lecture / renommage / suppression (ordre recompacté)                   |
| `GET` / `POST /sequences/{id}/shots` `{ name, durationFrames, fps?, position? }` | `viewer` / `editor` | liste ordonnée / insertion                                             |
| `PUT /sequences/{id}/shots/order` `{ shotIds }`                                  | `editor`            | ordre complet                                                          |
| `GET` / `PATCH` / `DELETE /shots/{id}`                                           | `viewer` / `editor` | `PATCH` partiel ; `fps: null` revient à la cadence du projet           |

Formes : projet `{ id, workspaceId, name, description, fps: { numerator, denominator }, resolution: { width,
height }, colorSpace, createdAt, updatedAt }` ; séquence `{ id, projectId, name, orderIndex, … }` ; plan
`{ id, sequenceId, projectId, name, orderIndex, durationFrames, fps | null, effectiveFps, … }`. La cadence est
rationnelle (1 à 1000 i/s) ; la résolution va de 1 à 16384 px. Les listes de séquences et de plans ne sont pas
paginées (elles restent courtes et doivent être affichées en entier pour être réordonnées).

## Scènes et révisions (étape 2.2)

| Méthode et chemin                                                           | Rôle minimal | Effet                                                                               |
| --------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------- |
| `GET /shots/{id}/scene`                                                     | `viewer`     | `{ shotId, sceneId, headRevision, snapshot }` (`null` si rien n'est enregistré)     |
| `POST /shots/{id}/scene/revisions` `{ baseRevisionId, message?, snapshot }` | `editor`     | `201 { created: true, revision }` ; `200 { created: false }` si identique à la tête |
| `GET /shots/{id}/scene/revisions`                                           | `viewer`     | 100 révisions les plus récentes, de la plus récente à la plus ancienne              |
| `GET /scene-revisions/{id}`                                                 | `viewer`     | révision et son snapshot                                                            |

- `snapshot` est le document canonique (SCENE_SCHEMA.md), validé par le serveur (structure + intégrité) : `422`
  avec les chemins fautifs (`snapshot.nodes.1.parentId`…) ; `NaN`/`Infinity` refusés ; 5 Mo maximum (`413`).
- **Concurrence optimiste** : `baseRevisionId` doit être la tête actuelle (`null` pour la première révision) ; sinon
  `409` (« rechargez »), rien n'est écrasé. `sceneId` est fixé à la première révision et ne change plus.
- Révisions **immuables** : le snapshot canonique (clés triées) est stocké en S3 sous
  `workspaces/<workspace>/scenes/<sha256>.json` ; la base garde l'empreinte, la taille, l'auteur et le parent.

## Assets (étape 2.3)

| Méthode et chemin                                            | Rôle minimal | Effet                                                                                    |
| ------------------------------------------------------------ | ------------ | ---------------------------------------------------------------------------------------- |
| `POST /workspaces/{id}/assets` (multipart : `file`, `name?`) | `editor`     | `201 { created: true, asset }` ; `200 { created: false }` si le même contenu existe déjà |
| `GET /workspaces/{id}/assets?type=&cursor=&limit=`           | `viewer`     | `{ items, nextCursor }`                                                                  |
| `GET /assets/{id}`                                           | `viewer`     | `{ id, workspaceId, name, type, mimeType, sha256, sizeBytes, metadata, … }`              |
| `GET /assets/{id}/content`                                   | `viewer`     | contenu binaire en flux (`Cache-Control: private, immutable`)                            |

Phase 2 : seuls les **GLB** (glTF 2.0 binaire) sont acceptés. Le serveur vérifie l'en-tête, les chunks, le JSON
glTF, refuse toute ressource externe (`uri`) et les extensions obligatoires sans décodeur (Draco, meshopt) ;
`422` avec le motif. Taille maximale `ASS_ASSET_MAX_BYTES` (100 Mo, `413`), contrôlée avant lecture du corps.
Le contenu est dédupliqué par SHA-256 dans le workspace et stocké sous `workspaces/<workspace>/assets/<sha256>` ;
le nom du fichier n'est qu'un libellé. Une scène ne peut référencer que des assets de son workspace (`422`).

## Endpoints disponibles (phase 0)

### `GET /health/live`

Le processus répond. Toujours `200` :

```json
{ "status": "ok", "version": "0.1.0", "checks": {} }
```

### `GET /health/ready`

Vérifie PostgreSQL (`SELECT 1`), Redis (`PING`) et le bucket S3 (`HeadBucket`) en parallèle,
chacun limité à `ASS_HEALTH_CHECK_TIMEOUT_SECONDS`. `200` si tout est OK, sinon `503` :

```json
{
  "status": "error",
  "version": "0.1.0",
  "checks": {
    "database": { "status": "ok", "detail": null },
    "redis": { "status": "ok", "detail": null },
    "storage": { "status": "error", "detail": "EndpointConnectionError" }
  }
}
```

`detail` ne contient que le type d'erreur ou `timeout` : jamais d'URL ni d'identifiant.

## Endpoints prévus

Les phases suivantes ajouteront scènes et révisions, assets (upload multipart, URL signées), jobs, versions et exports.
Chaque endpoint sera documenté ici au moment de son implémentation.
