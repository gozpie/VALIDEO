import { createEmptyScene } from '@ass/scene-schema';
import { addEntity, createPrimitiveNode, evaluateFrame, nodeColor } from '@ass/scene-engine';
import { describe, expect, it } from 'vitest';
import { applyAiOperations, describeOperation } from '@/editor/aiOperations';

const base = () => {
  const scene = createEmptyScene({ sceneId: '00000000-0000-4000-8000-0000000000aa' });
  scene.durationFrames = 48;
  const cube = createPrimitiveNode('cube');
  return addEntity(scene, { kind: 'node', value: cube });
};

describe('opérations de scène proposées par Claude', () => {
  it('ajoute, transforme, colore et anime en une seule passe', () => {
    const { scene, applied, skipped } = applyAiOperations(
      base(),
      [
        {
          op: 'add_primitive',
          primitive: 'sphere',
          name: 'Boule',
          position: [-2, 0.5, 0],
          color: [1, 0, 0],
        },
        { op: 'add_light', lightKind: 'point', name: 'Chaude', position: [0, 3, 0] },
        { op: 'add_camera', name: 'Plan large', position: [0, 1.6, 6], focalLengthMm: 28 },
        { op: 'look_at', target: 'Plan large', lookAt: 'Cube' },
        { op: 'set_key', target: 'Cube', frame: 0 },
        { op: 'set_key', target: 'cube', frame: 24, position: [1, 0.5, 0] },
        { op: 'rename', target: 'Cube', name: 'Héros' },
      ],
      0,
    );
    expect(skipped).toEqual([]);
    expect(applied).toBe(7);
    const sphere = scene.nodes.find((n) => n.name === 'Boule');
    expect(sphere?.primitive).toBe('sphere');
    expect(sphere?.transform.position).toEqual([-2, 0.5, 0]);
    // sRGB (1, 0, 0) → linéaire (1, 0, 0).
    expect(nodeColor(scene, sphere?.id ?? '')).toEqual([1, 0, 0]);
    expect(scene.lights[0]?.name).toBe('Chaude');
    const camera = scene.cameras[0];
    expect(camera?.focalLengthMm).toBe(28);
    expect(scene.activeCameraId).toBe(camera?.id);
    const hero = scene.nodes.find((n) => n.name === 'Héros');
    expect(camera?.lookAtTargetId).toBe(hero?.id);
    const at24 = evaluateFrame(scene, 24).nodes.find((n) => n.id === hero?.id);
    expect(at24?.transform.position).toEqual([1, 0.5, 0]);
    const at0 = evaluateFrame(scene, 0).nodes.find((n) => n.id === hero?.id);
    expect(at0?.transform.position).toEqual([0, 0.5, 0]);
  });

  it('ignore et explique les opérations impossibles sans bloquer les autres', () => {
    const { scene, applied, skipped } = applyAiOperations(
      base(),
      [
        { op: 'delete', target: 'Fantôme' },
        { op: 'add_primitive', primitive: 'teapot' },
        { op: 'set_key', target: 'Cube', frame: 999 },
        { op: 'set_color', target: 'Cube', color: [0, 0.5] },
        { op: 'look_at', target: 'Cube', lookAt: 'Cube' },
        { op: 'explode', target: 'Cube' },
        { op: 'set_transform', target: 'Cube', scale: [2, 2, 2] },
      ],
      0,
    );
    expect(applied).toBe(1);
    expect(skipped.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(skipped[0]?.reason).toContain('Fantôme');
    expect(scene.nodes[0]?.transform.scale).toEqual([2, 2, 2]);
  });

  it('fait un mouvement de caméra d’une phrase : orbite autour du cube, centrée sur lui', () => {
    const { scene, applied, skipped } = applyAiOperations(
      base(),
      [
        { op: 'add_camera', name: 'Cam', position: [0, 1.5, 4] },
        { op: 'look_at', target: 'Cam', lookAt: 'Cube' },
        {
          op: 'camera_move',
          target: 'Cam',
          move: 'orbite_droite',
          amount: 90,
          lookAt: 'Cube',
          frame: 0,
          endFrame: 47,
        },
        { op: 'camera_move', target: 'Cube', move: 'travelling_avant' },
        { op: 'camera_move', target: 'Cam', move: 'saut_perilleux' },
      ],
      0,
    );
    expect(applied).toBe(3);
    expect(skipped.map((s) => s.reason)).toEqual([
      'seule une caméra fait un mouvement',
      'mouvement inconnu',
    ]);
    const camera = scene.cameras.find((c) => c.name === 'Cam');
    const debut = evaluateFrame(scene, 0).cameras.find((c) => c.id === camera?.id);
    const fin = evaluateFrame(scene, 47).cameras.find((c) => c.id === camera?.id);
    expect(debut?.transform.position[0]).toBeCloseTo(0, 5);
    // Un quart de tour autour du cube : la caméra passe de face à côté, à la même distance.
    const [x, , z] = fin?.transform.position ?? [0, 0, 0];
    expect(Math.hypot(x, z)).toBeCloseTo(4, 4);
    expect(Math.abs(x)).toBeCloseTo(4, 4);
    expect(
      describeOperation({ op: 'camera_move', target: 'Cam', move: 'orbite_droite', amount: 90 }),
    ).toBe('Orbite droite de « Cam » (90 °)');
  });

  it('décrit chaque opération pour l’aperçu', () => {
    expect(describeOperation({ op: 'set_transform', target: 'Cube', position: [1, 2, 3] })).toBe(
      'Transformer « Cube » — position (1.00, 2.00, 3.00)',
    );
    expect(describeOperation({ op: 'look_at', target: 'Caméra', lookAt: 'Cube' })).toBe(
      '« Caméra » vise « Cube »',
    );
  });
});
