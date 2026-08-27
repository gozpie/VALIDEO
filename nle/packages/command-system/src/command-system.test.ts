import { describe, it, expect, vi } from 'vitest';
import { appError, err, isErr, ok, unwrap } from '@valideo/shared';
import type { Result, AppError } from '@valideo/shared';
import { command, transaction, noop } from './command.js';
import { History } from './history.js';

/** Etat de test : un compteur et une liste, immuables. */
interface S {
  readonly count: number;
  readonly items: readonly string[];
}

const start: S = { count: 0, items: [] };

const inc = (by: number, mergeKey: string | null = null) =>
  command<S>({
    label: `Incrémenter de ${by}`,
    mergeKey,
    apply: (s) => ok({ ...s, count: s.count + by }),
  });

const push = (item: string) =>
  command<S>({
    label: `Ajouter ${item}`,
    apply: (s) => ok({ ...s, items: [...s.items, item] }),
  });

const rejette = (message: string) =>
  command<S>({
    label: 'Refusée',
    apply: (): Result<S, AppError> => err(appError('EDIT_REJECTED', message)),
  });

describe('commandes', () => {
  it('produit un nouvel etat sans muter l ancien', () => {
    const before = start;
    const after = unwrap(inc(5).apply(before));
    expect(after.count).toBe(5);
    expect(before.count).toBe(0);
  });

  it('donne un identifiant unique a chaque commande', () => {
    expect(inc(1).id).not.toBe(inc(1).id);
  });

  it('noop laisse l etat identique', () => {
    expect(unwrap(noop<S>().apply(start))).toBe(start);
  });
});

describe('transactions (section 70)', () => {
  it('applique toutes les etapes dans l ordre', () => {
    const t = transaction('Montage composé', [inc(1), inc(2), push('a')]);
    const after = unwrap(t.apply(start));
    expect(after.count).toBe(3);
    expect(after.items).toEqual(['a']);
  });

  it('est ATOMIQUE : une etape qui echoue annule tout', () => {
    const t = transaction('Ripple delete', [inc(10), rejette('Piste verrouillée'), inc(100)]);
    const r = t.apply(start);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.message).toBe('Piste verrouillée');
    // Aucun etat partiel n a fuite.
    expect(start.count).toBe(0);
  });

  it('se compose avec d autres transactions', () => {
    const inner = transaction('Interne', [inc(1), inc(1)]);
    const outer = transaction('Externe', [inner, inner, push('x')]);
    const after = unwrap(outer.apply(start));
    expect(after.count).toBe(4);
    expect(after.items).toEqual(['x']);
  });

  it('propage l echec depuis une transaction imbriquee', () => {
    const inner = transaction('Interne', [inc(1), rejette('non')]);
    const outer = transaction('Externe', [inc(1), inner]);
    expect(isErr(outer.apply(start))).toBe(true);
  });
});

describe('historique — annuler et rétablir', () => {
  it('annule et retablit', () => {
    const h = new History(start);
    h.execute(inc(1));
    h.execute(inc(10));
    expect(h.current().count).toBe(11);

    unwrap(h.undo());
    expect(h.current().count).toBe(1);
    unwrap(h.undo());
    expect(h.current().count).toBe(0);
    expect(h.canUndo()).toBe(false);

    unwrap(h.redo());
    expect(h.current().count).toBe(1);
    unwrap(h.redo());
    expect(h.current().count).toBe(11);
    expect(h.canRedo()).toBe(false);
  });

  it('refuse d annuler ou de retablir dans le vide', () => {
    const h = new History(start);
    expect(isErr(h.undo())).toBe(true);
    expect(isErr(h.redo())).toBe(true);
  });

  it('une commande refusee ne touche ni l etat ni l historique', () => {
    const h = new History(start);
    h.execute(inc(5));
    const r = h.execute(rejette('Média hors ligne'));
    expect(isErr(r)).toBe(true);
    expect(h.current().count).toBe(5);
    expect(h.snapshot().labels).toEqual(['Incrémenter de 5']);
  });

  it('une commande sans effet ne cree pas d entree', () => {
    const h = new History(start);
    h.execute(noop<S>());
    expect(h.snapshot().labels).toEqual([]);
    expect(h.canUndo()).toBe(false);
  });

  it('une nouvelle action efface la branche de retablissement', () => {
    const h = new History(start);
    h.execute(inc(1));
    h.execute(inc(2));
    h.undo();
    expect(h.canRedo()).toBe(true);
    h.execute(inc(100));
    expect(h.canRedo()).toBe(false);
    expect(h.current().count).toBe(101);
    expect(h.snapshot().labels).toEqual(['Incrémenter de 1', 'Incrémenter de 100']);
  });

  it('expose les libelles pour le panneau Historique', () => {
    const h = new History(start);
    h.execute(push('a'));
    h.execute(push('b'));
    expect(h.snapshot().labels).toEqual(['Ajouter a', 'Ajouter b']);
    expect(h.snapshot().position).toBe(1);
    h.undo();
    expect(h.snapshot().position).toBe(0);
  });

  it('permet de sauter directement a une etape', () => {
    const h = new History(start);
    h.execute(inc(1));
    h.execute(inc(10));
    h.execute(inc(100));
    unwrap(h.goTo(0));
    expect(h.current().count).toBe(1);
    unwrap(h.goTo(2));
    expect(h.current().count).toBe(111);
    unwrap(h.goTo(-1));
    expect(h.current().count).toBe(0);
    expect(isErr(h.goTo(99))).toBe(true);
  });
});

describe('historique — fusion des gestes continus', () => {
  it('fusionne les commandes consecutives de meme cle', () => {
    let t = 1000;
    const h = new History(start, { now: () => t, mergeWindowMs: 500 });
    // Simulation d un glisser-deposer : 50 micro-deplacements.
    for (let i = 0; i < 50; i += 1) {
      t += 5;
      h.execute(inc(1, 'drag:clip-1'));
    }
    expect(h.current().count).toBe(50);
    // Une seule entree d historique pour tout le geste.
    expect(h.snapshot().labels).toHaveLength(1);
    // Annuler ramene au debut du geste, pas a l avant-derniere image.
    unwrap(h.undo());
    expect(h.current().count).toBe(0);
  });

  it('ne fusionne pas au-dela de la fenetre temporelle', () => {
    let t = 0;
    const h = new History(start, { now: () => t, mergeWindowMs: 500 });
    h.execute(inc(1, 'drag:clip-1'));
    t += 5000;
    h.execute(inc(1, 'drag:clip-1'));
    expect(h.snapshot().labels).toHaveLength(2);
  });

  it('ne fusionne pas deux cles differentes', () => {
    let t = 0;
    const h = new History(start, { now: () => t, mergeWindowMs: 500 });
    h.execute(inc(1, 'drag:clip-1'));
    t += 10;
    h.execute(inc(1, 'drag:clip-2'));
    expect(h.snapshot().labels).toHaveLength(2);
  });

  it('ne fusionne jamais les commandes sans cle', () => {
    let t = 0;
    const h = new History(start, { now: () => t });
    h.execute(inc(1));
    t += 1;
    h.execute(inc(1));
    expect(h.snapshot().labels).toHaveLength(2);
  });
});

describe('historique — profondeur et enregistrement', () => {
  it('oublie les entrees les plus anciennes au-dela de la profondeur', () => {
    const h = new History(start, { maxDepth: 3 });
    for (let i = 0; i < 10; i += 1) h.execute(inc(1));
    expect(h.snapshot().labels).toHaveLength(3);
    expect(h.current().count).toBe(10);
    // On ne peut remonter que de 3 crans.
    h.undo();
    h.undo();
    h.undo();
    expect(h.canUndo()).toBe(false);
    expect(h.current().count).toBe(7);
  });

  it('suit l etat modifie pour l autosave', () => {
    const h = new History(start);
    expect(h.isDirty()).toBe(false);
    h.execute(inc(1));
    expect(h.isDirty()).toBe(true);
    h.markSaved();
    expect(h.isDirty()).toBe(false);
    h.execute(inc(1));
    expect(h.isDirty()).toBe(true);
    // Revenir a l etat enregistre par annulation remet a propre.
    h.undo();
    expect(h.isDirty()).toBe(false);
  });

  it('vide l historique sans perdre l etat', () => {
    const h = new History(start);
    h.execute(inc(7));
    h.clear();
    expect(h.current().count).toBe(7);
    expect(h.canUndo()).toBe(false);
  });
});

describe('historique — notifications', () => {
  it('previent les abonnes et permet de se desabonner', () => {
    const h = new History(start);
    const listener = vi.fn();
    const unsubscribe = h.subscribe(listener);
    h.execute(inc(1));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[1].canUndo).toBe(true);
    h.undo();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    h.execute(inc(1));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('ne notifie pas sur une commande refusee', () => {
    const h = new History(start);
    const listener = vi.fn();
    h.subscribe(listener);
    h.execute(rejette('non'));
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('historique — partage de structure (section 57)', () => {
  it('ne copie que le chemin modifie', () => {
    interface Big {
      readonly heavy: readonly number[];
      readonly light: number;
    }
    const heavy = Array.from({ length: 100_000 }, (_, i) => i);
    const h = new History<Big>({ heavy, light: 0 });
    h.execute(
      command<Big>({ label: 'Toucher light', apply: (s) => ok({ ...s, light: s.light + 1 }) }),
    );
    // Le tableau lourd est la MEME reference : l entree d historique ne l a pas duplique.
    expect(h.current().heavy).toBe(heavy);
    unwrap(h.undo());
    expect(h.current().heavy).toBe(heavy);
  });
});
