'use client';

import type { Transform } from '@ass/scene-schema';
import {
  eulerDegreesToQuaternion,
  findEntity,
  nodeColor,
  quaternionToEulerDegrees,
  setNodeColor,
  setParent,
  setTransform,
  subtreeIds,
  updateCamera,
  updateLight,
} from '@ass/scene-engine';
import { linearToHex, hexToLinear } from './color';
import { deleteSelection, duplicateSelection, groupSelection } from './commands';
import { useEditor, useEditorContext } from './context';
import { NumberField, Vec3Field } from './fields';

export function Inspector() {
  const { store, canEdit } = useEditorContext();
  const scene = useEditor((state) => state.scene);
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

  const locked = entity.kind === 'node' && entity.value.locked;
  const disabled = !canEdit || locked;
  const transform = entity.value.transform;
  const commitTransform = (patch: Partial<Transform>) =>
    store.getState().apply((current) => setTransform(current, primary, { ...transform, ...patch }));
  const excluded = subtreeIds(scene, primary);
  const parentOptions = scene.nodes.filter((node) => !excluded.has(node.id));
  const color = entity.kind === 'node' ? nodeColor(scene, primary) : null;

  return (
    <section aria-label="Inspecteur" className="flex flex-col gap-4 text-sm">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Inspecteur</h2>
        <p className="mt-1 truncate font-semibold">{entity.value.name}</p>
        {selection.length > 1 && (
          <p className="text-xs text-muted">{selection.length} éléments sélectionnés</p>
        )}
        {locked && (
          <p className="text-xs text-warn">Objet verrouillé : déverrouillez-le pour le modifier.</p>
        )}
      </div>

      <Vec3Field
        label="Position"
        value={transform.position}
        disabled={disabled}
        onCommit={(position) => commitTransform({ position })}
      />
      <Vec3Field
        label="Rotation (°)"
        step={5}
        value={quaternionToEulerDegrees(transform.rotation)}
        disabled={disabled}
        onCommit={(degrees) => commitTransform({ rotation: eulerDegreesToQuaternion(degrees) })}
      />
      <Vec3Field
        label="Échelle"
        value={transform.scale}
        disabled={disabled}
        onCommit={(scale) => commitTransform({ scale })}
      />

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted">Parent</span>
        <select
          disabled={disabled}
          value={entity.value.parentId ?? ''}
          onChange={(event) =>
            store
              .getState()
              .apply((current) => setParent(current, primary, event.target.value || null))
          }
          className="rounded border border-border bg-surface px-2 py-1 text-sm"
        >
          <option value="">(racine de la scène)</option>
          {parentOptions.map((node) => (
            <option key={node.id} value={node.id}>
              {node.name}
            </option>
          ))}
        </select>
      </label>

      {entity.kind === 'node' && entity.value.type === 'primitive' && (
        <label className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted">Couleur</span>
          <input
            type="color"
            aria-label="Couleur"
            disabled={disabled}
            value={linearToHex(color ?? [0.6, 0.6, 0.6])}
            onChange={(event) =>
              store
                .getState()
                .apply((current) => setNodeColor(current, primary, hexToLinear(event.target.value)))
            }
          />
        </label>
      )}

      {entity.kind === 'camera' && (
        <fieldset className="grid grid-cols-2 gap-2" disabled={!canEdit}>
          <legend className="mb-1 text-xs font-semibold text-muted">Caméra</legend>
          <NumberField
            label="Focale (mm)"
            value={entity.value.focalLengthMm}
            min={1}
            step={1}
            onCommit={(focalLengthMm) =>
              store.getState().apply((s) => updateCamera(s, primary, { focalLengthMm }))
            }
          />
          <NumberField
            label="Capteur (mm)"
            value={entity.value.sensorWidthMm}
            min={1}
            step={1}
            onCommit={(sensorWidthMm) =>
              store.getState().apply((s) => updateCamera(s, primary, { sensorWidthMm }))
            }
          />
        </fieldset>
      )}

      {entity.kind === 'light' && (
        <fieldset className="grid grid-cols-2 gap-2" disabled={!canEdit}>
          <legend className="mb-1 text-xs font-semibold text-muted">Lumière</legend>
          <NumberField
            label={entity.value.kind === 'directional' ? 'Intensité (lux)' : 'Intensité (cd)'}
            value={entity.value.intensity}
            min={0}
            step={1}
            onCommit={(intensity) =>
              store.getState().apply((s) => updateLight(s, primary, { intensity }))
            }
          />
          <label className="flex items-end justify-between gap-2 text-xs">
            <span className="text-muted">Couleur</span>
            <input
              type="color"
              aria-label="Couleur de la lumière"
              value={linearToHex(entity.value.color)}
              onChange={(event) =>
                store
                  .getState()
                  .apply((s) => updateLight(s, primary, { color: hexToLinear(event.target.value) }))
              }
            />
          </label>
        </fieldset>
      )}

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded border border-border px-2 py-1 hover:border-accent"
            onClick={() => duplicateSelection(store)}
          >
            Dupliquer
          </button>
          <button
            type="button"
            className="rounded border border-border px-2 py-1 hover:border-accent"
            onClick={() => groupSelection(store)}
          >
            Grouper
          </button>
          <button
            type="button"
            className="rounded border border-border px-2 py-1 text-error hover:border-error"
            onClick={() => deleteSelection(store)}
          >
            Supprimer
          </button>
        </div>
      )}
    </section>
  );
}
