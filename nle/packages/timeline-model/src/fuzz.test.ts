/**
 * Test de robustesse par operations aleatoires.
 *
 * Objectif : prouver qu AUCUNE combinaison d operations de montage ne peut
 * laisser la timeline dans un etat incoherent. C est la propriete qui compte le
 * plus dans un NLE : un chevauchement ou un clip de duree nulle introduits
 * silencieusement se manifestent bien plus tard, au rendu ou a l export, quand
 * l origine est devenue impossible a retrouver.
 *
 * Le generateur est deterministe : un echec est rejouable a l identique.
 */
import { describe, it, expect } from 'vitest';
import { isErr, isOk } from '@valideo/shared';
import type { SequenceDoc } from '@valideo/project-model';
import { TIMEBASES } from '@valideo/time-core';
import { abundantSource, makeClip, makeContext, makeSequence } from './fixtures.js';
import { checkSequence, clipEnd, sequenceDuration } from './query.js';
import {
  deleteClip,
  extract,
  insert,
  lift,
  moveClip,
  overwrite,
  razor,
  rollEdit,
  slideClip,
  slipClip,
  trimClip,
} from './edit-ops.js';
import type { EditResult } from './edit-ops.js';

/** Generateur pseudo-aleatoire deterministe (mulberry32). */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ctx = makeContext(TIMEBASES.TB25, abundantSource());

function initialSequence(): SequenceDoc {
  return makeSequence([
    {
      id: 'v1',
      targeted: true,
      clips: [
        { id: 'a', start: 0, duration: 120, sourceIn: 1000 },
        { id: 'b', start: 120, duration: 80, sourceIn: 2000 },
        { id: 'c', start: 250, duration: 150, sourceIn: 3000 },
      ],
    },
    {
      id: 'v2',
      index: 1,
      clips: [{ id: 'd', start: 40, duration: 200, sourceIn: 4000 }],
    },
    {
      id: 'a1',
      kind: 'audio',
      clips: [{ id: 'e', start: 0, duration: 300, sourceIn: 5000 }],
    },
  ]);
}

function allClipIds(seq: SequenceDoc): string[] {
  return seq.tracks.flatMap((t) => t.clips.map((c) => c.id));
}

function randomOperation(seq: SequenceDoc, rnd: () => number, step: number): EditResult {
  const trackIds = seq.tracks.map((t) => t.id);
  const clipIds = allClipIds(seq);
  const pickTrack = () => trackIds[Math.floor(rnd() * trackIds.length)] ?? 'v1';
  const pickClip = () => clipIds[Math.floor(rnd() * clipIds.length)];
  const pos = () => Math.floor(rnd() * 500);
  const delta = () => Math.floor(rnd() * 120) - 60;

  const clip = pickClip();
  switch (Math.floor(rnd() * 11)) {
    case 0: {
      const trackId = pickTrack();
      const track = seq.tracks.find((t) => t.id === trackId);
      const kind = track?.kind === 'audio' ? 'audio' : 'video';
      return overwrite(
        seq,
        {
          clip: makeClip(
            trackId,
            { id: `o${step}`, start: 0, duration: 1 + Math.floor(rnd() * 90) },
            kind,
          ),
          trackId,
          at: pos(),
        },
        ctx,
      );
    }
    case 1: {
      const trackId = pickTrack();
      const track = seq.tracks.find((t) => t.id === trackId);
      const kind = track?.kind === 'audio' ? 'audio' : 'video';
      return insert(
        seq,
        {
          clip: makeClip(
            trackId,
            { id: `i${step}`, start: 0, duration: 1 + Math.floor(rnd() * 90) },
            kind,
          ),
          trackId,
          at: pos(),
        },
        ctx,
      );
    }
    case 2: {
      const start = pos();
      return lift(
        seq,
        { start, end: start + 1 + Math.floor(rnd() * 100), trackIds: [pickTrack()] },
        ctx,
      );
    }
    case 3: {
      const start = pos();
      return extract(
        seq,
        { start, end: start + 1 + Math.floor(rnd() * 100), trackIds: [pickTrack()] },
        ctx,
      );
    }
    case 4:
      return razor(seq, pos(), [pickTrack()], ctx);
    case 5:
      return clip === undefined
        ? lift(seq, { start: 0, end: 1, trackIds: ['v1'] }, ctx)
        : deleteClip(seq, clip, ctx, rnd() < 0.5);
    case 6:
      return clip === undefined
        ? razor(seq, 0, ['v1'], ctx)
        : moveClip(seq, { clipId: clip, toStart: pos() }, ctx);
    case 7:
      return clip === undefined
        ? razor(seq, 0, ['v1'], ctx)
        : trimClip(
            seq,
            {
              clipId: clip,
              edge: rnd() < 0.5 ? 'in' : 'out',
              delta: delta(),
              mode: rnd() < 0.5 ? 'ripple' : 'normal',
            },
            ctx,
          );
    case 8:
      return clip === undefined ? razor(seq, 0, ['v1'], ctx) : slipClip(seq, clip, delta(), ctx);
    case 9:
      return clip === undefined ? razor(seq, 0, ['v1'], ctx) : slideClip(seq, clip, delta(), ctx);
    default:
      return rollEdit(seq, pickTrack(), pos(), delta(), ctx);
  }
}

describe('robustesse — opérations aléatoires', () => {
  for (const seed of [1, 7, 42, 1337, 90210]) {
    it(`n aboutit jamais à un montage incohérent (graine ${seed})`, () => {
      const rnd = makeRandom(seed);
      let seq = initialSequence();
      let applied = 0;
      let refused = 0;

      for (let step = 0; step < 800; step += 1) {
        const result = randomOperation(seq, rnd, step);
        if (isOk(result)) {
          const violations = checkSequence(result.value);
          if (violations.length > 0) {
            throw new Error(
              `Étape ${step} (graine ${seed}) : ${violations[0]?.kind} — ${violations[0]?.detail}`,
            );
          }
          seq = result.value;
          applied += 1;
        } else {
          expect(isErr(result)).toBe(true);
          refused += 1;
        }
      }

      // Le test ne vaut que si les opérations aboutissent vraiment.
      expect(applied).toBeGreaterThan(300);
      expect(applied + refused).toBe(800);
      expect(checkSequence(seq)).toEqual([]);
    });
  }

  it('ne produit jamais un clip de durée nulle ou négative', () => {
    const rnd = makeRandom(2024);
    let seq = initialSequence();
    for (let step = 0; step < 800; step += 1) {
      const result = randomOperation(seq, rnd, step);
      if (isOk(result)) seq = result.value;
    }
    for (const track of seq.tracks) {
      for (const clip of track.clips) {
        expect(clip.duration).toBeGreaterThanOrEqual(1);
        expect(clip.start).toBeGreaterThanOrEqual(0);
        expect(clipEnd(clip)).toBeGreaterThan(clip.start);
      }
    }
  });

  it('ne lève jamais : tout refus passe par un résultat d erreur', () => {
    const rnd = makeRandom(31337);
    let seq = initialSequence();
    expect(() => {
      for (let step = 0; step < 800; step += 1) {
        const result = randomOperation(seq, rnd, step);
        if (isOk(result)) seq = result.value;
      }
    }).not.toThrow();
    expect(sequenceDuration(seq)).toBeGreaterThanOrEqual(0);
  });
});
