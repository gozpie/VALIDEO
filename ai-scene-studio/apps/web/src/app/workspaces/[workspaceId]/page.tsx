'use client';

import type { Project, Workspace } from '@ass/api-client';
import { Clapperboard } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { RequireAuth } from '@/components/RequireAuth';
import { Select } from '@/components/Select';
import { Button, ErrorText, Field, Panel } from '@/components/ui';
import { api, call } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { FPS_PRESETS, RESOLUTION_PRESETS, formatFps, presetValue } from '@/lib/presets';
import { usePaged } from '@/lib/usePaged';

function CreateProject({ workspaceId, onCreated }: { workspaceId: string; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [fps, setFps] = useState('1');
  const [resolution, setResolution] = useState('0');
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        const body = {
          name,
          fps: presetValue(FPS_PRESETS, fps, { numerator: 24, denominator: 1 }),
          resolution: presetValue(RESOLUTION_PRESETS, resolution, { width: 1920, height: 1080 }),
        };
        call(
          api.POST('/workspaces/{workspace_id}/projects', {
            params: { path: { workspace_id: workspaceId } },
            body,
          }),
        )
          .then(() => {
            setName('');
            setError(null);
            onCreated();
          })
          .catch((reason: Error) => setError(reason.message));
      }}
    >
      <Field
        label="Nom du projet"
        required
        maxLength={200}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Select
        label="Images par seconde"
        value={fps}
        onChange={setFps}
        options={FPS_PRESETS.map((preset, index) => ({
          label: preset.label,
          value: String(index),
        }))}
      />
      <Select
        label="Résolution"
        value={resolution}
        onChange={setResolution}
        options={RESOLUTION_PRESETS.map((preset, index) => ({
          label: preset.label,
          value: String(index),
        }))}
      />
      <Button type="submit" variant="primary">
        Créer le projet
      </Button>
      <div className="sm:col-span-4">
        <ErrorText>{error}</ErrorText>
      </div>
    </form>
  );
}

function WorkspaceView({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rename, setRename] = useState('');
  const [created, setCreated] = useState(0);

  useEffect(() => {
    call(api.GET('/workspaces/{workspace_id}', { params: { path: { workspace_id: workspaceId } } }))
      .then((value) => {
        setWorkspace(value);
        setRename(value.name);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [workspaceId]);

  const fetchPage = useCallback(
    (cursor: string | null) =>
      call(
        api.GET('/workspaces/{workspace_id}/projects', {
          params: { path: { workspace_id: workspaceId }, query: cursor ? { cursor } : {} },
        }),
      ),
    [workspaceId],
  );
  const projects = usePaged<Project>(fetchPage);

  if (error) return <p className="p-10 text-center text-sm text-error">{error}</p>;
  if (!workspace) return <p className="p-10 text-center text-sm text-muted">Chargement…</p>;
  const canEdit = workspace.role !== 'viewer';
  const isAdmin = workspace.role === 'admin' || workspace.role === 'owner';
  const path = { workspace_id: workspaceId };

  return (
    <AppShell
      page="projects"
      workspace={workspace}
      crumbs={[{ label: 'Workspaces', href: '/workspaces' }]}
      title={workspace.name}
      refreshKey={created}
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6">
        <ErrorText>{projects.error}</ErrorText>
        {!projects.loading && projects.items.length === 0 && (
          <EmptyState icon={<Clapperboard size={24} />} title="Aucun projet pour l’instant">
            Créez un projet pour écrire le script, découper le film et fabriquer ses plans.
          </EmptyState>
        )}
        <ul
          aria-label="Projets"
          className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-4"
        >
          {projects.items.map((project) => (
            <li key={project.id}>
              <ProjectCard project={project} />
            </li>
          ))}
        </ul>
        {projects.hasMore && (
          <Button
            className="self-center"
            onClick={() => void projects.loadMore()}
            disabled={projects.loading}
          >
            Charger plus
          </Button>
        )}
        {canEdit && (
          <div id="nouveau-projet" className="scroll-mt-6">
            <Panel title="Nouveau projet">
              <CreateProject
                workspaceId={workspaceId}
                onCreated={() => {
                  void projects.reload();
                  setCreated((value) => value + 1);
                }}
              />
            </Panel>
          </div>
        )}
        {isAdmin && (
          <Panel title="Réglages du workspace">
            <form
              className="flex items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                call(
                  api.PATCH('/workspaces/{workspace_id}', {
                    params: { path },
                    body: { name: rename },
                  }),
                )
                  .then(setWorkspace)
                  .catch((reason: Error) => setError(reason.message));
              }}
            >
              <div className="flex-1">
                <Field
                  label="Nom"
                  required
                  maxLength={120}
                  value={rename}
                  onChange={(e) => setRename(e.target.value)}
                />
              </div>
              <Button type="submit" className="h-10">
                Renommer
              </Button>
            </form>
            {workspace.role === 'owner' && (
              <Button
                variant="danger"
                className="mt-4"
                onClick={() => {
                  if (!window.confirm(`Supprimer « ${workspace.name} » et tous ses projets ?`))
                    return;
                  call(api.DELETE('/workspaces/{workspace_id}', { params: { path } }))
                    .then(() => router.push('/workspaces'))
                    .catch((reason: Error) => setError(reason.message));
                }}
              >
                Supprimer le workspace
              </Button>
            )}
          </Panel>
        )}
      </div>
    </AppShell>
  );
}

/** Carte d'un projet : affiche (première image de ses plans) et avancement de la fabrication. */
function ProjectCard({ project }: { project: Project }) {
  const shots = project.shotCount ?? 0;
  const approved = project.approvedCount ?? 0;
  return (
    <Link
      href={`/projects/${project.id}/studio`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-panel shadow-card transition-all hover:-translate-y-0.5 hover:border-border-strong"
    >
      <div className="relative aspect-video overflow-hidden bg-surface">
        {project.posterAssetId ? (
          <img
            src={`${API_URL}/assets/${project.posterAssetId}/content`}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-accent/15 to-ai/10 text-faint">
            <Clapperboard size={28} />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2 p-3.5">
        <p className="truncate text-[15px] font-semibold">{project.name}</p>
        <p className="flex justify-between gap-3 text-xs tabular-nums text-muted">
          <span>
            {shots} plan{shots > 1 ? 's' : ''} · {approved} validé{approved > 1 ? 's' : ''}
          </span>
          <span className="text-faint">
            {project.resolution.width}×{project.resolution.height} · {formatFps(project.fps)} i/s
          </span>
        </p>
        <div className="h-1 overflow-hidden rounded-full bg-surface">
          <div
            className="h-full rounded-full bg-ok"
            style={{ width: shots ? `${(approved / shots) * 100}%` : 0 }}
          />
        </div>
      </div>
    </Link>
  );
}

export default function WorkspacePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  return <RequireAuth>{() => <WorkspaceView workspaceId={workspaceId} />}</RequireAuth>;
}
