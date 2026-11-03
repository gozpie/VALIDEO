'use client';

import type { AiProvider, BibleEntry, BibleKind, GenerationJob } from '@ass/api-client';
import { Check, ImageOff, Images, Palette, Plus, Star, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { api, call } from '@/lib/api';
import { toast } from '@/lib/toast';
import { assetUrl, BIBLE_LABELS, DONE } from './data';
import { GenerateControl, JobProgress } from './Generate';

const KINDS: BibleKind[] = ['character', 'set', 'prop'];

/** Prompt d'une image de bible : bloc LOOK du film puis description visuelle de l'élément. */
export function biblePrompt(entry: BibleEntry, look: BibleEntry | undefined): string {
  const subject =
    entry.kind === 'character'
      ? `Unretouched casting photo, natural light, three-quarter view. ${entry.prompt}`
      : entry.prompt;
  return look && entry.kind !== 'look' ? `LOOK: ${look.prompt}\n\n${subject}` : subject;
}

/**
 * Étape « Bible » : le LOOK du film, puis personnages, décors et accessoires en galeries. Un clic
 * ouvre l'élément à droite : grande image, galerie (l'image clé sert de référence aux plans),
 * fiche, prompt et génération.
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
  const [openId, setOpenId] = useState<string | null>(null);
  const open = entries.find((e) => e.id === openId) ?? null;

  const create = (kind: BibleKind, name: string) =>
    call(
      api.POST('/projects/{project_id}/bible', {
        params: { path: { project_id: projectId } },
        body: { kind, name },
      }),
    )
      .then((entry) => {
        refresh();
        setOpenId(entry.id);
      })
      .catch((error: Error) => toast(error.message, { kind: 'error' }));

  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-5">
        <div className="flex flex-col gap-7">
          {entries.length === 0 && (
            <EmptyState icon={<Star size={22} />} title="Bible vide">
              Lancez « Établir la bible » depuis l’étape Script, ou ajoutez les éléments à la main.
            </EmptyState>
          )}
          {look ? (
            <button
              type="button"
              aria-label={`Ouvrir ${look.name}`}
              onClick={() => setOpenId(look.id)}
              className={`flex items-start gap-4 rounded-2xl border bg-gradient-to-r from-accent/10 to-ai/10 p-4 text-left transition-colors hover:border-border-strong ${openId === look.id ? 'border-accent' : 'border-border'}`}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-ai text-white">
                <Palette size={18} />
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold">{look.name}</span>
                <span className="mt-0.5 line-clamp-2 block text-[13px] text-muted">
                  {look.description || look.prompt || 'Décrivez le LOOK du film.'}
                </span>
              </span>
            </button>
          ) : (
            canEdit && <AddEntry kind="look" onCreate={create} wide />
          )}
          {KINDS.map((kind) => {
            const items = entries.filter((e) => e.kind === kind);
            return (
              <section
                key={kind}
                aria-label={BIBLE_LABELS[kind].many}
                className="flex flex-col gap-3"
              >
                <h2 className="flex items-baseline gap-2 text-sm font-semibold">
                  {BIBLE_LABELS[kind].many}
                  <span className="text-xs font-normal tabular-nums text-faint">
                    {items.length}
                  </span>
                </h2>
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] gap-3">
                  {items.map((entry) => (
                    <li key={entry.id}>
                      <EntryCard
                        entry={entry}
                        active={entry.id === openId}
                        running={jobs.some(
                          (j) => j.request['bibleEntryId'] === entry.id && !DONE.has(j.status),
                        )}
                        onOpen={() => setOpenId(entry.id)}
                      />
                    </li>
                  ))}
                  {canEdit && (
                    <li>
                      <AddEntry kind={kind} onCreate={create} />
                    </li>
                  )}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
      {open && (
        <EntryPanel
          key={open.id}
          entry={open}
          look={look}
          canEdit={canEdit}
          projectId={projectId}
          providers={providers}
          jobs={jobs.filter((j) => j.request['bibleEntryId'] === open.id)}
          onJob={onJob}
          refresh={refresh}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

function EntryCard({
  entry,
  active,
  running,
  onOpen,
}: {
  entry: BibleEntry;
  active: boolean;
  running: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Ouvrir ${entry.name}`}
      onClick={onOpen}
      className={`group flex w-full flex-col overflow-hidden rounded-xl bg-panel text-left outline outline-1 transition-all hover:-translate-y-0.5 hover:outline-border-strong ${active ? 'outline-2 outline-accent' : 'outline-border'}`}
    >
      <div className="relative aspect-[4/3] bg-surface">
        {entry.keyAssetId ? (
          <img
            src={assetUrl(entry.keyAssetId)}
            alt={`Image clé — ${entry.name}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-3 text-center text-[10.5px] text-faint">
            <ImageOff size={18} />
            <span className="line-clamp-2">{entry.description || 'Pas encore d’image'}</span>
          </div>
        )}
        {entry.imageAssetIds.length > 1 && (
          <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded bg-black/65 px-1.5 py-px text-[10px] text-white">
            <Images size={10} /> {entry.imageAssetIds.length}
          </span>
        )}
        {running && (
          <span className="absolute inset-x-0 bottom-0 h-1 animate-pulse bg-gradient-to-r from-accent to-ai" />
        )}
      </div>
      <div className="px-2.5 py-2">
        <p className="truncate text-[13px] font-semibold">{entry.name}</p>
        <p className="truncate text-[11px] text-muted">{entry.description || '—'}</p>
      </div>
    </button>
  );
}

function AddEntry({
  kind,
  onCreate,
  wide = false,
}: {
  kind: BibleKind;
  onCreate: (kind: BibleKind, name: string) => Promise<unknown>;
  wide?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const label = BIBLE_LABELS[kind].one;
  if (!adding)
    return (
      <button
        type="button"
        aria-label={`Ajouter : ${label}`}
        onClick={() => setAdding(true)}
        className={`flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong text-[13px] text-muted transition-colors hover:border-accent hover:text-text ${wide ? 'h-14' : 'aspect-[4/3]'}`}
      >
        <Plus size={15} /> {label}
      </button>
    );
  return (
    <form
      className={`flex w-full flex-col justify-center gap-2 rounded-xl border border-accent bg-panel p-3 ${wide ? '' : 'aspect-[4/3]'}`}
      onSubmit={(event) => {
        event.preventDefault();
        void onCreate(kind, name).then(() => {
          setName('');
          setAdding(false);
        });
      }}
    >
      <input
        autoFocus
        aria-label={`Nom : ${label}`}
        placeholder={`Nom : ${label.toLowerCase()}`}
        value={name}
        maxLength={200}
        onChange={(event) => setName(event.target.value)}
        className="h-9 rounded-lg border border-border bg-surface px-2.5 text-[13px] placeholder:text-faint focus:border-accent focus:outline-none"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!name.trim()}
          className="h-8 flex-1 rounded-lg bg-accent text-xs font-semibold text-white disabled:opacity-40"
        >
          Créer
        </button>
        <button
          type="button"
          onClick={() => setAdding(false)}
          className="h-8 rounded-lg border border-border px-2.5 text-xs"
        >
          Annuler
        </button>
      </div>
    </form>
  );
}

function EntryPanel({
  entry,
  look,
  canEdit,
  projectId,
  providers,
  jobs,
  onJob,
  refresh,
  onClose,
}: {
  entry: BibleEntry;
  look: BibleEntry | undefined;
  canEdit: boolean;
  projectId: string;
  providers: AiProvider[];
  jobs: GenerationJob[];
  onJob: (job: GenerationJob) => void;
  refresh: () => void;
  onClose: () => void;
}) {
  const [description, setDescription] = useState(entry.description);
  const [prompt, setPrompt] = useState(entry.prompt);
  const [previewId, setPreviewId] = useState<string | null>(entry.keyAssetId ?? null);
  useEffect(() => {
    setPreviewId((current) => current ?? entry.keyAssetId ?? null);
  }, [entry.keyAssetId]);
  const patch = (body: { description?: string; prompt?: string; keyAssetId?: string }) =>
    call(api.PATCH('/bible-entries/{entry_id}', { params: { path: { entry_id: entry.id } }, body }))
      .then(refresh)
      .catch((error: Error) => toast(error.message, { kind: 'error' }));
  const running = jobs.find((j) => !DONE.has(j.status));
  const field =
    'rounded-lg border border-border bg-surface p-2 text-xs placeholder:text-faint focus:border-accent focus:outline-none disabled:opacity-60';

  return (
    <aside
      aria-label={`Élément — ${entry.name}`}
      className="flex w-[30rem] shrink-0 animate-slide-up flex-col border-l border-border bg-panel"
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted">
          {BIBLE_LABELS[entry.kind].one}
        </span>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{entry.name}</h2>
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
                .then(() => {
                  onClose();
                  refresh();
                })
                .catch((error: Error) => toast(error.message, { kind: 'error' }))
            }
          >
            <Trash2 size={14} />
          </button>
        )}
        <button
          type="button"
          aria-label="Fermer l’élément"
          onClick={onClose}
          className="text-faint hover:text-text"
        >
          <X size={16} />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {entry.kind !== 'look' && (
          <div className="flex aspect-[4/3] shrink-0 items-center justify-center bg-black">
            {previewId ? (
              <img
                src={assetUrl(previewId)}
                alt={entry.keyAssetId === previewId ? `Image clé — ${entry.name}` : entry.name}
                className="h-full w-full object-contain"
              />
            ) : (
              <span className="flex flex-col items-center gap-1 text-xs text-faint">
                <ImageOff size={22} /> Aucune image : générez-en une ci-dessous.
              </span>
            )}
          </div>
        )}
        {previewId && canEdit && entry.kind !== 'look' && (
          <div className="flex items-center justify-end px-4 pt-2 text-xs">
            {entry.keyAssetId === previewId ? (
              <span className="flex items-center gap-1 text-ok">
                <Check size={12} /> Image clé
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void patch({ keyAssetId: previewId })}
                className="flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-white"
              >
                <Star size={12} /> Choisir comme image clé
              </button>
            )}
          </div>
        )}
        {entry.imageAssetIds.length > 1 && (
          <div className="flex shrink-0 gap-1.5 overflow-x-auto px-4 py-2" aria-label="Galerie">
            {entry.imageAssetIds.map((id) => (
              <button
                key={id}
                type="button"
                aria-label={id === entry.keyAssetId ? 'Voir l’image clé' : 'Voir cette image'}
                onClick={() => setPreviewId(id)}
                className={`h-14 w-20 shrink-0 overflow-hidden rounded-lg outline outline-2 -outline-offset-2 ${id === previewId ? 'outline-accent' : 'outline-transparent opacity-75 hover:opacity-100'}`}
              >
                <img src={assetUrl(id)} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-3 p-4">
          <label className="flex flex-col gap-1 text-[11px] text-muted">
            Fiche
            <textarea
              aria-label={`Fiche — ${entry.name}`}
              value={description}
              rows={3}
              disabled={!canEdit}
              placeholder="Rôle, traits, époque (français)"
              onChange={(event) => setDescription(event.target.value)}
              onBlur={() => description !== entry.description && void patch({ description })}
              className={`${field} resize-y`}
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted">
            {entry.kind === 'look'
              ? 'Bloc LOOK (anglais), repris en tête de chaque prompt d’image'
              : 'Description visuelle (anglais)'}
            <textarea
              aria-label={`Prompt — ${entry.name}`}
              value={prompt}
              rows={entry.kind === 'look' ? 9 : 5}
              disabled={!canEdit}
              onChange={(event) => setPrompt(event.target.value)}
              onBlur={() => prompt !== entry.prompt && void patch({ prompt })}
              className={`${field} resize-y font-mono text-[11px] leading-relaxed`}
            />
          </label>
          {running && <JobProgress job={running} />}
          {canEdit && entry.kind !== 'look' && (
            <GenerateControl
              target={{ kind: 'project', id: projectId }}
              providers={providers}
              mode="text_to_image"
              body={{
                prompt: biblePrompt({ ...entry, prompt }, look),
                bibleEntryId: entry.id,
                aspectRatio: entry.kind === 'character' ? '4:3' : '16:9',
              }}
              label="Générer une image"
              disabled={!prompt.trim() || Boolean(running)}
              onCreated={onJob}
            />
          )}
        </div>
      </div>
    </aside>
  );
}
