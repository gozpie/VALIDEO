# CLAUDE.md — AI Scene Studio

Règles de travail pour les agents et contributeurs. Le cahier des charges complet (vision, modèle de données,
phases, critères d'acceptation) fait foi ; ce fichier en résume les conventions applicables au code.

## Principes non négociables

- La **scène 3D canonique** et ses **révisions immuables** sont la source de vérité ; rendus et sorties IA
  sont des artefacts attachés à une révision.
- Ne jamais présenter comme opérationnelle une fonction qui ne l'est pas ; aucune simulation présentée
  comme réelle, aucun bouton décoratif, aucune API ou capacité de modèle IA inventée.
- Un build réussi ne prouve pas le fonctionnement : chaque fonction livrée a son test.
- Demander confirmation avant toute décision irréversible, dépense payante ou modification destructive.
- Les tests contre des fournisseurs payants sont séparés des tests automatisés ordinaires.

## Méthode

- Travailler phase par phase, en petits incréments ; ne jamais passer à l'étape suivante sans validation.
- Avant une étape : inspecter le code, présenter le plan, les risques et les fichiers touchés.
- Après une étape : mettre à jour `../rapport.md` (ajouts, modifications, objectif, vérifications),
  `CHANGELOG.md` et la documentation concernée.
- Messages de commit en français.

## Conventions

- **Monorepo** pnpm (TypeScript strict) + uv (Python 3.13). Versions figées, lockfiles versionnés.
- **Scène** : axes glTF (Y-up, −Z avant, mètres), temps en frames entières, fps rationnel. Voir
  [SCENE_SCHEMA.md](SCENE_SCHEMA.md).
- **Base de données** : UUID générés par l'application, `timestamptz`, énumérations en texte + `CHECK`,
  noms de contraintes issus de la convention de `ass_api/db/base.py`. Toute évolution passe par une
  migration Alembic réversible, vérifiée par `test_integration_database.py` (`alembic check`, aller-retour).
- **Isolation** : toute donnée appartient à un workspace ; ne jamais faire confiance à un `workspace_id`
  envoyé par le client sans vérifier l'appartenance côté serveur.
- **API** : JSON camelCase, erreurs « problem details », pagination par curseur (voir [API.md](API.md)).
- **Secrets** : uniquement par variables d'environnement `ASS_*`, typés `SecretStr`, jamais loggés.

## Commandes

```bash
./scripts/check-all.sh                                    # tout ce qui ne demande pas Docker
pnpm check                                                # TypeScript : format, lint, types, tests
uv run ruff check . && uv run ruff format --check .       # Python : lint et format
uv run mypy apps/api/src apps/api/tests infrastructure/migrations
uv run pytest apps/api                                    # unitaires (intégration ignorée)
docker compose up -d --wait postgres redis storage
ASS_RUN_INTEGRATION=1 uv run pytest apps/api -m integration
uv run alembic -c infrastructure/migrations/alembic.ini revision --autogenerate -m "..."
pnpm api:generate                                         # après toute modification de l'API
```

Les tests d'intégration de base de données créent puis suppriment leur propre base temporaire : ils ne
modifient jamais les données de la base configurée.
