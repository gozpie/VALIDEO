import { z } from 'zod';
import {
  Frame,
  FrameRate,
  LinearRgb,
  Transform,
  UnitInterval,
  Uuid,
  Vec3,
  Quaternion,
} from './primitives';

export const CURRENT_SCHEMA_VERSION = 1 as const;

/**
 * Convention d'axes unique : main droite, +Y vers le haut, -Z vers l'avant, mètres.
 * Identique à glTF 2.0 ; la conversion vers Blender (Z-up) est documentée dans SCENE_SCHEMA.md.
 */
export const CoordinateSystem = z.object({
  handedness: z.literal('right'),
  upAxis: z.literal('+Y'),
  forwardAxis: z.literal('-Z'),
});

export const Units = z.object({
  length: z.literal('meter'),
  angle: z.literal('radian'),
});

export const RenderMode = z.enum(['proxy', 'final_3d', 'hybrid']);
export type RenderMode = z.infer<typeof RenderMode>;

export const NodeType = z.enum(['group', 'empty', 'primitive', 'model', 'image_plane']);
export type NodeType = z.infer<typeof NodeType>;

export const PrimitiveKind = z.enum(['cube', 'sphere', 'cylinder', 'plane', 'cone', 'torus']);
export type PrimitiveKind = z.infer<typeof PrimitiveKind>;

export const MaterialOverride = z.object({
  /** Nom de l'emplacement matériau dans l'asset ("*" = tous les emplacements). */
  slot: z.string().min(1),
  materialId: Uuid,
});

export const SceneNode = z.object({
  id: Uuid,
  name: z.string().min(1).max(200),
  type: NodeType,
  parentId: Uuid.nullable(),
  /** Référence d'asset par ID (jamais par nom de fichier) pour les types "model" et "image_plane". */
  assetId: Uuid.nullable(),
  primitive: PrimitiveKind.nullable(),
  transform: Transform,
  visible: z.boolean(),
  castShadow: z.boolean(),
  receiveShadow: z.boolean(),
  /** Verrouillage des paramètres dans l'éditeur (distinct du verrouillage d'une couche rendue). */
  locked: z.boolean(),
  layer: z.string().min(1).max(100),
  /** Index entier stable utilisé pour la passe Object ID. */
  passIndex: z.int().min(0),
  renderMode: RenderMode,
  materialOverrides: z.array(MaterialOverride),
});
export type SceneNode = z.infer<typeof SceneNode>;

export const Camera = z.object({
  id: Uuid,
  name: z.string().min(1).max(200),
  parentId: Uuid.nullable(),
  transform: Transform,
  projection: z.enum(['perspective', 'orthographic']),
  focalLengthMm: z.number().positive(),
  sensorWidthMm: z.number().positive(),
  sensorHeightMm: z.number().positive(),
  /** Hauteur visible en mètres, utilisée uniquement en projection orthographique. */
  orthographicHeight: z.number().positive().nullable(),
  nearClip: z.number().positive(),
  farClip: z.number().positive(),
  /** Distance de mise au point en mètres ; null = pas de profondeur de champ. */
  focusDistance: z.number().positive().nullable(),
  /** Ouverture en f-stops (ex. 2.8). */
  aperture: z.number().positive(),
});
export type Camera = z.infer<typeof Camera>;

export const Light = z.object({
  id: Uuid,
  name: z.string().min(1).max(200),
  parentId: Uuid.nullable(),
  transform: Transform,
  kind: z.enum(['directional', 'point', 'spot']),
  color: LinearRgb,
  /** Unités photométriques glTF : lux (directional), candela (point, spot). */
  intensity: z.number().min(0),
  /** Portée en mètres ; null = infinie. */
  range: z.number().positive().nullable(),
  /** Angles de cône en radians, uniquement pour "spot". */
  innerConeAngle: z.number().min(0).nullable(),
  outerConeAngle: z
    .number()
    .positive()
    .max(Math.PI / 2)
    .nullable(),
  castShadow: z.boolean(),
  visible: z.boolean(),
});
export type Light = z.infer<typeof Light>;

export const Material = z.object({
  id: Uuid,
  name: z.string().min(1).max(200),
  type: z.literal('pbr_metallic_roughness'),
  baseColor: LinearRgb,
  baseColorTextureAssetId: Uuid.nullable(),
  metallic: UnitInterval,
  roughness: UnitInterval,
  emissive: LinearRgb,
  emissiveStrength: z.number().min(0),
  opacity: UnitInterval,
  normalTextureAssetId: Uuid.nullable(),
});
export type Material = z.infer<typeof Material>;

export const Interpolation = z.enum([
  'step',
  'linear',
  'bezier',
  'ease_in',
  'ease_out',
  'ease_in_out',
]);
export type Interpolation = z.infer<typeof Interpolation>;

export const Extrapolation = z.enum(['constant', 'linear', 'cycle']);
export type Extrapolation = z.infer<typeof Extrapolation>;

export const ValueType = z.enum(['scalar', 'vec3', 'quaternion', 'boolean']);
export type ValueType = z.infer<typeof ValueType>;

/** Poignée de Bézier relative à la clé : décalage en frames (peut être fractionnaire) et en valeur. */
export const BezierHandle = z.object({
  frameOffset: z.number(),
  valueOffset: z.array(z.number()).min(1).max(3),
});

export const Keyframe = z.object({
  frame: Frame,
  value: z.union([z.number(), Vec3, Quaternion, z.boolean()]),
  /** Interpolation appliquée du keyframe courant vers le suivant. */
  interpolation: Interpolation,
  inHandle: BezierHandle.nullable(),
  outHandle: BezierHandle.nullable(),
});
export type Keyframe = z.infer<typeof Keyframe>;

export const AnimationTrack = z.object({
  id: Uuid,
  targetId: Uuid,
  /** Chemin de propriété, ex. "transform.position", "camera.focalLengthMm", "light.intensity". */
  propertyPath: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)+$|^visible$/),
  valueType: ValueType,
  extrapolation: Extrapolation,
  keyframes: z.array(Keyframe).min(1),
});
export type AnimationTrack = z.infer<typeof AnimationTrack>;

export const Reference = z.object({
  id: Uuid,
  assetId: Uuid,
  role: z.enum(['style', 'composition', 'character', 'environment', 'other']),
  label: z.string().max(200),
});
export type Reference = z.infer<typeof Reference>;

export const ColorManagement = z.object({
  workingSpace: z.enum(['linear_rec709', 'acescg']),
  displayTransform: z.enum(['srgb', 'rec709', 'agx', 'filmic']),
});

export const RenderSettings = z.object({
  width: z.int().min(16).max(16384),
  height: z.int().min(16).max(16384),
  frameStart: Frame,
  frameEnd: Frame,
  samples: z.int().min(1).max(65536),
  transparentBackground: z.boolean(),
  motionBlur: z.boolean(),
  antiAliasing: z.enum(['none', 'fxaa', 'msaa4', 'msaa8']),
  colorManagement: ColorManagement,
});
export type RenderSettings = z.infer<typeof RenderSettings>;

/** Liaison propriété animée → type de valeur et cible attendue. */
export const ANIMATABLE_PROPERTIES = {
  'transform.position': { valueType: 'vec3', targets: ['node', 'camera', 'light'] },
  'transform.rotation': { valueType: 'quaternion', targets: ['node', 'camera', 'light'] },
  'transform.scale': { valueType: 'vec3', targets: ['node', 'camera', 'light'] },
  visible: { valueType: 'boolean', targets: ['node', 'light'] },
  'camera.focalLengthMm': { valueType: 'scalar', targets: ['camera'] },
  'camera.focusDistance': { valueType: 'scalar', targets: ['camera'] },
  'camera.aperture': { valueType: 'scalar', targets: ['camera'] },
  'light.intensity': { valueType: 'scalar', targets: ['light'] },
  'light.color': { valueType: 'vec3', targets: ['light'] },
  'material.opacity': { valueType: 'scalar', targets: ['material'] },
} as const satisfies Record<
  string,
  { valueType: ValueType; targets: readonly ('node' | 'camera' | 'light' | 'material')[] }
>;

/** Schéma structurel (exportable en JSON Schema). Les règles d'intégrité sont dans validate.ts. */
export const SceneDocumentShape = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  sceneId: Uuid,
  coordinateSystem: CoordinateSystem,
  units: Units,
  fps: FrameRate,
  durationFrames: z.int().min(1),
  nodes: z.array(SceneNode),
  cameras: z.array(Camera),
  lights: z.array(Light),
  materials: z.array(Material),
  animations: z.array(AnimationTrack),
  references: z.array(Reference),
  renderSettings: RenderSettings,
});
export type SceneDocument = z.infer<typeof SceneDocumentShape>;

export { Quaternion, Vec3 };
