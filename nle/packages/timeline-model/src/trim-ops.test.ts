import { describe, it, expect } from 'vitest';
import { isErr, unwrap } from '@valideo/shared';
import { TIMEBASES, rational } from '@valideo/time-core';
import { abundantSource, boundedSource, layout, makeContext, makeSequence } from './fixtures.js';
import { checkSequence, findClip, gaps, sequenceDuration } from './query.js';
import {
  changeSpeed,
  linkClips,
  rateStretch,
  setWorkArea,
  workAreaRange,
  rippleTrimToPlayhead,
  rollEdit,
  slideClip,
  slipClip,
  trimClip,
  unlinkClips,
} from './edit-ops.js';
import { handleAfter, handleBefore, sourceFramesUsed, sourceOut } from './source.js';

const ctx = makeContext();

function threeInARow(targeted = false) {
  return makeSequence([
    {
      id: 'v1',
      targeted,
      clips: [
        { id: 'a', start: 0, duration: 100, sourceIn: 1000 },
        { id: 'b', start: 100, duration: 100, sourceIn: 2000 },
        { id: 'c', start: 200, duration: 100, sourceIn: 3000 },
      ],
    },
  ]);
}

// ================================================================== TRIM

describe('Trim simple', () => {
  it('raccourcit par la sortie et laisse un trou', () => {
    const next = unwrap(trimClip(threeInARow(), { clipId: 'b', edge: 'out', delta: -20 }, ctx));
    expect(layout(next, 'v1')).toBe('a[0,100) b[100,180) c[200,300)');
    expect(gaps(next.tracks[0]!)).toEqual([{ start: 180, end: 200 }]);
  });

  it('rallonge par la sortie et recouvre le voisin', () => {
    const next = unwrap(trimClip(threeInARow(), { clipId: 'b', edge: 'out', delta: 20 }, ctx));
    expect(layout(next, 'v1')).toBe('a[0,100) b[100,220) c[220,300)');
    expect(findClip(next, 'c')?.clip.sourceIn).toBe(3020);
    expect(checkSequence(next)).toEqual([]);
  });

  it('raccourcit par l entree, laisse un trou et avance la source', () => {
    const next = unwrap(trimClip(threeInARow(), { clipId: 'b', edge: 'in', delta: 20 }, ctx));
    expect(layout(next, 'v1')).toBe('a[0,100) b[120,200) c[200,300)');
    expect(findClip(next, 'b')?.clip.sourceIn).toBe(2020);
  });

  it('rallonge par l entree en reculant dans la source', () => {
    const next = unwrap(trimClip(threeInARow(), { clipId: 'b', edge: 'in', delta: -20 }, ctx));
    expect(layout(next, 'v1')).toBe('a[0,80) b[80,200) c[200,300)');
    expect(findClip(next, 'b')?.clip.sourceIn).toBe(1980);
  });

  it('ne laisse jamais un clip descendre sous une image', () => {
    const next = unwrap(trimClip(threeInARow(), { clipId: 'b', edge: 'out', delta: -500 }, ctx));
    expect(findClip(next, 'b')?.clip.duration).toBe(1);
  });

  it('s arrete a la derniere image disponible dans la source', () => {
    // La source ne contient que les images 2000 a 2149 : le clip b (sourceIn
    // 2000, duree 100) ne peut s allonger que de 50 images a droite.
    const bounded = makeContext(TIMEBASES.TB25, boundedSource(2000, 150));
    const next = unwrap(trimClip(threeInARow(), { clipId: 'b', edge: 'out', delta: 999 }, bounded));
    expect(findClip(next, 'b')?.clip.duration).toBe(150);
  });

  it('ne recule pas avant la premiere image de la source', () => {
    const bounded = makeContext(TIMEBASES.TB25, boundedSource(1980, 500));
    const next = unwrap(trimClip(threeInARow(), { clipId: 'b', edge: 'in', delta: -999 }, bounded));
    expect(findClip(next, 'b')?.clip.sourceIn).toBe(1980);
  });

  it('un trim nul ne change rien', () => {
    const seq = threeInARow();
    expect(unwrap(trimClip(seq, { clipId: 'b', edge: 'out', delta: 0 }, ctx))).toBe(seq);
  });
});

describe('Ripple trim', () => {
  it('raccourcit par la sortie et remonte la suite', () => {
    const next = unwrap(
      trimClip(threeInARow(), { clipId: 'b', edge: 'out', delta: -20, mode: 'ripple' }, ctx),
    );
    expect(layout(next, 'v1')).toBe('a[0,100) b[100,180) c[180,280)');
    expect(gaps(next.tracks[0]!)).toEqual([]);
    expect(sequenceDuration(next)).toBe(280);
  });

  it('rallonge par la sortie et repousse la suite sans rien ecraser', () => {
    const next = unwrap(
      trimClip(threeInARow(), { clipId: 'b', edge: 'out', delta: 20, mode: 'ripple' }, ctx),
    );
    expect(layout(next, 'v1')).toBe('a[0,100) b[100,220) c[220,320)');
    expect(findClip(next, 'c')?.clip.sourceIn).toBe(3000);
  });

  it('sur le point d entree, le clip garde sa place et la suite remonte', () => {
    const next = unwrap(
      trimClip(threeInARow(), { clipId: 'b', edge: 'in', delta: 20, mode: 'ripple' }, ctx),
    );
    expect(layout(next, 'v1')).toBe('a[0,100) b[100,180) c[180,280)');
    expect(findClip(next, 'b')?.clip.sourceIn).toBe(2020);
    expect(gaps(next.tracks[0]!)).toEqual([]);
  });

  it('entraine les pistes synchronisees', () => {
    const seq = makeSequence([
      { id: 'v1', clips: [{ id: 'a', start: 0, duration: 100 }] },
      { id: 'a1', kind: 'audio', clips: [{ id: 'son', start: 100, duration: 100 }] },
    ]);
    const next = unwrap(
      trimClip(seq, { clipId: 'a', edge: 'out', delta: -30, mode: 'ripple' }, ctx),
    );
    expect(layout(next, 'v1')).toBe('a[0,70)');
    expect(layout(next, 'a1')).toBe('son[70,170)');
  });
});

describe('Q et W — ripple trim jusqu à la tête de lecture (§93)', () => {
  it('W supprime de la tête au point de montage suivant', () => {
    const next = unwrap(rippleTrimToPlayhead(threeInARow(true), 150, 'next', ctx));
    expect(layout(next, 'v1')).toBe('a[0,100) b[100,150) c[150,250)');
  });

  it('Q supprime du point de montage précédent à la tête', () => {
    const next = unwrap(rippleTrimToPlayhead(threeInARow(true), 150, 'previous', ctx));
    expect(layout(next, 'v1')).toBe('a[0,100) b[100,150) c[150,250)');
    expect(findClip(next, 'b')?.clip.sourceIn).toBe(2050);
  });

  it('refuse s il n y a pas de point de montage de ce côté', () => {
    expect(isErr(rippleTrimToPlayhead(threeInARow(true), 0, 'previous', ctx))).toBe(true);
    expect(isErr(rippleTrimToPlayhead(threeInARow(true), 300, 'next', ctx))).toBe(true);
  });

  it('refuse sans piste ciblée', () => {
    expect(isErr(rippleTrimToPlayhead(threeInARow(false), 150, 'next', ctx))).toBe(true);
  });
});

// ================================================================== ROLL

describe('Rolling trim', () => {
  it('déplace la coupe sans changer la durée totale', () => {
    const seq = threeInARow();
    const next = unwrap(rollEdit(seq, 'v1', 100, 20, ctx));
    expect(layout(next, 'v1')).toBe('a[0,120) b[120,200) c[200,300)');
    expect(sequenceDuration(next)).toBe(sequenceDuration(seq));
    expect(gaps(next.tracks[0]!)).toEqual([]);
  });

  it('fait glisser la source du clip entrant', () => {
    const next = unwrap(rollEdit(threeInARow(), 'v1', 100, 20, ctx));
    expect(findClip(next, 'b')?.clip.sourceIn).toBe(2020);
    // Le clip sortant garde son entrée : il s allonge par la fin.
    expect(findClip(next, 'a')?.clip.sourceIn).toBe(1000);
  });

  it('roule dans l autre sens', () => {
    const next = unwrap(rollEdit(threeInARow(), 'v1', 100, -30, ctx));
    expect(layout(next, 'v1')).toBe('a[0,70) b[70,200) c[200,300)');
    expect(findClip(next, 'b')?.clip.sourceIn).toBe(1970);
  });

  it('est borné par les deux clips à la fois', () => {
    const next = unwrap(rollEdit(threeInARow(), 'v1', 100, 999, ctx));
    // b ne peut pas descendre sous une image.
    expect(findClip(next, 'b')?.clip.duration).toBe(1);
    expect(findClip(next, 'a')?.clip.duration).toBe(199);
  });

  it('est borné par les poignées disponibles', () => {
    // a dispose de 20 images après sa sortie (1000 + 100 + 20 = 1120).
    const bounded = makeContext(TIMEBASES.TB25, boundedSource(1000, 120));
    const next = unwrap(rollEdit(threeInARow(), 'v1', 100, 999, bounded));
    expect(findClip(next, 'a')?.clip.duration).toBe(120);
  });

  it('refuse s il n y a pas de coupe à cette position', () => {
    expect(isErr(rollEdit(threeInARow(), 'v1', 150, 10, ctx))).toBe(true);
  });
});

// ================================================================== SLIP

describe('Slip', () => {
  it('fait défiler la source sans bouger le clip', () => {
    const seq = threeInARow();
    const next = unwrap(slipClip(seq, 'b', 30, ctx));
    expect(layout(next, 'v1')).toBe(layout(seq, 'v1'));
    expect(findClip(next, 'b')?.clip.sourceIn).toBe(2030);
    expect(findClip(next, 'b')?.clip.duration).toBe(100);
  });

  it('glisse aussi vers l arrière', () => {
    const next = unwrap(slipClip(threeInARow(), 'b', -500, ctx));
    expect(findClip(next, 'b')?.clip.sourceIn).toBe(1500);
  });

  it('est borné par les poignées disponibles des deux côtés', () => {
    // Source de 2000 à 2149 : b (2000..2100) peut glisser de +50 au maximum,
    // et de 0 vers l arrière.
    const bounded = makeContext(TIMEBASES.TB25, boundedSource(2000, 150));
    expect(findClip(unwrap(slipClip(threeInARow(), 'b', 999, bounded)), 'b')?.clip.sourceIn).toBe(
      2050,
    );
    expect(findClip(unwrap(slipClip(threeInARow(), 'b', -999, bounded)), 'b')?.clip.sourceIn).toBe(
      2000,
    );
  });
});

// ================================================================= SLIDE

describe('Slide', () => {
  it('déplace le clip en ajustant ses voisins', () => {
    const seq = threeInARow();
    const next = unwrap(slideClip(seq, 'b', 30, ctx));
    expect(layout(next, 'v1')).toBe('a[0,130) b[130,230) c[230,300)');
    expect(sequenceDuration(next)).toBe(sequenceDuration(seq));
    expect(gaps(next.tracks[0]!)).toEqual([]);
  });

  it('ne change pas le contenu du clip déplacé', () => {
    const next = unwrap(slideClip(threeInARow(), 'b', 30, ctx));
    expect(findClip(next, 'b')?.clip.sourceIn).toBe(2000);
    expect(findClip(next, 'b')?.clip.duration).toBe(100);
  });

  it('avance la source du voisin de droite', () => {
    const next = unwrap(slideClip(threeInARow(), 'b', 30, ctx));
    expect(findClip(next, 'c')?.clip.sourceIn).toBe(3030);
    expect(findClip(next, 'c')?.clip.duration).toBe(70);
  });

  it('glisse vers la gauche', () => {
    const next = unwrap(slideClip(threeInARow(), 'b', -30, ctx));
    expect(layout(next, 'v1')).toBe('a[0,70) b[70,170) c[170,300)');
    expect(findClip(next, 'c')?.clip.sourceIn).toBe(2970);
  });

  it('est borné par la durée minimale des voisins', () => {
    const next = unwrap(slideClip(threeInARow(), 'b', 999, ctx));
    expect(findClip(next, 'c')?.clip.duration).toBe(1);
    expect(findClip(next, 'b')?.clip.start).toBe(199);
  });
});

// ============================================================== VITESSE

describe('Rate stretch (§38)', () => {
  it('étire la durée en conservant la portion de source utilisée', () => {
    const seq = threeInARow();
    const before = sourceFramesUsed(findClip(seq, 'c')!.clip, ctx);
    // c est le dernier clip : il a la place de s étendre.
    const next = unwrap(rateStretch(seq, 'c', 200, ctx));
    const after = findClip(next, 'c')!.clip;
    expect(after.duration).toBe(200);
    expect(after.speed).toEqual({ n: 1, d: 2 }); // 50 %
    expect(sourceFramesUsed(after, ctx)).toBe(before);
  });

  it('comprime la durée', () => {
    const next = unwrap(rateStretch(threeInARow(), 'b', 50, ctx));
    const after = findClip(next, 'b')!.clip;
    expect(after.speed).toEqual({ n: 2, d: 1 }); // 200 %
    expect(sourceFramesUsed(after, ctx)).toBe(100);
  });

  it('refuse une durée nulle', () => {
    expect(isErr(rateStretch(threeInARow(), 'b', 0, ctx))).toBe(true);
  });

  it('refuse plutôt que d écraser le voisin', () => {
    // b s étendrait de [100,200) à [100,300) et recouvrirait c.
    // Choix assumé : une commande qui demande une durée précise est refusée
    // explicitement, elle n est pas rabotée en silence. C est l outil
    // interactif qui bornera le geste avant d appeler la commande.
    const r = rateStretch(threeInARow(), 'b', 300, ctx);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.detail).toContain('overlap');
  });
});

// ============================================================== LIAISON

describe('Liaison audio/vidéo (§80)', () => {
  it('lie puis délie des clips', () => {
    const seq = makeSequence([
      { id: 'v1', clips: [{ id: 'img', start: 0, duration: 100 }] },
      { id: 'a1', kind: 'audio', clips: [{ id: 'son', start: 0, duration: 100 }] },
    ]);
    const linked = unwrap(linkClips(seq, ['img', 'son']));
    const g1 = findClip(linked, 'img')?.clip.linkGroup;
    expect(g1).toBeTruthy();
    expect(findClip(linked, 'son')?.clip.linkGroup).toBe(g1);

    const unlinked = unwrap(unlinkClips(linked, ['img', 'son']));
    expect(findClip(unlinked, 'img')?.clip.linkGroup).toBeNull();
  });

  it('refuse une liaison à un seul clip', () => {
    const seq = makeSequence([{ id: 'v1', clips: [{ id: 'a', start: 0, duration: 10 }] }]);
    expect(isErr(linkClips(seq, ['a']))).toBe(true);
  });

  it('signale un clip inexistant', () => {
    const seq = makeSequence([{ id: 'v1', clips: [{ id: 'a', start: 0, duration: 10 }] }]);
    expect(isErr(linkClips(seq, ['a', 'fantome']))).toBe(true);
  });
});

// ================================================ CADENCES DIFFÉRENTES

describe('Source et séquence de cadences différentes', () => {
  it('une image de timeline 25p consomme deux images d une source 50p', () => {
    const c = makeContext(TIMEBASES.TB25, abundantSource(rational(50)));
    const seq = makeSequence([
      { id: 'v1', clips: [{ id: 'a', start: 0, duration: 100, sourceIn: 0 }] },
    ]);
    // Trimer 10 images de timeline avance de 20 images dans la source.
    const next = unwrap(trimClip(seq, { clipId: 'a', edge: 'in', delta: 10 }, c));
    expect(findClip(next, 'a')?.clip.sourceIn).toBe(20);
    expect(sourceFramesUsed(findClip(next, 'a')!.clip, c)).toBe(180);
  });

  it('une source 23.976 sur une timeline 23.976 reste au un pour un', () => {
    const c = makeContext(TIMEBASES.TB23_976, abundantSource(rational(24000, 1001)));
    const seq = makeSequence(
      [{ id: 'v1', clips: [{ id: 'a', start: 0, duration: 100, sourceIn: 500 }] }],
      TIMEBASES.TB23_976,
    );
    const next = unwrap(trimClip(seq, { clipId: 'a', edge: 'in', delta: 37 }, c));
    expect(findClip(next, 'a')?.clip.sourceIn).toBe(537);
  });

  it('une source 29.97 sur une timeline 23.976 se convertit exactement', () => {
    const c = makeContext(TIMEBASES.TB23_976, abundantSource(rational(30000, 1001)));
    const seq = makeSequence(
      [{ id: 'v1', clips: [{ id: 'a', start: 0, duration: 24, sourceIn: 0 }] }],
      TIMEBASES.TB23_976,
    );
    // 24 images à 23.976 durent 1.001 s, soit exactement 30 images à 29.97.
    expect(sourceFramesUsed(findClip(seq, 'a')!.clip, c)).toBe(30);
  });

  it('la vitesse se combine à l écart de cadence', () => {
    const c = makeContext(TIMEBASES.TB25, abundantSource(rational(50)));
    const seq = makeSequence([
      {
        id: 'v1',
        clips: [{ id: 'a', start: 0, duration: 100, sourceIn: 0, speed: { n: 1, d: 2 } }],
      },
    ]);
    // 100 images de timeline x 50 % x (50/25) = 100 images source.
    expect(sourceFramesUsed(findClip(seq, 'a')!.clip, c)).toBe(100);
  });

  it('calcule le point de sortie source, y compris en lecture inversée', () => {
    const seq = makeSequence([
      { id: 'v1', clips: [{ id: 'avant', start: 0, duration: 100, sourceIn: 500 }] },
      {
        id: 'v2',
        index: 1,
        clips: [{ id: 'arriere', start: 0, duration: 100, sourceIn: 500, reverse: true }],
      },
    ]);
    expect(sourceOut(findClip(seq, 'avant')!.clip, ctx)).toBe(600);
    expect(sourceOut(findClip(seq, 'arriere')!.clip, ctx)).toBe(400);
  });
});

describe('Poignées disponibles', () => {
  it('mesure la marge avant et après', () => {
    const bounded = makeContext(TIMEBASES.TB25, boundedSource(1900, 400)); // 1900..2299
    const clip = findClip(threeInARow(), 'b')!.clip; // 2000..2100
    expect(handleBefore(clip, bounded)).toBe(100); // 2000 - 1900
    expect(handleAfter(clip, bounded)).toBe(200); // 2300 - 2100
  });

  it('ne contraint rien quand la source est inconnue', () => {
    const unknown = makeContext(TIMEBASES.TB25, () => null);
    const clip = findClip(threeInARow(), 'b')!.clip;
    expect(handleBefore(clip, unknown)).toBeNull();
    expect(handleAfter(clip, unknown)).toBeNull();
  });
});

describe('zone de travail (§78)', () => {
  const base = () => ({ ...threeInARow(), workAreaIn: null, workAreaOut: null });

  it('pose une entrée puis une sortie', () => {
    const a = unwrap(setWorkArea(base(), { in: 10, out: null }));
    const b = unwrap(setWorkArea(a, { in: 10, out: 40 }));
    expect(workAreaRange(b)).toEqual({ start: 10, end: 40 });
  });

  it('efface la sortie quand la nouvelle entrée la dépasse', () => {
    // Reprendre son repérage plus loin est un geste courant, pas une erreur.
    const a = unwrap(setWorkArea(base(), { in: 10, out: 40 }));
    const b = unwrap(setWorkArea(a, { in: 60, out: 40 }));
    expect(b.workAreaIn).toBe(60);
    expect(b.workAreaOut).toBeNull();
  });

  it('efface l’entrée quand la nouvelle sortie passe avant', () => {
    const a = unwrap(setWorkArea(base(), { in: 30, out: 80 }));
    const b = unwrap(setWorkArea(a, { in: 30, out: 20 }));
    expect(b.workAreaOut).toBe(20);
    expect(b.workAreaIn).toBeNull();
  });

  it('ne donne aucune plage avec une seule borne', () => {
    // Lift sur une entrée seule retirerait tout jusqu’à la fin : on refuse.
    const a = unwrap(setWorkArea(base(), { in: 10, out: null }));
    expect(workAreaRange(a)).toBeNull();
  });

  it('ramène une position négative à zéro', () => {
    const a = unwrap(setWorkArea(base(), { in: -5, out: 20 }));
    expect(a.workAreaIn).toBe(0);
  });
});

describe('vitesse et durée (§38)', () => {
  it('ralentir à 50 % double la durée sans piocher plus de source', () => {
    const seq = threeInARow();
    const next = unwrap(
      changeSpeed(seq, { clipId: 'b', speed: { n: 1, d: 2 }, ripple: true }, ctx),
    );
    const b = findClip(next, 'b')!.clip;
    expect(b.duration).toBe(200);
    expect(b.speed).toEqual({ n: 1, d: 2 });
    // La portion de source consommée est inchangée : 100 images.
    expect(sourceFramesUsed(b, ctx)).toBe(100);
    expect(sourceOut(b, ctx)).toBe(2100);
  });

  it('accélérer à 200 % raccourcit et laisse un trou sans ripple', () => {
    const next = unwrap(changeSpeed(threeInARow(), { clipId: 'b', speed: { n: 2, d: 1 } }, ctx));
    expect(layout(next, 'v1')).toBe('a[0,100) b[100,150) c[200,300)');
  });

  it('avec ripple, les clips suivants suivent le changement de durée', () => {
    const next = unwrap(
      changeSpeed(threeInARow(), { clipId: 'b', speed: { n: 2, d: 1 }, ripple: true }, ctx),
    );
    expect(layout(next, 'v1')).toBe('a[0,100) b[100,150) c[150,250)');
  });

  it('inverser la lecture rejoue exactement le même matériau', () => {
    const seq = threeInARow();
    const avant = findClip(seq, 'b')!.clip;
    const next = unwrap(changeSpeed(seq, { clipId: 'b', speed: { n: 1, d: 1 }, reverse: true }, ctx));
    const b = findClip(next, 'b')!.clip;
    expect(b.reverse).toBe(true);
    // Le clip couvrait [2000,2100) ; à l'envers il doit couvrir la même plage.
    expect(sourceOut(avant, ctx)).toBe(2100);
    expect(b.sourceIn).toBe(2100);
    expect(sourceOut(b, ctx)).toBe(2000);
  });

  it('refuse une vitesse nulle et propose l’arrêt sur image', () => {
    const r = changeSpeed(threeInARow(), { clipId: 'b', speed: { n: 0, d: 1 } }, ctx);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.action).toContain('arrêt sur image');
  });

  it('refuse un ralenti qui écraserait le voisin plutôt que de le recouvrir', () => {
    // Sans ripple, ralentir b à 25 % lui donnerait 400 images : il mordrait
    // sur c. On refuse au lieu d'écraser un plan que personne n'a désigné.
    const r = changeSpeed(threeInARow(), { clipId: 'b', speed: { n: 1, d: 4 } }, ctx);
    expect(isErr(r)).toBe(true);
  });

  it('conserve l’échantillonnage d’images demandé', () => {
    const next = unwrap(
      changeSpeed(
        threeInARow(),
        { clipId: 'b', speed: { n: 1, d: 2 }, frameSampling: 'blend', ripple: true },
        ctx,
      ),
    );
    expect(findClip(next, 'b')?.clip.frameSampling).toBe('blend');
  });
});
