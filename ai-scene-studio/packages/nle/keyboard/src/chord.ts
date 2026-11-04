/**
 * Combinaisons de touches (section 34).
 *
 * Deux choix qui evitent des bugs classiques :
 *
 * 1. On travaille sur `KeyboardEvent.code` (position physique) et non sur
 *    `key` (caractere produit). Sur un clavier AZERTY, la touche a la position
 *    du Q americain produit « a ». Un montage se fait a la position des doigts :
 *    les raccourcis doivent suivre la position, pas la lettre imprimee.
 *
 * 2. Le modificateur « principal » est abstrait : `Mod` designe Cmd sur macOS
 *    et Ctrl ailleurs. Une meme table de raccourcis marche donc sur les deux
 *    plateformes sans etre dupliquee.
 */

export type Platform = 'mac' | 'other';

export interface Chord {
  /** Code physique de la touche, ex. `KeyJ`, `Space`, `ArrowLeft`. */
  readonly code: string;
  /** Cmd sur macOS, Ctrl ailleurs. */
  readonly mod: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  /** Ctrl explicite, meme sur macOS (rare mais utilise par certains presets). */
  readonly ctrl: boolean;
}

export class ChordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChordError';
  }
}

const ALIASES: Record<string, string> = {
  space: 'Space',
  spacebar: 'Space',
  enter: 'Enter',
  return: 'Enter',
  esc: 'Escape',
  escape: 'Escape',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  plus: 'Equal',
  minus: 'Minus',
  equal: 'Equal',
  comma: 'Comma',
  period: 'Period',
  slash: 'Slash',
  backslash: 'Backslash',
  semicolon: 'Semicolon',
  quote: 'Quote',
  bracketleft: 'BracketLeft',
  bracketright: 'BracketRight',
  backquote: 'Backquote',
};

function normalizeCode(token: string): string {
  const t = token.trim();
  if (t === '') throw new ChordError('Combinaison vide.');
  const lower = t.toLowerCase();
  const alias = ALIASES[lower];
  if (alias !== undefined) return alias;
  if (/^[a-z]$/.test(lower)) return `Key${lower.toUpperCase()}`;
  if (/^[0-9]$/.test(lower)) return `Digit${lower}`;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return `F${lower.slice(1)}`;
  // Deja un code physique valide.
  if (/^(Key[A-Z]|Digit[0-9]|F\d{1,2}|Numpad[A-Za-z0-9]+|[A-Z][A-Za-z]+)$/.test(t)) return t;
  throw new ChordError(`Touche non reconnue : « ${token} »`);
}

/** Parse `"Mod+Shift+K"`, `"Space"`, `"Alt+ArrowLeft"`. */
export function parseChord(text: string): Chord {
  const parts = text
    .split('+')
    .map((p) => p.trim())
    .filter((p) => p !== '');
  if (parts.length === 0) throw new ChordError('Combinaison vide.');

  let mod = false;
  let shift = false;
  let alt = false;
  let ctrl = false;
  let code: string | null = null;

  for (const part of parts) {
    switch (part.toLowerCase()) {
      case 'mod':
      case 'cmd':
      case 'meta':
      case 'command':
        mod = true;
        break;
      case 'ctrl':
      case 'control':
        ctrl = true;
        break;
      case 'shift':
        shift = true;
        break;
      case 'alt':
      case 'option':
      case 'opt':
        alt = true;
        break;
      default:
        if (code !== null) throw new ChordError(`Deux touches dans « ${text} ».`);
        code = normalizeCode(part);
    }
  }

  if (code === null)
    throw new ChordError(`Aucune touche dans « ${text} », seulement des modificateurs.`);
  return { code, mod, shift, alt, ctrl };
}

/** Forme canonique, pour comparer et indexer. */
export function chordKey(chord: Chord): string {
  return [
    chord.mod ? 'Mod' : '',
    chord.ctrl ? 'Ctrl' : '',
    chord.alt ? 'Alt' : '',
    chord.shift ? 'Shift' : '',
    chord.code,
  ]
    .filter((p) => p !== '')
    .join('+');
}

const DISPLAY_MAC: Record<string, string> = { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' };
const DISPLAY_OTHER: Record<string, string> = {
  Mod: 'Ctrl',
  Ctrl: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Maj',
};

const CODE_LABELS: Record<string, string> = {
  Space: 'Espace',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'Échap',
  Delete: 'Suppr',
  Backspace: 'Retour arrière',
  Enter: 'Entrée',
};

function codeLabel(code: string): string {
  const named = CODE_LABELS[code];
  if (named !== undefined) return named;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

/** Libelle affichable, adapte a la plateforme. */
export function formatChord(chord: Chord, platform: Platform = 'other'): string {
  const table = platform === 'mac' ? DISPLAY_MAC : DISPLAY_OTHER;
  const parts: string[] = [];
  if (chord.mod) parts.push(table['Mod'] ?? 'Mod');
  if (chord.ctrl && !(platform !== 'mac' && chord.mod)) parts.push(table['Ctrl'] ?? 'Ctrl');
  if (chord.alt) parts.push(table['Alt'] ?? 'Alt');
  if (chord.shift) parts.push(table['Shift'] ?? 'Shift');
  parts.push(codeLabel(chord.code));
  return platform === 'mac' ? parts.join('') : parts.join('+');
}

/** Evenement clavier reduit a ce dont le moteur a besoin. Facile a simuler. */
export interface KeyEventLike {
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly repeat?: boolean;
}

/** Convertit un evenement en combinaison, en resolvant `Mod` selon la plateforme. */
export function chordFromEvent(event: KeyEventLike, platform: Platform = 'other'): Chord {
  const mod = platform === 'mac' ? event.metaKey : event.ctrlKey;
  const ctrl = platform === 'mac' ? event.ctrlKey : false;
  return { code: event.code, mod, shift: event.shiftKey, alt: event.altKey, ctrl };
}
