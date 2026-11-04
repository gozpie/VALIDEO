import { describe, expect, it } from 'vitest';
import { createTitle } from '@valideo/project-model';
import { isOk } from '@valideo/shared';
import type { SequenceDoc } from '@valideo/project-model';
import { deleteClip, moveClip, razor, trimClip } from './edit-ops';
import { makeContext, makeSequence } from './fixtures';
import { modifierClips, poserTitre, poserTransition } from './composition-ops';
import { raccordProche, transitionsEffectives } from './transitions';

const CTX = makeContext();

function montage(): SequenceDoc {
  return makeSequence([
    {
      id: 'v1',
      clips: [
        { id: 'a', start: 0, duration: 50 },
        { id: 'b', start: 50, duration: 50 },
        { id: 'c', start: 120, duration: 30 },
      ],
    },
    { id: 'v2', index: 1, clips: [] },
  ]);
}

function valeur<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

const fondu = (seq: SequenceDoc, de: string | null, vers: string | null, duree = 20): SequenceDoc =>
  valeur(
    poserTransition(seq, {
      trackId: 'v1',
      fromClipId: de,
      toClipId: vers,
      type: 'dissolve',
      duration: duree,
    }),
  );

const effectives = (seq: SequenceDoc, id = 'v1') => {
  const piste = seq.tracks.find((t) => t.id === id);
  return piste === undefined ? [] : transitionsEffectives(piste);
};

describe('transitions', () => {
  it('centre un fondu enchaîné sur le raccord', () => {
    const [t] = effectives(fondu(montage(), 'a', 'b'));
    expect([t?.debut, t?.fin]).toEqual([40, 60]);
  });

  it('un fondu d’entrée ou de sortie reste dans son clip', () => {
    const entree = fondu(montage(), null, 'c');
    expect([effectives(entree)[0]?.debut, effectives(entree)[0]?.fin]).toEqual([120, 140]);
    const sortie = fondu(montage(), 'c', null);
    expect([effectives(sortie)[0]?.debut, effectives(sortie)[0]?.fin]).toEqual([130, 150]);
  });

  it('ne dépasse jamais ce que les clips permettent', () => {
    const [t] = effectives(fondu(montage(), null, 'c', 500));
    expect(t?.fin).toBe(150);
    expect(t?.dureeDemandee).toBe(500);
  });

  it('refuse une transition entre deux clips qui ne se touchent pas', () => {
    expect(effectives(fondu(montage(), 'b', 'c'))).toEqual([]);
  });

  it('une nouvelle transition remplace celle du même raccord', () => {
    const une = fondu(fondu(montage(), 'a', 'b'), 'a', 'b', 10);
    expect(effectives(une)).toHaveLength(1);
    expect(effectives(une)[0]?.dureeDemandee).toBe(10);
  });

  it('disparaît avec son clip, et quand ses clips ne se touchent plus', () => {
    const seq = fondu(montage(), 'a', 'b');
    expect(effectives(valeur(deleteClip(seq, 'b', CTX, false)))).toEqual([]);
    const ecartes = valeur(trimClip(seq, { clipId: 'a', edge: 'out', delta: -5 }, CTX));
    expect(effectives(ecartes)).toEqual([]);
    expect(ecartes.tracks[0]?.transitions).toEqual([]);
  });

  it('survit à une coupe : la queue du clip garde sa transition de sortie', () => {
    const seq = fondu(montage(), 'a', 'b');
    const coupe = valeur(razor(seq, 25, ['v1'], CTX));
    const [t] = effectives(coupe);
    expect([t?.debut, t?.fin]).toEqual([40, 60]);
    expect(t?.de?.start).toBe(25);
    expect(t?.vers?.id).toBe('b');
  });

  it('un fondu suit son clip sur une autre piste', () => {
    const seq = fondu(montage(), null, 'c');
    const deplace = valeur(moveClip(seq, { clipId: 'c', toStart: 120, toTrackId: 'v2' }, CTX));
    expect(effectives(deplace, 'v1')).toEqual([]);
    expect(effectives(deplace, 'v2')[0]?.vers?.id).toBe('c');
  });

  it('recalcule la position stockée à chaque opération', () => {
    const seq = fondu(montage(), 'a', 'b');
    expect(seq.tracks[0]?.transitions[0]?.start).toBe(40);
  });

  it('trouve le raccord le plus proche, ou le bord d’un clip isolé', () => {
    const piste = montage().tracks[0];
    if (piste === undefined) throw new Error('piste');
    const milieu = raccordProche(piste, 45);
    expect([milieu?.image, milieu?.de?.id, milieu?.vers?.id]).toEqual([50, 'a', 'b']);
    const isole = raccordProche(piste, 115);
    expect([isole?.image, isole?.de, isole?.vers?.id]).toEqual([120, null, 'c']);
    const fin = raccordProche(piste, 400);
    expect([fin?.image, fin?.de?.id, fin?.vers]).toEqual([150, 'c', null]);
  });
});

describe('titres', () => {
  const titre = createTitle({ text: 'Chapitre\nun' });

  it('va sur la première piste libre au-dessus de V1, avec le nom de sa première ligne', () => {
    const seq = valeur(poserTitre(montage(), { titre, at: 10, duration: 30 }));
    const clip = seq.tracks.find((t) => t.id === 'v2')?.clips[0];
    expect([clip?.kind, clip?.start, clip?.name, clip?.title?.text]).toEqual([
      'title',
      10,
      'Chapitre',
      'Chapitre\nun',
    ]);
  });

  it('crée une piste quand aucune n’est libre', () => {
    const un = valeur(poserTitre(montage(), { titre, at: 10, duration: 30 }));
    const deux = valeur(poserTitre(un, { titre, at: 20, duration: 30 }));
    expect(deux.tracks.filter((t) => t.kind === 'video')).toHaveLength(3);
  });

  it('refuse une place déjà prise sur la piste demandée', () => {
    const r = poserTitre(montage(), { titre, at: 10, duration: 30, trackId: 'v1' });
    expect(isOk(r)).toBe(false);
  });
});

describe('réglages de clip', () => {
  it('modifie tous les clips demandés et respecte le verrou de piste', () => {
    const seq = valeur(
      modifierClips(montage(), ['a', 'b'], (c) => ({ ...c, blendMode: 'screen' as const })),
    );
    expect(seq.tracks[0]?.clips.map((c) => c.blendMode)).toEqual(['screen', 'screen', 'normal']);
    const verrouille = {
      ...montage(),
      tracks: montage().tracks.map((t) => ({ ...t, locked: true })),
    };
    expect(isOk(modifierClips(verrouille, ['a'], (c) => c))).toBe(false);
  });
});
