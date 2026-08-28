import { describe, it, expect } from 'vitest';
import {
  TIMEBASES,
  timebase,
  RATES,
  TimeBaseError,
  supportsDropFrame,
  dropFrameCount,
} from './timebase.js';
import {
  formatTimecode,
  parseTimecode,
  parseTimecodeEntry,
  frameToParts,
  partsToFrame,
  isDroppedLabel,
  framesPerHour,
  framesPer24Hours,
  TimecodeError,
} from './timecode.js';

describe('timebase — regles drop-frame', () => {
  it('n autorise le drop-frame que sur les cadences NTSC en 30/60/120', () => {
    expect(supportsDropFrame(RATES.R29_97)).toBe(true);
    expect(supportsDropFrame(RATES.R59_94)).toBe(true);
    expect(supportsDropFrame(RATES.R119_88)).toBe(true);
    expect(supportsDropFrame(RATES.R23_976)).toBe(false);
    expect(supportsDropFrame(RATES.R25)).toBe(false);
    expect(supportsDropFrame(RATES.R30)).toBe(false);
  });

  it('refuse de construire une timebase 23.976 DF', () => {
    expect(() => timebase(RATES.R23_976, 'DF')).toThrow(TimeBaseError);
    expect(() => timebase(RATES.R25, 'DF')).toThrow(TimeBaseError);
    expect(() => timebase(RATES.R30, 'DF')).toThrow(TimeBaseError);
  });

  it('compte 2, 4 et 8 images sautees selon la cadence', () => {
    expect(dropFrameCount(RATES.R29_97)).toBe(2);
    expect(dropFrameCount(RATES.R59_94)).toBe(4);
    expect(dropFrameCount(RATES.R119_88)).toBe(8);
    expect(dropFrameCount(RATES.R25)).toBe(0);
  });
});

describe('timecode NDF — cadences entieres', () => {
  it('25 fps', () => {
    expect(formatTimecode(0, TIMEBASES.TB25)).toBe('00:00:00:00');
    expect(formatTimecode(24, TIMEBASES.TB25)).toBe('00:00:00:24');
    expect(formatTimecode(25, TIMEBASES.TB25)).toBe('00:00:01:00');
    expect(formatTimecode(1500, TIMEBASES.TB25)).toBe('00:01:00:00');
    expect(formatTimecode(90000, TIMEBASES.TB25)).toBe('01:00:00:00');
  });

  it('24 fps', () => {
    expect(formatTimecode(86400, TIMEBASES.TB24)).toBe('01:00:00:00');
    expect(formatTimecode(23, TIMEBASES.TB24)).toBe('00:00:00:23');
  });

  it('50 fps', () => {
    expect(formatTimecode(49, TIMEBASES.TB50)).toBe('00:00:00:49');
    expect(formatTimecode(50, TIMEBASES.TB50)).toBe('00:00:01:00');
    expect(formatTimecode(180000, TIMEBASES.TB50)).toBe('01:00:00:00');
  });

  it('120 fps garde deux chiffres jusqu a 119', () => {
    expect(formatTimecode(119, TIMEBASES.TB120)).toBe('00:00:00:119');
    expect(formatTimecode(120, TIMEBASES.TB120)).toBe('00:00:01:00');
  });
});

describe('timecode NDF — cadences NTSC (derive assumee)', () => {
  it('23.976 compte sur 24 crans', () => {
    expect(formatTimecode(23, TIMEBASES.TB23_976)).toBe('00:00:00:23');
    expect(formatTimecode(24, TIMEBASES.TB23_976)).toBe('00:00:01:00');
    expect(formatTimecode(86400, TIMEBASES.TB23_976)).toBe('01:00:00:00');
  });

  it('29.97 NDF derive de 3s18 sur une heure reelle', () => {
    // Une heure d horloge murale = 107892 images a 30000/1001.
    // En NDF ces images n affichent que 00:59:56:12 : c est la derive NTSC.
    expect(formatTimecode(107892, TIMEBASES.TB29_97_NDF)).toBe('00:59:56:12');
    expect(formatTimecode(108000, TIMEBASES.TB29_97_NDF)).toBe('01:00:00:00');
  });
});

describe('timecode DF — 29.97', () => {
  const tb = TIMEBASES.TB29_97_DF;

  it('saute les etiquettes 00 et 01 a chaque minute non multiple de 10', () => {
    expect(formatTimecode(1798, tb)).toBe('00:00:59;28');
    expect(formatTimecode(1799, tb)).toBe('00:00:59;29');
    expect(formatTimecode(1800, tb)).toBe('00:01:00;02'); // 00 et 01 sautees
    expect(formatTimecode(1801, tb)).toBe('00:01:00;03');
  });

  it('ne saute rien a la minute 10', () => {
    expect(formatTimecode(17981, tb)).toBe('00:09:59;29');
    expect(formatTimecode(17982, tb)).toBe('00:10:00;00');
  });

  it('recolle a l horloge murale sur une heure', () => {
    expect(formatTimecode(107892, tb)).toBe('01:00:00;00');
    expect(framesPerHour(tb)).toBe(107892);
    expect(framesPer24Hours(tb)).toBe(107892 * 24);
  });

  it('refuse de parser une etiquette inexistante', () => {
    expect(() => parseTimecode('00:01:00;00', tb)).toThrow(TimecodeError);
    expect(() => parseTimecode('00:01:00;01', tb)).toThrow(TimecodeError);
    expect(parseTimecode('00:01:00;02', tb)).toBe(1800);
    // La minute 10 accepte 00 et 01.
    expect(parseTimecode('00:10:00;00', tb)).toBe(17982);
  });

  it('identifie les etiquettes sautees', () => {
    expect(
      isDroppedLabel({ hours: 0, minutes: 1, seconds: 0, frames: 0, negative: false }, tb),
    ).toBe(true);
    expect(
      isDroppedLabel({ hours: 0, minutes: 1, seconds: 0, frames: 2, negative: false }, tb),
    ).toBe(false);
    expect(
      isDroppedLabel({ hours: 0, minutes: 10, seconds: 0, frames: 0, negative: false }, tb),
    ).toBe(false);
    expect(
      isDroppedLabel({ hours: 0, minutes: 1, seconds: 1, frames: 0, negative: false }, tb),
    ).toBe(false);
  });
});

describe('timecode DF — 59.94', () => {
  const tb = TIMEBASES.TB59_94_DF;

  it('saute 4 etiquettes par minute', () => {
    expect(formatTimecode(3599, tb)).toBe('00:00:59;59');
    expect(formatTimecode(3600, tb)).toBe('00:01:00;04');
  });

  it('ne saute rien a la minute 10 et recolle sur une heure', () => {
    expect(formatTimecode(35964, tb)).toBe('00:10:00;00');
    expect(formatTimecode(215784, tb)).toBe('01:00:00;00');
    expect(framesPerHour(tb)).toBe(215784);
  });
});

describe('timecode DF — 119.88', () => {
  const tb = TIMEBASES.TB119_88_DF;

  it('saute 8 etiquettes par minute', () => {
    expect(formatTimecode(7199, tb)).toBe('00:00:59;119');
    expect(formatTimecode(7200, tb)).toBe('00:01:00;08');
    expect(formatTimecode(71928, tb)).toBe('00:10:00;00');
  });
});

describe('timecode — aller-retour exhaustif', () => {
  const cases = [
    ['23.976 NDF', TIMEBASES.TB23_976, 86400],
    ['24 NDF', TIMEBASES.TB24, 86400],
    ['25 NDF', TIMEBASES.TB25, 90000],
    ['29.97 NDF', TIMEBASES.TB29_97_NDF, 108000],
    ['29.97 DF', TIMEBASES.TB29_97_DF, 107892],
    ['50 NDF', TIMEBASES.TB50, 180000],
    ['59.94 DF', TIMEBASES.TB59_94_DF, 215784],
  ] as const;

  for (const [label, tb, count] of cases) {
    it(`${label} : frame -> timecode -> frame sur une heure entiere`, () => {
      // Boucle chaude : on n appelle pas expect() par iteration (trop couteux),
      // on collecte les ecarts et on n assertionne qu une fois.
      const roundTripFailures: number[] = [];
      const droppedLabels: number[] = [];
      for (let f = 0; f < count; f += 1) {
        const parts = frameToParts(f, tb);
        if (isDroppedLabel(parts, tb)) droppedLabels.push(f);
        if (partsToFrame(parts, tb) !== f) roundTripFailures.push(f);
      }
      expect(roundTripFailures.slice(0, 10)).toEqual([]);
      expect(droppedLabels.slice(0, 10)).toEqual([]);
    });
  }

  it('29.97 DF : le timecode est strictement croissant sur une heure', () => {
    const tb = TIMEBASES.TB29_97_DF;
    const regressions: number[] = [];
    let previous = -1;
    for (let f = 0; f < 107892; f += 1) {
      const p = frameToParts(f, tb);
      const key = ((p.hours * 60 + p.minutes) * 60 + p.seconds) * 30 + p.frames;
      if (key <= previous) regressions.push(f);
      previous = key;
    }
    expect(regressions.slice(0, 10)).toEqual([]);
  });
});

describe('timecode — valeurs negatives et bornes', () => {
  it('formate les positions negatives', () => {
    expect(formatTimecode(-25, TIMEBASES.TB25)).toBe('-00:00:01:00');
    expect(formatTimecode(-1, TIMEBASES.TB25)).toBe('-00:00:00:01');
    expect(formatTimecode(0, TIMEBASES.TB25)).toBe('00:00:00:00');
  });

  it('fait l aller-retour sur les negatifs', () => {
    for (const f of [-1, -25, -1500, -90000]) {
      expect(partsToFrame(frameToParts(f, TIMEBASES.TB25), TIMEBASES.TB25)).toBe(f);
    }
  });

  it('laisse depasser 24 h par defaut mais replie si demande', () => {
    expect(formatTimecode(90000 * 25, TIMEBASES.TB25)).toBe('25:00:00:00');
    expect(formatTimecode(90000 * 25, TIMEBASES.TB25, { wrap24: true })).toBe('01:00:00:00');
  });

  it('refuse des composantes hors bornes', () => {
    const tb = TIMEBASES.TB25;
    expect(() =>
      partsToFrame({ hours: 0, minutes: 60, seconds: 0, frames: 0, negative: false }, tb),
    ).toThrow();
    expect(() =>
      partsToFrame({ hours: 0, minutes: 0, seconds: 60, frames: 0, negative: false }, tb),
    ).toThrow();
    expect(() =>
      partsToFrame({ hours: 0, minutes: 0, seconds: 0, frames: 25, negative: false }, tb),
    ).toThrow();
  });
});

describe('timecode — saisie monteur (section 16)', () => {
  const tb = TIMEBASES.TB25;

  it('accepte un timecode complet', () => {
    expect(parseTimecodeEntry('01:12:32:15', tb)).toBe(parseTimecode('01:12:32:15', tb));
  });

  it('cale les chiffres a droite', () => {
    expect(parseTimecodeEntry('1512', tb)).toBe(15 * 25 + 12);
    expect(parseTimecodeEntry('12', tb)).toBe(12);
    expect(parseTimecodeEntry('112', tb)).toBe(1 * 25 + 12);
    expect(parseTimecodeEntry('10000', tb)).toBe(60 * 25); // 00:01:00:00
  });

  it('applique un deplacement relatif en images', () => {
    expect(parseTimecodeEntry('+10', tb, 100)).toBe(110);
    expect(parseTimecodeEntry('-10', tb, 100)).toBe(90);
    expect(parseTimecodeEntry('+100', tb, 0)).toBe(1 * 25 + 0);
    expect(parseTimecodeEntry('-1:00', tb, 1000)).toBe(1000 - 25);
  });

  it('accepte le point comme position courante', () => {
    expect(parseTimecodeEntry('.', tb, 4242)).toBe(4242);
    expect(parseTimecodeEntry('', tb, 4242)).toBe(4242);
  });

  it('refuse une saisie non numerique', () => {
    expect(() => parseTimecodeEntry('abc', tb)).toThrow(TimecodeError);
  });

  it('en drop-frame, le relatif compte des images reelles', () => {
    const df = TIMEBASES.TB29_97_DF;
    // 1799 + 1 image = 1800, dont l etiquette est 00:01:00;02.
    expect(formatTimecode(parseTimecodeEntry('+1', df, 1799), df)).toBe('00:01:00;02');
  });
});
