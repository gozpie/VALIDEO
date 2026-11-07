'use client';

import type {
  AiProvider,
  GenerationEstimate,
  GenerationInput,
  GenerationJob,
  GenerationMode,
} from '@ass/api-client';
import { CircleAlert, Loader2, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, call } from '@/lib/api';
import { toast } from '@/lib/toast';

export type GenerationTarget = { kind: 'project'; id: string } | { kind: 'shot'; id: string };

/**
 * Modèles disponibles pour un mode (tous fournisseurs), avec leur disponibilité ; `controle`
 * ne garde que ceux qui savent tenir cette contrainte (ex. `camera_motion`).
 */
export function modelsFor(providers: AiProvider[], mode: GenerationMode, controle?: string) {
  return providers.flatMap((provider) =>
    provider.models
      .filter((model) => model.modes.includes(mode))
      .filter((model) => !controle || model.controls.includes(controle))
      .map((model) => ({
        key: `${provider.id}:${model.model}`,
        provider: provider.id,
        model: model.model,
        label: model.label,
        providerLabel: provider.label,
        available: provider.available,
        reason: provider.reason,
        paid: provider.kind === 'bridge' || provider.kind === 'official',
        durations: model.durationsSeconds,
        aspects: model.aspectRatios,
      })),
  );
}

export async function estimate(target: GenerationTarget, body: GenerationInput) {
  return target.kind === 'project'
    ? call(
        api.POST('/projects/{project_id}/generations/estimate', {
          params: { path: { project_id: target.id } },
          body,
        }),
      )
    : call(
        api.POST('/shots/{shot_id}/generations/estimate', {
          params: { path: { shot_id: target.id } },
          body,
        }),
      );
}

async function create(target: GenerationTarget, body: GenerationInput) {
  const headers = { 'Idempotency-Key': crypto.randomUUID() };
  return target.kind === 'project'
    ? call(
        api.POST('/projects/{project_id}/generations', {
          params: { path: { project_id: target.id } },
          body,
          headers,
        }),
      )
    : call(
        api.POST('/shots/{shot_id}/generations', {
          params: { path: { shot_id: target.id } },
          body,
          headers,
        }),
      );
}

/**
 * Bouton de génération du studio : choix du modèle, estimation serveur affichée en direct,
 * **confirmation du montant exact** pour tout moteur payant, puis lancement.
 */
export function GenerateControl({
  target,
  providers,
  mode,
  body,
  label,
  disabled,
  onCreated,
  defaultModel,
  compact = false,
  avant,
  controle,
  simple = false,
  occupe,
}: {
  target: GenerationTarget;
  providers: AiProvider[];
  mode: GenerationMode;
  body: Omit<GenerationInput, 'provider' | 'model' | 'mode'>;
  label: string;
  disabled?: boolean;
  onCreated: (job: GenerationJob) => void;
  defaultModel?: string;
  compact?: boolean;
  /**
   * À faire juste avant d'envoyer (enregistrer la scène, préparer un média) ; `false` annule
   * l'envoi, un objet complète la demande (ex. la vidéo grise tout juste enregistrée).
   */
  avant?: () => Promise<boolean | Partial<GenerationInput>>;
  /** Seuls les modèles qui tiennent cette contrainte sont proposés (ex. `camera_motion`). */
  controle?: string;
  /** Présentation simple : un grand bouton, le choix du moteur rangé dans « Moteur ». */
  simple?: boolean;
  /** Ce qui se passe pendant `avant` (ex. « Enregistrement de la vidéo grise… »). */
  occupe?: string | null;
}) {
  const models = useMemo(() => modelsFor(providers, mode, controle), [providers, mode, controle]);
  const [choice, setChoice] = useState<string | null>(null);
  const selected =
    models.find((m) => m.key === choice) ??
    models.find((m) => m.key === defaultModel && m.available) ??
    models.find((m) => m.available) ??
    models[0];
  const [quote, setQuote] = useState<GenerationEstimate | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const extra = useMemo(() => {
    if (!selected || !(mode === 'text_to_video' || mode === 'image_to_video')) return {};
    // Durée demandée ramenée à la plus proche que le modèle sait produire.
    const wanted = body.durationSeconds ?? selected.durations[0] ?? null;
    const nearest =
      wanted === null || selected.durations.length === 0
        ? wanted
        : selected.durations.reduce((best, d) =>
            Math.abs(d - wanted) < Math.abs(best - wanted) ? d : best,
          );
    return { durationSeconds: nearest };
  }, [selected, mode, body.durationSeconds]);
  const full = useMemo(
    (): GenerationInput | null =>
      selected
        ? { ...body, ...extra, provider: selected.provider, model: selected.model, mode }
        : null,
    [selected, body, extra, mode],
  );
  const signature = JSON.stringify(full);

  useEffect(() => {
    if (!full) return;
    let alive = true;
    // Le devis précédent ne vaut plus : pas d'envoi ni de confirmation tant que le nouveau manque.
    setQuote(null);
    setConfirming(false);
    const timer = setTimeout(() => {
      estimate(target, full)
        .then((value) => {
          if (!alive) return;
          setQuote(value);
          setProblem(null);
        })
        .catch((error: Error) => {
          if (!alive) return;
          setQuote(null);
          setProblem(error.message);
        });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // Dépendances : `signature` résume le contenu de `full`.
  }, [signature, target.kind, target.id]);

  const submit = async (confirmed?: number) => {
    if (!full) return;
    setBusy(true);
    try {
      const prepare = avant ? await avant() : true;
      if (prepare === false) return;
      const job = await create(target, {
        ...full,
        ...(typeof prepare === 'object' ? prepare : {}),
        ...(confirmed !== undefined ? { confirmedCost: confirmed } : {}),
      });
      onCreated(job);
    } catch (error) {
      toast((error as Error).message, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const blocking = quote?.mismatches.find((m) => m.severity === 'blocking');
  const ready = !disabled && !busy && quote !== null && quote.available && !blocking;

  return (
    <div
      className={`flex flex-col gap-1.5 ${compact ? '' : 'rounded-lg border border-border bg-surface/60 p-2'}`}
    >
      {simple ? (
        <>
          <button
            type="button"
            disabled={!ready}
            onClick={() => (quote?.paid ? setConfirming(true) : void submit())}
            className="flex w-full items-center justify-between gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white shadow-card hover:opacity-90 disabled:opacity-40"
          >
            <span className="flex items-center gap-1.5">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {busy && occupe ? occupe : label}
            </span>
            {quote?.available && (
              <small className="text-xs font-medium opacity-85">
                {quote.paid ? `${quote.amount.toLocaleString('fr-FR')} crédits` : 'gratuit'}
              </small>
            )}
          </button>
          <details className="text-[11px] text-faint">
            <summary className="cursor-pointer select-none hover:text-muted">
              Moteur : {selected?.label ?? '—'}
            </summary>
            <div className="mt-1.5 flex">
              <select
                aria-label={`Modèle — ${label}`}
                value={selected?.key ?? ''}
                onChange={(event) => setChoice(event.target.value)}
                className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-1.5 text-xs"
              >
                {models.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                    {m.available ? '' : ' (indisponible)'}
                  </option>
                ))}
              </select>
            </div>
          </details>
        </>
      ) : (
        <div className="flex items-center gap-1.5">
          <select
            aria-label={`Modèle — ${label}`}
            value={selected?.key ?? ''}
            onChange={(event) => setChoice(event.target.value)}
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-1.5 text-xs"
          >
            {models.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
                {m.available ? '' : ' (indisponible)'}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!ready}
            onClick={() => (quote?.paid ? setConfirming(true) : void submit())}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-gradient-to-r from-accent to-ai px-3 text-xs font-medium text-white shadow-card hover:opacity-90 disabled:opacity-35"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {label}
          </button>
        </div>
      )}
      <p
        data-testid="studio-cost"
        className={`text-[11px] ${problem || blocking || (quote && !quote.available) ? 'text-warn' : quote?.paid ? 'text-warn' : 'text-faint'}`}
      >
        {problem ??
          blocking?.message ??
          (quote && !quote.available
            ? quote.reason
            : quote
              ? quote.paid
                ? `${quote.amount.toLocaleString('fr-FR')} ${quote.unit} — ${quote.basis}`
                : quote.basis
              : 'Estimation…')}
      </p>
      {confirming && quote && (
        <div
          role="alertdialog"
          aria-label="Confirmer la dépense"
          className="animate-pop-in rounded-lg border border-warn/60 bg-warn/10 p-2 text-xs"
        >
          <p className="flex items-center gap-1.5 font-medium">
            <CircleAlert size={13} className="text-warn" />
            Génération payante : {quote.amount.toLocaleString('fr-FR')} {quote.unit}
          </p>
          <p className="mt-0.5 text-muted">{quote.basis}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="rounded-md bg-warn px-2.5 py-1 font-medium text-black"
              onClick={() => {
                setConfirming(false);
                void submit(quote.amount);
              }}
            >
              Confirmer {quote.amount.toLocaleString('fr-FR')} {quote.unit}
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-2.5 py-1"
              onClick={() => setConfirming(false)}
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function JobProgress({ job }: { job: GenerationJob }) {
  if (job.status === 'failed')
    return <p className="text-xs text-error">{job.errorDetails ?? job.message}</p>;
  if (job.status === 'completed' || job.status === 'cancelled') return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="h-1 overflow-hidden rounded bg-border">
        <div
          className="h-full bg-gradient-to-r from-accent to-ai transition-[width]"
          style={{ width: `${Math.max(4, job.progress * 100)}%` }}
        />
      </div>
      <p className="flex items-center gap-1.5 text-[11px] text-faint">
        <Loader2 size={11} className="animate-spin" /> {job.message}
      </p>
    </div>
  );
}
