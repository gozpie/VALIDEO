/**
 * Fabriques de sequences pour les tests.
 *
 * Les identifiants sont lisibles ('v1', 'c1') plutot que des UUID : un echec de
 * test doit se lire sans decodeur. Le schema n est pas revalide ici, ces objets
 * ne franchissent aucune frontiere de persistance.
 */
import { newClipId, newTrackId } from '@valideo/shared';
import type { ClipDoc, SequenceDoc, TrackDoc } from '@valideo/project-model';
import { createClip, createSequence, createTrack, toTimeBaseDoc } from '@valideo/project-model';
import type { Rational, TimeBase } from '@valideo/time-core';
import { TIMEBASES, rational } from '@valideo/time-core';
import type { SourceInfo, SourceResolver, TimelineContext } from './source.js';

export interface ClipSpec {
  readonly id: string;
  readonly start: number;
  readonly duration: number;
  readonly sourceIn?: number;
  readonly mediaId?: string;
  readonly speed?: { n: number; d: number };
  readonly reverse?: boolean;
  readonly linkGroup?: string;
}

export function makeClip(
  trackId: string,
  spec: ClipSpec,
  kind: 'video' | 'audio' = 'video',
): ClipDoc {
  const base = createClip(kind, trackId, spec.start, spec.duration, {
    sourceIn: spec.sourceIn ?? 0,
    mediaId: spec.mediaId ?? 'media-1',
    name: spec.id,
  });
  return {
    ...base,
    id: newClipId.of(spec.id),
    speed: spec.speed ?? base.speed,
    reverse: spec.reverse ?? false,
    linkGroup: spec.linkGroup === undefined ? null : newClipId.of(spec.linkGroup),
  };
}

export interface TrackSpec {
  readonly id: string;
  readonly kind?: 'video' | 'audio';
  readonly index?: number;
  readonly clips?: readonly ClipSpec[];
  readonly locked?: boolean;
  readonly syncLock?: boolean;
  readonly targeted?: boolean;
}

export function makeTrack(spec: TrackSpec): TrackDoc {
  const kind = spec.kind ?? 'video';
  const base = createTrack(kind, spec.index ?? 0);
  const id = newTrackId.of(spec.id);
  return {
    ...base,
    id,
    name: spec.id.toUpperCase(),
    locked: spec.locked ?? false,
    syncLock: spec.syncLock ?? true,
    targeted: spec.targeted ?? false,
    clips: (spec.clips ?? []).map((c) => makeClip(id, c, kind)),
  };
}

export function makeSequence(
  tracks: readonly TrackSpec[],
  timebase: TimeBase = TIMEBASES.TB25,
): SequenceDoc {
  const base = createSequence('Test', { timebase });
  return { ...base, timebase: toTimeBaseDoc(timebase), tracks: tracks.map(makeTrack) };
}

/** Source generique : 10 000 images disponibles a partir de 0. */
export function abundantSource(rate: Rational = rational(25), count = 10_000): SourceResolver {
  const info: SourceInfo = { first: 0, count, rate };
  return () => info;
}

/** Source etroite : utile pour tester les butees de poignees. */
export function boundedSource(
  first: number,
  count: number,
  rate: Rational = rational(25),
): SourceResolver {
  const info: SourceInfo = { first, count, rate };
  return () => info;
}

export function makeContext(
  timebase: TimeBase = TIMEBASES.TB25,
  resolveSource: SourceResolver = abundantSource(timebase.rate),
): TimelineContext {
  return { timebase, resolveSource };
}

/** Vue compacte d une piste : `[start, end[` de chaque clip. Facilite les assertions. */
export function layout(sequence: SequenceDoc, trackId: string): string {
  const track = sequence.tracks.find((t) => t.id === trackId);
  if (track === undefined) return '<piste absente>';
  return track.clips.map((c) => `${c.name || c.id}[${c.start},${c.start + c.duration})`).join(' ');
}
