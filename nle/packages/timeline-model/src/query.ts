/**
 * Interrogation d une piste et d une sequence.
 *
 * INVARIANTS tenus par tout ce paquet, et verifiables par `checkTrack` :
 *   1. les clips d une piste sont tries par `start` croissant ;
 *   2. ils ne se chevauchent JAMAIS ;
 *   3. toute duree est >= 1 image.
 *
 * Ces invariants sont ce qui permet la recherche dichotomique ci-dessous, donc
 * la fluidite exigee par la section 2 sur des sequences de 10 000 clips.
 */
import type { ClipDoc, SequenceDoc, TrackDoc } from '@valideo/project-model';

/** Fin EXCLUE du clip sur la timeline. Un clip couvre [start, end[. */
export function clipEnd(clip: ClipDoc): number {
  return clip.start + clip.duration;
}

export function clipsSorted(clips: readonly ClipDoc[]): ClipDoc[] {
  return [...clips].sort((a, b) => a.start - b.start);
}

/**
 * Indice du dernier clip dont `start <= time`, ou -1.
 * Dichotomie : O(log n).
 */
export function indexAtOrBefore(clips: readonly ClipDoc[], time: number): number {
  let lo = 0;
  let hi = clips.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const clip = clips[mid];
    if (clip === undefined) break;
    if (clip.start <= time) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Clip couvrant `time`, ou `undefined`. Les bornes sont [start, end[. */
export function clipAt(track: TrackDoc, time: number): ClipDoc | undefined {
  const i = indexAtOrBefore(track.clips, time);
  if (i < 0) return undefined;
  const clip = track.clips[i];
  return clip !== undefined && clipEnd(clip) > time ? clip : undefined;
}

/** Tous les clips qui intersectent [start, end[. */
export function clipsInRange(track: TrackDoc, start: number, end: number): ClipDoc[] {
  if (end <= start) return [];
  const out: ClipDoc[] = [];
  let i = indexAtOrBefore(track.clips, start);
  if (i < 0) i = 0;
  for (; i < track.clips.length; i += 1) {
    const clip = track.clips[i];
    if (clip === undefined) break;
    if (clip.start >= end) break;
    if (clipEnd(clip) > start) out.push(clip);
  }
  return out;
}

export function findClip(
  sequence: SequenceDoc,
  clipId: string,
): { clip: ClipDoc; track: TrackDoc } | undefined {
  for (const track of sequence.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip !== undefined) return { clip, track };
  }
  return undefined;
}

export function findTrack(sequence: SequenceDoc, trackId: string): TrackDoc | undefined {
  return sequence.tracks.find((t) => t.id === trackId);
}

/** Derniere image occupee + 1, sur toute la sequence. 0 si vide. */
export function sequenceDuration(sequence: SequenceDoc): number {
  let max = 0;
  for (const track of sequence.tracks) {
    const last = track.clips[track.clips.length - 1];
    if (last !== undefined) max = Math.max(max, clipEnd(last));
  }
  return max;
}

export function trackDuration(track: TrackDoc): number {
  const last = track.clips[track.clips.length - 1];
  return last === undefined ? 0 : clipEnd(last);
}

/**
 * Points de coupe d une piste : debut et fin de chaque clip.
 * Sert a la navigation par raccourci (Haut/Bas) et a l accrochage.
 */
export function editPoints(track: TrackDoc): number[] {
  const points = new Set<number>();
  for (const clip of track.clips) {
    points.add(clip.start);
    points.add(clipEnd(clip));
  }
  return [...points].sort((a, b) => a - b);
}

/** Point de coupe suivant strictement `time`, sur les pistes indiquees. */
export function nextEditPoint(
  sequence: SequenceDoc,
  time: number,
  trackIds?: readonly string[],
): number | null {
  let best: number | null = null;
  for (const track of sequence.tracks) {
    if (trackIds !== undefined && !trackIds.includes(track.id)) continue;
    for (const point of editPoints(track)) {
      if (point > time && (best === null || point < best)) best = point;
    }
  }
  return best;
}

/** Point de coupe precedent strictement `time`. */
export function previousEditPoint(
  sequence: SequenceDoc,
  time: number,
  trackIds?: readonly string[],
): number | null {
  let best: number | null = null;
  for (const track of sequence.tracks) {
    if (trackIds !== undefined && !trackIds.includes(track.id)) continue;
    for (const point of editPoints(track)) {
      if (point < time && (best === null || point > best)) best = point;
    }
  }
  return best;
}

/** Espaces vides d une piste dans [from, to[. */
export function gaps(
  track: TrackDoc,
  from = 0,
  to = trackDuration(track),
): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let cursor = from;
  for (const clip of track.clips) {
    if (clipEnd(clip) <= from) continue;
    if (clip.start >= to) break;
    if (clip.start > cursor) out.push({ start: cursor, end: Math.min(clip.start, to) });
    cursor = Math.max(cursor, clipEnd(clip));
  }
  if (cursor < to) out.push({ start: cursor, end: to });
  return out;
}

/** Clips lies a celui-ci par `linkGroup` (section 80), lui compris. */
export function linkedClips(sequence: SequenceDoc, clip: ClipDoc): ClipDoc[] {
  if (clip.linkGroup === null) return [clip];
  const out: ClipDoc[] = [];
  for (const track of sequence.tracks) {
    for (const candidate of track.clips) {
      if (candidate.linkGroup === clip.linkGroup) out.push(candidate);
    }
  }
  return out;
}

export interface InvariantViolation {
  readonly trackId: string;
  readonly kind: 'unsorted' | 'overlap' | 'badDuration' | 'wrongTrackId';
  readonly detail: string;
}

/** Verifie les invariants d une piste. Utilise par les tests et le mode developpeur. */
export function checkTrack(track: TrackDoc): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  let previousEnd = Number.NEGATIVE_INFINITY;
  let previousStart = Number.NEGATIVE_INFINITY;
  for (const clip of track.clips) {
    if (clip.duration < 1) {
      out.push({
        trackId: track.id,
        kind: 'badDuration',
        detail: `${clip.id} dure ${clip.duration}`,
      });
    }
    if (clip.trackId !== track.id) {
      out.push({
        trackId: track.id,
        kind: 'wrongTrackId',
        detail: `${clip.id} pointe ${clip.trackId}`,
      });
    }
    if (clip.start < previousStart) {
      out.push({ trackId: track.id, kind: 'unsorted', detail: `${clip.id} à ${clip.start}` });
    }
    if (clip.start < previousEnd) {
      out.push({
        trackId: track.id,
        kind: 'overlap',
        detail: `${clip.id} commence à ${clip.start}, le précédent finit à ${previousEnd}`,
      });
    }
    previousStart = clip.start;
    previousEnd = clipEnd(clip);
  }
  return out;
}

export function checkSequence(sequence: SequenceDoc): InvariantViolation[] {
  return sequence.tracks.flatMap(checkTrack);
}
