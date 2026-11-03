'use client';

import type { Project, Workspace } from '@ass/api-client';
import {
  Clapperboard,
  Film,
  FileText,
  FolderKanban,
  LayoutGrid,
  ListTree,
  Sparkles,
  Users,
  UsersRound,
} from 'lucide-react';
import Link from 'next/link';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { api, call } from '@/lib/api';
import { AppSidebar, type SidebarItem, type SidebarSection } from './AppSidebar';

export type StudioStep = 'script' | 'proposals' | 'bible' | 'shots' | 'montage';

export const STUDIO_STEPS: { id: StudioStep; label: string; icon: ReactNode }[] = [
  { id: 'script', label: 'Script', icon: <FileText size={18} /> },
  { id: 'proposals', label: 'Propositions', icon: <Sparkles size={18} /> },
  { id: 'bible', label: 'Bible', icon: <Users size={18} /> },
  { id: 'shots', label: 'Plans', icon: <LayoutGrid size={18} /> },
  { id: 'montage', label: 'Montage', icon: <Film size={18} /> },
];

export type ShellPage = 'workspaces' | 'projects' | 'members' | 'structure' | StudioStep;

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Coquille de Chagomi : barre latérale persistante, fil d'Ariane et contenu. La barre s'adapte au
 * contexte : étapes de production quand un projet est ouvert, projets du workspace, membres.
 */
export function AppShell({
  page,
  workspace,
  project,
  crumbs,
  title,
  aside,
  counts,
  onStep,
  refreshKey,
  flush = false,
  children,
}: {
  page: ShellPage;
  workspace?: Workspace | null;
  project?: Project | null;
  crumbs: Crumb[];
  title: string;
  aside?: ReactNode;
  counts?: Partial<Record<StudioStep, string>>;
  /** Dans le studio : changer d'étape sans recharger. Ailleurs, les étapes sont des liens. */
  onStep?: (step: StudioStep) => void;
  /** Change quand la liste des projets doit être relue (projet créé). */
  refreshKey?: number;
  /** Le contenu gère lui-même ses marges et son défilement. */
  flush?: boolean;
  children: ReactNode;
}) {
  const workspaceId = workspace?.id;
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => {
    if (!workspaceId) return;
    call(
      api.GET('/workspaces/{workspace_id}/projects', {
        params: { path: { workspace_id: workspaceId } },
      }),
    )
      .then((list) => setProjects(list.items))
      .catch(() => setProjects([]));
  }, [workspaceId, refreshKey]);

  const sections: SidebarSection[] = [];
  if (project) {
    const steps: SidebarItem[] = STUDIO_STEPS.map((step) => {
      const badge = counts?.[step.id];
      return {
        id: step.id,
        label: step.label,
        icon: step.icon,
        active: page === step.id,
        ...(badge !== undefined ? { badge } : {}),
        ...(onStep
          ? { onSelect: () => onStep(step.id) }
          : { href: `/projects/${project.id}/studio#${step.id}` }),
      };
    });
    sections.push({
      title: 'Production',
      items: [
        ...steps,
        {
          id: 'structure',
          label: 'Structure et réglages',
          icon: <ListTree size={18} />,
          active: page === 'structure',
          href: `/projects/${project.id}`,
        },
      ],
    });
  }
  if (workspace) {
    sections.push({
      title: 'Projets',
      items: projects.map((other) => ({
        id: other.id,
        label: other.name,
        icon: <Clapperboard size={17} />,
        current: other.id === project?.id,
        href: `/projects/${other.id}/studio`,
      })),
      action: { label: 'Nouveau projet', href: `/workspaces/${workspace.id}#nouveau-projet` },
    });
  }
  sections.push({
    title: 'Espace de travail',
    items: [
      {
        id: 'workspaces',
        label: 'Workspaces',
        icon: <FolderKanban size={18} />,
        active: page === 'workspaces',
        href: '/workspaces',
      },
      ...(workspace
        ? [
            {
              id: 'all-projects',
              label: workspace.name,
              icon: <LayoutGrid size={18} />,
              active: page === 'projects',
              href: `/workspaces/${workspace.id}`,
            },
            {
              id: 'members',
              label: 'Membres',
              icon: <UsersRound size={18} />,
              active: page === 'members',
              href: `/workspaces/${workspace.id}/members`,
            },
          ]
        : []),
    ],
  });

  return (
    <div className="fixed inset-0 z-10 flex bg-surface">
      <AppSidebar subtitle={workspace?.name ?? 'Studio de production'} sections={sections} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-5">
          <nav
            aria-label="Fil d’Ariane"
            className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted"
          >
            {crumbs.map((crumb) => (
              <Fragment key={crumb.label}>
                {crumb.href ? (
                  <Link href={crumb.href} className="truncate hover:text-text">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="truncate">{crumb.label}</span>
                )}
                <span className="text-faint">/</span>
              </Fragment>
            ))}
            <h1 className="truncate text-[15px] font-bold text-text">{title}</h1>
          </nav>
          {aside && <div className="ml-auto flex shrink-0 items-center gap-2">{aside}</div>}
        </header>
        <main className={`flex min-h-0 flex-1 flex-col ${flush ? '' : 'overflow-auto'}`}>
          {children}
        </main>
      </div>
    </div>
  );
}
