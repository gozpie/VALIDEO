import { describe, it, expect } from 'vitest';
import {
  rational,
  add,
  sub,
  mul,
  div,
  inv,
  neg,
  abs,
  compare,
  equals,
  floor,
  ceil,
  trunc,
  round,
  toNumber,
  toString,
  parseRational,
  approximate,
  RationalOverflowError,
  ZERO,
  ONE,
} from './rational.js';

describe('rational — construction et normalisation', () => {
  it('normalise par le pgcd', () => {
    expect(rational(6, 8)).toEqual({ n: 3, d: 4 });
    expect(rational(24000, 1001)).toEqual({ n: 24000, d: 1001 });
    expect(rational(30000, 1001)).toEqual({ n: 30000, d: 1001 });
  });

  it('place toujours le signe au numerateur', () => {
    expect(rational(1, -2)).toEqual({ n: -1, d: 2 });
    expect(rational(-1, -2)).toEqual({ n: 1, d: 2 });
  });

  it('refuse un denominateur nul', () => {
    expect(() => rational(1, 0)).toThrow(RangeError);
  });

  it('refuse les non-entiers', () => {
    expect(() => rational(1.5, 2)).toThrow(TypeError);
  });

  it('normalise zero en 0/1', () => {
    expect(rational(0, 7)).toEqual({ n: 0, d: 1 });
  });
});

describe('rational — arithmetique exacte', () => {
  it('additionne sans derive flottante', () => {
    // 1/3 + 1/3 + 1/3 vaut exactement 1, ce que les flottants ne garantissent pas.
    const third = rational(1, 3);
    expect(add(add(third, third), third)).toEqual(ONE);
  });

  it('accumule 24000/1001 sans perte sur 100000 iterations', () => {
    const step = rational(1001, 24000); // duree exacte d une image en 23.976
    let acc = ZERO;
    for (let i = 0; i < 100_000; i += 1) acc = add(acc, step);
    expect(acc).toEqual(rational(100_000 * 1001, 24000));
    // Le meme calcul en flottant derive.
    let f = 0;
    for (let i = 0; i < 100_000; i += 1) f += 1001 / 24000;
    expect(f).not.toBe(toNumber(acc));
  });

  it('soustrait, multiplie et divise', () => {
    expect(sub(rational(3, 4), rational(1, 4))).toEqual(rational(1, 2));
    expect(mul(rational(2, 3), rational(3, 2))).toEqual(ONE);
    expect(div(rational(1, 2), rational(1, 4))).toEqual(rational(2));
    expect(inv(rational(24000, 1001))).toEqual(rational(1001, 24000));
  });

  it('refuse la division par zero', () => {
    expect(() => div(ONE, ZERO)).toThrow(RangeError);
    expect(() => inv(ZERO)).toThrow(RangeError);
  });

  it('bascule sur bigint quand le produit intermediaire deborde', () => {
    const a = rational(999_999_937, 2);
    const b = rational(999_999_893, 3);
    // Le produit brut des numerateurs depasse 2^53 : la reduction bigint doit
    // soit donner un resultat exact, soit lever explicitement.
    expect(() => mul(a, b)).toThrow(RationalOverflowError);
  });

  it('gere neg et abs', () => {
    expect(neg(rational(3, 4))).toEqual(rational(-3, 4));
    expect(abs(rational(-3, 4))).toEqual(rational(3, 4));
  });
});

describe('rational — comparaison', () => {
  it('compare exactement des fractions de denominateurs differents', () => {
    expect(compare(rational(24000, 1001), rational(24))).toBe(-1);
    expect(compare(rational(30000, 1001), rational(30))).toBe(-1);
    expect(compare(rational(1, 3), rational(2, 6))).toBe(0);
    expect(equals(rational(1, 3), rational(2, 6))).toBe(true);
  });

  it('distingue 23.976 de 24 la ou les flottants peuvent hesiter', () => {
    expect(equals(rational(24000, 1001), rational(24))).toBe(false);
  });
});

describe('rational — arrondis en arithmetique entiere', () => {
  it('floor va vers moins l infini', () => {
    expect(floor(rational(7, 2))).toBe(3);
    expect(floor(rational(-7, 2))).toBe(-4);
    expect(floor(rational(-4, 2))).toBe(-2);
  });

  it('ceil va vers plus l infini', () => {
    expect(ceil(rational(7, 2))).toBe(4);
    expect(ceil(rational(-7, 2))).toBe(-3);
    expect(ceil(rational(4, 2))).toBe(2);
  });

  it('trunc va vers zero', () => {
    expect(trunc(rational(7, 2))).toBe(3);
    expect(trunc(rational(-7, 2))).toBe(-3);
  });

  it('round arrondit les demis vers le haut', () => {
    expect(round(rational(1, 2))).toBe(1);
    expect(round(rational(-1, 2))).toBe(0);
    expect(round(rational(3, 2))).toBe(2);
    expect(round(rational(30000, 1001))).toBe(30);
    expect(round(rational(24000, 1001))).toBe(24);
    expect(round(rational(120000, 1001))).toBe(120);
  });
});

describe('rational — texte et approximation', () => {
  it('formate et parse', () => {
    expect(toString(rational(24000, 1001))).toBe('24000/1001');
    expect(toString(rational(25))).toBe('25');
    expect(parseRational('24000/1001')).toEqual(rational(24000, 1001));
    expect(parseRational('30:1')).toEqual(rational(30));
    expect(parseRational(' 25 ')).toEqual(rational(25));
    expect(() => parseRational('vingt-cinq')).toThrow(SyntaxError);
  });

  it('retrouve les cadences NTSC depuis un flottant de demuxer', () => {
    expect(approximate(23.976023976023978)).toEqual(rational(24000, 1001));
    expect(approximate(29.97002997002997)).toEqual(rational(30000, 1001));
    expect(approximate(59.94005994005994)).toEqual(rational(60000, 1001));
    expect(approximate(25)).toEqual(rational(25));
  });
});
