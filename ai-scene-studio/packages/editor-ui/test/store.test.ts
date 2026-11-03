import { describe, expect, it } from 'vitest';
import { createEmptyScene } from '@ass/scene-schema';
import {
  addEntity,
  createGroupNode,
  createPrimitiveNode,
  removeEntities,
  setTransform,
} from '@ass/scene-engine';
import { HISTORY_LIMIT, createEditorStore, isDirty, topLevelSelection } from '../src';

const empty = () => createEmptyScene({ sceneId: '00000000-0000-4000-8000-0000000000cc' });
const cube = createPrimitiveNode('cube');
const move = (x: number) => (scene: ReturnType<typeof empty>) =>
  setTransform(scene, cube.id, { position: [x, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });

describe('store de l’éditeur', () => {
  it('annule et rétablit les opérations', () => {
    const store = createEditorStore(empty());
    const { apply, undo, redo } = store.getState();
    apply((s) => addEntity(s, { kind: 'node', value: cube }));
    apply(move(1));
    apply(move(2));
    expect(store.getState().scene.nodes[0]!.transform.position[0]).toBe(2);
    undo();
    expect(store.getState().scene.nodes[0]!.transform.position[0]).toBe(1);
    undo();
    undo();
    expect(store.getState().scene.nodes).toHaveLength(0);
    undo(); // rien à annuler
    redo();
    redo();
    expect(store.getState().scene.nodes[0]!.transform.position[0]).toBe(1);
    // Une nouvelle opération efface les rétablissements possibles.
    apply(move(5));
    redo();
    expect(store.getState().future).toEqual([]);
    expect(store.getState().scene.nodes[0]!.transform.position[0]).toBe(5);
  });

  it('ne crée qu’une entrée d’historique par geste', () => {
    const store = createEditorStore(addEntity(empty(), { kind: 'node', value: cube }));
    const state = store.getState();
    state.beginGesture();
    for (let x = 1; x <= 30; x++) store.getState().updateGesture(move(x / 10));
    store.getState().endGesture();
    expect(store.getState().past).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().scene.nodes[0]!.transform.position[0]).toBe(0);
    // Un geste sans effet n'ajoute rien.
    store.getState().beginGesture();
    store.getState().endGesture();
    expect(store.getState().past).toHaveLength(0);
  });

  it('regroupe dans le geste en cours les opérations appliquées', () => {
    const store = createEditorStore(addEntity(empty(), { kind: 'node', value: cube }));
    store.getState().beginGesture();
    for (let x = 1; x <= 5; x++) store.getState().apply(move(x));
    expect(store.getState().past).toHaveLength(0);
    store.getState().endGesture();
    expect(store.getState().past).toHaveLength(1);
    expect(store.getState().scene.nodes[0]!.transform.position[0]).toBe(5);
    store.getState().undo();
    expect(store.getState().scene.nodes[0]!.transform.position[0]).toBe(0);
  });

  it('ignore une opération invalide sans perdre l’état', () => {
    const store = createEditorStore(empty());
    const ok = store.getState().apply(() => {
      throw new Error('refus');
    });
    expect(ok).toBe(false);
    expect(store.getState().past).toHaveLength(0);
  });

  it('borne la taille de l’historique', () => {
    const store = createEditorStore(addEntity(empty(), { kind: 'node', value: cube }));
    for (let x = 0; x < HISTORY_LIMIT + 20; x++) store.getState().apply(move(x + 1));
    expect(store.getState().past).toHaveLength(HISTORY_LIMIT);
  });

  it('sélectionne, ajoute, bascule et retire les entités supprimées', () => {
    const other = createPrimitiveNode('sphere');
    const scene = addEntity(addEntity(empty(), { kind: 'node', value: cube }), {
      kind: 'node',
      value: other,
    });
    const store = createEditorStore(scene);
    store.getState().select([cube.id]);
    store.getState().select([other.id], 'add');
    expect(store.getState().selection).toEqual([cube.id, other.id]);
    store.getState().select([cube.id], 'toggle');
    expect(store.getState().selection).toEqual([other.id]);
    store.getState().select(['inconnu']);
    expect(store.getState().selection).toEqual([]);
    store.getState().select([other.id]);
    store.getState().apply((s) => removeEntities(s, [other.id]));
    expect(store.getState().selection).toEqual([]);
  });

  it('suit les modifications non enregistrées', () => {
    const store = createEditorStore(empty());
    store.getState().load(empty(), 'rev-1');
    expect(isDirty(store.getState())).toBe(false);
    store.getState().apply((s) => addEntity(s, { kind: 'node', value: cube }));
    expect(isDirty(store.getState())).toBe(true);
    store.getState().markSaved(store.getState().scene, 'rev-2');
    expect(isDirty(store.getState())).toBe(false);
    expect(store.getState().baseRevisionId).toBe('rev-2');
    store.getState().undo();
    expect(isDirty(store.getState())).toBe(true);
  });

  it('écarte les descendants d’éléments déjà sélectionnés', () => {
    const group = createGroupNode();
    const child = { ...createPrimitiveNode('cube'), parentId: group.id };
    const scene = addEntity(addEntity(empty(), { kind: 'node', value: group }), {
      kind: 'node',
      value: child,
    });
    expect(topLevelSelection(scene, [child.id, group.id])).toEqual([group.id]);
  });
});

describe('temps et clés', () => {
  it('borne la frame courante et suit les suppressions de clés', async () => {
    const { setKey, removeKeys } = await import('@ass/animation-engine');
    const scene = addEntity(
      createEmptyScene({ sceneId: '00000000-0000-4000-8000-0000000000ce', durationFrames: 24 }),
      {
        kind: 'node',
        value: cube,
      },
    );
    const store = createEditorStore(scene);
    store.getState().setFrame(100);
    expect(store.getState().frame).toBe(23);
    store.getState().setFrame(-3.4);
    expect(store.getState().frame).toBe(0);
    store.getState().apply((s) =>
      setKey(s, {
        targetId: cube.id,
        propertyPath: 'transform.position',
        frame: 5,
        value: [1, 0, 0],
      }),
    );
    const trackId = store.getState().scene.animations[0]!.id;
    store.getState().selectKeys([{ trackId, frame: 5 }]);
    store.getState().apply((s) => removeKeys(s, [{ trackId, frame: 5 }]));
    expect(store.getState().keySelection).toEqual([]);
  });

  it('met en cache l’évaluation par scène et par frame', async () => {
    const { setKey } = await import('@ass/animation-engine');
    const { evaluatedScene } = await import('../src');
    let scene = addEntity(
      createEmptyScene({ sceneId: '00000000-0000-4000-8000-0000000000cf', durationFrames: 24 }),
      {
        kind: 'node',
        value: cube,
      },
    );
    scene = setKey(scene, {
      targetId: cube.id,
      propertyPath: 'transform.position',
      frame: 0,
      value: [0, 0, 0],
    });
    scene = setKey(scene, {
      targetId: cube.id,
      propertyPath: 'transform.position',
      frame: 10,
      value: [10, 0, 0],
    });
    const first = evaluatedScene({ scene, frame: 4 });
    expect(first.nodes[0]!.transform.position).toEqual([4, 0, 0]);
    expect(evaluatedScene({ scene, frame: 4 })).toBe(first);
  });
});
