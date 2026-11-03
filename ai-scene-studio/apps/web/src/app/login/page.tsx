'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { AuthScreen } from '@/components/AuthScreen';
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
    <AuthScreen>
      <div className="flex flex-col gap-5">
        <h1 className="text-lg font-bold tracking-tight">Connexion</h1>
        <LoginForm onSignedIn={signedIn} />
        <p className="text-xs text-faint">
          L’inscription se fait sur invitation d’un administrateur de workspace.
        </p>
      </div>
    </AuthScreen>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}
