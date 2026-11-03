'use client';

import type { GenerationJob } from '@ass/api-client';
import { Check, Clapperboard, ListTree, Users, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { api, call } from '@/lib/api';
import { toast } from '@/lib/toast';
import { APPROACH_LABELS } from './data';
import { JobProgress } from './Generate';

interface BreakdownShot {
  name: string;
  shotSize: string;
  camera: string;
  durationSeconds: number;
  description: string;
  intention: string;
  dialogue: string;
  approach: keyof typeof APPROACH_LABELS;
  characters: string[];
  sets: string[];
  props: string[];
}
interface Breakdown {
  method: Record<string, string>;
  sequences: { name: string; intention: string; shots: BreakdownShot[] }[];
}
interface BibleEntryProposal {
  name: string;
  description: string;
  prompt: string;
}
interface BibleProposal {
  look: BibleEntryProposal;
  characters: BibleEntryProposal[];
  sets: BibleEntryProposal[];
  props: BibleEntryProposal[];
}

const METHOD_STEPS: [string, string][] = [
  ['intention', 'Intention'],
  ['dramaturgy', '1. Analyse dramaturgique'],
  ['beats', '2. Battements'],
  ['staging', '3. Stratégie de mise en scène'],
  ['cinematography', '4. Chef-op'],
  ['draft', '5. Découpage brouillon'],
  ['qualityControl', '6. Contrôle qualité'],
];

/**
 * Étape 2 — propositions de Claude : découpages (avec le brouillon des 6 étapes de la méthode)
 * et bibles. Rien n'entre dans le projet sans « Appliquer » ; une proposition ne s'applique
 * qu'une fois.
 */
export function ProposalsStep({
  projectId,
  canEdit,
  jobs,
  onApplied,
}: {
  projectId: string;
  canEdit: boolean;
  jobs: GenerationJob[];
  onApplied: (kind: 'breakdown' | 'bible') => void;
}) {
  const proposals = jobs.filter(
    (job) => job.mode === 'script_breakdown' || job.mode === 'bible_from_script',
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const open = proposals.find((job) => job.id === openId) ?? proposals[0] ?? null;

  if (proposals.length === 0)
    return (
      <div className="flex flex-1 items-center justify-center p-10">
        <EmptyState icon={<Wand2 size={24} />} title="Aucune proposition de Claude">
          Depuis l’étape « Script », lancez « Découper le film » ou « Établir la bible ».
        </EmptyState>
      </div>
    );

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[18rem_1fr]">
      <aside className="flex min-h-0 flex-col gap-1 overflow-auto border-r border-border bg-panel p-3">
        <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-faint">
          Propositions
        </h2>
        {proposals.map((job) => {
          const applied = Boolean(job.outputs['appliedAt']);
          return (
            <button
              key={job.id}
              type="button"
              aria-current={open?.id === job.id}
              onClick={() => setOpenId(job.id)}
              className={`flex flex-col gap-1 rounded-md px-2 py-2 text-left text-xs transition-colors ${open?.id === job.id ? 'bg-accent/20' : 'hover:bg-hover'}`}
            >
              <span className="flex items-center gap-1.5 font-medium">
                {job.mode === 'script_breakdown' ? <ListTree size={13} /> : <Users size={13} />}
                {job.mode === 'script_breakdown' ? 'Découpage' : 'Bible'}
                <span className="font-normal text-faint">· {job.modelId}</span>
                {applied && <Check size={12} className="ml-auto text-ok" aria-label="Appliqué" />}
              </span>
              <span className="text-[10px] text-faint">
                {new Date(job.createdAt).toLocaleString('fr-FR')}
              </span>
              <JobProgress job={job} />
            </button>
          );
        })}
      </aside>
      <section aria-label="Proposition" className="min-h-0 overflow-auto p-6">
        {open && open.status === 'completed' && open.outputs['result'] ? (
          open.mode === 'script_breakdown' ? (
            <BreakdownView
              job={open}
              result={open.outputs['result'] as Breakdown}
              canEdit={canEdit}
              projectId={projectId}
              onApplied={() => onApplied('breakdown')}
            />
          ) : (
            <BibleView
              job={open}
              result={open.outputs['result'] as BibleProposal}
              canEdit={canEdit}
              projectId={projectId}
              onApplied={() => onApplied('bible')}
            />
          )
        ) : open ? (
          <div className="mx-auto max-w-md pt-10">
            <JobProgress job={open} />
            {open.status === 'completed' && <p className="text-sm text-muted">Proposition vide.</p>}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function ApplyButton({
  job,
  canEdit,
  label,
  run,
}: {
  job: GenerationJob;
  canEdit: boolean;
  label: string;
  run: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const applied = Boolean(job.outputs['appliedAt']);
  if (!canEdit) return null;
  return (
    <button
      type="button"
      disabled={applied || busy}
      onClick={() => {
        setBusy(true);
        run()
          .catch((error: Error) => toast(error.message, { kind: 'error' }))
          .finally(() => setBusy(false));
      }}
      className="flex h-9 items-center gap-1.5 rounded-md bg-gradient-to-r from-accent to-ai px-4 text-sm font-medium text-white shadow-card disabled:opacity-40"
    >
      {applied ? <Check size={14} /> : <Wand2 size={14} />}
      {applied ? 'Déjà appliqué' : label}
    </button>
  );
}

function BreakdownView({
  job,
  result,
  canEdit,
  projectId,
  onApplied,
}: {
  job: GenerationJob;
  result: Breakdown;
  canEdit: boolean;
  projectId: string;
  onApplied: () => void;
}) {
  const total = result.sequences.reduce((n, s) => n + s.shots.length, 0);
  const seconds = result.sequences.reduce(
    (n, s) => n + s.shots.reduce((m, shot) => m + (shot.durationSeconds || 0), 0),
    0,
  );
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex items-start gap-4">
        <div className="flex-1">
          <h2 className="text-lg font-semibold">Découpage proposé</h2>
          <p className="mt-1 text-sm text-muted">
            {result.sequences.length} séquence(s) · {total} plan(s) · ≈ {Math.round(seconds)} s
          </p>
          {result.method['intention'] && (
            <p className="mt-3 rounded-lg border border-ai/40 bg-ai/5 p-3 text-sm">
              <span className="font-medium text-ai">Intention : </span>
              {result.method['intention']}
            </p>
          )}
        </div>
        <ApplyButton
          job={job}
          canEdit={canEdit}
          label="Appliquer au storyboard"
          run={async () => {
            await call(
              api.POST('/projects/{project_id}/breakdown/apply', {
                params: { path: { project_id: projectId } },
                body: { jobId: job.id },
              }),
            );
            toast(`${total} plans ajoutés au storyboard`, { kind: 'success' });
            onApplied();
          }}
        />
      </header>
      <details className="rounded-lg border border-border bg-panel">
        <summary className="cursor-pointer px-4 py-2 text-sm font-medium">
          Brouillon du réalisateur (méthode en 6 étapes)
        </summary>
        <div className="flex flex-col gap-3 border-t border-border p-4 text-sm">
          {METHOD_STEPS.slice(1).map(([key, label]) =>
            result.method[key] ? (
              <div key={key}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-faint">
                  {label}
                </h3>
                <p className="mt-1 whitespace-pre-line text-text/90">{result.method[key]}</p>
              </div>
            ) : null,
          )}
        </div>
      </details>
      {result.sequences.map((sequence, s) => (
        <section key={s} className="flex flex-col gap-2">
          <h3 className="flex items-baseline gap-2 font-semibold">
            <Clapperboard size={15} className="text-faint" />
            {sequence.name}
            <span className="text-xs font-normal text-muted">{sequence.intention}</span>
          </h3>
          <ol className="flex flex-col gap-2">
            {sequence.shots.map((shot, index) => (
              <li
                key={index}
                className="grid grid-cols-[2.5rem_1fr] gap-3 rounded-lg border border-border bg-panel p-3 text-sm"
              >
                <span className="font-mono text-xs text-faint">
                  {s + 1}.{index + 1}
                </span>
                <div className="flex flex-col gap-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{shot.name}</span>
                    <span className="rounded bg-surface px-1.5 py-px text-[11px] text-muted">
                      {shot.shotSize}
                    </span>
                    <span className="rounded bg-surface px-1.5 py-px text-[11px] text-muted">
                      {APPROACH_LABELS[shot.approach] ?? shot.approach}
                    </span>
                    <span className="text-[11px] text-faint">{shot.durationSeconds} s</span>
                  </p>
                  <p className="text-xs text-muted">{shot.camera}</p>
                  <p className="whitespace-pre-line text-text/90">{shot.description}</p>
                  {shot.dialogue && <p className="text-xs italic text-muted">{shot.dialogue}</p>}
                  {[...shot.characters, ...shot.sets, ...shot.props].length > 0 && (
                    <p className="text-[11px] text-faint">
                      {[...shot.characters, ...shot.sets, ...shot.props].join(' · ')}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function BibleView({
  job,
  result,
  canEdit,
  projectId,
  onApplied,
}: {
  job: GenerationJob;
  result: BibleProposal;
  canEdit: boolean;
  projectId: string;
  onApplied: () => void;
}) {
  const groups: [string, BibleEntryProposal[]][] = [
    ['LOOK du film', result.look ? [result.look] : []],
    ['Personnages', result.characters],
    ['Décors', result.sets],
    ['Accessoires', result.props],
  ];
  const count = groups.reduce((n, [, items]) => n + items.length, 0);
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex items-start gap-4">
        <div className="flex-1">
          <h2 className="text-lg font-semibold">Bible proposée</h2>
          <p className="mt-1 text-sm text-muted">
            {count} élément(s). Les noms déjà présents dans la bible sont conservés tels quels.
          </p>
        </div>
        <ApplyButton
          job={job}
          canEdit={canEdit}
          label="Ajouter à la bible"
          run={async () => {
            await call(
              api.POST('/projects/{project_id}/bible/apply', {
                params: { path: { project_id: projectId } },
                body: { jobId: job.id },
              }),
            );
            toast('Bible mise à jour et reliée aux plans', { kind: 'success' });
            onApplied();
          }}
        />
      </header>
      {groups.map(([title, items]) =>
        items.length === 0 ? null : (
          <section key={title} className="flex flex-col gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-faint">
              {title}
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {items.map((item, index) => (
                <article
                  key={index}
                  className="rounded-lg border border-border bg-panel p-3 text-sm"
                >
                  <p className="font-medium">{item.name || title}</p>
                  <p className="mt-1 text-xs text-muted">{item.description}</p>
                  <p className="mt-2 font-mono text-[11px] leading-relaxed text-faint">
                    {item.prompt}
                  </p>
                </article>
              ))}
            </div>
          </section>
        ),
      )}
    </div>
  );
}
