import type { ReactNode } from 'react';

/** Touche de clavier affichée (raccourcis dans les menus, la palette et les infobulles). */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border-strong bg-surface px-1 py-px font-mono text-[10px] leading-none text-muted">
      {children}
    </kbd>
  );
}

const PLACEMENT = {
  bottom: 'left-1/2 top-full mt-1.5 -translate-x-1/2',
  top: 'bottom-full left-1/2 mb-1.5 -translate-x-1/2',
  right: 'left-full top-1/2 ml-3 -translate-y-1/2',
} as const;

/**
 * Infobulle au survol et au focus, avec raccourci facultatif. Purement CSS : aucun état, aucun
 * positionnement calculé (placée sous l'élément, centrée).
 */
export function Tooltip({
  label,
  shortcut,
  children,
  side = 'bottom',
  className = 'inline-flex',
}: {
  label: string;
  shortcut?: string;
  children: ReactNode;
  side?: 'bottom' | 'top' | 'right';
  className?: string;
}) {
  return (
    <span className={`group/tip relative ${className}`}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-40 flex items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-elevated px-2 py-1 text-xs text-text opacity-0 shadow-pop transition-opacity delay-0 group-focus-within/tip:opacity-100 group-hover/tip:opacity-100 group-hover/tip:delay-500 ${PLACEMENT[side]}`}
      >
        {label}
        {shortcut && <Kbd>{shortcut}</Kbd>}
      </span>
    </span>
  );
}
