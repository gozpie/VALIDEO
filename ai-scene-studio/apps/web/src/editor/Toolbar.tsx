'use client';

import { isDirty, type CameraView, type Tool } from '@ass/editor-ui';
import { setActiveCamera } from '@ass/scene-engine';
import type { Keymap } from './keymap';
import {
  ArrowLeft,
  Command as CommandIcon,
  Keyboard,
  Magnet,
  Move3d,
  Redo2,
  Rotate3d,
  Save,
  Scaling,
  Scan,
  SquareDashedMousePointer,
  Undo2,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Tooltip } from '@/components/Kbd';
import { commandStore } from '@/lib/commands';
import { useEditor, useEditorContext } from './context';
import type { ViewDirection, ViewSettings } from './Viewport';

export type SaveStatus = { kind: 'idle' } | { kind: 'saving' } | { kind: 'error'; message: string };

const TOOLS: { tool: Tool; label: string; key: [string, string]; icon: ReactNode }[] = [
  { tool: 'translate', label: 'Déplacer', key: ['G', 'W'], icon: <Move3d size={15} /> },
  { tool: 'rotate', label: 'Pivoter', key: ['R', 'E'], icon: <Rotate3d size={15} /> },
  { tool: 'scale', label: 'Échelle', key: ['S', 'R'], icon: <Scaling size={15} /> },
];

const VIEWS: { direction: ViewDirection; label: string }[] = [
  { direction: 'front', label: 'Avant' },
  { direction: 'back', label: 'Arrière' },
  { direction: 'left', label: 'Gauche' },
  { direction: 'right', label: 'Droite' },
  { direction: 'top', label: 'Dessus' },
  { direction: 'bottom', label: 'Dessous' },
];

interface Props {
  title: string;
  backHref: string;
  saveStatus: SaveStatus;
  onSave: () => void;
  view: ViewSettings;
  onView: (view: ViewSettings) => void;
  boxSelect: boolean;
  onBoxSelect: () => void;
  keymap: Keymap;
  onKeymap: (keymap: Keymap) => void;
  onHelp: () => void;
}

const button =
  'flex h-7 items-center gap-1.5 rounded-md border border-transparent px-2 text-xs text-muted transition-colors hover:bg-hover hover:text-text disabled:pointer-events-none disabled:opacity-35';
const iconButton = `${button} w-7 justify-center px-0`;
const active = 'border-accent/60 bg-accent/20 text-text';
const select =
  'h-7 rounded-md border border-border bg-surface px-1.5 text-xs text-text hover:border-border-strong focus:border-accent focus:outline-none disabled:opacity-50';
const divider = <span className="mx-1 h-5 w-px bg-border" />;

export function Toolbar({
  title,
  backHref,
  saveStatus,
  onSave,
  view,
  onView,
  boxSelect,
  onBoxSelect,
  keymap,
  onKeymap,
  onHelp,
}: Props) {
  const { store, canEdit, viewport } = useEditorContext();
  const dirty = useEditor(isDirty);
  const canUndo = useEditor((state) => state.past.length > 0);
  const canRedo = useEditor((state) => state.future.length > 0);
  const tool = useEditor((state) => state.tool);
  const snapping = useEditor((state) => state.snapping);
  const cameras = useEditor((state) => state.scene.cameras);
  const activeCameraId = useEditor((state) => state.scene.activeCameraId);
  const cameraView = useEditor((state) => state.cameraView);
  const state = store.getState();

  const status =
    saveStatus.kind === 'saving'
      ? 'Enregistrement…'
      : saveStatus.kind === 'error'
        ? saveStatus.message
        : dirty
          ? 'Modifications non enregistrées'
          : 'Enregistré';

  return (
    <header className="relative z-20 flex items-center gap-1.5 border-b border-border bg-panel px-3 py-1.5">
      <Tooltip label="Retour au projet">
        <Link href={backHref} aria-label="Retour au projet" className={iconButton}>
          <ArrowLeft size={15} />
        </Link>
      </Tooltip>
      <img
        src="/brand/favicon-chagomi.png"
        alt="Chagomi"
        className="brand-mark ml-0.5 h-6 w-6 rounded-md"
      />
      <h1 className="ml-1 max-w-56 truncate text-sm font-semibold">{title}</h1>
      <span
        role="status"
        className={`ml-2 flex items-center gap-1.5 text-xs ${saveStatus.kind === 'error' ? 'text-error' : dirty ? 'text-warn' : 'text-faint'}`}
      >
        {status}
      </span>
      {canEdit && (
        <Tooltip label="Enregistrer" shortcut="⌘S">
          <button
            type="button"
            className="ml-2 flex h-7 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white shadow-card transition-colors hover:bg-accent-strong disabled:opacity-40"
            disabled={!dirty || saveStatus.kind === 'saving'}
            onClick={onSave}
          >
            <Save size={13} />
            Enregistrer
          </button>
        </Tooltip>
      )}
      <div className="min-w-2 flex-1" />
      {canEdit && (
        <>
          <Tooltip label="Annuler" shortcut="⌘Z">
            <button
              type="button"
              aria-label="Annuler"
              className={iconButton}
              disabled={!canUndo}
              onClick={state.undo}
            >
              <Undo2 size={15} />
            </button>
          </Tooltip>
          <Tooltip label="Rétablir" shortcut="⇧⌘Z">
            <button
              type="button"
              aria-label="Rétablir"
              className={iconButton}
              disabled={!canRedo}
              onClick={state.redo}
            >
              <Redo2 size={15} />
            </button>
          </Tooltip>
          {divider}
          <div className="flex rounded-lg bg-surface p-0.5" role="group" aria-label="Outils">
            {TOOLS.map((item) => (
              <Tooltip
                key={item.tool}
                label={item.label}
                shortcut={keymap === 'blender' ? item.key[0] : item.key[1]}
              >
                <button
                  type="button"
                  aria-label={item.label}
                  aria-pressed={tool === item.tool}
                  className={`${iconButton} ${tool === item.tool ? active : ''}`}
                  onClick={() => state.setTool(item.tool)}
                >
                  {item.icon}
                </button>
              </Tooltip>
            ))}
          </div>
          <Tooltip label="Magnétisme (pas de déplacement, rotation, échelle)">
            <button
              type="button"
              aria-label="Magnétisme"
              aria-pressed={snapping.enabled}
              className={`${iconButton} ${snapping.enabled ? active : ''}`}
              onClick={() => state.setSnapping({ enabled: !snapping.enabled })}
            >
              <Magnet size={15} />
            </button>
          </Tooltip>
          {snapping.enabled && (
            <span className="flex items-center gap-1 text-xs">
              {(
                [
                  ['translate', 'm', 0.01],
                  ['rotateDegrees', '°', 1],
                  ['scale', '×', 0.01],
                ] as const
              ).map(([key, unit, min]) => (
                <label key={key} className="flex items-center gap-0.5">
                  <input
                    type="number"
                    aria-label={`Pas de magnétisme (${unit})`}
                    min={min}
                    step={min}
                    value={snapping[key]}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isFinite(value) && value >= min)
                        state.setSnapping({ [key]: value });
                    }}
                    className="h-6 w-14 rounded-md border border-border bg-surface px-1 font-mono"
                  />
                  {unit}
                </label>
              ))}
            </span>
          )}
          <Tooltip label="Sélection rectangle" shortcut="B">
            <button
              type="button"
              aria-label="Sélection rectangle"
              aria-pressed={boxSelect}
              className={`${iconButton} ${boxSelect ? active : ''}`}
              onClick={onBoxSelect}
            >
              <SquareDashedMousePointer size={15} />
            </button>
          </Tooltip>
        </>
      )}
      {divider}
      <select
        aria-label="Caméra active"
        disabled={!canEdit}
        className={`${select} max-w-32`}
        value={activeCameraId ?? ''}
        onChange={(event) => state.apply((s) => setActiveCamera(s, event.target.value || null))}
      >
        <option value="">Aucune caméra active</option>
        {cameras.map((camera) => (
          <option key={camera.id} value={camera.id}>
            {camera.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Disposition des vues"
        className={select}
        value={cameraView}
        onChange={(event) => state.setCameraView(event.target.value as CameraView)}
      >
        <option value="free">Vue libre</option>
        <option value="camera">Vue caméra</option>
        <option value="split">Libre + caméra</option>
      </select>
      <button
        type="button"
        className={button}
        onClick={() =>
          onView({
            ...view,
            projection: view.projection === 'perspective' ? 'orthographic' : 'perspective',
            nonce: view.nonce + 1,
          })
        }
      >
        {view.projection === 'perspective' ? 'Perspective' : 'Orthographique'}
      </button>
      <select
        aria-label="Vue"
        className={select}
        value=""
        onChange={(event) =>
          onView({ ...view, direction: event.target.value as ViewDirection, nonce: view.nonce + 1 })
        }
      >
        <option value="" disabled>
          Vue…
        </option>
        {VIEWS.map((item) => (
          <option key={item.direction} value={item.direction}>
            {item.label}
          </option>
        ))}
      </select>
      <Tooltip label="Cadrer la sélection" shortcut={keymap === 'blender' ? 'Pavé .' : 'F'}>
        <button
          type="button"
          aria-label="Cadrer la sélection"
          className={iconButton}
          onClick={() => viewport.current?.frameSelection()}
        >
          <Scan size={15} />
        </button>
      </Tooltip>
      <select
        aria-label="Disposition des raccourcis"
        className={select}
        value={keymap}
        onChange={(event) => onKeymap(event.target.value as Keymap)}
      >
        <option value="blender">Clavier Blender</option>
        <option value="standard">Clavier standard</option>
      </select>
      <Tooltip label="Aide des raccourcis" shortcut="?">
        <button
          type="button"
          className={iconButton}
          onClick={onHelp}
          aria-label="Aide des raccourcis"
        >
          <Keyboard size={15} />
        </button>
      </Tooltip>
      <Tooltip label="Palette de commandes" shortcut="⌘K">
        <button
          type="button"
          className={iconButton}
          aria-label="Palette de commandes"
          onClick={() => commandStore.getState().setOpen(true)}
        >
          <CommandIcon size={15} />
        </button>
      </Tooltip>
    </header>
  );
}
