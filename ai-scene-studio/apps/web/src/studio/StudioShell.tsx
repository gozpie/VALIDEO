'use client';

import type { GenerationJob, Project, Workspace } from '@ass/api-client';
import { useCallback, useEffect, useState } from 'react';
import { AppShell, STUDIO_STEPS, type StudioStep } from '@/components/AppShell';
import { api, call } from '@/lib/api';
import { useCommandSource } from '@/lib/commands';
import { toast } from '@/lib/toast';
import { BibleStep } from './BibleStep';
import { useBible, useJobs, useProviders, useScripts, useStoryboard } from './data';
import { formatTime, MontageStep } from './MontageStep';
import { ProposalsStep } from './ProposalsStep';
import { ScriptStep } from './ScriptStep';
import { ShotsStep } from './ShotsStep';

/**
 * Studio de production d'un projet : le flux de fabrication du film, étape par étape —
 * script → propositions de Claude (découpage, bible) → bible → plans (versions, A/B).
 */
export function StudioShell({ project, workspace }: { project: Project; workspace: Workspace }) {
  const projectId = project.id;
  const canEdit = workspace.role !== 'viewer';
  const fps = project.fps.numerator / (project.fps.denominator ?? 1);
  const [step, setStep] = useState<StudioStep>('script');
  // L'étape est dans l'adresse (#shots) : retour, rechargement et liens de la barre latérale.
  useEffect(() => {
    const fromHash = () => {
      const hash = window.location.hash.slice(1);
      if (STUDIO_STEPS.some((item) => item.id === hash)) setStep(hash as StudioStep);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);
  const goTo = useCallback((next: StudioStep) => {
    window.history.replaceState(null, '', `#${next}`);
    setStep(next);
  }, []);
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
      if (job.mode === 'gozcut_project') {
        toast('Projet gozCut créé', { kind: 'success' });
      } else if (job.mode === 'script_breakdown' || job.mode === 'bible_from_script') {
        toast(job.mode === 'script_breakdown' ? 'Découpage proposé' : 'Bible proposée', {
          kind: 'ai',
          duration: 0,
          action: { label: 'Voir', run: () => goTo('proposals') },
        });
      } else {
        toast('Nouvelle image dans la bible', { kind: 'ai' });
        refreshBible();
      }
    },
    [refreshBible, goTo],
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
    montage: formatTime(shots.reduce((n, s) => n + s.durationFrames / fps, 0)),
  };

  useCommandSource(
    'studio',
    STUDIO_STEPS.map((item, index) => ({
      id: `studio-${item.id}`,
      label: `Studio : ${item.label}`,
      group: 'Studio',
      shortcut: String(index + 1),
      run: () => goTo(item.id),
    })),
  );

  const stepTitle = STUDIO_STEPS.find((item) => item.id === step)?.label ?? '';
  return (
    <AppShell
      page={step}
      workspace={workspace}
      project={project}
      crumbs={[
        { label: workspace.name, href: `/workspaces/${workspace.id}` },
        { label: project.name, href: `/projects/${projectId}` },
      ]}
      title={stepTitle}
      counts={counts}
      onStep={goTo}
      flush
      aside={
        <span className="text-xs tabular-nums text-faint">
          {project.resolution.width}×{project.resolution.height} · {fps} i/s
        </span>
      }
    >
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
            goTo(kind === 'breakdown' ? 'shots' : 'bible');
          }}
        />
      )}
      {step === 'montage' && (
        <MontageStep
          projectId={projectId}
          canEdit={canEdit}
          board={board}
          fps={fps}
          providers={providers}
          jobs={jobs}
          onJob={track}
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
    </AppShell>
  );
}
