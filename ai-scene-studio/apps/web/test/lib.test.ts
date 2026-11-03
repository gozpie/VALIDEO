import { describe, expect, it } from 'vitest';
import { errorMessage } from '@/lib/api';
import { safeNextPath } from '@/lib/navigation';
import { moveItem } from '@/lib/order';
import { FPS_PRESETS, formatDuration, formatFps, presetValue } from '@/lib/presets';

describe('moveItem', () => {
  it('déplace d’un cran et ignore les bords', () => {
    expect(moveItem(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b'], 'a', -1)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 'b', 1)).toEqual(['a', 'b']);
    expect(moveItem(['a'], 'z', 1)).toEqual(['a']);
  });
});

describe('safeNextPath', () => {
  it('n’accepte que des chemins internes', () => {
    expect(safeNextPath('/projects/1')).toBe('/projects/1');
    expect(safeNextPath(null)).toBe('/workspaces');
    expect(safeNextPath('https://evil.example')).toBe('/workspaces');
    expect(safeNextPath('//evil.example')).toBe('/workspaces');
    expect(safeNextPath('/\\evil.example')).toBe('/workspaces');
  });
});

describe('errorMessage', () => {
  it('préfère le message de champ, puis le détail, puis le repli', () => {
    expect(
      errorMessage({ detail: 'Validation échouée', errors: [{ message: 'Trop court' }] }),
    ).toBe('Trop court');
    expect(errorMessage({ detail: 'Droits insuffisants' })).toBe('Droits insuffisants');
    expect(errorMessage(new TypeError('Failed to fetch'))).toBe('API injoignable');
    expect(errorMessage(undefined, 'Repli')).toBe('Repli');
  });
});

describe('cadences', () => {
  it('formate les cadences et les durées', () => {
    expect(formatFps({ numerator: 25, denominator: 1 })).toBe('25');
    expect(formatFps({ numerator: 24000, denominator: 1001 })).toBe('23,976');
    expect(formatDuration(50, { numerator: 25, denominator: 1 })).toBe('2,00 s');
    expect(formatDuration(24, { numerator: 24000, denominator: 1001 })).toBe('1,00 s');
  });

  it('retombe sur la valeur par défaut pour un index inconnu', () => {
    const fallback = { numerator: 24, denominator: 1 };
    expect(presetValue(FPS_PRESETS, '2', fallback)).toEqual({ numerator: 25, denominator: 1 });
    expect(presetValue(FPS_PRESETS, '99', fallback)).toBe(fallback);
  });
});
