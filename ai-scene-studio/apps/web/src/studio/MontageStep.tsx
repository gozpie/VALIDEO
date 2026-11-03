'use client';

import type { AiProvider, GenerationJob, StoryboardSequence } from '@ass/api-client';
import { CheckCircle2, FolderOpen, Scissors, TriangleAlert } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { assetUrl, DONE } from './data';
import { GenerateControl, JobProgress } from './Generate';

export const formatTime = (seconds: number) => {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

interface GozCutResult {
  folder: string;
  name: string;
  clips: number;
  seconds: number;
  missing: string[];
  opened: boolean;
}

/**
 * Étape « Montage » : où en est le film (plans prêts, plans manquants, durée), et l'envoi des plans
 * à gozCut, le monteur Mac. Chaque envoi crée un nouveau projet gozCut.
 */
export function MontageStep({
  projectId,
  canEdit,
  board,
  fps,
  providers,
  jobs,
  onJob,
}: {
  projectId: string;
  canEdit: boolean;
  board: StoryboardSequence[];
  fps: number;
  providers: AiProvider[];
  jobs: GenerationJob[];
  onJob: (job: GenerationJob) => void;
}) {
  const shots = board.flatMap((s) => s.shots);
  const ready = shots.filter((s) => s.selectedVersionId).length;
  const seconds = shots.reduce((n, s) => n + s.durationFrames / fps, 0);
  const sends = jobs.filter((job) => job.mode === 'gozcut_project');

  if (shots.length === 0)
    return (
      <div className="flex flex-1 items-center justify-center p-10">
        <EmptyState icon={<Scissors size={24} />} title="Rien à monter pour l’instant">
          Le montage se remplit avec les plans du storyboard.
        </EmptyState>
      </div>
    );

  return (
    <div className="min-h-0 flex-1 overflow-auto p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <section aria-label="État du film" className="grid grid-cols-3 gap-3">
          {(
            [
              ['Durée du film', formatTime(seconds)],
              ['Plans avec version retenue', `${ready} / ${shots.length}`],
              ['Plans sans version retenue', String(shots.length - ready)],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-border bg-panel p-4 shadow-card">
              <p className="text-xs text-muted">{label}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
            </div>
          ))}
        </section>

        <section
          aria-label="Monter dans gozCut"
          className="flex flex-col gap-3 rounded-2xl border border-border bg-panel p-5 shadow-card"
        >
          <div>
            <h2 className="text-[15px] font-semibold">Monter dans gozCut</h2>
            <p className="mt-1 text-[13px] text-muted">
              Crée un nouveau projet gozCut avec les plans dans l’ordre du film : version retenue,
              sinon dernière version ; un plan sans version devient un clip noir qui garde sa place.
              Vos projets gozCut existants ne sont pas touchés.
            </p>
          </div>
          {canEdit && (
            <GenerateControl
              target={{ kind: 'project', id: projectId }}
              providers={providers}
              mode="gozcut_project"
              body={{}}
              label="Monter dans gozCut"
              onCreated={onJob}
            />
          )}
          {sends.length > 0 && (
            <ul aria-label="Envois vers gozCut" className="flex flex-col gap-2">
              {sends.map((job) => (
                <SendRow key={job.id} job={job} />
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Le film plan par plan" className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Le film plan par plan</h2>
          <ol className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
            {shots.map((shot) => (
              <li
                key={shot.id}
                className="overflow-hidden rounded-lg border border-border bg-panel"
                title={shot.name}
              >
                <div className="aspect-video bg-surface">
                  {shot.selectedVersion?.kind === 'image' && (
                    <img
                      src={assetUrl(shot.selectedVersion.assetId)}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  )}
                  {shot.selectedVersion?.kind === 'video' && (
                    <video
                      src={assetUrl(shot.selectedVersion.assetId)}
                      preload="metadata"
                      muted
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <p className="truncate px-2 py-1 text-[11px] text-muted">{shot.name}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

function SendRow({ job }: { job: GenerationJob }) {
  const result = job.outputs['result'] as GozCutResult | undefined;
  return (
    <li className="rounded-xl border border-border bg-surface/50 p-3 text-[13px]">
      {!DONE.has(job.status) || job.status === 'failed' ? (
        <JobProgress job={job} />
      ) : result ? (
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-2 font-medium">
            <CheckCircle2 size={14} className="text-ok" /> {result.name}
          </p>
          <p className="text-xs text-muted">
            {result.clips} plans · {formatTime(result.seconds)}
            {result.opened ? ' · ouvert dans gozCut' : ''}
          </p>
          <p className="flex items-center gap-1.5 break-all font-mono text-[11px] text-faint">
            <FolderOpen size={12} className="shrink-0" /> {result.folder}
          </p>
          {result.missing.length > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-warn">
              <TriangleAlert size={12} className="mt-0.5 shrink-0" />
              Clips noirs à la place de : {result.missing.join(', ')}
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted">{job.message}</p>
      )}
    </li>
  );
}
