'use client';

import type { AiProvider, BibleEntry, BibleKind, GenerationJob } from '@ass/api-client';
import { ImageOff, Plus, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { api, call } from '@/lib/api';
import { toast } from '@/lib/toast';
import { assetUrl, BIBLE_LABELS } from './data';
import { GenerateControl, JobProgress } from './Generate';

const KINDS: BibleKind[] = ['look', 'character', 'set', 'prop'];

/** Prompt d'une image de bible : bloc LOOK du film puis description visuelle de l'élément. */
export function biblePrompt(entry: BibleEntry, look: BibleEntry | undefined): string {
  const subject =
    entry.kind === 'character'
      ? `Unretouched casting photo, natural light, three-quarter view. ${entry.prompt}`
      : entry.prompt;
  return look && entry.kind !== 'look' ? `LOOK: ${look.prompt}\n\n${subject}` : subject;
}

/**
 * Étape 3 — la bible : LOOK, personnages, décors, accessoires. Chaque élément a une fiche, un
 * prompt anglais et une galerie d'images ; l'image clé (étoile) sert de référence aux plans.
 */
export function BibleStep({
  projectId,
  canEdit,
  entries,
  refresh,
  providers,
  jobs,
  onJob,
}: {
  projectId: string;
  canEdit: boolean;
  entries: BibleEntry[];
  refresh: () => void;
  providers: AiProvider[];
  jobs: GenerationJob[];
  onJob: (job: GenerationJob) => void;
}) {
  const look = entries.find((e) => e.kind === 'look');
  const [adding, setAdding] = useState<BibleKind | null>(null);
  const [name, setName] = useState('');

  const create = (kind: BibleKind) =>
    call(
      api.POST('/projects/{project_id}/bible', {
        params: { path: { project_id: projectId } },
        body: { kind, name },
      }),
    )
      .then(() => {
        setAdding(null);
        setName('');
        refresh();
      })
      .catch((error: Error) => toast(error.message, { kind: 'error' }));

  return (
    <div className="min-h-0 flex-1 overflow-auto p-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        {entries.length === 0 && (
          <EmptyState icon={<Star size={22} />} title="Bible vide">
            Lancez « Établir la bible » depuis l’étape Script, ou ajoutez les éléments à la main.
          </EmptyState>
        )}
        {KINDS.map((kind) => {
          const items = entries.filter((e) => e.kind === kind);
          return (
            <section
              key={kind}
              aria-label={BIBLE_LABELS[kind].many}
              className="flex flex-col gap-3"
            >
              <div className="flex items-center gap-2">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-faint">
                  {BIBLE_LABELS[kind].many}
                </h2>
                <span className="text-[11px] text-faint">{items.length}</span>
                {canEdit && (
                  <button
                    type="button"
                    aria-label={`Ajouter : ${BIBLE_LABELS[kind].one}`}
                    className="ml-auto flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-muted hover:bg-hover hover:text-text"
                    onClick={() => setAdding(kind)}
                  >
                    <Plus size={12} /> Ajouter
                  </button>
                )}
              </div>
              {adding === kind && (
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void create(kind);
                  }}
                >
                  <input
                    autoFocus
                    aria-label={`Nom : ${BIBLE_LABELS[kind].one}`}
                    value={name}
                    maxLength={200}
                    onChange={(event) => setName(event.target.value)}
                    className="h-8 flex-1 rounded-md border border-border bg-surface px-2 text-sm"
                  />
                  <button
                    type="submit"
                    disabled={!name.trim()}
                    className="rounded-md bg-accent px-3 text-xs text-white disabled:opacity-40"
                  >
                    Créer
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-border px-3 text-xs"
                    onClick={() => setAdding(null)}
                  >
                    Annuler
                  </button>
                </form>
              )}
              <div
                className={
                  kind === 'look'
                    ? 'grid grid-cols-1 gap-3'
                    : 'grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3'
                }
              >
                {items.map((entry) => (
                  <EntryCard
                    key={entry.id}
                    entry={entry}
                    look={look}
                    canEdit={canEdit}
                    projectId={projectId}
                    providers={providers}
                    jobs={jobs.filter((j) => j.request['bibleEntryId'] === entry.id)}
                    onJob={onJob}
                    refresh={refresh}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function EntryCard({
  entry,
  look,
  canEdit,
  projectId,
  providers,
  jobs,
  onJob,
  refresh,
}: {
  entry: BibleEntry;
  look: BibleEntry | undefined;
  canEdit: boolean;
  projectId: string;
  providers: AiProvider[];
  jobs: GenerationJob[];
  onJob: (job: GenerationJob) => void;
  refresh: () => void;
}) {
  const [description, setDescription] = useState(entry.description);
  const [prompt, setPrompt] = useState(entry.prompt);
  const patch = (body: { description?: string; prompt?: string; keyAssetId?: string }) =>
    call(api.PATCH('/bible-entries/{entry_id}', { params: { path: { entry_id: entry.id } }, body }))
      .then(refresh)
      .catch((error: Error) => toast(error.message, { kind: 'error' }));
  const running = jobs.find((j) => !['completed', 'failed', 'cancelled'].includes(j.status));

  return (
    <article
      aria-label={entry.name}
      className="flex flex-col overflow-hidden rounded-xl border border-border bg-panel shadow-card"
    >
      {entry.kind !== 'look' && (
        <div className="relative aspect-[4/3] bg-surface">
          {entry.keyAssetId ? (
            <img
              src={assetUrl(entry.keyAssetId)}
              alt={`Image clé — ${entry.name}`}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-faint">
              <ImageOff size={22} />
            </div>
          )}
          <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-px text-[10px] text-white">
            {BIBLE_LABELS[entry.kind].one}
          </span>
        </div>
      )}
      {entry.imageAssetIds.length > 1 && (
        <div
          className="flex gap-1 overflow-x-auto border-b border-border p-1.5"
          aria-label="Galerie"
        >
          {entry.imageAssetIds.map((id) => (
            <button
              key={id}
              type="button"
              disabled={!canEdit}
              aria-label={id === entry.keyAssetId ? 'Image clé' : 'Choisir comme image clé'}
              onClick={() => void patch({ keyAssetId: id })}
              className={`relative h-10 w-14 shrink-0 overflow-hidden rounded ${id === entry.keyAssetId ? 'ring-2 ring-ai' : 'opacity-70 hover:opacity-100'}`}
            >
              <img src={assetUrl(id)} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2 p-3 text-xs">
        <div className="flex items-center gap-2">
          <h3 className="flex-1 truncate text-sm font-semibold">{entry.name}</h3>
          {canEdit && (
            <button
              type="button"
              aria-label={`Supprimer ${entry.name}`}
              className="text-faint hover:text-error"
              onClick={() =>
                call(
                  api.DELETE('/bible-entries/{entry_id}', {
                    params: { path: { entry_id: entry.id } },
                  }),
                )
                  .then(refresh)
                  .catch((error: Error) => toast(error.message, { kind: 'error' }))
              }
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
        <textarea
          aria-label={`Fiche — ${entry.name}`}
          value={description}
          rows={2}
          disabled={!canEdit}
          placeholder="Fiche (français)"
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => description !== entry.description && void patch({ description })}
          className="resize-none rounded-md border border-transparent bg-transparent p-1 text-muted hover:border-border focus:border-accent focus:outline-none"
        />
        <textarea
          aria-label={`Prompt — ${entry.name}`}
          value={prompt}
          rows={entry.kind === 'look' ? 5 : 3}
          disabled={!canEdit}
          placeholder={
            entry.kind === 'look'
              ? 'Bloc LOOK (anglais), repris en tête de chaque prompt d’image'
              : 'Description visuelle (anglais)'
          }
          onChange={(event) => setPrompt(event.target.value)}
          onBlur={() => prompt !== entry.prompt && void patch({ prompt })}
          className="resize-none rounded-md border border-transparent bg-surface/60 p-1 font-mono text-[11px] text-text/80 hover:border-border focus:border-accent focus:outline-none"
        />
        {running && <JobProgress job={running} />}
        {canEdit && entry.kind !== 'look' && (
          <GenerateControl
            compact
            target={{ kind: 'project', id: projectId }}
            providers={providers}
            mode="text_to_image"
            body={{
              prompt: biblePrompt({ ...entry, prompt }, look),
              bibleEntryId: entry.id,
              aspectRatio: entry.kind === 'character' ? '4:3' : '16:9',
            }}
            label="Image"
            disabled={!prompt.trim() || Boolean(running)}
            onCreated={onJob}
          />
        )}
      </div>
    </article>
  );
}
