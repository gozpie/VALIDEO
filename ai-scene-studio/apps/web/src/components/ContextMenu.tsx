'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Kbd } from './Kbd';

export type MenuItem =
  | {
      label: string;
      shortcut?: string;
      icon?: ReactNode;
      danger?: boolean;
      disabled?: boolean;
      run: () => void;
    }
  | 'separator';

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

/**
 * Menu contextuel (clic droit) : `open(event, items)` l'affiche au pointeur, recadré dans la
 * fenêtre ; ↑ ↓ / Entrée au clavier, fermeture par Échap, clic extérieur ou défilement.
 */
export function useContextMenu(): {
  open: (
    event: { clientX: number; clientY: number; preventDefault: () => void },
    items: MenuItem[],
  ) => void;
  menu: ReactNode;
} {
  const [state, setState] = useState<MenuState | null>(null);
  const open = useCallback(
    (
      event: { clientX: number; clientY: number; preventDefault: () => void },
      items: MenuItem[],
    ) => {
      event.preventDefault();
      setState({ x: event.clientX, y: event.clientY, items });
    },
    [],
  );
  const menu = state ? <Menu state={state} onClose={() => setState(null)} /> : null;
  return { open, menu };
}

function Menu({ state, onClose }: { state: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLUListElement>(null);
  const [position, setPosition] = useState({ left: state.x, top: state.y });
  const actionable = state.items
    .map((item, index) => (item !== 'separator' && !item.disabled ? index : -1))
    .filter((index) => index >= 0);
  const [cursor, setCursor] = useState(actionable[0] ?? -1);

  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setPosition({
      left: Math.max(4, Math.min(state.x, window.innerWidth - box.width - 4)),
      top: Math.max(4, Math.min(state.y, window.innerHeight - box.height - 4)),
    });
    ref.current?.focus();
  }, [state.x, state.y]);

  useEffect(() => {
    const close = (event: Event) => {
      if (event.type === 'mousedown' && ref.current?.contains(event.target as Node)) return;
      onClose();
    };
    window.addEventListener('mousedown', close, true);
    window.addEventListener('wheel', close, true);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close, true);
      window.removeEventListener('wheel', close, true);
      window.removeEventListener('blur', close);
    };
  }, [onClose]);

  const run = (index: number) => {
    const item = state.items[index];
    if (!item || item === 'separator' || item.disabled) return;
    onClose();
    item.run();
  };
  const move = (step: 1 | -1) => {
    const at = actionable.indexOf(cursor);
    const next = actionable[(at + step + actionable.length) % actionable.length];
    if (next !== undefined) setCursor(next);
  };

  return (
    <ul
      ref={ref}
      role="menu"
      tabIndex={-1}
      aria-label="Menu contextuel"
      style={{ left: position.left, top: position.top }}
      className="fixed z-50 min-w-52 animate-pop-in rounded-lg border border-border bg-elevated p-1 text-sm shadow-pop outline-none"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') onClose();
        else if (event.key === 'ArrowDown') move(1);
        else if (event.key === 'ArrowUp') move(-1);
        else if (event.key === 'Enter') run(cursor);
        else return;
        event.preventDefault();
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {state.items.map((item, index) =>
        item === 'separator' ? (
          <li key={`sep-${index}`} role="separator" className="my-1 h-px bg-border" />
        ) : (
          <li
            key={item.label}
            role="menuitem"
            aria-disabled={item.disabled ?? false}
            className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 ${index === cursor ? 'bg-hover' : ''} ${item.danger ? 'text-error' : ''} ${item.disabled ? 'cursor-default opacity-40' : ''}`}
            onMouseMove={() => !item.disabled && setCursor(index)}
            onClick={() => run(index)}
          >
            <span className="flex w-4 justify-center text-muted">{item.icon}</span>
            <span className="flex-1">{item.label}</span>
            {item.shortcut && <Kbd>{item.shortcut}</Kbd>}
          </li>
        ),
      )}
    </ul>
  );
}
