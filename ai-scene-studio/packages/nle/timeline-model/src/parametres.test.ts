import { describe, expect, it } from 'vitest';
import { createClip } from '@valideo/project-model';
import type { ParameterDoc } from '@valideo/project-model';
import { rational, timebase } from '@valideo/time-core';
import { basculerCle, cleA, ecrireParametre, nombreA, vecteurA } from './parametres';
import { noSourceInfo } from './source';
import { decalerCles, trimHead } from './track-ops';

const constant = (value: number | number[]): ParameterDoc => ({ value, keyframes: [] });

describe('paramètres animés', () => {
  it('rend la valeur constante sans clé, et le défaut si elle n’est pas du bon type', () => {
    expect(nombreA(constant(40), 10, 100)).toBe(40);
    expect(nombreA({ value: 'x', keyframes: [] }, 10, 100)).toBe(100);
    expect(vecteurA(constant([3, 4]), 0, [0, 0])).toEqual([3, 4]);
  });

  it('interpole entre deux clés et tient la valeur hors d’elles', () => {
    let p = basculerCle(constant(0), 10, 0);
    p = basculerCle(p, 20, 100);
    expect(nombreA(p, 0, 50)).toBe(0);
    expect(nombreA(p, 15, 50)).toBe(50);
    expect(nombreA(p, 40, 50)).toBe(100);
  });

  it('interpole chaque composante d’un vecteur', () => {
    let p = basculerCle(constant([100, 100]), 0, [100, 100]);
    p = basculerCle(p, 10, [120, 140]);
    expect(vecteurA(p, 5, [0, 0])).toEqual([110, 120]);
  });

  it('un paramètre animé pose une clé là où on le change ; constant, il change partout', () => {
    expect(ecrireParametre(constant(1), 5, 2)).toEqual(constant(2));
    const anime = ecrireParametre(basculerCle(constant(1), 0, 1), 5, 2);
    expect(anime.keyframes.map((k) => k.time)).toEqual([0, 5]);
    expect(nombreA(anime, 5, 0)).toBe(2);
  });

  it('retirer la dernière clé rend le paramètre constant sans que la valeur saute', () => {
    const p = basculerCle(constant(1), 3, 7);
    const q = basculerCle(p, 3, 7);
    expect(cleA(q, 3)).toBeUndefined();
    expect(q).toEqual(constant(7));
  });

  it('une clé retirée alors qu’il en reste d’autres ne change pas la valeur constante', () => {
    const p = basculerCle(basculerCle(constant(1), 3, 7), 9, 8);
    const q = basculerCle(p, 3, 7);
    expect(q.keyframes.map((k) => k.time)).toEqual([9]);
  });

  it('couper la tête d’un clip garde chaque clé sur la même image du média', () => {
    const base = createClip('video', 't', 100, 50);
    const clip = { ...base, opacity: basculerCle(basculerCle(constant(100), 0, 0), 40, 100) };
    const ctx = { timebase: timebase(rational(25)), resolveSource: noSourceInfo };
    const coupe = trimHead(clip, 120, ctx);
    expect(coupe.opacity.keyframes.map((k) => k.time)).toEqual([-20, 20]);
    // Même image de la timeline, même valeur.
    expect(nombreA(coupe.opacity, 130 - coupe.start, 0)).toBe(
      nombreA(clip.opacity, 130 - clip.start, 0),
    );
    expect(decalerCles(clip, 0)).toBe(clip);
  });
});
