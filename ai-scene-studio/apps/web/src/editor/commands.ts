import type { EditorState } from '@ass/editor-ui';
import { topLevelSelection } from '@ass/editor-ui';
import type { SceneDocument } from '@ass/scene-schema';
import {
  addEntity,
  duplicateEntities,
  findEntity,
  groupEntities,
  isLocked,
  removeEntities,
  setActiveCamera,
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
