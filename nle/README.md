# VALIDEO NLE

Moteur de montage vidéo non linéaire professionnel, dont l'interface principale
est le web.

> **État : socle fonctionnel, lecture non construite.** Voir `docs/PROGRESS.md`.
> Conformément à §1003 du cahier des charges, rien n'est présenté ici comme
> fonctionnel sans l'être.

## Démarrage

```bash
cd nle
pnpm install
pnpm --filter @valideo/web run dev    # l'application
pnpm run check                        # format + lint + typecheck + tests
pnpm test                             # 401 tests unitaires
pnpm run e2e                          # 9 tests de bout en bout (navigateur)
bash scripts/make-fixtures.sh         # fixtures média réelles (nécessite FFmpeg)
```

## Ce qui marche aujourd'hui

Le **montage** : déplacer, trimer, ripple, roll, slip, slide, lame, étirement
temporel, sélection au rectangle et par piste, verrouillage et ciblage de
pistes, annulation illimitée avec retour à n'importe quelle étape, accrochage
magnétique, zoom autour du pointeur, navigation JKL et saisie de timecode.

L'**analyse média** : ffprobe sur de vrais fichiers, cadences exactes, timecode
drop-frame, détection de cadence variable, alpha, colorimétrie HDR.

L'**import audio et la lecture du son** : un fichier importé est décodé par le
navigateur, sa forme d'onde vient des vrais échantillons, et il se lit — l'horloge
audio commandant la tête de lecture.

Le **démultiplexage MP4/MOV et la lecture vidéo** : cadence et codec exacts,
décodage WebCodecs avec cache d'images et décodage anticipé, et une image qui
suit l'horloge audio à la cadence de la séquence.

La **persistance** : enregistrement, sauvegarde automatique, instantanés et
reprise après une session interrompue.

## Ce qui n'existe pas encore

La **composition** : une seule couche est affichée à la fois. Superposition,
opacité, fondus et effets demandent le graphe de rendu, qui n'existe pas encore.
Le **Moniteur Source**. Les **vignettes** de timeline. L'**export**.
L'**étalonnage**. L'interface le dit explicitement plutôt que de le simuler.

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
