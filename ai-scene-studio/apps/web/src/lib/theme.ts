'use client';

import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';
const KEY = 'ass.theme';

/** Thème de l'interface (sombre par défaut), mémorisé dans le navigateur. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>('dark');
  useEffect(() => {
    setTheme(document.documentElement.dataset['theme'] === 'light' ? 'light' : 'dark');
  }, []);
  return [
    theme,
    (next: Theme) => {
      document.documentElement.dataset['theme'] = next;
      try {
        window.localStorage.setItem(KEY, next);
      } catch {
        // Stockage indisponible : le thème vaut pour la session.
      }
      setTheme(next);
    },
  ];
}
