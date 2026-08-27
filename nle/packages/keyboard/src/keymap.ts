/**
 * Tables de raccourcis et resolution (section 34).
 *
 * Une table associe des combinaisons a des actions. La resolution est
 * CONTEXTUELLE : la meme touche peut faire une chose dans la timeline et une
 * autre dans le moniteur, ce qui est indispensable dans un NLE ou les touches
 * simples sont une ressource rare.
 *
 * Regle de priorite : une liaison specifique a un contexte l emporte toujours
 * sur une liaison globale. Sans cela, `global` mangerait les touches des
 * panneaux.
 */
import type { AppError, Result } from '@valideo/shared';
import { appError, err, ok } from '@valideo/shared';
import { ACTION_IDS, actionById } from './actions.js';
import type { Chord, KeyEventLike, Platform } from './chord.js';
import { chordFromEvent, chordKey, formatChord, parseChord } from './chord.js';

export type KeyContext = 'global' | 'timeline' | 'monitor' | 'project';

export interface Binding {
  readonly chord: Chord;
  readonly actionId: string;
  readonly context: KeyContext;
}

export interface KeyMap {
  readonly id: string;
  readonly label: string;
  readonly bindings: readonly Binding[];
}

/** Construit une table depuis une description textuelle compacte. */
export function keymap(
  id: string,
  label: string,
  entries: Readonly<Record<string, string | readonly string[]>>,
): KeyMap {
  const bindings: Binding[] = [];
  for (const [actionId, chords] of Object.entries(entries)) {
    const definition = actionById(actionId);
    const context: KeyContext = definition?.context ?? 'global';
    for (const text of typeof chords === 'string' ? [chords] : chords) {
      bindings.push({ chord: parseChord(text), actionId, context });
    }
  }
  return { id, label, bindings };
}

export interface Conflict {
  readonly chord: string;
  readonly context: KeyContext;
  readonly actionIds: readonly string[];
}

/**
 * Conflits d une table : deux actions sur la meme combinaison, dans le meme
 * contexte. L editeur visuel de raccourcis doit les montrer avant d enregistrer.
 */
export function findConflicts(map: KeyMap): Conflict[] {
  const seen = new Map<string, string[]>();
  for (const binding of map.bindings) {
    const key = `${binding.context}|${chordKey(binding.chord)}`;
    const list = seen.get(key) ?? [];
    if (!list.includes(binding.actionId)) list.push(binding.actionId);
    seen.set(key, list);
  }
  const out: Conflict[] = [];
  for (const [key, actionIds] of seen) {
    if (actionIds.length > 1) {
      const [context, chord] = key.split('|');
      out.push({ chord: chord ?? '', context: (context ?? 'global') as KeyContext, actionIds });
    }
  }
  return out;
}

/** Actions inconnues : garde-fou contre une table mal ecrite ou obsolete. */
export function findUnknownActions(map: KeyMap): string[] {
  return [...new Set(map.bindings.map((b) => b.actionId))].filter((id) => !ACTION_IDS.has(id));
}

export function validateKeymap(map: KeyMap): Result<KeyMap, AppError> {
  const unknown = findUnknownActions(map);
  if (unknown.length > 0) {
    return err(
      appError('EDIT_REJECTED', 'Cette table de raccourcis référence des actions inconnues.', {
        detail: unknown.join(', '),
      }),
    );
  }
  const conflicts = findConflicts(map);
  if (conflicts.length > 0) {
    const first = conflicts[0];
    return err(
      appError('EDIT_REJECTED', 'Deux actions partagent le même raccourci.', {
        detail: first === undefined ? '' : `${first.chord} : ${first.actionIds.join(' et ')}`,
      }),
    );
  }
  return ok(map);
}

/** Index de resolution. A construire une fois, pas a chaque touche. */
export class KeyResolver {
  private readonly index = new Map<string, Binding[]>();

  constructor(
    private readonly map: KeyMap,
    private readonly platform: Platform = 'other',
  ) {
    for (const binding of map.bindings) {
      const key = chordKey(binding.chord);
      const list = this.index.get(key) ?? [];
      list.push(binding);
      this.index.set(key, list);
    }
  }

  /** Action declenchee par cet evenement dans ce contexte, ou `null`. */
  resolve(event: KeyEventLike, context: KeyContext = 'global'): string | null {
    const candidates = this.index.get(chordKey(chordFromEvent(event, this.platform)));
    if (candidates === undefined) return null;
    // Le contexte precis l emporte sur le global.
    const exact = candidates.find((b) => b.context === context);
    if (exact !== undefined) return exact.actionId;
    const global = candidates.find((b) => b.context === 'global');
    return global?.actionId ?? null;
  }

  /** Combinaisons liees a une action, pour l afficher dans les menus. */
  chordsFor(actionId: string): string[] {
    return this.map.bindings
      .filter((b) => b.actionId === actionId)
      .map((b) => formatChord(b.chord, this.platform));
  }

  keymap(): KeyMap {
    return this.map;
  }
}

/**
 * Applique une personnalisation par-dessus un preset.
 * Une action redefinie remplace TOUTES ses liaisons d origine : sinon
 * l ancienne touche continuerait de fonctionner, au grand desarroi de
 * l utilisateur qui vient de la changer.
 */
export function customize(
  base: KeyMap,
  overrides: Readonly<Record<string, string | readonly string[]>>,
  id = `${base.id}-personnalise`,
  label = `${base.label} (personnalisé)`,
): KeyMap {
  const replaced = new Set(Object.keys(overrides));
  const kept = base.bindings.filter((b) => !replaced.has(b.actionId));
  const added = keymap(id, label, overrides).bindings;
  return { id, label, bindings: [...kept, ...added] };
}
