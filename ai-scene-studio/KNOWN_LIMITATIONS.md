# Limites connues

## Fonctionnelles (phase 1)

- Interface volontairement sobre : connexion, workspaces, membres et invitations, projets, séquences et plans
  (création, renommage des séquences, ordre par boutons ↑/↓, suppression). Non exposés à l'écran bien que
  disponibles dans l'API : modification de la cadence et de la résolution d'un projet, de la durée et de la
  cadence propre d'un plan, insertion à une position donnée. Pas de glisser-déposer.
- Pas encore de règles ESLint spécifiques à Next.js et React (`@next/eslint-plugin-next`, `react-hooks`).
- Pas d'inscription publique ni de réinitialisation de mot de passe : premier compte en ligne de commande,
  les suivants par invitation. **Aucun e-mail n'est envoyé** : l'admin reçoit le lien et le transmet lui-même ;
  il pourrait donc l'utiliser à la place de l'invité pour une adresse sans compte (le lien ne donne jamais accès
  à un compte existant).
- Éditeur 3D (phase 2) : le gizmo agit sur l'élément principal de la sélection (pas de transformation groupée) ;
  masquer un objet masque aussi ses enfants dans la vue ; la sélection rectangle retient les objets dont le centre
  est dans le rectangle ; le parentage se fait depuis l'inspecteur (pas de glisser-déposer dans la hiérarchie) ;
  raccourcis non configurables ; les animations contenues dans un GLB ne sont pas jouées ;
  les icônes des caméras et des lumières sont des repères simplifiés ; pas encore de vue depuis une caméra de la
  L'éclairage d'aperçu de l'éditeur n'appartient pas à la scène. WebGL 2 est requis.
- Animation et caméras (phase 3) : pas d'éditeur de courbes (les poignées de Bézier ne se règlent pas à l'écran ; sans
  poignée, une clé Bézier donne un segment rectiligne) ; sélection de clés au clic (pas de rectangle) ; la contrainte
  « suivre une cible » n'est pas implémentée (seule la visée l'est) ; profondeur de champ non prévisualisée (les
  paramètres sont enregistrés pour le rendu) ; la lecture temps réel peut sauter des frames si le navigateur est lent
  (chaque image affichée reste une frame exacte) ; la vue caméra n'affiche pas encore de guides de cadrage.
- Assets : seuls les GLB sont acceptés (pas encore de glTF à fichiers séparés, textures, HDRI, USD/FBX) ; l'envoi
  transite par l'API (100 Mo maximum) au lieu d'un upload multipart direct vers le stockage avec reprise ; pas de
  miniatures, de tags ni de suppression d'asset ; les objets orphelins du stockage ne sont pas encore nettoyés.
- Un plan ne peut pas encore être déplacé d'une séquence à une autre ; la propriété d'un workspace ne peut pas
  être transférée.
- Les sessions expirées sont supprimées quand elles sont présentées ; une purge périodique viendra avec les
  workers (phase 4). La limite d'échecs par e-mail permet à un tiers de bloquer temporairement un compte
  (compromis classique, fenêtre de 15 minutes).
- Pas d'éditeur, d'animation, de rendu ni de génération IA. L'interface web se limite à l'état des services.
- `packages/scene-engine`, `animation-engine`, `editor-ui` et `workers/*` ne contiennent qu'une description de leur rôle.
- Les types de `shared-types` décrivent la forme cible des entités ; ils seront générés depuis l'OpenAPI en phase 1.

- Génération IA (phase 5) : Claude ne génère ni image ni vidéo (prompt, assistant de scène, critique) ; Higgsfield
  passe par une **passerelle navigateur non officielle** (Chrome du Mac ouvert sur higgsfield.ai, worker lancé sur
  le Mac) : elle dépend de l'interface du site et peut casser sans préavis ; GPT Image 2.5 et Seedance 2.5 ne
  reçoivent ni la profondeur ni les normales (contrôle seulement indicatif, signalé à l'estimation) ; pas encore
  de sélection de références dans la bibliothèque d'assets (on reprend en référence une image générée) ; suivi par
  interrogation ; l'assistant de scène ignore les opérations impossibles en les signalant. Le premier test réel
  Higgsfield (payant) attend le GO de l'utilisateur.
- Ergonomie (phase 5) : palette, menus contextuels, notifications et panneaux redimensionnables couvrent l'éditeur ;
  raccourcis toujours non configurables ; pas de glisser-déposer dans la hiérarchie ; inspecteur et timeline gardent
  leur présentation de la phase 3 (refonte prévue avec le montage, phase 7).

- Studio (phase 6) : pas d'import d'images de référence depuis le disque (seulement les images générées) ; le
  découpage s'applique à la suite des séquences existantes (pas de fusion ni de remplacement) ; une proposition ne
  s'applique qu'une fois ; pas de réordonnancement des plans par glisser-déposer dans le storyboard ; liens entre plans
  et bible établis par les noms (rapprochement tolérant, aucun lien en cas d'ambiguïté) ; un découpage par Claude
  Opus prend quelques minutes (suivi par interrogation) ; la bande en bas de l'écran Plans est un aperçu, le montage est dans l'écran Montage.

- Montage (étapes 7.2 et 7.3) : pas d'export du film ni de XML Premiere (7.4) ; pas de moniteur source. Transitions :
  un plan dont le média s'arrête se fige pendant le débord du fondu (images IA utilisées en entier) ; un montage qui
  sépare deux clips retire leur transition. Modes de fusion, titres et images clés ne s'appliquent qu'au moniteur tant que
  l'export n'existe pas. Pas d'effets ni d'étalonnage, images clés en interpolation linéaire seulement, pas de mesure de
  loudness (niveaux de crête seulement). Le panoramique animé n'est lu qu'au début de chaque tranche de lecture. La lecture passe par WebCodecs, essayée dans Chrome seulement ; le H.264 n'est pas décodé par le
  Chromium de Playwright, et seuls les fichiers MP4/MOV sont lus image par image. Le son d'une vidéo est décodé
  entièrement en mémoire (au-delà de 256 Mo décodés : forme d'onde, pas de lecture). Les médias sont retéléchargés à
  chaque ouverture de l'onglet (cache du navigateur). Le rôle viewer peut manipuler le montage dans son onglet, rien
  n'est enregistré. Deux onglets : le second reçoit un refus (409) et doit recharger la page. Un plan nouveau s'insère
  après le plan qui le précède et décale les pistes synchronisées ; un plan supprimé du storyboard reste dans le montage.
  L'historique d'annulation ne survit pas à un rechargement. ⌘K coupe sous la tête dans cet écran : la palette s'ouvre
  au clic sur « Rechercher » ou avec F3.

## Techniques

- **MinIO remplacé par SeaweedFS** en local : les images MinIO ne sont plus distribuées publiquement. Seule l'API S3
  standard est utilisée ; un autre stockage compatible S3 peut être branché par configuration.
- **Rendu Blender** (phase 4) : Blender 4.5 LTS, Cycles sur **CPU** (pas de GPU dans le conteneur), sans débruitage
  (déterminisme). Binaire x86-64 uniquement : émulé sur Apple Silicon. L'éclairage d'aperçu (scène sans lumière) et
  l'ambiance du monde sont une approximation de l'éditeur, pas une identité. `receiveShadow` et la portée des lumières
  n'ont pas d'équivalent Cycles (ignorés). Les rotations animées et les caméras contraintes sont échantillonnées par
  frame dans le `.blend` (les autres propriétés y sont des courbes natives éditables) ; les objets restent sous une
  racine de conversion Y-up → Z-up, donc Blender affiche des valeurs locales canoniques. Pas de rendu distribué ni de
  reprise d'un rendu interrompu (relancer crée un nouveau job). Le suivi se fait par interrogation (pas encore de SSE).
- Le fichier `.blend` produit par Blender 4.5 s'ouvre dans Blender 4.5 ou plus récent ; les versions plus anciennes
  (par exemple 3.5) peuvent le lire incomplètement.
- **Identité pixel** : aucune identité n'est garantie entre la preview Three.js et le rendu Blender ; les
  transformations, le cadrage, les focales, la projection orthographique, la hiérarchie et le timing sont vérifiés par
  des rendus réels (écart < 1 pixel), pas les matériaux ni l'éclairage.
- **Génération IA** : un générateur probabiliste ne garantit pas la fidélité géométrique ; un seed identique ne
  garantit pas la reproductibilité chez un fournisseur distant.
