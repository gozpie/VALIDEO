/** Édition pure des pistes et des keyframes (l'entrée n'est jamais modifiée). */
import {
  ANIMATABLE_PROPERTIES,
  type AnimationTrack,
  type Interpolation,
  type Keyframe,
  type SceneDocument,
  type Transform,
} from '@ass/scene-schema';

export type PropertyPath = keyof typeof ANIMATABLE_PROPERTIES;
export interface KeyRef {
  trackId: string;
  frame: number;
}
export interface ClipboardEntry {
  targetId: string;
  propertyPath: PropertyPath;
  /** Décalage par rapport à la première clé copiée. */
  offset: number;
  key: Keyframe;
}

const newId = (): string => globalThis.crypto.randomUUID();

export function trackFor(
  scene: SceneDocument,
  targetId: string,
  propertyPath: string,
): AnimationTrack | undefined {
  return scene.animations.find((t) => t.targetId === targetId && t.propertyPath === propertyPath);
}

/** Interpolation admise pour un type de valeur (booléen : step ; rotation : pas de Bézier). */
function allowed(
  valueType: AnimationTrack['valueType'],
  interpolation: Interpolation,
): Interpolation {
  if (valueType === 'boolean') return 'step';
  if (valueType === 'quaternion' && interpolation === 'bezier') return 'linear';
  return interpolation;
}

/** Crée ou remplace la clé d'une propriété à une frame entière (la piste est créée au besoin). */
export function setKey(
  scene: SceneDocument,
  {
    targetId,
    propertyPath,
    frame,
    value,
    interpolation,
  }: {
    targetId: string;
    propertyPath: PropertyPath;
    frame: number;
    value: Keyframe['value'];
    interpolation?: Interpolation;
  },
  template?: Keyframe,
): SceneDocument {
  if (!Number.isInteger(frame) || frame < 0)
    throw new Error('Une clé se place sur une frame entière positive');
  const next = structuredClone(scene);
  const valueType = ANIMATABLE_PROPERTIES[propertyPath].valueType;
  let track = trackFor(next, targetId, propertyPath);
  if (!track) {
    track = {
      id: newId(),
      targetId,
      propertyPath,
      valueType,
      extrapolation: 'constant',
      keyframes: [],
    };
    next.animations.push(track);
  }
  const existing = track.keyframes.find((k) => k.frame === frame);
  const base: Keyframe = template ??
    existing ?? { frame, value, interpolation: 'linear', inHandle: null, outHandle: null };
  const key: Keyframe = {
    ...structuredClone(base),
    frame,
    value: structuredClone(value),
    interpolation: allowed(valueType, interpolation ?? base.interpolation),
  };
  if (key.interpolation !== 'bezier') key.outHandle = null;
  track.keyframes = [...track.keyframes.filter((k) => k.frame !== frame), key].sort(
    (a, b) => a.frame - b.frame,
  );
  return next;
}

export function removeKeys(scene: SceneDocument, refs: KeyRef[]): SceneDocument {
  const next = structuredClone(scene);
  for (const track of next.animations) {
    track.keyframes = track.keyframes.filter(
      (k) => !refs.some((r) => r.trackId === track.id && r.frame === k.frame),
    );
  }
  next.animations = next.animations.filter((t) => t.keyframes.length > 0);
  return next;
}

/** Décale des clés d'un nombre entier de frames ; refuse une collision ou une frame négative. */
export function moveKeys(scene: SceneDocument, refs: KeyRef[], delta: number): SceneDocument {
  if (!Number.isInteger(delta)) throw new Error('Décalage en frames entières');
  if (delta === 0) return scene;
  const next = structuredClone(scene);
  for (const track of next.animations) {
    const moving = new Set(refs.filter((r) => r.trackId === track.id).map((r) => r.frame));
    if (moving.size === 0) continue;
    const moved = track.keyframes.map((k) =>
      moving.has(k.frame) ? { ...k, frame: k.frame + delta } : k,
    );
    const frames = moved.map((k) => k.frame);
    if (frames.some((f) => f < 0)) throw new Error('Une clé ne peut pas précéder la frame 0');
    if (new Set(frames).size !== frames.length)
      throw new Error('Deux clés occuperaient la même frame');
    track.keyframes = moved.sort((a, b) => a.frame - b.frame);
  }
  return next;
}

export function copyKeys(scene: SceneDocument, refs: KeyRef[]): ClipboardEntry[] {
  const entries: Omit<ClipboardEntry, 'offset'>[] = [];
  for (const ref of refs) {
    const track = scene.animations.find((t) => t.id === ref.trackId);
    const key = track?.keyframes.find((k) => k.frame === ref.frame);
    if (track && key) {
      entries.push({
        targetId: track.targetId,
        propertyPath: track.propertyPath as PropertyPath,
        key: structuredClone(key),
      });
    }
  }
  const origin = Math.min(...entries.map((e) => e.key.frame));
  return entries.map((e) => ({ ...e, offset: e.key.frame - origin }));
}

/** Colle des clés à partir d'une frame, sur les mêmes cibles (ignorées si elles n'existent plus). */
export function pasteKeys(
  scene: SceneDocument,
  clipboard: ClipboardEntry[],
  atFrame: number,
): SceneDocument {
  const ids = new Set(
    [...scene.nodes, ...scene.cameras, ...scene.lights, ...scene.materials].map((e) => e.id),
  );
  return clipboard
    .filter((entry) => ids.has(entry.targetId))
    .reduce(
      (acc, entry) =>
        setKey(
          acc,
          {
            targetId: entry.targetId,
            propertyPath: entry.propertyPath,
            frame: atFrame + entry.offset,
            value: entry.key.value,
          },
          entry.key,
        ),
      scene,
    );
}

const TRANSFORM_PATHS = [
  ['transform.position', 'position'],
  ['transform.rotation', 'rotation'],
  ['transform.scale', 'scale'],
] as const;

/**
 * Applique une transformation éditée à une frame : chaque composante déjà animée reçoit une clé à
 * cette frame, les autres modifient la valeur de base. Sans cela, une modification d'une propriété
 * animée serait aussitôt écrasée par l'animation.
 */
export function setTransformAtFrame(
  scene: SceneDocument,
  id: string,
  transform: Transform,
  frame: number,
): SceneDocument {
  let next = structuredClone(scene);
  const find = (doc: SceneDocument) =>
    doc.nodes.find((n) => n.id === id) ??
    doc.cameras.find((c) => c.id === id) ??
    doc.lights.find((l) => l.id === id);
  if (!find(next)) throw new Error(`Entité inconnue : ${id}`);
  for (const [path, field] of TRANSFORM_PATHS) {
    if (trackFor(next, id, path)) {
      next = setKey(next, {
        targetId: id,
        propertyPath: path,
        frame: Math.round(frame),
        value: transform[field],
      });
    } else {
      const entity = find(next);
      if (entity)
        entity.transform = { ...entity.transform, [field]: structuredClone(transform[field]) };
    }
  }
  return next;
}

/** Ajoute une clé de position, rotation et échelle avec la transformation donnée (raccourci K). */
export function keyTransform(
  scene: SceneDocument,
  id: string,
  transform: Transform,
  frame: number,
): SceneDocument {
  return TRANSFORM_PATHS.reduce(
    (acc, [path, field]) =>
      setKey(acc, { targetId: id, propertyPath: path, frame, value: transform[field] }),
    scene,
  );
}
