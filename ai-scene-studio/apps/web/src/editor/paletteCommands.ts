import type { EditorState } from '@ass/editor-ui';
import type { PrimitiveKind } from '@ass/scene-schema';
import {
  PRIMITIVE_LABELS,
  createCamera,
  createEmptyNode,
  createGroupNode,
  createLight,
  createPrimitiveNode,
} from '@ass/scene-engine';
import type { StoreApi } from 'zustand/vanilla';
import type { Command } from '@/lib/commands';
import {
  addAndSelect,
  clearParentOfSelection,
  deleteSelection,
  duplicateSelection,
  groupSelection,
  keySelection,
  parentToActive,
  selectAll,
  setOthersVisibility,
  toggleSelectionVisibility,
  unkeySelection,
} from './commands';
import type { ViewportApi } from './context';
import type { Keymap } from './keymap';
import type { ViewDirection } from './Viewport';

export type EditorPanel = 'inspector' | 'render' | 'ai';

interface Options {
  store: StoreApi<EditorState>;
  canEdit: boolean;
  keymap: Keymap;
  viewport: { current: ViewportApi | null };
  save: () => void;
  showView: (direction: ViewDirection) => void;
  toggleProjection: () => void;
  setPanel: (panel: EditorPanel) => void;
  setKeymap: (keymap: Keymap) => void;
  toggleHelp: () => void;
}

const VIEWS: [ViewDirection, string, string][] = [
  ['front', 'Vue avant', 'Pavé 1'],
  ['back', 'Vue arrière', 'Ctrl+Pavé 1'],
  ['right', 'Vue droite', 'Pavé 3'],
  ['left', 'Vue gauche', 'Ctrl+Pavé 3'],
  ['top', 'Vue de dessus', 'Pavé 7'],
  ['bottom', 'Vue de dessous', 'Ctrl+Pavé 7'],
];

/** Commandes de l'éditeur proposées dans la palette (⌘K / F3), avec le raccourci de la disposition. */
export function editorCommands(options: Options): Command[] {
  const { store, canEdit, keymap, viewport } = options;
  const blender = keymap === 'blender';
  const state = store.getState();
  const hasSelection = state.selection.length > 0;
  const edit = (command: Omit<Command, 'group'>): Command => ({
    ...command,
    group: 'Édition',
    disabled: !canEdit || command.disabled === true,
  });
  const add = (id: string, label: string, run: () => void): Command => ({
    id: `add-${id}`,
    label: `Ajouter : ${label}`,
    group: 'Ajouter',
    keywords: 'nouveau créer',
    disabled: !canEdit,
    run,
  });

  return [
    edit({ id: 'save', label: 'Enregistrer la scène', shortcut: '⌘S', run: options.save }),
    edit({
      id: 'undo',
      label: 'Annuler',
      shortcut: '⌘Z',
      disabled: state.past.length === 0,
      run: () => store.getState().undo(),
    }),
    edit({
      id: 'redo',
      label: 'Rétablir',
      shortcut: '⇧⌘Z',
      disabled: state.future.length === 0,
      run: () => store.getState().redo(),
    }),
    edit({
      id: 'duplicate',
      label: 'Dupliquer la sélection',
      shortcut: blender ? '⇧D' : '⌘D',
      disabled: !hasSelection,
      run: () => duplicateSelection(store),
    }),
    edit({
      id: 'delete',
      label: 'Supprimer la sélection',
      shortcut: blender ? 'X' : 'Suppr',
      keywords: 'effacer',
      disabled: !hasSelection,
      run: () => deleteSelection(store),
    }),
    edit({
      id: 'group',
      label: 'Grouper la sélection',
      shortcut: '⌘G',
      disabled: !hasSelection,
      run: () => groupSelection(store),
    }),
    edit({
      id: 'hide',
      label: 'Masquer / afficher la sélection',
      shortcut: 'H',
      disabled: !hasSelection,
      run: () => toggleSelectionVisibility(store),
    }),
    edit({
      id: 'hide-others',
      label: 'Masquer le reste',
      shortcut: '⇧H',
      run: () => setOthersVisibility(store, 'hide-unselected'),
    }),
    edit({
      id: 'unhide',
      label: 'Tout afficher',
      shortcut: '⌥H',
      run: () => setOthersVisibility(store, 'unhide-all'),
    }),
    edit({
      id: 'parent',
      label: 'Parenter à l’élément actif',
      shortcut: '⌘P',
      disabled: state.selection.length < 2,
      run: () => parentToActive(store),
    }),
    edit({
      id: 'unparent',
      label: 'Retirer le parent',
      shortcut: '⌥P',
      disabled: !hasSelection,
      run: () => clearParentOfSelection(store),
    }),
    edit({
      id: 'key',
      label: 'Poser une clé de transformation',
      shortcut: blender ? 'I' : 'K',
      keywords: 'animation keyframe',
      disabled: !hasSelection,
      run: () => keySelection(store),
    }),
    edit({
      id: 'unkey',
      label: 'Supprimer les clés à la frame courante',
      shortcut: '⌥I',
      keywords: 'animation keyframe',
      disabled: !hasSelection,
      run: () => unkeySelection(store),
    }),
    {
      id: 'select-all',
      label: 'Tout sélectionner',
      group: 'Sélection',
      shortcut: 'A',
      run: () => selectAll(store, true),
    },
    {
      id: 'select-none',
      label: 'Tout désélectionner',
      group: 'Sélection',
      shortcut: '⌥A',
      run: () => selectAll(store, false),
    },
    ...(Object.keys(PRIMITIVE_LABELS) as PrimitiveKind[]).map((kind) =>
      add(kind, PRIMITIVE_LABELS[kind], () =>
        addAndSelect(store, { kind: 'node', value: createPrimitiveNode(kind) }),
      ),
    ),
    add('empty', 'Empty', () => addAndSelect(store, { kind: 'node', value: createEmptyNode() })),
    add('group', 'Groupe', () => addAndSelect(store, { kind: 'node', value: createGroupNode() })),
    add('camera', 'Caméra', () => addAndSelect(store, { kind: 'camera', value: createCamera() })),
    add('directional', 'Lumière directionnelle', () =>
      addAndSelect(store, { kind: 'light', value: createLight('directional') }),
    ),
    add('point', 'Lumière ponctuelle', () =>
      addAndSelect(store, { kind: 'light', value: createLight('point') }),
    ),
    add('spot', 'Projecteur', () =>
      addAndSelect(store, { kind: 'light', value: createLight('spot') }),
    ),
    {
      id: 'frame-selection',
      label: 'Cadrer la sélection',
      group: 'Vue',
      shortcut: blender ? 'Pavé .' : 'F',
      run: () => viewport.current?.frameSelection(),
    },
    {
      id: 'frame-all',
      label: 'Tout cadrer',
      group: 'Vue',
      shortcut: 'Origine',
      run: () => viewport.current?.frameAll(),
    },
    ...VIEWS.map(([direction, label, shortcut]): Command => ({
      id: `view-${direction}`,
      label,
      group: 'Vue',
      ...(blender ? { shortcut } : {}),
      run: () => options.showView(direction),
    })),
    {
      id: 'projection',
      label: 'Perspective ⇄ orthographique',
      group: 'Vue',
      ...(blender ? { shortcut: 'Pavé 5' } : {}),
      run: options.toggleProjection,
    },
    {
      id: 'camera-view',
      label: 'Vue caméra',
      group: 'Vue',
      ...(blender ? { shortcut: 'Pavé 0' } : {}),
      run: () => store.getState().setCameraView('camera'),
    },
    {
      id: 'free-view',
      label: 'Vue libre',
      group: 'Vue',
      run: () => store.getState().setCameraView('free'),
    },
    {
      id: 'split-view',
      label: 'Vue libre + caméra',
      group: 'Vue',
      run: () => store.getState().setCameraView('split'),
    },
    {
      id: 'play',
      label: 'Lecture / pause',
      group: 'Temps',
      shortcut: 'Espace',
      run: () => store.getState().setPlaying(!store.getState().playing),
    },
    {
      id: 'panel-inspector',
      label: 'Afficher l’inspecteur',
      group: 'Panneaux',
      run: () => options.setPanel('inspector'),
    },
    {
      id: 'panel-render',
      label: 'Afficher le rendu Blender',
      group: 'Panneaux',
      run: () => options.setPanel('render'),
    },
    {
      id: 'panel-ai',
      label: 'Afficher la génération IA',
      group: 'Panneaux',
      keywords: 'claude higgsfield image vidéo prompt',
      run: () => options.setPanel('ai'),
    },
    {
      id: 'keymap',
      label: blender ? 'Passer aux raccourcis standard' : 'Passer aux raccourcis façon Blender',
      group: 'Préférences',
      run: () => options.setKeymap(blender ? 'standard' : 'blender'),
    },
    {
      id: 'help',
      label: 'Aide des raccourcis',
      group: 'Préférences',
      shortcut: '?',
      run: options.toggleHelp,
    },
  ];
}
