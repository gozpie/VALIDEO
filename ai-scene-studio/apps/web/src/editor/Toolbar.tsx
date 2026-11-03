'use client';

import { isDirty, type Tool } from '@ass/editor-ui';
import Link from 'next/link';
import { useEditor, useEditorContext } from './context';
import type { ViewDirection, ViewSettings } from './Viewport';

export type SaveStatus = { kind: 'idle' } | { kind: 'saving' } | { kind: 'error'; message: string };

const TOOLS: { tool: Tool; label: string; key: string }[] = [
  { tool: 'translate', label: 'Déplacer', key: 'W' },
  { tool: 'rotate', label: 'Pivoter', key: 'E' },
  { tool: 'scale', label: 'Échelle', key: 'R' },
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
}

const button =
  'rounded border border-border px-2 py-1 text-xs hover:border-accent disabled:opacity-40';
const active = 'border-accent bg-accent/20';

export function Toolbar({
  title,
  backHref,
  saveStatus,
  onSave,
  view,
  onView,
  boxSelect,
  onBoxSelect,
}: Props) {
  const { store, canEdit, viewport } = useEditorContext();
  const dirty = useEditor(isDirty);
  const canUndo = useEditor((state) => state.past.length > 0);
  const canRedo = useEditor((state) => state.future.length > 0);
  const tool = useEditor((state) => state.tool);
  const snapping = useEditor((state) => state.snapping);
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
    <header className="flex flex-wrap items-center gap-3 border-b border-border bg-panel px-4 py-2">
      <Link href={backHref} className="text-sm text-accent hover:underline">
        ←
      </Link>
      <h1 className="text-sm font-semibold">{title}</h1>
      <span
        role="status"
        className={`text-xs ${saveStatus.kind === 'error' ? 'text-error' : dirty ? 'text-warn' : 'text-muted'}`}
      >
        {status}
      </span>
      <div className="flex-1" />
      {canEdit && (
        <>
          <button
            type="button"
            className={button}
            disabled={!canUndo}
            onClick={state.undo}
            title="Annuler (⌘Z)"
          >
            Annuler
          </button>
          <button
            type="button"
            className={button}
            disabled={!canRedo}
            onClick={state.redo}
            title="Rétablir (⇧⌘Z)"
          >
            Rétablir
          </button>
          <span className="mx-1 h-5 w-px bg-border" />
          {TOOLS.map((item) => (
            <button
              key={item.tool}
              type="button"
              aria-pressed={tool === item.tool}
              className={`${button} ${tool === item.tool ? active : ''}`}
              onClick={() => state.setTool(item.tool)}
              title={`${item.label} (${item.key})`}
            >
              {item.label}
            </button>
          ))}
          <label
            className="flex items-center gap-1 text-xs"
            title="Magnétisme : pas de déplacement (m), de rotation (°) et d'échelle"
          >
            <input
              type="checkbox"
              checked={snapping.enabled}
              onChange={(event) => state.setSnapping({ enabled: event.target.checked })}
            />
            Magnétisme
          </label>
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
                    className="w-14 rounded border border-border bg-surface px-1"
                  />
                  {unit}
                </label>
              ))}
            </span>
          )}
          <button
            type="button"
            aria-pressed={boxSelect}
            className={`${button} ${boxSelect ? active : ''}`}
            onClick={onBoxSelect}
            title="Sélection rectangle (B)"
          >
            Rectangle
          </button>
        </>
      )}
      <span className="mx-1 h-5 w-px bg-border" />
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
        className="rounded border border-border bg-surface px-1 py-1 text-xs"
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
      <button
        type="button"
        className={button}
        onClick={() => viewport.current?.frameSelection()}
        title="Cadrer la sélection (F)"
      >
        Cadrer
      </button>
      {canEdit && (
        <button
          type="button"
          className="rounded bg-accent px-3 py-1 text-xs text-white disabled:opacity-50"
          disabled={!dirty || saveStatus.kind === 'saving'}
          onClick={onSave}
          title="Enregistrer (⌘S)"
        >
          Enregistrer
        </button>
      )}
    </header>
  );
}
