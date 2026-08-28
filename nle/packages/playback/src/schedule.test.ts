import { describe, it, expect } from 'vitest';
import { TIMEBASES, rational } from '@valideo/time-core';
import { makeSequence } from '@valideo/timeline-model/fixtures';
import type { SequenceDoc } from '@valideo/project-model';
import { planifierAudio, pistesAudibles } from './schedule.js';

/** Toutes les sources sont à 25 i/s, comme la séquence, sauf mention contraire. */
const source25 = () => rational(25);

function sequenceAudio(): SequenceDoc {
  return makeSequence([
    {
      id: 'a1',
      kind: 'audio',
      clips: [
        { id: 'a', start: 0, duration: 50, sourceIn: 0, mediaId: 'm1' },
        { id: 'b', start: 50, duration: 50, sourceIn: 100, mediaId: 'm2' },
      ],
    },
    {
      id: 'a2',
      kind: 'audio',
      index: 1,
      clips: [{ id: 'fond', start: 0, duration: 200, sourceIn: 0, mediaId: 'm3' }],
    },
  ]);
}

describe('pistes audibles', () => {
  it('retient toutes les pistes audio non muettes', () => {
    expect(pistesAudibles(sequenceAudio()).map((t) => t.id)).toEqual(['a1', 'a2']);
  });

  it('écarte une piste muette', () => {
    const seq = sequenceAudio();
    const muette = {
      ...seq,
      tracks: seq.tracks.map((t) => (t.id === 'a2' ? { ...t, muted: true } : t)),
    };
    expect(pistesAudibles(muette).map((t) => t.id)).toEqual(['a1']);
  });

  it('le solo prime sur tout le reste', () => {
    const seq = sequenceAudio();
    const solo = {
      ...seq,
      tracks: seq.tracks.map((t) => (t.id === 'a2' ? { ...t, solo: true } : t)),
    };
    expect(pistesAudibles(solo).map((t) => t.id)).toEqual(['a2']);
  });

  it('une piste en solo ET muette reste silencieuse', () => {
    const seq = sequenceAudio();
    const bizarre = {
      ...seq,
      tracks: seq.tracks.map((t) => (t.id === 'a2' ? { ...t, solo: true, muted: true } : t)),
    };
    expect(pistesAudibles(bizarre)).toEqual([]);
  });
});

describe('plan de lecture (§22)', () => {
  const plan = (de: number, a: number, seq = sequenceAudio()) =>
    planifierAudio(seq, { de, a, cadenceSource: source25 });

  it('planifie les clips de la fenêtre demandée', () => {
    const { segments } = plan(0, 100);
    expect(segments.map((s) => s.clipId).sort()).toEqual(['a', 'b', 'fond']);
  });

  it('convertit les images en secondes', () => {
    const { segments } = plan(0, 50);
    const a = segments.find((s) => s.clipId === 'a');
    expect(a?.debutTimeline).toBeCloseTo(0, 9);
    expect(a?.dureeTimeline).toBeCloseTo(2, 9); // 50 images à 25 i/s
  });

  it('convertit le point d entrée source en secondes', () => {
    const { segments } = plan(50, 100);
    const b = segments.find((s) => s.clipId === 'b');
    // sourceIn 100 images à 25 i/s = 4 s dans le fichier.
    expect(b?.offsetSource).toBeCloseTo(4, 9);
    expect(b?.debutTimeline).toBeCloseTo(2, 9);
  });

  it('ENTRE au bon endroit du fichier quand la lecture démarre au milieu d un clip', () => {
    // On démarre à l'image 75, soit 25 images après le début de b.
    const { segments } = plan(75, 100);
    const b = segments.find((s) => s.clipId === 'b');
    expect(b?.debutTimeline).toBeCloseTo(3, 9);
    // 4 s d'entrée + 1 s déjà consommée dans le clip.
    expect(b?.offsetSource).toBeCloseTo(5, 9);
    expect(b?.dureeTimeline).toBeCloseTo(1, 9);
  });

  it('tronque un clip qui déborde de la fenêtre', () => {
    const { segments } = plan(0, 25);
    const fond = segments.find((s) => s.clipId === 'fond');
    expect(fond?.dureeTimeline).toBeCloseTo(1, 9);
  });

  it('rend une fenêtre vide sans erreur', () => {
    expect(plan(500, 600).segments).toEqual([]);
    expect(plan(10, 10).segments).toEqual([]);
    expect(plan(50, 10).segments).toEqual([]);
  });

  it('tient compte de la vitesse pour l entrée dans le fichier', () => {
    const seq = makeSequence([
      {
        id: 'a1',
        kind: 'audio',
        clips: [
          { id: 'x', start: 0, duration: 100, sourceIn: 0, mediaId: 'm', speed: { n: 2, d: 1 } },
        ],
      },
    ]);
    const { segments } = planifierAudio(seq, { de: 50, a: 100, cadenceSource: source25 });
    const x = segments[0];
    expect(x?.vitesse).toBe(2);
    // 50 images de timeline à 200 % ont consommé 4 s de source, pas 2 s.
    expect(x?.offsetSource).toBeCloseTo(4, 9);
  });

  it('gère une source de cadence différente de la séquence', () => {
    const seq = makeSequence([
      {
        id: 'a1',
        kind: 'audio',
        clips: [{ id: 'x', start: 0, duration: 50, sourceIn: 100, mediaId: 'm' }],
      },
    ]);
    // Source à 50 i/s : 100 images d'entrée valent 2 s, pas 4 s.
    const { segments } = planifierAudio(seq, { de: 0, a: 50, cadenceSource: () => rational(50) });
    expect(segments[0]?.offsetSource).toBeCloseTo(2, 9);
  });

  it('convertit le gain en décibels vers un facteur linéaire', () => {
    const seq = sequenceAudio();
    const avecGain = {
      ...seq,
      tracks: seq.tracks.map((t) =>
        t.id === 'a1'
          ? {
              ...t,
              clips: t.clips.map((c) =>
                c.id === 'a'
                  ? { ...c, audio: { ...c.audio, gainDb: { value: -6.0206, keyframes: [] } } }
                  : c,
              ),
            }
          : t,
      ),
    };
    const { segments } = planifierAudio(avecGain, { de: 0, a: 50, cadenceSource: source25 });
    expect(segments.find((s) => s.clipId === 'a')?.gain).toBeCloseTo(0.5, 4);
  });

  it('applique un gain unitaire par défaut', () => {
    expect(plan(0, 50).segments[0]?.gain).toBeCloseTo(1, 9);
  });
});

describe('ce que le plan REFUSE de jouer (§1003)', () => {
  it('ignore un clip sans média plutôt que d inventer du son', () => {
    const seq = makeSequence([
      { id: 'a1', kind: 'audio', clips: [{ id: 'vide', start: 0, duration: 50 }] },
    ]);
    const sansMedia = {
      ...seq,
      tracks: seq.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => ({ ...c, mediaId: null })),
      })),
    };
    const { segments, ignores } = planifierAudio(sansMedia, {
      de: 0,
      a: 50,
      cadenceSource: source25,
    });
    expect(segments).toEqual([]);
    expect(ignores[0]?.raison).toContain('média');
  });

  it('ignore la lecture inversée au lieu de jouer à l endroit', () => {
    const seq = makeSequence([
      {
        id: 'a1',
        kind: 'audio',
        clips: [{ id: 'r', start: 0, duration: 50, mediaId: 'm', reverse: true }],
      },
    ]);
    const { segments, ignores } = planifierAudio(seq, { de: 0, a: 50, cadenceSource: source25 });
    expect(segments).toEqual([]);
    expect(ignores[0]?.raison).toContain('inversée');
  });

  it('ignore un média de cadence inconnue', () => {
    const { segments, ignores } = planifierAudio(sequenceAudio(), {
      de: 0,
      a: 50,
      cadenceSource: () => null,
    });
    expect(segments).toEqual([]);
    expect(ignores.length).toBeGreaterThan(0);
  });

  it('signale un volume automatisé, tout en jouant le clip', () => {
    const seq = sequenceAudio();
    const anime = {
      ...seq,
      tracks: seq.tracks.map((t) =>
        t.id === 'a1'
          ? {
              ...t,
              clips: t.clips.map((c) =>
                c.id === 'a'
                  ? {
                      ...c,
                      audio: {
                        ...c.audio,
                        gainDb: {
                          value: 0,
                          keyframes: [
                            {
                              id: 'k1',
                              time: 0,
                              value: 0,
                              interpolation: 'linear' as const,
                              inHandle: null,
                              outHandle: null,
                            },
                          ],
                        },
                      },
                    }
                  : c,
              ),
            }
          : t,
      ),
    };
    const { segments, ignores } = planifierAudio(anime, { de: 0, a: 50, cadenceSource: source25 });
    expect(segments.some((s) => s.clipId === 'a')).toBe(true);
    expect(ignores.some((i) => i.raison.includes('keyframes'))).toBe(true);
  });

  it('n émet rien pour un clip désactivé', () => {
    const seq = sequenceAudio();
    const eteint = {
      ...seq,
      tracks: seq.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => ({ ...c, enabled: false })),
      })),
    };
    expect(planifierAudio(eteint, { de: 0, a: 200, cadenceSource: source25 }).segments).toEqual([]);
  });
});

describe('cohérence sur une longue séquence', () => {
  it('la somme des durées planifiées couvre exactement la fenêtre, sans trou ni recouvrement', () => {
    const seq = makeSequence(
      [
        {
          id: 'a1',
          kind: 'audio',
          clips: Array.from({ length: 40 }, (_, i) => ({
            id: `c${i}`,
            start: i * 25,
            duration: 25,
            sourceIn: 0,
            mediaId: 'm',
          })),
        },
      ],
      TIMEBASES.TB25,
    );
    const { segments } = planifierAudio(seq, { de: 0, a: 1000, cadenceSource: source25 });
    expect(segments).toHaveLength(40);
    const total = segments.reduce((n, s) => n + s.dureeTimeline, 0);
    expect(total).toBeCloseTo(40, 9); // 1000 images à 25 i/s
    for (let i = 1; i < segments.length; i += 1) {
      const precedent = segments[i - 1]!;
      const courant = segments[i]!;
      expect(courant.debutTimeline).toBeCloseTo(
        precedent.debutTimeline + precedent.dureeTimeline,
        9,
      );
    }
  });
});
