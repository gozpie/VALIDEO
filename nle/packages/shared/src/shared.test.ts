import { describe, it, expect } from 'vitest';
import { newClipId, newTrackId, isUuid, uuid } from './id.js';
import { ok, err, isOk, isErr, unwrap, unwrapOr, mapResult, andThen, collect } from './result.js';
import { appError, invariant, InvariantError } from './errors.js';

describe('identifiants', () => {
  it('genere des UUID v4 distincts', () => {
    const a = newClipId();
    const b = newClipId();
    expect(a).not.toBe(b);
    expect(isUuid(a)).toBe(true);
    expect(isUuid(uuid())).toBe(true);
  });

  it('requalifie une chaine lue sur disque', () => {
    const raw = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';
    expect(newTrackId.of(raw)).toBe(raw);
  });

  it('rejette une chaine qui n est pas un UUID', () => {
    expect(isUuid('clip-1')).toBe(false);
    expect(isUuid('')).toBe(false);
  });
});

describe('Result', () => {
  it('distingue Ok et Err', () => {
    expect(isOk(ok(1))).toBe(true);
    expect(isErr(err('boum'))).toBe(true);
    expect(unwrap(ok(42))).toBe(42);
    expect(() => unwrap(err('boum'))).toThrow();
    expect(unwrapOr(err('boum'), 7)).toBe(7);
  });

  it('enchaine les transformations', () => {
    expect(mapResult(ok(2), (v) => v * 3)).toEqual(ok(6));
    expect(mapResult(err<string>('boum'), (v: number) => v * 3)).toEqual(err('boum'));
    expect(andThen(ok(2), (v) => ok(v + 1))).toEqual(ok(3));
    expect(andThen(ok(2), () => err('non'))).toEqual(err('non'));
  });

  it('collect s arrete au premier echec', () => {
    expect(collect([ok(1), ok(2)])).toEqual(ok([1, 2]));
    expect(collect([ok(1), err('boum'), ok(3)])).toEqual(err('boum'));
  });
});

describe('erreurs', () => {
  it('porte code, action et detail', () => {
    const e = appError('MEDIA_OFFLINE', 'Média hors ligne', {
      action: 'Relier le média',
      detail: '/rushes/A001.mov introuvable',
      retryable: true,
    });
    expect(e.code).toBe('MEDIA_OFFLINE');
    expect(e.action).toBe('Relier le média');
    expect(e.retryable).toBe(true);
  });

  it('invariant leve sur condition fausse', () => {
    expect(() => invariant(false, 'piste inconnue')).toThrow(InvariantError);
    expect(() => invariant(true, 'ok')).not.toThrow();
  });
});
