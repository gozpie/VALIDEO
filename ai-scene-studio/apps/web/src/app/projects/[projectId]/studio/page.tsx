'use client';

import type { Project, Workspace } from '@ass/api-client';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RequireAuth } from '@/components/RequireAuth';
import { ErrorText } from '@/components/ui';
import { api, call } from '@/lib/api';
import { StudioShell } from '@/studio/StudioShell';

function Studio({ projectId }: { projectId: string }) {
  const [loaded, setLoaded] = useState<{ project: Project; workspace: Workspace } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const project = await call(
        api.GET('/projects/{project_id}', { params: { path: { project_id: projectId } } }),
      );
      const workspace = await call(
        api.GET('/workspaces/{workspace_id}', {
          params: { path: { workspace_id: project.workspaceId } },
        }),
      );
      setLoaded({ project, workspace });
    })().catch((reason: Error) => setError(reason.message));
  }, [projectId]);
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!loaded) return <p className="text-muted">Ouverture du studio…</p>;
  return <StudioShell project={loaded.project} workspace={loaded.workspace} />;
}

export default function StudioPage() {
  const { projectId } = useParams<{ projectId: string }>();
  return <RequireAuth>{() => <Studio projectId={projectId} />}</RequireAuth>;
}
