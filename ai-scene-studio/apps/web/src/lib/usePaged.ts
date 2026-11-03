'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Page } from '@ass/api-client';

/** Liste paginée par curseur : première page au montage, « charger plus » à la demande. */
export function usePaged<T>(fetchPage: (cursor: string | null) => Promise<Page<T>>) {
  const [items, setItems] = useState<T[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (cursor: string | null) => {
      setLoading(true);
      try {
        const page = await fetchPage(cursor);
        setItems((previous) => (cursor ? [...previous, ...page.items] : page.items));
        setNextCursor(page.nextCursor);
        setError(null);
      } catch (reason) {
        setError((reason as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [fetchPage],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  return {
    items,
    error,
    loading,
    hasMore: nextCursor !== null,
    loadMore: () => load(nextCursor),
    reload: () => load(null),
  };
}
