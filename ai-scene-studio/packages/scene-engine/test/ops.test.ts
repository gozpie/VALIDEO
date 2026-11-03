import { describe, expect, it } from 'vitest';
import { createEmptyScene, validateScene, type SceneDocument } from '@ass/scene-schema';
import { Vector3 } from 'three';
import {
  addEntity,
  createCamera,
  createGroupNode,
  createLight,
  createPrimitiveNode,
  duplicateEntities,
  groupEntities,
  nodeColor,
  removeEntities,
  renameEntity,
  setLocked,
  setNodeColor,
  setParent,
  setTransform,
  setVisible,
  subtreeIds,
  worldMatrix,
} from '../src';

const empty = () => createEmptyScene({ sceneId: '00000000-0000-4000-8000-0000000000aa' });

function expectValid(scene: SceneDocument) {
  const result = validateScene(scene);
  expect(result.success ? [] : result.issues).toEqual([]);
}

function worldPosition(scene: SceneDocument, id: string): number[] {
  return new Vector3()
    .setFromMatrixPosition(worldMatrix(scene, id))
    .toArray()
    .map((v) => Math.round(v * 1e6) / 1e6 + 0);
}

describe('opérations d’édition', () => {
  it('ajoute des primitives, caméras et lumières valides sans modifier l’entrée', () => {
    const start = empty();
    let scene = start;
    for (const kind of ['cube', 'sphere', 'cylinder', 'plane', 'cone', 'torus'] as const) {
      scene = addEntity(scene, { kind: 'node', value: createPrimitiveNode(kind) });
    }
    scene = addEntity(scene, { kind: 'camera', value: createCamera() });
    for (const kind of ['directional', 'point', 'spot'] as const) {
      scene = addEntity(scene, { kind: 'light', value: createLight(kind) });
    }
    expect(start.nodes).toHaveLength(0);
    expect(scene.nodes).toHaveLength(6);
    expectValid(scene);
  });

  it('supprime un objet avec ses descendants, ses pistes et ses matériaux propres', () => {
    const group = createGroupNode();
    const cube = { ...createPrimitiveNode('cube'), parentId: group.id };
    const camera = { ...createCamera(), parentId: group.id };
    let scene = addEntity(
      addEntity(addEntity(empty(), { kind: 'node', value: group }), { kind: 'node', value: cube }),
      { kind: 'camera', value: camera },
    );
    scene = setNodeColor(scene, cube.id, [1, 0, 0]);
    scene.animations.push({
      id: '00000000-0000-4000-8000-0000000000bb',
      targetId: cube.id,
      propertyPath: 'transform.position',
      valueType: 'vec3',
      extrapolation: 'constant',
      keyframes: [
        { frame: 0, value: [0, 0, 0], interpolation: 'linear', inHandle: null, outHandle: null },
      ],
    });
    expect(subtreeIds(scene, group.id)).toEqual(new Set([group.id, cube.id, camera.id]));
    const next = removeEntities(scene, [group.id]);
    expect(next.nodes).toEqual([]);
    expect(next.cameras).toEqual([]);
    expect(next.animations).toEqual([]);
    expect(next.materials).toEqual([]);
    expectValid(next);
  });

  it('duplique un sous-arbre avec de nouveaux identifiants', () => {
    const group = createGroupNode();
    const cube = { ...createPrimitiveNode('cube'), parentId: group.id, passIndex: 3 };
    const scene = addEntity(addEntity(empty(), { kind: 'node', value: group }), {
      kind: 'node',
      value: cube,
    });
    const { scene: next, ids } = duplicateEntities(scene, [group.id]);
    expect(next.nodes).toHaveLength(4);
    const copyId = ids[0]!;
    expect(next.nodes.find((n) => n.id === copyId)?.name).toBe('Groupe copie');
    const copiedCube = next.nodes.find((n) => n.parentId === copyId)!;
    expect(copiedCube.id).not.toBe(cube.id);
    expect(copiedCube.passIndex).toBe(0);
    expectValid(next);
  });

  it('conserve la position monde lors d’un changement de parent', () => {
    const parent = createGroupNode('Parent');
    parent.transform = {
      position: [2, 0, 0],
      rotation: [0, 0.7071068, 0, 0.7071068],
      scale: [2, 2, 2],
    };
    const cube = createPrimitiveNode('cube');
    cube.transform.position = [3, 1, 0];
    let scene = addEntity(addEntity(empty(), { kind: 'node', value: parent }), {
      kind: 'node',
      value: cube,
    });
    scene = setParent(scene, cube.id, parent.id);
    expect(scene.nodes.find((n) => n.id === cube.id)?.parentId).toBe(parent.id);
    expect(worldPosition(scene, cube.id)).toEqual([3, 1, 0]);
    scene = setParent(scene, cube.id, null);
    expect(scene.nodes.find((n) => n.id === cube.id)?.transform.position).toEqual([3, 1, 0]);
    expectValid(scene);
  });

  it('refuse les cycles et les parents qui ne sont pas des objets', () => {
    const a = createGroupNode('A');
    const b = { ...createGroupNode('B'), parentId: a.id };
    const camera = createCamera();
    const scene = addEntity(
      addEntity(addEntity(empty(), { kind: 'node', value: a }), { kind: 'node', value: b }),
      { kind: 'camera', value: camera },
    );
    expect(() => setParent(scene, a.id, b.id)).toThrow(/circulaire/);
    expect(() => setParent(scene, a.id, a.id)).toThrow(/circulaire/);
    expect(() => setParent(scene, a.id, camera.id)).toThrow(/objet/);
  });

  it('groupe des objets sous leur parent commun sans les déplacer', () => {
    const one = createPrimitiveNode('cube');
    one.transform.position = [1, 0, 0];
    const two = createPrimitiveNode('sphere');
    two.transform.position = [-1, 2, 0];
    let scene = addEntity(addEntity(empty(), { kind: 'node', value: one }), {
      kind: 'node',
      value: two,
    });
    const result = groupEntities(scene, [one.id, two.id]);
    scene = result.scene;
    expect(scene.nodes.filter((n) => n.parentId === result.groupId)).toHaveLength(2);
    expect(worldPosition(scene, two.id)).toEqual([-1, 2, 0]);
    expectValid(scene);
  });

  it('renomme, déplace, masque, verrouille et colore', () => {
    const cube = createPrimitiveNode('cube');
    let scene = addEntity(empty(), { kind: 'node', value: cube });
    scene = renameEntity(scene, cube.id, '  Héros  ');
    scene = setTransform(scene, cube.id, {
      position: [1, 2, 3],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    });
    scene = setVisible(scene, cube.id, false);
    scene = setLocked(scene, cube.id, true);
    scene = setNodeColor(scene, cube.id, [0, 0.5, 1]);
    scene = setNodeColor(scene, cube.id, [1, 0.5, 0]);
    const node = scene.nodes[0]!;
    expect(node).toMatchObject({ name: 'Héros', visible: false, locked: true });
    expect(node.transform.position).toEqual([1, 2, 3]);
    expect(scene.materials).toHaveLength(1);
    expect(nodeColor(scene, cube.id)).toEqual([1, 0.5, 0]);
    expect(() => renameEntity(scene, cube.id, '   ')).toThrow();
    expectValid(scene);
  });
});
