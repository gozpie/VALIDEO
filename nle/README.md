# VALIDEO NLE

Moteur de montage vidéo non linéaire professionnel, dont l'interface principale
est le web.

> **État : socle en construction.** Voir `docs/PROGRESS.md` pour ce qui est
> réellement fonctionnel. Conformément à §1003 du cahier des charges, rien
> n'est présenté ici comme fonctionnel sans l'être.

## Démarrage

```bash
cd nle
pnpm install
pnpm run check     # format + lint + typecheck + tests
pnpm test          # tests seuls
```

## Structure

```
packages/
  time-core/        Temps rationnel, timebase, timecode DF/NDF, ticks   [DONE]
  shared/           Types transverses                                   [à venir]
  project-model/    Schéma de projet versionné + migrations              [à venir]
  command-system/   Command pattern, undo/redo                           [à venir]
  timeline-model/   Pistes, clips, opérations de montage                 [à venir]
  timeline-engine/  Index spatial, requêtes, rendu Canvas                [à venir]
  media-engine/     Démux, décodage, proxies                             [à venir]
  ui/               Design system                                        [à venir]
apps/
  web/              Application                                          [à venir]
  api/              API et jobs média                                    [à venir]
  media-worker/     FFmpeg, analyse, transcodage                         [à venir]
docs/
  MASTER_PLAN.md              Ordre de construction et jalons
  PROGRESS.md                 État réel, étape par étape
  ARCHITECTURE_DECISIONS.md   ADR
```

## La règle qui structure tout le reste

Le temps est **rationnel et entier**, jamais flottant. Une position de timeline
est un nombre entier d'images rattaché à une timebase ; 23.976 est stocké
24000/1001. Additionner deux temps de timebases différentes lève une erreur :
il faut convertir explicitement. Détails dans `docs/ARCHITECTURE_DECISIONS.md`.
