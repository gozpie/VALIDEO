import type { ReactNode } from 'react';

/** Écran hors application (accueil, connexion, invitation) : marque Chagomi et un seul panneau. */
export function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-surface px-6 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_34rem_at_50%_-10%,color-mix(in_srgb,var(--color-accent)_22%,transparent),transparent),radial-gradient(40rem_26rem_at_90%_110%,color-mix(in_srgb,var(--color-ai)_16%,transparent),transparent)]"
      />
      <div className="relative flex w-full max-w-sm flex-col items-center gap-7">
        <img
          src="/brand/logo-chagomi-stacked-light.png"
          alt=""
          className="brand-logo-dark h-28 w-auto"
        />
        <img
          src="/brand/logo-chagomi-stacked-ink.png"
          alt=""
          className="brand-logo-light h-28 w-auto"
        />
        <div className="w-full rounded-2xl border border-border bg-panel/90 p-6 shadow-pop backdrop-blur">
          {children}
        </div>
      </div>
    </main>
  );
}
