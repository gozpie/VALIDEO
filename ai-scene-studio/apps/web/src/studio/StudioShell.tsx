'use client';

import type { GenerationJob, Project, Workspace } from '@ass/api-client';
import {
  ArrowLeft,
  Clapperboard,
  Command as CommandIcon,
  FileText,
  LayoutGrid,
  Sparkles,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState, type ReactNode } from 'react';
import { Kbd } from '@/components/Kbd';
import { api, call } from '@/lib/api';
import { commandStore, useCommandSource } from '@/lib/commands';
import { toast } from '@/lib/toast';
import { BibleStep } from './BibleStep';
import { useBible, useJobs, useProviders, useScripts, useStoryboard } from './data';
import { ProposalsStep } from './ProposalsStep';
import { ScriptStep } from './ScriptStep';
import { ShotsStep } from './ShotsStep';

export type StudioStep = 'script' | 'proposals' | 'bible' | 'shots';

const STEPS: { id: StudioStep; label: string; icon: ReactNode }[] = [
  { id: 'script', label: 'Script', icon: <FileText size={15} /> },
  { id: 'proposals', label: 'Propositions', icon: <Sparkles size={15} /> },
  { id: 'bible', label: 'Bible', icon: <Users size={15} /> },
  { id: 'shots', label: 'Plans', icon: <LayoutGrid size={15} /> },
];

/**
 * Studio de production d'un projet : le flux de fabrication du film, étape par étape —
 * script → propositions de Claude (découpage, bible) → bible → plans (versions, A/B).
 */
export function StudioShell({ project, workspace }: { project: Project; workspace: Workspace }) {
  const projectId = project.id;
  const canEdit = workspace.role !== 'viewer';
  const fps = project.fps.numerator / (project.fps.denominator ?? 1);
  const [step, setStep] = useState<StudioStep>('script');
  const [scripts, refreshScripts] = useScripts(projectId);
  const [bible, refreshBible] = useBible(projectId);
  const [board, refreshBoard] = useStoryboard(projectId);
  const providers = useProviders();

  const loadJobs = useCallback(
    () =>
      call(
        api.GET('/projects/{project_id}/generations', {
          params: { path: { project_id: projectId } },
        }),
      ),
    [projectId],
  );
  const onDone = useCallback(
    (job: GenerationJob) => {
      if (job.status === 'failed') {
        toast(`Claude n’a pas abouti : ${job.errorDetails ?? job.message}`, { kind: 'error' });
        return;
      }
      if (job.status !== 'completed') return;
      if (job.mode === 'script_breakdown' || job.mode === 'bible_from_script') {
        toast(job.mode === 'script_breakdown' ? 'Découpage proposé' : 'Bible proposée', {
          kind: 'ai',
          duration: 0,
          action: { label: 'Voir', run: () => setStep('proposals') },
        });
      } else {
        toast('Nouvelle image dans la bible', { kind: 'ai' });
        refreshBible();
      }
    },
    [refreshBible],
  );
  const [jobs, refreshJobs, track] = useJobs(loadJobs, onDone);

  const shots = board.flatMap((s) => s.shots);
  const counts: Record<StudioStep, string> = {
    script: scripts[0] ? `v${scripts[0].version}` : '—',
    proposals: String(
      jobs.filter((j) => j.mode === 'script_breakdown' || j.mode === 'bible_from_script').length,
    ),
    bible: String(bible.length),
    shots: shots.length
      ? `${shots.filter((s) => s.selectedVersionId).length}/${shots.length}`
      : '0',
  };

  useCommandSource(
    'studio',
    STEPS.map((item, index) => ({
      id: `studio-${item.id}`,
      label: `Studio : ${item.label}`,
      group: 'Studio',
      shortcut: String(index + 1),
      run: () => setStep(item.id),
    })),
  );

  return (
    <div className="fixed inset-0 z-10 flex flex-col bg-surface">
      <header className="flex items-center gap-3 border-b border-border bg-panel px-4 py-2">
        <Link
          href={`/projects/${projectId}`}
          aria-label="Retour au projet"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-text"
        >
          <ArrowLeft size={16} />
        </Link>
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-accent to-ai text-white">
          <Clapperboard size={14} />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{project.name}</h1>
          <p className="text-[11px] text-faint">
            Studio · {workspace.name} · {project.resolution.width}×{project.resolution.height} ·{' '}
            {fps} i/s
          </p>
        </div>
        <nav
          aria-label="Étapes de fabrication"
          className="mx-auto flex items-center gap-1 rounded-xl bg-surface p-1"
        >
          {STEPS.map((item, index) => (
            <button
              key={item.id}
              type="button"
              aria-current={step === item.id ? 'step' : undefined}
              onClick={() => setStep(item.id)}
              className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ${step === item.id ? 'bg-elevated text-text shadow-card' : 'text-muted hover:text-text'}`}
            >
              <span className="font-mono text-[10px] text-faint">{index + 1}</span>
              {item.icon}
              {item.label}
              <span
                className={`rounded px-1.5 py-px text-[10px] ${step === item.id ? 'bg-accent/25 text-text' : 'bg-panel text-faint'}`}
              >
                {counts[item.id]}
              </span>
            </button>
          ))}
        </nav>
        <button
          type="button"
          aria-label="Palette de commandes"
          onClick={() => commandStore.getState().setOpen(true)}
          className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:text-text"
        >
          <CommandIcon size={13} /> <Kbd>⌘K</Kbd>
        </button>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">
        {step === 'script' && (
          <ScriptStep
            projectId={projectId}
            canEdit={canEdit}
            scripts={scripts}
            refreshScripts={refreshScripts}
            providers={providers}
            onJob={(job) => {
              track(job);
              toast('Claude travaille : la proposition arrivera dans « Propositions »', {
                kind: 'ai',
              });
            }}
          />
        )}
        {step === 'proposals' && (
          <ProposalsStep
            projectId={projectId}
            canEdit={canEdit}
            jobs={jobs}
            onApplied={(kind) => {
              refreshJobs();
              refreshBible();
              refreshBoard();
              setStep(kind === 'breakdown' ? 'shots' : 'bible');
            }}
          />
        )}
        {step === 'bible' && (
          <BibleStep
            projectId={projectId}
            canEdit={canEdit}
            entries={bible}
            refresh={refreshBible}
            providers={providers}
            jobs={jobs}
            onJob={track}
          />
        )}
        {step === 'shots' && (
          <ShotsStep
            canEdit={canEdit}
            board={board}
            refresh={refreshBoard}
            bible={bible}
            providers={providers}
            fps={fps}
          />
        )}
      </main>
    </div>
  );
}
