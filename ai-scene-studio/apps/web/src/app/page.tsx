'use client';

import { CURRENT_SCHEMA_VERSION } from '@ass/scene-schema';
import Link from 'next/link';
import { ApiStatus } from '@/components/ApiStatus';
import { useAuth } from '@/components/AuthProvider';
import { API_URL } from '@/lib/config';

export default function HomePage() {
  const { state } = useAuth();
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">AI Scene Studio</h1>
        <p className="mt-2 text-sm text-muted">
          Phase 1 : projets, séquences et plans persistants. L’éditeur de scène 3D arrive en phase
          2. Format de scène : v{CURRENT_SCHEMA_VERSION}.
        </p>
      </header>
      {state.status === 'authenticated' ? (
        <Link href="/workspaces" className="text-accent hover:underline">
          Ouvrir mes workspaces →
        </Link>
      ) : (
        state.status === 'anonymous' && (
          <Link href="/login" className="text-accent hover:underline">
            Se connecter →
          </Link>
        )
      )}
      <ApiStatus apiUrl={API_URL} />
    </div>
  );
}
