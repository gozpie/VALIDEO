'use client';

import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { commandStore, searchCommands, useAllCommands, usePaletteOpen } from '@/lib/commands';
import { Kbd } from './Kbd';

/**
 * Palette de commandes : ⌘K / Ctrl+K partout, F3 aussi (recherche d'opérateurs de Blender).
 * Recherche floue, navigation ↑ ↓, Entrée pour exécuter, Échap pour fermer.
 */
export function CommandPalette() {
  const open = usePaletteOpen();
  const sources = useAllCommands();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if ((mod && event.key.toLowerCase() === 'k') || (event.key === 'F3' && !mod)) {
        event.preventDefault();
        commandStore.getState().setOpen(!commandStore.getState().open);
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setCursor(0);
    input.current?.focus();
  }, [open]);

  const results = useMemo(
    () => searchCommands(Object.values(sources).flat(), query),
    [sources, query],
  );

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!open) return null;
  const close = () => commandStore.getState().setOpen(false);
  const run = (index: number) => {
    const command = results[index];
    if (!command || command.disabled) return;
    close();
    command.run();
  };

  let lastGroup = '';
  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-start justify-center bg-black/50 pt-[14vh] backdrop-blur-[2px]"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <div
        role="dialog"
        aria-label="Palette de commandes"
        className="w-[min(36rem,92vw)] animate-pop-in overflow-hidden rounded-xl border border-border bg-panel shadow-pop"
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search size={16} className="text-faint" />
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-label="Rechercher une commande"
            placeholder="Rechercher une commande…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setCursor((value) => Math.min(value + 1, results.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setCursor((value) => Math.max(value - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                run(cursor);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                close();
              }
            }}
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-faint focus-visible:outline-none"
          />
          <Kbd>Échap</Kbd>
        </div>
        <ul
          ref={list}
          id="palette-results"
          role="listbox"
          aria-label="Commandes"
          className="max-h-[50vh] overflow-auto p-1.5"
        >
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted">Aucune commande trouvée</li>
          )}
          {results.map((command, index) => {
            const header = query === '' && command.group !== lastGroup;
            lastGroup = command.group;
            return (
              <li key={`${command.group}:${command.id}`} role="presentation">
                {header && (
                  <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-faint">
                    {command.group}
                  </div>
                )}
                <div
                  role="option"
                  aria-selected={index === cursor}
                  aria-disabled={command.disabled ?? false}
                  className={`flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm ${index === cursor ? 'bg-accent/20 text-text' : 'text-text/90'} ${command.disabled ? 'opacity-40' : ''}`}
                  onMouseMove={() => setCursor(index)}
                  onClick={() => run(index)}
                >
                  <span className="min-w-0 flex-1 truncate">{command.label}</span>
                  {query !== '' && <span className="text-xs text-faint">{command.group}</span>}
                  {command.shortcut && <Kbd>{command.shortcut}</Kbd>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
