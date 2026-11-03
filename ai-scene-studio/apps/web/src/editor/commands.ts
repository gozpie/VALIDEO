import { keyTransform, removeKeys, setTransformAtFrame } from '@ass/animation-engine';
import type { EditorState } from '@ass/editor-ui';
import { evaluatedScene, topLevelSelection } from '@ass/editor-ui';
import type { SceneDocument, Transform } from '@ass/scene-schema';
import {
  addEntity,
  duplicateEntities,
  findEntity,
  groupEntities,
  isLocked,
  clearParent,
  removeEntities,
  setActiveCamera,
  setParent,
  setVisible,
  type Entity,
} from '@ass/scene-engine';
import type { StoreApi } from 'zustand/vanilla';

type Store = StoreApi<EditorState>;

const editable = (scene: SceneDocument, ids: string[]) => ids.filter((id) => !isLocked(scene, id));

export function addAndSelect(store: Store, entity: Entity): void {
  const added = store.getState().apply((scene) => {
    const next = addEntity(scene, entity);
    // La première caméra ajoutée devient la caméra active du plan.
    return entity.kind === 'camera' && next.activeCameraId === null
      ? setActiveCamera(next, entity.value.id)
      : next;
  });
  if (added) {
    store.getState().select([entity.value.id]);
  }
}

export function deleteSelection(store: Store): void {
  const { scene, selection, apply } = store.getState();
  const ids = editable(scene, topLevelSelection(scene, selection));
  if (ids.length > 0) apply((current) => removeEntities(current, ids));
}

export function duplicateSelection(store: Store): void {
  const { scene, selection } = store.getState();
  const ids = topLevelSelection(scene, selection);
  if (ids.length === 0) return;
  let created: string[] = [];
  const ok = store.getState().apply((current) => {
    const result = duplicateEntities(current, ids);
    created = result.ids;
    return result.scene;
  });
  if (ok) store.getState().select(created);
}

export function groupSelection(store: Store): void {
  const { scene, selection } = store.getState();
  const ids = editable(scene, topLevelSelection(scene, selection));
  if (ids.length === 0) return;
  let groupId = '';
  const ok = store.getState().apply((current) => {
    const result = groupEntities(current, ids);
    groupId = result.groupId;
    return result.scene;
  });
  if (ok) store.getState().select([groupId]);
}

/** Masque la sélection si un élément est visible, sinon la réaffiche. */
export function toggleSelectionVisibility(store: Store): void {
  const { scene, selection } = store.getState();
  const targets = selection
    .map((id) => findEntity(scene, id))
    .filter(
      (entity): entity is Exclude<Entity, { kind: 'camera' }> =>
        entity !== null && entity.kind !== 'camera',
    );
  if (targets.length === 0) return;
  const visible = !targets.some((entity) => entity.value.visible);
  store
    .getState()
    .apply((current) =>
      targets.reduce((acc, entity) => setVisible(acc, entity.value.id, visible), current),
    );
}

// --- Actions des raccourcis façon Blender -------------------------------------------------------

const allIds = (scene: SceneDocument) =>
  [...scene.nodes, ...scene.cameras, ...scene.lights].map((e) => e.id);

/** A : tout sélectionner ; Alt+A : tout désélectionner. */
export function selectAll(store: Store, select: boolean): void {
  store.getState().select(select ? allIds(store.getState().scene) : []);
}

/** Maj+H : masquer tout ce qui n'est pas sélectionné ; Alt+H : tout réafficher. */
export function setOthersVisibility(store: Store, mode: 'hide-unselected' | 'unhide-all'): void {
  const { scene, selection } = store.getState();
  const targets = [...scene.nodes, ...scene.lights].filter((e) =>
    mode === 'unhide-all' ? !e.visible : e.visible && !selection.includes(e.id),
  );
  if (targets.length === 0) return;
  store
    .getState()
    .apply((current) =>
      targets.reduce((acc, entity) => setVisible(acc, entity.id, mode === 'unhide-all'), current),
    );
}

/** Ctrl+P : les éléments sélectionnés deviennent enfants de l'élément actif (dernier sélectionné). */
export function parentToActive(store: Store): void {
  const { selection } = store.getState();
  const active = selection.at(-1);
  if (!active || selection.length < 2) return;
  store
    .getState()
    .apply((current) =>
      selection.slice(0, -1).reduce((acc, id) => setParent(acc, id, active), current),
    );
}

/** Alt+P : retirer le parent en conservant la position monde. */
export function clearParentOfSelection(store: Store): void {
  const { selection } = store.getState();
  if (selection.length === 0) return;
  store.getState().apply((current) => selection.reduce((acc, id) => clearParent(acc, id), current));
}

const IDENTITY = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } as const;

/** Alt+G / Alt+R / Alt+S : remettre à zéro position, rotation ou échelle (clé si animé). */
export function clearTransform(store: Store, field: 'position' | 'rotation' | 'scale'): void {
  const state = store.getState();
  const evaluated = evaluatedScene(state);
  const ids = editable(state.scene, state.selection);
  if (ids.length === 0) return;
  state.apply((current) =>
    ids.reduce((acc, id) => {
      const entity = findEntity(evaluated, id);
      if (!entity) return acc;
      const transform = { ...entity.value.transform, [field]: [...IDENTITY[field]] };
      return setTransformAtFrame(acc, id, transform as Transform, state.frame);
    }, current),
  );
}

/** I : clé de transformation pour la sélection à la frame courante. */
export function keySelection(store: Store): void {
  const state = store.getState();
  const evaluated = evaluatedScene(state);
  for (const id of state.selection) {
    const entity = findEntity(evaluated, id);
    if (entity) state.apply((s) => keyTransform(s, id, entity.value.transform, state.frame));
  }
}

/** Alt+I : supprimer les clés de la sélection à la frame courante. */
export function unkeySelection(store: Store): void {
  const { scene, selection, frame } = store.getState();
  const refs = scene.animations
    .filter(
      (track) =>
        selection.includes(track.targetId) && track.keyframes.some((k) => k.frame === frame),
    )
    .map((track) => ({ trackId: track.id, frame }));
  if (refs.length > 0) store.getState().apply((s) => removeKeys(s, refs));
}

/** ↑ / ↓ : clé suivante / précédente (de la sélection, ou de toute la scène). */
export function jumpToKeyframe(store: Store, direction: 1 | -1): void {
  const { scene, selection, frame } = store.getState();
  const frames = scene.animations
    .filter((track) => selection.length === 0 || selection.includes(track.targetId))
    .flatMap((track) => track.keyframes.map((k) => k.frame))
    .filter((f) => (direction === 1 ? f > frame : f < frame))
    .sort((a, b) => (direction === 1 ? a - b : b - a));
  if (frames[0] !== undefined) store.getState().setFrame(frames[0]);
}
