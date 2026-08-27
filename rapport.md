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

---

## 2026-08-27 — Système de commandes et modèle de timeline

### Objectif

Étapes 5 et 6 de la section 1002 : l'annulation transactionnelle, puis le cœur
du logiciel — les opérations de montage professionnelles.

### Modifications

**`nle/packages/command-system`** — command pattern, transactions atomiques et
historique undo/redo.

Le choix structurant est qu'une commande est une fonction *pure* de l'état vers
un nouvel état. L'annulation n'a donc besoin d'aucune fonction inverse écrite à
la main : il suffit de reprendre l'état précédent. C'est ce qui rend
l'annulation d'un ripple delete fiable, là où une inverse manuelle serait presque
impossible à garder juste.

Les gestes continus fusionnent : un glisser-déposer de 60 étapes ne produit
qu'une seule entrée d'annulation, et annuler ramène au début du geste.

**`nle/packages/timeline-model`** — toutes les opérations de montage exigées par
les sections 14, 91, 92, 93 et 94 : overwrite, insert, lift, extract, razor,
add edit, déplacement, trim simple, ripple trim, Q/W, roll, slip, slide,
étirement temporel, liaison audio/vidéo.

La correspondance entre le référentiel de la timeline et celui de la source est
exacte : un rush 50p sur une timeline 25p consomme bien deux images source par
image de timeline, et la vitesse se combine correctement par-dessus.

Chaque opération se termine par une vérification des invariants de la timeline.
Une opération qui produirait un chevauchement est refusée, jamais appliquée à
moitié.

### Vérifications

246 tests verts au total, dont un test de robustesse qui enchaîne 5 600
opérations de montage aléatoires sur plusieurs graines et vérifie après chacune
qu'aucun chevauchement, aucune durée nulle et aucun ordre cassé n'apparaît.

Un bug réel a été trouvé et corrigé grâce à ces tests : le ripple trim sur le
point d'entrée décalait le clip vers la droite en laissant un trou, au lieu de le
laisser en place et de faire remonter la suite, ce qui produisait un
chevauchement.

---

## 2026-08-27 — Moteur de timeline : viewport, virtualisation et accrochage

### Objectif

Étape 7 de la section 1002. C'est le module qui décide de la fluidité exigée par
la section 2.

### Modifications

**`nle/packages/timeline-engine`** — viewport et zoom autour du pointeur,
niveaux de détail, graduations, modèle de rendu virtualisé, désignation au
pointeur et accrochage magnétique.

Ce module ne connaît ni React ni Canvas. Il transforme une séquence et un
viewport en une simple liste d'éléments à dessiner. Il est donc testable sans
navigateur, mesurable en isolation, et pourra tourner dans un worker.

Deux choix ont un effet direct sur la fluidité : seuls les clips visibles
produisent un élément, et les coordonnées sont bornées aux bords de la vue
plutôt que de laisser des rectangles de plusieurs millions de pixels au moteur
de dessin.

### Vérifications

293 tests verts au total. Les performances sont mesurées et non affirmées, sur
une séquence de 10 000 clips répartis sur 100 pistes :

- modèle de rendu d'une vue : 0,11 à 0,28 ms, alors qu'une image à 60 images par
  seconde dispose de 16,6 ms ;
- requête sur une piste de 100 000 clips : 0,001 ms, aussi rapide à la fin de la
  piste qu'à son début ;
- accrochage complet : 0,44 ms.

Ces mesures ont révélé deux vraies faiblesses, corrigées : une recherche
quadratique dans le modèle de rendu, et un parcours linéaire complet dans la
collecte des points d'accrochage, qui coûtait plus du double.

---

## 2026-08-27 — Analyse média sur de vrais fichiers

### Objectif

Étape 8 de la section 1002 : lire réellement les caractéristiques techniques
d'un média, comme l'exige la section 9.

### Modifications

**`nle/scripts/make-fixtures.sh`** — génère de vraies fixtures média avec
FFmpeg : les cinq cadences imposées, un timecode drop-frame embarqué, un vrai
fichier à cadence variable, du ProRes 422 HQ, du DNxHR, du ProRes 4444 avec
couche alpha, de l'audio 5.1 en 24 bits et en 96 kHz, une séquence d'images, un
fichier étiqueté HDR et un fichier tronqué.

**`nle/packages/media-engine`** — analyse pure : formats de pixel, colorimétrie,
détection de cadence variable, mise en modèle. Aucun processus lancé, donc
testable sans FFmpeg.

**`nle/apps/media-worker`** — le seul module qui exécute ffprobe.

### Trois bugs réels, trouvés en confrontant le code à de vrais fichiers

1. La cadence mesurée écrasait la cadence déclarée : 23.976 devenait
   12250000/10427 au lieu de 24000/1001. La déclaration fait désormais foi, la
   mesure ne sert qu'à détecter la variabilité.
2. ffprobe liste les images dans l'ordre de décodage et non d'affichage. Avec
   des images B, les horodatages sautent, ce qui faisait passer pour variable
   la cadence de presque tous les fichiers H.264. Les horodatages sont
   maintenant triés avant mesure.
3. En JavaScript, `Number('')` vaut zéro : la ligne vide en fin de sortie
   ffprobe devenait un horodatage fantôme et déclenchait une fausse détection de
   cadence variable.

### Vérifications

333 tests verts au total, dont 18 qui analysent de vrais fichiers encodés.

Le cas de la cadence variable est traité comme l'exige la section 13 : le
fichier de test déclare une cadence de 30 images par seconde au niveau du flux,
alors que la mesure des horodatages révèle des durées d'image de 0,033 et de
0,1 seconde. Le média est marqué comme variable et un conform est proposé.
