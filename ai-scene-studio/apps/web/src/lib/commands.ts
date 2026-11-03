import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/**
 * Registre des commandes de la palette (⌘K). Chaque écran déclare ses commandes ; la palette
 * affiche celles des sources montées. Une commande désactivée reste visible, grisée.
 */
export interface Command {
  id: string;
  label: string;
  group: string;
  shortcut?: string;
  keywords?: string;
  disabled?: boolean;
  run: () => void;
}

interface CommandState {
  sources: Record<string, Command[]>;
  open: boolean;
  setSource: (key: string, commands: Command[] | null) => void;
  setOpen: (open: boolean) => void;
}

export const commandStore = createStore<CommandState>()((set) => ({
  sources: {},
  open: false,
  setSource: (key, commands) =>
    set((state) => ({
      sources: commands
        ? { ...state.sources, [key]: commands }
        : Object.fromEntries(Object.entries(state.sources).filter(([name]) => name !== key)),
    })),
  setOpen: (open) => set({ open }),
}));

export const usePaletteOpen = () => useStore(commandStore, (state) => state.open);
export const useAllCommands = () => useStore(commandStore, (state) => state.sources);

/** Déclare les commandes d'un écran tant qu'il est monté (la liste peut changer à chaque rendu). */
export function useCommandSource(key: string, commands: Command[]): void {
  const latest = useRef(commands);
  latest.current = commands;
  const signature = commands.map((c) => `${c.id}:${c.label}:${c.disabled ? 1 : 0}`).join('|');
  useEffect(() => {
    // Les `run` délèguent à la dernière version pour ne pas capturer un état périmé.
    commandStore.getState().setSource(
      key,
      latest.current.map((command) => ({
        ...command,
        run: () => latest.current.find((c) => c.id === command.id)?.run(),
      })),
    );
  }, [key, signature]);
  useEffect(() => () => commandStore.getState().setSource(key, null), [key]);
}

/** Recherche floue : lettres dans l'ordre ; bonus aux débuts de mots et aux suites contiguës. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = normalize(query);
  if (q === '') return 0;
  const t = normalize(text);
  let score = 0;
  let position = -1;
  let streak = 0;
  for (const char of q) {
    const found = t.indexOf(char, position + 1);
    if (found === -1) return null;
    const wordStart = found === 0 || t[found - 1] === ' ';
    streak = found === position + 1 ? streak + 1 : 0;
    score += 1 + (wordStart ? 3 : 0) + streak * 2 - Math.min(found - position - 1, 5) * 0.2;
    position = found;
  }
  return score;
}

export function searchCommands(commands: Command[], query: string): Command[] {
  return commands
    .map((command) => ({
      command,
      score: fuzzyScore(query, `${command.label} ${command.group} ${command.keywords ?? ''}`),
    }))
    .filter((entry): entry is { command: Command; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.command);
}

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
