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

Phase 1 : authentification et session, workspaces et membres, projets, séquences, plans (CRUD, isolement par workspace).
Les phases suivantes ajouteront scènes et révisions, assets (upload multipart, URL signées), jobs, versions et exports.
Chaque endpoint sera documenté ici au moment de son implémentation.
