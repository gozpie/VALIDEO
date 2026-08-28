/**
 * Presse-papiers : ce qui compte est la conservation des positions RELATIVES,
 * et l independance des clips colles vis-a-vis de ceux qui ont ete copies.
 */
import { describe, it, expect } from 'vitest';
import { isErr, unwrap } from '@valideo/shared';
import { layout, makeContext, makeSequence } from './fixtures.js';
import { clipsInRange, findClip } from './query.js';
import { copyClips, pasteClips } from './clipboard.js';

const ctx = makeContext();

/** V1 et V2 avec des clips étagés, A1 avec le son du premier plan. */
function etagee() {
  return makeSequence([
    {
      id: 'v1',
      clips: [
        { id: 'a', start: 0, duration: 100, sourceIn: 1000 },
        { id: 'b', start: 100, duration: 100, sourceIn: 2000 },
      ],
    },
    {
      id: 'v2',
      index: 1,
      clips: [{ id: 'titre', start: 20, duration: 50, sourceIn: 0 }],
    },
    {
      id: 'a1',
      kind: 'audio',
      clips: [{ id: 'son', start: 0, duration: 100, sourceIn: 1000 }],
    },
  ]);
}

describe('copie', () => {
  it('refuse de copier une sélection vide', () => {
    expect(isErr(copyClips(etagee(), []))).toBe(true);
  });

  it('mémorise les décalages relatifs, pas les positions absolues', () => {
    const c = unwrap(copyClips(etagee(), ['b', 'titre']));
    expect(c.duration).toBe(180); // de 20 à 200
    const parId = new Map(c.entries.map((e) => [e.clip.id, e]));
    // Le clip le plus à gauche est l'origine : c'est `titre`, à 20.
    expect(parId.get('titre')?.offset).toBe(0);
    expect(parId.get('b')?.offset).toBe(80);
    // Et l'étagement : V1 est la plus basse des vidéos copiées, donc rang 0.
    expect(parId.get('b')?.trackOffset).toBe(0);
    expect(parId.get('titre')?.trackOffset).toBe(1);
  });
});

describe('collage', () => {
  it('reproduit l’étagement sur les pistes ciblées', () => {
    const seq = etagee();
    const c = unwrap(copyClips(seq, ['a', 'titre']));
    const colle = unwrap(
      pasteClips(seq, c, { at: 300, videoTrackId: 'v1', audioTrackId: 'a1' }, ctx),
    );
    expect(clipsInRange(colle.tracks[0]!, 300, 400)).toHaveLength(1);
    // Le titre était 20 images plus loin et une piste plus haut : il le reste.
    const surV2 = clipsInRange(colle.tracks[1]!, 300, 400);
    expect(surV2).toHaveLength(1);
    expect(surV2[0]!.start).toBe(320);
  });

  it('donne aux clips collés des identifiants neufs', () => {
    const seq = etagee();
    const c = unwrap(copyClips(seq, ['a']));
    const colle = unwrap(
      pasteClips(seq, c, { at: 300, videoTrackId: 'v1', audioTrackId: null }, ctx),
    );
    // L'original est intact et le collage ne le duplique pas en identifiant.
    expect(findClip(colle, 'a')?.clip.start).toBe(0);
    const nouveau = clipsInRange(colle.tracks[0]!, 300, 400)[0];
    expect(nouveau?.id).not.toBe('a');
  });

  it('relie entre eux les clips liés collés, sans toucher aux originaux', () => {
    const seq = makeSequence([
      { id: 'v1', clips: [{ id: 'img', start: 0, duration: 60, sourceIn: 0, linkGroup: 'g' }] },
      {
        id: 'a1',
        kind: 'audio',
        clips: [{ id: 'son', start: 0, duration: 60, sourceIn: 0, linkGroup: 'g' }],
      },
    ]);
    const c = unwrap(copyClips(seq, ['img', 'son']));
    const colle = unwrap(
      pasteClips(seq, c, { at: 200, videoTrackId: 'v1', audioTrackId: 'a1' }, ctx),
    );
    const img2 = clipsInRange(colle.tracks[0]!, 200, 260)[0];
    const son2 = clipsInRange(colle.tracks[1]!, 200, 260)[0];
    expect(img2?.linkGroup).not.toBeNull();
    expect(img2?.linkGroup).toBe(son2?.linkGroup);
    // Nouveau groupe : coller ne doit pas rattacher la copie à l'original.
    expect(img2?.linkGroup).not.toBe('g');
    expect(findClip(colle, 'img')?.clip.linkGroup).toBe('g');
  });

  it('écrase ce qu’il recouvre en collage simple', () => {
    const seq = etagee();
    const c = unwrap(copyClips(seq, ['a']));
    const colle = unwrap(
      pasteClips(seq, c, { at: 50, videoTrackId: 'v1', audioTrackId: null }, ctx),
    );
    // Le collage occupe [50,150) : `a` est rogné et `b` voit son entrée décalée.
    expect(findClip(colle, 'a')?.clip.duration).toBe(50);
    expect(findClip(colle, 'b')?.clip.start).toBe(150);
    expect(colle.tracks[0]!.clips).toHaveLength(3);
  });

  it('décale la suite en collage par insertion', () => {
    const seq = etagee();
    const c = unwrap(copyClips(seq, ['a']));
    const colle = unwrap(
      pasteClips(seq, c, { at: 100, videoTrackId: 'v1', audioTrackId: null, insert: true }, ctx),
    );
    // `b` était à 100 : il part à 200, et rien n'est écrasé.
    expect(findClip(colle, 'b')?.clip.start).toBe(200);
    expect(findClip(colle, 'a')?.clip.duration).toBe(100);
    expect(clipsInRange(colle.tracks[0]!, 100, 200)).toHaveLength(1);
  });

  it('refuse quand il manque une piste pour tout recevoir', () => {
    const seq = etagee();
    const c = unwrap(copyClips(seq, ['a', 'titre']));
    // On cible la piste vidéo la plus haute : il n'y a rien au-dessus.
    const r = pasteClips(seq, c, { at: 300, videoTrackId: 'v2', audioTrackId: null }, ctx);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('TRACK_NOT_FOUND');
  });

  it('laisse la séquence intacte quand le collage échoue', () => {
    const seq = etagee();
    const c = unwrap(copyClips(seq, ['a', 'titre']));
    const r = pasteClips(seq, c, { at: 300, videoTrackId: 'v2', audioTrackId: null }, ctx);
    expect(isErr(r)).toBe(true);
    expect(layout(seq, 'v2')).toBe('titre[20,70)');
  });
});
