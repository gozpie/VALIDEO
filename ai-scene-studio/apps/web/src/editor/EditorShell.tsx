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
import { SHORTCUTS, useKeymap } from './keymap';
import { RenderPanel } from './RenderPanel';
import { Timeline } from './Timeline';
import { Toolbar, type SaveStatus } from './Toolbar';
import { usePlayback } from './usePlayback';
import { useShortcuts, type ShortcutHandlers } from './useShortcuts';
import type { ViewDirection, ViewSettings } from './Viewport';

// WebGL : rendu uniquement dans le navigateur.
const Viewport = dynamic(() => import('./Viewport').then((module) => module.Viewport), {
  ssr: false,
  loading: () => <p className="p-4 text-sm text-muted">Initialisation de la vue 3D…</p>,
});
const CameraViewport = dynamic(
  () => import('./CameraViewport').then((module) => module.CameraViewport),
  { ssr: false },
);

interface Props {
  shotId: string;
  workspaceId: string;
  title: string;
  backHref: string;
  canEdit: boolean;
  scene: SceneDocument;
  revisionId: string | null;
}

function Shortcuts(handlers: ShortcutHandlers) {
  useShortcuts(handlers);
  usePlayback();
  return null;
}

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
  const [panel, setPanel] = useState<'inspector' | 'render'>('inspector');
  const [addMenu, setAddMenu] = useState(false);
  const [help, setHelp] = useState(false);
  const [keymap, setKeymap] = useKeymap();
  const saving = useRef(false);

  const save = useCallback(async (): Promise<boolean> => {
    const state = store.getState();
    if (!canEdit || saving.current) return false;
    if (!isDirty(state)) return true;
    const snapshot = state.scene;
    const checked = validateScene(snapshot);
    if (!checked.success) {
      setSaveStatus({
        kind: 'error',
        message: `Scène invalide : ${checked.issues[0]?.message ?? ''}`,
      });
      return false;
    }
    saving.current = true;
    setSaveStatus({ kind: 'saving' });
    try {
      const result = await call(
        api.POST('/shots/{shot_id}/scene/revisions', {
          params: { path: { shot_id: shotId } },
          body: {
            baseRevisionId: state.baseRevisionId,
            snapshot: snapshot as unknown as Record<string, unknown>,
          },
        }),
      );
      store.getState().markSaved(snapshot, result.revision.id);
      setSaveStatus({ kind: 'idle' });
      return true;
    } catch (error) {
      setSaveStatus({ kind: 'error', message: (error as Error).message });
      return false;
    } finally {
      saving.current = false;
    }
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
  const showView = useCallback(
    (direction: ViewDirection) =>
      setView((current) => ({ ...current, direction, nonce: current.nonce + 1 })),
    [],
  );
  const toggleProjection = useCallback(
    () =>
      setView((current) => ({
        ...current,
        projection: current.projection === 'perspective' ? 'orthographic' : 'perspective',
        nonce: current.nonce + 1,
      })),
    [],
  );
  const tab = (id: 'inspector' | 'render', label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={panel === id}
      onClick={() => setPanel(id)}
      className={`flex-1 border-b-2 px-2 py-1 text-xs ${panel === id ? 'border-accent text-text' : 'border-transparent text-muted'}`}
    >
      {label}
    </button>
  );

  return (
    <EditorContext.Provider value={context}>
      <Shortcuts
        keymap={keymap}
        onSave={() => void save()}
        onToggleBoxSelect={toggleBox}
        onView={showView}
        onToggleProjection={toggleProjection}
        onAddMenu={() => setAddMenu(true)}
      />
      <div className="fixed inset-0 z-10 flex flex-col bg-surface">
        <Toolbar
          title={title}
          backHref={backHref}
          saveStatus={saveStatus}
          onSave={() => void save()}
          view={view}
          onView={setView}
          boxSelect={boxSelect}
          onBoxSelect={toggleBox}
          keymap={keymap}
          onKeymap={setKeymap}
          onHelp={() => setHelp((value) => !value)}
        />
        <div className="grid min-h-0 flex-1 grid-cols-[16rem_1fr_19rem]">
          <aside className="flex min-h-0 flex-col gap-4 overflow-auto border-r border-border bg-panel p-3">
            {canEdit && <AddMenu workspaceId={workspaceId} />}
            <Hierarchy />
          </aside>
          <div className="relative min-h-0">
            <Views view={view} boxSelect={boxSelect} />
            {addMenu && canEdit && (
              <div
                role="dialog"
                aria-label="Menu d’ajout"
                className="absolute left-1/2 top-1/3 z-20 w-80 -translate-x-1/2 rounded-lg border border-border bg-panel p-3 shadow-xl"
                onClick={(event) => {
                  if ((event.target as HTMLElement).tagName === 'BUTTON') setAddMenu(false);
                }}
                onKeyDown={(event) => event.key === 'Escape' && setAddMenu(false)}
              >
                <AddMenu workspaceId={workspaceId} />
                <button
                  type="button"
                  className="mt-2 text-xs text-muted hover:text-text"
                  onClick={() => setAddMenu(false)}
                >
                  Fermer (Échap)
                </button>
              </div>
            )}
            {help && (
              <div
                role="dialog"
                aria-label="Raccourcis clavier"
                className="absolute right-3 top-3 z-20 max-h-[80%] w-[28rem] overflow-auto rounded-lg border border-border bg-panel p-3 text-xs shadow-xl"
              >
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="font-semibold">
                    Raccourcis ({keymap === 'blender' ? 'façon Blender' : 'standard'})
                  </h2>
                  <button
                    type="button"
                    className="text-muted hover:text-text"
                    onClick={() => setHelp(false)}
                  >
                    Fermer
                  </button>
                </div>
                <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1">
                  {SHORTCUTS[keymap].map(([keys, action]) => (
                    <div key={keys} className="contents">
                      <dt className="font-mono text-accent">{keys}</dt>
                      <dd className="text-muted">{action}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
          <aside className="flex min-h-0 flex-col border-l border-border bg-panel">
            <div role="tablist" className="flex border-b border-border">
              {tab('inspector', 'Inspecteur')}
              {tab('render', 'Rendu')}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {panel === 'inspector' ? (
                <Inspector />
              ) : (
                <RenderPanel shotId={shotId} onSave={save} />
              )}
            </div>
          </aside>
        </div>
        <div className="h-56 shrink-0">
          <Timeline />
        </div>
      </div>
    </EditorContext.Provider>
  );
}
