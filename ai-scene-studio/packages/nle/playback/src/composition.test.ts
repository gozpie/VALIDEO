import { describe, expect, it } from 'vitest';
import { createClip, createSequence, createTitle } from '@valideo/project-model';
import type { ClipDoc, SequenceDoc, TrackDoc } from '@valideo/project-model';
import { poserTransition } from '@valideo/timeline-model';
import { composerImage, type SourcesComposition } from './composition';

const SOURCES: SourcesComposition = {
  cadenceSource: () => 25,
  dureeSource: (id) => (id === 'fixe' ? 0 : 10),
};

function doc(placer: (v1: TrackDoc, v2: TrackDoc) => [ClipDoc[], ClipDoc[]]): SequenceDoc {
  const seq = createSequence('s', { videoTracks: 2, audioTracks: 0 });
  const [v1, v2] = seq.tracks;
  if (v1 === undefined || v2 === undefined) throw new Error('pistes');
  const [c1, c2] = placer(v1, v2);
  return {
    ...seq,
    tracks: [
      { ...v1, clips: c1 },
      { ...v2, clips: c2 },
    ],
  };
}

const video = (trackId: string, start: number, duration: number, sourceIn = 0): ClipDoc =>
  createClip('video', trackId, start, duration, { mediaId: 'm', sourceIn, name: `c${start}` });

describe('composition', () => {
  it('empile les pistes de bas en haut', () => {
    const seq = doc((v1, v2) => [[video(v1.id, 0, 50)], [video(v2.id, 0, 50, 25)]]);
    const couches = composerImage(seq, 10, SOURCES);
    expect(couches.map((c) => c.entrant?.secondesSource)).toEqual([0.4, 1.4]);
    expect(couches[0]?.trackId).toBe(seq.tracks[0]?.id);
  });

  it('ignore une piste masquée, un clip désactivé, et là où il n’y a rien', () => {
    const seq = doc((v1, v2) => [
      [{ ...video(v1.id, 0, 50), enabled: false }],
      [video(v2.id, 0, 50)],
    ]);
    expect(composerImage(seq, 10, SOURCES)).toHaveLength(1);
    expect(composerImage(seq, 100, SOURCES)).toHaveLength(0);
    const masquee = {
      ...seq,
      tracks: seq.tracks.map((t) => ({ ...t, enabled: false })),
    };
    expect(composerImage(masquee, 10, SOURCES)).toEqual([]);
  });

  it('rend opacité, échelle, position et rotation, images clés comprises', () => {
    const seq = doc((v1) => [
      [
        {
          ...video(v1.id, 10, 50),
          opacity: {
            value: 100,
            keyframes: [
              {
                id: 'a',
                time: 0,
                value: 0,
                interpolation: 'linear',
                inHandle: null,
                outHandle: null,
              },
              {
                id: 'b',
                time: 20,
                value: 100,
                interpolation: 'linear',
                inHandle: null,
                outHandle: null,
              },
            ],
          },
          transform: {
            position: { value: [40, -20], keyframes: [] },
            scale: { value: [150, 150], keyframes: [] },
            rotation: { value: 12, keyframes: [] },
            anchorPoint: { value: [0, 0], keyframes: [] },
          },
          blendMode: 'screen',
        },
      ],
      [],
    ]);
    const calque = composerImage(seq, 20, SOURCES)[0]?.entrant;
    expect(calque?.opacite).toBe(0.5);
    expect(calque?.position).toEqual([40, -20]);
    expect(calque?.echelle).toEqual([1.5, 1.5]);
    expect(calque?.rotation).toBe(12);
    expect(calque?.fusion).toBe('screen');
  });

  it('un titre et un plan en attente sont des calques sans média', () => {
    const titre = createTitle({ text: 'Fin' });
    const seq = doc((v1, v2) => [
      [createClip('colorMatte', v1.id, 0, 50, { name: 'Plan 3' })],
      [{ ...createClip('title', v2.id, 0, 50), title: titre }],
    ]);
    const [attente, texte] = composerImage(seq, 5, SOURCES);
    expect(attente?.entrant?.nature).toBe('attente');
    expect(texte?.entrant?.nature).toBe('titre');
    expect(texte?.entrant?.titre).toEqual(titre);
  });

  it('dans un fondu enchaîné, les deux clips sont là et débordent sur leur média', () => {
    const base = doc((v1) => [[video(v1.id, 0, 50, 100), video(v1.id, 50, 50, 100)], []]);
    const [a, b] = base.tracks[0]?.clips ?? [];
    const r = poserTransition(base, {
      trackId: base.tracks[0]?.id ?? '',
      fromClipId: a?.id ?? null,
      toClipId: b?.id ?? null,
      type: 'dissolve',
      duration: 20,
    });
    if (!r.ok) throw new Error('pose');
    const avant = composerImage(r.value, 39, SOURCES)[0];
    expect(avant?.transition).toBeNull();
    const debut = composerImage(r.value, 40, SOURCES)[0];
    expect(debut?.sortant?.clipId).toBe(a?.id);
    expect(debut?.entrant?.clipId).toBe(b?.id);
    expect(debut?.transition?.progression).toBeCloseTo(1 / 21);
    // Le clip entrant commence avant sa place : 10 images plus tôt dans son média.
    expect(debut?.entrant?.secondesSource).toBeCloseTo((100 - 10) / 25);
    const fin = composerImage(r.value, 59, SOURCES)[0];
    expect(fin?.transition?.progression).toBeCloseTo(20 / 21);
    // Le clip sortant continue après sa fin.
    expect(fin?.sortant?.secondesSource).toBeCloseTo((100 + 59) / 25);
    expect(composerImage(r.value, 60, SOURCES)[0]?.transition).toBeNull();
  });

  it('fige l’image quand le débord sort du média', () => {
    const base = doc((v1) => [[video(v1.id, 0, 50, 0), video(v1.id, 50, 50, 0)], []]);
    const [a, b] = base.tracks[0]?.clips ?? [];
    const r = poserTransition(base, {
      trackId: base.tracks[0]?.id ?? '',
      fromClipId: a?.id ?? null,
      toClipId: b?.id ?? null,
      type: 'dissolve',
      duration: 20,
    });
    if (!r.ok) throw new Error('pose');
    // L'entrant part de sourceIn 0 : avant, il n'y a rien, il reste sur sa première image.
    expect(composerImage(r.value, 45, SOURCES)[0]?.entrant?.secondesSource).toBe(0);
  });

  it('un fondu d’entrée n’a qu’un entrant', () => {
    const base = doc((v1) => [[video(v1.id, 10, 50)], []]);
    const a = base.tracks[0]?.clips[0];
    const r = poserTransition(base, {
      trackId: base.tracks[0]?.id ?? '',
      fromClipId: null,
      toClipId: a?.id ?? null,
      type: 'dissolve',
      duration: 10,
    });
    if (!r.ok) throw new Error('pose');
    const couche = composerImage(r.value, 12, SOURCES)[0];
    expect(couche?.sortant).toBeNull();
    expect(couche?.entrant?.clipId).toBe(a?.id);
    expect(couche?.transition?.progression).toBeCloseTo(3 / 11);
  });
});
