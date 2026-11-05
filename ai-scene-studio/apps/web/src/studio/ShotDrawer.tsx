'use client';

import type {
  AiProvider,
  BibleEntry,
  GenerationJob,
  ShotApproach,
  ShotStatus,
  ShotVersion,
  StoryboardShot,
} from '@ass/api-client';
import {
  Box,
  Check,
  Columns2,
  CornerDownRight,
  ExternalLink,
  Film,
  Image as ImageIcon,
  Wand2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, call } from '@/lib/api';
import { toast } from '@/lib/toast';
import { APPROACH_LABELS, assetUrl, BIBLE_LABELS, STATUS_LABELS, useJobs } from './data';
import { GenerateControl, JobProgress } from './Generate';

type Patch = Partial<{
  name: string;
  description: string;
  intention: string;
  dialogue: string;
  shotSize: string;
  camera: string;
  approach: ShotApproach;
  status: ShotStatus;
  imagePrompt: string;
  videoPrompt: string;
  negativePrompt: string;
  bibleEntryIds: string[];
  selectedVersionId: string | null;
}>;

const input =
  'rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-text placeholder:text-faint focus:border-accent focus:outline-none disabled:opacity-60';

/** Champ texte enregistré à la sortie du champ (seulement s'il a changé). */
function TextField({
  label,
  value,
  rows = 3,
  mono = false,
  disabled,
  onSave,
}: {
  label: string;
  value: string;
  rows?: number;
  mono?: boolean;
  disabled: boolean;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="flex flex-col gap-1 text-[11px] text-muted">
      {label}
      <textarea
        value={draft}
        rows={rows}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => draft !== value && onSave(draft)}
        className={`${input} resize-y ${mono ? 'font-mono text-[11px] leading-relaxed' : ''}`}
      />
    </label>
  );
}

type DrawerTab = 'fabrication' | 'prompts' | 'decoupage' | 'bible';
const TABS: { id: DrawerTab; label: string }[] = [
  { id: 'fabrication', label: 'Fabrication' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'decoupage', label: 'Découpage' },
  { id: 'bible', label: 'Dans le plan' },
];

/**
 * Panneau d'un plan : lecteur et versions (arbre, version retenue, comparaison A/B) toujours
 * visibles ; onglets Fabrication (image puis vidéo, en repartant d'une version), Prompts (écrits
 * par Claude ou à la main), Découpage et éléments de bible présents.
 */
export function ShotDrawer({
  shot,
  canEdit,
  bible,
  providers,
  onClose,
  onChanged,
}: {
  shot: StoryboardShot;
  canEdit: boolean;
  bible: BibleEntry[];
  providers: AiProvider[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [versions, setVersions] = useState<ShotVersion[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [tab, setTab] = useState<DrawerTab>(canEdit ? 'fabrication' : 'decoupage');

  const loadVersions = useCallback(() => {
    call(api.GET('/shots/{shot_id}/versions', { params: { path: { shot_id: shot.id } } }))
      .then(setVersions)
      .catch((error: Error) => toast(error.message, { kind: 'error' }));
  }, [shot.id]);
  useEffect(loadVersions, [loadVersions]);

  const loadJobs = useCallback(
    () => call(api.GET('/shots/{shot_id}/generations', { params: { path: { shot_id: shot.id } } })),
    [shot.id],
  );
  const onDone = useCallback(
    (job: GenerationJob) => {
      if (job.status === 'completed' && job.mode === 'scene_from_shot') {
        toast('Plateau 3D prêt', {
          kind: 'ai',
          duration: 0,
          action: { label: 'Ouvrir', run: () => router.push(`/shots/${shot.id}/editor#ia`) },
        });
      } else if (job.status === 'completed') {
        toast(job.mode === 'shot_prompts' ? 'Prompts de Claude prêts' : 'Nouvelle version', {
          kind: 'ai',
        });
        loadVersions();
        onChanged();
      } else if (job.status === 'failed') {
        toast(`Génération en échec : ${job.errorDetails ?? job.message}`, { kind: 'error' });
      }
    },
    [loadVersions, onChanged, router, shot.id],
  );
  const [jobs, , track] = useJobs(loadJobs, onDone);
  const propositionScene = jobs.find(
    (job) => job.mode === 'scene_from_shot' && job.status === 'completed',
  );

  const patch = (body: Patch) =>
    call(api.PATCH('/shots/{shot_id}', { params: { path: { shot_id: shot.id } }, body }))
      .then(onChanged)
      .catch((error: Error) => toast(error.message, { kind: 'error' }));

  const preview =
    versions.find((v) => v.id === previewId) ??
    versions.find((v) => v.id === shot.selectedVersionId) ??
    versions[0] ??
    null;
  const compare = versions.find((v) => v.id === compareId) ?? null;
  const seconds =
    shot.durationFrames / (shot.effectiveFps.numerator / (shot.effectiveFps.denominator ?? 1));
  const running = jobs.filter((j) => !['completed', 'failed', 'cancelled'].includes(j.status));
  const promptJob = jobs.find((j) => j.mode === 'shot_prompts' && j.status === 'completed');
  const linked = new Set(shot.bibleEntryIds);
  const depth = useMemo(() => {
    const byId = new Map(versions.map((v) => [v.id, v]));
    const level = (v: ShotVersion): number =>
      v.parentId && byId.has(v.parentId) ? 1 + level(byId.get(v.parentId) as ShotVersion) : 0;
    return new Map(versions.map((v) => [v.id, Math.min(level(v), 4)]));
  }, [versions]);

  const media = (version: ShotVersion, label: string) =>
    version.kind === 'video' ? (
      <video
        src={assetUrl(version.assetId)}
        controls
        loop
        className="aspect-video w-full bg-black object-contain"
        aria-label={label}
      />
    ) : (
      <img
        src={assetUrl(version.assetId)}
        alt={label}
        className="aspect-video w-full bg-black object-contain"
      />
    );

  return (
    <aside
      aria-label={`Plan — ${shot.name}`}
      className="flex w-[36rem] shrink-0 animate-slide-up flex-col border-l border-border bg-panel"
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{shot.name}</h2>
        <select
          aria-label="Statut du plan"
          value={shot.status}
          disabled={!canEdit}
          onChange={(event) => void patch({ status: event.target.value as ShotStatus })}
          className="h-7 rounded-md border border-border bg-surface px-1.5 text-xs"
        >
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <Link
          href={`/shots/${shot.id}/editor`}
          className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted hover:text-text"
          title="Ouvrir le plan dans l’éditeur 3D (caméra, décor, rendu Blender)"
        >
          <Box size={12} /> 3D <ExternalLink size={10} />
        </Link>
        <button
          type="button"
          aria-label="Fermer le plan"
          onClick={onClose}
          className="text-faint hover:text-text"
        >
          <X size={16} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {/* Lecteur, versions et comparaison A/B */}
        <section aria-label="Versions" className="flex shrink-0 flex-col gap-2 pb-3">
          {preview ? (
            comparing && compare ? (
              <div className="grid grid-cols-2 gap-2">
                <figure>
                  {media(preview, `Version A — v${preview.number}`)}
                  <figcaption className="mt-1 text-center text-[11px] text-muted">
                    A · v{preview.number}
                  </figcaption>
                </figure>
                <figure>
                  {media(compare, `Version B — v${compare.number}`)}
                  <figcaption className="mt-1 text-center text-[11px] text-muted">
                    B · v{compare.number}
                  </figcaption>
                </figure>
              </div>
            ) : (
              media(preview, `Version ${preview.number}`)
            )
          ) : (
            <div className="flex aspect-video items-center justify-center bg-surface text-xs text-faint">
              Aucune version : générez une image ci-dessous.
            </div>
          )}
          {preview && (
            <div className="flex items-center gap-2 px-4 text-xs">
              <span className="text-muted">
                v{preview.number} · {preview.kind === 'video' ? 'vidéo' : 'image'}
                {preview.parentId &&
                  ` · depuis v${versions.find((v) => v.id === preview.parentId)?.number ?? '?'}`}
              </span>
              {versions.length > 1 && (
                <button
                  type="button"
                  aria-pressed={comparing}
                  onClick={() => {
                    setComparing((value) => !value);
                    if (!compareId)
                      setCompareId(versions.find((v) => v.id !== preview.id)?.id ?? null);
                  }}
                  className={`ml-auto flex items-center gap-1 rounded-md px-2 py-0.5 ${comparing ? 'bg-ai/20 text-ai' : 'text-muted hover:bg-hover'}`}
                >
                  <Columns2 size={12} /> Comparer A/B
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  disabled={shot.selectedVersionId === preview.id}
                  onClick={() => void patch({ selectedVersionId: preview.id })}
                  className={`flex items-center gap-1 rounded-md px-2 py-0.5 ${versions.length > 1 ? '' : 'ml-auto'} ${shot.selectedVersionId === preview.id ? 'text-ok' : 'bg-accent text-white'}`}
                >
                  <Check size={12} />
                  {shot.selectedVersionId === preview.id
                    ? 'Version retenue'
                    : 'Retenir cette version'}
                </button>
              )}
            </div>
          )}
          {versions.length > 0 && (
            <ul
              className="flex max-h-32 flex-col gap-0.5 overflow-auto px-3"
              aria-label="Arbre des versions"
            >
              {versions.map((version) => (
                <li key={version.id} style={{ paddingLeft: (depth.get(version.id) ?? 0) * 14 }}>
                  <div
                    className={`flex items-center gap-2 rounded-md px-1.5 py-1 text-xs ${version.id === preview?.id ? 'bg-accent/15' : 'hover:bg-hover'}`}
                  >
                    {version.parentId && <CornerDownRight size={11} className="text-faint" />}
                    <button
                      type="button"
                      onClick={() => setPreviewId(version.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      {version.kind === 'video' ? (
                        <span className="relative h-6 w-10 shrink-0 overflow-hidden rounded bg-black">
                          <video
                            src={assetUrl(version.assetId)}
                            preload="metadata"
                            muted
                            className="h-full w-full object-cover"
                          />
                          <Film size={10} className="absolute bottom-0.5 right-0.5 text-white" />
                        </span>
                      ) : (
                        <img
                          src={assetUrl(version.assetId)}
                          alt=""
                          className="h-6 w-10 rounded object-cover"
                        />
                      )}
                      <span className="font-medium">v{version.number}</span>
                      <span className="truncate text-faint">{version.note || version.prompt}</span>
                    </button>
                    {shot.selectedVersionId === version.id && (
                      <Check size={12} className="text-ok" aria-label="Retenue" />
                    )}
                    {comparing && version.id !== preview?.id && (
                      <button
                        type="button"
                        onClick={() => setCompareId(version.id)}
                        className={`rounded px-1 text-[10px] ${version.id === compareId ? 'bg-ai/30 text-ai' : 'text-faint hover:text-text'}`}
                      >
                        B
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div
          role="tablist"
          aria-label="Détail du plan"
          className="sticky top-0 z-10 flex shrink-0 gap-1 border-y border-border bg-panel px-3"
        >
          {TABS.filter((item) => canEdit || item.id !== 'fabrication').map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={`border-b-2 px-2.5 py-2 text-xs font-medium transition-colors ${tab === item.id ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Fabrication */}
        {canEdit && tab === 'fabrication' && (
          <section aria-label="Fabrication" className="flex flex-col gap-2 p-4">
            {running.map((job) => (
              <JobProgress key={job.id} job={job} />
            ))}
            <p className="flex items-center gap-1.5 text-[11px] text-muted">
              <ImageIcon size={12} /> Image clé — références : images clés de la bible liées au plan
              {preview ? `, en repartant de v${preview.number}` : ''}
            </p>
            <GenerateControl
              target={{ kind: 'shot', id: shot.id }}
              providers={providers}
              mode="text_to_image"
              body={{
                prompt: shot.imagePrompt || shot.description,
                negativePrompt: shot.negativePrompt,
                bibleReferences: true,
                aspectRatio: '16:9',
                referenceAssetIds: preview?.kind === 'image' ? [preview.assetId] : [],
                ...(preview ? { parentVersionId: preview.id } : {}),
              }}
              label="Générer l’image"
              disabled={!(shot.imagePrompt || shot.description).trim()}
              onCreated={track}
            />
            {shot.approach !== 'still' && (
              <>
                <p className="flex items-center gap-1.5 text-[11px] text-muted">
                  <Film size={12} /> Vidéo
                  {preview?.kind === 'image'
                    ? ` — anime l’image v${preview.number}`
                    : ' — choisissez d’abord une version image'}
                </p>
                <GenerateControl
                  target={{ kind: 'shot', id: shot.id }}
                  providers={providers}
                  mode="image_to_video"
                  body={{
                    prompt: shot.videoPrompt || shot.description,
                    negativePrompt: shot.negativePrompt,
                    durationSeconds: Math.max(1, Math.round(seconds)),
                    referenceAssetIds: preview?.kind === 'image' ? [preview.assetId] : [],
                    ...(preview ? { parentVersionId: preview.id } : {}),
                  }}
                  label="Générer la vidéo"
                  disabled={preview?.kind !== 'image'}
                  onCreated={track}
                />
              </>
            )}
            <p className="flex items-center gap-1.5 text-[11px] text-muted">
              <Box size={12} /> Scène 3D
              {preview
                ? ` — plateau gris d’après v${preview.number} : les volumes et une doublure par personnage, placés sur l’image`
                : ' — choisissez d’abord une version'}
            </p>
            <GenerateControl
              target={{ kind: 'shot', id: shot.id }}
              providers={providers}
              mode="scene_from_shot"
              defaultModel="claude:opus"
              body={preview ? { parentVersionId: preview.id } : {}}
              label="Créer la scène 3D"
              disabled={!preview}
              onCreated={track}
            />
            {propositionScene && (
              <Link
                href={`/shots/${shot.id}/editor#ia`}
                className="flex items-center gap-1 self-start text-xs text-ai hover:underline"
                data-testid="ouvrir-proposition-scene"
              >
                Voir la proposition dans l’éditeur 3D <ExternalLink size={11} />
              </Link>
            )}
          </section>
        )}

        {/* Prompts */}
        {tab === 'prompts' && (
          <section aria-label="Prompts" className="flex flex-col gap-2 p-4">
            {canEdit && (
              <GenerateControl
                compact
                target={{ kind: 'shot', id: shot.id }}
                providers={providers}
                mode="shot_prompts"
                defaultModel="claude:sonnet"
                body={{ prompt: '' }}
                label="Écrire avec Claude"
                disabled={!shot.description.trim()}
                onCreated={track}
              />
            )}
            {promptJob && canEdit && <PromptProposal job={promptJob} onUse={patch} />}
            <TextField
              label="Prompt image (anglais, par couches)"
              value={shot.imagePrompt}
              rows={5}
              mono
              disabled={!canEdit}
              onSave={(imagePrompt) => void patch({ imagePrompt })}
            />
            <TextField
              label="Prompt vidéo"
              value={shot.videoPrompt}
              rows={4}
              mono
              disabled={!canEdit}
              onSave={(videoPrompt) => void patch({ videoPrompt })}
            />
            <TextField
              label="Prompt négatif"
              value={shot.negativePrompt}
              rows={2}
              mono
              disabled={!canEdit}
              onSave={(negativePrompt) => void patch({ negativePrompt })}
            />
          </section>
        )}

        {/* Découpage */}
        {tab === 'decoupage' && (
          <section aria-label="Découpage" className="flex flex-col gap-2 p-4">
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-[11px] text-muted">
                Valeur de plan
                <input
                  defaultValue={shot.shotSize}
                  disabled={!canEdit}
                  maxLength={80}
                  onBlur={(event) =>
                    event.target.value !== shot.shotSize &&
                    void patch({ shotSize: event.target.value })
                  }
                  className={input}
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-muted">
                Mode de fabrication
                <select
                  value={shot.approach}
                  disabled={!canEdit}
                  onChange={(event) => void patch({ approach: event.target.value as ShotApproach })}
                  className={input}
                >
                  {Object.entries(APPROACH_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <TextField
              label="Caméra"
              value={shot.camera}
              rows={2}
              disabled={!canEdit}
              onSave={(camera) => void patch({ camera })}
            />
            <TextField
              label="Description"
              value={shot.description}
              rows={6}
              disabled={!canEdit}
              onSave={(description) => void patch({ description })}
            />
            <TextField
              label="Intention"
              value={shot.intention}
              rows={2}
              disabled={!canEdit}
              onSave={(intention) => void patch({ intention })}
            />
            <TextField
              label="Dialogue / voix off"
              value={shot.dialogue}
              rows={2}
              disabled={!canEdit}
              onSave={(dialogue) => void patch({ dialogue })}
            />
          </section>
        )}

        {/* Bible */}
        {tab === 'bible' && (
          <section aria-label="Éléments de bible du plan" className="flex flex-col gap-2 p-4">
            {bible.length === 0 ? (
              <p className="text-xs text-faint">La bible du projet est vide.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {bible
                  .filter((entry) => entry.kind !== 'look')
                  .map((entry) => {
                    const on = linked.has(entry.id);
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        aria-pressed={on}
                        disabled={!canEdit}
                        title={BIBLE_LABELS[entry.kind].one}
                        onClick={() =>
                          void patch({
                            bibleEntryIds: on
                              ? shot.bibleEntryIds.filter((id) => id !== entry.id)
                              : [...shot.bibleEntryIds, entry.id],
                          })
                        }
                        className={`flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-xs transition-colors ${on ? 'border-ai/60 bg-ai/15 text-text' : 'border-border text-muted hover:border-border-strong'}`}
                      >
                        {entry.keyAssetId ? (
                          <img
                            src={assetUrl(entry.keyAssetId)}
                            alt=""
                            className="h-5 w-5 rounded-full object-cover"
                          />
                        ) : (
                          <span className="h-5 w-5 rounded-full bg-surface" />
                        )}
                        {entry.name}
                      </button>
                    );
                  })}
              </div>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}

function PromptProposal({
  job,
  onUse,
}: {
  job: GenerationJob;
  onUse: (patch: Patch) => Promise<unknown>;
}) {
  const result = job.outputs['result'] as
    { imagePrompt: string; videoPrompt: string; negativePrompt: string; notes: string } | undefined;
  if (!result) return null;
  return (
    <div className="rounded-lg border border-ai/40 bg-ai/5 p-2 text-xs">
      <p className="flex items-center gap-1.5 font-medium text-ai">
        <Wand2 size={12} /> Proposition de Claude ({job.modelId})
      </p>
      {result.notes && <p className="mt-1 text-muted">{result.notes}</p>}
      <button
        type="button"
        className="mt-2 rounded-md border border-ai/50 px-2 py-0.5 text-ai hover:bg-ai/10"
        onClick={() =>
          void onUse({
            imagePrompt: result.imagePrompt,
            videoPrompt: result.videoPrompt,
            negativePrompt: result.negativePrompt,
          }).then(() => toast('Prompts repris dans le plan', { kind: 'ai' }))
        }
      >
        Utiliser ces prompts
      </button>
    </div>
  );
}
