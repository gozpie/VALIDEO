import { describe, it, expect } from 'vitest';
import { makeSequence, makeTrack } from './fixtures.js';
import {
  checkTrack,
  clipAt,
  clipEnd,
  clipsInRange,
  editPoints,
  findClip,
  findTrack,
  gaps,
  indexAtOrBefore,
  linkedClips,
  nextEditPoint,
  previousEditPoint,
  sequenceDuration,
  trackDuration,
} from './query.js';

const track = makeTrack({
  id: 'v1',
  clips: [
    { id: 'a', start: 0, duration: 100 },
    { id: 'b', start: 150, duration: 50 },
    { id: 'c', start: 300, duration: 100 },
  ],
});

describe('recherche dichotomique', () => {
  it('trouve le dernier clip commençant avant ou à la position', () => {
    expect(indexAtOrBefore(track.clips, -1)).toBe(-1);
    expect(indexAtOrBefore(track.clips, 0)).toBe(0);
    expect(indexAtOrBefore(track.clips, 99)).toBe(0);
    expect(indexAtOrBefore(track.clips, 150)).toBe(1);
    expect(indexAtOrBefore(track.clips, 299)).toBe(1);
    expect(indexAtOrBefore(track.clips, 1000)).toBe(2);
  });

  it('reste correcte sur une piste vide', () => {
    expect(indexAtOrBefore([], 42)).toBe(-1);
  });

  it('donne le même résultat qu une recherche linéaire sur 2000 clips', () => {
    const many = makeTrack({
      id: 'big',
      clips: Array.from({ length: 2000 }, (_, i) => ({ id: `c${i}`, start: i * 10, duration: 7 })),
    });
    for (const t of [0, 1, 7, 9, 10, 4999, 5000, 19_999, 20_000]) {
      let expected = -1;
      for (let i = 0; i < many.clips.length; i += 1) {
        if ((many.clips[i]?.start ?? 0) <= t) expected = i;
      }
      expect(indexAtOrBefore(many.clips, t)).toBe(expected);
    }
  });
});

describe('clip à une position', () => {
  it('applique la convention [début, fin[', () => {
    expect(clipAt(track, 0)?.id).toBe('a');
    expect(clipAt(track, 99)?.id).toBe('a');
    expect(clipAt(track, 100)).toBeUndefined(); // fin exclue
    expect(clipAt(track, 149)).toBeUndefined(); // dans le trou
    expect(clipAt(track, 150)?.id).toBe('b');
  });
});

describe('plages et trous', () => {
  it('liste les clips qui intersectent une plage', () => {
    expect(clipsInRange(track, 0, 400).map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(clipsInRange(track, 100, 150).map((c) => c.id)).toEqual([]);
    expect(clipsInRange(track, 99, 151).map((c) => c.id)).toEqual(['a', 'b']);
    expect(clipsInRange(track, 200, 200)).toEqual([]);
  });

  it('liste les trous', () => {
    expect(gaps(track)).toEqual([
      { start: 100, end: 150 },
      { start: 200, end: 300 },
    ]);
  });

  it('mesure les durées', () => {
    expect(trackDuration(track)).toBe(400);
    expect(
      sequenceDuration(makeSequence([{ id: 'v1', clips: [{ id: 'a', start: 0, duration: 10 }] }])),
    ).toBe(10);
    expect(sequenceDuration(makeSequence([{ id: 'v1' }]))).toBe(0);
  });
});

describe('points de montage', () => {
  it('liste les débuts et fins', () => {
    expect(editPoints(track)).toEqual([0, 100, 150, 200, 300, 400]);
  });

  it('navigue vers le point suivant et précédent', () => {
    const seq = makeSequence([
      {
        id: 'v1',
        clips: [
          { id: 'a', start: 0, duration: 100 },
          { id: 'b', start: 150, duration: 50 },
        ],
      },
    ]);
    expect(nextEditPoint(seq, 0)).toBe(100);
    expect(nextEditPoint(seq, 100)).toBe(150);
    expect(nextEditPoint(seq, 200)).toBeNull();
    expect(previousEditPoint(seq, 200)).toBe(150);
    expect(previousEditPoint(seq, 0)).toBeNull();
  });

  it('se limite aux pistes demandées', () => {
    const seq = makeSequence([
      { id: 'v1', clips: [{ id: 'a', start: 0, duration: 100 }] },
      { id: 'v2', index: 1, clips: [{ id: 'b', start: 0, duration: 40 }] },
    ]);
    expect(nextEditPoint(seq, 0)).toBe(40);
    expect(nextEditPoint(seq, 0, ['v1'])).toBe(100);
  });
});

describe('clips liés', () => {
  it('retrouve tout le groupe', () => {
    const seq = makeSequence([
      { id: 'v1', clips: [{ id: 'img', start: 0, duration: 100, linkGroup: 'g1' }] },
      { id: 'a1', kind: 'audio', clips: [{ id: 'son', start: 0, duration: 100, linkGroup: 'g1' }] },
      { id: 'v2', index: 1, clips: [{ id: 'seul', start: 0, duration: 100 }] },
    ]);
    expect(
      linkedClips(seq, findClip(seq, 'img')!.clip)
        .map((c) => c.id)
        .sort(),
    ).toEqual(['img', 'son']);
    expect(linkedClips(seq, findClip(seq, 'seul')!.clip).map((c) => c.id)).toEqual(['seul']);
  });
});

describe('vérification des invariants', () => {
  it('accepte une piste saine', () => {
    expect(checkTrack(track)).toEqual([]);
  });

  it('détecte un chevauchement', () => {
    const bad = { ...track, clips: [track.clips[0]!, { ...track.clips[1]!, start: 50 }] };
    expect(checkTrack(bad).map((v) => v.kind)).toContain('overlap');
  });

  it('détecte un mauvais ordre', () => {
    const bad = { ...track, clips: [track.clips[2]!, track.clips[0]!] };
    expect(checkTrack(bad).map((v) => v.kind)).toContain('unsorted');
  });

  it('détecte une durée invalide', () => {
    const bad = { ...track, clips: [{ ...track.clips[0]!, duration: 0 }] };
    expect(checkTrack(bad).map((v) => v.kind)).toContain('badDuration');
  });

  it('détecte un clip rattaché à la mauvaise piste', () => {
    const bad = { ...track, clips: [{ ...track.clips[0]!, trackId: 'autre' }] };
    expect(checkTrack(bad).map((v) => v.kind)).toContain('wrongTrackId');
  });
});

describe('recherche par identifiant', () => {
  it('trouve clip et piste, ou rien', () => {
    const seq = makeSequence([{ id: 'v1', clips: [{ id: 'a', start: 0, duration: 10 }] }]);
    expect(findClip(seq, 'a')?.track.id).toBe('v1');
    expect(findClip(seq, 'x')).toBeUndefined();
    expect(findTrack(seq, 'v1')?.id).toBe('v1');
    expect(findTrack(seq, 'x')).toBeUndefined();
  });
});

describe('fin de clip', () => {
  it('est exclue', () => {
    expect(clipEnd({ ...track.clips[0]! })).toBe(100);
  });
});
