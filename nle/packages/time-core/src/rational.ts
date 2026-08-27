/**
 * Arithmetique rationnelle exacte.
 *
 * Section 12 du cahier des charges : les calculs temporels ne doivent JAMAIS
 * reposer uniquement sur des flottants. 23.976 n'est pas 23.976 mais 24000/1001 ;
 * accumuler ce nombre en `number` derive et casse la precision frame apres
 * quelques minutes de timeline.
 *
 * Choix d'implementation : numerateur et denominateur sont des entiers `number`
 * (rapides). Chaque operation susceptible de deborder l'intervalle des entiers
 * surs bascule sur `bigint` pour le calcul intermediaire, puis reduit la
 * fraction. Si le resultat reduit reste hors intervalle sur, on leve une erreur
 * plutot que de retourner une valeur silencieusement fausse.
 */

/** Fraction normalisee : `d` est toujours strictement positif et pgcd(n, d) === 1. */
export interface Rational {
  readonly n: number;
  readonly d: number;
}

/** Levee lorsqu'un resultat exact ne tient plus dans les entiers surs de JS. */
export class RationalOverflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RationalOverflowError';
  }
}

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

function gcdNum(a: number, b: number): number {
  let x = a < 0 ? -a : a;
  let y = b < 0 ? -b : b;
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

function gcdBig(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/** Multiplication entiere sure : retourne `null` si le produit exact deborde. */
function mulSafe(a: number, b: number): number | null {
  if (a === 0 || b === 0) return 0;
  const absA = a < 0 ? -a : a;
  const absB = b < 0 ? -b : b;
  if (absA > MAX_SAFE / absB) return null;
  return a * b;
}

function fromBig(n: bigint, d: bigint, context: string): Rational {
  if (d === 0n) throw new RangeError(`Rational: denominateur nul (${context})`);
  let nn = n;
  let dd = d;
  if (dd < 0n) {
    nn = -nn;
    dd = -dd;
  }
  const g = gcdBig(nn, dd);
  if (g > 1n) {
    nn /= g;
    dd /= g;
  }
  const limit = BigInt(MAX_SAFE);
  if (nn > limit || nn < -limit || dd > limit) {
    throw new RationalOverflowError(
      `Rational: resultat exact ${nn}/${dd} hors des entiers surs (${context}). ` +
        `Reduire l amplitude temporelle ou passer par des ticks bigint.`,
    );
  }
  return { n: Number(nn), d: Number(dd) };
}

function isInt(v: number): boolean {
  return Number.isSafeInteger(v);
}

/** Construit une fraction normalisee. Les deux arguments doivent etre entiers. */
export function rational(n: number, d = 1): Rational {
  if (!isInt(n) || !isInt(d)) {
    throw new TypeError(
      `Rational: numerateur et denominateur doivent etre des entiers surs (${n}/${d})`,
    );
  }
  if (d === 0) throw new RangeError('Rational: denominateur nul');
  let nn = n;
  let dd = d;
  if (dd < 0) {
    nn = -nn;
    dd = -dd;
  }
  const g = gcdNum(nn, dd);
  if (g > 1) {
    nn /= g;
    dd /= g;
  }
  return { n: nn, d: dd };
}

export const ZERO: Rational = { n: 0, d: 1 };
export const ONE: Rational = { n: 1, d: 1 };

export function isZero(a: Rational): boolean {
  return a.n === 0;
}

export function neg(a: Rational): Rational {
  return { n: -a.n, d: a.d };
}

export function abs(a: Rational): Rational {
  return a.n < 0 ? { n: -a.n, d: a.d } : a;
}

export function add(a: Rational, b: Rational): Rational {
  const g = gcdNum(a.d, b.d);
  const bd = b.d / g;
  const ad = a.d / g;
  const p = mulSafe(a.n, bd);
  const q = mulSafe(b.n, ad);
  const den = mulSafe(a.d, bd);
  if (p === null || q === null || den === null || !isInt(p + q)) {
    return fromBig(
      BigInt(a.n) * BigInt(b.d) + BigInt(b.n) * BigInt(a.d),
      BigInt(a.d) * BigInt(b.d),
      'add',
    );
  }
  return rational(p + q, den);
}

export function sub(a: Rational, b: Rational): Rational {
  return add(a, neg(b));
}

export function mul(a: Rational, b: Rational): Rational {
  // Reduction croisee avant multiplication : limite fortement les debordements.
  const g1 = gcdNum(a.n, b.d);
  const g2 = gcdNum(b.n, a.d);
  const an = g1 === 0 ? a.n : a.n / (g1 || 1);
  const bd = g1 === 0 ? b.d : b.d / (g1 || 1);
  const bn = g2 === 0 ? b.n : b.n / (g2 || 1);
  const ad = g2 === 0 ? a.d : a.d / (g2 || 1);
  const n = mulSafe(an, bn);
  const d = mulSafe(ad, bd);
  if (n === null || d === null) {
    return fromBig(BigInt(a.n) * BigInt(b.n), BigInt(a.d) * BigInt(b.d), 'mul');
  }
  return rational(n, d);
}

export function div(a: Rational, b: Rational): Rational {
  if (b.n === 0) throw new RangeError('Rational: division par zero');
  return mul(a, { n: b.d, d: b.n });
}

export function inv(a: Rational): Rational {
  if (a.n === 0) throw new RangeError('Rational: inverse de zero');
  return a.n < 0 ? { n: -a.d, d: -a.n } : { n: a.d, d: a.n };
}

/** -1, 0 ou 1. Comparaison exacte, sans passage par les flottants. */
export function compare(a: Rational, b: Rational): -1 | 0 | 1 {
  if (a.d === b.d) return a.n < b.n ? -1 : a.n > b.n ? 1 : 0;
  const left = mulSafe(a.n, b.d);
  const right = mulSafe(b.n, a.d);
  if (left === null || right === null) {
    const l = BigInt(a.n) * BigInt(b.d);
    const r = BigInt(b.n) * BigInt(a.d);
    return l < r ? -1 : l > r ? 1 : 0;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

export function equals(a: Rational, b: Rational): boolean {
  return a.n === b.n && a.d === b.d;
}

export function lt(a: Rational, b: Rational): boolean {
  return compare(a, b) < 0;
}
export function lte(a: Rational, b: Rational): boolean {
  return compare(a, b) <= 0;
}
export function gt(a: Rational, b: Rational): boolean {
  return compare(a, b) > 0;
}
export function gte(a: Rational, b: Rational): boolean {
  return compare(a, b) >= 0;
}

export function min(a: Rational, b: Rational): Rational {
  return compare(a, b) <= 0 ? a : b;
}
export function max(a: Rational, b: Rational): Rational {
  return compare(a, b) >= 0 ? a : b;
}

/** Division entiere vers moins l infini (valable pour les numerateurs negatifs). */
function floorDivInt(n: number, d: number): number {
  const q = Math.floor(n / d);
  // Correction si l imprecision flottante a fait basculer le quotient.
  if (q * d > n) return q - 1;
  if ((q + 1) * d <= n) return q + 1;
  return q;
}

/** Plus grand entier <= a. */
export function floor(a: Rational): number {
  if (a.d === 1) return a.n;
  return floorDivInt(a.n, a.d);
}

/** Plus petit entier >= a. */
export function ceil(a: Rational): number {
  if (a.d === 1) return a.n;
  return -floorDivInt(-a.n, a.d);
}

/** Troncature vers zero. */
export function trunc(a: Rational): number {
  return a.n < 0 ? ceil(a) : floor(a);
}

/**
 * Arrondi au plus proche, demi vers le haut (half-up), calcule en entiers.
 * Aucun flottant intermediaire : on compare 2*reste a d.
 */
export function round(a: Rational): number {
  const f = floor(a);
  const remN = a.n - f * a.d; // 0 <= remN < a.d
  return remN * 2 >= a.d ? f + 1 : f;
}

/** Conversion en flottant. Reservee a l affichage et aux mesures, jamais au montage. */
export function toNumber(a: Rational): number {
  return a.n / a.d;
}

/** `"24000/1001"` ou `"25"`. */
export function toString(a: Rational): string {
  return a.d === 1 ? `${a.n}` : `${a.n}/${a.d}`;
}

/** Parse `"24000/1001"`, `"25"`, `"30:1"`. */
export function parseRational(text: string): Rational {
  const t = text.trim();
  const m = /^(-?\d+)\s*[/:]\s*(\d+)$/.exec(t);
  if (m) return rational(Number(m[1]), Number(m[2]));
  const single = /^-?\d+$/.exec(t);
  if (single) return rational(Number(t));
  throw new SyntaxError(`Rational: format non reconnu "${text}"`);
}

/**
 * Approxime un flottant par une fraction exacte (fractions continues).
 * Sert uniquement a interpreter les cadences remontees par les demuxers
 * (ex. 23.976023976 lu dans un conteneur) : le resultat est ensuite fige.
 */
export function approximate(value: number, maxDenominator = 1_000_000): Rational {
  if (!Number.isFinite(value)) throw new RangeError('Rational: valeur non finie');
  const sign = value < 0 ? -1 : 1;
  let x = value < 0 ? -value : value;
  let p0 = 0;
  let q0 = 1;
  let p1 = 1;
  let q1 = 0;
  for (let i = 0; i < 64; i += 1) {
    const a = Math.floor(x);
    const p2 = a * p1 + p0;
    const q2 = a * q1 + q0;
    if (q2 > maxDenominator) break;
    p0 = p1;
    q0 = q1;
    p1 = p2;
    q1 = q2;
    const frac = x - a;
    if (frac < 1e-12) break;
    x = 1 / frac;
  }
  if (q1 === 0) return rational(sign * Math.trunc(value));
  return rational(sign * p1, q1);
}
