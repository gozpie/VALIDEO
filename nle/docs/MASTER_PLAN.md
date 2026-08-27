# Plan directeur

Source : `MASTER_INSTRUCTION_CLAUDE_CODE.md` (1005 sections). Ce document en est
la traduction en ordre de construction exécutable, et il fait autorité sur
l'ordre des travaux.

## Principe directeur

L'ordre est imposé par §1002 et n'est pas négociable : chaque couche est le
socle de la suivante. Si le temps rationnel est faux, tout ce qui est au-dessus
est faux — y compris un export « qui marche ».

## Règle de complétude (§1003, §1004)

Interdiction de faire semblant. Toute fonction incomplète est marquée
`EXPERIMENTAL`, `PARTIAL` ou `UNAVAILABLE` dans le code **et** dans
`PROGRESS.md`. Aucun faux bouton, faux codec, faux export, fausse persistance.

Une fonctionnalité est `DONE` seulement si : comportement défini, intégrée au
vrai moteur, persistante au reload quand pertinent, Undo/Redo raccordé quand
pertinent, menus et raccourcis branchés, erreurs gérées, tests verts, pas de
régression de performance, preview et export cohérents, documentation à jour.

## Séquence de construction

### Socle — le cœur non négociable

| # | Brique | Paquet | État |
|---|---|---|---|
| 1 | Monorepo, TS strict, lint, tests | racine | **DONE** |
| 2 | Temps rationnel, timebase, timecode DF/NDF, ticks | `time-core` | **DONE** |
| 3 | Types partagés | `shared` | À faire |
| 4 | Schéma de projet v1 + migrations | `project-model` | À faire |
| 5 | Command pattern, undo/redo transactionnel | `command-system` | À faire |
| 6 | Modèle timeline + opérations de montage | `timeline-model` | À faire |
| 7 | Moteur de requête (interval tree, index spatial) | `timeline-engine` | À faire |
| 8 | Rendu timeline Canvas virtualisé | `timeline-engine` | À faire |

### Média

| # | Brique | État |
|---|---|---|
| 9 | `MediaAsset`, import local | À faire |
| 10 | Backend FFprobe (analyse §9) | À faire |
| 11 | Détection de capacités navigateur (§59, §118) | À faire |
| 12 | Démuxeur + `RangeReader` (§901-1000) | À faire |
| 13 | Proxies (§11) | À faire |

### Lecture

| # | Brique | État |
|---|---|---|
| 14 | Premier codec WebCodecs | À faire |
| 15 | Horloge audio maître (§22) | À faire |
| 16 | Source Monitor, Program Monitor | À faire |
| 17 | Drag / trim | À faire |
| 18 | Save / reload | À faire |
| 19 | Export backend | À faire |

### Seulement ensuite

Effets, color, multicam, collaboration, IA. §1002 est explicite : pas avant.

## Jalon 1000 — premier vrai produit

Les 30 capacités listées en fin de cahier des charges, de « créer un projet »
à « rester fluide », sans aucune fonctionnalité factice. Après ce jalon :
audit complet (latence, bugs, architecture, mémoire, synchronisation,
ergonomie) **avant** d'élargir les fonctionnalités.

## Évaluation de faisabilité — à lire

Ce cahier des charges décrit plusieurs années-homme d'une équipe spécialisée
(moteur temps réel, WebCodecs/WebGPU, codecs professionnels, color management,
collaboration, interchange). Il ne sera pas livré par une session, ni par dix.

Ce qui est construit ici est le socle correct sur lequel le reste peut
s'empiler, en respectant l'ordre imposé et l'interdiction de faire semblant.
La progression réelle est dans `PROGRESS.md`.
