/**
 * Gestion des pistes : ce qui compte est que les clips ne bougent pas, que les
 * rangs restent contigus, et qu'un nom choisi par l'utilisateur survive.
 */
import { describe, it, expect } from 'vitest';
import { isErr, unwrap } from '@valideo/shared';
import { makeSequence } from './fixtures.js';
import { addTrack, removeTrack, renameTrack, setClipEnabled, setClipLabel } from './edit-ops.js';
import { findClip } from './query.js';

function deuxVideo() {
  return makeSequence([
    { id: 'v1', index: 0, clips: [{ id: 'a', start: 0, duration: 50, sourceIn: 0 }] },
    { id: 'v2', index: 1, clips: [{ id: 'b', start: 0, duration: 50, sourceIn: 0 }] },
    { id: 'a1', kind: 'audio', index: 0 },
  ]);
}

describe('ajout de piste', () => {
  it('insère au rang demandé et décale celles du dessus', () => {
    const next = unwrap(addTrack(deuxVideo(), 'video', 1));
    const video = next.tracks.filter((t) => t.kind === 'video').sort((x, y) => x.index - y.index);
    expect(video.map((t) => t.index)).toEqual([0, 1, 2]);
    // Les clips n'ont pas bougé : ils tiennent à l'identifiant, pas au rang.
    expect(findClip(next, 'b')?.clip.start).toBe(0);
  });

  it('renumérote les noms par défaut mais respecte un nom choisi', () => {
    const base = unwrap(renameTrack(deuxVideo(), 'v2', 'Titrage'));
    const next = unwrap(addTrack(base, 'video', 1));
    const noms = next.tracks
      .filter((t) => t.kind === 'video')
      .sort((x, y) => x.index - y.index)
      .map((t) => t.name);
    // V1 reste V1, la nouvelle prend V2, et « Titrage » garde son nom.
    expect(noms).toEqual(['V1', 'V2', 'Titrage']);
  });

  it('ne vole pas le ciblage à la piste qui l’avait', () => {
    const base = makeSequence([{ id: 'v1', index: 0, targeted: true }]);
    const next = unwrap(addTrack(base, 'video', 0));
    const ciblees = next.tracks.filter((t) => t.targeted);
    expect(ciblees).toHaveLength(1);
    expect(ciblees[0]?.id).toBe(base.tracks[0]?.id);
  });
});

describe('suppression de piste', () => {
  it('retire la piste, ses clips, et resserre les rangs', () => {
    const next = unwrap(removeTrack(deuxVideo(), 'v1'));
    expect(next.tracks.filter((t) => t.kind === 'video')).toHaveLength(1);
    expect(findClip(next, 'a')).toBeUndefined();
    expect(next.tracks.filter((t) => t.kind === 'video')[0]?.index).toBe(0);
  });

  it('refuse la dernière piste de son type', () => {
    const r = removeTrack(deuxVideo(), 'a1');
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.message).toContain('dernière piste audio');
  });

  it('refuse une piste verrouillée', () => {
    const base = makeSequence([
      { id: 'v1', index: 0, locked: true },
      { id: 'v2', index: 1 },
    ]);
    expect(isErr(removeTrack(base, 'v1'))).toBe(true);
  });

  it('délie les clips restants dont le partenaire disparaît', () => {
    const base = makeSequence([
      { id: 'v1', index: 0, clips: [{ id: 'img', start: 0, duration: 50, sourceIn: 0, linkGroup: 'g' }] },
      { id: 'v2', index: 1 },
      {
        id: 'a1',
        kind: 'audio',
        index: 0,
        clips: [{ id: 'son', start: 0, duration: 50, sourceIn: 0, linkGroup: 'g' }],
      },
    ]);
    const next = unwrap(removeTrack(base, 'v1'));
    // Un groupe à un seul membre ne veut plus rien dire.
    expect(findClip(next, 'son')?.clip.linkGroup).toBeNull();
  });
});

describe('propriétés de clip', () => {
  it('renomme, étiquette et désactive sans déplacer le clip', () => {
    let seq = unwrap(renameTrack(deuxVideo(), 'v1', 'Image'));
    seq = unwrap(setClipLabel(seq, ['a'], '#00ff00'));
    seq = unwrap(setClipEnabled(seq, ['a'], false));
    const a = findClip(seq, 'a')!.clip;
    expect(a.label).toBe('#00ff00');
    expect(a.enabled).toBe(false);
    // Désactiver n'est pas supprimer : la place et la durée sont intactes.
    expect(a.start).toBe(0);
    expect(a.duration).toBe(50);
  });

  it('retire l’étiquette avec null', () => {
    const seq = unwrap(setClipLabel(unwrap(setClipLabel(deuxVideo(), ['a'], '#f00')), ['a'], null));
    expect(findClip(seq, 'a')?.clip.label).toBeNull();
  });

  it('signale un clip disparu au lieu d’ignorer', () => {
    expect(isErr(setClipEnabled(deuxVideo(), ['fantôme'], false))).toBe(true);
  });

  it('un nom de piste vide revient au nom par défaut de son rang', () => {
    const seq = unwrap(renameTrack(unwrap(renameTrack(deuxVideo(), 'v2', 'Titrage')), 'v2', '  '));
    expect(seq.tracks.find((t) => t.name === 'V2')).toBeDefined();
  });
});
