import { describe, it, expect } from 'vitest';
import { TIMEBASES } from './timebase.js';
import { rational, equals, toNumber } from './rational.js';
import {
  time,
  zero,
  addTime,
  subTime,
  compareTime,
  equalsTime,
  toSeconds,
  toSecondsFloat,
  fromSeconds,
  rescale,
  frameStart,
  frameEnd,
  frameCenter,
  sourceFrameAt,
  toAudioSamples,
  fromAudioSamples,
  clampTime,
  minTime,
  maxTime,
  TimeBaseMismatchError,
} from './rational-time.js';

describe('RationalTime — algebre de base', () => {
  it('additionne et soustrait sur la meme timebase', () => {
    const a = time(100, TIMEBASES.TB25);
    const b = time(25, TIMEBASES.TB25);
    expect(addTime(a, b).frames).toBe(125);
    expect(subTime(a, b).frames).toBe(75);
    expect(zero(TIMEBASES.TB25).frames).toBe(0);
  });

  it('refuse de melanger deux timebases sans conversion explicite', () => {
    const a = time(100, TIMEBASES.TB25);
    const b = time(100, TIMEBASES.TB24);
    expect(() => addTime(a, b)).toThrow(TimeBaseMismatchError);
    expect(() => compareTime(a, b)).toThrow(TimeBaseMismatchError);
  });

  it('considere DF et NDF comme des timebases distinctes', () => {
    const df = time(100, TIMEBASES.TB29_97_DF);
    const ndf = time(100, TIMEBASES.TB29_97_NDF);
    expect(equalsTime(df, ndf)).toBe(false);
    expect(() => addTime(df, ndf)).toThrow(TimeBaseMismatchError);
  });

  it('borne, minimise et maximise', () => {
    const tb = TIMEBASES.TB25;
    expect(clampTime(time(-5, tb), time(0, tb), time(10, tb)).frames).toBe(0);
    expect(clampTime(time(50, tb), time(0, tb), time(10, tb)).frames).toBe(10);
    expect(clampTime(time(5, tb), time(0, tb), time(10, tb)).frames).toBe(5);
    expect(minTime(time(3, tb), time(9, tb)).frames).toBe(3);
    expect(maxTime(time(3, tb), time(9, tb)).frames).toBe(9);
  });
});

describe('RationalTime — secondes exactes', () => {
  it('convertit sans derive sur les cadences NTSC', () => {
    const t = time(24, TIMEBASES.TB23_976);
    // 24 images a 24000/1001 = 1001/1000 seconde, soit 1.001 s exactement.
    expect(equals(toSeconds(t), rational(1001, 1000))).toBe(true);
    expect(toSecondsFloat(t)).toBeCloseTo(1.001, 12);
  });

  it('expose le residu du drop-frame sur une heure', () => {
    // Fait de metier : AUCUN nombre entier d images a 30000/1001 ne vaut
    // exactement une heure (3600 x 30000/1001 = 107892.107... n est pas entier).
    // Le drop-frame ramene l etiquette 01:00:00;00 sur 107892 images, qui durent
    // 8999991/2500 s = 3599.9964 s : il reste 3.6 ms d erreur par heure.
    const t = time(107892, TIMEBASES.TB29_97_NDF);
    expect(equals(toSeconds(t), rational(8999991, 2500))).toBe(true);
    expect(toSecondsFloat(t)).toBeCloseTo(3599.9964, 9);
    expect(3600 - toSecondsFloat(t)).toBeCloseTo(0.0036, 9);
  });

  it('fait l aller-retour secondes -> images', () => {
    const tb = TIMEBASES.TB23_976;
    for (const f of [0, 1, 23, 24, 1000, 86400]) {
      expect(fromSeconds(toSeconds(time(f, tb)), tb).frames).toBe(f);
    }
  });

  it('applique le mode d arrondi demande', () => {
    const tb = TIMEBASES.TB25;
    const s = rational(3, 100); // 0.03 s = 0.75 image
    expect(fromSeconds(s, tb, 'floor').frames).toBe(0);
    expect(fromSeconds(s, tb, 'ceil').frames).toBe(1);
    expect(fromSeconds(s, tb, 'round').frames).toBe(1);
  });
});

describe('RationalTime — bornes d image', () => {
  it('l image n couvre [n/rate, (n+1)/rate[', () => {
    const t = time(10, TIMEBASES.TB25);
    expect(equals(frameStart(t), rational(10, 25))).toBe(true);
    expect(equals(frameEnd(t), rational(11, 25))).toBe(true);
    expect(equals(frameCenter(t), rational(21, 50))).toBe(true);
  });

  it('le centre d image tombe strictement entre debut et fin', () => {
    const t = time(7, TIMEBASES.TB23_976);
    expect(toNumber(frameStart(t))).toBeLessThan(toNumber(frameCenter(t)));
    expect(toNumber(frameCenter(t))).toBeLessThan(toNumber(frameEnd(t)));
  });
});

describe('RationalTime — changement de cadence (conform)', () => {
  it('conserve la duree reelle', () => {
    // 1 seconde a 25 fps -> 1 seconde a 50 fps.
    expect(rescale(time(25, TIMEBASES.TB25), TIMEBASES.TB50).frames).toBe(50);
    expect(rescale(time(50, TIMEBASES.TB50), TIMEBASES.TB25).frames).toBe(25);
    expect(rescale(time(24, TIMEBASES.TB24), TIMEBASES.TB23_976).frames).toBe(24);
  });

  it('gere 23.976 vers 29.97 (pulldown 2:3 en duree)', () => {
    // 24 images a 23.976 = 1.001 s = 30 images a 29.97.
    expect(rescale(time(24, TIMEBASES.TB23_976), TIMEBASES.TB29_97_NDF).frames).toBe(30);
    expect(rescale(time(30, TIMEBASES.TB29_97_NDF), TIMEBASES.TB23_976).frames).toBe(24);
  });

  it('est un no-op entre timebases identiques', () => {
    const t = time(42, TIMEBASES.TB25);
    expect(rescale(t, TIMEBASES.TB25)).toBe(t);
  });

  it('ignore le mode DF : le drop-frame n est qu un etiquetage', () => {
    const t = time(1000, TIMEBASES.TB29_97_NDF);
    expect(rescale(t, TIMEBASES.TB29_97_DF).frames).toBe(1000);
  });

  it('ne derive pas apres un aller-retour sur des cadences non multiples', () => {
    // 25 -> 24 -> 25 sur une valeur alignee doit revenir au point de depart.
    const t = time(600, TIMEBASES.TB25); // 24 s
    const there = rescale(t, TIMEBASES.TB24);
    expect(there.frames).toBe(576);
    expect(rescale(there, TIMEBASES.TB25).frames).toBe(600);
  });
});

describe('RationalTime — echantillonnage de la source', () => {
  it('choisit l image source par le centre de l image de destination', () => {
    // Timeline 25 fps, source 50 fps : l image 0 de timeline echantillonne
    // la source a 0.02 s, soit l image source 1.
    expect(sourceFrameAt(time(0, TIMEBASES.TB25), rational(50))).toBe(1);
    expect(sourceFrameAt(time(1, TIMEBASES.TB25), rational(50))).toBe(3);
  });

  it('ne tombe jamais pile sur une frontiere d image source', () => {
    // Cadences identiques : l image n doit donner exactement l image n.
    for (let f = 0; f < 500; f += 1) {
      expect(sourceFrameAt(time(f, TIMEBASES.TB25), rational(25))).toBe(f);
      expect(sourceFrameAt(time(f, TIMEBASES.TB23_976), rational(24000, 1001))).toBe(f);
    }
  });
});

describe('RationalTime — pont audio', () => {
  it('convertit images <-> echantillons a 48 kHz', () => {
    expect(toAudioSamples(time(25, TIMEBASES.TB25), 48000)).toBe(48000);
    expect(toAudioSamples(time(1, TIMEBASES.TB25), 48000)).toBe(1920);
    expect(fromAudioSamples(48000, 48000, TIMEBASES.TB25).frames).toBe(25);
  });

  it('gere le cas non entier de 29.97 a 48 kHz', () => {
    // 1 image a 30000/1001 = 1001/30000 s = 1601.6 echantillons.
    expect(toAudioSamples(time(1, TIMEBASES.TB29_97_NDF), 48000)).toBe(1602);
    // Sur 5 images l accumulation exacte donne 8008 et non 5 * 1602 = 8010.
    expect(toAudioSamples(time(5, TIMEBASES.TB29_97_NDF), 48000)).toBe(8008);
  });

  it('reste exact sur une heure de timecode a 44.1 kHz', () => {
    // 107892 images = 3599.9964 s -> 158 759 841.24 echantillons.
    // Un moteur qui aurait suppose 3600 s se tromperait de 159 echantillons.
    expect(toAudioSamples(time(107892, TIMEBASES.TB29_97_NDF), 44100)).toBe(158_759_841);
    expect(3600 * 44100 - 158_759_841).toBe(159);
  });
});
