# VALIDEO

VALIDEO est une application web PHP/JavaScript de **gestion de vidéos** et de **validation client**. Elle permet de centraliser des vidéos par client/projet, de les lire via un lecteur personnalisé, puis d’ajouter des **commentaires horodatés** et des **annotations graphiques** directement sur la timeline pour faciliter la relecture et les retours.

Le cœur du projet s’appuie sur une base MySQL et une arborescence de fichiers `uploads/<client>/<projet>/<video>` pour stocker les médias, tandis que les métadonnées (clients, projets, vidéos, commentaires, dessins) sont gérées en base.

## Fonctionnalités principales

### 1) Interface de visualisation / administration
- Organisation des vidéos par **client** et **projet**.
- Visualisation des vidéos avec miniatures et actions rapides (télécharger, partager, supprimer).
- Suppression en cascade (vidéo, projet, client) et nettoyage du stockage `uploads/`.

### 2) Page de validation client
- Lecteur vidéo custom (lecture/pause, volume, plein écran, pas-à-pas image, timecode au FPS).
- Ajout de **commentaires** à un timecode précis (marqueurs sur la timeline).
- **Dessins/annotations** au-dessus de la vidéo (canvas), sauvegardés en SVG.
- Navigation rapide : clic sur un commentaire pour revenir au timecode.

### 3) API / Endpoints principaux
- `add_comment.php` : enregistre un commentaire horodaté.
- `draw_handler.php` : enregistre un dessin (SVG) lié à un commentaire.
- `get_drawings.php` / `get_markers_and_drawings.php` : expose les marqueurs et dessins d’une vidéo.
- `delete_comment.php` : supprime un commentaire et ses dessins associés.
- `delete_entity.php` : supprime une vidéo, un projet ou un client (avec nettoyage disque).

### 4) Sécurité et sessions
- Les actions sensibles utilisent un **token de session** pour limiter les appels non autorisés.

> Remarque : certaines pages (ex. `upload_page.php`, `visualization.php`, éventuelle page de login) sont référencées dans le code et peuvent compléter le workflow, mais ne figurent pas forcément dans ce dépôt.

## Architecture technique

### Backend (PHP)
- **Connexion MySQL** centralisée dans `db_connect.php`.
- Endpoints PHP dédiés pour les commentaires, dessins et suppressions.
- Nettoyage des médias et suppression en base lors des suppressions d’entités.

### Frontend (JS/CSS)
- **Lecteur vidéo custom** : `player/valideo-player.js` + `player/valideo-player.css`.
- **Outils de dessin** et interaction commentaires : `draw_tool.js`.
- **Gestion UI** (renommage, partage, suppression) : `gallery_video.js`.

## Flux d’utilisation (haut niveau)

1. L’interface principale affiche les vidéos disponibles par client/projet.
2. Une vidéo peut être ouverte dans la page de validation.
3. Les utilisateurs ajoutent des commentaires horodatés et des dessins.
4. Les marqueurs et annotations sont persistés en base et rechargés à la relecture.

## Dépendances et données

- **Base de données MySQL** contenant les tables de clients, projets, vidéos, commentaires et dessins.
- **Stockage local** des vidéos dans `uploads/`.

Si tu veux, je peux fournir un modèle de schéma SQL ou un guide d’installation pas à pas.
