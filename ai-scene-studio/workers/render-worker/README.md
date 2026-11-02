# render-worker — phase 4

Conversion scène canonique → Blender (générateur interne ; aucun script utilisateur exécuté), rendu
Cycles frame par frame, passes beauty, alpha, depth, normals, object ID et motion vectors, sortie EXR/PNG.
Exécution isolée avec quotas CPU, RAM, GPU, disque et temps. Volontairement vide en phase 0.
