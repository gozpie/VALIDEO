import { Euler, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import type { Quaternion as Quat, Transform, Vec3 } from '@ass/scene-schema';

export function transformToMatrix(transform: Transform): Matrix4 {
  const [x, y, z, w] = transform.rotation;
  return new Matrix4().compose(
    new Vector3(...transform.position),
    new Quaternion(x, y, z, w),
    new Vector3(...transform.scale),
  );
}

/** Décomposition d'une matrice en transformation canonique (quaternion normalisé). */
export function matrixToTransform(matrix: Matrix4): Transform {
  const position = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();
  matrix.decompose(position, rotation, scale);
  rotation.normalize();
  return {
    position: micro(position.toArray()),
    rotation: [rotation.x, rotation.y, rotation.z, rotation.w].map(tidy) as Quat,
    scale: micro(scale.toArray()),
  };
}

/** Arrondit le bruit numérique (1e-12) pour des valeurs stables à l'enregistrement. */
const tidy = (value: number): number => {
  const rounded = Math.round(value * 1e9) / 1e9;
  return Object.is(rounded, -0) ? 0 : rounded;
};

/** Positions et échelles au micromètre : le bruit des produits matriciels disparaît. */
const micro = (values: number[]): Vec3 =>
  values.map((value) => {
    const rounded = Math.round(value * 1e6) / 1e6;
    return Object.is(rounded, -0) ? 0 : rounded;
  }) as Vec3;

/** Angles d'Euler en degrés (ordre XYZ), pour l'affichage dans l'inspecteur. */
export function quaternionToEulerDegrees(rotation: Quat): Vec3 {
  const [x, y, z, w] = rotation;
  const euler = new Euler().setFromQuaternion(new Quaternion(x, y, z, w), 'XYZ');
  return [euler.x, euler.y, euler.z].map((angle) => tidy(MathUtils.radToDeg(angle))) as Vec3;
}

export function eulerDegreesToQuaternion(degrees: Vec3): Quat {
  const [x, y, z] = degrees.map((angle) => MathUtils.degToRad(angle)) as Vec3;
  const euler = new Euler(x, y, z, 'XYZ');
  const q = new Quaternion().setFromEuler(euler).normalize();
  return [q.x, q.y, q.z, q.w].map(tidy) as Quat;
}

/**
 * Champ de vision vertical (degrés) d'une caméra physique, ajustement capteur horizontal :
 * FOVh = 2·atan(capteur / (2·focale)), puis FOVv = 2·atan(tan(FOVh / 2) / aspect).
 */
export function verticalFovDegrees(
  focalLengthMm: number,
  sensorWidthMm: number,
  aspect: number,
): number {
  const horizontal = 2 * Math.atan(sensorWidthMm / (2 * focalLengthMm));
  return MathUtils.radToDeg(2 * Math.atan(Math.tan(horizontal / 2) / aspect));
}
