'use client';

import { createEditorStore, isDirty } from '@ass/editor-ui';
import { validateScene, type SceneDocument } from '@ass/scene-schema';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Object3D } from 'three';
import { api, call } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { AddMenu } from './AddMenu';
import { EditorContext, useEditor, type ViewportApi } from './context';
import { Hierarchy } from './Hierarchy';
import { Inspector } from './Inspector';
import { Timeline } from './Timeline';
import { Toolbar, type SaveStatus } from './Toolbar';
import { usePlayback } from './usePlayback';
import { useShortcuts } from './useShortcuts';
import type { ViewSettings } from './Viewport';

// WebGL : rendu uniquement dans le navigateur.
const Viewport = dynamic(() => import('./Viewport').then((module) => module.Viewport), {
  ssr: false,
  loading: () => <p className="p-4 text-sm text-muted">Initialisation de la vue 3D…</p>,
});

interface Props {
  shotId: string;
  workspaceId: string;
  title: string;
  backHref: string;
  canEdit: boolean;
  scene: SceneDocument;
  revisionId: string | null;
}

function Shortcuts({
  onSave,
  onToggleBoxSelect,
}: {
  onSave: () => void;
  onToggleBoxSelect: () => void;
}) {
  useShortcuts({ onSave, onToggleBoxSelect });
  usePlayback();
  return null;
}

const CameraViewport = dynamic(
  () => import('./CameraViewport').then((module) => module.CameraViewport),
  { ssr: false },
);

function Views({ view, boxSelect }: { view: ViewSettings; boxSelect: boolean }) {
  const layout = useEditor((state) => state.cameraView);
  if (layout === 'camera') return <CameraViewport />;
  if (layout === 'split') {
    return (
      <div className="grid h-full grid-cols-2">
        <Viewport view={view} boxSelect={boxSelect} />
        <CameraViewport />
      </div>
    );
  }
  return <Viewport view={view} boxSelect={boxSelect} />;
}

export function EditorShell({
  shotId,
  workspaceId,
  title,
  backHref,
  canEdit,
  scene,
  revisionId,
}: Props) {
  const store = useMemo(() => {
    const created = createEditorStore(scene);
    created.getState().load(scene, revisionId);
    return created;
  }, [scene, revisionId]);
  const objects = useMemo(() => new Map<string, Object3D>(), []);
  const viewport = useRef<ViewportApi | null>(null);
  const context = useMemo(
    () => ({
      store,
      canEdit,
      objects,
      viewport,
      assetUrl: (id: string) => `${API_URL}/assets/${id}/content`,
    }),
    [store, canEdit, objects],
  );
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: 'idle' });
  const [view, setView] = useState<ViewSettings>({
    projection: 'perspective',
    direction: 'free',
    nonce: 0,
  });
  const [boxSelect, setBoxSelect] = useState(false);
  const saving = useRef(false);

  const save = useCallback(() => {
    const state = store.getState();
    if (!canEdit || saving.current || !isDirty(state)) return;
    const snapshot = state.scene;
    const checked = validateScene(snapshot);
    if (!checked.success) {
      setSaveStatus({
        kind: 'error',
        message: `Scène invalide : ${checked.issues[0]?.message ?? ''}`,
      });
      return;
    }
    saving.current = true;
    setSaveStatus({ kind: 'saving' });
    call(
      api.POST('/shots/{shot_id}/scene/revisions', {
        params: { path: { shot_id: shotId } },
        body: {
          baseRevisionId: state.baseRevisionId,
          snapshot: snapshot as unknown as Record<string, unknown>,
        },
      }),
    )
      .then((result) => {
        store.getState().markSaved(snapshot, result.revision.id);
        setSaveStatus({ kind: 'idle' });
      })
      .catch((error: Error) => setSaveStatus({ kind: 'error', message: error.message }))
      .finally(() => {
        saving.current = false;
      });
  }, [store, canEdit, shotId]);

  // Avertit avant de quitter la page avec des modifications non enregistrées.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isDirty(store.getState())) event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [store]);

  const toggleBox = useCallback(() => setBoxSelect((value) => !value), []);

  return (
    <EditorContext.Provider value={context}>
      <Shortcuts onSave={save} onToggleBoxSelect={toggleBox} />
      <div className="fixed inset-0 z-10 flex flex-col bg-surface">
        <Toolbar
          title={title}
          backHref={backHref}
          saveStatus={saveStatus}
          onSave={save}
          view={view}
          onView={setView}
          boxSelect={boxSelect}
          onBoxSelect={toggleBox}
        />
        <div className="grid min-h-0 flex-1 grid-cols-[16rem_1fr_19rem]">
          <aside className="flex min-h-0 flex-col gap-4 overflow-auto border-r border-border bg-panel p-3">
            {canEdit && <AddMenu workspaceId={workspaceId} />}
            <Hierarchy />
          </aside>
          <div className="min-h-0">
            <Views view={view} boxSelect={boxSelect} />
          </div>
          <aside className="min-h-0 overflow-auto border-l border-border bg-panel p-3">
            <Inspector />
          </aside>
        </div>
        <div className="h-56 shrink-0">
          <Timeline />
        </div>
      </div>
    </EditorContext.Provider>
  );
}
