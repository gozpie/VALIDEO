/**
 * Historique undo/redo (section 43).
 *
 * L historique conserve, pour chaque entree, l etat AVANT et l etat APRES.
 * Comme les etats sont immuables et partagent leur structure, une entree ne
 * coute que le chemin reellement modifie -- pas une copie du projet. Un projet
 * de 10 000 clips supporte donc un historique profond sans exploser la memoire
 * (section 57).
 *
 * Deux mecanismes evitent de polluer l historique :
 *   - la FUSION : deux commandes consecutives de meme `mergeKey` rapprochees
 *     dans le temps ne forment qu une entree (un glisser-deposer = une seule
 *     annulation) ;
 *   - la profondeur maximale configurable, qui oublie les entrees les plus
 *     anciennes.
 */
import type { AppError, Result } from '@valideo/shared';
import { err, ok } from '@valideo/shared';
import type { Command } from './command.js';

export interface HistoryEntry<S> {
  readonly label: string;
  readonly before: S;
  readonly after: S;
  readonly mergeKey: string | null;
  readonly at: number;
}

export interface HistoryOptions {
  /** Nombre maximal d entrees conservees. Par defaut 200. */
  readonly maxDepth?: number;
  /** Fenetre de fusion en millisecondes. Par defaut 800 ms. */
  readonly mergeWindowMs?: number;
  /** Horloge injectable, pour des tests deterministes. */
  readonly now?: () => number;
}

export interface HistoryState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Libelles du plus ancien au plus recent, pour le panneau Historique. */
  readonly labels: readonly string[];
  /** Index de l entree courante dans `labels`, -1 si l on est a l origine. */
  readonly position: number;
  /** Vrai si l etat differe du dernier point d enregistrement (section 44). */
  readonly dirty: boolean;
}

export type HistoryListener<S> = (state: S, history: HistoryState) => void;

export class History<S> {
  private state: S;
  private readonly entries: HistoryEntry<S>[] = [];
  /** Nombre d entrees appliquees. `entries.length - cursor` = entrees annulees. */
  private cursor = 0;
  private savedState: S;
  private readonly maxDepth: number;
  private readonly mergeWindowMs: number;
  private readonly now: () => number;
  private readonly listeners = new Set<HistoryListener<S>>();

  constructor(initial: S, options: HistoryOptions = {}) {
    this.state = initial;
    this.savedState = initial;
    this.maxDepth = options.maxDepth ?? 200;
    this.mergeWindowMs = options.mergeWindowMs ?? 800;
    this.now = options.now ?? (() => Date.now());
  }

  current(): S {
    return this.state;
  }

  /**
   * Applique une commande. En cas de refus metier, l historique et l etat sont
   * laisses STRICTEMENT intacts : un refus n est pas une entree d historique.
   */
  execute(cmd: Command<S>): Result<S, AppError> {
    const result = cmd.apply(this.state);
    if (!result.ok) return result;

    const before = this.state;
    const after = result.value;

    // Une commande sans effet ne pollue pas l historique.
    if (Object.is(before, after)) return ok(after);

    // Toute nouvelle action efface la branche de retablissement.
    if (this.cursor < this.entries.length) this.entries.length = this.cursor;

    const at = this.now();
    const last = this.entries[this.entries.length - 1];
    const mergeable =
      last !== undefined &&
      cmd.mergeKey !== null &&
      last.mergeKey === cmd.mergeKey &&
      at - last.at <= this.mergeWindowMs;

    if (mergeable && last !== undefined) {
      // On garde le `before` d origine : annuler revient au debut du geste.
      this.entries[this.entries.length - 1] = {
        label: cmd.label,
        before: last.before,
        after,
        mergeKey: cmd.mergeKey,
        at,
      };
    } else {
      this.entries.push({ label: cmd.label, before, after, mergeKey: cmd.mergeKey, at });
      this.cursor += 1;
      if (this.entries.length > this.maxDepth) {
        this.entries.shift();
        this.cursor -= 1;
      }
    }

    this.state = after;
    this.emit();
    return ok(after);
  }

  canUndo(): boolean {
    return this.cursor > 0;
  }

  canRedo(): boolean {
    return this.cursor < this.entries.length;
  }

  undo(): Result<S, AppError> {
    if (!this.canUndo()) {
      return err({ code: 'EDIT_REJECTED', message: 'Rien à annuler.' });
    }
    this.cursor -= 1;
    const entry = this.entries[this.cursor];
    if (entry === undefined) return err({ code: 'EDIT_REJECTED', message: 'Rien à annuler.' });
    this.state = entry.before;
    this.emit();
    return ok(this.state);
  }

  redo(): Result<S, AppError> {
    if (!this.canRedo()) {
      return err({ code: 'EDIT_REJECTED', message: 'Rien à rétablir.' });
    }
    const entry = this.entries[this.cursor];
    if (entry === undefined) return err({ code: 'EDIT_REJECTED', message: 'Rien à rétablir.' });
    this.cursor += 1;
    this.state = entry.after;
    this.emit();
    return ok(this.state);
  }

  /**
   * Se place directement sur une entree donnee, comme un clic dans le panneau
   * Historique. `index` vaut -1 pour revenir a l etat d origine.
   */
  goTo(index: number): Result<S, AppError> {
    if (index < -1 || index >= this.entries.length) {
      return err({ code: 'EDIT_REJECTED', message: "Cette étape d'historique n'existe pas." });
    }
    if (index === -1) {
      const first = this.entries[0];
      this.state = first === undefined ? this.state : first.before;
      this.cursor = 0;
    } else {
      const entry = this.entries[index];
      if (entry === undefined) return err({ code: 'EDIT_REJECTED', message: 'Étape introuvable.' });
      this.state = entry.after;
      this.cursor = index + 1;
    }
    this.emit();
    return ok(this.state);
  }

  /** Marque l etat courant comme enregistre (section 44). */
  markSaved(): void {
    this.savedState = this.state;
    this.emit();
  }

  isDirty(): boolean {
    return !Object.is(this.state, this.savedState);
  }

  /** Vide l historique en conservant l etat courant. */
  clear(): void {
    this.entries.length = 0;
    this.cursor = 0;
    this.emit();
  }

  snapshot(): HistoryState {
    return {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      labels: this.entries.map((e) => e.label),
      position: this.cursor - 1,
      dirty: this.isDirty(),
    };
  }

  subscribe(listener: HistoryListener<S>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const listener of this.listeners) listener(this.state, snap);
  }
}
