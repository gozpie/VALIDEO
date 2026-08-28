/**
 * Ticks d interchange.
 *
 * Les NLE professionnels echangent des positions dans une unite entiere tres
 * fine, commune a toutes les cadences.
 *
 * Adobe utilise 254 016 000 000 ticks par seconde. Cette valeur se factorise en
 * 2^10 x 3^4 x 5^6 x 7^2 : elle est divisible par 24, 25, 30, 48, 50, 60, 100 et
 * 120, mais PAS par 1001 (= 7 x 11 x 13, il manque 11 et 13). Autrement dit
 * l unite d Adobe n est pas exacte sur les cadences NTSC.
 *
 * On retient donc comme unite interne l unite d Adobe multipliee par 143
 * (= 11 x 13), ce qui la rend divisible par 1001 tout en restant divisible par
 * toutes les cadences entieres. Toutes les conversions deviennent exactes.
 * `ADOBE_TICKS_PER_SECOND` reste expose pour l interchange avec Adobe, ou
 * l arrondi est alors assume et documente.
 *
 * Ces valeurs depassent tres vite les entiers surs de JS (une heure vaut deja
 * 1.3e17 ticks), donc l API est en `bigint`. Les ticks servent uniquement aux
 * frontieres d import/export (AAF, FCPXML, OTIO) : le moteur, lui, travaille en
 * images entieres.
 */
import type { TimeBase } from './timebase.js';
import type { RationalTime } from './rational-time.js';
import { time } from './rational-time.js';

/** Unite d Adobe. Non divisible par 1001 : arrondie sur les cadences NTSC. */
export const ADOBE_TICKS_PER_SECOND = 254016000000n;

/** Unite interne exacte : celle d Adobe x 143, divisible par 1001. */
export const TICKS_PER_SECOND = ADOBE_TICKS_PER_SECOND * 143n;

/**
 * Division entiere arrondie au plus proche, demi vers le haut, valable pour les
 * numerateurs negatifs. La division bigint native tronque vers zero, ce qui
 * decalerait les positions negatives d une unite.
 */
function roundDiv(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const fq = r < 0n ? q - 1n : q;
  const fr = r < 0n ? r + den : r;
  return fr * 2n >= den ? fq + 1n : fq;
}

/** Images -> ticks. Exact pour toute cadence dont le denominateur divise l unite. */
export function framesToTicks(frames: number, base: TimeBase): bigint {
  const num = BigInt(frames) * TICKS_PER_SECOND * BigInt(base.rate.d);
  const den = BigInt(base.rate.n);
  // Exact pour toutes les cadences supportees ; roundDiv ne sert que pour une
  // cadence exotique remontee par un demuxer.
  return roundDiv(num, den);
}

/** Ticks -> images, arrondi au plus proche. */
export function ticksToFrames(ticks: bigint, base: TimeBase): number {
  const num = ticks * BigInt(base.rate.n);
  const den = TICKS_PER_SECOND * BigInt(base.rate.d);
  const value = Number(roundDiv(num, den));
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Ticks: ${ticks} ticks depassent les entiers surs sur cette cadence`);
  }
  return value;
}

export function toTicks(t: RationalTime): bigint {
  return framesToTicks(t.frames, t.base);
}

export function fromTicks(ticks: bigint, base: TimeBase): RationalTime {
  return time(ticksToFrames(ticks, base), base);
}
