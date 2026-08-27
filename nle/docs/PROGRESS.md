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

## NEXT

Dans l'ordre imposé par §1002 :

1. `@valideo/command-system` — command pattern, undo/redo transactionnel (§43, §70).
2. `@valideo/timeline-model` — pistes, clips, insert/overwrite/lift/extract/
   ripple/roll/slip/slide/razor (§14, §91, §92).
3. `@valideo/timeline-engine` — interval tree, requêtes, rendu Canvas virtualisé.

## BLOCKED

Rien à ce stade.

## Limites d'environnement constatées

- **FFmpeg 6.1.1 installé** dans le conteneur (x264, x265, ProRes, DNxHD, AV1,
  VP9, AAC, PCM). Les fixtures média de §101 sont donc générables réellement.
- **Pas de GPU.** WebGPU et le décodage matériel ne sont pas mesurables ici :
  les chiffres de performance de §103 devront être repris sur une vraie machine.
- **Conteneur éphémère.** Tout travail non poussé est perdu : on commite et on
  pousse à chaque étape.
