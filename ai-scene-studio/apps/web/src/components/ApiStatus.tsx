'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchApiHealth, type ApiHealthState } from '@/lib/health';

const LABELS: Record<string, string> = {
  database: 'Base de données',
  redis: 'File de jobs (Redis)',
  storage: 'Stockage médias (S3)',
};

export function ApiStatus({ apiUrl }: { apiUrl: string }) {
  const [state, setState] = useState<ApiHealthState>({ kind: 'loading' });

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      setState({ kind: 'loading' });
      try {
        setState(await fetchApiHealth(apiUrl, fetch, signal));
      } catch {
        // Requête annulée au démontage : rien à afficher.
      }
    },
    [apiUrl],
  );

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  return (
    <section
      aria-labelledby="api-status-title"
      className="rounded-xl border border-border bg-surface/60 p-4"
    >
      <div className="flex items-center justify-between gap-4">
        <h2
          id="api-status-title"
          className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint"
        >
          État des services
        </h2>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={state.kind === 'loading'}
          className="rounded-md border border-border px-2.5 py-1 text-xs hover:border-border-strong disabled:opacity-50"
        >
          Revérifier
        </button>
      </div>
      <div role="status" aria-live="polite" className="mt-3 text-[13px]">
        {state.kind === 'loading' && <p className="text-muted">Vérification en cours…</p>}
        {state.kind === 'unreachable' && (
          <p className="text-error">
            {state.message} ({apiUrl}).
          </p>
        )}
        {(state.kind === 'ready' || state.kind === 'unavailable') && (
          <>
            <p className={state.kind === 'ready' ? 'text-ok' : 'text-warn'}>
              {state.kind === 'ready'
                ? `API opérationnelle (v${state.health.version})`
                : `API joignable mais dégradée (v${state.health.version})`}
            </p>
            <ul className="mt-3 space-y-1">
              {Object.entries(state.health.checks).map(([name, check]) => (
                <li key={name} className="flex justify-between gap-4">
                  <span>{LABELS[name] ?? name}</span>
                  <span className={check.status === 'ok' ? 'text-ok' : 'text-error'}>
                    {check.status === 'ok'
                      ? 'OK'
                      : `Erreur${check.detail ? ` : ${check.detail}` : ''}`}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
