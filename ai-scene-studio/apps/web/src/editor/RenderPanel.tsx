'use client';

import type { RenderJob, RenderPass } from '@ass/api-client';
import { isDirty } from '@ass/editor-ui';
import { updateRenderSettings } from '@ass/scene-engine';
import { useCallback, useEffect, useState } from 'react';
import { api, call } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { useEditor, useEditorContext } from './context';
import { NumberField } from './fields';

const PASSES: { value: RenderPass; label: string }[] = [
  { value: 'alpha', label: 'Alpha' },
  { value: 'depth', label: 'Profondeur (Z)' },
  { value: 'normal', label: 'Normales' },
  { value: 'object_id', label: 'Object ID' },
  { value: 'cryptomatte', label: 'Cryptomatte' },
  { value: 'motion_vector', label: 'Vecteurs de mouvement' },
];

const STATUS: Record<RenderJob['status'], string> = {
  queued: 'En file',
  preparing: 'Préparation',
  running: 'Rendu Blender',
  processing: 'Encodage',
  completed: 'Terminé',
  failed: 'Échec',
  cancelled: 'Annulé',
};

const OUTPUTS: { key: string; label: string }[] = [
  { key: 'video', label: 'Vidéo H.264' },
  { key: 'alphaVideo', label: 'ProRes 4444 (alpha)' },
  { key: 'passes', label: 'Passes OpenEXR (.zip)' },
  { key: 'blend', label: 'Scène Blender (.blend)' },
  { key: 'preview', label: 'Aperçu PNG' },
];

const small =
  'rounded border border-border px-2 py-0.5 text-xs hover:border-accent disabled:opacity-40';
const content = (id: string) => `${API_URL}/assets/${id}/content`;

export function RenderPanel({
  shotId,
  onSave,
}: {
  shotId: string;
  onSave: () => Promise<boolean>;
}) {
  const { store, canEdit } = useEditorContext();
  const settings = useEditor((state) => state.scene.renderSettings);
  const duration = useEditor((state) => state.scene.durationFrames);
  const hasCamera = useEditor((state) => state.scene.activeCameraId !== null);
  const dirty = useEditor(isDirty);
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [range, setRange] = useState({ start: settings.frameStart, end: settings.frameEnd });
  const [percent, setPercent] = useState(50);
  const [samples, setSamples] = useState(settings.samples);
  const [passes, setPasses] = useState<RenderPass[]>([
    'alpha',
    'depth',
    'normal',
    'object_id',
    'cryptomatte',
  ]);
  const [error, setError] = useState<string | null>(null);
  const apply = (patch: Parameters<typeof updateRenderSettings>[1]) =>
    store.getState().apply((s) => updateRenderSettings(s, patch));

  const refresh = useCallback(() => {
    call(api.GET('/shots/{shot_id}/renders', { params: { path: { shot_id: shotId } } }))
      .then(setJobs)
      .catch((reason: Error) => setError(reason.message));
  }, [shotId]);

  useEffect(refresh, [refresh]);
  const active = jobs.some((job) => !['completed', 'failed', 'cancelled'].includes(job.status));
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(refresh, 1500);
    return () => clearInterval(timer);
  }, [active, refresh]);

  const launch = async () => {
    setError(null);
    // Le rendu porte sur une révision enregistrée : on enregistre d'abord les modifications.
    if (dirty && !(await onSave())) return;
    call(
      api.POST('/shots/{shot_id}/renders', {
        params: { path: { shot_id: shotId } },
        body: {
          frameStart: range.start,
          frameEnd: range.end,
          resolutionPercent: percent,
          samples,
          passes: ['beauty', ...passes],
        },
      }),
    )
      .then(refresh)
      .catch((reason: Error) => setError(reason.message));
  };

  return (
    <section aria-label="Rendu Blender" className="flex flex-col gap-4 text-sm">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Rendu final (Blender)
        </h2>
        <p className="mt-1 text-xs text-muted">
          Rendu Cycles par Blender 4.5 LTS hors du navigateur, à partir de la dernière révision
          enregistrée. Chaque rendu fournit aussi la scène au format .blend, à ouvrir dans Blender.
        </p>
      </div>

      {canEdit && (
        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="mb-1 text-xs font-semibold text-muted">Réglages de la scène</legend>
          <NumberField
            label="Largeur (px)"
            value={settings.width}
            min={16}
            step={1}
            onCommit={(width) => apply({ width })}
          />
          <NumberField
            label="Hauteur (px)"
            value={settings.height}
            min={16}
            step={1}
            onCommit={(height) => apply({ height })}
          />
          <label className="col-span-2 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={settings.transparentBackground}
              onChange={(e) => apply({ transparentBackground: e.target.checked })}
            />
            Fond transparent (ProRes 4444 avec alpha)
          </label>
          <label className="col-span-2 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={settings.motionBlur}
              onChange={(e) => apply({ motionBlur: e.target.checked })}
            />
            Flou de mouvement
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-xs">
            <span className="text-muted">Transformation d’affichage</span>
            <select
              value={settings.colorManagement.displayTransform}
              onChange={(e) =>
                apply({
                  colorManagement: {
                    ...settings.colorManagement,
                    displayTransform: e.target
                      .value as typeof settings.colorManagement.displayTransform,
                  },
                })
              }
              className="rounded border border-border bg-surface px-2 py-1 text-sm"
            >
              <option value="srgb">Standard (sRGB)</option>
              <option value="agx">AgX</option>
              <option value="filmic">Filmic</option>
              <option value="rec709">Standard (Rec. 709)</option>
            </select>
          </label>
        </fieldset>
      )}

      {canEdit && (
        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="mb-1 text-xs font-semibold text-muted">Ce rendu</legend>
          <NumberField
            label="Frame de début"
            value={range.start}
            min={0}
            step={1}
            onCommit={(start) => setRange({ ...range, start })}
          />
          <NumberField
            label="Frame de fin"
            value={range.end}
            min={0}
            step={1}
            onCommit={(end) => setRange({ ...range, end: Math.min(end, duration - 1) })}
          />
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted">Résolution</span>
            <select
              value={percent}
              onChange={(e) => setPercent(Number(e.target.value))}
              className="rounded border border-border bg-surface px-2 py-1 text-sm"
            >
              {[100, 50, 25, 10].map((value) => (
                <option key={value} value={value}>
                  {value} % · {Math.round((settings.width * value) / 100)}×
                  {Math.round((settings.height * value) / 100)}
                </option>
              ))}
            </select>
          </label>
          <NumberField
            label="Échantillons"
            value={samples}
            min={1}
            step={8}
            onCommit={setSamples}
          />
          <div className="col-span-2 flex flex-wrap gap-x-3 gap-y-1">
            {PASSES.map((pass) => (
              <label key={pass.value} className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={passes.includes(pass.value)}
                  onChange={(e) =>
                    setPasses(
                      e.target.checked
                        ? [...passes, pass.value]
                        : passes.filter((p) => p !== pass.value),
                    )
                  }
                />
                {pass.label}
              </label>
            ))}
          </div>
          <button
            type="button"
            className="col-span-2 rounded bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-50"
            disabled={!hasCamera}
            onClick={() => void launch()}
            title={hasCamera ? undefined : 'Choisissez une caméra active'}
          >
            {dirty ? 'Enregistrer et lancer le rendu' : 'Lancer le rendu'}
          </button>
          {!hasCamera && (
            <p className="col-span-2 text-xs text-warn">
              Aucune caméra active : choisissez-en une.
            </p>
          )}
        </fieldset>
      )}
      {error && (
        <p role="alert" className="text-xs text-error">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-muted">Rendus du plan</h3>
        {jobs.length === 0 && <p className="text-xs text-muted">Aucun rendu pour l’instant.</p>}
        {jobs.map((job) => (
          <article
            key={job.id}
            aria-label={`Rendu ${STATUS[job.status]}`}
            className="rounded border border-border p-2 text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">
                {STATUS[job.status]} · frames {String(job.settings['frameStart'])}–
                {String(job.settings['frameEnd'])}
              </span>
              {canEdit && !['completed', 'failed', 'cancelled'].includes(job.status) && (
                <button
                  type="button"
                  className={small}
                  onClick={() =>
                    void call(
                      api.POST('/render-jobs/{job_id}/cancel', {
                        params: { path: { job_id: job.id } },
                      }),
                    )
                      .then(refresh)
                      .catch((reason: Error) => setError(reason.message))
                  }
                >
                  Annuler
                </button>
              )}
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded bg-border">
              <div
                className="h-full bg-accent"
                style={{ width: `${Math.round(job.progress * 100)}%` }}
              />
            </div>
            <p className={`mt-1 ${job.status === 'failed' ? 'text-error' : 'text-muted'}`}>
              {job.message}
            </p>
            {job.status === 'completed' && typeof job.outputs['video'] === 'string' && (
              <video
                controls
                loop
                crossOrigin="use-credentials"
                src={content(job.outputs['video'])}
                className="mt-2 w-full rounded"
                aria-label="Vidéo du rendu"
              />
            )}
            {job.status === 'completed' && (
              <ul className="mt-2 flex flex-wrap gap-2">
                {OUTPUTS.filter((output) => typeof job.outputs[output.key] === 'string').map(
                  (output) => (
                    <li key={output.key}>
                      <a
                        className="text-accent hover:underline"
                        href={content(String(job.outputs[output.key]))}
                        download
                      >
                        {output.label}
                      </a>
                    </li>
                  ),
                )}
              </ul>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
