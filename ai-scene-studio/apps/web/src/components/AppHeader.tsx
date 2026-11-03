'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

export function AppHeader() {
  const { state, signOut } = useAuth();
  const router = useRouter();

  return (
    <header className="border-b border-border bg-panel">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
        <Link href="/" className="font-semibold">
          AI Scene Studio
        </Link>
        {state.status === 'authenticated' ? (
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/workspaces" className="hover:text-accent">
              Workspaces
            </Link>
            <span className="text-muted">{state.session.user.displayName}</span>
            <button
              type="button"
              className="rounded border border-border px-3 py-1 hover:border-accent"
              onClick={() => {
                void signOut().then(() => router.push('/login'));
              }}
            >
              Se déconnecter
            </button>
          </nav>
        ) : (
          state.status === 'anonymous' && (
            <Link href="/login" className="text-sm hover:text-accent">
              Se connecter
            </Link>
          )
        )}
      </div>
    </header>
  );
}
