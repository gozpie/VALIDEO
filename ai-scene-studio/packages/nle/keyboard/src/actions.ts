/**
 * Catalogue des actions raccourcissables (section 34).
 *
 * Une ACTION est une intention nommee, independante de la touche qui la
 * declenche. C est ce qui permet d avoir plusieurs presets -- « à la Premiere »,
 * « à la Avid » -- sans dupliquer la moindre ligne de logique, et un editeur
 * visuel de raccourcis qui ne connait que des identifiants.
 */

export type ActionCategory =
  'lecture' | 'montage' | 'navigation' | 'outils' | 'pistes' | 'fichier' | 'affichage';

export interface ActionDefinition {
  readonly id: string;
  readonly label: string;
  readonly category: ActionCategory;
  /** Contexte requis. `global` s applique partout. */
  readonly context: 'global' | 'timeline' | 'monitor' | 'project';
}

export const ACTIONS: readonly ActionDefinition[] = [
  // Lecture
  { id: 'playback.togglePlay', label: 'Lecture / Pause', category: 'lecture', context: 'global' },
  {
    id: 'playback.shuttleReverse',
    label: 'Lecture arrière (J)',
    category: 'lecture',
    context: 'global',
  },
  { id: 'playback.stop', label: 'Arrêt (K)', category: 'lecture', context: 'global' },
  {
    id: 'playback.shuttleForward',
    label: 'Lecture avant (L)',
    category: 'lecture',
    context: 'global',
  },
  { id: 'playback.loop', label: 'Lecture en boucle', category: 'lecture', context: 'global' },
  {
    id: 'playback.playAroundEdit',
    label: 'Lire autour du point de montage',
    category: 'lecture',
    context: 'global',
  },

  // Navigation
  { id: 'nav.nextFrame', label: 'Image suivante', category: 'navigation', context: 'global' },
  { id: 'nav.previousFrame', label: 'Image précédente', category: 'navigation', context: 'global' },
  { id: 'nav.nextFrame5', label: 'Avancer de 5 images', category: 'navigation', context: 'global' },
  {
    id: 'nav.previousFrame5',
    label: 'Reculer de 5 images',
    category: 'navigation',
    context: 'global',
  },
  {
    id: 'nav.nextEdit',
    label: 'Point de montage suivant',
    category: 'navigation',
    context: 'timeline',
  },
  {
    id: 'nav.previousEdit',
    label: 'Point de montage précédent',
    category: 'navigation',
    context: 'timeline',
  },
  { id: 'nav.start', label: 'Début de la séquence', category: 'navigation', context: 'global' },
  { id: 'nav.end', label: 'Fin de la séquence', category: 'navigation', context: 'global' },
  { id: 'nav.nextMarker', label: 'Marqueur suivant', category: 'navigation', context: 'global' },
  {
    id: 'nav.previousMarker',
    label: 'Marqueur précédent',
    category: 'navigation',
    context: 'global',
  },

  // Points d entrée et de sortie
  { id: 'marks.markIn', label: 'Point d’entrée', category: 'montage', context: 'global' },
  { id: 'marks.markOut', label: 'Point de sortie', category: 'montage', context: 'global' },
  {
    id: 'marks.clearIn',
    label: 'Effacer le point d’entrée',
    category: 'montage',
    context: 'global',
  },
  {
    id: 'marks.clearOut',
    label: 'Effacer le point de sortie',
    category: 'montage',
    context: 'global',
  },
  {
    id: 'marks.goToIn',
    label: 'Aller au point d’entrée',
    category: 'navigation',
    context: 'global',
  },
  {
    id: 'marks.goToOut',
    label: 'Aller au point de sortie',
    category: 'navigation',
    context: 'global',
  },
  { id: 'marks.addMarker', label: 'Ajouter un marqueur', category: 'montage', context: 'global' },

  // Montage
  { id: 'edit.insert', label: 'Insert', category: 'montage', context: 'timeline' },
  { id: 'edit.overwrite', label: 'Overwrite', category: 'montage', context: 'timeline' },
  { id: 'edit.lift', label: 'Lift', category: 'montage', context: 'timeline' },
  { id: 'edit.extract', label: 'Extract', category: 'montage', context: 'timeline' },
  { id: 'edit.delete', label: 'Supprimer', category: 'montage', context: 'timeline' },
  {
    id: 'edit.rippleDelete',
    label: 'Supprimer avec ripple',
    category: 'montage',
    context: 'timeline',
  },
  {
    id: 'edit.addEdit',
    label: 'Ajouter un point de montage',
    category: 'montage',
    context: 'timeline',
  },
  {
    id: 'edit.rippleTrimPrevious',
    label: 'Ripple trim vers l’arrière (Q)',
    category: 'montage',
    context: 'timeline',
  },
  {
    id: 'edit.rippleTrimNext',
    label: 'Ripple trim vers l’avant (W)',
    category: 'montage',
    context: 'timeline',
  },
  { id: 'edit.undo', label: 'Annuler', category: 'montage', context: 'global' },
  { id: 'edit.redo', label: 'Rétablir', category: 'montage', context: 'global' },
  { id: 'edit.cut', label: 'Couper', category: 'montage', context: 'global' },
  { id: 'edit.copy', label: 'Copier', category: 'montage', context: 'global' },
  { id: 'edit.paste', label: 'Coller', category: 'montage', context: 'global' },
  {
    id: 'edit.pasteInsert',
    label: 'Coller en insertion',
    category: 'montage',
    context: 'timeline',
  },
  { id: 'edit.selectAll', label: 'Tout sélectionner', category: 'montage', context: 'global' },
  { id: 'edit.nest', label: 'Imbriquer', category: 'montage', context: 'timeline' },
  { id: 'edit.group', label: 'Grouper', category: 'montage', context: 'timeline' },
  { id: 'edit.linkToggle', label: 'Lier / Délier', category: 'montage', context: 'timeline' },
  { id: 'edit.speedDuration', label: 'Vitesse et durée', category: 'montage', context: 'timeline' },

  // Outils
  { id: 'tool.selection', label: 'Outil Sélection', category: 'outils', context: 'timeline' },
  {
    id: 'tool.trackSelectForward',
    label: 'Sélection de piste avant',
    category: 'outils',
    context: 'timeline',
  },
  { id: 'tool.ripple', label: 'Outil Ripple', category: 'outils', context: 'timeline' },
  { id: 'tool.rolling', label: 'Outil Rolling', category: 'outils', context: 'timeline' },
  { id: 'tool.rateStretch', label: 'Outil Étirement', category: 'outils', context: 'timeline' },
  { id: 'tool.razor', label: 'Outil Lame', category: 'outils', context: 'timeline' },
  { id: 'tool.slip', label: 'Outil Slip', category: 'outils', context: 'timeline' },
  { id: 'tool.slide', label: 'Outil Slide', category: 'outils', context: 'timeline' },
  { id: 'tool.pen', label: 'Outil Plume', category: 'outils', context: 'timeline' },
  { id: 'tool.hand', label: 'Outil Main', category: 'outils', context: 'timeline' },
  { id: 'tool.zoom', label: 'Outil Zoom', category: 'outils', context: 'timeline' },

  // Pistes et affichage
  { id: 'timeline.zoomIn', label: 'Zoom avant', category: 'affichage', context: 'timeline' },
  { id: 'timeline.zoomOut', label: 'Zoom arrière', category: 'affichage', context: 'timeline' },
  {
    id: 'timeline.zoomToFit',
    label: 'Ajuster la séquence',
    category: 'affichage',
    context: 'timeline',
  },
  {
    id: 'timeline.toggleSnap',
    label: 'Activer / désactiver l’accrochage',
    category: 'affichage',
    context: 'timeline',
  },
  {
    id: 'timeline.maximizePanel',
    label: 'Agrandir le panneau',
    category: 'affichage',
    context: 'global',
  },
  {
    id: 'timeline.toggleFullscreen',
    label: 'Plein écran',
    category: 'affichage',
    context: 'global',
  },
  { id: 'track.toggleTargetV1', label: 'Cibler V1', category: 'pistes', context: 'timeline' },
  { id: 'track.toggleTargetA1', label: 'Cibler A1', category: 'pistes', context: 'timeline' },

  // Fichier
  { id: 'file.save', label: 'Enregistrer', category: 'fichier', context: 'global' },
  { id: 'file.saveAs', label: 'Enregistrer sous', category: 'fichier', context: 'global' },
  { id: 'file.import', label: 'Importer', category: 'fichier', context: 'global' },
  { id: 'file.export', label: 'Exporter', category: 'fichier', context: 'global' },
  {
    id: 'file.commandPalette',
    label: 'Palette de commandes',
    category: 'fichier',
    context: 'global',
  },
] as const;

export const ACTION_IDS: ReadonlySet<string> = new Set(ACTIONS.map((a) => a.id));

export function actionById(id: string): ActionDefinition | undefined {
  return ACTIONS.find((a) => a.id === id);
}

export function actionsByCategory(category: ActionCategory): ActionDefinition[] {
  return ACTIONS.filter((a) => a.category === category);
}
