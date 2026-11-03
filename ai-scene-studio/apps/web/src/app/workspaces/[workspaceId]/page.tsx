'use client';

import type { Project, Workspace } from '@ass/api-client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { RequireAuth } from '@/components/RequireAuth';
import { Select } from '@/components/Select';
import { Button, ErrorText, Field, Panel } from '@/components/ui';
import { api, call } from '@/lib/api';
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

  if (error) return <ErrorText>{error}</ErrorText>;
  if (!workspace) return <p className="text-muted">Chargement…</p>;
  const canEdit = workspace.role !== 'viewer';
  const isAdmin = workspace.role === 'admin' || workspace.role === 'owner';
  const path = { workspace_id: workspaceId };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">{workspace.name}</h1>
        <Link
          href={`/workspaces/${workspaceId}/members`}
          className="text-sm text-accent hover:underline"
        >
          Membres et invitations
        </Link>
      </div>
      {canEdit && (
        <Panel title="Nouveau projet">
          <CreateProject workspaceId={workspaceId} onCreated={() => void projects.reload()} />
        </Panel>
      )}
      <Panel title="Projets">
        <ErrorText>{projects.error}</ErrorText>
        {!projects.loading && projects.items.length === 0 && (
          <p className="text-sm text-muted">Aucun projet pour l’instant.</p>
        )}
        <ul className="divide-y divide-border">
          {projects.items.map((project) => (
            <li key={project.id} className="flex items-center justify-between py-2">
              <Link href={`/projects/${project.id}`} className="hover:text-accent">
                {project.name}
              </Link>
              <span className="text-xs text-muted">
                {project.resolution.width}×{project.resolution.height} · {formatFps(project.fps)}{' '}
                i/s
              </span>
            </li>
          ))}
        </ul>
        {projects.hasMore && (
          <Button
            className="mt-3"
            onClick={() => void projects.loadMore()}
            disabled={projects.loading}
          >
            Charger plus
          </Button>
        )}
      </Panel>
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
            <Button type="submit">Renommer</Button>
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
  );
}

export default function WorkspacePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  return <RequireAuth>{() => <WorkspaceView workspaceId={workspaceId} />}</RequireAuth>;
}
