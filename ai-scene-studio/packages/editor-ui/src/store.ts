/**
 * État de l'éditeur : scène courante, sélection, outil, magnétisme et historique.
 *
 * L'historique conserve des scènes complètes, ce qui est sûr car les opérations de
 * `@ass/scene-engine` ne modifient jamais leur entrée : chaque entrée partage la mémoire de tout ce
 * qui n'a pas changé. Un geste continu (glisser un gizmo) ne crée qu'une entrée, à sa fin.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { SceneDocument } from '@ass/scene-schema';
import type { ClipboardEntry, KeyRef } from '@ass/animation-engine';
import { evaluateFrame, findEntity, subtreeIds } from '@ass/scene-engine';

export type Tool = 'translate' | 'rotate' | 'scale';
export type SelectionMode = 'replace' | 'toggle' | 'add';

export interface Snapping {
  enabled: boolean;
  /** Pas de déplacement en mètres. */
  translate: number;
  /** Pas de rotation en degrés. */
  rotateDegrees: number;
  /** Pas d'échelle (facteur). */
  scale: number;
}

export const HISTORY_LIMIT = 200;
export type CameraView = 'free' | 'camera' | 'split';

export interface EditorState {
  scene: SceneDocument;
  /** Scène telle qu'enregistrée : la comparer à `scene` indique les modifications en attente. */
  savedScene: SceneDocument;
  baseRevisionId: string | null;
  selection: string[];
  tool: Tool;
  snapping: Snapping;
  past: SceneDocument[];
  future: SceneDocument[];
  gestureStart: SceneDocument | null;
  /** Temps courant de l'éditeur, en frame entière. */
  frame: number;
  playing: boolean;
  loop: boolean;
  keySelection: KeyRef[];
  clipboard: ClipboardEntry[];
  cameraView: CameraView;

  load: (scene: SceneDocument, revisionId: string | null) => void;
  /** Applique une opération et l'inscrit dans l'historique ; renvoie false si elle a échoué. */
  apply: (operation: (scene: SceneDocument) => SceneDocument) => boolean;
  beginGesture: () => void;
  updateGesture: (operation: (scene: SceneDocument) => SceneDocument) => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
  select: (ids: string[], mode?: SelectionMode) => void;
  setTool: (tool: Tool) => void;
  setSnapping: (snapping: Partial<Snapping>) => void;
  markSaved: (scene: SceneDocument, revisionId: string) => void;
  setFrame: (frame: number) => void;
  setPlaying: (playing: boolean) => void;
  setLoop: (loop: boolean) => void;
  selectKeys: (refs: KeyRef[], mode?: SelectionMode) => void;
  setClipboard: (entries: ClipboardEntry[]) => void;
  setCameraView: (view: CameraView) => void;
}

const sameKey = (a: KeyRef, b: KeyRef) => a.trackId === b.trackId && a.frame === b.frame;

/** Sélection de clés restreinte aux clés encore présentes. */
function pruneKeys(scene: SceneDocument, refs: KeyRef[]): KeyRef[] {
  return refs.filter((ref) =>
    scene.animations.some(
      (t) => t.id === ref.trackId && t.keyframes.some((k) => k.frame === ref.frame),
    ),
  );
}

const clampFrame = (scene: SceneDocument, frame: number) =>
  Math.min(Math.max(Math.round(frame), 0), scene.durationFrames - 1);

const evaluations = new WeakMap<SceneDocument, Map<number, SceneDocument>>();

/**
 * Scène évaluée à la frame courante (animation + contraintes), mise en cache par scène et par frame :
 * même entrée, même objet, ce qui évite les rendus inutiles.
 */
export function evaluatedScene(state: Pick<EditorState, 'scene' | 'frame'>): SceneDocument {
  let byFrame = evaluations.get(state.scene);
  if (!byFrame) {
    byFrame = new Map();
    evaluations.set(state.scene, byFrame);
  }
  let evaluated = byFrame.get(state.frame);
  if (!evaluated) {
    evaluated = evaluateFrame(state.scene, state.frame);
    if (byFrame.size > 512) byFrame.clear();
    byFrame.set(state.frame, evaluated);
  }
  return evaluated;
}

export const isDirty = (state: Pick<EditorState, 'scene' | 'savedScene'>): boolean =>
  state.scene !== state.savedScene;

/** Sélection restreinte aux entités encore présentes. */
function prune(scene: SceneDocument, selection: string[]): string[] {
  return selection.filter((id) => findEntity(scene, id) !== null);
}

export function createEditorStore(initial: SceneDocument): StoreApi<EditorState> {
  return createStore<EditorState>()((set, get) => ({
    scene: initial,
    savedScene: initial,
    baseRevisionId: null,
    selection: [],
    tool: 'translate',
    snapping: { enabled: false, translate: 0.25, rotateDegrees: 15, scale: 0.1 },
    past: [],
    future: [],
    gestureStart: null,
    frame: 0,
    playing: false,
    loop: true,
    keySelection: [],
    clipboard: [],
    cameraView: 'free',

    load: (scene, revisionId) =>
      set({
        scene,
        savedScene: scene,
        baseRevisionId: revisionId,
        selection: [],
        past: [],
        future: [],
        gestureStart: null,
        frame: 0,
        playing: false,
        keySelection: [],
      }),

    apply: (operation) => {
      const { scene, past, selection } = get();
      let next: SceneDocument;
      try {
        next = operation(scene);
      } catch {
        return false;
      }
      if (next === scene) return true;
      set({
        scene: next,
        past: [...past, scene].slice(-HISTORY_LIMIT),
        future: [],
        selection: prune(next, selection),
        keySelection: pruneKeys(next, get().keySelection),
        frame: clampFrame(next, get().frame),
      });
      return true;
    },

    beginGesture: () => set({ gestureStart: get().scene }),

    updateGesture: (operation) => {
      try {
        set({ scene: operation(get().scene) });
      } catch {
        // Une étape invalide d'un geste est ignorée ; le geste continue.
      }
    },

    endGesture: () => {
      const { gestureStart, scene, past } = get();
      if (gestureStart === null) return;
      if (gestureStart === scene) {
        set({ gestureStart: null });
        return;
      }
      set({ gestureStart: null, past: [...past, gestureStart].slice(-HISTORY_LIMIT), future: [] });
    },

    undo: () => {
      const { past, future, scene, selection } = get();
      const previous = past.at(-1);
      if (previous === undefined) return;
      set({
        scene: previous,
        past: past.slice(0, -1),
        future: [scene, ...future],
        selection: prune(previous, selection),
        keySelection: pruneKeys(previous, get().keySelection),
        frame: clampFrame(previous, get().frame),
      });
    },

    redo: () => {
      const { past, future, scene, selection } = get();
      const [next, ...rest] = future;
      if (next === undefined) return;
      set({
        scene: next,
        past: [...past, scene],
        future: rest,
        selection: prune(next, selection),
        keySelection: pruneKeys(next, get().keySelection),
        frame: clampFrame(next, get().frame),
      });
    },

    select: (ids, mode = 'replace') => {
      const known = prune(get().scene, ids);
      const current = get().selection;
      if (mode === 'replace') set({ selection: known });
      if (mode === 'add')
        set({ selection: [...current, ...known.filter((id) => !current.includes(id))] });
      if (mode === 'toggle') {
        const toggled = current.filter((id) => !known.includes(id));
        set({ selection: [...toggled, ...known.filter((id) => !current.includes(id))] });
      }
    },

    setTool: (tool) => set({ tool }),
    setSnapping: (snapping) => set({ snapping: { ...get().snapping, ...snapping } }),

    markSaved: (scene, revisionId) => set({ savedScene: scene, baseRevisionId: revisionId }),

    setFrame: (frame) => set({ frame: clampFrame(get().scene, frame) }),
    setPlaying: (playing) => set({ playing }),
    setLoop: (loop) => set({ loop }),
    selectKeys: (refs, mode = 'replace') => {
      const current = get().keySelection;
      if (mode === 'replace') set({ keySelection: refs });
      if (mode === 'add')
        set({
          keySelection: [...current, ...refs.filter((r) => !current.some((c) => sameKey(c, r)))],
        });
      if (mode === 'toggle') {
        const kept = current.filter((c) => !refs.some((r) => sameKey(c, r)));
        set({
          keySelection: [...kept, ...refs.filter((r) => !current.some((c) => sameKey(c, r)))],
        });
      }
    },
    setClipboard: (clipboard) => set({ clipboard }),
    setCameraView: (cameraView) => set({ cameraView }),
  }));
}

/** Sélection sans les éléments dont un ancêtre est aussi sélectionné (pour supprimer, dupliquer…). */
export function topLevelSelection(scene: SceneDocument, selection: string[]): string[] {
  return selection.filter(
    (id) => !selection.some((other) => other !== id && subtreeIds(scene, other).has(id)),
  );
}
