import { keyTransform, setTransformAtFrame } from '@ass/animation-engine';
import type { LinearRgb, PrimitiveKind, SceneDocument, Transform } from '@ass/scene-schema';
import {
  addEntity,
  createCamera,
  createLight,
  createPrimitiveNode,
  eulerDegreesToQuaternion,
  findEntity,
  removeEntities,
  renameEntity,
  setActiveCamera,
  setCameraLookAt,
  setNodeColor,
  updateCamera,
  updateLight,
  type Entity,
} from '@ass/scene-engine';
import { evaluateFrame } from '@ass/scene-engine';

/**
 * Opérations de scène proposées par Claude (mode « assistant de scène ») et leur traduction en
 * opérations de l'éditeur. Rien n'est appliqué sans action de l'utilisateur ; l'ensemble forme une
 * seule étape d'annulation. Une opération invalide (cible inconnue, valeur hors bornes) est ignorée
 * et signalée, sans empêcher les suivantes.
 */
export interface AiOperation {
  op: string;
  target?: string;
  name?: string;
  primitive?: string;
  lightKind?: string;
  position?: number[];
  rotationDegrees?: number[];
  scale?: number[];
  color?: number[];
  frame?: number;
  focalLengthMm?: number;
  lookAt?: string;
}

export interface AiApplyResult {
  scene: SceneDocument;
  applied: number;
  skipped: { index: number; op: string; reason: string }[];
}

const PRIMITIVES = new Set<PrimitiveKind>(['cube', 'sphere', 'cylinder', 'plane', 'cone', 'torus']);
const LIGHTS = new Set(['directional', 'point', 'spot']);

const vec3 = (value: number[] | undefined): [number, number, number] | null =>
  value && value.length === 3 && value.every(Number.isFinite)
    ? [value[0] as number, value[1] as number, value[2] as number]
    : null;

const srgbToLinear = (c: number) => {
  const v = Math.min(1, Math.max(0, c));
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

function byName(scene: SceneDocument, name: string | undefined): Entity | null {
  if (!name) return null;
  const all: Entity[] = [
    ...scene.nodes.map((value): Entity => ({ kind: 'node', value })),
    ...scene.cameras.map((value): Entity => ({ kind: 'camera', value })),
    ...scene.lights.map((value): Entity => ({ kind: 'light', value })),
  ];
  // Nom exact d'abord, puis sans tenir compte de la casse.
  return (
    all.find((e) => e.value.name === name) ??
    all.find((e) => e.value.name.toLowerCase() === name.toLowerCase()) ??
    null
  );
}

/** Transformation demandée, complétée par la transformation évaluée à la frame courante. */
function transformFor(
  scene: SceneDocument,
  id: string,
  op: AiOperation,
  frame: number,
): Transform | null {
  const current = findEntity(evaluateFrame(scene, frame), id);
  if (!current) return null;
  const position = vec3(op.position);
  const rotation = vec3(op.rotationDegrees);
  const scale = vec3(op.scale);
  if (!position && !rotation && !scale) return null;
  return {
    position: position ?? current.value.transform.position,
    rotation: rotation ? eulerDegreesToQuaternion(rotation) : current.value.transform.rotation,
    scale: scale ?? current.value.transform.scale,
  };
}

export function applyAiOperations(
  scene: SceneDocument,
  operations: AiOperation[],
  frame: number,
): AiApplyResult {
  let next = scene;
  let applied = 0;
  const skipped: AiApplyResult['skipped'] = [];

  operations.forEach((op, index) => {
    const skip = (reason: string) => skipped.push({ index, op: op.op, reason });
    try {
      const withTransform = (entity: Entity) => {
        const transform = transformFor(next, entity.value.id, op, frame);
        if (transform) next = setTransformAtFrame(next, entity.value.id, transform, frame);
      };
      switch (op.op) {
        case 'add_primitive': {
          if (!PRIMITIVES.has(op.primitive as PrimitiveKind)) return skip('primitive inconnue');
          const node = createPrimitiveNode(op.primitive as PrimitiveKind);
          if (op.name) node.name = op.name.slice(0, 200);
          next = addEntity(next, { kind: 'node', value: node });
          withTransform({ kind: 'node', value: node });
          const color = vec3(op.color);
          if (color)
            next = setNodeColor(next, node.id, color.map(srgbToLinear) as unknown as LinearRgb);
          break;
        }
        case 'add_camera': {
          const camera = createCamera(op.name?.slice(0, 200) || 'Caméra');
          if (op.focalLengthMm && op.focalLengthMm > 0) camera.focalLengthMm = op.focalLengthMm;
          next = addEntity(next, { kind: 'camera', value: camera });
          withTransform({ kind: 'camera', value: camera });
          if (next.activeCameraId === null) next = setActiveCamera(next, camera.id);
          break;
        }
        case 'add_light': {
          if (!LIGHTS.has(op.lightKind ?? '')) return skip('type de lumière inconnu');
          const light = createLight(op.lightKind as 'directional' | 'point' | 'spot');
          if (op.name) light.name = op.name.slice(0, 200);
          const color = vec3(op.color);
          if (color) light.color = color.map(srgbToLinear) as unknown as LinearRgb;
          next = addEntity(next, { kind: 'light', value: light });
          withTransform({ kind: 'light', value: light });
          break;
        }
        default: {
          const target = byName(next, op.target);
          if (!target) return skip(`« ${op.target ?? '?'} » introuvable`);
          const id = target.value.id;
          if (op.op === 'set_transform') {
            const transform = transformFor(next, id, op, frame);
            if (!transform) return skip('aucune valeur de transformation');
            next = setTransformAtFrame(next, id, transform, frame);
          } else if (op.op === 'set_key') {
            const at = Number.isInteger(op.frame) ? (op.frame as number) : frame;
            if (at < 0 || at >= next.durationFrames) return skip('frame hors du plan');
            const transform =
              transformFor(next, id, op, at) ??
              findEntity(evaluateFrame(next, at), id)?.value.transform;
            if (!transform) return skip('transformation introuvable');
            next = keyTransform(next, id, transform, at);
          } else if (op.op === 'delete') {
            next = removeEntities(next, [id]);
          } else if (op.op === 'rename') {
            if (!op.name) return skip('nouveau nom manquant');
            next = renameEntity(next, id, op.name.slice(0, 200));
          } else if (op.op === 'set_color') {
            const color = vec3(op.color);
            if (!color) return skip('couleur invalide');
            const linear = color.map(srgbToLinear) as unknown as LinearRgb;
            if (target.kind === 'node') next = setNodeColor(next, id, linear);
            else if (target.kind === 'light') next = updateLight(next, id, { color: linear });
            else return skip('une caméra n’a pas de couleur');
          } else if (op.op === 'set_active_camera') {
            if (target.kind !== 'camera') return skip('la cible n’est pas une caméra');
            next = setActiveCamera(next, id);
          } else if (op.op === 'look_at') {
            if (target.kind !== 'camera') return skip('seule une caméra peut viser');
            const aim = byName(next, op.lookAt);
            if (!aim) return skip(`cible « ${op.lookAt ?? '?'} » introuvable`);
            next = setCameraLookAt(next, id, aim.value.id);
          } else {
            return skip('opération inconnue');
          }
          if (op.focalLengthMm && target.kind === 'camera' && op.op !== 'look_at')
            next = updateCamera(next, id, { focalLengthMm: op.focalLengthMm });
        }
      }
      applied += 1;
    } catch (error) {
      skip((error as Error).message);
    }
  });
  return { scene: next, applied, skipped };
}

/** Libellé lisible d'une opération (aperçu avant application). */
export function describeOperation(op: AiOperation): string {
  const values = [
    op.position && `position (${op.position.map((v) => v.toFixed(2)).join(', ')})`,
    op.rotationDegrees && `rotation (${op.rotationDegrees.map((v) => v.toFixed(0)).join('°, ')}°)`,
    op.scale && `échelle (${op.scale.map((v) => v.toFixed(2)).join(', ')})`,
    op.frame !== undefined && `frame ${op.frame}`,
    op.focalLengthMm && `${op.focalLengthMm} mm`,
  ]
    .filter(Boolean)
    .join(', ');
  const head: Record<string, string> = {
    add_primitive: `Ajouter ${op.primitive ?? ''} « ${op.name ?? ''} »`,
    add_camera: `Ajouter la caméra « ${op.name ?? 'Caméra'} »`,
    add_light: `Ajouter une lumière ${op.lightKind ?? ''} « ${op.name ?? ''} »`,
    set_transform: `Transformer « ${op.target ?? ''} »`,
    set_key: `Clé sur « ${op.target ?? ''} »`,
    delete: `Supprimer « ${op.target ?? ''} »`,
    rename: `Renommer « ${op.target ?? ''} » en « ${op.name ?? ''} »`,
    set_color: `Couleur de « ${op.target ?? ''} »`,
    set_active_camera: `Caméra active : « ${op.target ?? ''} »`,
    look_at: `« ${op.target ?? ''} » vise « ${op.lookAt ?? ''} »`,
  };
  return [head[op.op] ?? op.op, values].filter(Boolean).join(' — ');
}
