import { describe, expect, it } from 'vitest';
import { createEmptyScene, validateScene, type SceneDocument } from '@ass/scene-schema';
import { setKey } from '@ass/animation-engine';
import { Vector3 } from 'three';
import {
  addEntity,
  createCamera,
  createPrimitiveNode,
  evaluateFrame,
  moveCamera,
  removeEntities,
  setActiveCamera,
  setLocked,
  worldMatrix,
} from '../src';
import { transformToMatrix } from '../src/math';

const round = (values: number[]) => values.map((v) => Math.round(v * 1e6) / 1e6 + 0);

function setup() {
  const camera = createCamera();
  camera.transform.position = [0, 0, 10];
  const cube = createPrimitiveNode('cube');
  cube.transform.position = [5, 0, 0];
  let scene: SceneDocument = createEmptyScene({
    sceneId: '00000000-0000-4000-8000-0000000000e0',
    durationFrames: 50,
  });
  scene = addEntity(addEntity(scene, { kind: 'camera', value: camera }), {
    kind: 'node',
    value: cube,
  });
  return { scene, camera, cube };
}

const forward = (scene: SceneDocument, id: string) =>
  round(new Vector3(0, 0, -1).transformDirection(worldMatrix(scene, id)).toArray());

describe('caméras', () => {
  it('déplace la caméra dans son repère (dolly, truck, pedestal)', () => {
    const { scene, camera } = setup();
    expect(round(moveCamera(scene, camera.id, 'dolly', 2).cameras[0]!.transform.position)).toEqual([
      0, 0, 8,
    ]);
    expect(round(moveCamera(scene, camera.id, 'truck', 1).cameras[0]!.transform.position)).toEqual([
      1, 0, 10,
    ]);
    expect(
      round(moveCamera(scene, camera.id, 'pedestal', 3).cameras[0]!.transform.position),
    ).toEqual([0, 3, 10]);
  });

  it('pivote (pan, tilt) et orbite autour d’un point', () => {
    const { scene, camera } = setup();
    expect(forward(moveCamera(scene, camera.id, 'pan', Math.PI / 2), camera.id)).toEqual([
      -1, 0, 0,
    ]);
    expect(forward(moveCamera(scene, camera.id, 'tilt', Math.PI / 2), camera.id)).toEqual([
      0, 1, 0,
    ]);
    const orbited = moveCamera(scene, camera.id, 'orbit', Math.PI / 2, 10);
    // Pivot à 10 m devant la caméra : l'origine. Après un quart de tour, la caméra est en +X et vise l'origine.
    expect(round(orbited.cameras[0]!.transform.position)).toEqual([10, 0, 0]);
    expect(forward(orbited, camera.id)).toEqual([-1, 0, 0]);
  });

  it('refuse de déplacer une caméra verrouillée', () => {
    const { scene, camera } = setup();
    expect(() => moveCamera(setLocked(scene, camera.id, true), camera.id, 'dolly', 1)).toThrow(
      /verrouillée/,
    );
  });

  it('vise la cible à chaque frame, même animée, avec roulis', () => {
    const { scene: base, camera, cube } = setup();
    let scene: SceneDocument = {
      ...base,
      cameras: base.cameras.map((c) => ({ ...c, lookAtTargetId: cube.id })),
    };
    scene = setKey(scene, {
      targetId: cube.id,
      propertyPath: 'transform.position',
      frame: 0,
      value: [5, 0, 0],
    });
    scene = setKey(scene, {
      targetId: cube.id,
      propertyPath: 'transform.position',
      frame: 40,
      value: [-5, 0, 0],
    });
    for (const frame of [0, 20, 40]) {
      const evaluated = evaluateFrame(scene, frame);
      const eye = new Vector3().setFromMatrixPosition(worldMatrix(evaluated, camera.id));
      const target = new Vector3().setFromMatrixPosition(worldMatrix(evaluated, cube.id));
      expect(forward(evaluated, camera.id)).toEqual(round(target.sub(eye).normalize().toArray()));
      expect(validateScene(evaluated).success).toBe(true);
    }
    const rolled = evaluateFrame(
      { ...scene, cameras: scene.cameras.map((c) => ({ ...c, rollRadians: Math.PI / 2 })) },
      20,
    );
    const up = round(
      new Vector3(0, 1, 0)
        .transformDirection(transformToMatrix(rolled.cameras[0]!.transform))
        .toArray(),
    );
    expect(up).toEqual([-1, 0, 0]);
  });

  it('gère la caméra active et les références lors des suppressions', () => {
    const { scene, camera, cube } = setup();
    const second = createCamera('Caméra 2');
    let next = addEntity(scene, { kind: 'camera', value: { ...second, lookAtTargetId: cube.id } });
    next = setActiveCamera(next, camera.id);
    expect(() => setActiveCamera(next, cube.id)).toThrow();
    next = removeEntities(next, [camera.id, cube.id]);
    expect(next.activeCameraId).toBe(second.id);
    expect(next.cameras[0]!.lookAtTargetId).toBeNull();
    expect(validateScene(next).success).toBe(true);
  });
});
