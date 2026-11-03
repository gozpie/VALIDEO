# @ass/editor-ui

État et composants de l'éditeur 3D.

- `src/store.ts` : store Zustand (`createEditorStore`) — scène courante, scène enregistrée (indicateur de
  modifications), révision de départ, sélection (remplacer, ajouter, basculer), outil (déplacement, rotation,
  échelle), magnétisme, historique annuler/rétablir borné à 200 entrées. Un geste continu (gizmo) ne crée qu'une
  entrée. L'historique conserve des scènes complètes, ce qui est sûr et économe parce que les opérations de
  `@ass/scene-engine` ne modifient jamais leur entrée (partage structurel).
- Composants React de l'éditeur (viewport, hiérarchie, inspecteur, barre d'outils) : étape 2.6.

Immer, prévu à l'origine, n'est pas utilisé : les opérations pures de `scene-engine` rendent son rôle inutile.
