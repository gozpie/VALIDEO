'use client';

import type { Session } from '@ass/api-client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '@/lib/api';

type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'unreachable' }
  | { status: 'authenticated'; session: Session };

interface AuthContextValue {
  state: AuthState;
  /** Mémorise la session renvoyée par la connexion ou l'acceptation d'une invitation. */
  signedIn: (session: Session) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    api
      .GET('/auth/session')
      .then(({ data }) => {
        if (active)
          setState(data ? { status: 'authenticated', session: data } : { status: 'anonymous' });
      })
      .catch(() => {
        if (active) setState({ status: 'unreachable' });
      });
    return () => {
      active = false;
    };
  }, []);

  const signedIn = useCallback((session: Session) => {
    setState({ status: 'authenticated', session });
  }, []);

  const signOut = useCallback(async () => {
    await api.POST('/auth/logout');
    setState({ status: 'anonymous' });
  }, []);

  const value = useMemo(() => ({ state, signedIn, signOut }), [state, signedIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth doit être utilisé sous <AuthProvider>');
  return context;
}
