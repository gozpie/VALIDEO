# render-worker

Rendu final hors navigateur avec **Blender 4.5 LTS** (Cycles sur CPU), dans l'image
`infrastructure/docker/render-worker.Dockerfile` (service `render-worker` de `compose.yaml`).

- `ass_api.render.worker` : boucle du worker (file Redis, échec des jobs abandonnés, arrêt propre).
- `ass_api.render.runner` : préparation (révision, modèles GLB du workspace), Blender, encodage FFmpeg
  (H.264, ProRes 4444 avec alpha si le fond est transparent), archive des passes, publication des sorties comme
  assets, mise à jour de l'état et de la progression, annulation entre deux frames, délai maximal.
- `ass_api.render.prepare` : description de scène pour Blender (décisions de correspondance, testées en Python).
- `blender/build_scene.py` : générateur interne exécuté par Blender — racine Y-up → Z-up, primitives, import
  GLB compensé, matériaux Principled, caméras physiques (capteur horizontal, profondeur de champ), lumières
  (unités glTF → Blender), **courbes d'animation natives** (fichier `.blend` éditable), rotations et caméras
  contraintes échantillonnées par frame, passes, compositeur, sorties. Aucun script utilisateur n'est exécuté.

Sorties d'un job : vidéo H.264, (ProRes 4444 alpha), archive des passes OpenEXR multicouches (Combined RGBA,
Depth, Normal, IndexOB, CryptoObject, Vector), aperçu PNG, scène `.blend` à ouvrir dans Blender 4.5 ou plus récent.

Quotas (compose) : `RENDER_WORKER_CPUS` (4), `RENDER_WORKER_MEMORY` (4g), `RENDER_WORKER_TMP` (4g, disque de
travail), `pids_limit`, `ASS_RENDER_TIMEOUT_SECONDS` (durée maximale d'un job).
