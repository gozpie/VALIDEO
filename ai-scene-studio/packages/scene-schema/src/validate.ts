import type { z } from 'zod';
import { QUATERNION_NORM_TOLERANCE } from './primitives';
import {
  ANIMATABLE_PROPERTIES,
  SceneDocumentShape,
  type AnimationTrack,
  type SceneDocument,
  type ValueType,
} from './scene';

type TargetKind = 'node' | 'camera' | 'light' | 'material';
type Ctx = z.core.$RefinementCtx<SceneDocument>;

const VALUE_DIMENSIONS: Record<ValueType, number> = {
  scalar: 1,
  vec3: 3,
  quaternion: 4,
  boolean: 1,
};

function isValueOfType(value: unknown, valueType: ValueType): boolean {
  switch (valueType) {
    case 'scalar':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'vec3':
      return Array.isArray(value) && value.length === 3;
    case 'quaternion':
      return (
        Array.isArray(value) &&
        value.length === 4 &&
        Math.abs(Math.hypot(...(value as number[])) - 1) <= QUATERNION_NORM_TOLERANCE
      );
  }
}

function checkUniqueIds(scene: SceneDocument, ctx: Ctx): Map<string, TargetKind | 'other'> {
  const kinds = new Map<string, TargetKind | 'other'>();
  const collections: [keyof SceneDocument, TargetKind | 'other', { id: string }[]][] = [
    ['nodes', 'node', scene.nodes],
    ['cameras', 'camera', scene.cameras],
    ['lights', 'light', scene.lights],
    ['materials', 'material', scene.materials],
    ['animations', 'other', scene.animations],
    ['references', 'other', scene.references],
  ];
  for (const [key, kind, items] of collections) {
    items.forEach((item, index) => {
      if (kinds.has(item.id)) {
        ctx.addIssue({
          code: 'custom',
          path: [key, index, 'id'],
          message: `Identifiant dupliqué dans la scène : ${item.id}`,
        });
      }
      kinds.set(item.id, kind);
    });
  }
  return kinds;
}

function checkHierarchy(scene: SceneDocument, ctx: Ctx): void {
  const parentOf = new Map(scene.nodes.map((n) => [n.id, n.parentId]));
  const checkParent = (
    key: 'nodes' | 'cameras' | 'lights',
    index: number,
    parentId: string | null,
  ) => {
    if (parentId !== null && !parentOf.has(parentId)) {
      ctx.addIssue({
        code: 'custom',
        path: [key, index, 'parentId'],
        message: `Parent inexistant : ${parentId}`,
      });
    }
  };
  scene.nodes.forEach((node, index) => {
    checkParent('nodes', index, node.parentId);
    // Détection de cycle : on remonte la chaîne des parents.
    const seen = new Set<string>([node.id]);
    let current = node.parentId;
    while (current !== null && current !== undefined) {
      if (seen.has(current)) {
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', index, 'parentId'],
          message: `Cycle de parentage détecté pour le nœud ${node.id}`,
        });
        break;
      }
      seen.add(current);
      current = parentOf.get(current) ?? null;
    }
  });
  scene.cameras.forEach((c, i) => checkParent('cameras', i, c.parentId));
  scene.lights.forEach((l, i) => checkParent('lights', i, l.parentId));
}

function checkNodes(scene: SceneDocument, ctx: Ctx): void {
  const materialIds = new Set(scene.materials.map((m) => m.id));
  const passIndices = new Map<number, number>();
  scene.nodes.forEach((node, index) => {
    if ((node.type === 'primitive') !== (node.primitive !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['nodes', index, 'primitive'],
        message: 'Le champ primitive est requis pour type="primitive" et interdit sinon',
      });
    }
    if ((node.type === 'model' || node.type === 'image_plane') && node.assetId === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['nodes', index, 'assetId'],
        message: `Un nœud de type ${node.type} doit référencer un asset`,
      });
    }
    node.materialOverrides.forEach((override, overrideIndex) => {
      if (!materialIds.has(override.materialId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', index, 'materialOverrides', overrideIndex, 'materialId'],
          message: `Matériau inexistant : ${override.materialId}`,
        });
      }
    });
    if (node.passIndex > 0) {
      const previous = passIndices.get(node.passIndex);
      if (previous !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', index, 'passIndex'],
          message: `passIndex ${node.passIndex} déjà utilisé par le nœud #${previous}`,
        });
      }
      passIndices.set(node.passIndex, index);
    }
  });
}

function checkCamerasAndLights(scene: SceneDocument, ctx: Ctx): void {
  scene.cameras.forEach((camera, index) => {
    if (camera.farClip <= camera.nearClip) {
      ctx.addIssue({
        code: 'custom',
        path: ['cameras', index, 'farClip'],
        message: 'farClip doit être strictement supérieur à nearClip',
      });
    }
    if ((camera.projection === 'orthographic') !== (camera.orthographicHeight !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['cameras', index, 'orthographicHeight'],
        message: 'orthographicHeight est requis en projection orthographique et interdit sinon',
      });
    }
  });
  scene.lights.forEach((light, index) => {
    const { innerConeAngle: inner, outerConeAngle: outer } = light;
    if (light.kind !== 'spot') {
      if (inner !== null || outer !== null) {
        ctx.addIssue({
          code: 'custom',
          path: ['lights', index, 'outerConeAngle'],
          message: 'Les angles de cône sont réservés aux lumières de type spot',
        });
      }
      return;
    }
    if (inner === null || outer === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['lights', index, 'outerConeAngle'],
        message: 'Les angles de cône sont requis pour un spot',
      });
    } else if (inner > outer) {
      ctx.addIssue({
        code: 'custom',
        path: ['lights', index, 'innerConeAngle'],
        message: 'innerConeAngle doit être inférieur ou égal à outerConeAngle',
      });
    }
  });
}

function checkTrack(
  track: AnimationTrack,
  index: number,
  kinds: Map<string, TargetKind | 'other'>,
  ctx: Ctx,
): void {
  const path = ['animations', index];
  const targetKind = kinds.get(track.targetId);
  if (targetKind === undefined || targetKind === 'other') {
    ctx.addIssue({
      code: 'custom',
      path: [...path, 'targetId'],
      message: `Cible inexistante : ${track.targetId}`,
    });
  }
  const property = (
    ANIMATABLE_PROPERTIES as Record<string, { valueType: ValueType; targets: readonly string[] }>
  )[track.propertyPath];
  if (property === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: [...path, 'propertyPath'],
      message: `Propriété non animable : ${track.propertyPath}`,
    });
    return;
  }
  if (property.valueType !== track.valueType) {
    ctx.addIssue({
      code: 'custom',
      path: [...path, 'valueType'],
      message: `${track.propertyPath} attend le type ${property.valueType}`,
    });
  }
  if (
    targetKind !== undefined &&
    targetKind !== 'other' &&
    !property.targets.includes(targetKind)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: [...path, 'propertyPath'],
      message: `${track.propertyPath} n'est pas applicable à une cible de type ${targetKind}`,
    });
  }
  const dims = VALUE_DIMENSIONS[track.valueType];
  track.keyframes.forEach((key, keyIndex) => {
    const keyPath = [...path, 'keyframes', keyIndex];
    const previous = track.keyframes[keyIndex - 1];
    if (previous !== undefined && key.frame <= previous.frame) {
      ctx.addIssue({
        code: 'custom',
        path: [...keyPath, 'frame'],
        message: 'Les keyframes doivent être triés par frame strictement croissante',
      });
    }
    if (!isValueOfType(key.value, track.valueType)) {
      ctx.addIssue({
        code: 'custom',
        path: [...keyPath, 'value'],
        message: `Valeur incompatible avec le type ${track.valueType}`,
      });
    }
    if (track.valueType === 'boolean' && key.interpolation !== 'step') {
      ctx.addIssue({
        code: 'custom',
        path: [...keyPath, 'interpolation'],
        message: 'Une piste booléenne n\'accepte que l\'interpolation "step"',
      });
    }
    if (track.valueType === 'quaternion' && key.interpolation === 'bezier') {
      ctx.addIssue({
        code: 'custom',
        path: [...keyPath, 'interpolation'],
        message: 'Bézier non supporté sur une rotation : utiliser linear (slerp) ou ease_*',
      });
    }
    for (const handleKey of ['inHandle', 'outHandle'] as const) {
      const handle = key[handleKey];
      if (handle === null) continue;
      if (key.interpolation !== 'bezier' && handleKey === 'outHandle') {
        ctx.addIssue({
          code: 'custom',
          path: [...keyPath, handleKey],
          message: 'outHandle n\'est autorisé que pour une interpolation "bezier"',
        });
      }
      if (handle.valueOffset.length !== dims) {
        ctx.addIssue({
          code: 'custom',
          path: [...keyPath, handleKey, 'valueOffset'],
          message: `valueOffset doit avoir ${dims} composante(s)`,
        });
      }
    }
  });
}

function checkRenderSettings(scene: SceneDocument, ctx: Ctx): void {
  const { frameStart, frameEnd } = scene.renderSettings;
  if (frameEnd < frameStart) {
    ctx.addIssue({
      code: 'custom',
      path: ['renderSettings', 'frameEnd'],
      message: 'frameEnd doit être supérieur ou égal à frameStart',
    });
  }
  if (frameEnd >= scene.durationFrames) {
    ctx.addIssue({
      code: 'custom',
      path: ['renderSettings', 'frameEnd'],
      message: 'frameEnd doit être strictement inférieur à durationFrames',
    });
  }
}

/** Schéma complet : structure + intégrité référentielle et cohérence métier. */
export const SceneDocumentSchema = SceneDocumentShape.superRefine((scene, ctx) => {
  const kinds = checkUniqueIds(scene, ctx);
  checkHierarchy(scene, ctx);
  checkNodes(scene, ctx);
  checkCamerasAndLights(scene, ctx);
  scene.animations.forEach((track, index) => checkTrack(track, index, kinds, ctx));
  checkRenderSettings(scene, ctx);
});

export interface SceneValidationIssue {
  path: string;
  message: string;
}

export type SceneValidationResult =
  { success: true; data: SceneDocument } | { success: false; issues: SceneValidationIssue[] };

export function validateScene(input: unknown): SceneValidationResult {
  const result = SceneDocumentSchema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  };
}
