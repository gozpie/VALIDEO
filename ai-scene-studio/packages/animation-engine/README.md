# @ass/animation-engine

Moteur d'animation pur, sans interface ni Three.js.

- `evaluateTrack(track, frame)` / `evaluateScene(scene, frame)` : valeur exacte de chaque propriété animée à
  n'importe quelle frame (entière ou fractionnaire), sans état caché ni horloge. La scène d'entrée n'est jamais
  modifiée.
- Interpolations : `step`, `linear`, `bezier` (Bézier cubique en temps et en valeur, poignées relatives à la clé,
  décalage temporel borné au segment pour rester une fonction du temps ; sans poignée, segment rectiligne),
  `ease_in` (t³), `ease_out` (1 − (1 − t)³), `ease_in_out` (cubique symétrique). Rotations : slerp par le plus
  court chemin, `ease_*` par remappage du temps. Booléens : `step`.
- Extrapolations : `constant`, `linear` (pente du segment extrême ; grandeurs continues uniquement), `cycle`.
- Édition pure des clés : `setKey` (création de piste au besoin), `removeKeys`, `moveKeys` (collisions refusées),
  `copyKeys` / `pasteKeys`, `setTransformAtFrame` (une propriété déjà animée reçoit une clé à la frame courante),
  `keyTransform`.

Déterminisme : `tests/fixtures/animation/cube-camera-animated.expected.json` fige les valeurs attendues de la
fixture animée ; la régénérer volontairement avec `UPDATE_GOLDEN=1 pnpm --filter @ass/animation-engine test`.
