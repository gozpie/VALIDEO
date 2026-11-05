'use client';

import { createEditorStore, isDirty } from '@ass/editor-ui';
import { validateScene, type SceneDocument } from '@ass/scene-schema';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Object3D } from 'three';
import { useStore } from 'zustand';
import { ResizeHandle, useResizable } from '@/components/Resizable';
import { api, call } from '@/lib/api';
import { useCommandSource } from '@/lib/commands';
import { API_URL } from '@/lib/config';
import { toast } from '@/lib/toast';
import { AddMenu } from './AddMenu';
import { AiPanel } from './AiPanel';
import { EditorContext, useEditor, type ViewportApi } from './context';
import { Hierarchy } from './Hierarchy';
import { Inspector } from './Inspector';
import { SHORTCUTS, useKeymap } from './keymap';
import { editorCommands, type EditorPanel } from './paletteCommands';
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
      shotId,
      store,
      canEdit,
      objects,
      viewport,
      assetUrl: (id: string) => `${API_URL}/assets/${id}/content`,
    }),
    [shotId, store, canEdit, objects],
  );
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: 'idle' });
  const [view, setView] = useState<ViewSettings>({
    projection: 'perspective',
    direction: 'free',
    nonce: 0,
  });
  const [boxSelect, setBoxSelect] = useState(false);
  const [panel, setPanel] = useState<EditorPanel>('inspector');
  // Venu d'une proposition de Claude (#ia) : l'onglet IA s'ouvre directement.
  useEffect(() => {
    if (window.location.hash === '#ia') setPanel('ai');
  }, []);
  const [leftWidth, setLeftWidth] = useResizable('editor.left', 256, 180, 480);
  const [rightWidth, setRightWidth] = useResizable('editor.right', 304, 240, 560);
  const [timelineHeight, setTimelineHeight] = useResizable('editor.timeline', 224, 120, 520);
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
      toast(`Enregistrement impossible : ${(error as Error).message}`, { kind: 'error' });
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
  // Les commandes de la palette suivent la sélection et l'historique (états désactivés à jour).
  useStore(
    store,
    (state) => `${state.selection.length}:${state.past.length}:${state.future.length}`,
  );
  useCommandSource(
    'editor',
    editorCommands({
      store,
      canEdit,
      keymap,
      viewport,
      save: () => void save(),
      showView,
      toggleProjection,
      setPanel,
      setKeymap,
      toggleHelp: () => setHelp((value) => !value),
    }),
  );

  const tab = (id: EditorPanel, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={panel === id}
      onClick={() => setPanel(id)}
      className={`flex-1 border-b-2 px-2 py-2 text-xs font-medium transition-colors ${panel === id ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'}`}
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
        <div className="flex min-h-0 flex-1">
          <aside
            style={{ width: leftWidth }}
            className="flex min-h-0 shrink-0 flex-col gap-4 overflow-auto bg-panel p-3"
          >
            {canEdit && <AddMenu workspaceId={workspaceId} />}
            <Hierarchy />
          </aside>
          <ResizeHandle
            label="Largeur du panneau de gauche"
            orientation="vertical"
            size={leftWidth}
            direction={1}
            defaultSize={256}
            onResize={setLeftWidth}
          />
          <div className="relative min-h-0 min-w-0 flex-1">
            <Views view={view} boxSelect={boxSelect} />
            {addMenu && canEdit && (
              <div
                role="dialog"
                aria-label="Menu d’ajout"
                className="absolute left-1/2 top-1/3 z-20 w-80 -translate-x-1/2 animate-pop-in rounded-lg border border-border bg-elevated p-3 shadow-pop"
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
                className="absolute right-3 top-3 z-20 max-h-[80%] w-[28rem] animate-pop-in overflow-auto rounded-lg border border-border bg-elevated p-3 text-xs shadow-pop"
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
          <ResizeHandle
            label="Largeur du panneau de droite"
            orientation="vertical"
            size={rightWidth}
            direction={-1}
            defaultSize={304}
            onResize={setRightWidth}
          />
          <aside style={{ width: rightWidth }} className="flex min-h-0 shrink-0 flex-col bg-panel">
            <div role="tablist" className="flex border-b border-border">
              {tab('inspector', 'Inspecteur')}
              {tab('render', 'Rendu')}
              {tab('ai', 'IA')}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {panel === 'inspector' && <Inspector />}
              {panel === 'render' && <RenderPanel shotId={shotId} onSave={save} />}
              {panel === 'ai' && <AiPanel shotId={shotId} onSave={save} />}
            </div>
          </aside>
        </div>
        <ResizeHandle
          label="Hauteur de la timeline"
          orientation="horizontal"
          size={timelineHeight}
          direction={-1}
          defaultSize={224}
          onResize={setTimelineHeight}
        />
        <div style={{ height: timelineHeight }} className="shrink-0">
          <Timeline />
        </div>
      </div>
    </EditorContext.Provider>
  );
}
