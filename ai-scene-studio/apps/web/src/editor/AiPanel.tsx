'use client';

import type {
  AiModel,
  AiProvider,
  GenerationEstimate,
  GenerationInput,
  GenerationJob,
  GenerationMode,
} from '@ass/api-client';
import { isDirty } from '@ass/editor-ui';
import {
  Ban,
  Check,
  CircleAlert,
  Clapperboard,
  ImagePlus,
  Info,
  Loader2,
  MessageSquareText,
  Paperclip,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { api, call } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { toast } from '@/lib/toast';
import { applyAiOperations, describeOperation, type AiOperation } from './aiOperations';
import { useEditor, useEditorContext } from './context';

const MODES: Record<GenerationMode, { label: string; hint: string }> = {
  text_to_image: { label: 'Image', hint: 'Une image à partir du prompt' },
  image_to_image: { label: 'Image → image', hint: 'Transforme une image de départ' },
  text_to_video: { label: 'Vidéo', hint: 'Une vidéo à partir du prompt' },
  image_to_video: { label: 'Image → vidéo', hint: 'Anime une image de départ' },
  prompt_from_scene: { label: 'Prompt du plan', hint: 'Claude rédige le prompt depuis la caméra' },
  scene_from_text: { label: 'Assistant de scène', hint: 'Claude propose des modifications' },
  image_analysis: { label: 'Critique du rendu', hint: 'Claude analyse l’image de la caméra' },
};
const TEXT_MODES = new Set<GenerationMode>([
  'prompt_from_scene',
  'scene_from_text',
  'image_analysis',
]);
const VIDEO_MODES = new Set<GenerationMode>(['text_to_video', 'image_to_video']);
const KIND_LABEL: Record<AiProvider['kind'], string> = {
  official: 'API officielle',
  subscription: 'Abonnement',
  bridge: 'Passerelle',
  simulation: 'Simulation',
};
const STATUS: Record<GenerationJob['status'], string> = {
  queued: 'En file',
  preparing: 'Préparation',
  running: 'Génération',
  processing: 'Publication',
  completed: 'Terminé',
  failed: 'Échec',
  cancelled: 'Annulé',
};
const DONE = new Set(['completed', 'failed', 'cancelled']);
const content = (id: string) => `${API_URL}/assets/${id}/content`;

const chip = (on: boolean) =>
  `rounded-md border px-2 py-1 text-xs transition-colors ${on ? 'border-ai/70 bg-ai/15 text-text' : 'border-border bg-surface text-muted hover:border-border-strong hover:text-text'} disabled:opacity-40`;

interface ResultAsset {
  assetId: string;
  kind: string;
}
type PromptResult = { prompt: string; negativePrompt: string; camera: string; notes: string };
type SceneResult = { summary: string; operations: AiOperation[] };
type AnalysisResult = {
  summary: string;
  strengths: string[];
  issues: string[];
  suggestions: string[];
};

function costLabel(estimate: GenerationEstimate): string {
  if (!estimate.paid) return estimate.basis;
  return `${estimate.amount.toLocaleString('fr-FR')} ${estimate.unit} — ${estimate.basis}`;
}

export function AiPanel({ shotId, onSave }: { shotId: string; onSave: () => Promise<boolean> }) {
  const { store, canEdit } = useEditorContext();
  const frame = useEditor((state) => state.frame);
  const duration = useEditor((state) => state.scene.durationFrames);
  const hasCamera = useEditor((state) => state.scene.activeCameraId !== null);
  const dirty = useEditor(isDirty);

  const [providers, setProviders] = useState<AiProvider[] | null>(null);
  const [selection, setSelection] = useState<{ provider: string; model: string } | null>(null);
  const [mode, setMode] = useState<GenerationMode>('text_to_image');
  const [prompt, setPrompt] = useState('');
  const [negative, setNegative] = useState('');
  const [useCamera, setUseCamera] = useState(true);
  const [endFrame, setEndFrame] = useState<number | null>(null);
  const [aspect, setAspect] = useState<string | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  const [references, setReferences] = useState<string[]>([]);
  const [estimate, setEstimate] = useState<GenerationEstimate | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<GenerationEstimate | null>(null);
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const announced = useRef(new Set<string>());

  // Fournisseurs et disponibilité des workers (rafraîchie régulièrement).
  useEffect(() => {
    let alive = true;
    const load = () =>
      call(api.GET('/ai/providers'))
        .then((list) => alive && setProviders(list))
        .catch(() => alive && setProviders([]));
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const provider = providers?.find((p) => p.id === selection?.provider) ?? null;
  const model: AiModel | null = provider?.models.find((m) => m.model === selection?.model) ?? null;

  // Sélection par défaut : premier fournisseur disponible.
  useEffect(() => {
    if (!providers || selection) return;
    const first = providers.find((p) => p.available) ?? providers[0];
    const firstModel = first?.models[0];
    if (first && firstModel) {
      setSelection({ provider: first.id, model: firstModel.model });
      setMode(firstModel.modes[0] as GenerationMode);
    }
  }, [providers, selection]);

  const choose = (next: AiProvider, nextModel: AiModel) => {
    setSelection({ provider: next.id, model: nextModel.model });
    if (!nextModel.modes.includes(mode)) setMode(nextModel.modes[0] as GenerationMode);
    if (aspect && !nextModel.aspectRatios.includes(aspect)) setAspect(null);
    if (seconds && !nextModel.durationsSeconds.includes(seconds)) setSeconds(null);
  };

  const textMode = TEXT_MODES.has(mode);
  const videoMode = VIDEO_MODES.has(mode);
  const cameraFrames = useMemo(() => {
    if (!useCamera && mode !== 'image_analysis') return [];
    if (!hasCamera) return [];
    return endFrame !== null && videoMode && endFrame !== frame ? [frame, endFrame] : [frame];
  }, [useCamera, mode, hasCamera, endFrame, videoMode, frame]);

  const body = useMemo((): GenerationInput | null => {
    if (!selection) return null;
    return {
      provider: selection.provider,
      model: selection.model,
      mode,
      prompt,
      negativePrompt: negative,
      sceneFrames: cameraFrames,
      referenceAssetIds: references,
      aspectRatio: aspect,
      durationSeconds: videoMode ? seconds : null,
    };
  }, [selection, mode, prompt, negative, cameraFrames, references, aspect, seconds, videoMode]);

  // Estimation par le serveur à chaque changement (coût exact et contraintes non respectées).
  useEffect(() => {
    if (!body || !canEdit) return;
    let alive = true;
    const timer = setTimeout(() => {
      call(
        api.POST('/shots/{shot_id}/generations/estimate', {
          params: { path: { shot_id: shotId } },
          body,
        }),
      )
        .then((value) => {
          if (!alive) return;
          setEstimate(value);
          setEstimateError(null);
        })
        .catch((error: Error) => {
          if (!alive) return;
          setEstimate(null);
          setEstimateError(error.message);
        });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [body, shotId, canEdit]);

  const refresh = useCallback(() => {
    call(api.GET('/shots/{shot_id}/generations', { params: { path: { shot_id: shotId } } }))
      .then(setJobs)
      .catch(() => undefined);
  }, [shotId]);
  useEffect(refresh, [refresh]);
  const active = jobs.some((job) => !DONE.has(job.status));
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(refresh, 1500);
    return () => clearInterval(timer);
  }, [active, refresh]);

  // Notifie la fin des générations lancées depuis cette page.
  useEffect(() => {
    for (const job of jobs) {
      if (!announced.current.has(job.id) || !DONE.has(job.status)) continue;
      announced.current.delete(job.id);
      if (job.status === 'completed')
        toast(`Génération terminée : ${MODES[job.mode as GenerationMode]?.label ?? job.mode}`, {
          kind: 'ai',
        });
      else if (job.status === 'failed')
        toast(`Génération en échec : ${job.errorDetails ?? job.message}`, { kind: 'error' });
    }
  }, [jobs]);

  const submit = async (payload: GenerationInput, confirmed?: number) => {
    setBusy(true);
    try {
      // La génération porte sur une révision enregistrée.
      if (dirty && !(await onSave())) return;
      const job = await call(
        api.POST('/shots/{shot_id}/generations', {
          params: { path: { shot_id: shotId } },
          body: { ...payload, ...(confirmed !== undefined ? { confirmedCost: confirmed } : {}) },
          headers: { 'Idempotency-Key': crypto.randomUUID() },
        }),
      );
      announced.current.add(job.id);
      setJobs((list) => [job, ...list.filter((j) => j.id !== job.id)]);
    } catch (error) {
      toast((error as Error).message, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const launch = () => {
    if (!body || !estimate) return;
    // Aucune dépense sans confirmation du montant exact par l'utilisateur.
    if (estimate.paid) setConfirming(estimate);
    else void submit(body);
  };

  /** Claude rédige le prompt du plan depuis la caméra active (intention = prompt actuel). */
  const claude = providers?.find((p) => p.id === 'claude');
  const draftWithClaude = () => {
    if (!claude) return;
    void submit({
      provider: 'claude',
      model: claude.models[0]?.model ?? 'sonnet',
      mode: 'prompt_from_scene',
      prompt,
      sceneFrames: hasCamera ? [frame] : [],
    });
  };

  const applyOperations = (job: GenerationJob, result: SceneResult) => {
    let outcome: ReturnType<typeof applyAiOperations> | null = null;
    const ok = store.getState().apply((scene) => {
      outcome = applyAiOperations(scene, result.operations, store.getState().frame);
      return outcome.scene;
    });
    const done = outcome as ReturnType<typeof applyAiOperations> | null;
    if (!ok || !done) return;
    setApplied((set) => new Set(set).add(job.id));
    const after = store.getState().scene;
    toast(
      done.skipped.length === 0
        ? `${done.applied} opération(s) appliquée(s)`
        : `${done.applied} appliquée(s), ${done.skipped.length} ignorée(s) : ${done.skipped.map((s) => s.reason).join(' ; ')}`,
      {
        kind: done.skipped.length ? 'info' : 'success',
        action: {
          label: 'Annuler',
          run: () => {
            if (store.getState().scene === after) store.getState().undo();
          },
        },
      },
    );
  };

  const requiresPrompt = mode === 'scene_from_text' || (!textMode && prompt.trim() === '');
  const blocking = estimate?.mismatches.some((m) => m.severity === 'blocking') ?? false;
  const canLaunch =
    canEdit &&
    !busy &&
    estimate !== null &&
    estimate.available &&
    !blocking &&
    !(requiresPrompt && prompt.trim() === '') &&
    !(mode === 'image_analysis' && !hasCamera);

  if (providers === null) return <p className="text-xs text-muted">Chargement des moteurs IA…</p>;

  return (
    <section aria-label="Génération IA" className="flex flex-col gap-4 text-sm">
      <div className="flex items-start gap-2">
        <Sparkles size={16} className="mt-0.5 text-ai" />
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Génération IA
          </h2>
          <p className="mt-1 text-xs text-muted">
            La caméra active cadre la génération : Blender rend l’image, la profondeur et les
            normales de la frame courante, transmises au modèle selon ce qu’il sait exploiter.
          </p>
        </div>
      </div>

      <div role="radiogroup" aria-label="Moteur IA" className="flex flex-col gap-1.5">
        {providers.map((item) => (
          <div
            key={item.id}
            className={`rounded-lg border p-2 ${item.id === provider?.id ? 'border-ai/60 bg-ai/5' : 'border-border'}`}
          >
            <div className="flex items-center gap-2 text-xs">
              <span
                aria-hidden
                className={`h-2 w-2 rounded-full ${item.available ? 'bg-ok' : 'bg-faint'}`}
              />
              <span className="font-medium">{item.label}</span>
              <span className="ml-auto rounded bg-surface px-1.5 py-px text-[10px] text-faint">
                {KIND_LABEL[item.kind]}
              </span>
            </div>
            {!item.available && <p className="mt-1 text-[11px] text-faint">{item.reason}</p>}
            <div className="mt-1.5 flex flex-wrap gap-1">
              {item.models.map((m) => (
                <button
                  key={m.model}
                  type="button"
                  role="radio"
                  aria-checked={item.id === provider?.id && m.model === model?.model}
                  className={chip(item.id === provider?.id && m.model === model?.model)}
                  title={m.notes}
                  onClick={() => choose(item, m)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {model && (
        <>
          <div role="radiogroup" aria-label="Type de génération" className="flex flex-wrap gap-1">
            {model.modes.map((value) => {
              const item = MODES[value as GenerationMode];
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  className={chip(mode === value)}
                  title={item?.hint}
                  onClick={() => setMode(value as GenerationMode)}
                >
                  {item?.label ?? value}
                </button>
              );
            })}
          </div>

          <label className="flex flex-col gap-1 text-xs">
            <span className="flex items-center justify-between text-muted">
              {mode === 'scene_from_text'
                ? 'Consigne'
                : mode === 'image_analysis'
                  ? 'Question (facultative)'
                  : mode === 'prompt_from_scene'
                    ? 'Intention (facultative)'
                    : 'Prompt'}
              {!textMode && claude?.available && (
                <button
                  type="button"
                  className="flex items-center gap-1 text-ai hover:text-text disabled:opacity-40"
                  disabled={!canEdit || busy}
                  onClick={draftWithClaude}
                  title="Claude rédige le prompt à partir de la caméra active et de votre intention"
                >
                  <Wand2 size={12} /> Rédiger avec Claude
                </button>
              )}
            </span>
            <textarea
              value={prompt}
              maxLength={4000}
              rows={4}
              disabled={!canEdit}
              placeholder={
                mode === 'scene_from_text'
                  ? 'Ex. : ajoute une sphère rouge à gauche du cube et une lumière chaude au-dessus'
                  : 'Décrivez le plan : sujet, ambiance, lumière, style…'
              }
              onChange={(event) => setPrompt(event.target.value)}
              className="resize-y rounded-md border border-border bg-surface px-2 py-1.5 text-sm placeholder:text-faint focus:border-ai focus:outline-none"
            />
          </label>
          {!textMode && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted hover:text-text">
                Prompt négatif
              </summary>
              <textarea
                value={negative}
                maxLength={2000}
                rows={2}
                disabled={!canEdit}
                aria-label="Prompt négatif"
                onChange={(event) => setNegative(event.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm focus:border-ai focus:outline-none"
              />
            </details>
          )}

          <fieldset className="flex flex-col gap-2 text-xs">
            <legend className="sr-only">Cadrage</legend>
            {mode !== 'scene_from_text' && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={(useCamera || mode === 'image_analysis') && hasCamera}
                  disabled={!hasCamera || mode === 'image_analysis'}
                  onChange={(event) => setUseCamera(event.target.checked)}
                />
                <Clapperboard size={13} className="text-muted" />
                {hasCamera
                  ? `Cadrer avec la caméra active (frame ${frame})`
                  : 'Aucune caméra active : ajoutez-en une pour cadrer'}
              </label>
            )}
            {videoMode && useCamera && hasCamera && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={endFrame !== null}
                  onChange={(event) => setEndFrame(event.target.checked ? duration - 1 : null)}
                />
                Image de fin à la frame
                <input
                  type="number"
                  aria-label="Frame de l’image de fin"
                  min={0}
                  max={duration - 1}
                  disabled={endFrame === null}
                  value={endFrame ?? duration - 1}
                  onChange={(event) =>
                    setEndFrame(Math.min(duration - 1, Math.max(0, Number(event.target.value))))
                  }
                  className="h-6 w-16 rounded-md border border-border bg-surface px-1 font-mono disabled:opacity-40"
                />
              </label>
            )}
            {!textMode && model.aspectRatios.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="mr-1 text-muted">Format</span>
                {model.aspectRatios.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={chip((aspect ?? model.aspectRatios[0]) === value)}
                    onClick={() => setAspect(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            )}
            {videoMode && model.durationsSeconds.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="mr-1 text-muted">Durée</span>
                {model.durationsSeconds.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={chip((seconds ?? model.durationsSeconds[0]) === value)}
                    onClick={() => setSeconds(value)}
                  >
                    {value} s
                  </button>
                ))}
              </div>
            )}
          </fieldset>

          {references.length > 0 && (
            <div className="flex flex-wrap gap-1.5" aria-label="Références">
              {references.map((id) => (
                <span key={id} className="relative">
                  <img
                    src={content(id)}
                    alt="Référence"
                    className="h-12 w-12 rounded-md border border-border object-cover"
                  />
                  <button
                    type="button"
                    aria-label="Retirer la référence"
                    className="absolute -right-1 -top-1 rounded-full bg-elevated p-0.5 text-muted shadow-pop hover:text-text"
                    onClick={() => setReferences((list) => list.filter((r) => r !== id))}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div
            className="rounded-lg border border-border bg-surface/60 p-2 text-xs"
            aria-live="polite"
          >
            {estimateError ? (
              <p className="flex items-start gap-1.5 text-warn">
                <CircleAlert size={13} className="mt-px shrink-0" /> {estimateError}
              </p>
            ) : estimate ? (
              <>
                <p
                  className={`flex items-center gap-1.5 ${estimate.paid ? 'text-warn' : 'text-muted'}`}
                >
                  {estimate.paid ? <CircleAlert size={13} /> : <Info size={13} />}
                  <span data-testid="ai-cost">{costLabel(estimate)}</span>
                </p>
                {!estimate.available && <p className="mt-1 text-error">{estimate.reason}</p>}
                {estimate.mismatches.map((m) => (
                  <p
                    key={m.field}
                    className={`mt-1 ${m.severity === 'blocking' ? 'text-error' : 'text-faint'}`}
                  >
                    {m.message}
                  </p>
                ))}
              </>
            ) : (
              <p className="flex items-center gap-1.5 text-faint">
                <Loader2 size={13} className="animate-spin" /> Estimation…
              </p>
            )}
          </div>

          {canEdit && (
            <button
              type="button"
              disabled={!canLaunch}
              onClick={launch}
              className="flex h-9 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-accent to-ai text-sm font-medium text-white shadow-card transition-opacity hover:opacity-90 disabled:opacity-35"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {mode === 'prompt_from_scene'
                ? 'Rédiger le prompt'
                : mode === 'scene_from_text'
                  ? 'Proposer les modifications'
                  : mode === 'image_analysis'
                    ? 'Analyser'
                    : 'Générer'}
            </button>
          )}
        </>
      )}

      {confirming && body && (
        <div
          role="alertdialog"
          aria-label="Confirmer la dépense"
          className="animate-pop-in rounded-lg border border-warn/60 bg-warn/10 p-3 text-xs"
        >
          <p className="font-medium text-text">
            Cette génération est payante : {confirming.amount.toLocaleString('fr-FR')}{' '}
            {confirming.unit}.
          </p>
          <p className="mt-1 text-muted">{confirming.basis}</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="rounded-md bg-warn px-3 py-1 font-medium text-black"
              onClick={() => {
                const amount = confirming.amount;
                setConfirming(null);
                void submit(body, amount);
              }}
            >
              Confirmer {confirming.amount.toLocaleString('fr-FR')} {confirming.unit}
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1"
              onClick={() => setConfirming(null)}
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-faint">
          Historique du plan
        </h3>
        {jobs.length === 0 ? (
          <EmptyState icon={<ImagePlus size={20} />} title="Aucune génération">
            Les images, vidéos et propositions de Claude de ce plan apparaîtront ici.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Générations">
            {jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                canEdit={canEdit}
                applied={applied.has(job.id)}
                onUsePrompt={(result) => {
                  setPrompt(result.prompt);
                  setNegative(result.negativePrompt);
                  toast('Prompt repris dans le champ', { kind: 'ai' });
                }}
                onReference={(id) => {
                  setReferences((list) => (list.includes(id) ? list : [...list, id].slice(-8)));
                  toast('Image ajoutée aux références', { kind: 'ai' });
                }}
                onApply={(result) => applyOperations(job, result)}
                onCancel={() =>
                  call(
                    api.POST('/generation-jobs/{job_id}/cancel', {
                      params: { path: { job_id: job.id } },
                    }),
                  )
                    .then(refresh)
                    .catch((error: Error) => toast(error.message, { kind: 'error' }))
                }
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function JobCard({
  job,
  canEdit,
  applied,
  onUsePrompt,
  onReference,
  onApply,
  onCancel,
}: {
  job: GenerationJob;
  canEdit: boolean;
  applied: boolean;
  onUsePrompt: (result: PromptResult) => void;
  onReference: (assetId: string) => void;
  onApply: (result: SceneResult) => void;
  onCancel: () => void;
}) {
  const running = !DONE.has(job.status);
  const assets = ((job.outputs['assets'] as ResultAsset[] | undefined) ?? []).filter(
    (a) => a.kind === 'image' || a.kind === 'video',
  );
  const result = job.outputs['result'] as Record<string, unknown> | undefined;
  const label = MODES[job.mode as GenerationMode]?.label ?? job.mode;
  const prompt = typeof job.request['prompt'] === 'string' ? job.request['prompt'] : '';

  return (
    <li
      data-testid="generation"
      className="rounded-lg border border-border bg-surface/50 p-2 text-xs"
      aria-label={`${label} — ${STATUS[job.status]}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`rounded px-1.5 py-px text-[10px] font-medium ${job.status === 'completed' ? 'bg-ok/15 text-ok' : job.status === 'failed' ? 'bg-error/15 text-error' : job.status === 'cancelled' ? 'bg-border text-muted' : 'bg-ai/15 text-ai'}`}
        >
          {STATUS[job.status]}
        </span>
        <span className="font-medium">{label}</span>
        <span className="truncate text-faint">
          {job.provider} · {job.modelId}
        </span>
        {running && canEdit && (
          <button
            type="button"
            aria-label="Annuler la génération"
            className="ml-auto text-faint hover:text-error"
            onClick={onCancel}
          >
            <Ban size={13} />
          </button>
        )}
      </div>
      {prompt && <p className="mt-1 line-clamp-2 text-muted">{prompt}</p>}
      {running && (
        <div className="mt-2">
          <div className="h-1 overflow-hidden rounded bg-border">
            <div
              className="h-full bg-gradient-to-r from-accent to-ai transition-[width]"
              style={{ width: `${Math.max(4, job.progress * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-faint">{job.message}</p>
        </div>
      )}
      {job.status === 'failed' && (
        <p className="mt-1 text-error">{job.errorDetails ?? job.message}</p>
      )}
      {assets.length > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {assets.map((asset) => (
            <figure key={asset.assetId} className="group relative overflow-hidden rounded-md">
              {asset.kind === 'video' ? (
                <video
                  src={content(asset.assetId)}
                  controls
                  loop
                  muted
                  className="aspect-video w-full bg-black object-cover"
                />
              ) : (
                <img
                  src={content(asset.assetId)}
                  alt={`Résultat ${label}`}
                  className="aspect-video w-full bg-black object-cover"
                />
              )}
              {asset.kind === 'image' && canEdit && (
                <button
                  type="button"
                  className="absolute bottom-1 right-1 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                  onClick={() => onReference(asset.assetId)}
                >
                  <Paperclip size={10} /> Référence
                </button>
              )}
            </figure>
          ))}
        </div>
      )}
      {result && job.mode === 'prompt_from_scene' && typeof result['prompt'] === 'string' && (
        <div className="mt-2 flex flex-col gap-1">
          <p className="rounded-md bg-panel p-2 font-mono text-[11px] leading-relaxed text-text/90">
            {result['prompt']}
          </p>
          {typeof result['notes'] === 'string' && (
            <p className="flex gap-1.5 text-muted">
              <MessageSquareText size={12} className="mt-px shrink-0" />
              {result['notes']}
            </p>
          )}
          {canEdit && (
            <button
              type="button"
              className="self-start rounded-md border border-ai/50 px-2 py-0.5 text-ai hover:bg-ai/10"
              onClick={() => onUsePrompt(result as unknown as PromptResult)}
            >
              Utiliser ce prompt
            </button>
          )}
        </div>
      )}
      {result && job.mode === 'scene_from_text' && Array.isArray(result['operations']) && (
        <div className="mt-2 flex flex-col gap-1">
          <p className="text-text/90">{String(result['summary'] ?? '')}</p>
          <ol className="list-decimal pl-4 text-muted">
            {(result['operations'] as AiOperation[]).map((op, index) => (
              <li key={index}>{describeOperation(op)}</li>
            ))}
          </ol>
          {canEdit && (
            <button
              type="button"
              disabled={applied}
              className="flex items-center gap-1 self-start rounded-md border border-ai/50 px-2 py-0.5 text-ai hover:bg-ai/10 disabled:opacity-50"
              onClick={() => onApply(result as unknown as SceneResult)}
            >
              {applied ? <Check size={12} /> : <Wand2 size={12} />}
              {applied ? 'Appliqué' : 'Appliquer à la scène'}
            </button>
          )}
        </div>
      )}
      {result && job.mode === 'image_analysis' && typeof result['summary'] === 'string' && (
        <Analysis result={result as unknown as AnalysisResult} />
      )}
      {job.status === 'completed' && job.actualCost !== null && job.actualCost > 0 && (
        <p className="mt-1 text-faint">
          Coût : {job.actualCost.toLocaleString('fr-FR')} {job.costUnit}
        </p>
      )}
    </li>
  );
}

function Analysis({ result }: { result: AnalysisResult }) {
  const block = (title: string, items: string[], tone: string) =>
    items.length > 0 && (
      <div>
        <p className={`font-medium ${tone}`}>{title}</p>
        <ul className="list-disc pl-4 text-muted">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <p className="text-text/90">{result.summary}</p>
      {block('Points forts', result.strengths, 'text-ok')}
      {block('Problèmes', result.issues, 'text-warn')}
      {block('Suggestions', result.suggestions, 'text-ai')}
    </div>
  );
}
