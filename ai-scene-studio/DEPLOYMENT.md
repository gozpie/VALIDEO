# Déploiement

> Phase 0 : seules les images et la composition locale existent. Le déploiement de production
> (TLS, sauvegardes automatisées, supervision) sera finalisé en phase 8. Ce document fixe les règles dès maintenant.

## Images

| Image | Dockerfile                             | Contenu                                                                                                                         |
| ----- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| API   | `infrastructure/docker/api.Dockerfile` | Python 3.13 slim, venv uv `--frozen --no-dev`, migrations Alembic, utilisateur non-root (uid 10001), HEALTHCHECK `/health/live` |
| Web   | `infrastructure/docker/web.Dockerfile` | Node 22 alpine, sortie Next.js `standalone`, utilisateur non-root, HEALTHCHECK                                                  |

Le contexte de build est `ai-scene-studio/`.

```bash
docker build -f infrastructure/docker/api.Dockerfile -t ass-api:<version> .
docker build -f infrastructure/docker/web.Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.exemple.fr -t ass-web:<version> .
```

Derrière un proxy TLS d'entreprise, fournir l'autorité de certification comme **secret BuildKit**
(jamais copiée dans l'image) : `--secret id=extra_ca,src=/chemin/ca.pem`.

## Ordre de démarrage

1. PostgreSQL, Redis et le stockage S3 sont sains.
2. `python -m ass_api.cli ensure-bucket` (idempotent).
3. `alembic -c infrastructure/migrations/alembic.ini upgrade head` (tâche ponctuelle, avant l'API).
4. API, puis web, puis reverse proxy.

`compose.yaml` encode cet ordre (`depends_on` + `service_completed_successfully`).

## Configuration de production

- `ASS_ENVIRONMENT=production` : l'API **refuse de démarrer** avec les identifiants de développement et masque `/docs` et `/openapi.json`.
- Secrets fournis par l'orchestrateur (variables d'environnement ou fichiers de secrets), jamais commités. `.env` est ignoré par git.
- `ASS_CORS_ALLOWED_ORIGINS` : origines exactes du front.
- `ASS_SESSION_COOKIE_SECURE` doit rester `true` (l'API refuse de démarrer sinon) : servir l'API en HTTPS.
- Derrière un reverse proxy, définir `FORWARDED_ALLOW_IPS` (variable lue par uvicorn) avec l'adresse du proxy :
  sans elle, toutes les connexions semblent venir du proxy et la limite d'échecs par IP devient commune à tous.
- Premier compte : `docker compose exec api python -m ass_api.cli create-user --email … --display-name …`.
- PostgreSQL, Redis, le stockage et les workers ne doivent **jamais** être exposés publiquement : seul le reverse proxy l'est (voir `infrastructure/nginx/nginx.conf`, à compléter par TLS).
- Ressources : fixer des limites CPU, mémoire et disque par service ; les workers de rendu et d'IA auront des quotas dédiés (phases 4–5).

## Reverse proxy

`docker compose --profile proxy up` démarre nginx sur `127.0.0.1:8080` : `/api/*` → API, le reste → web,
logs JSON, `X-Request-ID` propagé, mise en tampon désactivée pour le SSE. En production, ajouter TLS, HSTS
et une limitation de débit (phase 8).

## Sauvegarde et restauration

| Donnée      | Sauvegarde                                                                                                      | Restauration                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| PostgreSQL  | `docker compose exec -T postgres pg_dump -U ass -Fc ass > ass-$(date +%F).dump`                                 | `docker compose exec -T postgres pg_restore -U ass -d ass --clean --if-exists < fichier.dump` |
| Stockage S3 | Réplication ou synchronisation du bucket (`aws s3 sync s3://ass-media <destination> --endpoint-url …`)          | Synchronisation inverse                                                                       |
| Redis       | File de jobs transitoire, persistance AOF activée ; pas de sauvegarde métier (l'état des jobs fait foi en base) | —                                                                                             |

Base et stockage doivent être sauvegardés **ensemble** : la base référence les objets par URI et SHA-256.
La procédure automatisée et les tests de restauration sont prévus en phase 8.

## Mise à jour

1. Construire et taguer les nouvelles images (tag immuable, jamais `latest` en production).
2. Sauvegarder la base.
3. Exécuter les migrations (elles doivent rester compatibles avec la version N−1 de l'API pendant le déploiement).
4. Redéployer l'API, puis le web.
