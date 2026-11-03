import { describe, expect, it } from 'vitest';
import type { Box3 } from 'three';
import { Object3D, PerspectiveCamera, Vector3 } from 'three';
import {
  createCamera,
  eulerDegreesToQuaternion,
  quaternionToEulerDegrees,
  verticalFovDegrees,
} from '../src';
import {
  applyPhysicalCamera,
  applyTransform,
  createPrimitiveGeometry,
  linearColor,
  readTransform,
} from '../src/three';

const size = (kind: Parameters<typeof createPrimitiveGeometry>[0]) => {
  const geometry = createPrimitiveGeometry(kind);
  geometry.computeBoundingBox();
  return (geometry.boundingBox as Box3)
    .getSize(new Vector3())
    .toArray()
    .map((v) => Math.round(v * 1000) / 1000);
};

describe('conversion vers Three.js', () => {
  it('respecte les dimensions unitaires des primitives', () => {
    expect(size('cube')).toEqual([1, 1, 1]);
    expect(size('sphere')).toEqual([1, 1, 1]);
    expect(size('cylinder')).toEqual([1, 1, 1]);
    expect(size('cone')).toEqual([1, 1, 1]);
    // Plan dans XZ, normale +Y ; tore couché dans XZ (épaisseur = 2 × 0,125 m).
    expect(size('plane')).toEqual([1, 0, 1]);
    expect(size('torus')).toEqual([1.25, 0.25, 1.25]);
    const normal = createPrimitiveGeometry('plane').getAttribute('normal');
    expect([normal.getX(0), normal.getY(0), normal.getZ(0)].map(Math.round)).toEqual([0, 1, 0]);
  });

  it('calcule le champ de vision d’une caméra physique (ajustement horizontal)', () => {
    // 35 mm sur capteur 36 mm : FOVh = 54,43° ; en 16:9, FOVv = 32,27°.
    expect(verticalFovDegrees(35, 36, 1)).toBeCloseTo(54.4322, 3);
    expect(verticalFovDegrees(35, 36, 16 / 9)).toBeCloseTo(32.2688, 3);
    const camera = new PerspectiveCamera();
    applyPhysicalCamera(camera, createCamera(), 16 / 9);
    expect(camera.fov).toBeCloseTo(32.2688, 3);
    expect(camera.near).toBe(0.1);
  });

  it('applique et relit une transformation sans perte', () => {
    const object = new Object3D();
    const transform = {
      position: [1, 2, 3],
      rotation: eulerDegreesToQuaternion([10, 20, 30]),
      scale: [2, 1, 0.5],
    } as const;
    applyTransform(object, { ...transform, position: [1, 2, 3], scale: [2, 1, 0.5] });
    const back = readTransform(object);
    expect(back.position).toEqual([1, 2, 3]);
    expect(back.scale).toEqual([2, 1, 0.5]);
    expect(quaternionToEulerDegrees(back.rotation).map(Math.round)).toEqual([10, 20, 30]);
  });

  it('conserve les couleurs linéaires', () => {
    const color = linearColor([0.5, 0.25, 1]);
    expect([color.r, color.g, color.b]).toEqual([0.5, 0.25, 1]);
  });
});
