'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ApiStatus } from '@/components/ApiStatus';
import { AuthScreen } from '@/components/AuthScreen';
import { useAuth } from '@/components/AuthProvider';
import { API_URL } from '@/lib/config';

export default function HomePage() {
  const { state } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (state.status === 'authenticated') router.replace('/workspaces');
  }, [state.status, router]);
  return (
    <AuthScreen>
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Chagomi</h1>
          <p className="mt-1 text-sm text-muted">
            La plateforme de production de films IA : du script au film.
          </p>
        </div>
        {state.status === 'anonymous' && (
          <Link
            href="/login"
            className="flex h-10 items-center justify-center gap-2 rounded-lg bg-accent text-sm font-semibold text-white hover:bg-accent-strong"
          >
            Se connecter <ArrowRight size={15} />
          </Link>
        )}
        <ApiStatus apiUrl={API_URL} />
      </div>
    </AuthScreen>
  );
}
