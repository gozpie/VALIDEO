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

### Étape 7 — `@valideo/timeline-engine` (§2, §17, §55, §77, §103)

Le moteur qui décide de la fluidité. Il ne connaît **ni React ni Canvas** : il
est purement calculatoire, donc testable et exécutable hors du thread
d'interface.

- **Viewport immuable** — correspondance temps ↔ pixels, zoom autour du
  pointeur (l'image sous le curseur reste fixe, vérifié au 10⁻⁹ près), zoom
  clavier, *fit*, défilement, `scrollIntoView`, bornage du défilement.
  Une image occupe jusqu'à 64 px au zoom maximal ; au zoom minimal, **plus de
  20 heures** tiennent dans 1000 px (§17).
- **Niveaux de détail** — vignettes, formes d'onde, étiquettes et grille image
  s'éteignent automatiquement quand elles deviendraient illisibles. Principe de
  §55 : ce qui n'est pas lisible ne doit pas être calculé.
- **Graduations** — échelle construite à partir de la cadence, donc les repères
  tombent sur des secondes et des minutes rondes, jamais sur des valeurs
  arbitraires.
- **Modèle de rendu virtualisé** — produit une liste plate d'éléments visibles.
  Les coordonnées sont **bornées au viewport** : dessiner un rectangle de
  −2 000 000 px à +2 000 000 px est lent et imprécis, on le coupe aux bords en
  signalant le débordement.
- **Désignation au pointeur** — corps de clip, bord entrant, bord sortant, avec
  une règle qui empêche les zones de trim de dévorer un clip étroit.
  Sélection au rectangle.
- **Accrochage magnétique** — seuil exprimé en **pixels**, donc utilisable à tous
  les zooms. Un clip déplacé s'accroche par son début **ou** par sa fin, selon
  le plus proche.

**Performances mesurées, pas affirmées** (§103), sur une séquence de
**10 000 clips répartis sur 100 pistes** :

| Opération | Mesure |
|---|---|
| Modèle de rendu d'une vue | **0,11 – 0,28 ms** |
| Zoom | < 0,001 ms |
| Requête sur une piste de **100 000 clips** | **0,001 ms** |
| Accrochage complet | 0,44 ms |

Pour référence, une image à 60 FPS dispose de 16,6 ms. Les tests vérifient aussi
qu'interroger la **fin** d'une piste de 100 000 clips ne coûte pas plus cher que
son début — la signature d'une dichotomie, par opposition à un filtre linéaire.

Deux optimisations réelles trouvées par ces mesures : une recherche quadratique
piste-par-calque dans le modèle de rendu, et un parcours linéaire complet dans
la collecte des points d'accrochage (1,03 ms → 0,44 ms).

47 tests. **Total : 293 tests verts.**

### Étape 8 — Analyse média : `@valideo/media-engine` + `apps/media-worker` (§8, §9, §13, §29, §83, §101)

**Ces tests analysent de vrais fichiers**, pas des sorties ffprobe enregistrées.
`scripts/make-fixtures.sh` encode réellement, avec FFmpeg 6.1.1 :

- les cinq cadences de §100 : 23.976, 25, 29.97 DF, 50, 59.94 ;
- un timecode drop-frame et un timecode non drop-frame embarqués ;
- un **vrai fichier à cadence variable** (deux segments 30p et 10p concaténés) ;
- ProRes 422 HQ 10 bits, DNxHR HQ, **ProRes 4444 avec couche alpha** 12 bits ;
- audio 48 kHz stéréo, **5.1 en 24 bits**, 96 kHz ;
- une séquence d'images PNG ;
- un fichier étiqueté **HDR PQ / BT.2020** ;
- un fichier tronqué, pour vérifier le message d'erreur.

Séparation nette : `media-engine` est **pur** (aucun processus, aucun disque),
`apps/media-worker` est le seul module qui lance ffprobe.

Ce qui est lu et vérifié : conteneur, codec, profil, niveau, définition, format
de pixel, **profondeur réelle**, alpha et son mode, sous-échantillonnage,
rapport d'aspect, ordre de trame, colorimétrie complète (primaires, transfert,
matrice, plage) avec détection PQ/HLG, codec audio, fréquence
d'échantillonnage, disposition des canaux, timecode embarqué, date de création,
taille et date de modification.

**Trois bugs réels, tous trouvés en confrontant le code à de vrais fichiers :**

1. **La cadence mesurée écrasait la cadence déclarée.** Reconstruire 23.976
   depuis des horodatages quantifiés donnait `12250000/10427` au lieu de
   `24000/1001`. La déclaration fait foi ; la mesure ne sert qu'à *détecter* la
   variabilité et à fournir une moyenne quand le média est réellement VFR.
2. **ffprobe liste les images en ordre de décodage, pas de présentation.** Dès
   qu'il y a des images B, la suite des horodatages saute (…0,40 puis 0,48, le
   0,44 arrivant plus loin). Sans tri préalable, tout fichier avec images B
   était déclaré à cadence variable.
3. **`Number('')` vaut `0`.** La ligne vide en fin de sortie ffprobe devenait un
   horodatage 0 fantôme, créant un doublon et une fausse détection de VFR.

**Le cas VFR est traité comme l'exige §13** : le fichier de test déclare
`r_frame_rate = 30/1` au niveau du flux ; la mesure des horodatages révèle des
durées d'image de 0,033 s **et** 0,1 s. Le média est marqué à cadence variable et
un avertissement propose le conform.

40 tests (22 purs, 18 sur fichiers réels). **Total : 333 tests verts.**

### Étape 9 — Détection de capacités et stratégie de lecture (§59, §58, §60, §118)

- **Classement de machine** en `LOW` / `MEDIUM` / `HIGH` / `WORKSTATION` à partir
  des cœurs, de la mémoire, de WebGPU/WebGL 2 et de WebCodecs. Le classement est
  volontairement **conservateur** : mieux vaut sous-estimer une machine que
  saturer la mémoire d'un portable en pleine session.
- **Budgets de cache** par profil (RAM, disque, GPU, workers de décodage,
  décodage anticipé), **plafonnés au quota de stockage réellement disponible** :
  promettre 50 Gio de cache sur un quota de 2 Gio ne produirait que des échecs
  d'écriture.
- Le classement **s'explique** : il retourne ses raisons et la liste des
  limitations à signaler honnêtement à l'utilisateur.
- **Stratégie de lecture conforme à §60** : `direct`, `proxy`, `transcode` ou
  `unavailable`. Un ProRes n'est jamais « non pris en charge » — il demande un
  proxy, et la réponse le dit. `unavailable` est réservé au média hors ligne.
- Interrogation de l'environnement **défensive et injectable** : testable pour
  des configurations qu'on n'a pas sous la main.

22 tests.

### Étape 10 — `@valideo/audio-engine` : pics et mesures (§19, §31)

- **Pyramide de pics** : chaque niveau est construit depuis le **précédent**, pas
  depuis les échantillons — le coût total reste linéaire. Chaque case retient
  min, max **et RMS** : l'enveloppe donne la silhouette, le RMS donne le
  remplissage, bien plus représentatif de la sonie perçue.
- **Le zoom ne recalcule rien** (§19) : `readWaveform` choisit le niveau adapté
  et ne lit que lui.
- Stockage en entiers 16 bits : la pyramide complète pèse **3,1 %** de l'audio.
  Une heure de mono à 48 kHz = 20,6 Mio, construite en ~0,8 s ; la lecture d'une
  vue de 1600 colonnes reste sous la milliseconde quel que soit le zoom.
- Vérifié : une **crête isolée d'une seule image** reste visible à tous les
  niveaux de dézoom — c'est tout l'intérêt de stocker min/max plutôt qu'une
  moyenne.
- **Mesures** : crête, RMS, et un afficheur à montée instantanée et chute
  progressive avec maintien de crête, comme un bargraphe professionnel.
- La sonie LUFS est marquée **`PARTIEL`** dans le code : la pondération K et la
  porte du calcul intégré ne sont pas implémentées, donc la valeur ne vaut pas
  pour une validation broadcast. C'est écrit, pas dissimulé (§1003).

16 tests.

### Étape 11 — `@valideo/keyboard` : raccourcis et JKL (§33, §34)

- **Travail sur la position physique des touches** (`KeyboardEvent.code`), pas
  sur le caractère produit. Sur un clavier AZERTY, la touche à la position du Q
  américain produit « a » : un montage se fait à la position des doigts.
- Modificateur `Mod` abstrait — Cmd sur macOS, Ctrl ailleurs — donc **une seule**
  table pour les deux plateformes.
- **Catalogue de 60 actions** nommées, indépendantes des touches : c'est ce qui
  permet plusieurs presets et un éditeur visuel sans dupliquer une ligne de
  logique.
- **Trois presets** : par défaut, style Avid, style Final Cut. Aucun asset ni
  marque tierce — seules les **conventions ergonomiques** sont reprises, ce que
  le cahier des charges autorise explicitement.
- **Résolution contextuelle** : la même touche peut faire une chose dans la
  timeline et une autre dans le moniteur ; le contexte précis l'emporte sur le
  global.
- **Détection de conflits et d'actions inconnues** — le validateur a d'ailleurs
  attrapé une vraie erreur dans mon preset « style Final Cut », où deux actions
  se disputaient Suppr.
- La personnalisation **remplace** l'ancienne touche au lieu de s'y ajouter.
- **JKL (§33)** en un seul entier signé : L incrémente, J décrémente, K remet à
  zéro. Ce modèle produit tout le comportement attendu — L, LL, LLL montent les
  paliers ; depuis 3×, J **ralentit** à 2× au lieu d'inverser brutalement ; en
  continuant, on passe par l'arrêt puis on inverse. K maintenu transforme J et L
  en ralenti.
- **Son pendant le shuttle (§32)** : coupé au-delà d'un seuil configurable
  plutôt que de produire un artefact.

28 tests. **Total : 395 tests verts.**

### Étape 12 — `apps/web` : l'application (§2, §5, §6, §7, §14, §43, §73, §75, §102)

Le moteur devient visible et manipulable. **Ce qui fonctionne réellement**, à la
souris et au clavier, à travers le moteur testé :

- déplacer un clip (avec accrochage magnétique et repère visuel), changer de
  piste ;
- trimer par les bords, en mode simple ou ripple ;
- couper à la lame, ajouter un point de montage à la tête de lecture ;
- roll, slip, slide, étirement temporel ;
- sélection simple, additive, au rectangle, et par piste vers l'avant ;
- verrouiller / cibler / masquer / muter / soloer une piste — **via de vraies
  commandes annulables** ;
- annuler, rétablir, et **revenir à n'importe quelle étape** en cliquant dans
  l'historique ;
- zoom autour du pointeur à la molette, ajustement, défilement, navigation par
  points de montage sur les **pistes ciblées** ;
- saisie de timecode à la manière d'un monteur (`01:00:12:00`, `1512`, `+10`) ;
- navigation JKL avec paliers de vitesse.

**Architecture conforme à §2.** Pendant un geste — déplacement, trim, scrub —
**aucun état React n'est modifié**. Le geste vit dans une `ref` mutable et le
canvas est redessiné directement. React n'intervient qu'au relâchement, pour
appliquer la commande. Le coût par image est celui d'un `dessinerTimeline`, pas
celui d'un arbre de composants.

**Ce qui n'est PAS fait, et que l'interface annonce au lieu de le simuler**
(§1003) : les deux moniteurs sont **vides**, avec un texte expliquant que le
moteur de lecture n'existe pas encore. Aucune vignette, **aucune forme d'onde
dessinée** — le projet de démonstration ne référence aucun média, et inventer
une forme d'onde serait exactement le « faire semblant » interdit. Pas d'export.

**Icônes maison** en SVG monochrome piloté par `currentColor` — aucun asset
tiers, conformément à §1.

**9 tests de bout en bout dans un vrai navigateur** (§102) : ils déplacent des
clips à la souris, coupent à la lame, verrouillent une piste, annulent, et
vérifient que le **modèle** a réellement changé en lisant le panneau Projet. Ils
vérifient aussi qu'un geste continu ne produit **qu'une** entrée d'historique,
qu'une opération refusée affiche son message sans rien modifier, et qu'aucune
erreur console n'apparaît.

Un écart de comportement réel trouvé par ces tests : la navigation par points de
montage parcourait **toutes** les pistes. Un NLE ne s'arrête que sur les pistes
**ciblées** — sinon la tête bute sur chaque raccord d'une piste de titrage qu'on
ne regarde pas. Corrigé.

**Total : 401 tests unitaires + 9 tests de bout en bout.**

### Étape 13 — `@valideo/storage` : persistance et reprise (§44, §45, §46, §61, §62)

**« Fermer et rouvrir sans perte »** — l'un des 30 points du jalon 1000 — est
maintenant vrai, et vérifié dans un navigateur.

- **Interface de stockage** volontairement minuscule (lire, écrire, supprimer,
  lister) : tout fournisseur imaginable sait faire ces quatre choses. Trois
  implémentations : **OPFS**, **localStorage** (repli) et mémoire.
- **Choix automatique** avec vérification *réelle* : un navigateur en navigation
  privée expose `localStorage` tout en refusant l'écriture, on teste donc
  vraiment. Si aucun stockage persistant n'existe, l'interface **prévient en
  bandeau** que le travail sera perdu (§1003).
- **Enregistrement explicite** et **sauvegarde automatique** écrivent dans des
  fichiers **distincts** : l'autosave n'écrase jamais ce que l'utilisateur a
  volontairement enregistré.
- **Reprise après incident** (§44) : si l'autosave est plus récente que le
  dernier enregistrement, c'est qu'une session s'est interrompue. Un bandeau la
  **propose** — il n'écrase jamais d'office.
- **Instantanés horodatés** en rotation, restaurables individuellement.
- **Autosave temporisée** avec verrou d'écriture : une sauvegarde lente ne se
  chevauche pas avec la suivante, et une modification survenue pendant
  l'écriture est replanifiée au lieu d'être perdue.

**Portée déclarée.** Le mécanisme repose sur des **instantanés du document**. Le
journal transactionnel par commande évoqué en §44 n'est **pas** implémenté : il
exigerait des commandes sérialisables, ce que le moteur ne fournit pas
(ADR-009). C'est écrit dans le code, pas sous-entendu.

**Quatre bugs réels trouvés en testant dans un vrai navigateur :**

1. Le projet de démonstration recevait un **identifiant neuf à chaque
   chargement** : rien ne pouvait donc jamais être retrouvé.
2. Ses marqueurs avaient les identifiants `m1`, `m2`, `m3` — pas des UUID.
   L'écriture passait, la **relecture** échouait à la validation.
3. **L'échec de chargement était avalé en silence.** Un projet illisible
   repartait d'un document vide sans prévenir — le pire scénario possible pour
   un monteur. L'erreur est maintenant affichée (§106) ; c'est elle qui a permis
   de diagnostiquer les deux bugs précédents.
4. Le projet de démonstration **s'affichait une fraction de seconde** avant
   d'être remplacé par le projet enregistré. L'éditeur n'apparaît maintenant
   qu'une fois le stockage interrogé.

22 tests unitaires + 2 tests de bout en bout.
**Total : 424 tests unitaires + 11 tests de bout en bout.**

### Étape 14 — Import de vrais médias et formes d'onde réelles (§8, §19, §83)

**La forme d'onde n'est plus une promesse.** On importe un fichier audio, le
navigateur le décode intégralement, la pyramide de pics est construite à partir
des **vrais échantillons**, et la timeline la dessine.

- **Audio** : `decodeAudioData` décode le fichier entier. Nombre de canaux,
  fréquence d'échantillonnage et durée affichés sont ceux réellement lus.
- **Vidéo** : durée et définition lues via le navigateur ; le codec, le profil,
  la colorimétrie et le timecode embarqué **restent vides** — ils exigent
  ffprobe (§9), et le service d'analyse existe déjà, testé, prêt à être branché.
  Le média est importable mais sa lecture reste annoncée comme indisponible.
- **Fichier illisible** : signalé, bouton « Poser » désactivé, application
  intacte.
- **Les butées de trim deviennent exactes** : `resolveSource` retourne
  désormais les vraies bornes du média. On ne peut plus tirer un clip au-delà de
  ce que le fichier contient. Pour un clip sans média — titre, cache couleur —
  il n'y a rien à borner, et rien n'est inventé.
- **Dessin honnête** : un clip audio dont le média n'a pas été décodé ne reçoit
  **aucune** forme d'onde. Un aplat uni vaut mieux qu'une courbe inventée.

**Trois bugs réels trouvés en cherchant à voir la forme d'onde :**

1. **La largeur du viewport restait figée** à sa valeur initiale dans l'état
   partagé, alors que le canvas mesurait 1452 px. Tout ce qui en dépend —
   « Ajuster », l'ancrage du zoom, le bornage du défilement — se calculait sur
   une vue qui n'existait pas.
2. **Le zoom se centrait sur le milieu de la vue** au lieu de la tête de
   lecture. Dans un NLE, chaque cran de zoom éloignait donc du point de travail.
3. La fixture nommée `audio_48k_stereo.wav` était en réalité **mono** : le nom
   mentait. Corrigé dans le script de génération, pas dans le test.

**Vérification au pixel près** : un test de bout en bout compte les pixels
clairs de la piste avant et après l'import, et vérifie qu'une piste audio *sans*
média décodé n'en reçoit aucun. C'est la preuve que la courbe vient des
échantillons et non d'un décor.

**Total : 424 tests unitaires + 15 tests de bout en bout.**

### Étape 15 — `@valideo/playback` : l'horloge audio est maître (§22, §32)

**Ça joue.** Un fichier audio importé se lit réellement, et c'est le son qui
commande la tête de lecture.

Le point qui compte : la position de lecture n'est **jamais incrémentée à la
main**. Elle est **dérivée de `AudioContext.currentTime`**, la seule horloge qui
avance au rythme réel de la carte son. Incrémenter une position dans une boucle
d'animation donnerait une dérive immédiate — `requestAnimationFrame` suit
l'écran, pas le son, et les deux horloges ne sont jamais au même rythme.

- **Planificateur pur** (`packages/playback`) : pour une fenêtre de timeline, il
  répond à la seule question difficile — quels morceaux de quels fichiers jouer,
  à quel instant, à partir de quel endroit du fichier, à quel gain. Toute la
  conversion timeline → source passe par le rationnel exact ; une erreur d'une
  image s'entendrait comme un décalage image/son.
- **Entrée au bon endroit** : lancer la lecture au milieu d'un plan entre dans le
  fichier à la bonne seconde, sans reprendre le clip depuis son début.
- **Fenêtre glissante** : on ne programme que quelques secondes d'avance,
  réapprovisionnées régulièrement — pas des milliers de nœuds pour une heure de
  montage.
- **Mute et solo** respectés, le solo primant sur tout ; gain de clip converti
  des décibels vers un facteur linéaire.
- **Vitesse** : un clip à 200 % consomme bien deux fois plus de source.

**Ce que le moteur REFUSE de jouer, et le dit** (§1003) :

| Cas | Comportement |
|---|---|
| Clip sans média | ignoré, signalé |
| **Lecture inversée** | ignorée — Web Audio ne sait pas lire un tampon à l'envers, et le jouer à l'endroit serait faux et inaudible comme erreur |
| Cadence source inconnue | ignoré, signalé |
| Volume automatisé par keyframes | **joué** au gain de départ, avec un avertissement |
| Segment déjà passé | non rattrapé — le jouer en retard s'entendrait |
| Fichier trop gros pour tenir en mémoire | forme d'onde conservée, lecture directe refusée et signalée |

**Les moniteurs disent maintenant la vérité** : « Son lu · image non décodée ».
Le son est réel ; l'image demande un démultiplexeur et un décodeur qui n'existent
pas, et le panneau reste vide plutôt que d'afficher une mire.

Aux vitesses de shuttle autres que 1×, aucun son n'est produit et l'interface
affiche « sans son » — plutôt qu'un artefact.

20 tests unitaires + 2 tests de bout en bout qui vérifient, dans un vrai
navigateur, que la tête avance seule pendant la lecture, s'arrête vraiment à la
pause, et progresse à une vitesse cohérente avec la cadence de la séquence.

**Total : 444 tests unitaires + 17 tests de bout en bout.**

### Étape 16 — `@valideo/demux` : le démultiplexeur MP4 (§901-1000, §66)

**WebCodecs ne démultiplexe pas.** `VideoDecoder` attend des morceaux déjà
extraits du conteneur, avec leur horodatage et leur description de codec. Sans
démultiplexeur, aucun décodage n'est possible — c'est la pièce que §901-1000
signale explicitement comme manquante dans les approches naïves.

- **Lecture par plages** : le démultiplexeur ne connaît du fichier que sa taille
  et la possibilité d'en lire une tranche. Un fichier de 400 Go n'est jamais
  chargé en mémoire (§66) — un test le vérifie en comptant les octets réellement
  lus.
- **Index d'échantillons complet** : `stts`, `ctts`, `stsc`, `stsz`/`stz2`,
  `stco`/`co64`, `stss`. Les tables MP4 sont compressées par répétition et
  regroupées en *chunks* ; il faut les déplier pour savoir où commence chaque
  image.
- **Chaînes de codec WebCodecs** construites depuis `avcC`, `hvcC` et `vpcC` :
  `avc1.640028`, `vp09.00.20.08`.
- **Listes d'édition (`elst`)** — le détail qui sépare un démultiplexeur juste
  d'un démultiplexeur approximatif. Avec des images B, les décalages de
  composition sont positifs et le premier horodatage vaut deux images au lieu de
  zéro. L'ignorer **décale toute la piste vidéo de deux images par rapport au
  son**.
- Les fichiers **fragmentés** sont détectés et signalés, pas silencieusement
  mal indexés.

**Validé contre ffprobe** : les horodatages de présentation produits sont
**identiques** à ceux que ffprobe lit sur les mêmes fichiers — H.264 avec images
B, VP9, ProRes en MOV, fichier avec piste de timecode. 18 tests.

### Étape 17 — Décodage WebCodecs et image dans le Moniteur Programme

La chaîne est complète : **fichier → démultiplexeur → `EncodedVideoChunk` →
`VideoDecoder` → `VideoFrame` → canvas**.

- L'import d'une vidéo passe désormais par **notre démultiplexeur** : on obtient
  la **cadence exacte** (12800/512 = exactement 25, et 24000/1001 reste
  24000/1001), le **codec réel** et la définition codée — là où un élément vidéo
  ne donnait qu'une durée approchée et aucune cadence fiable.
- Le Moniteur Programme affiche l'image **exacte** de la tête de lecture. Un test
  de bout en bout le vérifie image par image : à la position *n*, l'horodatage
  de l'image décodée vaut exactement *n* × 40 000 µs.
- Un codec que le navigateur ne décode pas est **annoncé** — « démuxé · proxy
  requis » — et non affiché comme une erreur (§60).

**Deux bugs réels, tous deux dans la gestion du décodeur :**

1. Mon mécanisme d'attente supposait **une image par appel à `decode()`**. Un
   décodeur émet par rafales, sans correspondance un-pour-un : les images
   surnuméraires n'étaient jamais libérées et la bonne était parfois perdue.
   Remplacé par un collecteur.
2. Les demandes concurrentes **corrompaient l'état du décodeur** — un décodeur
   porte la position atteinte dans le groupe d'images. Elles sont maintenant
   sérialisées.

**Limite assumée et mesurée** : chaque demande repart de l'image clé qui précède.
Une reprise incrémentale semblait économique, mais elle rendait muette la demande
suivante quand la cible avait déjà été franchie. C'est un **affichage d'image
fixe**, pas une lecture temps réel : il manque le décodage anticipé, le cache
d'images et la synchronisation de l'image sur l'horloge audio. Un saut d'un
groupe d'images complet prend visiblement plus de temps qu'un pas d'une image —
c'est inhérent, et c'est ce que le cache résoudra.

**Total : 462 tests unitaires + 19 tests de bout en bout.**

### Étape 18 — Cache d'images et lecture vidéo temps réel (§22, §57, §120, §121)

**Ça lit.** L'image suit la lecture, calée sur l'horloge audio.

- **Cache d'images décodées**, borné en **pixels** et non en nombre d'images :
  vingt-quatre images en 320×240 coûtent 7 Mo, les mêmes en 4K en coûteraient
  800 (§57). Le budget est ajustable selon le profil de la machine (§58).
- **Décodage anticipé** : pendant la lecture, le cache est rempli une seconde et
  demie devant la tête, quatre fois par seconde. C'est exactement ce qui sépare
  « afficher une image » de « lire » — sans avance, chaque image coûterait un
  aller-retour de décodage et la cadence s'effondrerait.
- Les images voisines d'un scrub sont **conservées** : avancer d'une image ne
  redécode plus le groupe entier.
- Les images sont rendues par **clone**, pour que l'appelant puisse les fermer
  sans vider le cache.

**Mesuré dans un vrai navigateur** : en 1,78 s d'horloge murale, l'affichage
progresse de l'image 0 à l'image **44** d'une séquence à 25 i/s — soit ~24,7 i/s,
la cadence nominale. 27 images distinctes sur 27 échantillons : l'image change
réellement à chaque relevé.

Un test de bout en bout vérifie surtout que l'image affichée et la tête de
lecture **ne dérivent pas l'une de l'autre** : la tête est pilotée par l'horloge
audio, et l'image la suit à moins de six images près.

**Les moniteurs disent maintenant exactement ce qu'ils font** : le Moniteur
Programme affiche « une seule couche · pas de composition » — l'image est réelle
et suit la lecture, mais superposition, opacité, fondus et effets demandent le
graphe de rendu, qui n'existe pas. Le Moniteur Source, lui, est annoncé comme
non implémenté, ce qu'il est.

**Total : 462 tests unitaires + 20 tests de bout en bout.**

## NEXT

1. Graphe de rendu et composition multicouche (§23) — la suite logique : c'est
   ce qui manque pour afficher plus d'une piste à la fois.
2. Vignettes de timeline (§18), qui réutiliseront le cache d'images.
3. Branchement du service d'analyse ffprobe sur l'import (§9).
4. Export (§48) — il demande le graphe de rendu et un encodeur.

## BLOCKED

Rien à ce stade.

## Limites d'environnement constatées

- **FFmpeg 6.1.1 installé** dans le conteneur (x264, x265, ProRes, DNxHD, AV1,
  VP9, AAC, PCM). Les fixtures média de §101 sont donc générables réellement.
- **Pas de GPU.** WebGPU et le décodage matériel ne sont pas mesurables ici :
  les chiffres de performance de §103 devront être repris sur une vraie machine.
- **Conteneur éphémère.** Tout travail non poussé est perdu : on commite et on
  pousse à chaque étape.
