'use client';

import type { AiProvider, GenerationJob, StoryboardSequence } from '@ass/api-client';
import { CheckCircle2, FolderOpen, Scissors, Send, TriangleAlert, X } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { DONE } from './data';
import { GenerateControl, JobProgress } from './Generate';

// Le moteur de montage ne vit que dans le navigateur (WebCodecs, Web Audio, canvas).
const Editeur = dynamic(() => import('@/montage/Editeur').then((m) => m.Editeur), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center bg-surface text-sm text-muted">
      Ouverture du montage…
    </div>
  ),
});

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
 * Étape « Montage » : le film. Les plans du studio y arrivent tout seuls, et chaque version retenue
 * remplace la précédente dans le montage. gozCut, le monteur Mac, reste accessible en parallèle.
 */
export function MontageStep({
  projectId,
  projectName,
  fps,
  width,
  height,
  canEdit,
  active,
  board,
  providers,
  jobs,
  onJob,
}: {
  projectId: string;
  projectName: string;
  fps: { numerator: number; denominator: number };
  width: number;
  height: number;
  canEdit: boolean;
  /** Écran affiché : il reste monté en coulisse pour garder l'historique du montage. */
  active: boolean;
  board: StoryboardSequence[];
  providers: AiProvider[];
  jobs: GenerationJob[];
  onJob: (job: GenerationJob) => void;
}) {
  const [gozCutOpen, setGozCutOpen] = useState(false);
  const shots = board.flatMap((s) => s.shots);
  const sends = jobs.filter((job) => job.mode === 'gozcut_project');
  const plansVersion = shots.map((s) => `${s.id}:${s.selectedVersionId ?? ''}`).join('|');

  if (shots.length === 0)
    return (
      <div className="flex flex-1 items-center justify-center p-10">
        <EmptyState icon={<Scissors size={24} />} title="Rien à monter pour l’instant">
          Le montage se remplit avec les plans du storyboard.
        </EmptyState>
      </div>
    );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <Editeur
        projectId={projectId}
        nom={projectName}
        fps={fps}
        largeur={width}
        hauteur={height}
        canEdit={canEdit}
        actif={active}
        versionPlans={plansVersion}
        barreDroite={
          <button type="button" onClick={() => setGozCutOpen((open) => !open)}>
            Envoyer vers gozCut
          </button>
        }
      />
      {gozCutOpen && (
        <section
          aria-label="Monter dans gozCut"
          className="absolute right-3 top-11 z-40 flex max-h-[70%] w-[26rem] flex-col gap-3 overflow-auto rounded-2xl border border-border bg-elevated p-5 shadow-pop"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-[15px] font-semibold">
                <Send size={15} /> Monter dans gozCut
              </h2>
              <p className="mt-1 text-[13px] text-muted">
                Crée un nouveau projet gozCut avec les plans dans l’ordre du film : version retenue,
                sinon dernière version ; un plan sans version devient un clip noir qui garde sa
                place. Vos projets gozCut existants ne sont pas touchés.
              </p>
            </div>
            <button
              type="button"
              aria-label="Fermer"
              onClick={() => setGozCutOpen(false)}
              className="rounded-lg p-1 text-muted hover:bg-hover hover:text-text"
            >
              <X size={16} />
            </button>
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
      )}
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
