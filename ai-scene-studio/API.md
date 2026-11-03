# API HTTP

Base URL locale : `http://localhost:8000`. OpenAPI : `/openapi.json`, interface `/docs`
(désactivées en production).

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

Phase 1 (suite) : workspaces, membres et invitations, projets, séquences, plans (CRUD, isolement par workspace).
Les phases suivantes ajouteront scènes et révisions, assets (upload multipart, URL signées), jobs, versions et exports.
Chaque endpoint sera documenté ici au moment de son implémentation.
