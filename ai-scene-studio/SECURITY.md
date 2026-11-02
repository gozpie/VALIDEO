# Sécurité

## En place (phase 0)

| Domaine                    | Mesure                                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Secrets                    | Lus uniquement depuis l'environnement ; typés `SecretStr` (jamais affichés dans `repr` ou les logs) ; `.env` ignoré par git ; l'API refuse les identifiants de développement en production |
| Logs                       | JSON structurés ; masquage récursif des clés `password`, `secret`, `token`, `authorization`, `api_key`, `cookie` ; identifiant de requête validé (pas d'injection dans les logs)           |
| Erreurs                    | Aucune trace ni message interne renvoyé au client ; les health checks n'exposent que le type d'erreur                                                                                      |
| CORS                       | Liste blanche explicite, joker `*` refusé à la configuration                                                                                                                               |
| En-têtes                   | API : `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, CSP `default-src 'none'`. Web : `nosniff`, `DENY`, `strict-origin-when-cross-origin` ; `X-Powered-By` supprimé   |
| Surface                    | `/docs` et `/openapi.json` désactivés en production                                                                                                                                        |
| Réseau                     | PostgreSQL, Redis et le stockage n'écoutent que sur `127.0.0.1` en local ; seul le proxy est destiné à être exposé                                                                         |
| Conteneurs                 | Images minimales, utilisateurs non-root (uid 10001), dépendances figées par lockfile                                                                                                       |
| Chaîne d'approvisionnement | Versions exactes (`save-exact`, `uv.lock`, `pnpm-lock.yaml`) ; scripts d'installation npm limités à une liste blanche (`onlyBuiltDependencies`) ; CI avec `permissions: contents: read`    |
| Analyse statique           | Règles de sécurité ruff (`S`, bandit), ESLint strict, mypy strict                                                                                                                          |

## Prévu

| Phase | Mesure                                                                                                                                                                                                                |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Authentification (hachage Argon2id, sessions en cookie `HttpOnly`/`Secure`/`SameSite`, protection CSRF par jeton), autorisation par workspace vérifiée côté serveur sur chaque requête, rate limiting de la connexion |
| 2     | Imports GLB/GLTF et images : validation MIME par signature, limites de taille, aucune exécution de script embarqué, assainissement des métadonnées                                                                    |
| 4     | Workers isolés, avec quotas CPU, RAM, GPU, disque et temps ; **aucun script Blender fourni par un utilisateur n'est exécuté** ; scènes converties par un générateur interne                                           |
| 5     | Clés des fournisseurs IA côté serveur uniquement ; protection SSRF (pas d'URL arbitraire récupérée par le serveur, liste blanche des hôtes fournisseurs) ; plafonds de coûts                                          |
| 8     | TLS et HSTS, rate limiting global, CSP du front, audit des dépendances en CI, sauvegardes chiffrées, revue de sécurité                                                                                                |

## Signaler une vulnérabilité

Ne pas ouvrir d'issue publique : contacter directement le mainteneur du dépôt.
