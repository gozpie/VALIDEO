/**
 * `RationalTime` : un instant ou une duree exprimee en images entieres,
 * rattachee a une timebase.
 *
 * Regle d architecture (section 12) : dans tout le moteur, une position ou une
 * duree de timeline est un ENTIER d images sur la timebase de la sequence.
 * Les secondes ne servent qu aux frontieres (audio, export, affichage) et sont
 * alors calculees en rationnel exact, jamais accumulees en flottant.
 */
import type { Rational } from './rational.js';
import {
  add as radd,
  compare as rcompare,
  div,
  floor,
  mul,
  rational,
  round as rround,
  ceil,
  toNumber,
} from './rational.js';
import type { TimeBase } from './timebase.js';
import { sameBase } from './timebase.js';

export interface RationalTime {
  /** Nombre d images entier. Peut etre negatif (avant le debut de sequence). */
  readonly frames: number;
  readonly base: TimeBase;
}

export class TimeBaseMismatchError extends Error {
  constructor(a: TimeBase, b: TimeBase) {
    super(
      `RationalTime: operation entre deux timebases differentes ` +
        `(${a.rate.n}/${a.rate.d} ${a.mode} vs ${b.rate.n}/${b.rate.d} ${b.mode}). ` +
        `Utiliser rescale() explicitement.`,
    );
    this.name = 'TimeBaseMismatchError';
  }
}

export function time(frames: number, base: TimeBase): RationalTime {
  if (!Number.isSafeInteger(frames)) {
    throw new TypeError(`RationalTime: nombre d images non entier (${frames})`);
  }
  return { frames, base };
}

export function zero(base: TimeBase): RationalTime {
  return { frames: 0, base };
}

function assertSame(a: RationalTime, b: RationalTime): void {
  if (!sameBase(a.base, b.base)) throw new TimeBaseMismatchError(a.base, b.base);
}

export function addTime(a: RationalTime, b: RationalTime): RationalTime {
  assertSame(a, b);
  return { frames: a.frames + b.frames, base: a.base };
}

export function subTime(a: RationalTime, b: RationalTime): RationalTime {
  assertSame(a, b);
  return { frames: a.frames - b.frames, base: a.base };
}

export function compareTime(a: RationalTime, b: RationalTime): -1 | 0 | 1 {
  assertSame(a, b);
  return a.frames < b.frames ? -1 : a.frames > b.frames ? 1 : 0;
}

export function equalsTime(a: RationalTime, b: RationalTime): boolean {
  return sameBase(a.base, b.base) && a.frames === b.frames;
}

/** Duree exacte en secondes, sous forme de fraction. */
export function toSeconds(t: RationalTime): Rational {
  return div(rational(t.frames), t.base.rate);
}

/** Secondes flottantes. Reserve a l affichage, a l audio et aux mesures. */
export function toSecondsFloat(t: RationalTime): number {
  return toNumber(toSeconds(t));
}

export type RoundingMode = 'floor' | 'ceil' | 'round';

function applyRounding(value: Rational, mode: RoundingMode): number {
  switch (mode) {
    case 'floor':
      return floor(value);
    case 'ceil':
      return ceil(value);
    case 'round':
      return rround(value);
  }
}

/** Secondes exactes -> images sur une timebase donnee. */
export function fromSeconds(
  seconds: Rational,
  base: TimeBase,
  mode: RoundingMode = 'round',
): RationalTime {
  return { frames: applyRounding(mul(seconds, base.rate), mode), base };
}

/**
 * Change de timebase en conservant l instant reel.
 *
 * Le mode DF/NDF n influence PAS ce calcul : le drop-frame ne change que
 * l etiquetage, jamais le nombre d images. 100 images en 29.97 DF valent
 * exactement 100 images en 29.97 NDF.
 */
export function rescale(
  t: RationalTime,
  target: TimeBase,
  mode: RoundingMode = 'round',
): RationalTime {
  if (sameBase(t.base, target)) return t;
  const ratio = div(target.rate, t.base.rate);
  return { frames: applyRounding(mul(rational(t.frames), ratio), mode), base: target };
}

/**
 * Instant du DEBUT de l image, en secondes exactes. C est la convention du
 * moteur : l image `n` couvre [n/rate, (n+1)/rate[.
 */
export function frameStart(t: RationalTime): Rational {
  return toSeconds(t);
}

/** Instant de FIN (exclu) de l image. */
export function frameEnd(t: RationalTime): Rational {
  return div(rational(t.frames + 1), t.base.rate);
}

/**
 * Instant du CENTRE de l image. C est cet instant qu il faut utiliser pour
 * echantillonner une source a cadence differente : cela evite les erreurs de
 * bord ou l on tombe pile sur une frontiere d image.
 */
export function frameCenter(t: RationalTime): Rational {
  return div(
    radd(mul(rational(t.frames), rational(2)), rational(1)),
    mul(t.base.rate, rational(2)),
  );
}

/**
 * Indice d image source a afficher pour un instant timeline donne.
 * Utilise le centre de l image de destination puis tronque vers le bas, ce qui
 * est le comportement attendu d un conform sans reechantillonnage temporel.
 */
export function sourceFrameAt(t: RationalTime, sourceRate: Rational): number {
  return floor(mul(frameCenter(t), sourceRate));
}

/** Nombre d echantillons audio couverts par cette duree, arrondi au plus proche. */
export function toAudioSamples(t: RationalTime, sampleRate: number): number {
  return rround(mul(toSeconds(t), rational(sampleRate)));
}

/** Duree audio -> images, utile pour aligner un conform audio sur la timeline. */
export function fromAudioSamples(
  samples: number,
  sampleRate: number,
  base: TimeBase,
  mode: RoundingMode = 'round',
): RationalTime {
  return fromSeconds(rational(samples, sampleRate), base, mode);
}

export function maxTime(a: RationalTime, b: RationalTime): RationalTime {
  return compareTime(a, b) >= 0 ? a : b;
}

export function minTime(a: RationalTime, b: RationalTime): RationalTime {
  return compareTime(a, b) <= 0 ? a : b;
}

/** Borne une valeur dans [lo, hi]. */
export function clampTime(t: RationalTime, lo: RationalTime, hi: RationalTime): RationalTime {
  if (compareTime(t, lo) < 0) return lo;
  if (compareTime(t, hi) > 0) return hi;
  return t;
}

/** Comparateur brut sur les rationnels, reexporte pour les intervalles. */
export const compareRational = rcompare;
