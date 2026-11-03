/**
 * Passage de la scène canonique à Three.js. Même convention d'axes (glTF : +Y haut, −Z avant,
 * mètres) : aucune conversion de repère, seulement des correspondances de propriétés.
 */
import type { BufferGeometry, PerspectiveCamera } from 'three';
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  LinearSRGBColorSpace,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
  type Object3D,
} from 'three';
import type { Camera, Material, PrimitiveKind, Transform } from '@ass/scene-schema';
import { verticalFovDegrees } from '../math';

/**
 * Géométries unitaires de SCENE_SCHEMA.md : centrées à l'origine, axe principal +Y ; plan 1 × 1 m
 * dans XZ (normale +Y) ; tore de rayon 0,5 m et tube 0,125 m couché dans XZ.
 */
export function createPrimitiveGeometry(kind: PrimitiveKind): BufferGeometry {
  switch (kind) {
    case 'cube':
      return new BoxGeometry(1, 1, 1);
    case 'sphere':
      return new SphereGeometry(0.5, 48, 24);
    case 'cylinder':
      return new CylinderGeometry(0.5, 0.5, 1, 48);
    case 'cone':
      return new ConeGeometry(0.5, 1, 48);
    case 'plane':
      return new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    case 'torus':
      return new TorusGeometry(0.5, 0.125, 24, 64).rotateX(Math.PI / 2);
  }
}

export function applyTransform(object: Object3D, transform: Transform): void {
  object.position.fromArray(transform.position);
  object.quaternion.fromArray(transform.rotation);
  object.scale.fromArray(transform.scale);
}

export function readTransform(object: Object3D): Transform {
  const q = object.quaternion.clone().normalize();
  return {
    position: object.position.toArray(),
    rotation: [q.x, q.y, q.z, q.w],
    scale: object.scale.toArray(),
  };
}

/** Couleur canonique (RGB linéaire) vers Three.js, sans double conversion sRGB. */
export function linearColor([r, g, b]: readonly [number, number, number]): Color {
  return new Color().setRGB(r, g, b, LinearSRGBColorSpace);
}

export const DEFAULT_COLOR: readonly [number, number, number] = [0.6, 0.6, 0.6];

export function createMaterial(material: Material | null): MeshStandardMaterial {
  if (!material)
    return new MeshStandardMaterial({ color: linearColor(DEFAULT_COLOR), roughness: 0.6 });
  return new MeshStandardMaterial({
    color: linearColor(material.baseColor),
    metalness: material.metallic,
    roughness: material.roughness,
    emissive: linearColor(material.emissive),
    emissiveIntensity: material.emissiveStrength,
    opacity: material.opacity,
    transparent: material.opacity < 1,
  });
}

/** Caméra Three.js équivalente (perspective) pour un rapport largeur/hauteur de rendu. */
export function applyPhysicalCamera(
  target: PerspectiveCamera,
  camera: Camera,
  aspect: number,
): void {
  target.fov = verticalFovDegrees(camera.focalLengthMm, camera.sensorWidthMm, aspect);
  target.aspect = aspect;
  target.near = camera.nearClip;
  target.far = camera.farClip;
  target.updateProjectionMatrix();
}
