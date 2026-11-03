'use client';

import type { Session } from '@ass/api-client';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '@/components/AuthProvider';

/** Affiche son contenu à un utilisateur connecté ; sinon redirige vers la connexion. */
export function RequireAuth({ children }: { children: (session: Session) => ReactNode }) {
  const { state } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (state.status === 'anonymous') {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [state.status, router, pathname]);

  if (state.status === 'authenticated') return <>{children(state.session)}</>;
  if (state.status === 'unreachable') {
    return (
      <p className="flex min-h-screen items-center justify-center text-sm text-error">
        API injoignable : impossible de vérifier la session.
      </p>
    );
  }
  return (
    <p className="flex min-h-screen items-center justify-center text-sm text-muted">
      Vérification de la session…
    </p>
  );
}
