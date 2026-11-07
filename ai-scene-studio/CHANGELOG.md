# Changelog

Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versionnement [SemVer](https://semver.org/lang/fr/).

## [Non publié]

### Ajouté

- Étape 7.1 : étape Montage, liste de montage (`GET /projects/{id}/edit-list`), pont gozCut (`mode: gozcut_project`,
  `scripts/mac-worker.sh`).
- Étape 7.2 : vrai logiciel de montage dans l'écran Montage, à partir du moteur du NLE web (`packages/nle`, sous les noms
  `@valideo/*`). Le film s'assemble tout seul depuis les plans, les plans sans image gardent leur place (clip d'attente),
  une version retenue remplace le plan dans le montage sans toucher à sa place ni à sa durée, action annulable.
  Outils de montage (lame, ripple, rolling, slip, slide, étirement), annulation, accrochage, raccourcis façon Premiere,
  lecture vidéo et son, images fixes, bande d'images et forme d'onde sur la timeline, galerie « Plans du film », panneaux
  déplaçables, import de musique et de sons conservés avec le projet. Enregistrement automatique sur le serveur
  (`GET/PUT /projects/{id}/edit`, `POST /projects/{id}/edit/media`, migration 0009, assets de type `audio`).
- Étape 7.3 : composition dans le montage. Le moniteur empile toutes les pistes (opacité, modes de fusion, position,
  échelle, rotation, déplacement du calque à la souris). Transitions : fondu enchaîné, au noir, au blanc, volet, poussée ;
  fondus d'entrée et de sortie ; fondu sonore à puissance constante. Titres (texte, police, taille, couleur, bandeau,
  place). Images clés sur l'image et le volume, zoom lent en un clic. Panneaux Réglages, Transitions et titres, Mixage
  (faders de piste, volume général, muet, solo, vumètres réels).
- Plateau gris d'un plan : « Créer la scène 3D » depuis une version. Claude décrit la pièce et une doublure par personnage
  en pixels de l'image graduée ; le serveur en déduit les volumes et la caméra, qui se superposent à l'image. Proposition
  appliquée depuis l'onglet IA de l'éditeur. La vue caméra superpose la version du plan à la 3D (opacité réglable).
- Plateau gris dans l'éditeur : mannequin en un clic (un par personnage de la bible), caméras préréglées (large, plan moyen,
  par-dessus l'épaule, gros plan) et bande pour passer de l'une à l'autre. Bouton « Générer l'image depuis cette caméra »
  (vue de la caméra + fiches du plan), puis « Animer cette image » : coût confirmé avant chaque génération payante.
- Image depuis la caméra en GPT Image 2.5 1K, qualité basse (au plus 3 crédits annoncés, 0,25 constaté). Le mannequin a un
  nez qui montre où regarde le personnage. La vue caméra relit les versions du plan toutes les 8 s : la dernière image
  générée se superpose seule à la 3D.
- Bouton « Vidéo grise » de la vue caméra : le plan est rejoué dans le navigateur (WebGL, temps réel) et téléchargé en
  MP4 (WebM à défaut), sans serveur de rendu. 5 s de plan s'enregistrent en 5 s, contre environ 20 min en Cycles sur
  le serveur. Sert de vidéo de référence de mouvement pour le générateur.
- « Animer avec la vidéo grise » (onglet IA, depuis la caméra) : la vidéo grise est enregistrée, gardée avec le projet,
  puis envoyée avec l'image validée à Genjutsu Lite, Seedance 2.5 ou Kling 4.0 (Higgsfield), qui reprennent le
  mouvement de caméra, les places et le rythme du plateau. Coût confirmé avant chaque envoi ; le devis du site est
  revérifié avant le lancement. Champ `motionVideoAssetId` des générations, contrôle `camera_motion`.
- Mouvements de caméra du plateau (`scene-engine/mouvements.ts`) : travelling avant, arrière, latéral, panoramique,
  grue, orbite, arc avant. En un clic (menu Plateau gris, caméra active, centré sur l'objet sélectionné) ou d'une
  phrase à Claude (opération `camera_move`). Le mouvement part du cadrage actuel et devient des clés de position et
  de rotation : vue caméra, vidéo grise et rendu le jouent à l'identique.

### Modifié

- Éditeur simplifié (maquette validée le 08/11) : à droite, « Faire le plan » en trois étapes (Image, Vidéo, Résultats).
  La vidéo se choisit par une qualité (Essai, Bon, Final) avec son prix ; « Suivre le plateau » enregistre la vidéo grise
  tout seul à l'envoi. Les autres outils IA sont repliés. À gauche : Personnages, Cadrage, Mouvement de caméra, Décor
  (« Construire le décor avec Claude »), formes simples repliées ; la hiérarchie garde un tiers de la hauteur. Vue
  caméra dégagée : réglages sous l'image. Échecs dits en clair (« aucun crédit dépensé »), repliés et effaçables
  (`DELETE /generation-jobs/{id}`).
- Seedance 2.5 : option `resolution` (480p, 720p, 1080p) ; tarif 1080p relevé à 16 crédits par seconde (table du site
  au 07/11/2026, 12 auparavant).

### Corrigé

- Génération : en changeant de modèle, le bouton pouvait partir avec le devis du modèle précédent ; il attend désormais
  le nouveau devis.
- Claude pouvait être coupé à 10 minutes malgré le réglage de 30 minutes.
- Vidéos avec images B (la plupart des H.264) : le moniteur n'affichait qu'une image sur deux environ, désormais toutes
  (décodage en continu en lecture, sans attente : 24 i/s mesurées en 1080p).
- Glisser un plan de la galerie vers la timeline : la dépose était refusée, ou posait le mauvais média.
- Un worker occupé par une longue génération n'est plus vu comme arrêté (signe de vie dans un fil dédié) ; message
  d'indisponibilité explicite.

## [0.7.0] — 2026-11-03 — Phase 6 : studio de production

### Ajouté

- Étapes 6.4–6.5 : la plateforme s'appelle **Chagomi** (logo, titre). Barre latérale persistante sur tout le site
  (logo, profil, recherche ⌘K, étapes de production avec compteurs, projets, repli en rail d'icônes), thème clair ou
  sombre mémorisé, fil d'Ariane, police Plus Jakarta Sans. Plans : grille dense, tableau de suivi, filtres par
  statut, bande des plans (largeur = durée, couleur = statut), lecteur et onglets du plan. Bible : galeries et
  panneau de détail. Workspaces et projets : galeries avec affiche et avancement (`posterAssetId`, `shotCount`,
  `approvedCount`). Connexion et accueil refaits. Éditeur 3D aligné. Étape du studio dans l'adresse (`#shots`…).
- Étapes 6.1–6.2 : scripts versionnés, bible du projet (LOOK, personnages, décors, accessoires, galerie et image clé),
  découpage des plans (description, intention, dialogue, valeur, caméra, mode de fabrication, statut, prompts),
  versions de plans en arbre avec version retenue (migration `0008`) ; Claude endosse la méthode réalisateur /
  chef-op de VALIDEO pour découper le film, établir la bible et écrire les prompts d'un plan ; application des
  propositions au storyboard et à la bible ; générations sans scène 3D, avec les images clés de la bible en
  références ; chaque image / vidéo générée devient une version du plan.
- Étape 6.3 : interface du studio (`/projects/{id}/studio`) — étapes Script, Propositions, Bible, Plans ; éditeur de
  script versionné ; propositions de Claude avec le brouillon des 6 étapes ; bible en cartes ; storyboard par
  séquence ; panneau du plan (versions, arbre, retenir, comparaison A/B, image puis vidéo, prompts écrits par
  Claude, découpage, éléments de bible) ; confirmation du coût exact pour tout moteur payant.

## [0.6.0] — 2026-11-03 — Phase 5 : génération IA depuis la scène

### Ajouté

- Étape 5.1 : socle IA — fournisseurs (simulation, Claude par l'abonnement, passerelle Higgsfield), capacités et
  contraintes indicatives, jobs de génération (migration `0007`), rendu Blender de préparation (images, profondeur,
  normales), estimation et confirmation exacte du coût, worker par fournisseur.
- Étape 5.2 : service `ai-worker` (image Python + FFmpeg + `claude`) et script du worker Higgsfield sur le Mac.
- Étape 5.3 : jetons de design et icônes ; palette de commandes (⌘K, F3) ; notifications avec « Annuler » ; menu
  contextuel de la hiérarchie ; panneaux redimensionnables mémorisés ; infobulles avec raccourcis ; champs
  numériques à expressions et étiquette glissable (une seule annulation par glissé).
- Étape 5.4 : onglet « IA » de l'éditeur — choix du moteur et du modèle avec disponibilité, types de génération
  selon les capacités, prompt et prompt négatif, « Rédiger avec Claude », cadrage par la caméra active (image de
  fin pour la vidéo), format et durée, références reprises des résultats, estimation en direct, **confirmation du
  montant exact** avant toute génération payante, historique avec progression, annulation, images et vidéos,
  prompt réutilisable, propositions de l'assistant de scène appliquées en une étape annulable, critique du rendu.

### Modifié

- L'estimation d'une génération est possible avant le premier enregistrement de la scène (la génération, non).
- Résumé de scène pour Claude et couleurs proposées en sRGB (0–1), converties en linéaire à l'application.

## [0.5.0] — 2026-11-03 — Phase 4 : rendu technique (Blender)

### Ajouté

- Étape 4.1 : portage Python de l'évaluation (animation + contraintes) pour le rendu, vérifié au milliardième près
  contre les références TypeScript ; nouvelle fixture `look-at.v2.json` et sa référence.
- Étape 4.2 : jobs de rendu (migration `0006`) — machine à états identique au contrat TypeScript, file Redis
  fiable, API de lancement / suivi / annulation, idempotence, échec des jobs abandonnés.

- Étapes 4.3–4.4 : rendu Blender — description de scène (`render/prepare.py`), générateur Blender
  (`workers/render-worker/blender/build_scene.py`), worker (`render/worker.py`, `render/runner.py`), image Docker
  Blender 4.5.15 LTS + FFmpeg, service `render-worker` avec quotas ; sorties vidéo, passes EXR, aperçu et `.blend`
  publiées comme assets.

- Étape 4.5 : tests de cohérence avec de vrais rendus Blender (axes, cadrage et focales, orthographique,
  hiérarchie et rotations, timing et interpolation, GLB, courbes évaluées par Blender) ; rendu réel de bout en bout
  en CI.

- Étape 4.6 : éditeur — onglet « Rendu » (réglages de la scène et du rendu, passes, lancement après enregistrement,
  suivi, annulation, lecture de la vidéo, téléchargements EXR / .blend / ProRes / aperçu) ; **raccourcis façon
  Blender** par défaut (G/R/S + X/Y/Z, Maj+A, Maj+D, X, H/Maj+H/Alt+H, A/Alt+A, Ctrl+P/Alt+P, Alt+G/R/S, I/Alt+I,
  pavé numérique 1/3/7/5/0/., Espace, flèches) avec choix « standard » et aide intégrée.

### Modifié

- Bézier : correction des poignées trop longues alignée sur Blender (réduction proportionnelle), dans les deux
  moteurs (TypeScript et Python).

## [0.4.0] — 2026-11-03 — Phase 3 : caméras et animation

### Ajouté

- Étape 3.1 : `@ass/animation-engine` — évaluation déterministe (interpolations, slerp, extrapolations) et
  édition pure des clés ; référence de déterminisme.
- Étape 3.2 : format de scène **v2** (caméra active, marqueurs, verrouillage, visée et roulis des caméras) avec
  migration v1 → v2 et fixtures avant/après ; validation serveur à jour ; `evaluateFrame` (animation + contraintes) ;
  mouvements de caméra (dolly, truck, pedestal, pan, tilt, orbite).

- Étapes 3.3–3.4 : éditeur — affichage de la scène évaluée à la frame courante, clé automatique des propriétés
  animées, clés de transformation / visibilité / focale / ouverture / intensité, caméra active, visée et roulis,
  mouvements de caméra, vue caméra (capteur et focale physiques, format de rendu) et vue double, trajectoire de
  l'élément sélectionné ; timeline (lecture, pause, stop, pas à pas, boucle, règle de navigation, marqueurs, pistes
  repliables, zoom, sélection multiple, déplacement, interpolation, copier-coller et suppression de clés) ; raccourcis
  Espace, ←/→, Origine/Fin, K, ⌘C/⌘V.

### Modifié

- JSON Schema renommé `scene.schema.json` (version courante, identifiée par son `$id`).

## [0.3.0] — 2026-11-03 — Phase 2 : scène 3D éditable et persistante

### Ajouté

- Étape 2.1 : validation serveur des scènes (structure par JSON Schema embarqué, norme des quaternions, intégrité
  identique à TypeScript), cas invalides partagés TypeScript/Python, sérialisation canonique pour l'empreinte.
- Étape 2.2 : scènes et révisions immuables (migration `0004`), stockage S3 adressé par contenu, concurrence
  optimiste (`409`), historique, lecture d'une révision ; module `core/storage.py`.
- Étape 2.3 : assets GLB (migration `0005`) — envoi validé, déduplication, liste, métadonnées, contenu servi en
  flux ; plafond global des corps de requête ; contrôle des assets référencés par une scène ; fixture `cube.glb`.
- Étape 2.4 : `@ass/scene-engine` — fabriques d'objets, opérations d'édition pures, conversions Three.js.
- Étape 2.5 : `@ass/editor-ui` — store de l'éditeur (sélection, outils, magnétisme, annuler/rétablir, gestes).
- Étape 2.6 : éditeur 3D `/shots/[id]/editor` — viewport (orbite, pan, zoom, perspective/orthographique, vues
  prédéfinies, grille, axes, cadrage), primitives, empty, groupe, caméras, lumières, import GLB, sélection (clic,
  multiple, rectangle), gizmos déplacement/rotation/échelle avec magnétisme, hiérarchie (recherche, renommage,
  masquage, verrouillage), inspecteur (transformations numériques, parent, couleur, caméra, lumière), duplication,
  groupement, suppression, raccourcis clavier, enregistrement en révision et rechargement.

## [0.2.0] — 2026-11-03 — Phase 1 : projets persistants

### Ajouté

- Étape 1.1 : modèle de données (`users`, `workspaces`, `workspace_members`, `projects`, `sequences`, `shots`)
  et migration Alembic `0001`, avec tests unitaires et tests d'intégration PostgreSQL (aller-retour des
  migrations, `alembic check`, contraintes, cascades, réordonnancement).
- `CLAUDE.md` : conventions, commandes et règles de contribution (prévu par le cahier des charges, absent de la phase 0).

- Étape 1.2 : authentification — `POST /auth/login`, `GET /auth/session`, `POST /auth/logout` ; Argon2id,
  sessions en base (empreinte du jeton) et cookie `HttpOnly`/`SameSite=Lax`/`Secure`, jeton CSRF,
  limitation des échecs dans Redis, migration `0002` (`user_sessions`), commande `create-user`.

- Étape 1.3 : autorisation par workspace (rôles `viewer` < `editor` < `admin` < `owner`, `404` hors
  workspace, `403` rôle insuffisant), routes `/workspaces` (création, liste paginée par curseur, lecture,
  renommage, suppression).

- Étape 1.4 : membres (liste, rôle, retrait, départ), invitations à usage unique (création, liste, révocation,
  consultation et acceptation avec création de compte), CRUD des projets, séquences et plans avec insertion à
  une position, réordonnancement complet et recompactage à la suppression ; migration `0003`.

- Étape 1.5 : `@ass/api-client` — contrat OpenAPI versionné, types générés (openapi-typescript), client typé
  (openapi-fetch) gérant cookie et jeton CSRF ; commandes `export-openapi` et `pnpm api:generate` ; tests de dérive
  Python et TypeScript ; erreurs documentées en « problem details » dans l'OpenAPI.

- Étape 1.6 : interface web — connexion (retour sûr vers la page demandée), workspaces (création, liste
  paginée, renommage, suppression), membres et invitations (rôles, retrait, lien d'invitation, révocation),
  acceptation d'invitation avec création de compte, projets (création avec cadence et résolution, description,
  suppression), séquences et plans (création, renommage, ordre, suppression, durée affichée) ; E2E du parcours
  complet contre la vraie pile ; compte E2E créé en CI.

### Modifié

- Image web : copie du manifeste de `@ass/api-client`.
- `@ass/shared-types` réexporte les entités de la phase 1 depuis `@ass/api-client`.
- Rôles et espaces colorimétriques typés en énumérations dans l'OpenAPI.
- `pnpm test` exécute les packages l'un après l'autre (le cache Vitest partagé échouait en parallèle).
- Les erreurs HTTP conservent les en-têtes de l'exception (`Retry-After`…).
- `infrastructure/migrations/env.py` : enregistre les modèles et accepte une URL de base fournie par les tests.

## [0.1.0] — 2026-11-02 — Phase 0 : audit et initialisation

### Ajouté

- Monorepo `ai-scene-studio/` : pnpm (TypeScript strict, ESLint, Prettier, Vitest) et uv (ruff, mypy, pytest).
- `@ass/scene-schema` : format canonique de scène v1 (Zod), validation d'intégrité, migrations, JSON Schema, fixtures.
- `@ass/shared-types` : contrats des entités, machine à états des jobs, enveloppe d'erreur.
- `@ass/generation-sdk` : contrat `ProviderAdapter`, appariement des capacités.
- `apps/api` : FastAPI, configuration sécurisée, logs structurés, `/health/live` et `/health/ready`, Alembic.
- `apps/web` : Next.js 16, état des services, tests Vitest/RTL et Playwright.
- Docker Compose (PostgreSQL, Redis, SeaweedFS S3, migrations, API, web, nginx), Dockerfiles non-root.
- CI GitHub Actions, scripts `check-env.sh` et `check-all.sh`, documentation complète.
