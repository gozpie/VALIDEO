'use client';

import { Clapperboard, Command as CommandIcon, LogOut } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { commandStore, useCommandSource } from '@/lib/commands';
import { Kbd } from './Kbd';

export function AppHeader() {
  const { state, signOut } = useAuth();
  const router = useRouter();
  const authenticated = state.status === 'authenticated';
  const logout = () => void signOut().then(() => router.push('/login'));

  useCommandSource('app', [
    { id: 'home', label: 'Aller à l’accueil', group: 'Navigation', run: () => router.push('/') },
    {
      id: 'workspaces',
      label: 'Aller aux workspaces',
      group: 'Navigation',
      keywords: 'projets espaces',
      disabled: !authenticated,
      run: () => router.push('/workspaces'),
    },
    {
      id: 'logout',
      label: 'Se déconnecter',
      group: 'Compte',
      disabled: !authenticated,
      run: logout,
    },
  ]);

  return (
    <header className="sticky top-0 z-[5] border-b border-border bg-panel/85 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-2.5">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-accent to-ai text-white shadow-card">
            <Clapperboard size={15} />
          </span>
          AI Scene Studio
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          <button
            type="button"
            aria-label="Palette de commandes"
            className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-muted hover:border-border-strong hover:text-text"
            onClick={() => commandStore.getState().setOpen(true)}
          >
            <CommandIcon size={13} />
            Commandes
            <Kbd>⌘K</Kbd>
          </button>
          {authenticated ? (
            <>
              <Link href="/workspaces" className="text-muted hover:text-text">
                Workspaces
              </Link>
              <span className="text-faint">{state.session.user.displayName}</span>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:border-border-strong"
                onClick={logout}
              >
                <LogOut size={13} />
                Se déconnecter
              </button>
            </>
          ) : (
            state.status === 'anonymous' && (
              <Link href="/login" className="hover:text-accent-strong">
                Se connecter
              </Link>
            )
          )}
        </nav>
      </div>
    </header>
  );
}
