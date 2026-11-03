# @ass/scene-engine

Cœur d'édition de la scène canonique (`@ass/scene-schema`), sans React ni interface :

- `src/factories.ts` : création d'objets (primitives posées sur le sol, empty, groupe, modèle GLB par `assetId`),
  de caméras (35 mm plein format), de lumières (unités photométriques glTF) et de matériaux.
- `src/ops.ts` : opérations **pures** (la scène d'entrée n'est jamais modifiée) — ajout, suppression en cascade
  (descendants, pistes, matériaux propres), duplication de sous-arbres, renommage, transformation, visibilité,
  verrouillage, parentage avec conservation de la position monde et refus des cycles, groupement, couleur.
- `src/math.ts` : matrices ↔ transformations canoniques, Euler (degrés, XYZ) ↔ quaternion, champ de vision
  d'une caméra physique.
- `@ass/scene-engine/three` : géométries unitaires des primitives, matériaux PBR (couleurs linéaires), caméra
  physique, transformation d'un `Object3D`. Même repère que glTF : aucune conversion d'axes.

Les opérations produisent toujours des scènes valides (`validateScene`), vérifié par les tests.
