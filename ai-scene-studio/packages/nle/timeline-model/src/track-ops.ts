/**
 * Transformations elementaires d une piste.
 *
 * Toutes sont PURES : elles retournent une nouvelle piste et ne mutent rien.
 * Toutes preservent les invariants de `query.ts` : clips tries, sans
 * chevauchement, de duree >= 1.
 *
 * Les operations de montage professionnelles (`edit-ops.ts`) sont toutes
 * construites a partir de ces quatre primitives : couper, vider une plage,
 * ouvrir un trou, refermer un trou.
 */
import { newClipId } from '@valideo/shared';
import type { ClipDoc, ParameterDoc, TrackDoc, TransitionDoc } from '@valideo/project-model';
import { clipEnd, clipsInRange } from './query';
import type { TimelineContext } from './source';
import { shiftedSourceIn } from './source';

function withClips(track: TrackDoc, clips: readonly ClipDoc[]): TrackDoc {
  return { ...track, clips: [...clips].sort((a, b) => a.start - b.start) };
}

/**
 * Les images clés sont datées depuis le début du clip : quand ce début avance avec la source, elles
 * reculent d'autant pour rester sur la même image du média. Une clé peut alors tomber avant le début :
 * elle sert encore à calculer la valeur (couper un zoom en deux ne le casse pas).
 */
export function decalerCles(clip: ClipDoc, delta: number): ClipDoc {
  if (delta === 0) return clip;
  const decaler = <P extends ParameterDoc>(p: P): P =>
    p.keyframes.length === 0
      ? p
      : { ...p, keyframes: p.keyframes.map((k) => ({ ...k, time: k.time - delta })) };
  return {
    ...clip,
    opacity: decaler(clip.opacity),
    transform: {
      position: decaler(clip.transform.position),
      scale: decaler(clip.transform.scale),
      rotation: decaler(clip.transform.rotation),
      anchorPoint: decaler(clip.transform.anchorPoint),
    },
    audio: { ...clip.audio, gainDb: decaler(clip.audio.gainDb), pan: decaler(clip.audio.pan) },
  };
}

/** Raccourcit un clip par la GAUCHE, en avancant son point d entree source. */
export function trimHead(clip: ClipDoc, newStart: number, ctx: TimelineContext): ClipDoc {
  const delta = newStart - clip.start;
  return {
    ...decalerCles(clip, delta),
    start: newStart,
    duration: clip.duration - delta,
    sourceIn: shiftedSourceIn(clip, delta, ctx),
  };
}

/** Raccourcit un clip par la DROITE. Le point d entree source ne bouge pas. */
export function trimTail(clip: ClipDoc, newEnd: number): ClipDoc {
  return { ...clip, duration: newEnd - clip.start };
}

/**
 * Coupe la piste a `time`. Un clip a cheval devient deux clips adjacents dont
 * la somme couvre exactement la meme plage et la meme portion de source.
 * Sans effet si aucun clip n est a cheval (une coupe sur une coupe existante
 * n est pas une coupe).
 */
export function splitAt(track: TrackDoc, time: number, ctx: TimelineContext): TrackDoc {
  const out: ClipDoc[] = [];
  let transitions = track.transitions;
  let changed = false;
  for (const clip of track.clips) {
    if (clip.start < time && clipEnd(clip) > time) {
      const droite = { ...trimHead(clip, time, ctx), id: newClipId() };
      out.push(trimTail(clip, time));
      out.push(droite);
      transitions = suivreQueue(transitions, clip.id, droite.id);
      changed = true;
    } else {
      out.push(clip);
    }
  }
  return changed ? { ...withClips(track, out), transitions } : track;
}

/** La fin d'un clip coupé appartient désormais à sa moitié droite : sa transition de sortie la suit. */
function suivreQueue(
  transitions: readonly TransitionDoc[],
  ancien: string,
  nouveau: string,
): TransitionDoc[] {
  return transitions.map((t) => (t.fromClipId === ancien ? { ...t, fromClipId: nouveau } : t));
}

/**
 * Vide [start, end[ de la piste, en laissant le trou. C est la primitive du
 * Lift et de l Overwrite.
 */
export function clearRange(
  track: TrackDoc,
  start: number,
  end: number,
  ctx: TimelineContext,
): TrackDoc {
  if (end <= start) return track;
  const affected = clipsInRange(track, start, end);
  if (affected.length === 0) return track;

  const affectedIds = new Set(affected.map((c) => c.id));
  const out: ClipDoc[] = track.clips.filter((c) => !affectedIds.has(c.id));
  let transitions = track.transitions;

  for (const clip of affected) {
    const ce = clipEnd(clip);
    const coveredLeft = clip.start >= start;
    const coveredRight = ce <= end;

    if (coveredLeft && coveredRight) continue; // entierement supprime

    if (!coveredLeft && !coveredRight) {
      // A cheval des deux cotes : il reste une tete et une queue.
      const queue = { ...trimHead(clip, end, ctx), id: newClipId() };
      out.push(trimTail(clip, start));
      out.push(queue);
      transitions = suivreQueue(transitions, clip.id, queue.id);
      continue;
    }
    if (!coveredLeft) {
      out.push(trimTail(clip, start)); // il ne reste que la tete
      continue;
    }
    out.push(trimHead(clip, end, ctx)); // il ne reste que la queue
  }

  return { ...withClips(track, out), transitions };
}

/**
 * Ouvre un trou de `amount` images a partir de `at`. Un clip a cheval est
 * d abord coupe : c est le comportement attendu d un Insert (section 91).
 */
export function openGap(
  track: TrackDoc,
  at: number,
  amount: number,
  ctx: TimelineContext,
): TrackDoc {
  if (amount <= 0) return track;
  const split = splitAt(track, at, ctx);
  return withClips(
    split,
    split.clips.map((clip) => (clip.start >= at ? { ...clip, start: clip.start + amount } : clip)),
  );
}

/**
 * Referme un trou de `amount` images a partir de `at`.
 * La plage [at, at + amount[ doit avoir ete videe au prealable.
 */
export function closeGap(track: TrackDoc, at: number, amount: number): TrackDoc {
  if (amount <= 0) return track;
  return withClips(
    track,
    track.clips.map((clip) =>
      clip.start >= at + amount ? { ...clip, start: clip.start - amount } : clip,
    ),
  );
}

/** Pose un clip, en supposant la plage deja libre. */
export function placeClip(track: TrackDoc, clip: ClipDoc): TrackDoc {
  return withClips(track, [...track.clips, { ...clip, trackId: track.id }]);
}

export function removeClip(track: TrackDoc, clipId: string): TrackDoc {
  return { ...track, clips: track.clips.filter((c) => c.id !== clipId) };
}

export function updateClip(track: TrackDoc, clipId: string, patch: Partial<ClipDoc>): TrackDoc {
  return withClips(
    track,
    track.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)),
  );
}

/** Applique une transformation a une piste d une liste, sans toucher aux autres. */
export function mapTrack(
  tracks: readonly TrackDoc[],
  trackId: string,
  fn: (track: TrackDoc) => TrackDoc,
): TrackDoc[] {
  return tracks.map((t) => (t.id === trackId ? fn(t) : t));
}
