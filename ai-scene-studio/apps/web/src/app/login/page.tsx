'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { LoginForm } from '@/components/LoginForm';
import { safeNextPath } from '@/lib/navigation';

function Login() {
  const { state, signedIn } = useAuth();
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get('next'));

  useEffect(() => {
    if (state.status === 'authenticated') router.replace(next);
  }, [state.status, router, next]);

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6">
      <h1 className="text-xl font-semibold">Connexion</h1>
      <LoginForm onSignedIn={signedIn} />
      <p className="text-xs text-muted">
        L’inscription se fait sur invitation d’un administrateur de workspace.
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}
