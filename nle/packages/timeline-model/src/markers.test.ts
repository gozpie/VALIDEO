/**
 * Marqueurs : ce qui compte est l'ordre maintenu et le refus des doublons.
 */
import { describe, it, expect } from 'vitest';
import { isErr, unwrap } from '@valideo/shared';
import { makeSequence } from './fixtures.js';
import { addMarker, nextMarker, previousMarker, removeMarker, updateMarker } from './markers.js';

const vide = () => makeSequence([{ id: 'v1' }]);

describe('marqueurs (§41)', () => {
  it('pose des marqueurs et les garde triés quel que soit l’ordre de pose', () => {
    let seq = unwrap(addMarker(vide(), { time: 100, name: 'Fin' }));
    seq = unwrap(addMarker(seq, { time: 10, name: 'Début' }));
    seq = unwrap(addMarker(seq, { time: 50 }));
    expect(seq.markers.map((m) => m.time)).toEqual([10, 50, 100]);
  });

  it('refuse deux marqueurs à la même image', () => {
    const seq = unwrap(addMarker(vide(), { time: 42 }));
    const r = addMarker(seq, { time: 42 });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.action).toContain('Déplacez la tête');
  });

  it('ramène une position négative à zéro', () => {
    const seq = unwrap(addMarker(vide(), { time: -30 }));
    expect(seq.markers[0]?.time).toBe(0);
  });

  it('navigue au marqueur suivant et précédent, strictement', () => {
    let seq = unwrap(addMarker(vide(), { time: 10 }));
    seq = unwrap(addMarker(seq, { time: 50 }));
    expect(nextMarker(seq, 10)?.time).toBe(50);
    expect(nextMarker(seq, 50)).toBeNull();
    expect(previousMarker(seq, 50)?.time).toBe(10);
    expect(previousMarker(seq, 10)).toBeNull();
  });

  it('renomme et déplace, en re-triant', () => {
    let seq = unwrap(addMarker(vide(), { time: 10, name: 'a' }));
    seq = unwrap(addMarker(seq, { time: 50, name: 'b' }));
    const id = seq.markers[0]!.id;
    seq = unwrap(updateMarker(seq, id, { time: 90, name: 'a déplacé' }));
    expect(seq.markers.map((m) => m.name)).toEqual(['b', 'a déplacé']);
  });

  it('refuse de déplacer un marqueur sur un autre', () => {
    let seq = unwrap(addMarker(vide(), { time: 10 }));
    seq = unwrap(addMarker(seq, { time: 50 }));
    expect(isErr(updateMarker(seq, seq.markers[0]!.id, { time: 50 }))).toBe(true);
  });

  it('retire un marqueur, et signale celui qui n’existe plus', () => {
    const seq = unwrap(addMarker(vide(), { time: 10 }));
    expect(unwrap(removeMarker(seq, seq.markers[0]!.id)).markers).toHaveLength(0);
    expect(isErr(removeMarker(seq, 'fantôme'))).toBe(true);
  });
});
