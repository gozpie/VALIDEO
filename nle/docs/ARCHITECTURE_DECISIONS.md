# Décisions d'architecture (ADR)

Chaque décision structurante est consignée ici avec son contexte et ses
conséquences. Une décision n'est pas révisée pour suivre une mode technique
(§1001) mais seulement si son contexte change.

---

## ADR-001 — Le NLE vit dans `nle/`, l'application VALIDEO existante n'est pas touchée

**Contexte.** Le dépôt contient déjà VALIDEO, une application PHP/MySQL de
validation client (commentaires horodatés, annotations SVG). Le cahier des
charges décrit un produit différent : un NLE web.

**Décision.** Le NLE est un monorepo autonome dans `nle/`. Aucun fichier PHP
existant n'est modifié.

**Conséquences.** Les deux produits évoluent séparément. Une passerelle
(ouvrir une séquence NLE depuis une vidéo VALIDEO) reste possible plus tard,
via une frontière explicite. Décision réversible à coût nul.

---

## ADR-002 — Le temps est rationnel et entier, jamais flottant

**Contexte.** §12 l'exige. 23.976 n'existe pas : c'est 24000/1001. Accumuler
`1/23.976` en `number` dérive de plusieurs images sur une timeline longue.

**Décision.** Trois niveaux :

1. `Rational` — fraction exacte `n/d`, normalisée, arithmétique entière. Bascule
   sur `bigint` quand un produit intermédiaire déborde ; **lève** plutôt que de
   retourner un résultat faux.
2. `TimeBase` — cadence rationnelle + mode `NDF`/`DF`.
3. `RationalTime` — **entier d'images** rattaché à une timebase. C'est l'unité
   de travail de tout le moteur.

Les secondes ne servent qu'aux frontières (audio, export, affichage) et sont
alors calculées en rationnel exact, jamais accumulées.

**Conséquences.** Additionner deux temps de timebases différentes **lève une
erreur** ; il faut appeler `rescale()` explicitement. C'est volontairement
pénible : c'est la classe de bug qui désynchronise un montage.

---

## ADR-003 — Le drop-frame est un étiquetage, pas une durée

**Contexte.** Confusion classique : croire que le DF « saute des images ».

**Décision.** `rescale()` ignore le mode DF/NDF. 100 images en 29.97 DF valent
exactement 100 images en 29.97 NDF. Seuls `formatTimecode`/`parseTimecode`
connaissent le drop-frame.

**Conséquences.** `parseTimecode('00:01:00;00', DF)` **lève** : cette étiquette
n'existe pas. Le moteur ne peut pas produire silencieusement un timecode
impossible.

**Fait de métier consigné.** Aucun nombre entier d'images à 30000/1001 ne vaut
exactement une heure (3600 × 30000/1001 = 107892,107…). Le DF ramène
l'étiquette `01:00:00;00` sur 107892 images, qui durent 3599,9964 s : il reste
**3,6 ms d'erreur par heure**. À 44,1 kHz cela fait 159 échantillons — un
moteur qui supposerait 3600 s désynchroniserait l'audio. Test :
`rational-time.test.ts`.

---

## ADR-004 — Unité de ticks interne exacte, distincte de celle d'Adobe

**Contexte.** Adobe utilise 254 016 000 000 ticks/seconde. Cette valeur se
factorise en 2¹⁰ × 3⁴ × 5⁶ × 7² : divisible par 24, 25, 30, 48, 50, 60, 100,
120 — mais **pas par 1001** (= 7 × 11 × 13, il manque 11 et 13). L'unité
d'Adobe n'est donc pas exacte sur les cadences NTSC.

**Décision.** L'unité interne est celle d'Adobe × 143 (= 11 × 13), soit
36 324 288 000 000 ticks/seconde : divisible par 1001 et par toutes les
cadences entières. `ADOBE_TICKS_PER_SECOND` reste exporté pour l'interchange
Adobe, où l'arrondi est alors assumé et documenté.

**Conséquences.** API en `bigint` (une heure ≈ 1,3 × 10¹⁷ ticks, hors entiers
sûrs de JS). Les ticks servent **uniquement** aux frontières d'import/export
(AAF, FCPXML, OTIO) ; le moteur travaille en images entières.

---

## ADR-005 — L'image `n` couvre `[n/rate, (n+1)/rate[`, on échantillonne au centre

**Contexte.** Convertir une source 50 fps vers une timeline 25 fps en
échantillonnant sur la frontière d'image expose aux erreurs d'arrondi de bord.

**Décision.** Convention semi-ouverte, et `sourceFrameAt()` échantillonne au
**centre** de l'image de destination.

**Conséquences.** À cadences identiques, l'image `n` donne exactement l'image
`n` (testé sur 500 images en 25 et en 23.976). Pas de décalage d'une image aux
raccords.

---

## ADR-006 — Le point de sortie source n'est pas stocké, il est dérivé

**Contexte.** §71 liste `sourceIn` **et** `sourceOut` dans le modèle de clip.
Or un clip porte aussi `duration` (sur la timeline) et `speed`. Les quatre
valeurs sont liées : `sourceOut = sourceIn + duration × speed` (aux conversions
de cadence près).

**Décision.** On stocke `start`, `duration`, `sourceIn` et `speed`.
`sourceOut` est **dérivé**, jamais stocké.

**Conséquences.** Une redondance dans un modèle de données est une source de
bugs : au premier *trim* ou changement de vitesse qui oublie de mettre à jour
l'une des deux valeurs, le clip devient incohérent d'une manière que rien ne
détecte. En dérivant, l'incohérence est structurellement impossible.

C'est un écart assumé par rapport à la lettre de §71, pas à son intention.

---

## ADR-007 — Un refus de montage est un `Result`, un invariant cassé est une exception

**Contexte.** Deux familles d'échec très différentes se ressemblent en JS.

**Décision.**

- Contrainte métier violée (piste verrouillée, média hors ligne, chevauchement
  interdit) → `Err(AppError)`, avec code, message utilisateur, action proposée
  et détail technique (§106). C'est une issue **normale**.
- Incohérence interne (identifiant inconnu, invariant cassé) → **exception**
  `InvariantError`. C'est un **bug**.

**Conséquences.** Aucun `try/catch` fourre-tout n'avale les vrais bugs en même
temps que les refus légitimes. L'interface sait quoi afficher sans deviner.

---

## ADR-008 — zod uniquement à la frontière

**Contexte.** Le moteur doit être rapide ; la validation ne doit pas s'inviter
dans les chemins chauds.

**Décision.** zod est une dépendance de `project-model` **seulement**, et n'est
appelé qu'au chargement et à l'enregistrement d'un document. `time-core`,
`shared` et le futur `timeline-model` restent sans dépendance.

**Conséquences.** Tout ce qui franchit la frontière est ensuite considéré comme
structurellement sain : le moteur ne revalide pas à chaque image.

---

## ADR-009 — Une commande est une fonction pure, l'annulation reprend l'état précédent

**Contexte.** Le command pattern classique demande d'écrire, pour chaque
opération, sa fonction inverse. Pour un *ripple delete* qui touche plusieurs
pistes, découpe des clips et décale le reste du montage, cette inverse est
presque impossible à garder juste dans le temps.

**Décision.** Une commande est une fonction **pure** `état → état`, et
l'historique conserve les deux états. Annuler = reprendre l'état d'avant.

**Conséquences.** Aucune logique inverse à écrire ni à maintenir : l'undo est
correct par construction, y compris pour les opérations composées. Le coût
mémoire reste faible grâce au partage de structure — une entrée ne duplique que
le chemin réellement modifié, ce qui est vérifié par un test dédié (§57).

---

## ADR-010 — Tout geste continu porte une clé de fusion

**Contexte.** Un glisser-déposer produit des dizaines de commandes par seconde.
Sans traitement, l'historique devient inutilisable et « annuler » ne recule que
d'une image.

**Décision.** Chaque commande porte une `mergeKey` optionnelle. Deux commandes
consécutives de même clé, rapprochées dans le temps, fusionnent en une seule
entrée qui conserve l'état d'**avant le début du geste**.

**Conséquences.** Un déplacement de 60 étapes = une entrée d'historique, et
annuler ramène au point de départ du geste. Vérifié par test.

---

## ADR-011 — Toute opération de montage repasse par une vérification d'invariants

**Contexte.** Les invariants d'une piste (clips triés, sans chevauchement, de
durée ≥ 1) sont ce qui permet la recherche dichotomique, donc la fluidité sur
10 000 clips (§55). Un chevauchement introduit silencieusement ne se manifeste
que bien plus tard, au rendu ou à l'export, quand son origine est devenue
introuvable.

**Décision.** Chaque opération se termine par `finalize()`, qui revérifie les
invariants de toute la séquence. Une opération qui les violerait est **refusée**
et l'état d'origine est conservé.

**Conséquences.** Coût O(n) par opération de montage — négligeable, ces
opérations ne sont pas dans un chemin par image. En échange, un état incohérent
est structurellement impossible. Un *fuzz* de 5 600 opérations aléatoires le
confirme.

---

## ADR-012 — Un trim se borne aux poignées, une commande de durée se refuse

**Contexte.** Deux cas qui semblent proches : l'utilisateur tire un bord à la
souris, ou il saisit une durée précise.

**Décision.**

- **Geste interactif** (trim, roll, slip, slide) : borné à ce que la source rend
  possible. On ne refuse pas un trim trop long, on s'arrête à la dernière image
  disponible. C'est le comportement attendu d'un NLE.
- **Commande de valeur** (rate stretch vers une durée donnée) : **refusée** si
  elle écraserait un voisin. Raboter en silence une valeur explicitement
  demandée serait un mensonge.

**Conséquences.** L'outil interactif borne le geste avant d'appeler la commande ;
la commande reste stricte.

---

## ADR-013 — Les clips utilisent une dichotomie, pas un *interval tree*

**Contexte.** §55 suggère un *interval tree* pour l'index spatial de la timeline.

**Décision.** Les clips d'une piste sont **triés et sans chevauchement** — c'est
un invariant garanti par `timeline-model`. Sur des intervalles disjoints triés,
une recherche dichotomique est déjà optimale : O(log n + k). Un *interval tree*
n'apporterait rien et coûterait une structure à maintenir à chaque montage.

Un *interval tree* reste pertinent pour les ensembles réellement chevauchants
(marqueurs à durée, transitions superposées) ; il sera introduit là, quand ces
objets existeront, et pas avant.

**Conséquences.** Mesuré : 0,001 ms pour interroger une piste de 100 000 clips,
au début comme à la fin.

---

## ADR-014 — Le moteur de timeline ignore React et Canvas

**Contexte.** §2 interdit une timeline faite de composants React re-rendus à
chaque image.

**Décision.** `timeline-engine` transforme (séquence, viewport) en une **liste
plate** d'éléments à dessiner. Aucun import d'interface, aucun DOM.

**Conséquences.** Le module est testable sans navigateur, mesurable en isolation,
et peut tourner dans un Worker. Le rendu Canvas qui le consommera n'aura qu'à
parcourir la liste ; changer de technologie d'affichage ne touchera pas à cette
logique.

---

## ADR-015 — Les flottants sont autorisés dans le viewport, et nulle part ailleurs

**Contexte.** ADR-002 interdit les flottants pour le temps.

**Décision.** Le viewport manipule des pixels et une échelle en `number`
flottant. C'est légitime : il s'agit de position à l'écran, pas de temps de
montage. **Toute frontière vers le modèle repasse par des images entières**
(`xToTime` tronque explicitement).

**Conséquences.** Le zoom et le défilement restent lisses (pas de crantage), et
aucune imprécision de sous-pixel ne peut contaminer une position de montage.

---

## ADR-016 — La cadence déclarée fait foi ; la mesure sert à détecter la variabilité

**Contexte.** §13 exige de ne pas supposer que l'image *n* est à l'instant
*n*/cadence. Première tentative : reconstruire la cadence depuis les
horodatages mesurés.

**Décision.** La cadence **déclarée** par le conteneur est retenue quand le
média est à cadence constante. La mesure des horodatages sert uniquement à
**détecter** la variabilité, et à fournir une cadence moyenne quand le média est
effectivement variable.

**Pourquoi.** Les horodatages sont quantifiés sur la base de temps du
conteneur. Reconstruire 23.976 depuis ces valeurs donne `12250000/10427` — une
fraction absurde — alors que le conteneur déclare exactement `24000/1001`.
Mesurer est indispensable pour *détecter*, désastreux pour *remplacer*.

---

## ADR-017 — Les horodatages sont triés avant toute mesure

**Contexte.** Un démultiplexeur restitue les images dans l'ordre de **décodage**,
pas d'affichage. Avec des images B, la suite saute : …0,40 ; 0,48 ; puis 0,44.

**Décision.** `analyzeTimestamps` trie la liste avant de calculer les écarts.

**Conséquences.** Le simple désordre n'est plus un signal — il est normal. En
revanche, deux images portant le **même** horodatage restent signalées : ça,
c'est réellement suspect.

Sans ce tri, tout fichier encodé avec des images B — c'est-à-dire la quasi-
totalité des H.264 — était déclaré à cadence variable.

---

## ADR-018 — L'analyse média est pure, l'exécution de processus est isolée

**Contexte.** L'analyse doit être testable sans FFmpeg installé, tout en étant
vérifiée sur de vrais fichiers.

**Décision.** `@valideo/media-engine` ne lance aucun processus et ne touche pas
au disque : il transforme une sortie ffprobe en `MediaAssetDoc`.
`apps/media-worker` est le **seul** module qui exécute ffprobe.

**Conséquences.** Deux niveaux de test complémentaires : unitaires purs sur des
sorties construites à la main, et d'intégration sur des fichiers réellement
encodés. Quand FFmpeg manque, les seconds sont ignorés **avec un message
explicite** — jamais silencieusement réussis (§1003).

---

## ADR-019 — Les raccourcis suivent la position physique des touches

**Contexte.** Sur un clavier AZERTY, la touche à la position du `Q` américain
produit « a ». Un raccourci défini sur le caractère se déplace donc sous les
doigts selon la disposition.

**Décision.** Le moteur travaille sur `KeyboardEvent.code` (position physique),
jamais sur `key`.

**Conséquences.** Un monteur retrouve ses raccourcis à la même place quelle que
soit sa disposition clavier — c'est ce que font les NLE de métier. L'affichage,
lui, reste localisé (`Maj`, `Échap`, `←`).

---

## ADR-020 — JKL tient dans un seul entier signé

**Contexte.** Le comportement attendu de J/K/L est riche : paliers de vitesse,
la touche opposée qui ralentit, passage par l'arrêt avant inversion, ralenti
avec K maintenu. Une implémentation à coups de conditions devient vite fausse.

**Décision.** Un entier `step` : 0 = arrêt, positif = avant au palier
`ladder[step-1]`, négatif = arrière. L incrémente, J décrémente, K remet à zéro.

**Conséquences.** Tout le comportement en découle sans cas particulier. Depuis
3×, J donne 2× (ralentit), puis 1×, puis 0 (arrêt), puis −1× (inversion) — ce
que fait un NLE professionnel, obtenu gratuitement.

---

## ADR-021 — Une pyramide de pics se construit niveau par niveau

**Contexte.** §19 demande plusieurs niveaux de pics et interdit tout recalcul
pendant le zoom. Construire chaque niveau depuis les échantillons d'origine
coûterait *n* × nombre de niveaux.

**Décision.** Seul le niveau le plus fin parcourt les échantillons ; chaque
niveau suivant est construit depuis le précédent. Chaque case retient min, max
et RMS, en entiers 16 bits.

**Conséquences.** Construction linéaire. La pyramide complète pèse 3,1 % de
l'audio (20,6 Mio pour une heure de mono à 48 kHz). Le zoom se contente de
choisir un niveau.

**Limite assumée.** Au zoom maximal de la timeline, un pixel couvre moins
d'échantillons qu'une case du niveau le plus fin : la forme d'onde y devient
légèrement escalierée. C'est là que le rendu devra lire l'audio conformé
directement. Descendre la taille de case doublerait le coût mémoire pour un gain
visible dans un seul cas de zoom.

---

## ADR-022 — La stratégie de lecture ne dit jamais « non pris en charge »

**Contexte.** §60 l'interdit explicitement quand le serveur peut résoudre le
problème.

**Décision.** `decidePlayback` renvoie une **stratégie** — `direct`, `proxy`,
`transcode` — et non un verdict. `unavailable` est réservé au seul cas où rien
ne peut être fait : le média est hors ligne.

**Conséquences.** Un ProRes n'est pas « non supporté » : il demande un proxy, et
la réponse porte la raison en clair, prête à être affichée.

---

## ADR-023 — Pendant un geste, React ne rend rien

**Contexte.** §2 interdit un rerender React massif pendant un déplacement, et
fixe l'objectif de 60 images par seconde.

**Décision.** Un geste (déplacement, trim, scrub, rectangle de sélection) vit
dans une `ref` mutable. Le canvas est redessiné directement à chaque mouvement
de pointeur. React n'est sollicité **qu'au relâchement**, pour appliquer la
commande.

**Conséquences.** Le coût par image est celui de `dessinerTimeline` — mesuré à
0,1–0,28 ms sur 10 000 clips — et non celui d'un arbre de composants. Les états
provisoires ne polluent ni l'historique ni le document.

---

## ADR-024 — Les moniteurs restent vides tant que la lecture n'existe pas

**Contexte.** Un moniteur vide « fait inachevé ». La tentation est d'y mettre une
mire, une image fixe, ou des boutons de transport.

**Décision.** Les deux moniteurs affichent un texte qui dit ce qui manque et
pourquoi. Aucun bouton de transport qui ne transporte rien. Aucune forme d'onde
dessinée tant qu'aucun média n'est analysé.

**Conséquences.** §1003 respectée à la lettre. Le corollaire vaut aussi pour les
boutons d'en-tête de piste : ils étaient inertes à la première version, ce qui
en faisait de faux boutons — ils passent maintenant par de vraies commandes
annulables.

---

## ADR-025 — La règle « pas d'arrondi flottant » ne s'applique qu'au moteur

**Contexte.** Le lint interdit `Math.round` pour protéger les calculs temporels
(§12). Appliquée partout, la règle criait dans la couche d'affichage, où l'on
aligne des pixels et où l'on convertit un geste de souris en images.

**Décision.** La règle est restreinte à `packages/**`. La couche d'affichage en
est exemptée, conformément à ADR-015 : les pixels sont des flottants légitimes,
et la frontière vers le modèle passe par des images entières.

**Conséquences.** La règle garde tout son mordant là où elle protège quelque
chose, sans pousser à la contourner par des exceptions locales — ce qui l'aurait
vidée de son sens.

---

## ADR-026 — L'interface de stockage tient en quatre opérations

**Contexte.** §62 et §63 exigent que le moteur ne dépende d'aucun fournisseur :
disque local, OPFS, S3, R2, NAS.

**Décision.** `StorageProvider` expose **lire, écrire, supprimer, lister**. Rien
de plus.

**Conséquences.** Tout fournisseur imaginable sait faire ces quatre choses ; en
demander plus (transactions, verrous, métadonnées riches) exclurait des cibles.
Les mécanismes de plus haut niveau — instantanés, reprise, rotation — sont
construits **au-dessus**, dans `ProjectStore`, et fonctionnent donc à
l'identique sur les trois implémentations.

---

## ADR-027 — L'autosave n'écrase jamais l'enregistrement explicite

**Contexte.** Un autosave qui écrit par-dessus le fichier du projet peut
enregistrer une modification que l'utilisateur regrettait, et détruire un état
qu'il avait volontairement figé.

**Décision.** Deux fichiers distincts : `projet.json` (explicite) et
`auto.json` (automatique). Le chargement normal lit toujours `projet.json`.

**Conséquences.** La reprise après incident devient une simple comparaison de
dates : si `auto.json` est plus récent, une session s'est interrompue. On la
**propose**, sans jamais écraser d'office.

---

## ADR-028 — Un échec de chargement doit se voir

**Contexte.** La première version ignorait silencieusement une erreur de lecture
et repartait du document par défaut.

**Décision.** Toute erreur de chargement ou de reprise remonte dans l'interface
avec son message et son détail technique (§106).

**Conséquences.** C'est précisément cette remontée qui a permis de diagnostiquer
deux autres bugs — un identifiant instable et des marqueurs non conformes au
schéma. Une erreur avalée n'est pas une erreur évitée : c'est une erreur qu'on
ne trouvera qu'après avoir perdu du travail.

---

## ADR-029 — L'éditeur n'apparaît qu'une fois le stockage interrogé

**Contexte.** Le chargement est asynchrone. Afficher le document par défaut en
attendant fait clignoter un projet qui n'est pas celui de l'utilisateur.

**Décision.** Tant que la persistance n'a pas répondu, l'application affiche
« Ouverture du projet… » et rien d'autre.

**Conséquences.** Plus de clignotement, et — effet secondaire utile — les tests
de bout en bout deviennent déterministes : ils n'ont plus de fenêtre pendant
laquelle ils liraient l'ancien document.
