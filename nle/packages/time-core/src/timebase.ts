/**
 * Cadences (timebases) et leurs regles professionnelles.
 *
 * Une timebase = une cadence rationnelle + un mode de comptage timecode.
 * On ne stocke jamais "29.97" : on stocke 30000/1001.
 */
import type { Rational } from './rational.js';
import { rational, equals, toNumber, round, toString as ratToString } from './rational.js';

/** Mode de comptage du timecode. */
export type TimecodeMode = 'NDF' | 'DF';

export interface TimeBase {
  /** Cadence exacte, en images par seconde. Ex. 24000/1001 pour 23.976. */
  readonly rate: Rational;
  /** Drop-frame ou non drop-frame. */
  readonly mode: TimecodeMode;
}

/** Cadences normalisees exigees par la section 12. */
export const RATES = {
  R23_976: rational(24000, 1001),
  R24: rational(24, 1),
  R25: rational(25, 1),
  R29_97: rational(30000, 1001),
  R30: rational(30, 1),
  R47_952: rational(48000, 1001),
  R48: rational(48, 1),
  R50: rational(50, 1),
  R59_94: rational(60000, 1001),
  R60: rational(60, 1),
  R100: rational(100, 1),
  R119_88: rational(120000, 1001),
  R120: rational(120, 1),
} as const satisfies Record<string, Rational>;

/**
 * Cadence nominale entiere utilisee par le comptage timecode.
 * 30000/1001 compte sur 30 crans par seconde, pas 29.
 */
export function nominalRate(rate: Rational): number {
  return round(rate);
}

/**
 * Le drop-frame n existe que pour les cadences NTSC en 1001emes dont la
 * cadence nominale est un multiple de 30. 23.976 DF n existe pas.
 */
export function supportsDropFrame(rate: Rational): boolean {
  if (rate.d !== 1001) return false;
  const nominal = nominalRate(rate);
  return nominal % 30 === 0 && rate.n === nominal * 1000;
}

/**
 * Nombre d images sautees a chaque minute non multiple de 10.
 * 29.97 -> 2, 59.94 -> 4, 119.88 -> 8.
 */
export function dropFrameCount(rate: Rational): number {
  if (!supportsDropFrame(rate)) return 0;
  return (nominalRate(rate) / 30) * 2;
}

export class TimeBaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeBaseError';
  }
}

export function timebase(rate: Rational, mode: TimecodeMode = 'NDF'): TimeBase {
  if (rate.n <= 0) throw new TimeBaseError(`TimeBase: cadence non positive (${ratToString(rate)})`);
  if (mode === 'DF' && !supportsDropFrame(rate)) {
    throw new TimeBaseError(
      `TimeBase: le drop-frame n est pas defini pour ${ratToString(rate)}. ` +
        `Seules les cadences NTSC 30000/1001, 60000/1001 et 120000/1001 l acceptent.`,
    );
  }
  return { rate, mode };
}

export function isDropFrame(tb: TimeBase): boolean {
  return tb.mode === 'DF';
}

export function sameBase(a: TimeBase, b: TimeBase): boolean {
  return equals(a.rate, b.rate) && a.mode === b.mode;
}

/** Libelle court destine a l interface : "23.976", "29.97 DF", "25". */
export function formatTimeBase(tb: TimeBase): string {
  const n = toNumber(tb.rate);
  const label = Number.isInteger(n) ? `${n}` : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return tb.mode === 'DF' ? `${label} DF` : label;
}

/** Timebases pretes a l emploi pour les presets de sequence. */
export const TIMEBASES = {
  TB23_976: timebase(RATES.R23_976),
  TB24: timebase(RATES.R24),
  TB25: timebase(RATES.R25),
  TB29_97_NDF: timebase(RATES.R29_97, 'NDF'),
  TB29_97_DF: timebase(RATES.R29_97, 'DF'),
  TB30: timebase(RATES.R30),
  TB47_952: timebase(RATES.R47_952),
  TB48: timebase(RATES.R48),
  TB50: timebase(RATES.R50),
  TB59_94_NDF: timebase(RATES.R59_94, 'NDF'),
  TB59_94_DF: timebase(RATES.R59_94, 'DF'),
  TB60: timebase(RATES.R60),
  TB100: timebase(RATES.R100),
  TB119_88_DF: timebase(RATES.R119_88, 'DF'),
  TB120: timebase(RATES.R120),
} as const satisfies Record<string, TimeBase>;
