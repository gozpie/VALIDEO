/**
 * Integration : montage reel a travers l historique.
 *
 * Ce que ces tests verifient n est pas une operation isolee mais la chaine
 * complete que subit une action utilisateur : commande -> validation ->
 * application atomique -> historique -> annulation.
 */
import { describe, it, expect } from 'vitest';
import { History, transaction } from '@valideo/command-system';
import { isErr, unwrap } from '@valideo/shared';
import type { SequenceDoc } from '@valideo/project-model';
import { layout, makeClip, makeContext, makeSequence } from './fixtures.js';
import { checkSequence, findClip, gaps, sequenceDuration } from './query.js';
import {
  deleteClipCommand,
  extractCommand,
  insertCommand,
  moveClipCommand,
  overwriteCommand,
  razorCommand,
  slipCommand,
  trimCommand,
} from './commands.js';

const ctx = makeContext();

function montage(): SequenceDoc {
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
    {
      id: 'a1',
      kind: 'audio',
      clips: [{ id: 'son', start: 0, duration: 300, sourceIn: 0 }],
      syncLock: false,
    },
  ]);
}

describe('montage à travers l historique', () => {
  it('annule et rétablit un ripple delete composé', () => {
    const h = new History(montage());
    const avant = layout(h.current(), 'v1');

    unwrap(h.execute(deleteClipCommand('b', ctx, true)));
    expect(layout(h.current(), 'v1')).toBe('a[0,100) c[100,200)');

    unwrap(h.undo());
    expect(layout(h.current(), 'v1')).toBe(avant);
    // Le point d entrée source de c est restauré, pas seulement sa position.
    expect(findClip(h.current(), 'c')?.clip.sourceIn).toBe(3000);

    unwrap(h.redo());
    expect(layout(h.current(), 'v1')).toBe('a[0,100) c[100,200)');
  });

  it('annule une coupe suivie d une suppression, étape par étape', () => {
    const h = new History(montage());
    unwrap(h.execute(razorCommand(50, ['v1'], ctx)));
    expect(h.current().tracks[0]?.clips).toHaveLength(4);

    const nouveau = h.current().tracks[0]?.clips[1];
    unwrap(h.execute(deleteClipCommand(nouveau!.id, ctx, false)));
    expect(gaps(h.current().tracks[0]!)).toEqual([{ start: 50, end: 100 }]);

    unwrap(h.undo());
    expect(gaps(h.current().tracks[0]!)).toEqual([]);
    unwrap(h.undo());
    expect(h.current().tracks[0]?.clips).toHaveLength(3);
    expect(h.canUndo()).toBe(false);
  });

  it('une opération refusée laisse le montage et l historique intacts', () => {
    const seq = makeSequence([
      { id: 'v1', locked: true, clips: [{ id: 'a', start: 0, duration: 100 }] },
    ]);
    const h = new History(seq);
    const r = h.execute(deleteClipCommand('a', ctx, true));
    expect(isErr(r)).toBe(true);
    expect(h.current()).toBe(seq);
    expect(h.snapshot().labels).toEqual([]);
  });

  it('un glisser-déposer ne produit qu une seule annulation', () => {
    let now = 0;
    const h = new History(montage(), { now: () => now, mergeWindowMs: 500 });
    // 60 positions intermédiaires, comme un vrai geste à la souris.
    for (let i = 1; i <= 60; i += 1) {
      now += 8;
      unwrap(h.execute(moveClipCommand({ clipId: 'a', toStart: 300 + i }, ctx)));
    }
    expect(findClip(h.current(), 'a')?.clip.start).toBe(360);
    expect(h.snapshot().labels).toEqual(['Déplacer le clip']);

    unwrap(h.undo());
    // On revient au début du geste, pas à l avant-dernière image.
    expect(findClip(h.current(), 'a')?.clip.start).toBe(0);
  });

  it('un trim continu fusionne, mais pas deux gestes distincts', () => {
    let now = 0;
    const h = new History(montage(), { now: () => now, mergeWindowMs: 500 });
    for (let i = 0; i < 10; i += 1) {
      now += 10;
      unwrap(h.execute(trimCommand({ clipId: 'b', edge: 'out', delta: -1 }, ctx)));
    }
    expect(h.snapshot().labels).toHaveLength(1);
    now += 2000; // l utilisateur relâche, puis recommence plus tard
    unwrap(h.execute(trimCommand({ clipId: 'b', edge: 'out', delta: -1 }, ctx)));
    expect(h.snapshot().labels).toHaveLength(2);
  });

  it('compose un montage complet en une transaction atomique', () => {
    const h = new History(montage());
    const clip = makeClip('v1', { id: 'nouveau', start: 0, duration: 50, sourceIn: 7000 });
    const composite = transaction<SequenceDoc>('Insérer et raccourcir', [
      insertCommand({ clip, trackId: 'v1', at: 100 }, ctx),
      trimCommand({ clipId: 'a', edge: 'out', delta: -20, mode: 'ripple' }, ctx),
    ]);
    unwrap(h.execute(composite));
    expect(layout(h.current(), 'v1')).toBe('a[0,80) nouveau[80,130) b[130,230) c[230,330)');
    // Une seule entrée d historique pour les deux opérations.
    expect(h.snapshot().labels).toEqual(['Insérer et raccourcir']);
    unwrap(h.undo());
    expect(layout(h.current(), 'v1')).toBe('a[0,100) b[100,200) c[200,300)');
  });

  it('une transaction dont une étape échoue ne laisse aucune trace', () => {
    const h = new History(montage());
    const clip = makeClip('v1', { id: 'nouveau', start: 0, duration: 50 });
    const composite = transaction<SequenceDoc>('Montage impossible', [
      insertCommand({ clip, trackId: 'v1', at: 100 }, ctx),
      deleteClipCommand('clip-inexistant', ctx, true),
    ]);
    expect(isErr(h.execute(composite))).toBe(true);
    expect(layout(h.current(), 'v1')).toBe('a[0,100) b[100,200) c[200,300)');
    expect(h.snapshot().labels).toEqual([]);
  });

  it('suit l état modifié pour l autosave', () => {
    const h = new History(montage());
    expect(h.isDirty()).toBe(false);
    unwrap(h.execute(slipCommand('b', 25, ctx)));
    expect(h.isDirty()).toBe(true);
    h.markSaved();
    expect(h.isDirty()).toBe(false);
  });

  it('garde les invariants après un enchaînement long', () => {
    const h = new History(montage());
    unwrap(h.execute(razorCommand(50, ['v1'], ctx)));
    unwrap(h.execute(extractCommand({ start: 20, end: 60, trackIds: ['v1'] }, ctx)));
    unwrap(
      h.execute(
        overwriteCommand(
          { clip: makeClip('v1', { id: 'x', start: 0, duration: 40 }), trackId: 'v1', at: 10 },
          ctx,
        ),
      ),
    );
    unwrap(h.execute(trimCommand({ clipId: 'x', edge: 'out', delta: 15, mode: 'ripple' }, ctx)));
    expect(checkSequence(h.current())).toEqual([]);

    // Toute la pile d annulation ramène exactement au point de départ.
    while (h.canUndo()) unwrap(h.undo());
    expect(layout(h.current(), 'v1')).toBe('a[0,100) b[100,200) c[200,300)');
    expect(sequenceDuration(h.current())).toBe(300);
  });
});
