/**
 * Évaluation d'une scène à une frame : `evaluateScene(scene, frame)` renvoie une nouvelle scène dont
 * les propriétés animées ont la valeur de cette frame. Le temps est le numéro de frame (fractionnaire
 * autorisé pour les sous-échantillonnages), jamais l'horloge du navigateur. Fonction pure.
 */
import type { AnimationTrack, Keyframe, SceneDocument } from '@ass/scene-schema';
import {
  bezierSegment,
  lerp,
  progress,
  slerp,
  toArray,
  type Quat,
  type Value,
} from './interpolate';

const COMPONENTS = { scalar: 1, vec3: 3, quaternion: 4, boolean: 1 } as const;

function asValue(track: AnimationTrack, numbers: number[]): Value {
  switch (track.valueType) {
    case 'scalar':
      return numbers[0] ?? 0;
    case 'boolean':
      return (numbers[0] ?? 0) >= 0.5;
    case 'vec3':
      return [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0];
    case 'quaternion':
      return numbers as Quat;
  }
}

function segment(track: AnimationTrack, a: Keyframe, b: Keyframe, frame: number): Value {
  const t = (frame - a.frame) / (b.frame - a.frame);
  if (track.valueType === 'boolean' || a.interpolation === 'step') return a.value as Value;
  if (track.valueType === 'quaternion')
    return slerp(a.value as Quat, b.value as Quat, progress(a.interpolation, t));
  const n = COMPONENTS[track.valueType];
  if (a.interpolation === 'bezier') return asValue(track, bezierSegment(a, b, frame, n));
  const k = progress(a.interpolation, t);
  const va = toArray(a.value, n);
  const vb = toArray(b.value, n);
  return asValue(
    track,
    va.map((value, index) => lerp(value, vb[index] ?? 0, k)),
  );
}

/** Valeur d'une piste à une frame, extrapolation comprise. */
export function evaluateTrack(track: AnimationTrack, frame: number): Value {
  const keys = track.keyframes;
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (!first || !last) throw new Error('Piste sans keyframe');
  if (keys.length === 1) return first.value as Value;

  let f = frame;
  if (track.extrapolation === 'cycle' && (f < first.frame || f > last.frame)) {
    const span = last.frame - first.frame;
    f = first.frame + ((((f - first.frame) % span) + span) % span);
  }
  if (f <= first.frame || f >= last.frame) {
    const before = f <= first.frame;
    const edge = before ? first : last;
    const neighbour = before ? keys[1] : keys[keys.length - 2];
    // Extrapolation linéaire : pente du segment extrême (grandeurs continues uniquement).
    if (
      track.extrapolation === 'linear' &&
      neighbour &&
      (track.valueType === 'scalar' || track.valueType === 'vec3')
    ) {
      const n = COMPONENTS[track.valueType];
      const ve = toArray(edge.value, n);
      const vn = toArray(neighbour.value, n);
      const slope = ve.map((value, i) => (value - (vn[i] ?? 0)) / (edge.frame - neighbour.frame));
      return asValue(
        track,
        ve.map((value, i) => value + (slope[i] ?? 0) * (f - edge.frame)),
      );
    }
    return edge.value as Value;
  }
  // Recherche dichotomique du segment contenant f.
  let lo = 0;
  let hi = keys.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((keys[mid] as Keyframe).frame <= f) lo = mid;
    else hi = mid;
  }
  return segment(track, keys[lo] as Keyframe, keys[hi] as Keyframe, f);
}

function assign(scene: SceneDocument, track: AnimationTrack, value: Value): void {
  const id = track.targetId;
  const target =
    scene.nodes.find((n) => n.id === id) ??
    scene.cameras.find((c) => c.id === id) ??
    scene.lights.find((l) => l.id === id);
  const material = scene.materials.find((m) => m.id === id);
  switch (track.propertyPath) {
    case 'transform.position':
      if (target) target.transform.position = value as [number, number, number];
      return;
    case 'transform.rotation':
      if (target) target.transform.rotation = value as Quat;
      return;
    case 'transform.scale':
      if (target) target.transform.scale = value as [number, number, number];
      return;
    case 'visible':
      if (target && 'visible' in target) target.visible = value as boolean;
      return;
    case 'camera.focalLengthMm':
    case 'camera.focusDistance':
    case 'camera.aperture': {
      const camera = scene.cameras.find((c) => c.id === id);
      const key = track.propertyPath.slice('camera.'.length) as
        'focalLengthMm' | 'focusDistance' | 'aperture';
      // Une grandeur physique ne descend pas sous un minimum strictement positif (dépassement de Bézier).
      if (camera) camera[key] = Math.max(value as number, 1e-6);
      return;
    }
    case 'light.intensity': {
      const light = scene.lights.find((l) => l.id === id);
      if (light) light.intensity = Math.max(value as number, 0);
      return;
    }
    case 'light.color': {
      const light = scene.lights.find((l) => l.id === id);
      if (light)
        light.color = (value as [number, number, number]).map((c) => Math.max(c, 0)) as [
          number,
          number,
          number,
        ];
      return;
    }
    case 'material.opacity':
      if (material) material.opacity = Math.min(Math.max(value as number, 0), 1);
      return;
  }
}

/** Scène évaluée à la frame donnée (l'entrée n'est jamais modifiée). */
export function evaluateScene(scene: SceneDocument, frame: number): SceneDocument {
  if (!Number.isFinite(frame)) throw new Error('Frame non finie');
  if (scene.animations.length === 0) return scene;
  const evaluated = structuredClone(scene);
  for (const track of scene.animations) assign(evaluated, track, evaluateTrack(track, frame));
  return evaluated;
}
