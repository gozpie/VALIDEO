# @ass/editor-ui

État et composants de l'éditeur 3D.

- `src/store.ts` : store Zustand (`createEditorStore`) — scène courante, scène enregistrée (indicateur de
  modifications), révision de départ, sélection (remplacer, ajouter, basculer), outil (déplacement, rotation,
  échelle), magnétisme, historique annuler/rétablir borné à 200 entrées. Un geste continu (gizmo) ne crée qu'une
  entrée. L'historique conserve des scènes complètes, ce qui est sûr et économe parce que les opérations de
  `@ass/scene-engine` ne modifient jamais leur entrée (partage structurel).
- Temps (phase 3) : frame courante entière, lecture, boucle, sélection et presse-papiers de clés, disposition des vues
  (libre, caméra, double). `evaluatedScene(state)` donne la scène évaluée à la frame courante (animation +
  contraintes), mise en cache par scène et par frame.
- Les composants React de l'éditeur (viewport React Three Fiber, hiérarchie, inspecteur, barre d'outils,
  raccourcis) sont dans `apps/web/src/editor/` : ils dépendent du client API de l'application. Ils pourront
  rejoindre ce package lorsqu'un second front en aura besoin.

Immer, prévu à l'origine, n'est pas utilisé : les opérations pures de `scene-engine` rendent son rôle inutile.
