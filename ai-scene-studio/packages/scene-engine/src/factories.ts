import {
  IDENTITY_TRANSFORM,
  type Camera,
  type Light,
  type LinearRgb,
  type Material,
  type PrimitiveKind,
  type SceneNode,
  type Transform,
} from '@ass/scene-schema';

export const newId = (): string => globalThis.crypto.randomUUID();

const identity = (): Transform => structuredClone(IDENTITY_TRANSFORM);

export const PRIMITIVE_LABELS: Record<PrimitiveKind, string> = {
  cube: 'Cube',
  sphere: 'Sphère',
  cylinder: 'Cylindre',
  plane: 'Plan',
  cone: 'Cône',
  torus: 'Tore',
};

function baseNode(name: string, type: SceneNode['type']): SceneNode {
  return {
    id: newId(),
    name,
    type,
    parentId: null,
    assetId: null,
    primitive: null,
    transform: identity(),
    visible: true,
    castShadow: true,
    receiveShadow: true,
    locked: false,
    layer: 'default',
    passIndex: 0,
    renderMode: 'final_3d',
    materialOverrides: [],
  };
}

export function createPrimitiveNode(kind: PrimitiveKind): SceneNode {
  const node = baseNode(PRIMITIVE_LABELS[kind], 'primitive');
  node.primitive = kind;
  // Posé sur le sol (y = 0) plutôt que traversé par lui ; le plan reste au niveau du sol.
  if (kind !== 'plane') node.transform.position = [0, kind === 'torus' ? 0.125 : 0.5, 0];
  return node;
}

export function createEmptyNode(name = 'Empty'): SceneNode {
  const node = baseNode(name, 'empty');
  node.castShadow = false;
  node.receiveShadow = false;
  return node;
}

export function createGroupNode(name = 'Groupe'): SceneNode {
  const node = baseNode(name, 'group');
  node.castShadow = false;
  node.receiveShadow = false;
  return node;
}

export function createModelNode(assetId: string, name: string): SceneNode {
  const node = baseNode(name, 'model');
  node.assetId = assetId;
  return node;
}

/** Caméra 35 mm plein format (capteur 36 × 24 mm), placée en retrait et à hauteur d'œil. */
export function createCamera(name = 'Caméra'): Camera {
  return {
    id: newId(),
    name,
    parentId: null,
    transform: { position: [0, 1.6, 5], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    projection: 'perspective',
    focalLengthMm: 35,
    sensorWidthMm: 36,
    sensorHeightMm: 24,
    orthographicHeight: null,
    nearClip: 0.1,
    farClip: 1000,
    focusDistance: null,
    aperture: 2.8,
    locked: false,
    lookAtTargetId: null,
    rollRadians: 0,
  };
}

const LIGHT_LABELS: Record<Light['kind'], string> = {
  directional: 'Lumière directionnelle',
  point: 'Lumière ponctuelle',
  spot: 'Projecteur',
};

/** Intensités photométriques glTF : lux (directionnelle), candela (ponctuelle, projecteur). */
export function createLight(kind: Light['kind']): Light {
  const pointing45: Transform['rotation'] = [-0.3826834, 0, 0, 0.9238795];
  return {
    id: newId(),
    name: LIGHT_LABELS[kind],
    parentId: null,
    transform: {
      position: kind === 'directional' ? [0, 10, 0] : [0, 3, 2],
      rotation: kind === 'point' ? [0, 0, 0, 1] : pointing45,
      scale: [1, 1, 1],
    },
    kind,
    color: [1, 1, 1],
    intensity: kind === 'directional' ? 3 : 50,
    range: null,
    innerConeAngle: kind === 'spot' ? 0.3 : null,
    outerConeAngle: kind === 'spot' ? 0.5 : null,
    castShadow: true,
    visible: true,
  };
}

export function createMaterial(name: string, baseColor: LinearRgb): Material {
  return {
    id: newId(),
    name,
    type: 'pbr_metallic_roughness',
    baseColor,
    baseColorTextureAssetId: null,
    metallic: 0,
    roughness: 0.6,
    emissive: [0, 0, 0],
    emissiveStrength: 0,
    opacity: 1,
    normalTextureAssetId: null,
  };
}
