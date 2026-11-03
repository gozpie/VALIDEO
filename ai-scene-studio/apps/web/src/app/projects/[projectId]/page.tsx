'use client';

import type { Project, Sequence, Workspace } from '@ass/api-client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { RequireAuth } from '@/components/RequireAuth';
import { SequenceCard } from '@/components/SequenceCard';
import { Button, ErrorText, Field, Panel } from '@/components/ui';
import { api, call } from '@/lib/api';
import { moveItem } from '@/lib/order';
import { formatFps } from '@/lib/presets';

function ProjectView({ projectId }: { projectId: string }) {
  const router = useRouter();
  const project_id = projectId;
  const [project, setProject] = useState<Project | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [newSequence, setNewSequence] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refreshSequences = useCallback(() => {
    call(api.GET('/projects/{project_id}/sequences', { params: { path: { project_id } } }))
      .then(setSequences)
      .catch((reason: Error) => setError(reason.message));
  }, [project_id]);

  useEffect(() => {
    call(api.GET('/projects/{project_id}', { params: { path: { project_id } } }))
      .then(async (value) => {
        setProject(value);
        setDescription(value.description);
        setWorkspace(
          await call(
            api.GET('/workspaces/{workspace_id}', {
              params: { path: { workspace_id: value.workspaceId } },
            }),
          ),
        );
      })
      .catch((reason: Error) => setError(reason.message));
    refreshSequences();
  }, [project_id, refreshSequences]);

  if (!project || !workspace)
    return error ? <ErrorText>{error}</ErrorText> : <p className="text-muted">Chargement…</p>;
  const canEdit = workspace.role !== 'viewer';
  const canDelete = workspace.role === 'admin' || workspace.role === 'owner';

  const moveSequence = (id: string, offset: -1 | 1) =>
    call(
      api.PUT('/projects/{project_id}/sequences/order', {
        params: { path: { project_id } },
        body: {
          sequenceIds: moveItem(
            sequences.map((s) => s.id),
            id,
            offset,
          ),
        },
      }),
    )
      .then(setSequences)
      .catch((reason: Error) => setError(reason.message));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/workspaces/${project.workspaceId}`}
          className="text-sm text-accent hover:underline"
        >
          ← {workspace.name}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{project.name}</h1>
        <p className="text-sm text-muted">
          {project.resolution.width}×{project.resolution.height} · {formatFps(project.fps)} i/s ·{' '}
          {project.colorSpace}
        </p>
      </div>
      <ErrorText>{error}</ErrorText>
      {canEdit && (
        <Panel title="Nouvelle séquence">
          <form
            className="flex items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              call(
                api.POST('/projects/{project_id}/sequences', {
                  params: { path: { project_id } },
                  body: { name: newSequence },
                }),
              )
                .then(() => {
                  setNewSequence('');
                  refreshSequences();
                })
                .catch((reason: Error) => setError(reason.message));
            }}
          >
            <div className="flex-1">
              <Field
                label="Nom"
                required
                maxLength={200}
                value={newSequence}
                onChange={(e) => setNewSequence(e.target.value)}
              />
            </div>
            <Button type="submit" variant="primary">
              Ajouter la séquence
            </Button>
          </form>
        </Panel>
      )}
      <section aria-label="Séquences" className="flex flex-col gap-4">
        {sequences.length === 0 && (
          <p className="text-sm text-muted">Aucune séquence pour l’instant.</p>
        )}
        {sequences.map((sequence, index) => (
          <SequenceCard
            key={`${sequence.id}-${sequence.name}`}
            sequence={sequence}
            project={project}
            canEdit={canEdit}
            isFirst={index === 0}
            isLast={index === sequences.length - 1}
            onMove={(offset) => void moveSequence(sequence.id, offset)}
            onChanged={refreshSequences}
          />
        ))}
      </section>
      {canEdit && (
        <Panel title="Réglages du projet">
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              call(
                api.PATCH('/projects/{project_id}', {
                  params: { path: { project_id } },
                  body: { description },
                }),
              )
                .then(setProject)
                .catch((reason: Error) => setError(reason.message));
            }}
          >
            <Field
              label="Description"
              maxLength={10000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <Button type="submit" className="self-start">
              Enregistrer
            </Button>
          </form>
          {canDelete && (
            <Button
              variant="danger"
              className="mt-4"
              onClick={() => {
                if (!window.confirm(`Supprimer le projet « ${project.name} » ?`)) return;
                call(api.DELETE('/projects/{project_id}', { params: { path: { project_id } } }))
                  .then(() => router.push(`/workspaces/${project.workspaceId}`))
                  .catch((reason: Error) => setError(reason.message));
              }}
            >
              Supprimer le projet
            </Button>
          )}
        </Panel>
      )}
    </div>
  );
}

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  return <RequireAuth>{() => <ProjectView projectId={projectId} />}</RequireAuth>;
}
