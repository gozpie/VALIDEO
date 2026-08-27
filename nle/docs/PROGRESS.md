# Progression

Mis à jour à chaque étape (§1001). Vocabulaire imposé par §1003 :
`DONE` / `IN PROGRESS` / `NEXT` / `BLOCKED`, et dans le code
`EXPERIMENTAL` / `PARTIAL` / `UNAVAILABLE`.

## DONE

### Étape 1 — Monorepo

- pnpm workspaces, `packages/*` + `apps/*`.
- TypeScript **strict** avec `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, projets composites.
- ESLint : `any` interdit (§99), `console.log` interdit (§105), et une règle
  maison interdisant `Math.round` — pour forcer le passage par les arrondis
  exacts de `time-core` dans les calculs temporels (§12).
- Vitest + Prettier. Commande unique : `pnpm run check`.

### Étape 2 — `@valideo/time-core` (§12, §13, §16)

Le cœur temporel. **82 tests verts**, typecheck strict et lint propres.

- `rational.ts` — arithmétique de fractions exacte, bascule `bigint` sur
  débordement, erreur explicite plutôt que résultat faux. Arrondis
  (`floor`/`ceil`/`trunc`/`round`) en arithmétique **entière**.
  `approximate()` retrouve 24000/1001 depuis le flottant d'un démuxeur.
- `timebase.ts` — les 13 cadences de §12. Le drop-frame n'est autorisé que sur
  30000/1001, 60000/1001 et 120000/1001 : construire une timebase « 23.976 DF »
  **lève une erreur**.
- `timecode.ts` — SMPTE DF et NDF en arithmétique entière. Parsing d'une
  étiquette drop-frame inexistante (`00:01:00;00`) rejeté. Saisie monteur de
  §16 : `01:12:32:15`, `1512` calé à droite, `+10`, `-1:00`, `.`.
- `rational-time.ts` — position/durée en **images entières**. Mélanger deux
  timebases lève une erreur ; `rescale()` est explicite. Pont audio exact
  (images ↔ échantillons).
- `ticks.ts` — unité d'interchange exacte en `bigint` (voir ADR-004).

**Couverture de test.** Aller-retour image → timecode → image sur **une heure
entière, image par image**, en 23.976, 24, 25, 29.97 NDF, 29.97 DF, 50 et
59.94 DF. Plus la monotonie stricte du timecode DF sur une heure.

**Trois bugs réels attrapés par ces tests, et corrigés :**

1. L'unité de ticks d'Adobe n'est pas divisible par 1001 : elle était donc
   inexacte sur toutes les cadences NTSC (→ ADR-004).
2. La division `bigint` tronque vers zéro : l'arrondi des ticks décalait
   d'une image toutes les positions **négatives**.
3. Deux de mes propres assertions étaient fausses : aucun entier d'images à
   29.97 ne vaut exactement une heure. Le résidu de 3,6 ms/heure du drop-frame
   est maintenant un test documenté (→ ADR-003).

### Étape 3 — `@valideo/shared`

- Identifiants **typés** (branded types) : le compilateur refuse de confondre un
  `ClipId` et un `TrackId`, alors que ce sont deux chaînes à l'exécution.
- `Result<T, E>` avec une règle d'architecture explicite : une contrainte de
  montage violée est un `Err` (issue normale, affichable — §106), une incohérence
  interne est une **exception** (bug, doit remonter bruyamment). Cette séparation
  évite le `try/catch` fourre-tout qui avale les vrais bugs.
- Taxonomie d'erreurs de §106 : code, message utilisateur, action proposée,
  détail technique conservé, caractère réessayable.
- `platform.ts` — les rares globales (`crypto`, `TextEncoder`) déclarées **une
  seule fois** : les paquets du moteur ne dépendent ni du typage DOM ni de celui
  de Node, pour tourner à l'identique dans un onglet, un Worker et sur serveur.

8 tests.

### Étape 4 — `@valideo/project-model` (§45, §68, §69, §71, §72)

- **Schéma v1 complet** validé par zod : projet, bins, séquences, pistes, clips,
  transitions, effets, keyframes, marqueurs, médias avec flux vidéo/audio,
  espace colorimétrique, alpha, VFR, timecode embarqué, checksum, statuts
  online/offline et proxy.
- **Runner de migrations** v1 → v2 → v3. Un projet écrit par une version plus
  récente est **refusé explicitement** plutôt que rétrogradé en perdant des
  données (§1003). Le registre de production est vide — la v1 est la première
  version publiée, il n'y a rien à migrer — mais le mécanisme est complet et
  testé sur une chaîne à deux étapes, y compris les cas d'échec : étape
  manquante, migration qui lève, migration qui oublie de mettre à jour
  `schemaVersion`, document migré mais structurellement invalide.
- **Sérialisation déterministe** : clés triées, donc deux enregistrements d'un
  projet identique produisent des octets identiques. Les sommes de contrôle sont
  fiables et l'autosave peut détecter qu'il n'y a rien à écrire (§44).
- Fabriques et les 8 presets de séquence de §68 (ARRI, RED, Blackmagic, AVCHD,
  DSLR, Digital Cinema, XDCAM, Broadcast).

20 tests. **Total : 110 tests verts.**

### Étape 5 — `@valideo/command-system` (§43, §70)

- **Command pattern** où une commande est une fonction *pure* de l'état vers un
  nouvel état. Conséquence : l'annulation n'a besoin d'aucune logique inverse
  écrite à la main — il suffit de reprendre l'état précédent. C'est ce qui rend
  l'undo fiable sur une opération composée comme le *ripple delete*, où une
  inverse manuelle serait presque impossible à garder juste.
- **Transactions atomiques** : si une étape échoue, l'ensemble échoue et l'état
  d'origine ressort intact. Aucune modification partielle n'atteint le projet —
  c'est littéralement la séquence de §70.
- **Fusion des gestes continus** : 60 micro-déplacements d'un glisser-déposer ne
  produisent qu'**une seule** entrée d'annulation, et annuler revient au début du
  geste. Sans ça, l'historique est inutilisable.
- Profondeur configurable, saut direct à une étape (panneau Historique),
  suivi de l'état modifié pour l'autosave (§44), abonnements.
- **Partage de structure** vérifié par test : une entrée d'historique ne duplique
  pas les parties inchangées du projet (§57).

24 tests.

### Étape 6 — `@valideo/timeline-model` (§14, §80, §91, §92, §93, §94, §38)

Le cœur du logiciel. Toutes les opérations sont pures, et **toutes repassent par
une vérification d'invariants** avant d'être rendues : une opération qui
produirait un chevauchement est refusée, jamais appliquée à moitié.

Opérations implémentées et testées :

| Opération | Comportement vérifié |
|---|---|
| Overwrite | efface ce qu'il recouvre, coupe un clip traversé en deux, n'allonge la séquence que s'il la dépasse |
| Insert | ouvre un trou, coupe le clip traversé, décale les pistes en *sync lock*, épargne les pistes verrouillées |
| Lift | retire et laisse le trou |
| Extract | retire et referme ; **refuse** de refermer par-dessus du contenu encore présent sur une piste synchronisée |
| Razor / Add Edit | coupe continue en source, identifiant neuf pour la seconde moitié, sans effet sur une coupe existante |
| Déplacement | recouvre à l'arrivée, libère l'origine, refuse vidéo → piste audio |
| Trim simple | raccourcit en laissant un trou, rallonge en recouvrant le voisin |
| Ripple trim | sur le point d'entrée, le clip **garde sa place** et la suite remonte |
| Q / W (§93) | *ripple trim* jusqu'à la tête de lecture |
| Roll | déplace la coupe, durée totale constante, borné par les deux clips **et** par les poignées |
| Slip | fait défiler la source sous le clip sans le bouger |
| Slide | déplace le clip en ajustant ses deux voisins, portée totale constante |
| Rate stretch | change la durée en conservant la portion de source utilisée |
| Link / Unlink | groupes audio/vidéo (§80) |

**Correspondance timeline ↔ source exacte.** Un clip vit dans deux référentiels :
position et durée en images de la séquence, point d'entrée en images de la
source. Les cadences peuvent différer et la vitesse s'ajoute par-dessus ; toute
la conversion passe par `time-core` en rationnel exact. Testé : une image de
timeline 25p consomme deux images d'une source 50p ; 24 images à 23.976 valent
exactement 30 images à 29.97.

**Butées de poignées.** Un trim ne s'arrête pas au hasard : il s'arrête à la
dernière image réellement disponible dans la source. Quand la source est
inconnue (média hors ligne), rien n'est contraint plutôt que d'inventer.

**112 tests**, dont un **fuzz déterministe** : 5 600 opérations de montage
aléatoires enchaînées sur 7 graines, en vérifiant après *chaque* opération
qu'aucun chevauchement, aucune durée nulle, aucun ordre cassé n'apparaît — et
qu'aucun refus ne passe par une exception. Une graine qui échouerait est
rejouable à l'identique.

Un bug réel attrapé et corrigé : le *ripple trim* sur le point d'entrée décalait
le clip vers la droite en laissant un trou, au lieu de le laisser en place et de
faire remonter la suite. Il produisait un chevauchement.

**Total : 246 tests verts.**

## NEXT

Dans l'ordre imposé par §1002 :

1. `@valideo/timeline-engine` — index par intervalles, requêtes de rendu,
   virtualisation (§17, §55).
2. `MediaAsset` et import local, puis backend FFprobe (§8, §9).
3. Détection de capacités navigateur (§59, §118).

## BLOCKED

Rien à ce stade.

## Limites d'environnement constatées

- **FFmpeg 6.1.1 installé** dans le conteneur (x264, x265, ProRes, DNxHD, AV1,
  VP9, AAC, PCM). Les fixtures média de §101 sont donc générables réellement.
- **Pas de GPU.** WebGPU et le décodage matériel ne sont pas mesurables ici :
  les chiffres de performance de §103 devront être repris sur une vraie machine.
- **Conteneur éphémère.** Tout travail non poussé est perdu : on commite et on
  pousse à chaque étape.
