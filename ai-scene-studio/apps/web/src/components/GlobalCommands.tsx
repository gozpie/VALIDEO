'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useCommandSource } from '@/lib/commands';

/** Commandes de la palette disponibles partout : navigation et compte. */
export function GlobalCommands() {
  const { state, signOut } = useAuth();
  const router = useRouter();
  const authenticated = state.status === 'authenticated';
  useCommandSource('app', [
    {
      id: 'workspaces',
      label: 'Aller aux workspaces',
      group: 'Navigation',
      keywords: 'projets espaces accueil',
      disabled: !authenticated,
      run: () => router.push('/workspaces'),
    },
    {
      id: 'logout',
      label: 'Se déconnecter',
      group: 'Compte',
      disabled: !authenticated,
      run: () => void signOut().then(() => router.push('/login')),
    },
  ]);
  return null;
}
