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
import type { ClipDoc, TrackDoc } from '@valideo/project-model';
import { clipEnd, clipsInRange } from './query.js';
import type { TimelineContext } from './source.js';
import { shiftedSourceIn } from './source.js';

function withClips(track: TrackDoc, clips: readonly ClipDoc[]): TrackDoc {
  return { ...track, clips: [...clips].sort((a, b) => a.start - b.start) };
}

/** Raccourcit un clip par la GAUCHE, en avancant son point d entree source. */
export function trimHead(clip: ClipDoc, newStart: number, ctx: TimelineContext): ClipDoc {
  const delta = newStart - clip.start;
  return {
    ...clip,
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
  let changed = false;
  for (const clip of track.clips) {
    if (clip.start < time && clipEnd(clip) > time) {
      out.push(trimTail(clip, time));
      out.push({ ...trimHead(clip, time, ctx), id: newClipId() });
      changed = true;
    } else {
      out.push(clip);
    }
  }
  return changed ? withClips(track, out) : track;
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

  for (const clip of affected) {
    const ce = clipEnd(clip);
    const coveredLeft = clip.start >= start;
    const coveredRight = ce <= end;

    if (coveredLeft && coveredRight) continue; // entierement supprime

    if (!coveredLeft && !coveredRight) {
      // A cheval des deux cotes : il reste une tete et une queue.
      out.push(trimTail(clip, start));
      out.push({ ...trimHead(clip, end, ctx), id: newClipId() });
      continue;
    }
    if (!coveredLeft) {
      out.push(trimTail(clip, start)); // il ne reste que la tete
      continue;
    }
    out.push(trimHead(clip, end, ctx)); // il ne reste que la queue
  }

  return withClips(track, out);
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
