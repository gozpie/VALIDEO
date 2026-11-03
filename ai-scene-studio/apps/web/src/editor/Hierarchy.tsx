'use client';

import { childrenOf, renameEntity, setLocked, setVisible, type Entity } from '@ass/scene-engine';
import { useMemo, useState } from 'react';
import { useEditor, useEditorContext } from './context';

const KIND_LABEL: Record<string, string> = {
  group: 'Groupe',
  empty: 'Empty',
  primitive: 'Primitive',
  model: 'Modèle',
  image_plane: 'Image',
  camera: 'Caméra',
  light: 'Lumière',
};

function kindOf(entity: Entity): string {
  return entity.kind === 'node'
    ? (KIND_LABEL[entity.value.type] ?? entity.value.type)
    : (KIND_LABEL[entity.kind] ?? '');
}

function Row({ entity, depth, filter }: { entity: Entity; depth: number; filter: string }) {
  const { store, canEdit } = useEditorContext();
  const scene = useEditor((state) => state.scene);
  const selected = useEditor((state) => state.selection.includes(entity.value.id));
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(entity.value.name);
  const children = entity.kind === 'node' ? childrenOf(scene, entity.value.id) : [];
  const id = entity.value.id;
  const matches = filter === '' || entity.value.name.toLowerCase().includes(filter);
  const hasVisibility = entity.kind !== 'camera';
  const visible = entity.kind === 'camera' ? true : entity.value.visible;
  const locked = entity.kind === 'node' && entity.value.locked;

  return (
    <li>
      {matches && (
        <div
          role="treeitem"
          aria-selected={selected}
          aria-label={entity.value.name}
          tabIndex={0}
          className={`flex items-center gap-2 rounded px-2 py-1 text-sm ${selected ? 'bg-accent/25' : 'hover:bg-border/40'}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={(event) =>
            store
              .getState()
              .select([id], event.shiftKey || event.metaKey || event.ctrlKey ? 'toggle' : 'replace')
          }
          onDoubleClick={() => {
            if (!canEdit) return;
            setDraft(entity.value.name);
            setRenaming(true);
          }}
        >
          {renaming ? (
            <input
              autoFocus
              aria-label="Nouveau nom"
              value={draft}
              maxLength={200}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => {
                store.getState().apply((current) => renameEntity(current, id, draft));
                setRenaming(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') setRenaming(false);
              }}
              className="min-w-0 flex-1 rounded border border-accent bg-surface px-1"
            />
          ) : (
            <span className={`min-w-0 flex-1 truncate ${visible ? '' : 'text-muted line-through'}`}>
              {entity.value.name}
            </span>
          )}
          <span className="text-xs text-muted">{kindOf(entity)}</span>
          {canEdit && hasVisibility && (
            <button
              type="button"
              aria-label={`${visible ? 'Masquer' : 'Afficher'} ${entity.value.name}`}
              title={visible ? 'Masquer (H)' : 'Afficher (H)'}
              className="text-xs text-muted hover:text-text"
              onClick={(event) => {
                event.stopPropagation();
                store.getState().apply((current) => setVisible(current, id, !visible));
              }}
            >
              {visible ? '👁' : '—'}
            </button>
          )}
          {canEdit && entity.kind === 'node' && (
            <button
              type="button"
              aria-label={`${locked ? 'Déverrouiller' : 'Verrouiller'} ${entity.value.name}`}
              title={locked ? 'Déverrouiller' : 'Verrouiller'}
              className={`text-xs ${locked ? 'text-warn' : 'text-muted hover:text-text'}`}
              onClick={(event) => {
                event.stopPropagation();
                store.getState().apply((current) => setLocked(current, id, !locked));
              }}
            >
              {locked ? '🔒' : '·'}
            </button>
          )}
        </div>
      )}
      {children.length > 0 && (
        <ul role="group">
          {children.map((child) => (
            <Row key={child.value.id} entity={child} depth={depth + 1} filter={filter} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function Hierarchy() {
  const scene = useEditor((state) => state.scene);
  const roots = useMemo(() => childrenOf(scene, null), [scene]);
  const [search, setSearch] = useState('');
  const filter = search.trim().toLowerCase();
  return (
    <section aria-label="Hiérarchie de la scène" className="flex min-h-0 flex-1 flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Hiérarchie</h2>
      <input
        type="search"
        aria-label="Rechercher un objet"
        placeholder="Rechercher…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="rounded border border-border bg-surface px-2 py-1 text-sm"
      />
      {roots.length === 0 ? (
        <p className="text-sm text-muted">Scène vide : ajoutez un objet.</p>
      ) : (
        <ul role="tree" aria-label="Objets" className="min-h-0 flex-1 overflow-auto">
          {roots.map((entity) => (
            <Row key={entity.value.id} entity={entity} depth={0} filter={filter} />
          ))}
        </ul>
      )}
    </section>
  );
}
