# Rapport des modifications

## 2026-08-27 — Démarrage du NLE : monorepo et cœur temporel

### Objectif

Amorcer le projet de logiciel de montage vidéo décrit dans
`MASTER_INSTRUCTION_CLAUDE_CODE.md` (1005 sections), en suivant l'ordre de
construction imposé par sa section 1002.

### Décision de périmètre

Le NLE est créé dans un dossier **`nle/`** autonome. **Aucun fichier de
l'application VALIDEO existante (PHP/MySQL) n'a été modifié.** Les deux
produits sont distincts ; la décision est réversible à coût nul (ADR-001).

### Modifications

**1. Monorepo `nle/`** — pnpm workspaces, TypeScript strict (`any` interdit),
ESLint, Prettier, Vitest. Commande unique `pnpm run check`.

**2. Paquet `@valideo/time-core`** — le cœur temporel du moteur, exigé par la
section 12 du cahier des charges :

- arithmétique rationnelle exacte (23.976 est stocké 24000/1001, jamais en
  flottant), avec bascule `bigint` et erreur explicite en cas de débordement ;
- les 13 cadences imposées, avec refus des combinaisons impossibles
  (« 23.976 drop-frame » n'existe pas et est rejeté à la construction) ;
- timecode SMPTE drop-frame et non drop-frame en arithmétique entière ;
- saisie monteur de la section 16 (`01:12:32:15`, `1512`, `+10`, `-1:00`) ;
- pont exact images ↔ échantillons audio ;
- unité de ticks d'interchange (AAF/FCPXML/OTIO).

### Vérifications

- **82 tests verts**, dont l'aller-retour image → timecode → image sur **une
  heure entière, image par image**, en 23.976, 24, 25, 29.97 NDF, 29.97 DF, 50
  et 59.94 DF.
- Typecheck strict sans erreur, ESLint sans avertissement.

Ces tests ont attrapé trois bugs réels, corrigés : l'unité de ticks d'Adobe
n'est pas exacte sur les cadences NTSC ; la division `bigint` décalait d'une
image toutes les positions négatives ; et deux de mes propres hypothèses
étaient fausses (aucun nombre entier d'images à 29.97 ne vaut exactement une
heure — le drop-frame laisse 3,6 ms d'erreur par heure, soit 159 échantillons
à 44,1 kHz).

### Écart assumé par rapport à AGENTS.md

`AGENTS.md` demande de valider chaque étape avec l'utilisateur avant
d'enchaîner. La demande explicite étant de travailler **en autonomie pendant la
nuit**, les étapes sont enchaînées sans validation intermédiaire et documentées
ici pour validation a posteriori. Le découpage en petites étapes commitées
séparément est respecté.

### Suite

Ordre imposé par la section 1002 : types partagés → schéma de projet versionné
→ système de commandes (undo/redo) → modèle de timeline → moteur de requête.

---

## 2026-08-27 — Types partagés et schéma de projet versionné

### Objectif

Étapes 3 et 4 de l'ordre imposé par la section 1002 : la base de types
transverses, puis le format de projet qui devra survivre aux migrations.

### Modifications

**`nle/packages/shared`** — identifiants typés (le compilateur refuse de
confondre un identifiant de clip et un identifiant de piste), type `Result`, et
la taxonomie d'erreurs de la section 106 (code, message utilisateur, action
proposée, détail technique conservé).

Règle d'architecture posée : une contrainte de montage violée est un résultat
d'erreur normal, affichable ; une incohérence interne est une exception qui doit
remonter bruyamment. Cela évite le `try/catch` fourre-tout qui masque les vrais
bugs.

**`nle/packages/project-model`** — schéma de projet v1 complet et validé
(projet, bins, séquences, pistes, clips, transitions, effets, keyframes,
marqueurs, médias avec flux vidéo/audio, colorimétrie, alpha, cadence variable,
timecode embarqué, statuts hors ligne et proxy), mécanisme de migration
v1 → v2 → v3, sérialisation déterministe, et les 8 presets de séquence de la
section 68.

Un projet enregistré par une version plus récente du logiciel est refusé
explicitement plutôt que rétrogradé en perdant des données, comme l'exige la
section 1003.

### Écart assumé par rapport au cahier des charges

La section 71 demande de stocker le point de sortie source d'un clip. Il n'est
pas stocké mais **dérivé** de l'entrée source, de la durée et de la vitesse :
stocker les deux serait redondant, et la première opération de trim qui
oublierait d'en mettre un à jour rendrait le clip incohérent sans que rien ne le
détecte. C'est un écart à la lettre, pas à l'intention (ADR-006).

### Vérifications

110 tests verts au total, typecheck strict et lint sans avertissement.
