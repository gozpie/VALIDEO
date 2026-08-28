import { describe, it, expect } from 'vitest';
import { isErr, unwrap } from '@valideo/shared';
import { layout, makeClip, makeContext, makeSequence } from './fixtures.js';
import { checkSequence, findClip, gaps, sequenceDuration } from './query.js';
import {
  addEditAtPlayhead,
  deleteClip,
  extract,
  insert,
  lift,
  moveClip,
  overwrite,
  razor,
  selectTrackForward,
  setTrackFlags,
  moveClips,
  deleteClips,
} from './edit-ops.js';

const ctx = makeContext();

/** Trois clips jointifs de 100 images sur V1. */
function threeInARow() {
  return makeSequence([
    {
      id: 'v1',
      targeted: true,
      clips: [
        { id: 'a', start: 0, duration: 100, sourceIn: 1000 },
        { id: 'b', start: 100, duration: 100, sourceIn: 2000 },
        { id: 'c', start: 200, duration: 100, sourceIn: 3000 },
      ],
    },
  ]);
}

function noViolation(seq: ReturnType<typeof threeInARow>): void {
  expect(checkSequence(seq)).toEqual([]);
}

// ============================================================ OVERWRITE (§91)

describe('Overwrite', () => {
  it('pose un clip sur une piste vide', () => {
    const seq = makeSequence([{ id: 'v1' }]);
    const clip = makeClip('v1', { id: 'x', start: 0, duration: 50 });
    const next = unwrap(overwrite(seq, { clip, trackId: 'v1', at: 100 }, ctx));
    expect(layout(next, 'v1')).toBe('x[100,150)');
    noViolation(next);
  });

  it('efface entierement un clip recouvert', () => {
    const seq = threeInARow();
    const clip = makeClip('v1', { id: 'x', start: 0, duration: 100 });
    const next = unwrap(overwrite(seq, { clip, trackId: 'v1', at: 100 }, ctx));
    expect(layout(next, 'v1')).toBe('a[0,100) x[100,200) c[200,300)');
    noViolation(next);
  });

  it('rogne le clip sortant par la droite', () => {
    const seq = threeInARow();
    const clip = makeClip('v1', { id: 'x', start: 0, duration: 100 });
    const next = unwrap(overwrite(seq, { clip, trackId: 'v1', at: 50 }, ctx));
    expect(layout(next, 'v1')).toBe('a[0,50) x[50,150) b[150,200) c[200,300)');
    noViolation(next);
  });

  it('avance le point d entree source du clip rogne par la gauche', () => {
    const seq = threeInARow();
    const clip = makeClip('v1', { id: 'x', start: 0, duration: 100 });
    const next = unwrap(overwrite(seq, { clip, trackId: 'v1', at: 50 }, ctx));
    // b commencait a 100 avec sourceIn 2000 ; ampute de 50 images, il doit
    // demarrer 50 images plus loin dans sa source.
    const b = findClip(next, 'b');
    expect(b?.clip.start).toBe(150);
    expect(b?.clip.sourceIn).toBe(2050);
  });

  it('coupe en deux un clip traverse de part en part', () => {
    const seq = makeSequence([
      { id: 'v1', clips: [{ id: 'long', start: 0, duration: 300, sourceIn: 500 }] },
    ]);
    const clip = makeClip('v1', { id: 'x', start: 0, duration: 50 });
    const next = unwrap(overwrite(seq, { clip, trackId: 'v1', at: 100 }, ctx));
    const track = next.tracks[0];
    expect(track?.clips).toHaveLength(3);
    expect(track?.clips[0]?.duration).toBe(100);
    expect(track?.clips[2]?.start).toBe(150);
    // La queue reprend la source la ou elle s etait arretee.
    expect(track?.clips[2]?.sourceIn).toBe(500 + 150);
    noViolation(next);
  });

  it('ne modifie pas la duree de la sequence quand le clip tient dedans (§91)', () => {
    const seq = threeInARow();
    const clip = makeClip('v1', { id: 'x', start: 0, duration: 50 });
    const next = unwrap(overwrite(seq, { clip, trackId: 'v1', at: 100 }, ctx));
    expect(sequenceDuration(next)).toBe(sequenceDuration(seq));
  });

  it('allonge la sequence quand le clip la depasse', () => {
    const seq = threeInARow();
    const clip = makeClip('v1', { id: 'x', start: 0, duration: 100 });
    const next = unwrap(overwrite(seq, { clip, trackId: 'v1', at: 250 }, ctx));
    expect(sequenceDuration(next)).toBe(350);
  });

  it('refuse une piste verrouillee', () => {
    const seq = makeSequence([{ id: 'v1', locked: true }]);
    const clip = makeClip('v1', { id: 'x', start: 0, duration: 50 });
    const r = overwrite(seq, { clip, trackId: 'v1', at: 0 }, ctx);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('TRACK_LOCKED');
  });

  it('refuse une position negative et une duree nulle', () => {
    const seq = makeSequence([{ id: 'v1' }]);
    const clip = makeClip('v1', { id: 'x', start: 0, duration: 50 });
    expect(isErr(overwrite(seq, { clip, trackId: 'v1', at: -1 }, ctx))).toBe(true);
    expect(
      isErr(overwrite(seq, { clip: { ...clip, duration: 0 }, trackId: 'v1', at: 0 }, ctx)),
    ).toBe(true);
  });
});

// =============================================================== INSERT (§91)

describe('Insert', () => {
  it('decale tout ce qui suit sur la piste cible', () => {
    const seq = threeInARow();
    const clip = makeClip('v1', { id: 'x', start: 0, duration: 40 });
    const next = unwrap(insert(seq, { clip, trackId: 'v1', at: 100 }, ctx));
    expect(layout(next, 'v1')).toBe('a[0,100) x[100,140) b[140,240) c[240,340)');
    noViolation(next);
  });

  it('coupe le clip traverse avant de decaler', () => {
    const seq = makeSequence([
      { id: 'v1', clips: [{ id: 'long', start: 0, duration: 200, sourceIn: 0 }] },
    ]);
    const clip = makeClip('v1', { id: 'x', start: 0, duration: 30 });
    const next = unwrap(insert(seq, { clip, trackId: 'v1', at: 50 }, ctx));
    const track = next.tracks[0];
    expect(track?.clips).toHaveLength(3);
    expect(track?.clips[0]?.duration).toBe(50);
    expect(track?.clips[1]?.id).toBe('x');
    expect(track?.clips[2]?.start).toBe(80);
    expect(track?.clips[2]?.sourceIn).toBe(50);
    noViolation(next);
  });

  it('allonge la sequence de la duree inseree (§91)', () => {
    const seq = threeInARow();
    const clip = makeClip('v1', { id: 'x', start: 0, duration: 40 });
    const next = unwrap(insert(seq, { clip, trackId: 'v1', at: 100 }, ctx));
    expect(sequenceDuration(next)).toBe(sequenceDuration(seq) + 40);
  });

  it('decale aussi les pistes en sync lock, pour ne pas desynchroniser', () => {
    const seq = makeSequence([
      { id: 'v1', clips: [{ id: 'a', start: 0, duration: 200 }] },
      { id: 'a1', kind: 'audio', clips: [{ id: 'son', start: 0, duration: 200 }], syncLock: true },
    ]);
    const clip = makeClip('v1', { id: 'x', start: 0, duration: 50 });
    const next = unwrap(insert(seq, { clip, trackId: 'v1', at: 100 }, ctx));
    // La piste audio est coupee au meme endroit et decalee d autant.
    expect(layout(next, 'a1')).toBe('son[0,100) son[150,250)');
    noViolation(next);
  });

  it('ne decale pas une piste dont le sync lock est desactive', () => {
    const seq = makeSequence([
      { id: 'v1', clips: [{ id: 'a', start: 0, duration: 200 }] },
      { id: 'a1', kind: 'audio', clips: [{ id: 'son', start: 0, duration: 200 }], syncLock: false },
    ]);
    const clip = makeClip('v1', { id: 'x', start: 0, duration: 50 });
    const next = unwrap(insert(seq, { clip, trackId: 'v1', at: 100 }, ctx));
    expect(layout(next, 'a1')).toBe('son[0,200)');
  });

  it('ne touche jamais une piste verrouillee', () => {
    const seq = makeSequence([
      { id: 'v1', clips: [{ id: 'a', start: 0, duration: 200 }] },
      { id: 'v2', index: 1, clips: [{ id: 'haut', start: 0, duration: 200 }], locked: true },
    ]);
    const clip = makeClip('v1', { id: 'x', start: 0, duration: 50 });
    const next = unwrap(insert(seq, { clip, trackId: 'v1', at: 100 }, ctx));
    expect(layout(next, 'v2')).toBe('haut[0,200)');
  });
});

// ====================================================== LIFT et EXTRACT (§92)

describe('Lift et Extract', () => {
  it('Lift retire la plage et laisse le trou', () => {
    const seq = threeInARow();
    const next = unwrap(lift(seq, { start: 100, end: 200, trackIds: ['v1'] }, ctx));
    expect(layout(next, 'v1')).toBe('a[0,100) c[200,300)');
    expect(gaps(next.tracks[0]!)).toEqual([{ start: 100, end: 200 }]);
    expect(sequenceDuration(next)).toBe(300);
  });

  it('Extract retire la plage et referme le trou', () => {
    const seq = threeInARow();
    const next = unwrap(extract(seq, { start: 100, end: 200, trackIds: ['v1'] }, ctx));
    expect(layout(next, 'v1')).toBe('a[0,100) c[100,200)');
    expect(gaps(next.tracks[0]!)).toEqual([]);
    expect(sequenceDuration(next)).toBe(200);
  });

  it('Extract fonctionne sur une plage partielle', () => {
    const seq = threeInARow();
    const next = unwrap(extract(seq, { start: 50, end: 150, trackIds: ['v1'] }, ctx));
    expect(layout(next, 'v1')).toBe('a[0,50) b[50,100) c[100,200)');
    noViolation(next);
  });

  it('Extract decale les pistes synchronisees vides sur la plage', () => {
    const seq = makeSequence([
      {
        id: 'v1',
        clips: [
          { id: 'a', start: 0, duration: 100 },
          { id: 'b', start: 100, duration: 100 },
        ],
      },
      { id: 'a1', kind: 'audio', clips: [{ id: 'son', start: 200, duration: 100 }] },
    ]);
    const next = unwrap(extract(seq, { start: 0, end: 100, trackIds: ['v1'] }, ctx));
    expect(layout(next, 'v1')).toBe('b[0,100)');
    expect(layout(next, 'a1')).toBe('son[100,200)');
  });

  it('refuse de refermer par-dessus du contenu encore present sur une piste synchronisee', () => {
    const seq = makeSequence([
      {
        id: 'v1',
        clips: [
          { id: 'a', start: 0, duration: 100 },
          { id: 'b', start: 100, duration: 100 },
        ],
      },
      { id: 'a1', kind: 'audio', clips: [{ id: 'son', start: 0, duration: 300 }], syncLock: true },
    ]);
    const r = extract(seq, { start: 0, end: 100, trackIds: ['v1'] }, ctx);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.code).toBe('EDIT_REJECTED');
      expect(r.error.message).toContain('A1');
    }
  });

  it('refuse une plage vide', () => {
    const seq = threeInARow();
    expect(isErr(lift(seq, { start: 100, end: 100, trackIds: ['v1'] }, ctx))).toBe(true);
  });

  it('supprime un clip avec ou sans ripple', () => {
    const seq = threeInARow();
    expect(layout(unwrap(deleteClip(seq, 'b', ctx, false)), 'v1')).toBe('a[0,100) c[200,300)');
    expect(layout(unwrap(deleteClip(seq, 'b', ctx, true)), 'v1')).toBe('a[0,100) c[100,200)');
  });

  it('signale un clip inexistant', () => {
    const r = deleteClip(threeInARow(), 'fantome', ctx);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('CLIP_NOT_FOUND');
  });
});

// ================================================== RAZOR et ADD EDIT (§94)

describe('Razor et Add Edit', () => {
  it('coupe un clip en deux morceaux contigus', () => {
    const seq = makeSequence([
      { id: 'v1', clips: [{ id: 'a', start: 0, duration: 100, sourceIn: 500 }] },
    ]);
    const next = unwrap(razor(seq, 40, ['v1'], ctx));
    const clips = next.tracks[0]?.clips ?? [];
    expect(clips).toHaveLength(2);
    expect(clips[0]?.start).toBe(0);
    expect(clips[0]?.duration).toBe(40);
    expect(clips[1]?.start).toBe(40);
    expect(clips[1]?.duration).toBe(60);
    // La source est continue de part et d autre de la coupe.
    expect(clips[0]?.sourceIn).toBe(500);
    expect(clips[1]?.sourceIn).toBe(540);
    noViolation(next);
  });

  it('donne un identifiant neuf a la seconde moitie', () => {
    const seq = makeSequence([{ id: 'v1', clips: [{ id: 'a', start: 0, duration: 100 }] }]);
    const clips = unwrap(razor(seq, 40, ['v1'], ctx)).tracks[0]?.clips ?? [];
    expect(clips[0]?.id).not.toBe(clips[1]?.id);
  });

  it('ne fait rien sur une coupe existante', () => {
    const seq = threeInARow();
    const next = unwrap(razor(seq, 100, ['v1'], ctx));
    expect(next.tracks[0]?.clips).toHaveLength(3);
  });

  it('ne fait rien dans un trou', () => {
    const seq = makeSequence([{ id: 'v1', clips: [{ id: 'a', start: 0, duration: 50 }] }]);
    const next = unwrap(razor(seq, 200, ['v1'], ctx));
    expect(next.tracks[0]?.clips).toHaveLength(1);
  });

  it('Add Edit ne coupe que les pistes ciblees', () => {
    const seq = makeSequence([
      { id: 'v1', targeted: true, clips: [{ id: 'a', start: 0, duration: 100 }] },
      { id: 'v2', index: 1, targeted: false, clips: [{ id: 'b', start: 0, duration: 100 }] },
    ]);
    const next = unwrap(addEditAtPlayhead(seq, 50, ctx));
    expect(next.tracks[0]?.clips).toHaveLength(2);
    expect(next.tracks[1]?.clips).toHaveLength(1);
  });

  it('refuse Add Edit sans piste ciblee', () => {
    const seq = makeSequence([
      { id: 'v1', targeted: false, clips: [{ id: 'a', start: 0, duration: 100 }] },
    ]);
    expect(isErr(addEditAtPlayhead(seq, 50, ctx))).toBe(true);
  });
});

// ========================================================== DEPLACEMENT

describe('Déplacement de clip', () => {
  it('déplace et libère la position d origine', () => {
    const seq = threeInARow();
    const next = unwrap(moveClip(seq, { clipId: 'a', toStart: 400 }, ctx));
    expect(layout(next, 'v1')).toBe('b[100,200) c[200,300) a[400,500)');
    noViolation(next);
  });

  it('recouvre ce qui se trouve a l arrivee', () => {
    const seq = threeInARow();
    const next = unwrap(moveClip(seq, { clipId: 'a', toStart: 150 }, ctx));
    expect(layout(next, 'v1')).toBe('b[100,150) a[150,250) c[250,300)');
    noViolation(next);
  });

  it('change de piste', () => {
    const seq = makeSequence([
      { id: 'v1', clips: [{ id: 'a', start: 0, duration: 100 }] },
      { id: 'v2', index: 1 },
    ]);
    const next = unwrap(moveClip(seq, { clipId: 'a', toStart: 50, toTrackId: 'v2' }, ctx));
    expect(layout(next, 'v1')).toBe('');
    expect(layout(next, 'v2')).toBe('a[50,150)');
    expect(next.tracks[1]?.clips[0]?.trackId).toBe('v2');
  });

  it('refuse de mettre un clip vidéo sur une piste audio', () => {
    const seq = makeSequence([
      { id: 'v1', clips: [{ id: 'a', start: 0, duration: 100 }] },
      { id: 'a1', kind: 'audio' },
    ]);
    const r = moveClip(seq, { clipId: 'a', toStart: 0, toTrackId: 'a1' }, ctx);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.message).toContain('audio');
  });

  it('refuse une position negative', () => {
    expect(isErr(moveClip(threeInARow(), { clipId: 'a', toStart: -5 }, ctx))).toBe(true);
  });
});

// =================================================== PROPRIÉTÉS DE PISTE

describe('Propriétés de piste', () => {
  it('modifie les drapeaux', () => {
    const seq = makeSequence([{ id: 'v1' }]);
    const next = unwrap(setTrackFlags(seq, 'v1', { targeted: true, muted: true }));
    expect(next.tracks[0]?.targeted).toBe(true);
    expect(next.tracks[0]?.muted).toBe(true);
  });

  it('refuse de modifier une piste verrouillée', () => {
    const seq = makeSequence([{ id: 'v1', locked: true }]);
    const r = setTrackFlags(seq, 'v1', { targeted: true });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('TRACK_LOCKED');
  });

  it('laisse TOUJOURS déverrouiller une piste verrouillée', () => {
    // Sans cette exception, une piste verrouillée le resterait pour toujours.
    const seq = makeSequence([{ id: 'v1', locked: true }]);
    const next = unwrap(setTrackFlags(seq, 'v1', { locked: false }));
    expect(next.tracks[0]?.locked).toBe(false);
  });

  it('refuse une hauteur absurde', () => {
    const seq = makeSequence([{ id: 'v1' }]);
    expect(isErr(setTrackFlags(seq, 'v1', { height: 4 }))).toBe(true);
  });

  it('signale une piste inexistante', () => {
    const r = setTrackFlags(makeSequence([{ id: 'v1' }]), 'fantome', { muted: true });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('TRACK_NOT_FOUND');
  });

  it('sélectionne vers l avant sur une piste', () => {
    const seq = makeSequence([
      {
        id: 'v1',
        clips: [
          { id: 'a', start: 0, duration: 100 },
          { id: 'b', start: 100, duration: 100 },
          { id: 'c', start: 200, duration: 100 },
        ],
      },
      { id: 'v2', index: 1, clips: [{ id: 'd', start: 150, duration: 100 }] },
    ]);
    expect(selectTrackForward(seq, 'v1', 150)).toEqual(['b', 'c']);
    expect(selectTrackForward(seq, 'v1', 0)).toEqual(['a', 'b', 'c']);
    expect(selectTrackForward(seq, 'v1', 999)).toEqual([]);
    // Avec le modificateur, toutes les pistes suivent.
    expect(selectTrackForward(seq, 'v1', 150, true).sort()).toEqual(['b', 'c', 'd']);
  });
});

// ============================================ DÉPLACEMENT ET SUPPRESSION GROUPÉS

describe('Déplacement groupé', () => {
  it('déplace deux clips voisins sans qu ils s écrasent mutuellement', () => {
    const seq = threeInARow();
    // a[0,100) et b[100,200) décalés tous deux de +50. Les déplacer l un après
    // l autre ferait écraser le début de b par a.
    const next = unwrap(
      moveClips(seq, [{ clipId: 'a', toStart: 50 }, { clipId: 'b', toStart: 150 }], ctx),
    );
    expect(layout(next, 'v1')).toBe('a[50,150) b[150,250) c[250,300)');
    expect(findClip(next, 'a')?.clip.duration).toBe(100);
    expect(findClip(next, 'b')?.clip.duration).toBe(100);
    expect(checkSequence(next)).toEqual([]);
  });

  it('déplace une paire audio/vidéo liée de la même quantité', () => {
    const seq = makeSequence([
      { id: 'v1', clips: [{ id: 'img', start: 0, duration: 100, linkGroup: 'g' }] },
      { id: 'a1', kind: 'audio', clips: [{ id: 'son', start: 0, duration: 100, linkGroup: 'g' }] },
    ]);
    const next = unwrap(
      moveClips(seq, [{ clipId: 'img', toStart: 200 }, { clipId: 'son', toStart: 200 }], ctx),
    );
    expect(layout(next, 'v1')).toBe('img[200,300)');
    expect(layout(next, 'a1')).toBe('son[200,300)');
  });

  it('change de piste pour un seul clip du groupe', () => {
    const seq = makeSequence([
      { id: 'v1', clips: [{ id: 'a', start: 0, duration: 50 }, { id: 'b', start: 50, duration: 50 }] },
      { id: 'v2', index: 1 },
    ]);
    const next = unwrap(
      moveClips(seq, [{ clipId: 'a', toStart: 0, toTrackId: 'v2' }, { clipId: 'b', toStart: 50 }], ctx),
    );
    expect(layout(next, 'v1')).toBe('b[50,100)');
    expect(layout(next, 'v2')).toBe('a[0,50)');
  });

  it('est ATOMIQUE : si un clip ne peut pas bouger, aucun ne bouge', () => {
    const seq = makeSequence([
      { id: 'v1', clips: [{ id: 'a', start: 0, duration: 50 }] },
      { id: 'v2', index: 1, locked: true, clips: [{ id: 'b', start: 0, duration: 50 }] },
    ]);
    const r = moveClips(seq, [{ clipId: 'a', toStart: 100 }, { clipId: 'b', toStart: 100 }], ctx);
    expect(isErr(r)).toBe(true);
    // Et la séquence d'origine est intacte.
    expect(layout(seq, 'v1')).toBe('a[0,50)');
  });

  it('refuse un déplacement vers une piste de type incompatible', () => {
    const seq = makeSequence([
      { id: 'v1', clips: [{ id: 'a', start: 0, duration: 50 }] },
      { id: 'a1', kind: 'audio' },
    ]);
    expect(isErr(moveClips(seq, [{ clipId: 'a', toStart: 0, toTrackId: 'a1' }], ctx))).toBe(true);
  });

  it('ne fait rien sur une liste vide', () => {
    const seq = threeInARow();
    expect(unwrap(moveClips(seq, [], ctx))).toBe(seq);
  });
});

describe('Suppression groupée', () => {
  it('supprime plusieurs clips sans ripple', () => {
    const next = unwrap(deleteClips(threeInARow(), ['a', 'c'], ctx, false));
    expect(layout(next, 'v1')).toBe('b[100,200)');
  });

  it('supprime plusieurs clips AVEC ripple, dans le bon ordre', () => {
    // Supprimer du début vers la fin décalerait les suivants et on retirerait
    // la mauvaise plage. L'opération part donc de la fin.
    const next = unwrap(deleteClips(threeInARow(), ['a', 'b'], ctx, true));
    expect(layout(next, 'v1')).toBe('c[0,100)');
  });

  it('donne le même résultat quel que soit l ordre des identifiants', () => {
    const avant = unwrap(deleteClips(threeInARow(), ['a', 'b'], ctx, true));
    const apres = unwrap(deleteClips(threeInARow(), ['b', 'a'], ctx, true));
    expect(layout(apres, 'v1')).toBe(layout(avant, 'v1'));
  });

  it('échoue en bloc si un clip est introuvable', () => {
    expect(isErr(deleteClips(threeInARow(), ['a', 'fantome'], ctx))).toBe(true);
  });

  it('ne fait rien sur une liste vide', () => {
    const seq = threeInARow();
    expect(unwrap(deleteClips(seq, [], ctx))).toBe(seq);
  });
});
