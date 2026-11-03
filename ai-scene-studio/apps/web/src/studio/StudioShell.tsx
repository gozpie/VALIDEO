'use client';

import type { GenerationJob, Project, Workspace } from '@ass/api-client';
import { Clapperboard, FileText, LayoutGrid, Sparkles, Users } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { api, call } from '@/lib/api';
import { useCommandSource } from '@/lib/commands';
import { toast } from '@/lib/toast';
import { BibleStep } from './BibleStep';
import { useBible, useJobs, useProviders, useScripts, useStoryboard } from './data';
import { ProposalsStep } from './ProposalsStep';
import { ScriptStep } from './ScriptStep';
import { ShotsStep } from './ShotsStep';

export type StudioStep = 'script' | 'proposals' | 'bible' | 'shots';

const STEPS: { id: StudioStep; label: string; icon: ReactNode }[] = [
  { id: 'script', label: 'Script', icon: <FileText size={18} /> },
  { id: 'proposals', label: 'Propositions', icon: <Sparkles size={18} /> },
  { id: 'bible', label: 'Bible', icon: <Users size={18} /> },
  { id: 'shots', label: 'Plans', icon: <LayoutGrid size={18} /> },
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
  const [projects, setProjects] = useState<Project[]>([project]);
  useEffect(() => {
    call(
      api.GET('/workspaces/{workspace_id}/projects', {
        params: { path: { workspace_id: workspace.id } },
      }),
    )
      .then((page) => setProjects(page.items))
      .catch(() => undefined);
  }, [workspace.id]);

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

  const stepTitle = STEPS.find((item) => item.id === step)?.label ?? '';
  return (
    <div className="fixed inset-0 z-10 flex bg-surface">
      <AppSidebar
        subtitle={workspace.name}
        sections={[
          {
            title: 'Production',
            items: STEPS.map((item) => ({
              id: item.id,
              label: item.label,
              icon: item.icon,
              badge: counts[item.id],
              active: step === item.id,
              onSelect: () => setStep(item.id),
            })),
          },
          {
            title: 'Projets',
            items: projects.map((other) => ({
              id: other.id,
              label: other.name,
              icon: <Clapperboard size={17} />,
              current: other.id === projectId,
              href:
                other.id === projectId ? `/projects/${other.id}` : `/projects/${other.id}/studio`,
            })),
            action: { label: 'Nouveau projet', href: `/workspaces/${workspace.id}` },
          },
        ]}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-5">
          <nav
            aria-label="Fil d’Ariane"
            className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted"
          >
            <Link href={`/workspaces/${workspace.id}`} className="truncate hover:text-text">
              {workspace.name}
            </Link>
            <span className="text-faint">/</span>
            <Link href={`/projects/${projectId}`} className="truncate hover:text-text">
              {project.name}
            </Link>
            <span className="text-faint">/</span>
            <h1 className="truncate text-[15px] font-bold text-text">{stepTitle}</h1>
          </nav>
          <span className="ml-auto text-xs tabular-nums text-faint">
            {project.resolution.width}×{project.resolution.height} · {fps} i/s
          </span>
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
    </div>
  );
}
