'use client';

import type { Project, SceneState, Shot, Workspace } from '@ass/api-client';
import { createEmptyScene, migrateScene, type SceneDocument } from '@ass/scene-schema';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RequireAuth } from '@/components/RequireAuth';
import { ErrorText } from '@/components/ui';
import { EditorShell } from '@/editor/EditorShell';
import { api, call } from '@/lib/api';

interface Loaded {
  shot: Shot;
  project: Project;
  workspace: Workspace;
  state: SceneState;
  scene: SceneDocument;
}

/** Scène enregistrée (migrée vers la version courante) ou nouvelle scène aux réglages du plan. */
function sceneFor(state: SceneState, shot: Shot, project: Project): SceneDocument {
  // Lecture migrée vers la version courante du format ; lève une erreur explicite si illisible.
  if (state.snapshot) return migrateScene(state.snapshot);
  return createEmptyScene({
    sceneId: globalThis.crypto.randomUUID(),
    fps: {
      numerator: shot.effectiveFps.numerator,
      denominator: shot.effectiveFps.denominator ?? 1,
    },
    durationFrames: shot.durationFrames,
    width: project.resolution.width,
    height: project.resolution.height,
  });
}

function Editor({ shotId }: { shotId: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const shot = await call(
        api.GET('/shots/{shot_id}', { params: { path: { shot_id: shotId } } }),
      );
      const project = await call(
        api.GET('/projects/{project_id}', { params: { path: { project_id: shot.projectId } } }),
      );
      const [workspace, state] = await Promise.all([
        call(
          api.GET('/workspaces/{workspace_id}', {
            params: { path: { workspace_id: project.workspaceId } },
          }),
        ),
        call(api.GET('/shots/{shot_id}/scene', { params: { path: { shot_id: shotId } } })),
      ]);
      setLoaded({ shot, project, workspace, state, scene: sceneFor(state, shot, project) });
    })().catch((reason: Error) => setError(reason.message));
  }, [shotId]);

  if (error) return <ErrorText>{error}</ErrorText>;
  if (!loaded) return <p className="text-muted">Chargement de la scène…</p>;
  return (
    <EditorShell
      shotId={shotId}
      workspaceId={loaded.workspace.id}
      title={`${loaded.project.name} — ${loaded.shot.name}`}
      backHref={`/projects/${loaded.project.id}`}
      canEdit={loaded.workspace.role !== 'viewer'}
      scene={loaded.scene}
      revisionId={loaded.state.headRevision?.id ?? null}
    />
  );
}

export default function EditorPage() {
  const { shotId } = useParams<{ shotId: string }>();
  return <RequireAuth>{() => <Editor shotId={shotId} />}</RequireAuth>;
}
