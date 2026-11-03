'use client';

import type { PrimitiveKind } from '@ass/scene-schema';
import {
  PRIMITIVE_LABELS,
  createCamera,
  createEmptyNode,
  createGroupNode,
  createLight,
  createModelNode,
  createPrimitiveNode,
} from '@ass/scene-engine';
import { useRef, useState } from 'react';
import { uploadAsset } from '@/lib/api';
import { addAndSelect } from './commands';
import { useEditorContext } from './context';

const PRIMITIVES = Object.keys(PRIMITIVE_LABELS) as PrimitiveKind[];

export function AddMenu({ workspaceId }: { workspaceId: string }) {
  const { store } = useEditorContext();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ kind: 'idle' | 'busy' | 'error'; message?: string }>({
    kind: 'idle',
  });
  const button = 'rounded border border-border px-2 py-1 text-xs hover:border-accent';

  return (
    <section aria-label="Ajouter" className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Ajouter</h2>
      <div className="flex flex-wrap gap-1">
        {PRIMITIVES.map((kind) => (
          <button
            key={kind}
            type="button"
            className={button}
            onClick={() => addAndSelect(store, { kind: 'node', value: createPrimitiveNode(kind) })}
          >
            {PRIMITIVE_LABELS[kind]}
          </button>
        ))}
        <button
          type="button"
          className={button}
          onClick={() => addAndSelect(store, { kind: 'node', value: createEmptyNode() })}
        >
          Empty
        </button>
        <button
          type="button"
          className={button}
          onClick={() => addAndSelect(store, { kind: 'node', value: createGroupNode() })}
        >
          Groupe
        </button>
        <button
          type="button"
          className={button}
          onClick={() => addAndSelect(store, { kind: 'camera', value: createCamera() })}
        >
          Caméra
        </button>
        <button
          type="button"
          className={button}
          onClick={() => addAndSelect(store, { kind: 'light', value: createLight('directional') })}
        >
          Lumière directionnelle
        </button>
        <button
          type="button"
          className={button}
          onClick={() => addAndSelect(store, { kind: 'light', value: createLight('point') })}
        >
          Lumière ponctuelle
        </button>
        <button
          type="button"
          className={button}
          onClick={() => addAndSelect(store, { kind: 'light', value: createLight('spot') })}
        >
          Projecteur
        </button>
        <button
          type="button"
          className={button}
          disabled={status.kind === 'busy'}
          onClick={() => input.current?.click()}
        >
          {status.kind === 'busy' ? 'Import…' : 'Importer un GLB'}
        </button>
        <input
          ref={input}
          type="file"
          accept=".glb,model/gltf-binary"
          aria-label="Fichier GLB à importer"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            setStatus({ kind: 'busy' });
            uploadAsset(workspaceId, file)
              .then(({ asset }) => {
                const name = asset.name.replace(/\.glb$/i, '').slice(0, 200) || 'Modèle';
                addAndSelect(store, { kind: 'node', value: createModelNode(asset.id, name) });
                setStatus({ kind: 'idle' });
              })
              .catch((error: Error) => setStatus({ kind: 'error', message: error.message }));
          }}
        />
      </div>
      {status.kind === 'error' && (
        <p role="alert" className="text-xs text-error">
          {status.message}
        </p>
      )}
    </section>
  );
}
