'use client';

import { ChevronLeft, ChevronRight, LogOut, Moon, Plus, Search, Sun } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { commandStore } from '@/lib/commands';
import { useTheme } from '@/lib/theme';
import { Kbd, Tooltip } from './Kbd';

export interface SidebarItem {
  id: string;
  label: string;
  icon: ReactNode;
  badge?: string;
  active?: boolean;
  /** Élément courant d'une liste secondaire (projet ouvert) : mis en évidence sans aplat bleu. */
  current?: boolean;
  href?: string;
  onSelect?: () => void;
}

export interface SidebarSection {
  title: string;
  items: SidebarItem[];
  action?: { label: string; href: string };
}

const KEY = 'ass.sidebar.collapsed';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

/**
 * Barre latérale de Chagomi : logo, profil, recherche (palette ⌘K), sections de navigation avec
 * compteurs, thème clair / sombre. Repliable en rail d'icônes (infobulles), état mémorisé.
 */
export function AppSidebar({
  subtitle,
  sections,
}: {
  subtitle: string;
  sections: SidebarSection[];
}) {
  const { state, signOut } = useAuth();
  const router = useRouter();
  const [theme, setTheme] = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(KEY) === '1');
    } catch {
      // Préférence indisponible : barre dépliée.
    }
  }, []);
  const toggle = () => {
    setCollapsed((value) => {
      try {
        window.localStorage.setItem(KEY, value ? '0' : '1');
      } catch {
        // Préférence non mémorisée.
      }
      return !value;
    });
  };
  const name = state.status === 'authenticated' ? state.session.user.displayName : '';

  const item = (entry: SidebarItem) => {
    const body = (
      <>
        <span className={`flex w-5 shrink-0 justify-center ${entry.active ? '' : 'text-muted'}`}>
          {entry.icon}
        </span>
        {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{entry.label}</span>}
        {!collapsed && entry.badge !== undefined && (
          <span
            className={`min-w-6 rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums ${entry.active ? 'bg-white/20 text-white' : 'bg-surface text-muted'}`}
          >
            {entry.badge}
          </span>
        )}
      </>
    );
    const className = `relative flex h-11 w-full items-center gap-3 rounded-xl text-[14px] font-medium transition-colors ${collapsed ? 'justify-center px-0' : 'px-3'} ${entry.active ? 'bg-accent text-white shadow-[0_8px_20px_-8px] shadow-accent/60' : entry.current ? 'bg-hover text-text' : 'text-text/85 hover:bg-hover hover:text-text'}`;
    const control = entry.href ? (
      <Link
        href={entry.href}
        className={className}
        aria-current={entry.active ? 'page' : undefined}
        aria-label={collapsed ? entry.label : undefined}
      >
        {body}
      </Link>
    ) : (
      <button
        type="button"
        className={className}
        aria-current={entry.active ? 'page' : undefined}
        aria-label={collapsed ? entry.label : undefined}
        onClick={entry.onSelect}
      >
        {body}
      </button>
    );
    return (
      <li key={entry.id}>
        {collapsed ? (
          <Tooltip
            label={entry.badge ? `${entry.label} · ${entry.badge}` : entry.label}
            side="right"
            className="flex w-full"
          >
            {control}
          </Tooltip>
        ) : (
          control
        )}
      </li>
    );
  };

  return (
    <aside
      aria-label="Navigation"
      className={`relative z-20 flex h-full shrink-0 flex-col border-r border-border bg-sidebar transition-[width] duration-200 ${collapsed ? 'w-[76px] px-3' : 'w-[268px] px-4'}`}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? 'Déplier la barre latérale' : 'Replier la barre latérale'}
        className="absolute -right-3 top-[26px] flex h-8 w-6 items-center justify-center rounded-md border border-border bg-elevated text-accent-strong shadow-card hover:text-text"
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>

      <Link
        href="/workspaces"
        aria-label="Chagomi — accueil"
        className={`flex h-[78px] shrink-0 items-center ${collapsed ? 'justify-center' : 'pl-1'}`}
      >
        {collapsed ? (
          <img src="/brand/favicon-chagomi.png" alt="" className="brand-mark h-9 w-9 rounded-lg" />
        ) : (
          <>
            <img
              src={
                theme === 'light' ? '/brand/logo-chagomi-ink.png' : '/brand/logo-chagomi-light.png'
              }
              alt="Chagomi Studio"
              className="h-9 w-auto"
            />
          </>
        )}
      </Link>

      <div className={`flex items-center gap-3 pb-4 ${collapsed ? 'justify-center' : ''}`}>
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-ai text-sm font-bold text-white ring-2 ring-border">
          {initials(name) || '·'}
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-sidebar bg-ok" />
        </span>
        {!collapsed && (
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-bold">{name}</span>
            <span className="block truncate text-xs text-muted">{subtitle}</span>
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={() => commandStore.getState().setOpen(true)}
        aria-label="Rechercher une commande"
        className={`mb-3 flex h-10 shrink-0 items-center gap-2.5 rounded-xl bg-surface text-sm text-faint transition-colors hover:text-text ${collapsed ? 'justify-center' : 'px-3'}`}
      >
        <Search size={16} />
        {!collapsed && (
          <>
            <span className="flex-1 text-left">Rechercher…</span>
            <Kbd>⌘K</Kbd>
          </>
        )}
      </button>

      <nav
        className={`-mx-1 flex min-h-0 flex-1 flex-col gap-5 px-1 py-2 ${collapsed ? '' : 'overflow-y-auto'}`}
      >
        {sections.map((section) => (
          <div key={section.title} className="flex flex-col gap-1">
            {!collapsed && (
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
                {section.title}
              </p>
            )}
            {collapsed && <span className="mx-auto mb-1 h-px w-6 bg-border" />}
            <ul className="flex flex-col gap-1">{section.items.map(item)}</ul>
            {section.action && !collapsed && (
              <Link
                href={section.action.href}
                className="flex h-10 items-center gap-3 rounded-xl px-3 text-[13px] font-medium text-accent-strong hover:bg-hover"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-accent-strong">
                  <Plus size={12} />
                </span>
                {section.action.label}
              </Link>
            )}
          </div>
        ))}
      </nav>

      <div
        className={`flex shrink-0 flex-col gap-2 border-t border-border py-3 ${collapsed ? 'items-center' : ''}`}
      >
        <div
          role="group"
          aria-label="Thème"
          className={`flex rounded-xl bg-surface p-1 ${collapsed ? 'flex-col' : ''}`}
        >
          {(
            [
              ['dark', <Moon key="m" size={14} />, 'Sombre'],
              ['light', <Sun key="s" size={14} />, 'Clair'],
            ] as const
          ).map(([value, icon, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={theme === value}
              aria-label={`Thème ${label.toLowerCase()}`}
              onClick={() => setTheme(value)}
              className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors ${theme === value ? 'bg-elevated text-text shadow-card' : 'text-muted hover:text-text'}`}
            >
              {icon}
              {!collapsed && label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void signOut().then(() => router.push('/login'))}
          className={`flex h-9 items-center gap-3 rounded-xl text-[13px] text-muted hover:bg-hover hover:text-text ${collapsed ? 'w-10 justify-center' : 'px-3'}`}
          aria-label="Se déconnecter"
        >
          <LogOut size={15} />
          {!collapsed && 'Se déconnecter'}
        </button>
      </div>
    </aside>
  );
}
