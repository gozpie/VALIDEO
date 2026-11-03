'use client';

import {
  keyTransform,
  setKey,
  setTransformAtFrame,
  trackFor,
  type PropertyPath,
} from '@ass/animation-engine';
import { evaluatedScene } from '@ass/editor-ui';
import type { Camera, SceneDocument, Transform } from '@ass/scene-schema';
import {
  eulerDegreesToQuaternion,
  findEntity,
  moveCamera,
  nodeColor,
  quaternionToEulerDegrees,
  setActiveCamera,
  setCameraLookAt,
  setNodeColor,
  setParent,
  subtreeIds,
  updateCamera,
  updateLight,
  type CameraMove,
} from '@ass/scene-engine';
import { useState } from 'react';
import { hexToLinear, linearToHex } from './color';
import { deleteSelection, duplicateSelection, groupSelection } from './commands';
import { useEditor, useEditorContext } from './context';
import { NumberField, Vec3Field } from './fields';

const small =
  'inline-flex h-7 items-center justify-center gap-1 rounded-md border border-border bg-elevated px-2 text-xs transition-colors hover:border-border-strong disabled:opacity-40';

/** Indicateur d'animation : ◆ clé à cette frame, ◇ propriété animée, rien sinon. */
function KeyBadge({
  scene,
  id,
  path,
  frame,
}: {
  scene: SceneDocument;
  id: string;
  path: string;
  frame: number;
}) {
  const track = trackFor(scene, id, path);
  if (!track) return null;
  const onKey = track.keyframes.some((k) => k.frame === frame);
  return (
    <span className="text-warn" title={onKey ? 'Clé à cette frame' : 'Propriété animée'}>
      {onKey ? '◆' : '◇'}
    </span>
  );
}

const MOVES: { move: CameraMove; label: string; angular: boolean }[] = [
  { move: 'dolly', label: 'Dolly', angular: false },
  { move: 'truck', label: 'Truck', angular: false },
  { move: 'pedestal', label: 'Pedestal', angular: false },
  { move: 'pan', label: 'Pan', angular: true },
  { move: 'tilt', label: 'Tilt', angular: true },
  { move: 'orbit', label: 'Orbite', angular: true },
];

function CameraPanel({ camera, disabled }: { camera: Camera; disabled: boolean }) {
  const { store } = useEditorContext();
  const raw = useEditor((state) => state.scene);
  const frame = useEditor((state) => state.frame);
  const [step, setStep] = useState({ distance: 0.5, degrees: 5 });
  const id = camera.id;
  const apply = (operation: (scene: SceneDocument) => SceneDocument) =>
    store.getState().apply(operation);
  const keyScalar = (path: PropertyPath, value: number) =>
    apply((s) => setKey(s, { targetId: id, propertyPath: path, frame, value }));
  /** Un mouvement part de l'état évalué ; si la transformation est animée, il pose une clé. */
  const move = (kind: CameraMove, sign: 1 | -1, angular: boolean) =>
    apply((s) => {
      const amount = sign * (angular ? (step.degrees * Math.PI) / 180 : step.distance);
      const moved = moveCamera(evaluatedScene({ scene: s, frame }), id, kind, amount);
      const transform = moved.cameras.find((c) => c.id === id)?.transform;
      return transform ? setTransformAtFrame(s, id, transform, frame) : s;
    });
  const targets = [...raw.nodes, ...raw.lights, ...raw.cameras.filter((c) => c.id !== id)];
  const scalar = (
    label: string,
    path: PropertyPath,
    key: 'focalLengthMm' | 'aperture',
    min: number,
  ) => (
    <div className="flex items-end gap-1">
      <NumberField
        label={label}
        value={camera[key]}
        min={min}
        step={1}
        disabled={disabled}
        onCommit={(value) =>
          apply((s) =>
            trackFor(s, id, path)
              ? setKey(s, { targetId: id, propertyPath: path, frame, value })
              : updateCamera(s, id, { [key]: value }),
          )
        }
      />
      <KeyBadge scene={raw} id={id} path={path} frame={frame} />
      <button
        type="button"
        className={small}
        disabled={disabled}
        onClick={() => keyScalar(path, camera[key])}
        title="Poser une clé"
      >
        Clé
      </button>
    </div>
  );

  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-1 text-xs font-semibold text-muted">Caméra</legend>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={raw.activeCameraId === id}
          onChange={(event) => apply((s) => setActiveCamera(s, event.target.checked ? id : null))}
        />
        Caméra active du plan
      </label>
      {scalar('Focale (mm)', 'camera.focalLengthMm', 'focalLengthMm', 1)}
      {scalar('Ouverture (f/)', 'camera.aperture', 'aperture', 0.5)}
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Capteur (mm)"
          value={camera.sensorWidthMm}
          min={1}
          step={1}
          disabled={disabled}
          onCommit={(sensorWidthMm) => apply((s) => updateCamera(s, id, { sensorWidthMm }))}
        />
        <NumberField
          label="Mise au point (m)"
          value={camera.focusDistance ?? 0}
          min={0}
          step={0.1}
          disabled={disabled}
          onCommit={(value) =>
            apply((s) => updateCamera(s, id, { focusDistance: value > 0 ? value : null }))
          }
        />
        <NumberField
          label="Near (m)"
          value={camera.nearClip}
          min={0.001}
          step={0.01}
          disabled={disabled}
          onCommit={(nearClip) => apply((s) => updateCamera(s, id, { nearClip }))}
        />
        <NumberField
          label="Far (m)"
          value={camera.farClip}
          min={0.01}
          step={10}
          disabled={disabled}
          onCommit={(farClip) => apply((s) => updateCamera(s, id, { farClip }))}
        />
      </div>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted">Viser (look-at)</span>
        <select
          value={camera.lookAtTargetId ?? ''}
          onChange={(event) => apply((s) => setCameraLookAt(s, id, event.target.value || null))}
          className="h-8 rounded-lg border border-border bg-surface px-2 text-[13px] focus:border-accent focus:outline-none"
        >
          <option value="">(aucune cible)</option>
          {targets.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name}
            </option>
          ))}
        </select>
      </label>
      {camera.lookAtTargetId && (
        <NumberField
          label="Roulis (°)"
          value={Math.round(((camera.rollRadians * 180) / Math.PI) * 1000) / 1000}
          step={5}
          disabled={disabled}
          onCommit={(degrees) =>
            apply((s) => updateCamera(s, id, { rollRadians: (degrees * Math.PI) / 180 }))
          }
        />
      )}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted">Mouvements</span>
        <div className="grid grid-cols-2 gap-1">
          <NumberField
            label="Pas (m)"
            value={step.distance}
            min={0.01}
            step={0.1}
            onCommit={(distance) => setStep({ ...step, distance })}
          />
          <NumberField
            label="Pas (°)"
            value={step.degrees}
            min={0.1}
            step={1}
            onCommit={(degrees) => setStep({ ...step, degrees })}
          />
        </div>
        <div className="grid grid-cols-3 gap-1">
          {MOVES.map(({ move: kind, label, angular }) => (
            <span key={kind} className="flex items-center gap-0.5">
              <button
                type="button"
                className={small}
                aria-label={`${label} −`}
                onClick={() => move(kind, -1, angular)}
              >
                −
              </button>
              <span className="flex-1 text-center text-xs">{label}</span>
              <button
                type="button"
                className={small}
                aria-label={`${label} +`}
                onClick={() => move(kind, 1, angular)}
              >
                +
              </button>
            </span>
          ))}
        </div>
      </div>
    </fieldset>
  );
}

export function Inspector() {
  const { store, canEdit } = useEditorContext();
  const raw = useEditor((state) => state.scene);
  const scene = useEditor(evaluatedScene);
  const frame = useEditor((state) => state.frame);
  const selection = useEditor((state) => state.selection);
  const primary = selection.at(-1);
  const entity = primary ? findEntity(scene, primary) : null;

  if (!entity || !primary) {
    return (
      <section aria-label="Inspecteur" className="text-sm text-muted">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide">Inspecteur</h2>
        Sélectionnez un objet dans la vue ou la hiérarchie.
      </section>
    );
  }

  const locked = entity.kind !== 'light' && entity.value.locked;
  const disabled = !canEdit || locked;
  const transform = entity.value.transform;
  const apply = (operation: (scene: SceneDocument) => SceneDocument) =>
    store.getState().apply(operation);
  // Une propriété animée reçoit une clé à la frame courante ; sinon, la valeur de base change.
  const commitTransform = (patch: Partial<Transform>) =>
    apply((current) => setTransformAtFrame(current, primary, { ...transform, ...patch }, frame));
  const excluded = subtreeIds(raw, primary);
  const parentOptions = raw.nodes.filter((node) => !excluded.has(node.id));
  const color = entity.kind === 'node' ? nodeColor(scene, primary) : null;
  const visibleKey = entity.kind !== 'camera';

  return (
    <section aria-label="Inspecteur" className="flex flex-col gap-4 text-sm">
      <div>
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
          Inspecteur · frame {frame}
        </h2>
        <p className="mt-1 truncate font-semibold">{entity.value.name}</p>
        {selection.length > 1 && (
          <p className="text-xs text-muted">{selection.length} éléments sélectionnés</p>
        )}
        {locked && <p className="text-xs text-warn">Verrouillé : déverrouillez pour modifier.</p>}
      </div>

      <div className="flex flex-col gap-3">
        {(
          [
            [
              'Position',
              'transform.position',
              transform.position,
              (position: [number, number, number]) => commitTransform({ position }),
              0.1,
            ],
            [
              'Rotation (°)',
              'transform.rotation',
              quaternionToEulerDegrees(transform.rotation),
              (degrees: [number, number, number]) =>
                commitTransform({ rotation: eulerDegreesToQuaternion(degrees) }),
              5,
            ],
            [
              'Échelle',
              'transform.scale',
              transform.scale,
              (scale: [number, number, number]) => commitTransform({ scale }),
              0.1,
            ],
          ] as const
        ).map(([label, path, value, commit, step]) => (
          <div key={path} className="relative">
            <span className="absolute right-0 top-0">
              <KeyBadge scene={raw} id={primary} path={path} frame={frame} />
            </span>
            <Vec3Field
              label={label}
              value={value}
              step={step}
              disabled={disabled}
              onCommit={commit}
            />
          </div>
        ))}
        {canEdit && (
          <button
            type="button"
            className={small}
            disabled={disabled}
            title="Clé de position, rotation et échelle à la frame courante (K)"
            onClick={() => apply((s) => keyTransform(s, primary, transform, frame))}
          >
            Poser une clé de transformation (K)
          </button>
        )}
      </div>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted">Parent</span>
        <select
          disabled={disabled}
          value={entity.value.parentId ?? ''}
          onChange={(event) =>
            apply((current) => setParent(current, primary, event.target.value || null))
          }
          className="h-8 rounded-lg border border-border bg-surface px-2 text-[13px] focus:border-accent focus:outline-none"
        >
          <option value="">(racine de la scène)</option>
          {parentOptions.map((node) => (
            <option key={node.id} value={node.id}>
              {node.name}
            </option>
          ))}
        </select>
      </label>

      {visibleKey && canEdit && (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted">
            Visibilité animée <KeyBadge scene={raw} id={primary} path="visible" frame={frame} />
          </span>
          <button
            type="button"
            className={small}
            disabled={disabled}
            onClick={() =>
              apply((s) =>
                setKey(s, {
                  targetId: primary,
                  propertyPath: 'visible',
                  frame,
                  value: entity.value.visible,
                }),
              )
            }
          >
            Clé de visibilité
          </button>
        </div>
      )}

      {entity.kind === 'node' && entity.value.type === 'primitive' && (
        <label className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted">Couleur</span>
          <input
            type="color"
            aria-label="Couleur"
            disabled={disabled}
            value={linearToHex(color ?? [0.6, 0.6, 0.6])}
            onChange={(event) =>
              apply((current) => setNodeColor(current, primary, hexToLinear(event.target.value)))
            }
          />
        </label>
      )}

      {entity.kind === 'camera' && <CameraPanel camera={entity.value} disabled={disabled} />}

      {entity.kind === 'light' && (
        <fieldset className="grid grid-cols-2 gap-2" disabled={!canEdit}>
          <legend className="mb-1 text-xs font-semibold text-muted">Lumière</legend>
          <div className="flex items-end gap-1">
            <NumberField
              label={entity.value.kind === 'directional' ? 'Intensité (lux)' : 'Intensité (cd)'}
              value={entity.value.intensity}
              min={0}
              step={1}
              onCommit={(intensity) =>
                apply((s) =>
                  trackFor(s, primary, 'light.intensity')
                    ? setKey(s, {
                        targetId: primary,
                        propertyPath: 'light.intensity',
                        frame,
                        value: intensity,
                      })
                    : updateLight(s, primary, { intensity }),
                )
              }
            />
            <KeyBadge scene={raw} id={primary} path="light.intensity" frame={frame} />
          </div>
          <button
            type="button"
            className={small}
            onClick={() =>
              apply((s) =>
                setKey(s, {
                  targetId: primary,
                  propertyPath: 'light.intensity',
                  frame,
                  value: entity.value.intensity,
                }),
              )
            }
          >
            Clé d’intensité
          </button>
          <label className="col-span-2 flex items-center justify-between gap-2 text-xs">
            <span className="text-muted">Couleur</span>
            <input
              type="color"
              aria-label="Couleur de la lumière"
              value={linearToHex(entity.value.color)}
              onChange={(event) =>
                apply((s) => updateLight(s, primary, { color: hexToLinear(event.target.value) }))
              }
            />
          </label>
        </fieldset>
      )}

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-lg border border-border bg-elevated px-3 text-xs hover:border-border-strong"
            onClick={() => duplicateSelection(store)}
          >
            Dupliquer
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-lg border border-border bg-elevated px-3 text-xs hover:border-border-strong"
            onClick={() => groupSelection(store)}
          >
            Grouper
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs text-error hover:border-error hover:bg-error/10"
            onClick={() => deleteSelection(store)}
          >
            Supprimer
          </button>
        </div>
      )}
    </section>
  );
}
