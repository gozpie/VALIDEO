# Sécurité

## En place (phases 0 et 1)

| Domaine                    | Mesure                                                                                                                                                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secrets                    | Lus uniquement depuis l'environnement ; typés `SecretStr` (jamais affichés dans `repr` ou les logs) ; `.env` ignoré par git ; l'API refuse les identifiants de développement en production                                                                                       |
| Logs                       | JSON structurés ; masquage récursif des clés `password`, `secret`, `token`, `authorization`, `api_key`, `cookie` ; identifiant de requête validé (pas d'injection dans les logs)                                                                                                 |
| Erreurs                    | Aucune trace ni message interne renvoyé au client ; les health checks n'exposent que le type d'erreur                                                                                                                                                                            |
| CORS                       | Liste blanche explicite, joker `*` refusé à la configuration                                                                                                                                                                                                                     |
| En-têtes                   | API : `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, CSP `default-src 'none'`. Web : `nosniff`, `DENY`, `strict-origin-when-cross-origin` ; `X-Powered-By` supprimé                                                                                         |
| Surface                    | `/docs` et `/openapi.json` désactivés en production                                                                                                                                                                                                                              |
| Réseau                     | PostgreSQL, Redis et le stockage n'écoutent que sur `127.0.0.1` en local ; seul le proxy est destiné à être exposé                                                                                                                                                               |
| Conteneurs                 | Images minimales, utilisateurs non-root (uid 10001), dépendances figées par lockfile                                                                                                                                                                                             |
| Chaîne d'approvisionnement | Versions exactes (`save-exact`, `uv.lock`, `pnpm-lock.yaml`) ; scripts d'installation npm limités à une liste blanche (`onlyBuiltDependencies`) ; CI avec `permissions: contents: read`                                                                                          |
| Authentification           | Argon2id (paramètres RFC 9106 d'argon2-cffi), 12 caractères minimum ; vérification à temps comparable que le compte existe ou non ; message d'échec unique ; inscription publique fermée                                                                                         |
| Sessions                   | Jeton aléatoire 256 bits en cookie `HttpOnly` / `SameSite=Lax` / `Secure` (obligatoire en production) ; seule son empreinte SHA-256 est en base ; expiration absolue ; nouvelle session à chaque connexion                                                                       |
| CSRF                       | Jeton par session exigé dans `X-CSRF-Token` pour toute requête modifiante authentifiée ; connexion limitée au JSON (pas de formulaire intersite)                                                                                                                                 |
| Limitation                 | Échecs de connexion comptés dans Redis par e-mail (haché) et par IP ; au-delà du seuil, `429` même avec le bon mot de passe ; Redis indisponible → refus (`503`)                                                                                                                 |
| Fichiers importés          | GLB validés avant stockage (en-tête, chunks, JSON) ; ressources externes et extensions sans décodeur refusées ; aucun script exécuté ; taille plafonnée avant lecture du corps ; clés de stockage construites par le serveur ; contenu servi par l'API après contrôle des droits |
| Scènes                     | Validation serveur complète avant écriture ; références d'assets limitées au workspace ; snapshots immuables adressés par empreinte                                                                                                                                              |
| Analyse statique           | Règles de sécurité ruff (`S`, bandit), ESLint strict, mypy strict                                                                                                                                                                                                                |

## Prévu

| Phase | Mesure                                                                                                                                                                       |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Autorisation par workspace vérifiée côté serveur sur chaque requête (étape 1.3), invitations à usage unique (étape 1.4)                                                      |
| 2     | Imports GLB/GLTF et images : validation MIME par signature, limites de taille, aucune exécution de script embarqué, assainissement des métadonnées                           |
| 4     | Workers isolés, avec quotas CPU, RAM, GPU, disque et temps ; **aucun script Blender fourni par un utilisateur n'est exécuté** ; scènes converties par un générateur interne  |
| 5     | Clés des fournisseurs IA côté serveur uniquement ; protection SSRF (pas d'URL arbitraire récupérée par le serveur, liste blanche des hôtes fournisseurs) ; plafonds de coûts |
| 8     | TLS et HSTS, rate limiting global, CSP du front, audit des dépendances en CI, sauvegardes chiffrées, revue de sécurité                                                       |

## Signaler une vulnérabilité

Ne pas ouvrir d'issue publique : contacter directement le mainteneur du dépôt.
