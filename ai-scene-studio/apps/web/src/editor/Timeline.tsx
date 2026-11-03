'use client';

import { moveKeys, setKeysInterpolation, type KeyRef } from '@ass/animation-engine';
import type { Interpolation } from '@ass/scene-schema';
import { addMarker, findEntity, removeMarker } from '@ass/scene-engine';
import { useMemo, useRef, useState } from 'react';
import { useEditor, useEditorContext } from './context';

const PROPERTY_LABELS: Record<string, string> = {
  'transform.position': 'Position',
  'transform.rotation': 'Rotation',
  'transform.scale': 'Échelle',
  visible: 'Visibilité',
  'camera.focalLengthMm': 'Focale',
  'camera.focusDistance': 'Mise au point',
  'camera.aperture': 'Ouverture',
  'camera.rollRadians': 'Roulis',
  'light.intensity': 'Intensité',
  'light.color': 'Couleur',
  'material.opacity': 'Opacité',
};

const INTERPOLATIONS: { value: Interpolation; label: string }[] = [
  { value: 'linear', label: 'Linéaire' },
  { value: 'step', label: 'Palier (step)' },
  { value: 'bezier', label: 'Bézier' },
  { value: 'ease_in', label: 'Ease in' },
  { value: 'ease_out', label: 'Ease out' },
  { value: 'ease_in_out', label: 'Ease in-out' },
];

const button =
  'rounded border border-border px-2 py-0.5 text-xs hover:border-accent disabled:opacity-40';
const LABEL_WIDTH = 176;

function formatTime(frame: number, numerator: number, denominator: number): string {
  const seconds = (frame * denominator) / numerator;
  return `${seconds.toFixed(2).replace('.', ',')} s`;
}

export function Timeline() {
  const { store, canEdit } = useEditorContext();
  const scene = useEditor((state) => state.scene);
  const frame = useEditor((state) => state.frame);
  const playing = useEditor((state) => state.playing);
  const loop = useEditor((state) => state.loop);
  const keySelection = useEditor((state) => state.keySelection);
  const selection = useEditor((state) => state.selection);
  const [pxPerFrame, setPxPerFrame] = useState(8);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<{ startX: number; delta: number } | null>(null);
  const scrub = useRef(false);
  const state = store.getState();
  const duration = scene.durationFrames;
  const width = duration * pxPerFrame;
  const { numerator, denominator } = scene.fps;

  // Pistes groupées par entité : la sélection d'abord, puis le reste de la scène.
  const groups = useMemo(() => {
    const byTarget = new Map<string, typeof scene.animations>();
    for (const track of scene.animations)
      byTarget.set(track.targetId, [...(byTarget.get(track.targetId) ?? []), track]);
    const ids = [...byTarget.keys()].sort(
      (a, b) => Number(selection.includes(b)) - Number(selection.includes(a)),
    );
    return ids.map((id) => {
      const entity = findEntity(scene, id);
      const name = entity?.value.name ?? scene.materials.find((m) => m.id === id)?.name ?? id;
      return { id, name, tracks: byTarget.get(id) ?? [] };
    });
  }, [scene, selection]);

  const frameAt = (clientX: number, element: HTMLElement) => {
    const box = element.getBoundingClientRect();
    return Math.round((clientX - box.left) / pxPerFrame - 0.5);
  };
  const isSelected = (ref: KeyRef) =>
    keySelection.some((k) => k.trackId === ref.trackId && k.frame === ref.frame);

  return (
    <section
      aria-label="Timeline"
      className="flex h-full min-h-0 flex-col border-t border-border bg-panel"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
        <button
          type="button"
          className={button}
          onClick={() => state.setFrame(0)}
          title="Début (Origine)"
        >
          ⏮
        </button>
        <button
          type="button"
          className={button}
          onClick={() => state.setFrame(frame - 1)}
          aria-label="Frame précédente"
          title="Frame précédente (←)"
        >
          ◀︎
        </button>
        <button
          type="button"
          className={`${button} min-w-16`}
          onClick={() => state.setPlaying(!playing)}
          title="Lecture / pause (Espace)"
        >
          {playing ? 'Pause' : 'Lecture'}
        </button>
        <button
          type="button"
          className={button}
          onClick={() => {
            state.setPlaying(false);
            state.setFrame(0);
          }}
        >
          Stop
        </button>
        <button
          type="button"
          className={button}
          onClick={() => state.setFrame(frame + 1)}
          aria-label="Frame suivante"
          title="Frame suivante (→)"
        >
          ▶︎
        </button>
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={loop}
            onChange={(event) => state.setLoop(event.target.checked)}
          />
          Boucle
        </label>
        <label className="flex items-center gap-1 text-xs">
          Frame
          <input
            type="number"
            aria-label="Frame courante"
            min={0}
            max={duration - 1}
            value={frame}
            onChange={(event) => state.setFrame(Number(event.target.value))}
            className="w-16 rounded border border-border bg-surface px-1"
          />
          <span className="text-muted">
            / {duration - 1} · {formatTime(frame, numerator, denominator)} ·{' '}
            {(numerator / denominator).toFixed(3).replace('.', ',')} i/s
          </span>
        </label>
        <div className="flex-1" />
        {canEdit && keySelection.length > 0 && (
          <>
            <select
              aria-label="Interpolation des clés sélectionnées"
              className="rounded border border-border bg-surface px-1 py-0.5 text-xs"
              value=""
              onChange={(event) =>
                state.apply((s) =>
                  setKeysInterpolation(s, keySelection, event.target.value as Interpolation),
                )
              }
            >
              <option value="" disabled>
                Interpolation…
              </option>
              {INTERPOLATIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted">{keySelection.length} clé(s)</span>
          </>
        )}
        {canEdit && (
          <button
            type="button"
            className={button}
            onClick={() =>
              state.apply((s) => addMarker(s, frame, `M${s.markers.length + 1}`).scene)
            }
          >
            Marqueur
          </button>
        )}
        <label className="flex items-center gap-1 text-xs">
          Zoom
          <input
            type="range"
            aria-label="Zoom temporel"
            min={2}
            max={40}
            value={pxPerFrame}
            onChange={(event) => setPxPerFrame(Number(event.target.value))}
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div style={{ width: width + LABEL_WIDTH }} className="relative">
          {/* Règle : cliquer ou glisser pour déplacer la tête de lecture. */}
          <div className="sticky top-0 z-10 flex bg-panel">
            <div
              style={{ width: LABEL_WIDTH }}
              className="shrink-0 border-r border-border px-2 text-xs text-muted"
            >
              Marqueurs
            </div>
            <div
              role="slider"
              aria-label="Règle de la timeline"
              aria-valuemin={0}
              aria-valuemax={duration - 1}
              aria-valuenow={frame}
              tabIndex={0}
              className="relative h-10 cursor-pointer select-none border-b border-border"
              style={{ width }}
              onPointerDown={(event) => {
                scrub.current = true;
                event.currentTarget.setPointerCapture(event.pointerId);
                state.setPlaying(false);
                state.setFrame(frameAt(event.clientX, event.currentTarget));
              }}
              onPointerMove={(event) => {
                if (scrub.current) state.setFrame(frameAt(event.clientX, event.currentTarget));
              }}
              onPointerUp={() => {
                scrub.current = false;
              }}
            >
              {Array.from({ length: Math.ceil(duration / 10) }, (_, index) => index * 10).map(
                (tick) => (
                  <span
                    key={tick}
                    className="absolute top-0 h-2 border-l border-muted text-[10px] text-muted"
                    style={{ left: tick * pxPerFrame }}
                  >
                    <span className="ml-0.5">{tick}</span>
                  </span>
                ),
              )}
              {scene.markers.map((marker) => (
                <button
                  key={marker.id}
                  type="button"
                  title={`${marker.label} (frame ${marker.frame}) — clic : aller ; double-clic : supprimer`}
                  className="absolute bottom-0 -translate-x-1/2 rounded-t bg-warn px-1 text-[10px] text-surface"
                  style={{ left: (marker.frame + 0.5) * pxPerFrame }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => state.setFrame(marker.frame)}
                  onDoubleClick={() => canEdit && state.apply((s) => removeMarker(s, marker.id))}
                >
                  {marker.label}
                </button>
              ))}
            </div>
          </div>

          {groups.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted">
              Aucune animation : sélectionnez un objet, placez la tête de lecture et posez une clé
              (K).
            </p>
          )}
          {groups.map((group) => (
            <div key={group.id}>
              <button
                type="button"
                className="flex w-full items-center gap-1 border-b border-border/50 px-2 py-0.5 text-left text-xs font-semibold"
                style={{ width: LABEL_WIDTH }}
                aria-expanded={!collapsed.has(group.id)}
                onClick={() => {
                  const next = new Set(collapsed);
                  if (next.has(group.id)) next.delete(group.id);
                  else next.add(group.id);
                  setCollapsed(next);
                }}
              >
                {collapsed.has(group.id) ? '▸' : '▾'} <span className="truncate">{group.name}</span>
              </button>
              {!collapsed.has(group.id) &&
                group.tracks.map((track) => (
                  <div key={track.id} className="flex border-b border-border/30">
                    <div
                      style={{ width: LABEL_WIDTH }}
                      className="shrink-0 truncate border-r border-border px-4 py-1 text-xs text-muted"
                    >
                      {PROPERTY_LABELS[track.propertyPath] ?? track.propertyPath}
                    </div>
                    <div
                      className="relative h-6"
                      style={{ width }}
                      aria-label={`Piste ${group.name} ${PROPERTY_LABELS[track.propertyPath] ?? ''}`}
                    >
                      {track.keyframes.map((key) => {
                        const ref = { trackId: track.id, frame: key.frame };
                        const selected = isSelected(ref);
                        const offset = selected && drag ? drag.delta : 0;
                        return (
                          <button
                            key={key.frame}
                            type="button"
                            aria-label={`Clé ${PROPERTY_LABELS[track.propertyPath] ?? ''} frame ${key.frame}`}
                            aria-pressed={selected}
                            title={`Frame ${key.frame} · ${key.interpolation}`}
                            className={`absolute top-1 h-3 w-3 -translate-x-1/2 rotate-45 border ${selected ? 'border-accent bg-accent' : 'border-warn bg-warn/60'}`}
                            style={{ left: (key.frame + offset + 0.5) * pxPerFrame }}
                            onPointerDown={(event) => {
                              event.stopPropagation();
                              const additive = event.shiftKey || event.metaKey || event.ctrlKey;
                              if (!selected || additive)
                                state.selectKeys([ref], additive ? 'toggle' : 'replace');
                              if (canEdit) {
                                event.currentTarget.setPointerCapture(event.pointerId);
                                setDrag({ startX: event.clientX, delta: 0 });
                              }
                            }}
                            onPointerMove={(event) => {
                              if (drag)
                                setDrag({
                                  ...drag,
                                  delta: Math.round((event.clientX - drag.startX) / pxPerFrame),
                                });
                            }}
                            onPointerUp={() => {
                              if (drag && drag.delta !== 0) {
                                const refs = store.getState().keySelection;
                                const delta = drag.delta;
                                if (state.apply((s) => moveKeys(s, refs, delta))) {
                                  state.selectKeys(
                                    refs.map((r) => ({ ...r, frame: r.frame + delta })),
                                  );
                                }
                              } else if (!drag || drag.delta === 0) {
                                state.setFrame(key.frame);
                              }
                              setDrag(null);
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
            </div>
          ))}

          {/* Tête de lecture. */}
          <div
            className="pointer-events-none absolute bottom-0 top-0 w-px bg-accent"
            style={{ left: LABEL_WIDTH + (frame + 0.5) * pxPerFrame }}
          />
        </div>
      </div>
    </section>
  );
}
