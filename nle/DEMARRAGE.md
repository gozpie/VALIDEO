# Reprendre le projet sur un poste local

## Prérequis

- **Node 22+** et **pnpm 10+** (`corepack enable` suffit à activer pnpm).
- **FFmpeg**, uniquement pour régénérer les fixtures média (`brew install ffmpeg`).
  Elles ne sont pas versionnées : ce sont de vrais fichiers encodés, et les
  committer alourdirait le dépôt sans rien garantir de plus.

## Installation

```bash
pnpm install
pnpm exec playwright install chromium   # navigateur des tests de bout en bout
./scripts/make-fixtures.sh              # fixtures média, demande FFmpeg
```

`make-fixtures.sh` écrit dans `fixtures/generated/`. Sans elles, les tests
unitaires du démultiplexeur et plusieurs tests de bout en bout se retrouvent
sans matière : ils échouent, ils ne sont pas ignorés en silence.

## Vérifier

```bash
pnpm run check   # format, lint, typage des sources ET des tests, tests unitaires
pnpm run e2e     # tests de bout en bout, reconstruit l'application d'abord
```

`check` est la commande qui fait autorité. Elle doit être verte avant tout
commit : elle vérifie aussi le typage des fichiers de test, que la
configuration des paquets exclut et qui échappaient donc à toute vérification.

## Développer

```bash
pnpm --filter @valideo/web run dev   # application sur http://localhost:5173
```

## Organisation

- `packages/` — le moteur, sans aucune dépendance au DOM. Temps rationnel exact,
  modèle de timeline, opérations de montage, commandes annulables,
  démultiplexeur MP4, moteur audio, stockage.
- `apps/web/` — l'interface. C'est le seul endroit qui connaît React et le canvas.
- `e2e/simulation.spec.ts` — un montage complet en dix-huit étapes. C'est le
  test à lancer en premier quand on doute de l'état général du projet.

## Ce qui n'existe pas encore

Annoncé plutôt que simulé, conformément au §1003 de la spécification : le graphe
de rendu multicouche, un moniteur source à part entière, l'export, les séquences
imbriquées, les groupes et les transitions. Les actions correspondantes ont un
raccourci et un libellé, et **disent** leur indisponibilité quand on les
déclenche.
